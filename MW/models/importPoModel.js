// models/importPoModel.js
const { sql, pool, poolConnect } = require('../db');
const DamagedItemsModel = require('./damagedItemsModel');

const CHUNK_SIZE = 500;

const chunk = (arr, size) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

const normalizeHasPo = (raw) => {
  if (raw == null || raw === '' || raw === 'All') return null;
  if (raw === true  || raw === '1' || raw === 1)  return 1;
  if (raw === false || raw === '0' || raw === 0)  return 0;
  return null;
};

class ImportPoModel {
  /* ============================================================
     UOM CONVERSION LOOKUP
     ============================================================ */
  static async getUomConversion(itemCode) {
    await poolConnect;
    const request = pool.request();
    request.input('itemCode', sql.NVarChar(100), itemCode);
    const result = await request.query(`
      SELECT box_item_code, piece_item_code, pieces_per_box
      FROM uom_conversions
      WHERE (box_item_code = @itemCode OR piece_item_code = @itemCode) AND Status = 'Active'
    `);
    return result.recordset[0] || null;
  }

  /* ============================================================
     DAMAGE LOCATOR
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
     RECORD DAMAGED UNITS
     ============================================================ */
  static async recordDamagedUnits(tx, {
    source_type = 'PO',
    source_id   = null,
    source_ref  = null,
    line_ref    = null,
    po_no       = null,
    line_id     = null,
    item_code,
    item_name   = null,
    uom         = null,
    warehouse_id,
    warehouse_code,
    qty,
    unit_cost,
    forex       = null,
    currency    = null,
    reason      = null,
    actor,
  }) {
    const q = Number(qty);
    if (!Number.isFinite(q) || q <= 0) {
      throw new Error('recordDamagedUnits: qty must be > 0.');
    }
    if (!warehouse_id || !warehouse_code) {
      throw new Error('recordDamagedUnits: warehouse_id + warehouse_code required.');
    }
    if (!item_code) {
      throw new Error('recordDamagedUnits: item_code required.');
    }

    const ref    = source_ref || po_no || null;
    const lineId = line_ref   || line_id || null;

    const rawCost = Number(unit_cost) || 0;

    let fx = Number(forex);
    if (!Number.isFinite(fx) || fx <= 0) fx = null;

    if (fx == null && source_type === 'PO' && lineId) {
      const fxReq = new sql.Request(tx);
      fxReq.input('id', sql.BigInt, Number(lineId));
      const fxRes = await fxReq.query(`
        SELECT ISNULL(forex, 1) AS forex
          FROM import_po
         WHERE id = @id
      `);
      const dbFx = Number(fxRes.recordset[0]?.forex);
      fx = Number.isFinite(dbFx) && dbFx > 0 ? dbFx : 1;
    }
    if (fx == null) fx = 1;

    const functionalCost = Number((rawCost * fx).toFixed(6));
    const c              = functionalCost;

    const locatorCode = await ImportPoModel._ensureDamageLocator(tx, warehouse_code);

    const locGetReq = new sql.Request(tx);
    locGetReq.input('wh',  sql.NVarChar(20), warehouse_code);
    locGetReq.input('it',  sql.NVarChar(50), item_code);
    locGetReq.input('loc', sql.NVarChar(50), locatorCode);

    const locGetRes = await locGetReq.query(`
      SELECT qty, avg_unit_cost, total_value
        FROM inventory_locator
       WHERE warehouse_code = @wh
         AND item_code      = @it
         AND locator_code   = @loc
    `);

    const curQty        = Number(locGetRes.recordset[0]?.qty)          || 0;
    const curTotalValue = Number(locGetRes.recordset[0]?.total_value)  || 0;

    const newQty   = curQty + q;
    const newValue = curTotalValue + (q * c);
    const newAvg   = newQty > 0 ? newValue / newQty : 0;
    const newTot   = newValue;

    if (locGetRes.recordset[0]) {
      const locUpdReq = new sql.Request(tx);
      locUpdReq.input('wh',  sql.NVarChar(20),  warehouse_code);
      locUpdReq.input('it',  sql.NVarChar(50),  item_code);
      locUpdReq.input('loc', sql.NVarChar(50),  locatorCode);
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
      const locInsReq = new sql.Request(tx);
      locInsReq.input('wh',  sql.NVarChar(20),  warehouse_code);
      locInsReq.input('it',  sql.NVarChar(50),  item_code);
      locInsReq.input('loc', sql.NVarChar(50),  locatorCode);
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

    const writeoff = await DamagedItemsModel.record(tx, {
      source_type,
      source_id:      source_id || null,
      source_ref:     ref,
      line_ref:       lineId,
      item_code,
      item_name,
      warehouse_id,
      warehouse_code,
      locator_code:   locatorCode,
      qty:            q,
      unit_cost:      c,
      currency:       'PHP',
      reason,
      actor,
    });

    return {
      locator_code:       locatorCode,
      qty_stored_damage:  q,
      unit_cost:          c,
      forex_used:         fx,
      original_currency:  currency || null,
      total_value:        writeoff.total_value,
      writeoff_id:        writeoff.writeoff_id,
    };
  }

  /* ============================================================
     LOOKUPS
     ============================================================ */
  static async lookupItemMasters(itemCodes = []) {
    await poolConnect;
    const map = new Map();
    if (!itemCodes.length) return map;
    const unique = [...new Set(itemCodes.map(c => String(c).trim()).filter(Boolean))];
    for (const batch of chunk(unique, CHUNK_SIZE)) {
      const request = pool.request();
      const placeholders = batch
        .map((code, i) => { request.input(`c${i}`, sql.NVarChar, code); return `@c${i}`; })
        .join(',');
      const result = await request.query(`
        SELECT Item_Code, Item_Description, Uom_Code, Uom_Description,
               Barcode, Gl_Class, Gl_Description, Purchase_Class, Category
          FROM item_master
         WHERE Item_Code IN (${placeholders})
      `);
      for (const row of result.recordset) {
        map.set(String(row.Item_Code).trim(), {
          item_name:       row.Item_Description || '',
          uom:             row.Uom_Code         || '',
          uom_description: row.Uom_Description  || '',
          barcode:         row.Barcode          || '',
          gl_class_code:   row.Gl_Class != null ? String(row.Gl_Class) : '',
          gl_description:  row.Gl_Description   || '',
          purchase_class:  row.Purchase_Class   || '',
          category:        row.Category         || '',
        });
      }
    }
    return map;
  }

  static async lookupWarehouseIdsByCodes(codes = []) {
    await poolConnect;
    const map = new Map();
    if (!codes.length) return map;
    const unique = [...new Set(codes.map(c => String(c).trim()).filter(Boolean))];
    for (const batch of chunk(unique, CHUNK_SIZE)) {
      const request = pool.request();
      const placeholders = batch
        .map((c, i) => { request.input(`w${i}`, sql.NVarChar, c); return `@w${i}`; })
        .join(',');
      const result = await request.query(`
        SELECT warehouse_id, warehouse_code, status
          FROM warehouse_table
         WHERE warehouse_code IN (${placeholders})
      `);
      for (const r of result.recordset) {
        map.set(String(r.warehouse_code).trim(), {
          warehouse_id: r.warehouse_id,
          status:       r.status,
        });
      }
    }
    return map;
  }

  static async findExistingKeys(poNos = []) {
    await poolConnect;
    const set = new Set();
    if (!poNos.length) return set;
    const unique = [...new Set(poNos.map(p => String(p).trim()).filter(Boolean))];
    for (const batch of chunk(unique, CHUNK_SIZE)) {
      const request = pool.request();
      const placeholders = batch
        .map((p, i) => { request.input(`p${i}`, sql.NVarChar, p); return `@p${i}`; })
        .join(',');
      const result = await request.query(`
        SELECT po_no, item_code FROM import_po WHERE po_no IN (${placeholders})
      `);
      for (const row of result.recordset) set.add(`${row.po_no}|||${row.item_code}`);
    }
    return set;
  }

  static async findExistingPOs(poNos = []) {
    await poolConnect;
    if (!poNos.length) return [];
    const unique = [...new Set(poNos.map(p => String(p).trim()).filter(Boolean))];
    const found = new Set();
    for (const batch of chunk(unique, CHUNK_SIZE)) {
      const request = pool.request();
      const placeholders = batch
        .map((p, i) => { request.input(`p${i}`, sql.NVarChar, p); return `@p${i}`; })
        .join(',');
      const result = await request.query(`
        SELECT DISTINCT po_no FROM import_po WHERE po_no IN (${placeholders})
      `);
      result.recordset.forEach(r => found.add(r.po_no));
    }
    return [...found];
  }

  /* ============================================================
     INSERT / UPDATE
     ============================================================ */
  static async insertLine(data, tx = null) {
    await poolConnect;
    const request = tx ? new sql.Request(tx) : pool.request();

    request.input('po_date',         sql.Date,          data.po_date);
    request.input('pr_no',           sql.NVarChar,      data.pr_no || '');
    request.input('po_no',           sql.NVarChar,      data.po_no);
    request.input('has_po',          sql.Bit,           data.has_po != null ? (data.has_po ? 1 : 0) : 1);
    request.input('vendor_name',     sql.NVarChar,      data.vendor_name || '');
    request.input('item_code',       sql.NVarChar,      data.item_code);
    request.input('qty',             sql.Decimal(18,4), data.qty);
    request.input('received_qty',    sql.Decimal(18,4), data.received_qty != null ? Number(data.received_qty) : 0);
    request.input('damaged_qty',     sql.Decimal(18,4), data.damaged_qty  != null ? Number(data.damaged_qty)  : 0);
    request.input('stored_qty',      sql.Decimal(18,4), data.stored_qty   != null ? Number(data.stored_qty)   : 0);
    request.input('released_qty',    sql.Decimal(18,4), data.released_qty != null ? Number(data.released_qty) : 0);

    // NEW COLUMNS
    request.input('qty_boxes',       sql.Decimal(18,4), data.qty_boxes != null ? Number(data.qty_boxes) : 0);
    request.input('qty_loose_pieces', sql.Decimal(18,4), data.qty_loose_pieces != null ? Number(data.qty_loose_pieces) : 0);
    request.input('pieces_per_box_snapshot', sql.Decimal(18,4), data.pieces_per_box_snapshot != null ? Number(data.pieces_per_box_snapshot) : null);

    request.input('unit_price',      sql.Decimal(18,6), data.unit_price);
    request.input('currency',        sql.NVarChar,      data.currency || 'PHP');
    // ✅ forex: 3 → 4 decimals
    request.input('forex',           sql.Decimal(18,4), data.forex != null ? Number(data.forex) : 1);
    // ✅ func_amount: 3 → 4 decimals
    request.input('func_amount',     sql.Decimal(18,4), data.func_amount != null ? Number(data.func_amount) : 0);
    request.input('delivery_status', sql.NVarChar(20),  data.delivery_status || 'Complete');
    request.input('buyer',           sql.NVarChar,      data.buyer || '');
    request.input('uom',             sql.NVarChar,      data.uom || '');
    request.input('uom_description', sql.NVarChar,      data.uom_description || '');
    request.input('item_name',       sql.NVarChar,      data.item_name || '');
    request.input('barcode',         sql.NVarChar,      data.barcode || '');
    request.input('gl_class_code',   sql.NVarChar,      data.gl_class_code || '');
    request.input('gl_description',  sql.NVarChar,      data.gl_description || '');
    request.input('purchase_class',  sql.NVarChar,      data.purchase_class || '');
    request.input('category',        sql.NVarChar,      data.category || '');
    request.input('warehouse_id',    sql.BigInt,        data.warehouse_id != null && data.warehouse_id !== '' ? Number(data.warehouse_id) : null);
    request.input('warehouse_code',  sql.NVarChar,      data.warehouse_code || null);
    request.input('locator_code',    sql.NVarChar,      data.locator_code   || null);
    request.input('status',          sql.NVarChar,      data.status || 'Pending');
    request.input('source_file',     sql.NVarChar,      data.source_file || null);
    request.input('imported_by',     sql.NVarChar,      data.imported_by || 'System');
    request.input('imported_at',     sql.DateTime,      data.imported_at || new Date());
    request.input('forwarded_by',    sql.NVarChar,      data.forwarded_by || null);
    request.input('forwarded_at',    sql.DateTime,      data.forwarded_at || null);

    await request.query(`
      INSERT INTO import_po
        (po_date, pr_no, po_no, has_po, vendor_name, item_code, qty,
         received_qty, damaged_qty, stored_qty, released_qty,
         qty_boxes, qty_loose_pieces, pieces_per_box_snapshot,
         unit_price, currency, forex, func_amount, delivery_status,
         buyer, uom, uom_description, item_name, barcode,
         gl_class_code, gl_description, purchase_class, category,
         warehouse_id, warehouse_code, locator_code, status,
         source_file, imported_by, imported_at, forwarded_by, forwarded_at)
      VALUES
        (@po_date, @pr_no, @po_no, @has_po, @vendor_name, @item_code, @qty,
         @received_qty, @damaged_qty, @stored_qty, @released_qty,
         @qty_boxes, @qty_loose_pieces, @pieces_per_box_snapshot,
         @unit_price, @currency, @forex, @func_amount, @delivery_status,
         @buyer, @uom, @uom_description, @item_name, @barcode,
         @gl_class_code, @gl_description, @purchase_class, @category,
         @warehouse_id, @warehouse_code, @locator_code, @status,
         @source_file, @imported_by, @imported_at, @forwarded_by, @forwarded_at)
    `);
  }

  static async updateLine(data) {
    await poolConnect;
    const request = pool.request();

    request.input('po_date',         sql.Date,          data.po_date);
    request.input('pr_no',           sql.NVarChar,      data.pr_no || '');
    request.input('vendor_name',     sql.NVarChar,      data.vendor_name || '');
    request.input('qty',             sql.Decimal(18,4), data.qty);
    request.input('unit_price',      sql.Decimal(18,6), data.unit_price);
    request.input('currency',        sql.NVarChar,      data.currency || 'PHP');
    // ✅ forex: 3 → 4 decimals
    request.input('forex',           sql.Decimal(18,4), data.forex != null ? Number(data.forex) : 1);
    // ✅ func_amount: 3 → 4 decimals
    request.input('func_amount',     sql.Decimal(18,4), data.func_amount != null ? Number(data.func_amount) : 0);
    request.input('delivery_status', sql.NVarChar(20),  data.delivery_status || 'Complete');
    request.input('buyer',           sql.NVarChar,      data.buyer || '');
    request.input('uom',             sql.NVarChar,      data.uom || '');
    request.input('uom_description', sql.NVarChar,      data.uom_description || '');
    request.input('item_name',       sql.NVarChar,      data.item_name || '');
    request.input('barcode',         sql.NVarChar,      data.barcode || '');
    request.input('gl_class_code',   sql.NVarChar,      data.gl_class_code || '');
    request.input('gl_description',  sql.NVarChar,      data.gl_description || '');
    request.input('purchase_class',  sql.NVarChar,      data.purchase_class || '');
    request.input('category',        sql.NVarChar,      data.category || '');
    request.input('po_no',           sql.NVarChar,      data.po_no);
    request.input('item_code',       sql.NVarChar,      data.item_code);

    await request.query(`
      UPDATE import_po
         SET po_date         = @po_date,
             pr_no           = @pr_no,
             vendor_name     = @vendor_name,
             qty             = @qty,
             unit_price      = @unit_price,
             currency        = @currency,
             forex           = @forex,
             func_amount     = @func_amount,
             delivery_status = @delivery_status,
             buyer           = @buyer,
             uom             = @uom,
             uom_description = @uom_description,
             item_name       = @item_name,
             barcode         = @barcode,
             gl_class_code   = @gl_class_code,
             gl_description  = @gl_description,
             purchase_class  = @purchase_class,
             category        = @category
       WHERE po_no    = @po_no
         AND item_code = @item_code
    `);
  }

  /* ============================================================
     LIST / DETAIL
     ============================================================ */
  static async listPOs({
    warehouse_id, viewer_warehouse_id, status, search, delivery_status,
    has_po, start_date, end_date, page = 1, limit = 50,
  } = {}) {
    await poolConnect;

    const safePage  = Math.max(1, Number(page)  || 1);
    const safeLimit = Math.min(500, Math.max(1, Number(limit) || 50));
    const offset    = (safePage - 1) * safeLimit;
    const hasPoFilter = normalizeHasPo(has_po);

    const buildWhere = (request) => {
      const conditions = [];

      if (warehouse_id != null && warehouse_id !== '') {
        request.input('warehouse_id', sql.BigInt, Number(warehouse_id));
        conditions.push('warehouse_id = @warehouse_id');
      }
      if (status && status !== 'All') {
        request.input('status', sql.NVarChar, status);
        conditions.push('status = @status');
      }
      if (search && String(search).trim() !== '') {
        request.input('search', sql.NVarChar, `%${String(search).trim()}%`);
        conditions.push('(po_no LIKE @search OR vendor_name LIKE @search OR pr_no LIKE @search)');
      }
      if (hasPoFilter !== null) {
        request.input('has_po', sql.Bit, hasPoFilter);
        conditions.push('has_po = @has_po');
      }
      if (start_date) {
        request.input('start_date', sql.Date, start_date);
        conditions.push('po_date >= @start_date');
      }
      if (end_date) {
        request.input('end_date', sql.Date, end_date);
        conditions.push('po_date <= @end_date');
      }

      return conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    };

    const PARTIAL_MATCH = `delivery_status IN ('Partial', 'Partial Received')`;

    const buildHaving = () => {
      if (!delivery_status || delivery_status === 'All') return '';
      if (delivery_status === 'Partial') {
        return `HAVING SUM(CASE WHEN ${PARTIAL_MATCH} THEN 1 ELSE 0 END) > 0`;
      }
      if (delivery_status === 'Complete') {
        return `HAVING SUM(CASE WHEN ${PARTIAL_MATCH} THEN 1 ELSE 0 END) = 0`;
      }
      return '';
    };

    const countReq     = pool.request();
    const countWhere   = buildWhere(countReq);
    const countHaving  = buildHaving();
    const countRes = await countReq.query(`
      SELECT COUNT(*) AS total FROM (
        SELECT po_no FROM import_po
        ${countWhere}
        GROUP BY po_no
        ${countHaving}
      ) AS x
    `);
    const total = countRes.recordset[0]?.total || 0;

    const rowsReq   = pool.request();
    const where     = buildWhere(rowsReq);
    const having    = buildHaving();
    rowsReq.input('offset', sql.Int, offset);
    rowsReq.input('limit',  sql.Int, safeLimit);

    const rowsRes = await rowsReq.query(`
      SELECT po_no,
             MIN(po_date)          AS po_date,
             MAX(pr_no)            AS pr_no,
             MAX(vendor_name)      AS vendor_name,
             MAX(buyer)            AS buyer,
             COUNT(*)              AS line_count,
             SUM(ISNULL(func_amount, 0))            AS total_amount,
             SUM(CASE WHEN ${PARTIAL_MATCH} THEN 1 ELSE 0 END) AS partial_line_count,
             MAX(CAST(has_po AS INT))               AS has_po,
             CASE MIN(CASE status
               WHEN 'Pending'           THEN 1
               WHEN 'Partial Received'  THEN 2
               WHEN 'Complete'          THEN 3
               WHEN 'With Handler'      THEN 4
               WHEN 'Pending Transfer'  THEN 5
               WHEN 'Transferred'       THEN 6
               WHEN 'Stored'            THEN 7
               WHEN 'Released'          THEN 8
               ELSE 0
             END)
               WHEN 8 THEN 'Released'
               WHEN 7 THEN 'Stored'
               WHEN 6 THEN 'Transferred'
               WHEN 5 THEN 'Pending Transfer'
               WHEN 4 THEN 'With Handler'
               WHEN 3 THEN 'Complete'
               WHEN 2 THEN 'Partial Received'
               WHEN 1 THEN 'Pending'
               ELSE 'Pending'
             END AS status,
             MAX(warehouse_id)     AS warehouse_id,
             MAX(warehouse_code)   AS warehouse_code,
             MIN(imported_by)      AS imported_by,
             MIN(imported_at)      AS imported_at,
             MAX(forwarded_by)     AS forwarded_by,
             MAX(forwarded_at)     AS forwarded_at
        FROM import_po
        ${where}
       GROUP BY po_no
       ${having}
       ORDER BY MAX(CAST(has_po AS INT)) DESC,
                TRY_CAST(po_no AS BIGINT) DESC,
                po_no DESC
       OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `);

    const rows = rowsRes.recordset;

    const viewerId = viewer_warehouse_id != null && viewer_warehouse_id !== ''
      ? Number(viewer_warehouse_id)
      : null;

    if (!viewerId || rows.length === 0) {
      for (const r of rows) {
        r.my_line_count = 0; r.my_can_forward = false; r.my_has_forwarded = false;
        r.my_pending_count = 0; r.my_transferable_count = 0;
      }
      return { rows, total };
    }

    const poNos = [...new Set(rows.map(r => r.po_no))];
    const enrichReq = pool.request();
    enrichReq.input('viewer_warehouse_id', sql.BigInt, viewerId);
    const placeholders = poNos.map((p, i) => { enrichReq.input(`p${i}`, sql.NVarChar, p); return `@p${i}`; }).join(',');

    const enrichRes = await enrichReq.query(`
      SELECT po_no,
             COUNT(*) AS my_line_count,
             SUM(CASE WHEN status IN ('Partial Received', 'Complete')
                      THEN 1 ELSE 0 END) AS my_forwardable_count,
             SUM(CASE WHEN status IN ('With Handler',
                                      'Pending Transfer', 'Transferred', 'Stored', 'Released')
                      THEN 1 ELSE 0 END) AS my_forwarded_count,
             SUM(CASE WHEN status = 'Pending Transfer' THEN 1 ELSE 0 END) AS my_pending_count,
             SUM(CASE WHEN status = 'With Handler' THEN 1 ELSE 0 END) AS my_transferable_count
        FROM import_po
       WHERE po_no IN (${placeholders})
         AND warehouse_id = @viewer_warehouse_id
       GROUP BY po_no
    `);

    const enrichMap = {};
    for (const r of enrichRes.recordset) enrichMap[r.po_no] = r;

    for (const row of rows) {
      const e = enrichMap[row.po_no];
      row.my_line_count         = e ? Number(e.my_line_count)         : 0;
      row.my_can_forward        = e ? Number(e.my_forwardable_count)  > 0 : false;
      row.my_has_forwarded      = e ? Number(e.my_forwarded_count)    > 0 : false;
      row.my_pending_count      = e ? Number(e.my_pending_count)      : 0;
      row.my_transferable_count = e ? Number(e.my_transferable_count) : 0;
    }

    return { rows, total };
  }

  static async listHandlerItems({
    warehouse_id, status, search, has_po, start_date, end_date,
    limit = 500, offset = 0,
  } = {}) {
    await poolConnect;
    if (warehouse_id == null || warehouse_id === '') return [];

    const request = pool.request();
    request.input('warehouse_id', sql.BigInt, Number(warehouse_id));

    const conditions = [
      `ip.warehouse_id = @warehouse_id`,
      `ip.status IN ('With Handler', 'Pending Transfer', 'Transferred', 'Stored', 'Released')`,
    ];

    if (status && status !== 'All') {
      request.input('status', sql.NVarChar, status);
      conditions.push('ip.status = @status');
    }
    if (search && String(search).trim() !== '') {
      request.input('search', sql.NVarChar, `%${String(search).trim()}%`);
      conditions.push(
        '(ip.po_no LIKE @search OR ip.item_code LIKE @search OR ip.item_name LIKE @search ' +
        'OR im.Item_Description LIKE @search OR im.Barcode LIKE @search ' +
        'OR ip.vendor_name LIKE @search OR ip.pr_no LIKE @search)'
      );
    }

    const hasPoFilter = normalizeHasPo(has_po);
    if (hasPoFilter !== null) {
      request.input('has_po', sql.Bit, hasPoFilter);
      conditions.push('ip.has_po = @has_po');
    }

    if (start_date) {
      request.input('start_date', sql.Date, start_date);
      conditions.push('ip.po_date >= @start_date');
    }
    if (end_date) {
      request.input('end_date', sql.Date, end_date);
      conditions.push('ip.po_date <= @end_date');
    }

    request.input('limit',  sql.Int, Number(limit)  || 500);
    request.input('offset', sql.Int, Math.max(0, Number(offset) || 0));
    const where = conditions.join(' AND ');

    const result = await request.query(`
      SELECT
             ip.id, ip.po_date, ip.pr_no, ip.po_no, ip.has_po,
             ip.vendor_name, ip.buyer,
             ip.item_code,
             ISNULL(im.Item_Description,   ip.item_name)                  AS item_name,
             ISNULL(im.Uom_Code,           ip.uom)                        AS uom,
             ISNULL(im.Uom_Description,    ip.uom_description)            AS uom_description,
             ISNULL(im.Barcode,            ip.barcode)                    AS barcode,
             ISNULL(CAST(im.Gl_Class AS NVARCHAR(50)), ip.gl_class_code)  AS gl_class_code,
             ISNULL(im.Gl_Description,     ip.gl_description)             AS gl_description,
             ISNULL(im.Purchase_Class,     ip.purchase_class)             AS purchase_class,
             ISNULL(im.Category,           ip.category)                   AS category,
             ip.qty, ip.received_qty, ip.damaged_qty, ip.stored_qty, ip.released_qty,
             ip.qty_boxes, ip.qty_loose_pieces, ip.pieces_per_box_snapshot,
             ISNULL(ip.damaged_value, 0)   AS damaged_value,
             ip.unit_price, ip.currency,
             ISNULL(ip.forex, 1)           AS forex,
             ISNULL(ip.func_amount, 0)     AS func_amount,
             ip.delivery_status,
             ip.status, ip.damage_reason,
             ip.warehouse_id, ip.warehouse_code, ip.locator_code,
             ip.imported_by, ip.imported_at,
             ip.forwarded_by, ip.forwarded_at
        FROM import_po ip
        LEFT JOIN item_master im ON im.Item_Code = ip.item_code
       WHERE ${where}
       ORDER BY ip.has_po DESC, TRY_CAST(ip.po_no AS BIGINT) DESC, ip.po_no DESC, ip.item_code ASC
       OFFSET @offset ROWS
       FETCH NEXT @limit ROWS ONLY
    `);
    return result.recordset;
  }

  static async countHandlerItems({
    warehouse_id, status, search, has_po, start_date, end_date,
  } = {}) {
    await poolConnect;
    if (warehouse_id == null || warehouse_id === '') return 0;

    const request = pool.request();
    request.input('warehouse_id', sql.BigInt, Number(warehouse_id));

    const conditions = [
      `ip.warehouse_id = @warehouse_id`,
      `ip.status IN ('With Handler', 'Pending Transfer', 'Transferred', 'Stored', 'Released')`,
    ];

    if (status && status !== 'All') {
      request.input('status', sql.NVarChar, status);
      conditions.push('ip.status = @status');
    }
    if (search && String(search).trim() !== '') {
      request.input('search', sql.NVarChar, `%${String(search).trim()}%`);
      conditions.push(
        '(ip.po_no LIKE @search OR ip.item_code LIKE @search OR ip.item_name LIKE @search ' +
        'OR im.Item_Description LIKE @search OR im.Barcode LIKE @search ' +
        'OR ip.vendor_name LIKE @search OR ip.pr_no LIKE @search)'
      );
    }

    const hasPoFilter = normalizeHasPo(has_po);
    if (hasPoFilter !== null) {
      request.input('has_po', sql.Bit, hasPoFilter);
      conditions.push('ip.has_po = @has_po');
    }

    if (start_date) {
      request.input('start_date', sql.Date, start_date);
      conditions.push('ip.po_date >= @start_date');
    }
    if (end_date) {
      request.input('end_date', sql.Date, end_date);
      conditions.push('ip.po_date <= @end_date');
    }

    const where = conditions.join(' AND ');

    const result = await request.query(`
      SELECT COUNT(*) AS total
        FROM import_po ip
        LEFT JOIN item_master im ON im.Item_Code = ip.item_code
       WHERE ${where}
    `);
    return Number(result.recordset[0]?.total) || 0;
  }

  static async getPODetail(poNo, warehouseId = null) {
    await poolConnect;
    const request = pool.request();
    request.input('po_no', sql.NVarChar, poNo);

    let sqlText = `
      SELECT
             ip.id, ip.po_date, ip.pr_no, ip.po_no, ip.has_po,
             ip.vendor_name, ip.buyer,
             ip.item_code,
             ISNULL(im.Item_Description,   ip.item_name)                  AS item_name,
             ISNULL(im.Uom_Code,           ip.uom)                        AS uom,
             ISNULL(im.Uom_Description,    ip.uom_description)            AS uom_description,
             ISNULL(im.Barcode,            ip.barcode)                    AS barcode,
             ISNULL(CAST(im.Gl_Class AS NVARCHAR(50)), ip.gl_class_code)  AS gl_class_code,
             ISNULL(im.Gl_Description,     ip.gl_description)             AS gl_description,
             ISNULL(im.Purchase_Class,     ip.purchase_class)             AS purchase_class,
             ISNULL(im.Category,           ip.category)                   AS category,
             ip.qty, ip.received_qty, ip.damaged_qty, ip.stored_qty, ip.released_qty,
             ip.qty_boxes, ip.qty_loose_pieces, ip.pieces_per_box_snapshot,
             ISNULL(ip.damaged_value, 0)   AS damaged_value,
             ip.unit_price, ip.currency,
             ISNULL(ip.forex, 1)           AS forex,
             ISNULL(ip.func_amount, 0)     AS func_amount,
             ip.delivery_status,
             ip.status, ip.damage_reason,
             ip.warehouse_id, ip.warehouse_code, ip.locator_code,
             ip.imported_by, ip.imported_at,
             ip.forwarded_by, ip.forwarded_at
        FROM import_po ip
        LEFT JOIN item_master im ON im.Item_Code = ip.item_code
       WHERE ip.po_no = @po_no
    `;

    if (warehouseId != null && warehouseId !== '') {
      request.input('warehouse_id', sql.BigInt, Number(warehouseId));
      sqlText += ' AND ip.warehouse_id = @warehouse_id';
    }
    sqlText += ' ORDER BY ip.item_code';

    const result = await request.query(sqlText);
    return result.recordset;
  }

  static async getLineById(id) {
    await poolConnect;
    const request = pool.request();
    request.input('id', sql.BigInt, Number(id));
    const result = await request.query(`SELECT * FROM import_po WHERE id = @id`);
    return result.recordset[0] || null;
  }

  /* ============================================================
     STORE / RELEASE QTY HELPERS
     ============================================================ */
  static async addStoredQty(tx, { id, qty_to_add, qty_boxes = 0, qty_loose_pieces = 0, pieces_per_box_snapshot = null }) {
    const q = Number(qty_to_add);
    if (!Number.isFinite(q) || q <= 0) throw new Error('qty_to_add must be positive.');

    const updReq = new sql.Request(tx);
    updReq.input('id',  sql.BigInt,        Number(id));
    updReq.input('q',   sql.Decimal(18,4), q);
    updReq.input('boxes', sql.Decimal(18,4), qty_boxes);
    updReq.input('loose', sql.Decimal(18,4), qty_loose_pieces);
    updReq.input('snapshot', sql.Decimal(18,4), pieces_per_box_snapshot);

    const res = await updReq.query(`
      UPDATE import_po
      SET stored_qty = ISNULL(stored_qty, 0) + @q,
          qty_boxes = ISNULL(qty_boxes, 0) + @boxes,
          qty_loose_pieces = ISNULL(qty_loose_pieces, 0) + @loose,
          pieces_per_box_snapshot = COALESCE(@snapshot, pieces_per_box_snapshot)
      WHERE id = @id;

      SELECT id, po_no, item_code, item_name, uom,
             qty, received_qty, damaged_qty, stored_qty, released_qty,
             qty_boxes, qty_loose_pieces, pieces_per_box_snapshot,
             ISNULL(damaged_value, 0) AS damaged_value,
             unit_price, currency, forex, func_amount, delivery_status,
             warehouse_id, warehouse_code, status
        FROM import_po WHERE id = @id;
    `);
    return res.recordset[0] || null;
  }

  static async addReleasedQty(tx, { id, qty_to_add }) {
    const q = Number(qty_to_add);
    if (!Number.isFinite(q) || q <= 0) throw new Error('qty_to_add must be positive.');

    const updReq = new sql.Request(tx);
    updReq.input('id',  sql.BigInt,        Number(id));
    updReq.input('q',   sql.Decimal(18,4), q);

    const res = await updReq.query(`
      UPDATE import_po SET released_qty = ISNULL(released_qty, 0) + @q WHERE id = @id;

      SELECT id, po_no, item_code, item_name, uom,
             qty, received_qty, damaged_qty, stored_qty, released_qty,
             ISNULL(damaged_value, 0) AS damaged_value,
             unit_price, currency, forex, func_amount, delivery_status,
             warehouse_id, warehouse_code, status
        FROM import_po WHERE id = @id;
    `);
    return res.recordset[0] || null;
  }

  static async maybeMarkPOStored(tx, poNo) {
    const req = new sql.Request(tx);
    req.input('po_no', sql.NVarChar, poNo);
    await req.query(`
      DECLARE @remaining INT = (
        SELECT COUNT(*) FROM import_po
         WHERE po_no = @po_no
           AND status IN ('With Handler', 'Pending Transfer')
           AND received_qty > 0
           AND ISNULL(stored_qty, 0) + ISNULL(released_qty, 0) < received_qty
      );

      IF @remaining = 0
      BEGIN
        UPDATE import_po
           SET status = CASE
                 WHEN ISNULL(released_qty, 0) >= received_qty AND ISNULL(stored_qty, 0) = 0
                      THEN 'Released'
                 ELSE 'Stored'
               END
         WHERE po_no = @po_no
           AND status IN ('With Handler', 'Pending Transfer')
           AND received_qty > 0;
      END
    `);
    return true;
  }

  static async receiveLine({
    id,
    incoming_good,
    unit_price,
    currency,
    forex = null,
    receiving_warehouse_id = null,
  }) {
    await poolConnect;

    const current = await ImportPoModel.getLineById(id);
    if (!current) throw new Error('PO line not found.');

    const incomingGood = Number(incoming_good) || 0;
    if (incomingGood <= 0) {
      throw new Error('receiveLine: incoming_good must be greater than 0.');
    }

    const repricedCost =
      unit_price != null && unit_price !== '' && !Number.isNaN(Number(unit_price))
        ? Number(unit_price)
        : null;
    const effectiveCost = repricedCost != null
      ? repricedCost
      : (Number(current.unit_price) || 0);

    let effectiveForex = Number(forex);
    if (!Number.isFinite(effectiveForex) || effectiveForex <= 0) {
      const dbFx = Number(current.forex);
      effectiveForex = Number.isFinite(dbFx) && dbFx > 0 ? dbFx : 1;
    }

    const request = pool.request();
    request.input('id',            sql.BigInt,         id);
    request.input('incoming_good', sql.Decimal(18,4),  incomingGood);
    request.input('new_price',     sql.Decimal(18,6),  repricedCost);
    request.input('new_currency',  sql.NVarChar,       currency || null);
    request.input('receiving_warehouse_id', sql.BigInt, receiving_warehouse_id != null ? Number(receiving_warehouse_id) : null);

    const updRes = await request.query(`
      UPDATE import_po
         SET received_qty  = ISNULL(received_qty, 0) + @incoming_good,
             unit_price = COALESCE(@new_price, unit_price),
             currency   = COALESCE(@new_currency, currency),
             warehouse_id = COALESCE(warehouse_id, @receiving_warehouse_id),
             status = CASE
               WHEN (ISNULL(received_qty, 0) + @incoming_good) >= qty THEN 'Complete'
               ELSE 'Partial Received'
             END
       WHERE id = @id;

      SELECT id, po_no, item_code, item_name, uom,
             qty, received_qty, damaged_qty, stored_qty, released_qty,
             ISNULL(damaged_value, 0) AS damaged_value,
             unit_price, currency, forex, func_amount, delivery_status,
             warehouse_id, warehouse_code, locator_code, status,
             damage_reason
        FROM import_po
       WHERE id = @id;
    `);

    const updated = updRes.recordset[0];

    return {
      line: updated,
      po_no:               updated?.po_no       ?? current.po_no,
      item_code:           updated?.item_code   ?? current.item_code,
      item_name:           updated?.item_name   ?? current.item_name,
      uom:                 updated?.uom         ?? current.uom,
      warehouse_id:        updated?.warehouse_id,
      warehouse_code:      updated?.warehouse_code,
      effective_unit_cost: effectiveCost,
      effective_forex:     effectiveForex,
      incoming_good:       incomingGood,
    };
  }

  /* ============================================================
     STATUS RECOMPUTE + FORWARD / DELETE
     ============================================================ */
  static async recomputePOStatus(poNo) {
    await poolConnect;
    const request = pool.request();
    request.input('po_no', sql.NVarChar, poNo);

    await request.query(`
      UPDATE import_po
         SET status = CASE
           WHEN ISNULL(received_qty, 0) >= qty THEN 'Complete'
           WHEN ISNULL(received_qty, 0) > 0 THEN 'Partial Received'
           ELSE 'Pending'
         END
       WHERE po_no = @po_no
         AND status IN ('Pending', 'Partial Received', 'Complete')
    `);
  }

  static async recomputePODamagedValue(poNo) {
    await poolConnect;
    const request = pool.request();
    request.input('po_no', sql.NVarChar, poNo);
    await request.query(`
      UPDATE import_po
         SET damaged_value = ROUND(
               ISNULL(damaged_qty, 0)
             * ISNULL(unit_price, 0)
             * ISNULL(forex, 1),
             4
             )
       WHERE po_no = @po_no
         AND (damaged_value IS NULL OR damaged_value = 0)
         AND ISNULL(damaged_qty, 0) > 0
    `);
  }

  static async countForwardableLines(poNo, warehouseId) {
    await poolConnect;
    const request = pool.request();
    request.input('po_no',        sql.NVarChar, poNo);
    request.input('warehouse_id', sql.BigInt,   warehouseId);

    const result = await request.query(`
      SELECT COUNT(*) AS cnt
        FROM import_po
       WHERE po_no = @po_no
         AND warehouse_id = @warehouse_id
         AND status IN ('Partial Received', 'Complete')
    `);
    return result.recordset[0]?.cnt || 0;
  }

  static async forwardPOToHandler(poNo, username, warehouseId) {
    await poolConnect;
    const request = pool.request();
    request.input('po_no',        sql.NVarChar, poNo);
    request.input('forwarded_by', sql.NVarChar, username || 'System');
    request.input('warehouse_id', sql.BigInt,   warehouseId);

    const result = await request.query(`
      UPDATE import_po
         SET status = 'With Handler',
             forwarded_by = @forwarded_by,
             forwarded_at = GETDATE()
       WHERE po_no = @po_no
         AND warehouse_id = @warehouse_id
         AND status IN ('Partial Received', 'Complete')
    `);
    return result.rowsAffected[0] || 0;
  }

  static async deletePOIfPending(poNo) {
    await poolConnect;
    const request = pool.request();
    request.input('po_no', sql.NVarChar, poNo);

    const check = await request.query(`
      SELECT COUNT(*) AS not_pending FROM import_po
       WHERE po_no = @po_no AND status <> 'Pending'
    `);
    if (check.recordset[0].not_pending > 0) {
      const err = new Error('Cannot delete a PO that has already been received.');
      err.code = 'PO_HAS_RECEIPTS';
      throw err;
    }

    const del = await pool.request()
      .input('po_no', sql.NVarChar, poNo)
      .query(`DELETE FROM import_po WHERE po_no = @po_no`);
    return del.rowsAffected[0] || 0;
  }

  /* ============================================================
     RECEIVED PO LINES REGISTRY
     ============================================================ */
  static _buildReceivedFilters(request, {
    warehouse_id, item_code, search, status, delivery_status, has_po,
    start_date, end_date, received_only = true,
  } = {}) {
    const conditions = [];

    if (received_only) {
      conditions.push('ISNULL(ip.received_qty, 0) > 0');
    }
    if (warehouse_id != null && warehouse_id !== '') {
      request.input('warehouse_id', sql.BigInt, Number(warehouse_id));
      conditions.push('ip.warehouse_id = @warehouse_id');
    }
    if (item_code && String(item_code).trim()) {
      request.input('item_code', sql.NVarChar(50), String(item_code).trim());
      conditions.push('ip.item_code = @item_code');
    }
    if (status && status !== 'All') {
      request.input('status', sql.NVarChar, status);
      conditions.push('ip.status = @status');
    }
    if (delivery_status && delivery_status !== 'All') {
      request.input('delivery_status', sql.NVarChar(20), delivery_status);
      if (delivery_status === 'Partial Received') {
        conditions.push(`ip.delivery_status IN ('Partial', 'Partial Received')`);
      } else {
        conditions.push('ip.delivery_status = @delivery_status');
      }
    }

    const hasPoFilter = normalizeHasPo(has_po);
    if (hasPoFilter !== null) {
      request.input('has_po', sql.Bit, hasPoFilter);
      conditions.push('ip.has_po = @has_po');
    }

    if (search && String(search).trim()) {
      request.input('search', sql.NVarChar, `%${String(search).trim()}%`);
      conditions.push(
        '(ip.po_no LIKE @search OR ip.vendor_name LIKE @search ' +
        'OR ip.pr_no LIKE @search OR ip.item_code LIKE @search ' +
        'OR ip.item_name LIKE @search)'
      );
    }
    if (start_date) {
      request.input('start_date', sql.Date, start_date);
      conditions.push('ip.po_date >= @start_date');
    }
    if (end_date) {
      request.input('end_date', sql.Date, end_date);
      conditions.push('ip.po_date <= @end_date');
    }

    return conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  }

  static async listReceivedPOLines({
    warehouse_id, item_code, search, status, delivery_status, has_po,
    start_date, end_date,
    page = 1, limit = 50,
    received_only = true,
  } = {}) {
    await poolConnect;

    const safePage  = Math.max(1, Number(page) || 1);
    const safeLimit = Math.min(10000, Math.max(1, Number(limit) || 50));
    const offset    = (safePage - 1) * safeLimit;

    const countReq = pool.request();
    const countWhere = ImportPoModel._buildReceivedFilters(countReq, {
      warehouse_id, item_code, search, status, delivery_status, has_po,
      start_date, end_date, received_only,
    });
    const countRes = await countReq.query(`
      SELECT COUNT(*) AS total
        FROM import_po ip
        ${countWhere}
    `);
    const total = countRes.recordset[0]?.total || 0;

    const rowsReq = pool.request();
    const rowsWhere = ImportPoModel._buildReceivedFilters(rowsReq, {
      warehouse_id, item_code, search, status, delivery_status, has_po,
      start_date, end_date, received_only,
    });
    rowsReq.input('offset', sql.Int, offset);
    rowsReq.input('limit',  sql.Int, safeLimit);

    const rowsRes = await rowsReq.query(`
      SELECT
        ip.id,
        ip.po_no, ip.po_date, ip.pr_no, ip.has_po, ip.vendor_name, ip.buyer,
        ip.item_code, ip.item_name, ip.uom, ip.uom_description, ip.barcode,
        ip.qty, ip.received_qty, ip.damaged_qty, ip.stored_qty, ip.released_qty,
        ip.qty_boxes, ip.qty_loose_pieces, ip.pieces_per_box_snapshot,
        ISNULL(ip.damaged_value, 0)             AS damaged_value,
        ip.unit_price,
        ip.currency,
        ISNULL(ip.forex, 1)                     AS forex,
        ISNULL(ip.func_amount, 0)               AS func_amount,
        ip.delivery_status,
        ip.status, ip.damage_reason,
        ip.warehouse_id, ip.warehouse_code,
        w.warehouse_name                         AS warehouse_name,
        ip.imported_by, ip.imported_at,
        ip.forwarded_by, ip.forwarded_at
      FROM import_po ip
      LEFT JOIN warehouse_table w ON w.warehouse_id = ip.warehouse_id
      ${rowsWhere}
      ORDER BY ip.po_date DESC,
               ip.has_po DESC,
               TRY_CAST(ip.po_no AS BIGINT) DESC,
               ip.po_no DESC,
               ip.item_code ASC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `);

    return { rows: rowsRes.recordset, total };
  }

  static async getReceivedTotals({
    warehouse_id, item_code, search, status, delivery_status, has_po,
    start_date, end_date, received_only = true,
  } = {}) {
    await poolConnect;
    const request = pool.request();
    const where = ImportPoModel._buildReceivedFilters(request, {
      warehouse_id, item_code, search, status, delivery_status, has_po,
      start_date, end_date, received_only,
    });

    const res = await request.query(`
      SELECT
        COUNT(*) AS line_count,
        ISNULL(SUM(ip.received_qty), 0)                            AS total_qty,
        ISNULL(SUM(ip.func_amount), 0)                             AS total_value
        FROM import_po ip
        ${where}
    `);
    return res.recordset[0] || { line_count: 0, total_qty: 0, total_value: 0 };
  }

  static async listWarehousesWithReceivedPOs({
    warehouse_id, item_code, search, status, delivery_status, has_po,
    start_date, end_date, received_only = true,
  } = {}) {
    await poolConnect;
    const request = pool.request();
    const where = ImportPoModel._buildReceivedFilters(request, {
      warehouse_id, item_code, search, status, delivery_status, has_po,
      start_date, end_date, received_only,
    });

    const res = await request.query(`
      SELECT
        ip.warehouse_id,
        ip.warehouse_code,
        MAX(w.warehouse_name)                       AS warehouse_name,
        COUNT(*)                                    AS line_count,
        ISNULL(SUM(ip.received_qty), 0)             AS total_qty,
        ISNULL(SUM(ip.func_amount), 0)              AS total_value
        FROM import_po ip
        LEFT JOIN warehouse_table w ON w.warehouse_id = ip.warehouse_id
        ${where}
       GROUP BY ip.warehouse_id, ip.warehouse_code
       ORDER BY ip.warehouse_code ASC
    `);
    return res.recordset;
  }

  static async getReceivedPOTrend({
    warehouse_id, item_code, search, status, delivery_status, has_po,
    start_date, end_date,
    days = 30,
    received_only = true,
  } = {}) {
    await poolConnect;
    const request = pool.request();

    if (!start_date && !end_date) {
      request.input('days', sql.Int, Number(days) || 30);
    }

    const filters = ImportPoModel._buildReceivedFilters(request, {
      warehouse_id, item_code, search, status, delivery_status, has_po,
      start_date, end_date, received_only,
    });

    const dateClause = (!start_date && !end_date)
      ? `ip.po_date >= DATEADD(day, -@days, CAST(GETDATE() AS DATE))`
      : null;

    const where = [filters.replace(/^WHERE\s+/i, ''), dateClause]
      .filter(Boolean).join(' AND ');

    const res = await request.query(`
      SELECT
        CAST(ip.po_date AS DATE)                    AS day,
        COUNT(*)                                    AS line_count,
        ISNULL(SUM(ip.received_qty), 0)             AS total_qty,
        ISNULL(SUM(ip.func_amount), 0)              AS total_value
        FROM import_po ip
        ${where ? `WHERE ${where}` : ''}
       GROUP BY CAST(ip.po_date AS DATE)
       ORDER BY day ASC
    `);
    return res.recordset;
  }
}

module.exports = ImportPoModel;