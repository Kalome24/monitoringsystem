// models/stockTransferModel.js
//
// RESERVATION TIMING — Design 1 (reserve at approve, deduct at ship)
//
// SESSION 9 FIX (F5a):
//   Migration 2 — three header statements now write from_warehouse_code / to_warehouse_code.
//
// SESSION 9 FIX (F8):
//   getSTSById no longer selects s.* alongside aliased fw.warehouse_code — the
//   duplicate column name was breaking shipSTS with "Validation failed for
//   parameter 'wh'. Invalid string."
//
// SESSION 9 FIX (F9):
//   Every list query computed total_qty as SUM(l.qty) — the ORIGINAL requested
//   qty. After the DH adjusts a line, approved_qty holds the decision but the
//   list rows kept showing the pre-adjustment number, so the handler's
//   TransferModal displayed the wrong total. Now every aggregate uses
//   COALESCE(l.approved_qty, l.qty), so pending slips are unchanged and
//   approved slips show the DH's number.

const { sql, pool, poolConnect } = require('../db');
const WarehouseInventoryModel = require('./warehouseInventoryModel');
const DamagedItemsModel       = require('./damagedItemsModel');
const StockTransferActivityLogModel = require('./stockTransferActivityLogModel');

class StockTransferModel {
  /* ============================================================
     HELPERS
     ============================================================ */

  static async getNextStsNo() {
    await poolConnect;
    const request = pool.request();
    const result = await request.query(`
      SELECT NEXT VALUE FOR seq_sts_no AS next_no
    `);
    const nextNo = result.recordset[0]?.next_no;
    if (nextNo == null) throw new Error('Could not fetch next STS number.');
    return `STS-${String(nextNo).padStart(6, '0')}`;
  }

  static async getWarehouseByCode(code) {
    await poolConnect;
    const request = pool.request();
    request.input('code', sql.NVarChar(40), String(code || '').trim());
    const res = await request.query(`
      SELECT warehouse_id, warehouse_code, warehouse_name, status
        FROM warehouse_table
       WHERE warehouse_code = @code
    `);
    return res.recordset[0] || null;
  }

  static async getWarehouseById(id) {
    await poolConnect;
    const request = pool.request();
    request.input('id', sql.Int, Number(id));
    const res = await request.query(`
      SELECT warehouse_id, warehouse_code, warehouse_name, status
        FROM warehouse_table
       WHERE warehouse_id = @id
    `);
    return res.recordset[0] || null;
  }

  /* ============================================================
     ACTIVITY LOG — thin wrappers so call sites stay short.
     ============================================================ */

  static _log(data) {
    return StockTransferActivityLogModel.createEvent(data).catch((err) => {
      console.warn('⚠️  stock_transfer_activity_log write failed:', err.message);
    });
  }

  static _logInTx(tx, data) {
    return StockTransferActivityLogModel.createEventInTx(tx, data);
  }

  /* ============================================================
     DAMAGE LOCATOR — auto-create per warehouse on first damage
     ============================================================ */
  static async _ensureDamageLocator(tx, warehouse_code) {
    const findReq = new sql.Request(tx);
    findReq.input('wh', sql.NVarChar(20), warehouse_code);
    const findRes = await findReq.query(`
      SELECT TOP 1 locator_code, locator_name
        FROM locator_table
       WHERE warehouse_code = @wh
         AND locator_type   = 'Damage'
       ORDER BY locator_code
    `);
    if (findRes.recordset[0]) return findRes.recordset[0].locator_code;

    const rawCode = `DAMAGE-${warehouse_code}`;
    const code    = rawCode.length > 50 ? rawCode.slice(0, 50) : rawCode;

    const checkReq = new sql.Request(tx);
    checkReq.input('code', sql.NVarChar(50), code);
    const checkRes = await checkReq.query(`
      SELECT locator_code FROM locator_table WHERE locator_code = @code
    `);
    let finalCode = code;
    if (checkRes.recordset[0]) {
      finalCode = `${code}-${Date.now() % 10000}`;
      if (finalCode.length > 50) finalCode = finalCode.slice(0, 50);
    }

    const insReq = new sql.Request(tx);
    insReq.input('code', sql.NVarChar(50), finalCode);
    insReq.input('name', sql.NVarChar,     `Damage hold area for ${warehouse_code}`);
    insReq.input('wh',   sql.NVarChar(20), warehouse_code);

    await insReq.query(`
      INSERT INTO locator_table
        (locator_code, locator_name, warehouse_code, status, locator_type, created_by)
      VALUES
        (@code, @name, @wh, 'Active', 'Damage', 'System');
    `);

    return finalCode;
  }

  static async getDamageLocator(warehouse_code) {
    await poolConnect;
    const request = pool.request();
    request.input('wh', sql.NVarChar(20), warehouse_code);
    const res = await request.query(`
      SELECT TOP 1 locator_code, locator_name, warehouse_code
        FROM locator_table
       WHERE warehouse_code = @wh
         AND locator_type   = 'Damage'
       ORDER BY locator_code
    `);
    return res.recordset[0] || null;
  }

  /* ============================================================
     CREATE — Direct transfer
     ============================================================ */
  static async createSTS(data) {
    await poolConnect;

    const {
      from_warehouse_id,
      to_warehouse_id,
      transfer_date,
      po_no = null,
      remarks = null,
      submitted_by,
      lines = [],
    } = data;

    if (!Array.isArray(lines) || lines.length === 0) {
      throw new Error('At least one line is required to create an STS.');
    }

    const [fromWh, toWh] = await Promise.all([
      StockTransferModel.getWarehouseById(from_warehouse_id),
      StockTransferModel.getWarehouseById(to_warehouse_id),
    ]);
    if (!fromWh) throw new Error(`Source warehouse ${from_warehouse_id} not found.`);
    if (!toWh)   throw new Error(`Destination warehouse ${to_warehouse_id} not found.`);
    const fromCode = fromWh.warehouse_code;
    const toCode   = toWh.warehouse_code;

    let finalLines = lines;
    const skippedItems = [];

    if (po_no) {
      const pendingItemCodes = await StockTransferModel.getPendingItemCodesForPO(po_no);
      if (pendingItemCodes.size > 0) {
        finalLines = [];
        for (const line of lines) {
          if (pendingItemCodes.has(line.item_code)) skippedItems.push(line.item_code);
          else finalLines.push(line);
        }
        if (finalLines.length === 0) {
          const err = new Error(
            `All selected items on PO "${po_no}" already have a stock transfer awaiting Department Head approval.`
          );
          err.code = 'PO_HAS_ACTIVE_STS';
          err.blockedItems = skippedItems;
          throw err;
        }
      }
    }

    if (po_no && finalLines.length > 0) {
      const reopenableId = await StockTransferModel.findReopenableRejectedSTS(
        po_no,
        finalLines.map((l) => l.item_code)
      );
      if (reopenableId) {
        const reopened = await StockTransferModel.reopenSTS(reopenableId, {
          from_warehouse_id,
          to_warehouse_id,
          transfer_date,
          po_no,
          remarks,
          submitted_by,
          lines: finalLines,
        });
        return { ...reopened, skippedItems, createdLineCount: finalLines.length };
      }
    }

    for (const line of finalLines) {
      const qty = Number(line.qty) || 0;
      if (qty <= 0) continue;

      const inv = await WarehouseInventoryModel.getInventory({
        warehouse_id: from_warehouse_id,
        item_code:    line.item_code,
      });
      const onHand    = Number(inv?.qty_on_hand)  || 0;
      const reserved  = Number(inv?.qty_reserved) || 0;
      const available = onHand - reserved;

      if (available < qty) {
        throw new Error(
          `Insufficient available stock for ${line.item_code}: ` +
          `requested ${qty}, available ${available} ` +
          `(on hand ${onHand}, reserved ${reserved}).`
        );
      }
    }

    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    try {
      const headerReq = new sql.Request(transaction);
      headerReq.input('from_warehouse_id',   sql.Int,           from_warehouse_id);
      headerReq.input('to_warehouse_id',     sql.Int,           to_warehouse_id);
      headerReq.input('from_warehouse_code', sql.NVarChar(20),  fromCode);
      headerReq.input('to_warehouse_code',   sql.NVarChar(20),  toCode);
      headerReq.input('transfer_date',       sql.Date,          transfer_date);
      headerReq.input('po_no',               sql.VarChar(50),   po_no);
      headerReq.input('status',              sql.VarChar(20),   'Pending');
      headerReq.input('request_origin',      sql.VarChar(20),   'Direct');
      headerReq.input('remarks',             sql.NVarChar(500), remarks);
      headerReq.input('submitted_by',        sql.NVarChar(100), submitted_by);

      const headerResult = await headerReq.query(`
        INSERT INTO stock_transfer_slips
          (sts_no,
           from_warehouse_id, to_warehouse_id,
           from_warehouse_code, to_warehouse_code,
           transfer_date,
           po_no, status, request_origin, remarks, submitted_by, submitted_at)
        VALUES
          (NULL,
           @from_warehouse_id, @to_warehouse_id,
           @from_warehouse_code, @to_warehouse_code,
           @transfer_date,
           @po_no, @status, @request_origin, @remarks, @submitted_by, GETDATE());
        SELECT SCOPE_IDENTITY() AS sts_id;
      `);

      const sts_id = headerResult.recordset[0]?.sts_id;
      if (!sts_id) throw new Error('Failed to insert STS header.');

      const draftNo = `DRAFT-${sts_id}`;

      let lineNo = 0;
      for (const line of finalLines) {
        lineNo += 1;

        let effectiveCost = 0;
        try {
          const invRow = await WarehouseInventoryModel.getInventory({
            warehouse_id: from_warehouse_id,
            item_code:    line.item_code,
          });
          if (invRow) effectiveCost = Number(invRow.avg_unit_cost) || 0;
        } catch { /* fall through with 0 */ }

        const qty = Number(line.qty) || 0;

        const lineReq = new sql.Request(transaction);
        lineReq.input('sts_id',        sql.BigInt,        sts_id);
        lineReq.input('line_no',       sql.Int,           lineNo);
        lineReq.input('item_code',     sql.NVarChar(50),  line.item_code);
        lineReq.input('item_name',     sql.NVarChar(400), line.item_name || null);
        lineReq.input('uom',           sql.NVarChar(50),  line.uom || null);
        lineReq.input('qty',           sql.Decimal(18,4), qty);
        lineReq.input('requested_qty', sql.Decimal(18,4), qty);
        lineReq.input('unit_price',    sql.Decimal(18,6), effectiveCost);
        lineReq.input('currency',      sql.NVarChar(3),   line.currency || null);
        lineReq.input('remarks',       sql.NVarChar(300), line.remarks || null);

        const lineRes = await lineReq.query(`
          INSERT INTO stock_transfer_slip_lines
            (sts_id, line_no, item_code, item_name, uom,
             qty, requested_qty, unit_price, currency, remarks)
          OUTPUT INSERTED.sts_line_id
          VALUES
            (@sts_id, @line_no, @item_code, @item_name, @uom,
             @qty, @requested_qty, @unit_price, @currency, @remarks)
        `);

        const newLineId = lineRes.recordset[0]?.sts_line_id;

        await StockTransferModel._logInTx(transaction, {
          sts_id,
          sts_no:              null,
          sts_line_id:         newLineId,
          event_type:          'REQUEST_SUBMITTED',
          from_warehouse_code: fromCode,
          to_warehouse_code:   toCode,
          item_code:           line.item_code,
          item_name:           line.item_name || null,
          uom:                 line.uom || null,
          qty_before:          0,
          qty_after:           qty,
          qty_change:          qty,
          actor:               submitted_by || 'System',
          actor_role:          null,
          remarks:             po_no ? `PO ${po_no}` : null,
        });
      }

      await transaction.commit();

      if (po_no) await StockTransferModel.syncPOTransferStatus(po_no);

      return {
        sts_id,
        sts_no: null,
        draft_no: draftNo,
        skippedItems,
        createdLineCount: finalLines.length,
        reopened: false,
      };
    } catch (err) {
      try { await transaction.rollback(); } catch { /* ignore */ }
      throw err;
    }
  }

  /* ============================================================
     CREATE — Transfer Request
     ============================================================ */
  static async createTransferRequest({
    from_warehouse_code,
    to_warehouse_code,
    item_code,
    item_name = null,
    uom = null,
    qty,
    target_locator_code,
    remarks = null,
    submitted_by,
    actor_role = null,
  }) {
    await poolConnect;

    const fromWh = await StockTransferModel.getWarehouseByCode(from_warehouse_code);
    if (!fromWh) throw new Error(`Source warehouse "${from_warehouse_code}" not found.`);
    if (fromWh.status !== 'Active') throw new Error(`Source warehouse "${from_warehouse_code}" is not active.`);

    const toWh = await StockTransferModel.getWarehouseByCode(to_warehouse_code);
    if (!toWh) throw new Error(`Destination warehouse "${to_warehouse_code}" not found.`);
    if (toWh.status !== 'Active') throw new Error(`Destination warehouse "${to_warehouse_code}" is not active.`);

    if (fromWh.warehouse_id === toWh.warehouse_id) {
      throw new Error('Source and destination warehouses must be different.');
    }

    const itemReq = pool.request();
    itemReq.input('code', sql.NVarChar(100), String(item_code || '').trim());
    const itemRes = await itemReq.query(`
      SELECT Item_Code, Item_Description, Uom_Code, Status
        FROM item_master
       WHERE Item_Code = @code
    `);
    const item = itemRes.recordset[0];
    if (!item) throw new Error(`Item "${item_code}" not found.`);
    if (item.Status !== 'Active') throw new Error(`Item "${item_code}" is not active.`);

    const locReq = pool.request();
    locReq.input('loc', sql.NVarChar(50), String(target_locator_code || '').trim());
    locReq.input('wh',  sql.NVarChar(40), toWh.warehouse_code);
    const locRes = await locReq.query(`
      SELECT locator_code, ISNULL(locator_type, 'Regular') AS locator_type, status
        FROM locator_table
       WHERE locator_code = @loc
         AND warehouse_code = @wh
    `);
    const loc = locRes.recordset[0];
    if (!loc) throw new Error(`Locator "${target_locator_code}" not found in ${toWh.warehouse_code}.`);
    if (loc.status !== 'Active') throw new Error(`Locator "${target_locator_code}" is not active.`);
    if (loc.locator_type === 'Damage') {
      throw new Error(`Cannot request into a DAMAGE locator ("${loc.locator_code}").`);
    }

    const q = Number(qty);
    if (!Number.isFinite(q) || q <= 0 || !Number.isInteger(q)) {
      throw new Error('Quantity must be a positive integer.');
    }

    const srcInv = await WarehouseInventoryModel.getInventory({
      warehouse_id: fromWh.warehouse_id,
      item_code:    item.Item_Code,
    });
    const onHand    = Number(srcInv?.qty_on_hand)  || 0;
    const reserved  = Number(srcInv?.qty_reserved) || 0;
    const available = onHand - reserved;

    if (available < q) {
      throw new Error(
        `Insufficient available stock at ${fromWh.warehouse_code}: ` +
        `requested ${q}, available ${available} ` +
        `(on hand ${onHand}, reserved ${reserved}).`
      );
    }
    const unitCost = Number(srcInv?.avg_unit_cost) || 0;

    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    try {
      const headerReq = new sql.Request(transaction);
      headerReq.input('from_warehouse_id',   sql.Int,           fromWh.warehouse_id);
      headerReq.input('to_warehouse_id',     sql.Int,           toWh.warehouse_id);
      headerReq.input('from_warehouse_code', sql.NVarChar(20),  fromWh.warehouse_code);
      headerReq.input('to_warehouse_code',   sql.NVarChar(20),  toWh.warehouse_code);
      headerReq.input('transfer_date',       sql.Date,          new Date());
      headerReq.input('status',              sql.VarChar(20),   'Pending');
      headerReq.input('request_origin',      sql.VarChar(20),   'Requested');
      headerReq.input('remarks',             sql.NVarChar(500), remarks);
      headerReq.input('submitted_by',        sql.NVarChar(100), submitted_by);

      const headerRes = await headerReq.query(`
        INSERT INTO stock_transfer_slips
          (sts_no,
           from_warehouse_id, to_warehouse_id,
           from_warehouse_code, to_warehouse_code,
           transfer_date,
           po_no, status, request_origin, remarks, submitted_by, submitted_at)
        VALUES
          (NULL,
           @from_warehouse_id, @to_warehouse_id,
           @from_warehouse_code, @to_warehouse_code,
           @transfer_date,
           NULL, @status, @request_origin, @remarks, @submitted_by, GETDATE());
        SELECT SCOPE_IDENTITY() AS sts_id;
      `);

      const sts_id = headerRes.recordset[0]?.sts_id;
      if (!sts_id) throw new Error('Failed to insert transfer request header.');

      const draftNo = `DRAFT-${sts_id}`;

      const lineReq = new sql.Request(transaction);
      lineReq.input('sts_id',        sql.BigInt,        sts_id);
      lineReq.input('line_no',       sql.Int,           1);
      lineReq.input('item_code',     sql.NVarChar(50),  item.Item_Code);
      lineReq.input('item_name',     sql.NVarChar(400), item_name || item.Item_Description || null);
      lineReq.input('uom',           sql.NVarChar(50),  uom || item.Uom_Code || null);
      lineReq.input('qty',           sql.Decimal(18,4), q);
      lineReq.input('requested_qty', sql.Decimal(18,4), q);
      lineReq.input('unit_price',    sql.Decimal(18,6), unitCost);
      lineReq.input('locator_code',  sql.NVarChar(50),  loc.locator_code);

      const lineRes = await lineReq.query(`
        INSERT INTO stock_transfer_slip_lines
          (sts_id, line_no, item_code, item_name, uom,
           qty, requested_qty, unit_price, locator_code)
        OUTPUT INSERTED.sts_line_id
        VALUES
          (@sts_id, @line_no, @item_code, @item_name, @uom,
           @qty, @requested_qty, @unit_price, @locator_code)
      `);

      const newLineId = lineRes.recordset[0]?.sts_line_id;

      await StockTransferModel._logInTx(transaction, {
        sts_id,
        sts_no:              null,
        sts_line_id:         newLineId,
        event_type:          'REQUEST_SUBMITTED',
        from_warehouse_code: fromWh.warehouse_code,
        to_warehouse_code:   toWh.warehouse_code,
        item_code:           item.Item_Code,
        item_name:           item_name || item.Item_Description || null,
        uom:                 uom || item.Uom_Code || null,
        qty_before:          0,
        qty_after:           q,
        qty_change:          q,
        locator_code:        loc.locator_code,
        actor:               submitted_by || 'System',
        actor_role,
        remarks:             remarks || null,
      });

      await transaction.commit();

      return {
        sts_id,
        sts_no:              null,
        draft_no:            draftNo,
        from_warehouse_code: fromWh.warehouse_code,
        to_warehouse_code:   toWh.warehouse_code,
        item_code:           item.Item_Code,
        qty:                 q,
        target_locator_code: loc.locator_code,
      };
    } catch (err) {
      try { await transaction.rollback(); } catch { /* ignore */ }
      throw err;
    }
  }

  static async findReopenableRejectedSTS(poNo, itemCodes = []) {
    await poolConnect;
    if (!poNo || !Array.isArray(itemCodes) || itemCodes.length === 0) return null;

    const wanted = new Set(itemCodes.map((c) => String(c).trim()).filter(Boolean));
    if (wanted.size === 0) return null;

    const req = pool.request();
    req.input('po_no', sql.VarChar(50), poNo);

    const res = await req.query(`
      SELECT s.sts_id, s.rejected_at, l.item_code
        FROM stock_transfer_slips s
        INNER JOIN stock_transfer_slip_lines l ON l.sts_id = s.sts_id
       WHERE s.po_no = @po_no
         AND s.status = 'Rejected'
       ORDER BY s.rejected_at DESC, s.sts_id DESC
    `);

    const bySts = new Map();
    const order = [];
    for (const row of res.recordset) {
      if (!bySts.has(row.sts_id)) { bySts.set(row.sts_id, new Set()); order.push(row.sts_id); }
      bySts.get(row.sts_id).add(String(row.item_code).trim());
    }

    for (const stsId of order) {
      const codes = bySts.get(stsId);
      let allFound = true;
      for (const w of wanted) { if (!codes.has(w)) { allFound = false; break; } }
      if (allFound) return stsId;
    }
    return null;
  }

  /* ============================================================
     REOPEN — from Rejected
     ============================================================ */
  static async reopenSTS(stsId, data) {
    await poolConnect;

    const {
      from_warehouse_id,
      to_warehouse_id,
      transfer_date,
      po_no = null,
      remarks = null,
      submitted_by,
      lines = [],
      actor_role = null,
    } = data;

    if (!Array.isArray(lines) || lines.length === 0) {
      throw new Error('At least one line is required to reopen an STS.');
    }

    const [fromWh, toWh] = await Promise.all([
      StockTransferModel.getWarehouseById(from_warehouse_id),
      StockTransferModel.getWarehouseById(to_warehouse_id),
    ]);
    if (!fromWh) throw new Error(`Source warehouse ${from_warehouse_id} not found.`);
    if (!toWh)   throw new Error(`Destination warehouse ${to_warehouse_id} not found.`);
    const fromCode = fromWh.warehouse_code;
    const toCode   = toWh.warehouse_code;

    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    try {
      const headerReq = new sql.Request(transaction);
      headerReq.input('sts_id',              sql.BigInt,        stsId);
      headerReq.input('from_warehouse_id',   sql.Int,           from_warehouse_id);
      headerReq.input('to_warehouse_id',     sql.Int,           to_warehouse_id);
      headerReq.input('from_warehouse_code', sql.NVarChar(20),  fromCode);
      headerReq.input('to_warehouse_code',   sql.NVarChar(20),  toCode);
      headerReq.input('transfer_date',       sql.Date,          transfer_date);
      headerReq.input('remarks',             sql.NVarChar(500), remarks || null);
      headerReq.input('submitted_by',        sql.NVarChar(100), submitted_by);

      const headerRes = await headerReq.query(`
        UPDATE stock_transfer_slips
           SET from_warehouse_id   = @from_warehouse_id,
               to_warehouse_id     = @to_warehouse_id,
               from_warehouse_code = @from_warehouse_code,
               to_warehouse_code   = @to_warehouse_code,
               transfer_date       = @transfer_date,
               status              = 'Pending',
               remarks             = @remarks,
               submitted_by        = @submitted_by,
               submitted_at        = GETDATE(),
               approved_by         = NULL,
               approved_at         = NULL,
               completed_by        = NULL,
               completed_at        = NULL,
               received_by         = NULL,
               received_at         = NULL,
               receive_remarks     = NULL,
               arrived_by          = NULL,
               arrived_at          = NULL,
               arrival_remarks     = NULL,
               shipped_by          = NULL,
               shipped_at          = NULL,
               handler_acknowledged_at = NULL
         WHERE sts_id = @sts_id
           AND status = 'Rejected';

        SELECT sts_id FROM stock_transfer_slips WHERE sts_id = @sts_id;
      `);

      if (headerRes.rowsAffected[0] === 0) {
        throw new Error('Cannot reopen: STS is not in Rejected status.');
      }

      const draftNo = `DRAFT-${stsId}`;

      const delReq = new sql.Request(transaction);
      delReq.input('sts_id', sql.BigInt, stsId);
      await delReq.query(`DELETE FROM stock_transfer_slip_lines WHERE sts_id = @sts_id`);

      let lineNo = 0;
      for (const line of lines) {
        lineNo += 1;

        let effectiveCost = 0;
        try {
          const invRow = await WarehouseInventoryModel.getInventory({
            warehouse_id: from_warehouse_id,
            item_code:    line.item_code,
          });
          if (invRow) effectiveCost = Number(invRow.avg_unit_cost) || 0;
        } catch { /* ignore */ }

        const qty = Number(line.qty) || 0;

        const lineReq = new sql.Request(transaction);
        lineReq.input('sts_id',        sql.BigInt,        stsId);
        lineReq.input('line_no',       sql.Int,           lineNo);
        lineReq.input('item_code',     sql.NVarChar(50),  line.item_code);
        lineReq.input('item_name',     sql.NVarChar(400), line.item_name || null);
        lineReq.input('uom',           sql.NVarChar(50),  line.uom || null);
        lineReq.input('qty',           sql.Decimal(18,4), qty);
        lineReq.input('requested_qty', sql.Decimal(18,4), qty);
        lineReq.input('unit_price',    sql.Decimal(18,6), effectiveCost);
        lineReq.input('currency',      sql.NVarChar(3),   line.currency || null);
        lineReq.input('remarks',       sql.NVarChar(300), line.remarks || null);

        const lineRes = await lineReq.query(`
          INSERT INTO stock_transfer_slip_lines
            (sts_id, line_no, item_code, item_name, uom,
             qty, requested_qty, unit_price, currency, remarks)
          OUTPUT INSERTED.sts_line_id
          VALUES
            (@sts_id, @line_no, @item_code, @item_name, @uom,
             @qty, @requested_qty, @unit_price, @currency, @remarks)
        `);

        const newLineId = lineRes.recordset[0]?.sts_line_id;

        await StockTransferModel._logInTx(transaction, {
          sts_id,
          sts_no:              null,
          sts_line_id:         newLineId,
          event_type:          'REQUEST_SUBMITTED',
          from_warehouse_code: fromCode,
          to_warehouse_code:   toCode,
          item_code:           line.item_code,
          item_name:           line.item_name || null,
          uom:                 line.uom || null,
          qty_before:          0,
          qty_after:           qty,
          qty_change:          qty,
          actor:               submitted_by || 'System',
          actor_role,
          remarks:             po_no ? `Reopened · PO ${po_no}` : 'Reopened',
        });
      }

      await transaction.commit();

      if (po_no) await StockTransferModel.syncPOTransferStatus(po_no);

      return {
        sts_id: stsId,
        sts_no: null,
        draft_no: draftNo,
        skippedItems: [],
        createdLineCount: lines.length,
        reopened: true,
      };
    } catch (err) {
      try { await transaction.rollback(); } catch { /* ignore */ }
      throw err;
    }
  }

  /* ============================================================
     READ — listSTSs (paginated)
     F9 — total_qty now uses COALESCE(approved_qty, qty).
     ============================================================ */
  static async listSTSs({
    status, from_warehouse_id, to_warehouse_id,
    search, start_date, end_date, submitted_by, approved_by,
    origin,
    warehouse_code, warehouse_side,
    page = 1,
    limit = 500,
  } = {}) {
    await poolConnect;

    const safeLimit = Math.min(Math.max(Number(limit) || 500, 1), 500);
    const safePage  = Math.max(Number(page) || 1, 1);

    const applyFilters = (request) => {
      const conditions = [];

      if (status && status !== 'All') {
        request.input('status', sql.VarChar(20), status);
        conditions.push('s.status = @status');
      }
      if (origin && origin !== 'All') {
        request.input('origin', sql.VarChar(20), origin);
        conditions.push('s.request_origin = @origin');
      }
      if (from_warehouse_id) {
        request.input('from_warehouse_id', sql.Int, Number(from_warehouse_id));
        conditions.push('s.from_warehouse_id = @from_warehouse_id');
      }
      if (to_warehouse_id) {
        request.input('to_warehouse_id', sql.Int, Number(to_warehouse_id));
        conditions.push('s.to_warehouse_id = @to_warehouse_id');
      }
      if (warehouse_code && String(warehouse_code).trim()) {
        const code = String(warehouse_code).trim();
        const side = String(warehouse_side || 'either').toLowerCase();
        request.input('warehouse_code', sql.NVarChar(40), code);
        if (side === 'from') {
          conditions.push('s.from_warehouse_code = @warehouse_code');
        } else if (side === 'to') {
          conditions.push('s.to_warehouse_code = @warehouse_code');
        } else {
          conditions.push(
            '(s.from_warehouse_code = @warehouse_code OR s.to_warehouse_code = @warehouse_code)'
          );
        }
      }
      if (search && String(search).trim()) {
        request.input('search', sql.NVarChar(100), `%${String(search).trim()}%`);
        conditions.push('(s.sts_no LIKE @search OR s.po_no LIKE @search)');
      }
      if (start_date) {
        request.input('start_date', sql.Date, start_date);
        conditions.push('s.transfer_date >= @start_date');
      }
      if (end_date) {
        request.input('end_date', sql.Date, end_date);
        conditions.push('s.transfer_date <= @end_date');
      }
      if (submitted_by) {
        request.input('submitted_by', sql.NVarChar(100), submitted_by);
        conditions.push('s.submitted_by = @submitted_by');
      }
      if (approved_by) {
        request.input('approved_by', sql.NVarChar(100), approved_by);
        conditions.push('s.approved_by = @approved_by');
      }

      return conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    };

    const countReq   = pool.request();
    const countWhere = applyFilters(countReq);
    const countRes   = await countReq.query(`
      SELECT COUNT(*) AS total
        FROM stock_transfer_slips s
        LEFT JOIN warehouse_table fw ON fw.warehouse_id = s.from_warehouse_id
        LEFT JOIN warehouse_table tw ON tw.warehouse_id = s.to_warehouse_id
        ${countWhere}
    `);
    const total = Number(countRes.recordset[0]?.total) || 0;

    const totalPages    = Math.max(Math.ceil(total / safeLimit), 1);
    const effectivePage = Math.min(safePage, totalPages);
    const offset        = (effectivePage - 1) * safeLimit;

    const dataReq   = pool.request();
    const dataWhere = applyFilters(dataReq);
    dataReq.input('limit',  sql.Int, safeLimit);
    dataReq.input('offset', sql.Int, offset);

    const dataRes = await dataReq.query(`
      SELECT
             s.sts_id, s.sts_no, s.status, s.request_origin,
             s.from_warehouse_id, s.to_warehouse_id,
             s.from_warehouse_code, s.to_warehouse_code,
             s.transfer_date, s.po_no, s.remarks,
             s.submitted_by, s.submitted_at,
             s.approved_by, s.approved_at,
             s.rejected_by, s.rejected_at, s.rejection_reason,
             s.handler_acknowledged_at,
             s.shipped_by, s.shipped_at, s.source_locator_code,
             s.received_by, s.received_at, s.receive_remarks,
             s.arrived_by, s.arrived_at, s.arrival_remarks,
             s.completed_by, s.completed_at,
             fw.warehouse_name AS from_warehouse_name,
             tw.warehouse_name AS to_warehouse_name,
             (SELECT COUNT(*) FROM stock_transfer_slip_lines l WHERE l.sts_id = s.sts_id) AS line_count,
             (SELECT ISNULL(SUM(COALESCE(l.approved_qty, l.qty)), 0)
                FROM stock_transfer_slip_lines l WHERE l.sts_id = s.sts_id) AS total_qty
        FROM stock_transfer_slips s
        LEFT JOIN warehouse_table fw ON fw.warehouse_id = s.from_warehouse_id
        LEFT JOIN warehouse_table tw ON tw.warehouse_id = s.to_warehouse_id
        ${dataWhere}
       ORDER BY s.submitted_at DESC
       OFFSET @offset ROWS
       FETCH NEXT @limit ROWS ONLY
    `);

    return {
      rows:  dataRes.recordset || [],
      total,
      page:  effectivePage,
      limit: safeLimit,
    };
  }

  /* ============================================================
     READ — listIncoming (paginated) — F9 patch
     ============================================================ */
  static async listIncoming({
    to_warehouse_id,
    status,
    search,
    page = 1,
    limit = 50,
  } = {}) {
    await poolConnect;

    const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 500);
    const safePage  = Math.max(Number(page) || 1, 1);

    if (!to_warehouse_id) {
      return { rows: [], total: 0, page: 1, limit: safeLimit };
    }

    const applyFilters = (request) => {
      request.input('to_warehouse_id', sql.Int, Number(to_warehouse_id));
      const conditions = ['s.to_warehouse_id = @to_warehouse_id'];

      if (status === 'All') {
        conditions.push("s.status IN ('In-Transit', 'Received')");
      } else if (status) {
        request.input('status', sql.VarChar(20), status);
        conditions.push('s.status = @status');
      } else {
        conditions.push("s.status = 'In-Transit'");
      }

      if (search && String(search).trim()) {
        request.input('search', sql.NVarChar(100), `%${String(search).trim()}%`);
        conditions.push('(s.sts_no LIKE @search OR s.po_no LIKE @search)');
      }

      return `WHERE ${conditions.join(' AND ')}`;
    };

    const countReq   = pool.request();
    const countWhere = applyFilters(countReq);
    const countRes   = await countReq.query(`
      SELECT COUNT(*) AS total
        FROM stock_transfer_slips s
        ${countWhere}
    `);
    const total = Number(countRes.recordset[0]?.total) || 0;

    const totalPages    = Math.max(Math.ceil(total / safeLimit), 1);
    const effectivePage = Math.min(safePage, totalPages);
    const offset        = (effectivePage - 1) * safeLimit;

    const dataReq = pool.request();
    const dataWhere = applyFilters(dataReq);
    dataReq.input('limit',  sql.Int, safeLimit);
    dataReq.input('offset', sql.Int, offset);

    const dataRes = await dataReq.query(`
      SELECT
             s.sts_id, s.sts_no, s.status, s.request_origin,
             s.from_warehouse_id, s.to_warehouse_id,
             s.from_warehouse_code, s.to_warehouse_code,
             s.transfer_date, s.po_no, s.remarks,
             s.submitted_by, s.submitted_at,
             s.approved_by, s.approved_at,
             s.rejected_by, s.rejected_at, s.rejection_reason,
             s.handler_acknowledged_at,
             s.shipped_by, s.shipped_at, s.source_locator_code,
             s.received_by, s.received_at, s.receive_remarks,
             s.completed_by, s.completed_at,
             fw.warehouse_name AS from_warehouse_name,
             tw.warehouse_name AS to_warehouse_name,
             (SELECT COUNT(*) FROM stock_transfer_slip_lines l WHERE l.sts_id = s.sts_id) AS line_count,
             (SELECT ISNULL(SUM(COALESCE(l.approved_qty, l.qty)), 0)
                FROM stock_transfer_slip_lines l WHERE l.sts_id = s.sts_id) AS total_qty
        FROM stock_transfer_slips s
        LEFT JOIN warehouse_table fw ON fw.warehouse_id = s.from_warehouse_id
        LEFT JOIN warehouse_table tw ON tw.warehouse_id = s.to_warehouse_id
        ${dataWhere}
       ORDER BY s.approved_at DESC, s.submitted_at DESC
       OFFSET @offset ROWS
       FETCH NEXT @limit ROWS ONLY
    `);

    return {
      rows:  dataRes.recordset || [],
      total,
      page:  effectivePage,
      limit: safeLimit,
    };
  }

  static async getIncomingCounts({ to_warehouse_id } = {}) {
    await poolConnect;
    if (!to_warehouse_id) return { approved: 0, received: 0, total: 0 };

    const request = pool.request();
    request.input('to_warehouse_id', sql.Int, Number(to_warehouse_id));

    const result = await request.query(`
      SELECT
        SUM(CASE WHEN status = 'In-Transit' THEN 1 ELSE 0 END) AS approved,
        SUM(CASE WHEN status = 'Received'   THEN 1 ELSE 0 END) AS received,
        COUNT(*) AS total
        FROM stock_transfer_slips
       WHERE to_warehouse_id = @to_warehouse_id
         AND status IN ('In-Transit', 'Received')
    `);

    return result.recordset[0] || { approved: 0, received: 0, total: 0 };
  }

  /* ------------------------------------------------------------
     getSTSById — explicit column list, no `s.*`
     ------------------------------------------------------------ */
  static async getSTSById(stsId) {
    await poolConnect;
    const request = pool.request();
    request.input('sts_id', sql.BigInt, stsId);

    const result = await request.query(`
      SELECT
        s.sts_id,
        s.sts_no,
        s.status,
        s.request_origin,
        s.from_warehouse_id,
        s.to_warehouse_id,
        s.from_warehouse_code,
        s.to_warehouse_code,
        s.transfer_date,
        s.po_no,
        s.remarks,
        s.submitted_by,
        s.submitted_at,
        s.approved_by,
        s.approved_at,
        s.rejected_by,
        s.rejected_at,
        s.rejection_reason,
        s.handler_acknowledged_at,
        s.shipped_by,
        s.shipped_at,
        s.source_locator_code,
        s.received_by,
        s.received_at,
        s.receive_remarks,
        s.arrived_by,
        s.arrived_at,
        s.arrival_remarks,
        s.completed_by,
        s.completed_at,
        fw.warehouse_name AS from_warehouse_name,
        tw.warehouse_name AS to_warehouse_name
        FROM stock_transfer_slips s
        LEFT JOIN warehouse_table fw ON fw.warehouse_id = s.from_warehouse_id
        LEFT JOIN warehouse_table tw ON tw.warehouse_id = s.to_warehouse_id
       WHERE s.sts_id = @sts_id
    `);
    return result.recordset[0] || null;
  }

  static async getSTSLines(stsId) {
    await poolConnect;
    const request = pool.request();
    request.input('sts_id', sql.BigInt, stsId);

    const result = await request.query(`
      SELECT sts_line_id, sts_id, line_no,
             item_code, item_name, uom,
             qty, requested_qty, approved_qty,
             qty_changed_by, qty_changed_at, qty_change_reason,
             unit_price, currency, remarks,
             received_qty, damaged_qty, damage_reason, received_at,
             stored_qty, locator_code,
             created_at
        FROM stock_transfer_slip_lines
       WHERE sts_id = @sts_id
       ORDER BY line_no
    `);
    return result.recordset;
  }

  static async getSTSDetail(stsId) {
    const header = await StockTransferModel.getSTSById(stsId);
    if (!header) return null;
    const lines = await StockTransferModel.getSTSLines(stsId);
    return { ...header, lines };
  }

  /* ============================================================
     READ — listApprovalQueue (paginated) — F9 patch
     ============================================================ */
  static async listApprovalQueue({
    search,
    page = 1,
    limit = 50,
  } = {}) {
    await poolConnect;

    const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 500);
    const safePage  = Math.max(Number(page) || 1, 1);

    const applyFilters = (request) => {
      const conditions = ["s.status = 'Pending'"];

      if (search && String(search).trim()) {
        request.input('search', sql.NVarChar(100), `%${String(search).trim()}%`);
        conditions.push(
          '(s.sts_no LIKE @search OR s.submitted_by LIKE @search ' +
          'OR s.from_warehouse_code LIKE @search ' +
          'OR s.to_warehouse_code LIKE @search ' +
          'OR fw.warehouse_name LIKE @search ' +
          'OR tw.warehouse_name LIKE @search)'
        );
      }

      return `WHERE ${conditions.join(' AND ')}`;
    };

    const countReq   = pool.request();
    const countWhere = applyFilters(countReq);
    const countRes   = await countReq.query(`
      SELECT COUNT(*) AS total
        FROM stock_transfer_slips s
        LEFT JOIN warehouse_table fw ON fw.warehouse_id = s.from_warehouse_id
        LEFT JOIN warehouse_table tw ON tw.warehouse_id = s.to_warehouse_id
        ${countWhere}
    `);
    const total = Number(countRes.recordset[0]?.total) || 0;

    const totalPages    = Math.max(Math.ceil(total / safeLimit), 1);
    const effectivePage = Math.min(safePage, totalPages);
    const offset        = (effectivePage - 1) * safeLimit;

    const dataReq = pool.request();
    const dataWhere = applyFilters(dataReq);
    dataReq.input('limit',  sql.Int, safeLimit);
    dataReq.input('offset', sql.Int, offset);

    const dataRes = await dataReq.query(`
      SELECT
             s.sts_id,
             s.sts_no,
             s.status,
             s.request_origin,
             s.submitted_by,
             s.submitted_at,
             s.remarks,
             s.po_no,
             s.from_warehouse_id,
             s.to_warehouse_id,
             s.from_warehouse_code,
             s.to_warehouse_code,
             fw.warehouse_name  AS from_warehouse_name,
             tw.warehouse_name  AS to_warehouse_name,
             (SELECT COUNT(*) FROM stock_transfer_slip_lines l WHERE l.sts_id = s.sts_id) AS line_count,
             (SELECT ISNULL(SUM(COALESCE(l.approved_qty, l.qty)), 0)
                FROM stock_transfer_slip_lines l WHERE l.sts_id = s.sts_id) AS total_qty
        FROM stock_transfer_slips s
        LEFT JOIN warehouse_table fw ON fw.warehouse_id = s.from_warehouse_id
        LEFT JOIN warehouse_table tw ON tw.warehouse_id = s.to_warehouse_id
        ${dataWhere}
       ORDER BY s.submitted_at ASC
       OFFSET @offset ROWS
       FETCH NEXT @limit ROWS ONLY
    `);

    return {
      rows:  dataRes.recordset || [],
      total,
      page:  effectivePage,
      limit: safeLimit,
    };
  }

  /* ============================================================
     READ — listForShipping (paginated) — F9 patch
     ============================================================ */
  static async listForShipping({
    from_warehouse_code,
    search,
    start_date,
    end_date,
    page = 1,
    limit = 50,
  } = {}) {
    await poolConnect;

    const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 500);
    const safePage  = Math.max(Number(page) || 1, 1);

    if (!from_warehouse_code) {
      return { rows: [], total: 0, page: 1, limit: safeLimit };
    }

    const fromCode = String(from_warehouse_code).trim();

    const applyFilters = (request) => {
      request.input('from_wh_code', sql.NVarChar(40), fromCode);
      const conditions = [
        "s.status = 'For Shipping'",
        's.from_warehouse_code = @from_wh_code',
      ];

      if (search && String(search).trim()) {
        request.input('search', sql.NVarChar(100), `%${String(search).trim()}%`);
        conditions.push(
          '(s.sts_no LIKE @search OR s.po_no LIKE @search ' +
          'OR s.submitted_by LIKE @search ' +
          'OR s.to_warehouse_code LIKE @search ' +
          'OR tw.warehouse_name LIKE @search)'
        );
      }
      if (start_date) {
        request.input('start_date', sql.Date, start_date);
        conditions.push('s.transfer_date >= @start_date');
      }
      if (end_date) {
        request.input('end_date', sql.Date, end_date);
        conditions.push('s.transfer_date <= @end_date');
      }

      return `WHERE ${conditions.join(' AND ')}`;
    };

    const countReq = pool.request();
    const countWhere = applyFilters(countReq);
    const countRes = await countReq.query(`
      SELECT COUNT(*) AS total
        FROM stock_transfer_slips s
        LEFT JOIN warehouse_table tw ON tw.warehouse_id = s.to_warehouse_id
        ${countWhere}
    `);
    const total = Number(countRes.recordset[0]?.total) || 0;

    const totalPages    = Math.max(Math.ceil(total / safeLimit), 1);
    const effectivePage = Math.min(safePage, totalPages);
    const offset        = (effectivePage - 1) * safeLimit;

    const dataReq = pool.request();
    const dataWhere = applyFilters(dataReq);
    dataReq.input('limit',  sql.Int, safeLimit);
    dataReq.input('offset', sql.Int, offset);

    const dataRes = await dataReq.query(`
      SELECT
             s.sts_id,
             s.sts_no,
             s.status,
             s.request_origin,
             s.submitted_by,
             s.submitted_at,
             s.approved_by,
             s.approved_at,
             s.remarks,
             s.po_no,
             s.transfer_date,
             s.from_warehouse_id,
             s.to_warehouse_id,
             s.from_warehouse_code,
             s.to_warehouse_code,
             fw.warehouse_name  AS from_warehouse_name,
             tw.warehouse_name  AS to_warehouse_name,
             (SELECT COUNT(*) FROM stock_transfer_slip_lines l WHERE l.sts_id = s.sts_id) AS line_count,
             (SELECT ISNULL(SUM(COALESCE(l.approved_qty, l.qty)), 0)
                FROM stock_transfer_slip_lines l WHERE l.sts_id = s.sts_id) AS total_qty
        FROM stock_transfer_slips s
        LEFT JOIN warehouse_table fw ON fw.warehouse_id = s.from_warehouse_id
        LEFT JOIN warehouse_table tw ON tw.warehouse_id = s.to_warehouse_id
        ${dataWhere}
       ORDER BY s.approved_at ASC
       OFFSET @offset ROWS
       FETCH NEXT @limit ROWS ONLY
    `);

    return {
      rows:  dataRes.recordset || [],
      total,
      page:  effectivePage,
      limit: safeLimit,
    };
  }

  /* ============================================================
     READ — listMyRequests (paginated) — F9 patch
     ============================================================ */
  static async listMyRequests({
    submitted_by,
    search,
    status,
    start_date,
    end_date,
    page = 1,
    limit = 50,
  } = {}) {
    await poolConnect;

    const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 500);
    const safePage  = Math.max(Number(page) || 1, 1);

    if (!submitted_by) {
      return { rows: [], total: 0, page: 1, limit: safeLimit };
    }

    const applyFilters = (request) => {
      request.input('submitted_by', sql.NVarChar(100), submitted_by);
      const conditions = [
        's.submitted_by = @submitted_by',
        "s.request_origin = 'Requested'",
      ];

      if (status && status !== 'All') {
        request.input('status', sql.VarChar(20), status);
        conditions.push('s.status = @status');
      }
      if (search && String(search).trim()) {
        request.input('search', sql.NVarChar(100), `%${String(search).trim()}%`);
        conditions.push(
          '(s.sts_no LIKE @search OR s.po_no LIKE @search ' +
          'OR s.from_warehouse_code LIKE @search ' +
          'OR fw.warehouse_name LIKE @search)'
        );
      }
      if (start_date) {
        request.input('start_date', sql.Date, start_date);
        conditions.push('s.transfer_date >= @start_date');
      }
      if (end_date) {
        request.input('end_date', sql.Date, end_date);
        conditions.push('s.transfer_date <= @end_date');
      }

      return `WHERE ${conditions.join(' AND ')}`;
    };

    const countReq = pool.request();
    const countWhere = applyFilters(countReq);
    const countRes = await countReq.query(`
      SELECT COUNT(*) AS total
        FROM stock_transfer_slips s
        LEFT JOIN warehouse_table fw ON fw.warehouse_id = s.from_warehouse_id
        ${countWhere}
    `);
    const total = Number(countRes.recordset[0]?.total) || 0;

    const totalPages    = Math.max(Math.ceil(total / safeLimit), 1);
    const effectivePage = Math.min(safePage, totalPages);
    const offset        = (effectivePage - 1) * safeLimit;

    const dataReq = pool.request();
    const dataWhere = applyFilters(dataReq);
    dataReq.input('limit',  sql.Int, safeLimit);
    dataReq.input('offset', sql.Int, offset);

    const dataRes = await dataReq.query(`
      SELECT
             s.sts_id,
             s.sts_no,
             s.status,
             s.request_origin,
             s.submitted_by,
             s.submitted_at,
             s.approved_by,
             s.approved_at,
             s.rejected_by,
             s.rejected_at,
             s.rejection_reason,
             s.handler_acknowledged_at,
             s.shipped_by,
             s.shipped_at,
             s.source_locator_code,
             s.received_by,
             s.received_at,
             s.receive_remarks,
             s.remarks,
             s.transfer_date,
             s.from_warehouse_id,
             s.to_warehouse_id,
             s.from_warehouse_code,
             s.to_warehouse_code,
             fw.warehouse_name  AS from_warehouse_name,
             tw.warehouse_name  AS to_warehouse_name,
             (SELECT COUNT(*) FROM stock_transfer_slip_lines l WHERE l.sts_id = s.sts_id) AS line_count,
             (SELECT ISNULL(SUM(COALESCE(l.approved_qty, l.qty)), 0)
                FROM stock_transfer_slip_lines l WHERE l.sts_id = s.sts_id) AS total_qty
        FROM stock_transfer_slips s
        LEFT JOIN warehouse_table fw ON fw.warehouse_id = s.from_warehouse_id
        LEFT JOIN warehouse_table tw ON tw.warehouse_id = s.to_warehouse_id
        ${dataWhere}
       ORDER BY s.submitted_at DESC
       OFFSET @offset ROWS
       FETCH NEXT @limit ROWS ONLY
    `);

    return {
      rows:  dataRes.recordset || [],
      total,
      page:  effectivePage,
      limit: safeLimit,
    };
  }

  /* ============================================================
     ELIGIBLE SOURCE LOCATORS
     ============================================================ */
  static async listEligibleSourceLocators(stsId) {
    await poolConnect;
    const request = pool.request();
    request.input('sts_id', sql.BigInt, Number(stsId));

    const result = await request.query(`
      WITH sts_items AS (
        SELECT DISTINCT l.item_code
          FROM stock_transfer_slip_lines l
         WHERE l.sts_id = @sts_id
      ),
      from_wh AS (
        SELECT from_warehouse_code AS warehouse_code
          FROM stock_transfer_slips
         WHERE sts_id = @sts_id
      )
      SELECT
        loc.locator_code,
        loc.locator_name,
        ISNULL(loc.locator_type, 'Regular') AS locator_type,
        m.match_count,
        m.match_qty,
        m.matching_items
        FROM locator_table loc
        INNER JOIN from_wh fw ON fw.warehouse_code = loc.warehouse_code
        CROSS APPLY (
          SELECT
            COUNT(DISTINCT il.item_code) AS match_count,
            ISNULL(SUM(il.qty), 0)       AS match_qty,
            STRING_AGG(
              CONCAT(il.item_code, ' ×', CAST(CAST(il.qty AS INT) AS VARCHAR(20))),
              ', '
            ) WITHIN GROUP (ORDER BY il.item_code) AS matching_items
            FROM inventory_locator il
            INNER JOIN sts_items si ON si.item_code = il.item_code
           WHERE il.warehouse_code = loc.warehouse_code
             AND il.locator_code   = loc.locator_code
             AND il.qty > 0
        ) AS m
       WHERE loc.status = 'Active'
         AND ISNULL(loc.locator_type, 'Regular') <> 'Damage'
         AND m.match_count > 0
       ORDER BY loc.locator_code
    `);

    return result.recordset.map((r) => ({
      locator_code:   r.locator_code,
      locator_name:   r.locator_name || '',
      locator_type:   r.locator_type || 'Regular',
      match_count:    Number(r.match_count) || 0,
      match_qty:      Number(r.match_qty)   || 0,
      matching_items: r.matching_items || '',
    }));
  }

  /* ============================================================
     PER-ITEM PO LOCK HELPERS
     ============================================================ */

  static async getPendingItemCodesForPO(poNo, excludeStsId = null) {
    await poolConnect;
    if (!poNo) return new Set();

    const request = pool.request();
    request.input('po_no', sql.VarChar(50), poNo);

    let sqlText = `
      SELECT DISTINCT l.item_code
        FROM stock_transfer_slip_lines l
        INNER JOIN stock_transfer_slips s ON s.sts_id = l.sts_id
       WHERE s.po_no = @po_no
         AND s.status = 'Pending'
    `;
    if (excludeStsId != null) {
      request.input('exclude_sts_id', sql.BigInt, excludeStsId);
      sqlText += ' AND s.sts_id <> @exclude_sts_id';
    }

    const result = await request.query(sqlText);
    return new Set(result.recordset.map((r) => r.item_code));
  }

  static async hasActiveSTSForPO(poNo, excludeStsId = null) {
    const codes = await StockTransferModel.getPendingItemCodesForPO(poNo, excludeStsId);
    return codes.size > 0;
  }

  static async syncPOTransferStatus(poNo) {
    await poolConnect;
    if (!poNo) return;

    const pendingItemCodes = await StockTransferModel.getPendingItemCodesForPO(poNo);

    if (pendingItemCodes.size > 0) {
      const lockReq = pool.request();
      lockReq.input('po_no', sql.VarChar(50), poNo);

      const lockPlaceholders = [];
      let lockIdx = 0;
      for (const code of pendingItemCodes) {
        const pName = `lockItem${lockIdx++}`;
        lockReq.input(pName, sql.NVarChar(50), code);
        lockPlaceholders.push(`@${pName}`);
      }

      await lockReq.query(`
        UPDATE import_po
           SET status = 'Pending Transfer'
         WHERE po_no = @po_no
           AND status = 'With Handler'
           AND item_code IN (${lockPlaceholders.join(',')})
      `);
    }

    const req = pool.request();
    req.input('po_no', sql.VarChar(50), poNo);

    let excludeClause = '';
    if (pendingItemCodes.size > 0) {
      const excludePlaceholders = [];
      let excludeIdx = 0;
      for (const code of pendingItemCodes) {
        const pName = `excludeItem${excludeIdx++}`;
        req.input(pName, sql.NVarChar(50), code);
        excludePlaceholders.push(`@${pName}`);
      }
      excludeClause = `AND p.item_code NOT IN (${excludePlaceholders.join(',')})`;
    }

    await req.query(`
      UPDATE p
         SET p.status = CASE
               WHEN p.received_qty >= p.qty
                    AND p.received_qty > 0
                    AND ISNULL(t.moved_qty, 0) >= p.received_qty
                 THEN 'Transferred'
               ELSE 'With Handler'
             END
        FROM import_po p
        OUTER APPLY (
          SELECT ISNULL(SUM(l.qty), 0) AS moved_qty
            FROM stock_transfer_slip_lines l
            INNER JOIN stock_transfer_slips s ON s.sts_id = l.sts_id
           WHERE s.po_no = p.po_no
             AND l.item_code = p.item_code
             AND s.status IN ('In-Transit', 'Received', 'Completed')
        ) AS t
       WHERE p.po_no = @po_no
         AND p.status IN ('With Handler', 'Pending Transfer')
         ${excludeClause}
    `);
  }

  static async getTransferredQtyForPO(poNo) {
    await poolConnect;
    const map = {};
    if (!poNo) return map;

    const request = pool.request();
    request.input('po_no', sql.VarChar(50), poNo);

    const result = await request.query(`
      SELECT l.item_code,
             ISNULL(SUM(COALESCE(l.approved_qty, l.qty)), 0) AS total_transferred
        FROM stock_transfer_slip_lines l
        INNER JOIN stock_transfer_slips s ON s.sts_id = l.sts_id
       WHERE s.po_no = @po_no
         AND s.status IN ('In-Transit', 'Received', 'Completed')
       GROUP BY l.item_code
    `);

    for (const row of result.recordset) {
      map[row.item_code] = Number(row.total_transferred) || 0;
    }
    return map;
  }

  /* ============================================================
     STATUS TRANSITIONS
     ============================================================ */

  static async approveSTS(stsId, username, options = {}) {
    await poolConnect;

    const approvedLines = Array.isArray(options.approved_lines)
      ? options.approved_lines
      : [];
    const actorRole     = options.actor_role || null;

    const header = await StockTransferModel.getSTSById(stsId);
    if (!header) return 0;

    const approvedByMap = new Map();
    for (const raw of approvedLines) {
      const id = Number(raw?.sts_line_id);
      if (!Number.isFinite(id)) continue;
      const qty = Number(raw.approved_qty);
      if (!Number.isFinite(qty) || qty < 0) continue;
      approvedByMap.set(id, {
        qty,
        reason: raw.qty_change_reason ? String(raw.qty_change_reason).trim().slice(0, 1000) : null,
      });
    }

    const sts_no = await StockTransferModel.getNextStsNo();

    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    try {
      const lockReq = new sql.Request(transaction);
      lockReq.input('sts_id', sql.BigInt, stsId);
      const lockRes = await lockReq.query(`
        SELECT status FROM stock_transfer_slips WITH (UPDLOCK, ROWLOCK)
         WHERE sts_id = @sts_id
      `);
      const currentStatus = lockRes.recordset[0]?.status;
      if (currentStatus !== 'Pending') {
        await transaction.rollback();
        return 0;
      }

      const linesReq = new sql.Request(transaction);
      linesReq.input('sts_id', sql.BigInt, stsId);
      const linesRes = await linesReq.query(`
        SELECT sts_line_id, line_no, item_code, item_name, uom,
               qty, requested_qty, approved_qty,
               unit_price, currency, locator_code
          FROM stock_transfer_slip_lines
         WHERE sts_id = @sts_id
         ORDER BY line_no
      `);
      const lines = linesRes.recordset;

      if (lines.length === 0) {
        await transaction.rollback();
        return 0;
      }

      const fromCode = header.from_warehouse_code || null;
      const toCode   = header.to_warehouse_code   || null;

      let allZeroed     = true;
      let totalReserved = 0;

      for (const line of lines) {
        const lineId        = Number(line.sts_line_id);
        const baseline      = Number(line.requested_qty ?? line.qty) || 0;
        const reqFromClient = approvedByMap.get(lineId);
        const approvedQty   = reqFromClient ? Number(reqFromClient.qty) : baseline;
        const reason        = reqFromClient?.reason || null;

        const updReq = new sql.Request(transaction);
        updReq.input('sts_line_id',       sql.BigInt,        lineId);
        updReq.input('approved_qty',      sql.Decimal(18,4), approvedQty);
        updReq.input('qty_changed_by',    sql.NVarChar(100), approvedQty !== baseline ? (username || 'System') : null);
        updReq.input('qty_changed_at',    sql.DateTime,      approvedQty !== baseline ? new Date() : null);
        updReq.input('qty_change_reason', sql.NVarChar(1000), approvedQty !== baseline ? reason : null);

        await updReq.query(`
          UPDATE stock_transfer_slip_lines
             SET approved_qty      = @approved_qty,
                 qty_changed_by    = COALESCE(@qty_changed_by, qty_changed_by),
                 qty_changed_at    = COALESCE(@qty_changed_at, qty_changed_at),
                 qty_change_reason = COALESCE(@qty_change_reason, qty_change_reason)
           WHERE sts_line_id = @sts_line_id
        `);

        if (approvedQty > 0) {
          allZeroed = false;

          await WarehouseInventoryModel.applyReservation(transaction, {
            warehouse_id: header.from_warehouse_id,
            item_code:    line.item_code,
            delta:        approvedQty,
          });
          totalReserved += approvedQty;

          if (approvedQty !== baseline) {
            const delta = Number((approvedQty - baseline).toFixed(4));
            await StockTransferModel._logInTx(transaction, {
              sts_id:              stsId,
              sts_no:              header.sts_no || null,
              sts_line_id:         lineId,
              event_type:          'QTY_ADJUSTED',
              from_warehouse_code: fromCode,
              to_warehouse_code:   toCode,
              item_code:           line.item_code,
              item_name:           line.item_name || null,
              uom:                 line.uom || null,
              qty_before:          baseline,
              qty_after:           approvedQty,
              qty_change:          delta,
              locator_code:        line.locator_code || null,
              actor:               username || 'System',
              actor_role:          actorRole,
              remarks:             reason,
            });
          }
        }
      }

      if (allZeroed) {
        const autoReason = 'All lines were adjusted to zero by the approver.';
        const rejReq = new sql.Request(transaction);
        rejReq.input('sts_id',           sql.BigInt,        stsId);
        rejReq.input('rejected_by',      sql.NVarChar(100), username || 'System');
        rejReq.input('rejection_reason', sql.NVarChar(500), autoReason);

        await rejReq.query(`
          UPDATE stock_transfer_slips
             SET status           = 'Rejected',
                 rejected_by      = @rejected_by,
                 rejected_at      = GETDATE(),
                 rejection_reason = @rejection_reason,
                 handler_acknowledged_at = NULL
           WHERE sts_id = @sts_id
             AND status = 'Pending'
        `);

        await StockTransferModel._logInTx(transaction, {
          sts_id:              stsId,
          sts_no:              null,
          event_type:          'REJECTED',
          from_warehouse_code: fromCode,
          to_warehouse_code:   toCode,
          actor:               username || 'System',
          actor_role:          actorRole,
          remarks:             autoReason,
        });

        await transaction.commit();

        if (header.po_no) await StockTransferModel.syncPOTransferStatus(header.po_no);

        const err = new Error(
          'All lines were adjusted to zero — the transfer was rejected.'
        );
        err.code = 'ALL_LINES_ZEROED';
        throw err;
      }

      const updReq = new sql.Request(transaction);
      updReq.input('sts_id',      sql.BigInt,        stsId);
      updReq.input('sts_no',      sql.VarChar(20),   sts_no);
      updReq.input('approved_by', sql.NVarChar(100), username || 'System');

      const result = await updReq.query(`
        UPDATE stock_transfer_slips
           SET status      = 'For Shipping',
               sts_no      = @sts_no,
               approved_by = @approved_by,
               approved_at = GETDATE()
         WHERE sts_id = @sts_id
           AND status = 'Pending'
      `);

      const affected = result.rowsAffected[0] || 0;
      if (affected === 0) {
        await transaction.rollback();
        return 0;
      }

      await StockTransferModel._logInTx(transaction, {
        sts_id:              stsId,
        sts_no,
        event_type:          'APPROVED',
        from_warehouse_code: fromCode,
        to_warehouse_code:   toCode,
        qty_change:          totalReserved,
        actor:               username || 'System',
        actor_role:          actorRole,
      });

      await transaction.commit();

      if (header.po_no) await StockTransferModel.syncPOTransferStatus(header.po_no);
      return affected;
    } catch (err) {
      try { await transaction.rollback(); } catch { /* ignore */ }
      throw err;
    }
  }

  static async rejectSTS(stsId, username, reason, actorRole = null) {
    await poolConnect;
    const header = await StockTransferModel.getSTSById(stsId);
    if (!header) return 0;

    const request = pool.request();
    request.input('sts_id',           sql.BigInt,        stsId);
    request.input('rejected_by',      sql.NVarChar(100), username || 'System');
    request.input('rejection_reason', sql.NVarChar(500), reason || null);

    const result = await request.query(`
      UPDATE stock_transfer_slips
         SET status           = 'Rejected',
             rejected_by      = @rejected_by,
             rejected_at      = GETDATE(),
             rejection_reason = @rejection_reason,
             handler_acknowledged_at = NULL
       WHERE sts_id = @sts_id
         AND status = 'Pending'
    `);

    const affected = result.rowsAffected[0] || 0;
    if (affected === 0) return 0;

    await StockTransferModel._log({
      sts_id:              stsId,
      sts_no:              header.sts_no || null,
      event_type:          'REJECTED',
      from_warehouse_code: header.from_warehouse_code || null,
      to_warehouse_code:   header.to_warehouse_code   || null,
      actor:               username || 'System',
      actor_role:          actorRole,
      remarks:             reason || null,
    });

    if (header.po_no) await StockTransferModel.syncPOTransferStatus(header.po_no);
    return 1;
  }

  static async cancelSTS(stsId, username, actorRole = null) {
    await poolConnect;
    const header = await StockTransferModel.getSTSById(stsId);
    if (!header) return 0;

    const request = pool.request();
    request.input('sts_id',       sql.BigInt,        stsId);
    request.input('submitted_by', sql.NVarChar(100), username);

    const result = await request.query(`
      UPDATE stock_transfer_slips
         SET status = 'Cancelled'
       WHERE sts_id = @sts_id
         AND status = 'Pending'
         AND submitted_by = @submitted_by
    `);

    const affected = result.rowsAffected[0] || 0;
    if (affected === 0) return 0;

    await StockTransferModel._log({
      sts_id:              stsId,
      sts_no:              header.sts_no || null,
      event_type:          'CANCELLED',
      from_warehouse_code: header.from_warehouse_code || null,
      to_warehouse_code:   header.to_warehouse_code   || null,
      actor:               username || 'System',
      actor_role:          actorRole,
    });

    if (header.po_no) await StockTransferModel.syncPOTransferStatus(header.po_no);
    return 1;
  }

  static async acknowledgeRejection(stsId, username) {
    await poolConnect;

    const request = pool.request();
    request.input('sts_id',       sql.BigInt,        Number(stsId));
    request.input('submitted_by', sql.NVarChar(100), String(username || '').trim());

    const result = await request.query(`
      UPDATE stock_transfer_slips
         SET handler_acknowledged_at = GETDATE()
       WHERE sts_id = @sts_id
         AND status = 'Rejected'
         AND submitted_by = @submitted_by
         AND handler_acknowledged_at IS NULL
    `);

    return result.rowsAffected[0] || 0;
  }

  /* ------------------------------------------------------------
     shipSTS — uses approved_qty when present (unchanged)
     ------------------------------------------------------------ */
  static async shipSTS(stsId, username, remarks = null, source_locator_code = null, actorRole = null) {
    await poolConnect;

    const header = await StockTransferModel.getSTSById(stsId);
    if (!header) return 0;

    let finalSourceLocator = null;
    if (source_locator_code && String(source_locator_code).trim()) {
      const code = String(source_locator_code).trim();

      const whCode = header.from_warehouse_code != null
        ? String(header.from_warehouse_code).trim()
        : '';

      if (!whCode) {
        throw new Error('Source warehouse could not be resolved for this transfer.');
      }

      const locReq = pool.request();
      locReq.input('loc', sql.NVarChar(100), code);
      locReq.input('wh',  sql.NVarChar(40),  whCode);
      const locRes = await locReq.query(`
        SELECT locator_code, ISNULL(locator_type, 'Regular') AS locator_type, status
          FROM locator_table
         WHERE locator_code = @loc
           AND warehouse_code = @wh
      `);
      const loc = locRes.recordset[0];
      if (!loc) {
        throw new Error(
          `Source locator "${code}" not found in warehouse ${whCode}.`
        );
      }
      if (loc.status !== 'Active') {
        throw new Error(`Source locator "${code}" is not active.`);
      }
      if (loc.locator_type === 'Damage') {
        throw new Error(
          `Source locator "${code}" is a DAMAGE locator — you cannot ship from it.`
        );
      }
      finalSourceLocator = loc.locator_code;
    }

    const lines = await StockTransferModel.getSTSLines(stsId);

    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    try {
      const lockReq = new sql.Request(transaction);
      lockReq.input('sts_id', sql.BigInt, stsId);
      const lockRes = await lockReq.query(`
        SELECT status FROM stock_transfer_slips WITH (UPDLOCK, ROWLOCK)
         WHERE sts_id = @sts_id
      `);
      const currentStatus = lockRes.recordset[0]?.status;
      if (currentStatus !== 'For Shipping') {
        await transaction.rollback();
        return 0;
      }

      const fromCode = header.from_warehouse_code != null
        ? String(header.from_warehouse_code).trim()
        : null;
      const toCode   = header.to_warehouse_code != null
        ? String(header.to_warehouse_code).trim()
        : null;
      const refNo    = header.sts_no || `DRAFT-${stsId}`;

      const fromWhCode = header.from_warehouse_code != null
        ? String(header.from_warehouse_code).trim()
        : '';

      for (const line of lines) {
        const approvedQty = Number(
          line.approved_qty ?? line.requested_qty ?? line.qty
        ) || 0;
        if (approvedQty <= 0) continue;

        const unitCost = Number(line.unit_price) || 0;

        await WarehouseInventoryModel.applyMovement(transaction, {
          warehouse_id:   header.from_warehouse_id,
          item_code:      line.item_code,
          item_name:      line.item_name || null,
          uom:            line.uom || null,
          movement_type:  'TransferOut',
          qty_change:     -approvedQty,
          unit_cost:      unitCost,
          reference_type: 'STS',
          reference_id:   stsId,
          reference_no:   refNo,
          actor:          username || 'System',
          remarks:        `Shipped STS ${refNo} @ ${unitCost}`,
        });

        await WarehouseInventoryModel.applyReservation(transaction, {
          warehouse_id: header.from_warehouse_id,
          item_code:    line.item_code,
          delta:        -approvedQty,
        });

        if (finalSourceLocator && fromWhCode) {
          const locGetReq = new sql.Request(transaction);
          locGetReq.input('wh',  sql.NVarChar(20), fromWhCode);
          locGetReq.input('it',  sql.NVarChar(50), line.item_code);
          locGetReq.input('loc', sql.NVarChar(50), finalSourceLocator);
          const locGetRes = await locGetReq.query(`
            SELECT qty, avg_unit_cost, total_value
              FROM inventory_locator WITH (UPDLOCK, ROWLOCK)
             WHERE warehouse_code = @wh
               AND item_code      = @it
               AND locator_code   = @loc
          `);
          const locRow = locGetRes.recordset[0];
          if (!locRow) {
            throw new Error(
              `Source locator "${finalSourceLocator}" does not hold ${line.item_code}.`
            );
          }

          const locQty = Number(locRow.qty) || 0;
          if (locQty < approvedQty) {
            throw new Error(
              `Insufficient stock in source locator "${finalSourceLocator}" for ${line.item_code}: ` +
              `locator has ${locQty}, need ${approvedQty}.`
            );
          }

          const locAvg    = Number(locRow.avg_unit_cost) || 0;
          const newLocQty = locQty - approvedQty;
          const newLocVal = Number((newLocQty * locAvg).toFixed(4));

          const locUpdReq = new sql.Request(transaction);
          locUpdReq.input('wh',  sql.NVarChar(20),  fromWhCode);
          locUpdReq.input('it',  sql.NVarChar(50),  line.item_code);
          locUpdReq.input('loc', sql.NVarChar(50),  finalSourceLocator);
          locUpdReq.input('q',   sql.Decimal(18,4), newLocQty);
          locUpdReq.input('v',   sql.Decimal(18,4), newLocVal);
          await locUpdReq.query(`
            UPDATE inventory_locator
               SET qty         = @q,
                   total_value = @v,
                   updated_at  = GETDATE()
             WHERE warehouse_code = @wh
               AND item_code      = @it
               AND locator_code   = @loc
          `);
        } else {
          console.warn(
            `⚠️  STS ${refNo} shipped without a source locator — ` +
            `inventory_locator has NOT been decremented for ${line.item_code} × ${approvedQty}.`
          );
        }

        await StockTransferModel._logInTx(transaction, {
          sts_id:              stsId,
          sts_no:              header.sts_no || null,
          sts_line_id:         line.sts_line_id,
          event_type:          'SHIPPED',
          from_warehouse_code: fromCode,
          to_warehouse_code:   toCode,
          item_code:           line.item_code,
          item_name:           line.item_name || null,
          uom:                 line.uom || null,
          qty_before:          Number(line.qty) || 0,
          qty_after:           approvedQty,
          qty_change:          -approvedQty,
          locator_code:        finalSourceLocator,
          actor:               username || 'System',
          actor_role:          actorRole,
          remarks:             remarks ? String(remarks).trim() : null,
        });
      }

      const headerReq = new sql.Request(transaction);
      headerReq.input('sts_id',              sql.BigInt,        stsId);
      headerReq.input('shipped_by',          sql.NVarChar(100), username || 'System');
      headerReq.input('source_locator_code', sql.NVarChar(100), finalSourceLocator);

      const result = await headerReq.query(`
        UPDATE stock_transfer_slips
           SET status               = 'In-Transit',
               shipped_by           = @shipped_by,
               shipped_at           = GETDATE(),
               source_locator_code  = @source_locator_code
         WHERE sts_id = @sts_id
           AND status = 'For Shipping'
      `);

      const affected = result.rowsAffected[0] || 0;
      if (affected === 0) {
        await transaction.rollback();
        return 0;
      }

      await transaction.commit();

      if (header.po_no) await StockTransferModel.syncPOTransferStatus(header.po_no);
      return affected;
    } catch (err) {
      try { await transaction.rollback(); } catch { /* ignore */ }
      throw err;
    }
  }

  static async completeSTS(stsId, username, actorRole = null) {
    await poolConnect;

    const stsReq = pool.request();
    stsReq.input('sts_id',       sql.BigInt,        stsId);
    stsReq.input('completed_by', sql.NVarChar(100), username || 'System');

    const stsResult = await stsReq.query(`
      UPDATE stock_transfer_slips
         SET status       = 'Completed',
             completed_by = @completed_by,
             completed_at = GETDATE()
       WHERE sts_id = @sts_id
         AND status IN ('In-Transit', 'Received')
    `);

    const affected = stsResult.rowsAffected[0] || 0;
    if (affected === 0) return 0;

    const header = await StockTransferModel.getSTSById(stsId);

    await StockTransferModel._log({
      sts_id:              stsId,
      sts_no:              header?.sts_no || null,
      event_type:          'COMPLETED',
      from_warehouse_code: header?.from_warehouse_code || null,
      to_warehouse_code:   header?.to_warehouse_code   || null,
      actor:               username || 'System',
      actor_role:          actorRole,
    });

    if (header?.po_no) await StockTransferModel.syncPOTransferStatus(header.po_no);
    return affected;
  }

  static async receiveSTSWithLines(stsId, username, remarks, lines = [], actorRole = null) {
    await poolConnect;

    const header = await StockTransferModel.getSTSById(stsId);
    if (!header) throw new Error('STS not found.');
    if (header.status !== 'In-Transit') {
      throw new Error('STS must be in In-Transit status to receive.');
    }

    const isRequested = header.request_origin === 'Requested';

    const dbLines = await StockTransferModel.getSTSLines(stsId);
    const dbById = new Map(dbLines.map((l) => [Number(l.sts_line_id), l]));

    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    try {
      let allAccounted = true;
      let damageLocatorCode = null;

      const fromCode = header.from_warehouse_code || null;
      const toCode   = header.to_warehouse_code   || null;

      for (const input of lines) {
        const lineId = Number(input.sts_line_id);
        const dbLine = dbById.get(lineId);
        if (!dbLine) throw new Error(`Line ${lineId} not found on STS ${header.sts_no}.`);

        const received = Number(input.received_qty) || 0;
        const damaged  = Number(input.damaged_qty)  || 0;
        const reason   = input.damage_reason ? String(input.damage_reason).trim() : null;
const sent     = Number(dbLine.approved_qty ?? dbLine.requested_qty ?? dbLine.qty) || 0;
        const good     = received - damaged;
        const unitCost = Number(dbLine.unit_price) || 0;

        if (received < 0 || damaged < 0) {
          throw new Error(`Line ${lineId}: quantities cannot be negative.`);
        }
        if (received > sent) {
          throw new Error(
            `Line ${lineId}: received (${received}) cannot exceed sent qty (${sent}).`
          );
        }
        if (damaged > received) {
          throw new Error(
            `Line ${lineId}: damaged (${damaged}) cannot exceed received (${received}).`
          );
        }
        if (damaged > 0 && !reason) {
          throw new Error(`Line ${lineId}: damage_reason required when damaged_qty > 0.`);
        }

        if (good > 0) {
          await WarehouseInventoryModel.applyMovement(transaction, {
            warehouse_id:   header.to_warehouse_id,
            item_code:      dbLine.item_code,
            item_name:      dbLine.item_name || null,
            uom:            dbLine.uom || null,
            movement_type:  'TransferIn',
            qty_change:     good,
            unit_cost:      unitCost,
            reference_type: 'STS',
            reference_id:   stsId,
            reference_no:   header.sts_no,
            actor:          username || 'System',
            remarks:        isRequested
              ? `Received requested transfer ${header.sts_no} @ ${unitCost}`
              : `Received STS ${header.sts_no} (pending store) @ ${unitCost}`,
          });
        }

        if (isRequested && good > 0) {
          const targetLoc = dbLine.locator_code;
          if (!targetLoc) {
            throw new Error(
              `Line ${lineId}: target locator was not set on the request.`
            );
          }

          const locCheckReq = new sql.Request(transaction);
          locCheckReq.input('loc', sql.NVarChar(50), targetLoc);
          locCheckReq.input('wh',  sql.NVarChar(40), header.to_warehouse_code);
          const locCheckRes = await locCheckReq.query(`
            SELECT locator_code, ISNULL(locator_type, 'Regular') AS locator_type, status
              FROM locator_table
             WHERE locator_code = @loc
               AND warehouse_code = @wh
          `);
          const targetLocRow = locCheckRes.recordset[0];
          if (!targetLocRow || targetLocRow.status !== 'Active') {
            throw new Error(
              `Line ${lineId}: target locator "${targetLoc}" is no longer valid at ${header.to_warehouse_code}.`
            );
          }
          if (targetLocRow.locator_type === 'Damage') {
            throw new Error(
              `Line ${lineId}: target locator "${targetLoc}" is a DAMAGE locator.`
            );
          }

          const ilGetReq = new sql.Request(transaction);
          ilGetReq.input('wh',  sql.NVarChar(40), header.to_warehouse_code);
          ilGetReq.input('it',  sql.NVarChar(50), dbLine.item_code);
          ilGetReq.input('loc', sql.NVarChar(50), targetLoc);
          const ilGetRes = await ilGetReq.query(`
            SELECT qty, avg_unit_cost, total_value
              FROM inventory_locator
             WHERE warehouse_code = @wh
               AND item_code      = @it
               AND locator_code   = @loc
          `);

          const curQty = Number(ilGetRes.recordset[0]?.qty)          || 0;
          const curAvg = Number(ilGetRes.recordset[0]?.avg_unit_cost) || 0;
          const newQty = curQty + good;
          const newVal = (curQty * curAvg) + (good * unitCost);
          const newAvg = newQty > 0 ? Number((newVal / newQty).toFixed(6)) : 0;
          const newTot = Number((newQty * newAvg).toFixed(4));

          if (ilGetRes.recordset[0]) {
            const ilUpdReq = new sql.Request(transaction);
            ilUpdReq.input('wh',  sql.NVarChar(40),  header.to_warehouse_code);
            ilUpdReq.input('it',  sql.NVarChar(50),  dbLine.item_code);
            ilUpdReq.input('loc', sql.NVarChar(50),  targetLoc);
            ilUpdReq.input('q',   sql.Decimal(18,4), newQty);
            ilUpdReq.input('a',   sql.Decimal(18,6), newAvg);
            ilUpdReq.input('v',   sql.Decimal(18,4), newTot);
            await ilUpdReq.query(`
              UPDATE inventory_locator
                 SET qty           = @q,
                     avg_unit_cost = @a,
                     total_value   = @v,
                     updated_at    = GETDATE()
               WHERE warehouse_code = @wh
                 AND item_code      = @it
                 AND locator_code   = @loc
            `);
          } else {
            const ilInsReq = new sql.Request(transaction);
            ilInsReq.input('wh',  sql.NVarChar(40),  header.to_warehouse_code);
            ilInsReq.input('it',  sql.NVarChar(50),  dbLine.item_code);
            ilInsReq.input('loc', sql.NVarChar(50),  targetLoc);
            ilInsReq.input('q',   sql.Decimal(18,4), newQty);
            ilInsReq.input('a',   sql.Decimal(18,6), newAvg);
            ilInsReq.input('v',   sql.Decimal(18,4), newTot);
            await ilInsReq.query(`
              INSERT INTO inventory_locator
                (warehouse_code, item_code, locator_code, qty,
                 avg_unit_cost, total_value, created_at, updated_at)
              VALUES
                (@wh, @it, @loc, @q, @a, @v, GETDATE(), GETDATE())
            `);
          }
        }

        if (damaged > 0) {
          if (!damageLocatorCode) {
            damageLocatorCode = await StockTransferModel._ensureDamageLocator(
              transaction,
              header.to_warehouse_code
            );
          }

          const locGetReq = new sql.Request(transaction);
          locGetReq.input('wh',  sql.NVarChar(20), header.to_warehouse_code);
          locGetReq.input('it',  sql.NVarChar(50), dbLine.item_code);
          locGetReq.input('loc', sql.NVarChar(50), damageLocatorCode);

          const locGetRes = await locGetReq.query(`
            SELECT qty, avg_unit_cost, total_value
              FROM inventory_locator
             WHERE warehouse_code = @wh
               AND item_code      = @it
               AND locator_code   = @loc
          `);

          const curQty = Number(locGetRes.recordset[0]?.qty)          || 0;
          const curAvg = Number(locGetRes.recordset[0]?.avg_unit_cost) || 0;
          const newQty = curQty + damaged;
          const newVal = (curQty * curAvg) + (damaged * unitCost);
          const newAvg = newQty > 0 ? Number((newVal / newQty).toFixed(6)) : 0;
          const newTot = Number((newQty * newAvg).toFixed(4));

          if (locGetRes.recordset[0]) {
            const locUpdReq = new sql.Request(transaction);
            locUpdReq.input('wh',  sql.NVarChar(20),  header.to_warehouse_code);
            locUpdReq.input('it',  sql.NVarChar(50),  dbLine.item_code);
            locUpdReq.input('loc', sql.NVarChar(50),  damageLocatorCode);
            locUpdReq.input('q',   sql.Decimal(18,4), newQty);
            locUpdReq.input('a',   sql.Decimal(18,6), newAvg);
            locUpdReq.input('v',   sql.Decimal(18,4), newTot);
            await locUpdReq.query(`
              UPDATE inventory_locator
                 SET qty           = @q,
                     avg_unit_cost = @a,
                     total_value   = @v,
                     updated_at    = GETDATE()
               WHERE warehouse_code = @wh
                 AND item_code      = @it
                 AND locator_code   = @loc
            `);
          } else {
            const locInsReq = new sql.Request(transaction);
            locInsReq.input('wh',  sql.NVarChar(20),  header.to_warehouse_code);
            locInsReq.input('it',  sql.NVarChar(50),  dbLine.item_code);
            locInsReq.input('loc', sql.NVarChar(50),  damageLocatorCode);
            locInsReq.input('q',   sql.Decimal(18,4), newQty);
            locInsReq.input('a',   sql.Decimal(18,6), newAvg);
            locInsReq.input('v',   sql.Decimal(18,4), newTot);
            await locInsReq.query(`
              INSERT INTO inventory_locator
                (warehouse_code, item_code, locator_code, qty,
                 avg_unit_cost, total_value, created_at, updated_at)
              VALUES
                (@wh, @it, @loc, @q, @a, @v, GETDATE(), GETDATE())
            `);
          }

          await DamagedItemsModel.record(transaction, {
            source_type:    'STS',
            source_id:      stsId,
            source_ref:     header.sts_no,
            line_ref:       lineId,
            item_code:      dbLine.item_code,
            item_name:      dbLine.item_name || null,
            warehouse_id:   header.to_warehouse_id,
            warehouse_code: header.to_warehouse_code,
            locator_code:   damageLocatorCode,
            qty:            damaged,
            unit_cost:      unitCost,
            currency:       'PHP',
            reason,
            actor:          username || 'System',
          });
        }

        const updReq = new sql.Request(transaction);
        updReq.input('sts_line_id',   sql.BigInt,        lineId);
        updReq.input('received_qty',  sql.Decimal(18,4), received);
        updReq.input('damaged_qty',   sql.Decimal(18,4), damaged);
        updReq.input('damage_reason', sql.NVarChar(500), reason);
        updReq.input('stored_qty',    sql.Decimal(18,4), isRequested ? good : 0);

        if (isRequested) {
          await updReq.query(`
            UPDATE stock_transfer_slip_lines
               SET received_qty  = @received_qty,
                   damaged_qty   = @damaged_qty,
                   damage_reason = @damage_reason,
                   stored_qty    = @stored_qty,
                   received_at   = GETDATE()
             WHERE sts_line_id = @sts_line_id
          `);
        } else {
          await updReq.query(`
            UPDATE stock_transfer_slip_lines
               SET received_qty  = @received_qty,
                   damaged_qty   = @damaged_qty,
                   damage_reason = @damage_reason,
                   received_at   = GETDATE()
             WHERE sts_line_id = @sts_line_id
          `);
        }

        await StockTransferModel._logInTx(transaction, {
          sts_id:              stsId,
          sts_no:              header.sts_no || null,
          sts_line_id:         lineId,
          event_type:          'RECEIVED',
          from_warehouse_code: fromCode,
          to_warehouse_code:   toCode,
          item_code:           dbLine.item_code,
          item_name:           dbLine.item_name || null,
          uom:                 dbLine.uom || null,
          qty_before:          sent,
          qty_after:           received,
          qty_change:          good,
          locator_code:        isRequested ? (dbLine.locator_code || null) : damageLocatorCode,
          actor:               username || 'System',
          actor_role:          actorRole,
          remarks:             damaged > 0
            ? `Received ${received} (${good} good, ${damaged} damaged${reason ? ` — ${reason}` : ''})`
            : null,
        });

        if (received < sent) allAccounted = false;
      }

      for (const dbLine of dbLines) {
        const supplied = lines.find((l) => Number(l.sts_line_id) === Number(dbLine.sts_line_id));
        if (!supplied) allAccounted = false;
      }

      const nextStatus = allAccounted ? 'Completed' : 'Received';

      const headerReq = new sql.Request(transaction);
      headerReq.input('sts_id',          sql.BigInt,        stsId);
      headerReq.input('status',          sql.VarChar(20),   nextStatus);
      headerReq.input('received_by',     sql.NVarChar(100), username || 'System');
      headerReq.input('receive_remarks', sql.NVarChar(500), remarks || null);

      await headerReq.query(`
        UPDATE stock_transfer_slips
           SET status          = @status,
               received_by     = @received_by,
               received_at     = GETDATE(),
               receive_remarks = @receive_remarks
         WHERE sts_id = @sts_id
      `);

      await transaction.commit();
    } catch (err) {
      try { await transaction.rollback(); } catch { /* ignore */ }
      throw err;
    }

    if (header.po_no) await StockTransferModel.syncPOTransferStatus(header.po_no);
    return 1;
  }

  /* ============================================================
     STORED-TRANSFER HELPERS
     ============================================================ */

  static async listReceivedForStore({
    to_warehouse_id,
    search,
    page = 1,
    limit = 50,
  } = {}) {
    await poolConnect;

    const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 500);
    const safePage  = Math.max(Number(page) || 1, 1);

    if (!to_warehouse_id) {
      return { rows: [], total: 0, page: 1, limit: safeLimit };
    }

    const applyFilters = (request) => {
      request.input('to_warehouse_id', sql.Int, Number(to_warehouse_id));

      const conditions = [
        `s.to_warehouse_id = @to_warehouse_id`,
        `s.status IN ('Received', 'Completed')`,
        `ISNULL(l.received_qty, 0) > 0`,
        `ISNULL(l.stored_qty, 0) < (ISNULL(l.received_qty, 0) - ISNULL(l.damaged_qty, 0))`,
      ];

      if (search && String(search).trim()) {
        request.input('search', sql.NVarChar(100), `%${String(search).trim()}%`);
        conditions.push(
          '(s.sts_no LIKE @search OR s.po_no LIKE @search OR l.item_code LIKE @search ' +
          'OR l.item_name LIKE @search OR im.Item_Description LIKE @search ' +
          'OR im.Barcode LIKE @search)'
        );
      }

      return `WHERE ${conditions.join(' AND ')}`;
    };

    const countReq   = pool.request();
    const countWhere = applyFilters(countReq);
    const countRes   = await countReq.query(`
      SELECT COUNT(*) AS total
        FROM stock_transfer_slip_lines l
        INNER JOIN stock_transfer_slips s ON s.sts_id = l.sts_id
        LEFT JOIN item_master im ON im.Item_Code = l.item_code
        ${countWhere}
    `);
    const total = Number(countRes.recordset[0]?.total) || 0;

    const totalPages    = Math.max(Math.ceil(total / safeLimit), 1);
    const effectivePage = Math.min(safePage, totalPages);
    const offset        = (effectivePage - 1) * safeLimit;

    const dataReq = pool.request();
    const dataWhere = applyFilters(dataReq);
    dataReq.input('limit',  sql.Int, safeLimit);
    dataReq.input('offset', sql.Int, offset);

    const dataRes = await dataReq.query(`
      SELECT
             l.sts_line_id,
             l.sts_id,
             l.line_no,
             l.item_code,
             ISNULL(im.Item_Description, l.item_name) AS item_name,
             ISNULL(im.Uom_Code,         l.uom)       AS uom,
             im.Uom_Description                        AS uom_description,
             im.Barcode                                AS barcode,
             CAST(im.Gl_Class AS NVARCHAR(50))         AS gl_class_code,
             im.Gl_Description                         AS gl_description,
             im.Purchase_Class                         AS purchase_class,
             im.Category                               AS category,
             l.qty,
             l.requested_qty,
             l.approved_qty,
             ISNULL(l.received_qty, 0)                 AS received_qty,
             ISNULL(l.damaged_qty,  0)                 AS damaged_qty,
             ISNULL(l.stored_qty,   0)                 AS stored_qty,
             l.unit_price,
             l.currency,
             s.sts_no,
             s.po_no,
             s.status       AS sts_status,
             s.request_origin,
             s.from_warehouse_id,
             s.to_warehouse_id,
             s.from_warehouse_code,
             s.to_warehouse_code,
             fw.warehouse_name AS from_warehouse_name,
             tw.warehouse_name AS to_warehouse_name,
             s.received_by,
             s.received_at,
             s.transfer_date,
             s.submitted_by,
             s.submitted_at
        FROM stock_transfer_slip_lines l
        INNER JOIN stock_transfer_slips s ON s.sts_id = l.sts_id
        LEFT JOIN warehouse_table fw ON fw.warehouse_id = s.from_warehouse_id
        LEFT JOIN warehouse_table tw ON tw.warehouse_id = s.to_warehouse_id
        LEFT JOIN item_master im ON im.Item_Code = l.item_code
        ${dataWhere}
       ORDER BY s.received_at DESC, s.submitted_at DESC, l.line_no ASC, l.sts_line_id ASC
       OFFSET @offset ROWS
       FETCH NEXT @limit ROWS ONLY
    `);

    return {
      rows: (dataRes.recordset || []).map((r) => ({
        ...r,
        sts_line_id:  Number(r.sts_line_id),
        sts_id:       Number(r.sts_id),
        qty:          Number(r.qty) || 0,
        requested_qty: r.requested_qty != null ? Number(r.requested_qty) : null,
        approved_qty:  r.approved_qty  != null ? Number(r.approved_qty)  : null,
        received_qty: Number(r.received_qty) || 0,
        damaged_qty:  Number(r.damaged_qty) || 0,
        stored_qty:   Number(r.stored_qty) || 0,
      })),
      total,
      page:  effectivePage,
      limit: safeLimit,
    };
  }

  static async getLineForAuthorization(stsLineId) {
    await poolConnect;
    const request = pool.request();
    request.input('sts_line_id', sql.BigInt, Number(stsLineId));

    const result = await request.query(`
      SELECT l.sts_line_id, l.sts_id, l.item_code, l.item_name,
             ISNULL(l.received_qty, 0) AS received_qty,
             ISNULL(l.damaged_qty, 0)  AS damaged_qty,
             ISNULL(l.stored_qty, 0)   AS stored_qty,
             l.unit_price, l.currency,
             s.sts_no, s.to_warehouse_id, s.status AS sts_status,
             s.request_origin
        FROM stock_transfer_slip_lines l
        INNER JOIN stock_transfer_slips s ON s.sts_id = l.sts_id
       WHERE l.sts_line_id = @sts_line_id
    `);
    return result.recordset[0] || null;
  }

  static async storeTransferLine(stsLineId, { qty_to_store, locator_code, remarks, actor, actor_role = null }) {
    await poolConnect;

    const q = Number(qty_to_store);
    if (!Number.isFinite(q) || q <= 0) {
      throw new Error('qty_to_store must be greater than 0.');
    }

    const line = await StockTransferModel.getLineForAuthorization(stsLineId);
    if (!line) throw new Error('STS line not found.');
    if (!['Received', 'Completed'].includes(line.sts_status)) {
      throw new Error(`Cannot store: slip status is "${line.sts_status}". Expected Received/Completed.`);
    }
    if (!locator_code || !String(locator_code).trim()) {
      throw new Error('locator_code is required.');
    }

    const whReq = pool.request();
    whReq.input('warehouse_id', sql.Int, Number(line.to_warehouse_id));
    const whRes = await whReq.query(
      `SELECT warehouse_code FROM warehouse_table WHERE warehouse_id = @warehouse_id`
    );
    if (!whRes.recordset[0]) throw new Error('Destination warehouse not found.');
    const destinationWarehouseCode = whRes.recordset[0].warehouse_code;

    const available =
      Number(line.received_qty) - Number(line.damaged_qty) - Number(line.stored_qty);

    if (available <= 0) throw new Error('Nothing left to store on this line.');
    if (q > available) {
      throw new Error(
        `Cannot store ${q}: only ${available} available ` +
        `(received ${line.received_qty}, damaged ${line.damaged_qty}, stored ${line.stored_qty}).`
      );
    }

    const locReq = pool.request();
    locReq.input('wh',  sql.NVarChar(20), destinationWarehouseCode);
    locReq.input('loc', sql.NVarChar(50), String(locator_code).trim());
    const locRes = await locReq.query(`
      SELECT locator_code, ISNULL(locator_type, 'Regular') AS locator_type
        FROM locator_table
       WHERE warehouse_code = @wh
         AND locator_code   = @loc
         AND status = 'Active'
    `);
    if (!locRes.recordset[0]) {
      throw new Error(
        `Locator "${locator_code}" not found or inactive for warehouse ${destinationWarehouseCode}.`
      );
    }
    if (locRes.recordset[0].locator_type === 'Damage') {
      throw new Error(
        `Locator "${locator_code}" is a DAMAGE locator — you cannot store good units into it.`
      );
    }
    const finalLocatorCode = locRes.recordset[0].locator_code;

    const unitCost = Number(line.unit_price) || 0;

    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    try {
      const getLocReq = new sql.Request(transaction);
      getLocReq.input('wh',  sql.NVarChar(20), destinationWarehouseCode);
      getLocReq.input('it',  sql.NVarChar(50), line.item_code);
      getLocReq.input('loc', sql.NVarChar(50), finalLocatorCode);

      const getLocRes = await getLocReq.query(`
        SELECT qty, avg_unit_cost, total_value
          FROM inventory_locator
         WHERE warehouse_code = @wh
           AND item_code      = @it
           AND locator_code   = @loc
      `);

      const curQty = Number(getLocRes.recordset[0]?.qty)          || 0;
      const curAvg = Number(getLocRes.recordset[0]?.avg_unit_cost) || 0;
      const newQty = curQty + q;
      const newVal = (curQty * curAvg) + (q * unitCost);
      const newAvg = newQty > 0 ? Number((newVal / newQty).toFixed(6)) : 0;
      const newTot = Number((newQty * newAvg).toFixed(4));

      if (getLocRes.recordset[0]) {
        const updLocReq = new sql.Request(transaction);
        updLocReq.input('wh',  sql.NVarChar(20),  destinationWarehouseCode);
        updLocReq.input('it',  sql.NVarChar(50),  line.item_code);
        updLocReq.input('loc', sql.NVarChar(50),  finalLocatorCode);
        updLocReq.input('q',   sql.Decimal(18,4), newQty);
        updLocReq.input('a',   sql.Decimal(18,6), newAvg);
        updLocReq.input('v',   sql.Decimal(18,4), newTot);
        await updLocReq.query(`
          UPDATE inventory_locator
             SET qty           = @q,
                 avg_unit_cost = @a,
                 total_value   = @v,
                 updated_at    = GETDATE()
           WHERE warehouse_code = @wh
             AND item_code      = @it
             AND locator_code   = @loc
        `);
      } else {
        const insLocReq = new sql.Request(transaction);
        insLocReq.input('wh',  sql.NVarChar(20),  destinationWarehouseCode);
        insLocReq.input('it',  sql.NVarChar(50),  line.item_code);
        insLocReq.input('loc', sql.NVarChar(50),  finalLocatorCode);
        insLocReq.input('q',   sql.Decimal(18,4), newQty);
        insLocReq.input('a',   sql.Decimal(18,6), newAvg);
        insLocReq.input('v',   sql.Decimal(18,4), newTot);
        await insLocReq.query(`
          INSERT INTO inventory_locator
            (warehouse_code, item_code, locator_code, qty,
             avg_unit_cost, total_value, created_at, updated_at)
          VALUES
            (@wh, @it, @loc, @q, @a, @v, GETDATE(), GETDATE())
        `);
      }

      const updReq = new sql.Request(transaction);
      updReq.input('sts_line_id', sql.BigInt,        Number(stsLineId));
      updReq.input('q',           sql.Decimal(18,4), q);
      updReq.input('loc',         sql.NVarChar(50),  finalLocatorCode);

      await updReq.query(`
        UPDATE stock_transfer_slip_lines
           SET stored_qty   = ISNULL(stored_qty, 0) + @q,
               locator_code = @loc
         WHERE sts_line_id = @sts_line_id
      `);

      const dbHeader = await StockTransferModel.getSTSById(line.sts_id);

      await StockTransferModel._logInTx(transaction, {
        sts_id:              line.sts_id,
        sts_no:              line.sts_no || null,
        sts_line_id:         Number(stsLineId),
        event_type:          'STORE_LINE',
        from_warehouse_code: dbHeader?.from_warehouse_code || null,
        to_warehouse_code:   destinationWarehouseCode,
        item_code:           line.item_code,
        item_name:           line.item_name || null,
        qty_before:          Number(line.stored_qty) || 0,
        qty_after:           (Number(line.stored_qty) || 0) + q,
        qty_change:          q,
        locator_code:        finalLocatorCode,
        actor:               actor || 'System',
        actor_role,
        remarks:             remarks ? String(remarks).trim() : null,
      });

      await transaction.commit();
    } catch (err) {
      try { await transaction.rollback(); } catch { /* ignore */ }
      throw err;
    }

    return {
      sts_line_id:  Number(stsLineId),
      sts_no:       line.sts_no,
      item_code:    line.item_code,
      item_name:    line.item_name,
      qty_stored:   q,
      unit_cost:    unitCost,
      total_value:  Number((q * unitCost).toFixed(4)),
      locator_code: finalLocatorCode,
    };
  }

  /* ============================================================
     DASHBOARD COUNTS
     ============================================================ */

  static async getSummaryCounts({ submitted_by, warehouse_id } = {}) {
    await poolConnect;
    const request = pool.request();
    const conditions = [];

    if (submitted_by) {
      request.input('submitted_by', sql.NVarChar(100), submitted_by);
      conditions.push('submitted_by = @submitted_by');
    }
    if (warehouse_id) {
      request.input('warehouse_id', sql.Int, Number(warehouse_id));
      conditions.push('(from_warehouse_id = @warehouse_id OR to_warehouse_id = @warehouse_id)');
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await request.query(`
      SELECT
        SUM(CASE WHEN status = 'Pending'      THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN status = 'For Shipping' THEN 1 ELSE 0 END) AS for_shipping,
        SUM(CASE WHEN status = 'In-Transit'   THEN 1 ELSE 0 END) AS approved,
        SUM(CASE WHEN status = 'Rejected'     THEN 1 ELSE 0 END) AS rejected,
        SUM(CASE WHEN status = 'Completed'    THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN status = 'Cancelled'    THEN 1 ELSE 0 END) AS cancelled,
        SUM(CASE WHEN status = 'Received'     THEN 1 ELSE 0 END) AS received,
        COUNT(*) AS total
      FROM stock_transfer_slips
      ${where}
    `);

    return result.recordset[0] || {
      pending: 0, for_shipping: 0, approved: 0, rejected: 0,
      completed: 0, cancelled: 0, received: 0, total: 0,
    };
  }

  static async getHandlerActionCounts({ warehouse_id, submitted_by } = {}) {
    await poolConnect;

    const whId = warehouse_id != null && warehouse_id !== ''
      ? Number(warehouse_id)
      : null;
    const user = submitted_by && String(submitted_by).trim()
      ? String(submitted_by).trim()
      : null;

    if (!whId && !user) {
      return {
        for_shipping:     0,
        in_transit_to_me: 0,
        rejections:       0,
        total:            0,
      };
    }

    const request = pool.request();
    const parts = [];

    if (whId) {
      request.input('warehouse_id', sql.Int, whId);
      parts.push("(s.status = 'For Shipping' AND s.from_warehouse_id = @warehouse_id)");
    }
    if (user) {
      request.input('submitted_by', sql.NVarChar(100), user);
      parts.push("(s.status = 'In-Transit' AND s.submitted_by = @submitted_by)");
      parts.push("(s.status = 'Rejected' AND s.submitted_by = @submitted_by AND s.handler_acknowledged_at IS NULL)");
    }

    const where = parts.length > 0 ? `WHERE ${parts.join(' OR ')}` : '';

    const result = await request.query(`
      SELECT
        SUM(CASE WHEN s.status = 'For Shipping' THEN 1 ELSE 0 END) AS for_shipping,
        SUM(CASE WHEN s.status = 'In-Transit'   THEN 1 ELSE 0 END) AS in_transit_to_me,
        SUM(CASE WHEN s.status = 'Rejected'     THEN 1 ELSE 0 END) AS rejections
        FROM stock_transfer_slips s
        ${where}
    `);

    const row = result.recordset[0] || {};
    const forShipping = Number(row.for_shipping)     || 0;
    const inTransit   = Number(row.in_transit_to_me) || 0;
    const rejections  = Number(row.rejections)       || 0;

    return {
      for_shipping:     forShipping,
      in_transit_to_me: inTransit,
      rejections:       rejections,
      total:            forShipping + inTransit + rejections,
    };
  }
}

module.exports = StockTransferModel;