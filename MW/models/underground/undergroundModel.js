// models/underground/undergroundModel.js
'use strict';

const { sql, ensurePool, query } = require('../../db');
const WarehouseInventoryModel = require('../warehouseInventoryModel');

// ⚡ LUMB has been removed from the offline system scope. Only UG.
const SYNC_WAREHOUSE_CODES = Object.freeze(['UG']);

const isSyncWarehouse = (code) =>
  SYNC_WAREHOUSE_CODES.includes(String(code || '').trim().toUpperCase());

const round4 = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 10000) / 10000;
};

const computeLiveReleaseTotals = async (shift_id) => {
  const rows = await query(
    `SELECT
       ISNULL(SUM(CASE WHEN line_kind = 'Release' THEN qty ELSE 0 END), 0) AS issued_qty,
       ISNULL(SUM(CASE WHEN line_kind = 'Release' THEN line_total ELSE 0 END), 0) AS issued_value,
       ISNULL(SUM(CASE WHEN line_kind = 'Damage' THEN qty ELSE 0 END), 0) AS damaged_qty,
       ISNULL(SUM(CASE WHEN line_kind = 'Damage' THEN line_total ELSE 0 END), 0) AS damaged_value,
       ISNULL(SUM(CASE WHEN line_kind = 'Transfer-Out' THEN qty ELSE 0 END), 0) AS transfer_out_qty,
       ISNULL(SUM(CASE WHEN line_kind = 'Transfer-Out' THEN line_total ELSE 0 END), 0) AS transfer_out_value,
       ISNULL(SUM(CASE WHEN line_kind = 'Transfer-In' THEN qty ELSE 0 END), 0) AS transfer_in_qty,
       ISNULL(SUM(CASE WHEN line_kind = 'Transfer-In' THEN line_total ELSE 0 END), 0) AS transfer_in_value
     FROM dbo.underground_shift_lines
     WHERE shift_id = @param0`,
    [shift_id]
  );
  const r = rows[0] || {};
  return {
    issued_qty: Number(r.issued_qty) || 0,
    issued_value: Number(r.issued_value) || 0,
    damaged_qty: Number(r.damaged_qty) || 0,
    damaged_value: Number(r.damaged_value) || 0,
    transfer_out_qty: Number(r.transfer_out_qty) || 0,
    transfer_out_value: Number(r.transfer_out_value) || 0,
    transfer_in_qty: Number(r.transfer_in_qty) || 0,
    transfer_in_value: Number(r.transfer_in_value) || 0,
  };
};

const overlayLiveTotals = (shift, live) => {
  if (!shift || shift.status !== 'Open') return shift;
  
  const relQty = (Number(live.issued_qty) || 0) + (Number(live.damaged_qty) || 0) + (Number(live.transfer_out_qty) || 0);
  const relVal = (Number(live.issued_value) || 0) + (Number(live.damaged_value) || 0) + (Number(live.transfer_out_value) || 0);
  const inQty  = Number(live.transfer_in_qty) || 0;
  const inVal  = Number(live.transfer_in_value) || 0;

  return {
    ...shift,
    issued_qty: Number(live.issued_qty) || 0,
    issued_value: Number(live.issued_value) || 0,
    damaged_qty: Number(live.damaged_qty) || 0,
    damaged_value: Number(live.damaged_value) || 0,
    transfer_out_qty: Number(live.transfer_out_qty) || 0,
    transfer_out_value: Number(live.transfer_out_value) || 0,
    trans_in_qty: inQty,
    trans_in_value: inVal,
    released_qty: relQty,
    released_value: relVal,
    ending_qty: round4(Number(shift.beginning_qty) - relQty + inQty),
    ending_value: round4(Number(shift.beginning_value) - relVal + inVal),
  };
};

const applyLocatorAdjustment = async (tx, {
  warehouse_code,
  locator_code,
  item_code,
  qty_change,
  unit_cost
}) => {
  if (!warehouse_code || !locator_code || !item_code) return;
  const q = Number(qty_change) || 0;
  if (q === 0) return;

  const getReq = new sql.Request(tx);
  getReq.input('wh',   sql.NVarChar(40),  warehouse_code);
  getReq.input('loc',  sql.NVarChar(100), locator_code);
  getReq.input('item', sql.NVarChar(100), item_code);

  const getRes = await getReq.query(`
    SELECT qty, avg_unit_cost, total_value
      FROM dbo.inventory_locator WITH (UPDLOCK, ROWLOCK)
     WHERE warehouse_code = @wh
       AND locator_code   = @loc
       AND item_code      = @item
  `);

  const row = getRes.recordset[0];
  if (!row) {
    if (q > 0) {
      const insReq = new sql.Request(tx);
      insReq.input('wh', sql.NVarChar(40), warehouse_code);
      insReq.input('loc', sql.NVarChar(100), locator_code);
      insReq.input('item', sql.NVarChar(100), item_code);
      insReq.input('qty', sql.Decimal(18,4), q);
      insReq.input('a', sql.Decimal(18,6), Number(unit_cost) || 0);
      insReq.input('val', sql.Decimal(18,4), round4(q * (Number(unit_cost) || 0)));
      await insReq.query(`
        INSERT INTO dbo.inventory_locator (warehouse_code, locator_code, item_code, qty, avg_unit_cost, total_value, created_at, updated_at)
        VALUES (@wh, @loc, @item, @qty, @a, @val, GETDATE(), GETDATE())
      `);
    }
    return;
  }

  const qtyBefore   = Number(row.qty)          || 0;
  const valueBefore = Number(row.total_value)  || 0;
  const avgBefore   = Number(row.avg_unit_cost)|| 0;

  let deduct = q;
  if (deduct < 0 && Math.abs(deduct) > qtyBefore) {
    deduct = -qtyBefore;
  }

  const qtyAfter = qtyBefore + deduct;
  const avgBeforeTruncated = round4(avgBefore);
  const adjustedValue = round4(deduct * avgBeforeTruncated);
  const newValue = round4(valueBefore + adjustedValue);
  const newAvg = qtyAfter > 0 ? round4(newValue / qtyAfter) : 0;

  const updReq = new sql.Request(tx);
  updReq.input('wh',   sql.NVarChar(40),  warehouse_code);
  updReq.input('loc',  sql.NVarChar(100), locator_code);
  updReq.input('item', sql.NVarChar(100), item_code);
  updReq.input('q',    sql.Decimal(18,4), qtyAfter);
  updReq.input('a',    sql.Decimal(18,6), newAvg);
  updReq.input('val',  sql.Decimal(18,4), newValue);

  await updReq.query(`
    UPDATE dbo.inventory_locator
       SET qty           = @q,
           avg_unit_cost = @a,
           total_value   = @val,
           updated_at    = GETDATE()
     WHERE warehouse_code = @wh
       AND locator_code   = @loc
       AND item_code      = @item
  `);
};

const applyReleaseLinesToStock = async (tx, {
  warehouse_id,
  warehouse_code,
  release_lines = [],
  reference_no = null,
  reference_id = null,
  actor,
  remarks_prefix = 'Underground reconciliation',
}) => {
  let applied = 0;
  for (const ln of release_lines) {
    const qty = Number(ln.qty);
    if (!(qty > 0)) continue;

    const lineKind = ln.line_kind || 'Release';
    const isAddition = lineKind === 'Transfer-In';
    const qtyChange = isAddition ? qty : -qty;
    
    let movementType;
    if (lineKind === 'Transfer-In') {
      movementType = 'TransferIn';
    } else if (lineKind === 'Transfer-Out') {
      movementType = 'TransferOut';
    } else if (lineKind === 'Damage') {
      movementType = 'Adjustment';
    } else {
      movementType = 'Release';
    }

    // ⚡ FIX: Dynamically resolve the correct warehouse for BOTH Transfer-Out and Transfer-In.
    // This ensures items move correctly even if the source and destination are in different warehouses.
    let targetWarehouseId = warehouse_id;
    let targetWarehouseCode = warehouse_code;

    const locRes = await new sql.Request(tx)
      .input('loc', sql.NVarChar(100), ln.locator_code)
      .query(`SELECT warehouse_code FROM dbo.locator_table WHERE locator_code = @loc`);
    
    if (locRes.recordset.length > 0) {
      const locWhCode = locRes.recordset[0].warehouse_code;
      if (locWhCode !== warehouse_code) {
        targetWarehouseCode = locWhCode;
        const whRes = await new sql.Request(tx)
          .input('code', sql.NVarChar(20), targetWarehouseCode)
          .query(`SELECT warehouse_id FROM dbo.warehouse_table WHERE warehouse_code = @code`);
        if (whRes.recordset.length > 0) {
          targetWarehouseId = whRes.recordset[0].warehouse_id;
        }
      }
    }

    await WarehouseInventoryModel.applyMovement(tx, {
      warehouse_id:   targetWarehouseId,
      item_code:      ln.item_code,
      item_name:      ln.item_name,
      uom:            ln.uom,
      movement_type:  movementType,
      qty_change:     qtyChange,
      unit_cost:      Number(ln.unit_cost) || 0,
      reference_type: 'UndergroundReconciliation',
      reference_id,
      reference_no,
      actor,
      remarks: ln.remarks || `${remarks_prefix} · ${lineKind} · locator ${ln.locator_code}`,
    });

    await applyLocatorAdjustment(tx, {
      warehouse_code: targetWarehouseCode,
      locator_code:   ln.locator_code,
      item_code:      ln.item_code,
      qty_change:     qtyChange,
      unit_cost:      Number(ln.unit_cost) || 0,
    });

    applied += 1;
  }
  return applied;
};

const buildCurrentInventoryWhere = (
  shift_id,
  { search, locator_code, item_code, assigned_locators } = {}
) => {
  const params = [shift_id];
  const conds = ['shift_id = @param0'];

  if (search && String(search).trim()) {
    params.push(`%${String(search).trim()}%`);
    const i = params.length - 1;
    conds.push(`(item_code LIKE @param${i} OR item_name LIKE @param${i} OR locator_code LIKE @param${i})`);
  }
  if (locator_code) {
    params.push(locator_code);
    conds.push(`locator_code = @param${params.length - 1}`);
  }
  if (item_code) {
    params.push(item_code);
    conds.push(`item_code = @param${params.length - 1}`);
  }
  if (Array.isArray(assigned_locators) && assigned_locators.length > 0) {
    const placeholders = assigned_locators.map((code) => {
      params.push(String(code));
      return `@param${params.length - 1}`;
    });
    conds.push(`locator_code IN (${placeholders.join(', ')})`);
  }

  return { where: conds.join(' AND '), params };
};

const UndergroundModel = {
  SYNC_WAREHOUSE_CODES,
  isSyncWarehouse,

  getCurrentShift: async (warehouse_id, handler_username) => {
    if (!warehouse_id)      throw new Error('warehouse_id is required.');
    if (!handler_username)  throw new Error('handler_username is required.');

    const rows = await query(
      `SELECT TOP 1 * FROM dbo.underground_shift
        WHERE warehouse_id     = @param0
          AND handler_username = @param1
          AND status           = 'Open'
        ORDER BY shift_id DESC`,
      [warehouse_id, String(handler_username)]
    );
    const shift = rows[0] || null;
    if (!shift) return null;

    const live = await computeLiveReleaseTotals(shift.shift_id);
    return overlayLiveTotals(shift, live);
  },

  getShiftById: async (shift_id) => {
    const rows = await query(
      `SELECT
         s.*,
         seed_log.performed_at   AS seed_imported_at,
         close_log.performed_at  AS closing_exported_at,
         recon_log.performed_at  AS reconciliation_log_at,
         recon_log.export_format AS reconciliation_format
       FROM dbo.underground_shift s
       LEFT JOIN dbo.locator_export_log seed_log
         ON seed_log.export_id = s.seed_log_id
       LEFT JOIN dbo.locator_export_log close_log
         ON close_log.export_id = s.closing_log_id
       LEFT JOIN dbo.locator_export_log recon_log
         ON recon_log.export_id = s.reconciliation_log_id
       WHERE s.shift_id = @param0`,
      [shift_id]
    );
    const shift = rows[0] || null;
    if (!shift) return null;

    if (shift.status !== 'Open') return shift;
    const live = await computeLiveReleaseTotals(shift.shift_id);
    return overlayLiveTotals(shift, live);
  },

  getCurrentInventory: async (
    shift_id,
    { search, locator_code, item_code, assigned_locators, limit = 500, offset = 0 } = {}
  ) => {
    const built = buildCurrentInventoryWhere(shift_id, {
      search, locator_code, item_code, assigned_locators,
    });

    const safeLimit  = Math.min(Math.max(parseInt(limit, 10) || 500, 1), 5000);
    const safeOffset = Math.max(0, parseInt(offset, 10) || 0);

    const params = [...built.params];
    params.push(safeLimit);
    const limitIdx = params.length - 1;
    params.push(safeOffset);
    const offsetIdx = params.length - 1;

    return query(
      `SELECT *
         FROM dbo.vw_underground_current_inventory
        WHERE ${built.where}
        ORDER BY locator_code, item_code
        OFFSET @param${offsetIdx} ROWS
        FETCH NEXT @param${limitIdx} ROWS ONLY`,
      params
    );
  },

  countCurrentInventory: async (
    shift_id,
    { search, locator_code, item_code, assigned_locators } = {}
  ) => {
    const built = buildCurrentInventoryWhere(shift_id, {
      search, locator_code, item_code, assigned_locators,
    });

    const rows = await query(
      `SELECT COUNT(*) AS total
         FROM dbo.vw_underground_current_inventory
        WHERE ${built.where}`,
      built.params
    );
    return Number(rows[0]?.total) || 0;
  },

  getCurrentInventorySummary: async (shift_id, { assigned_locators } = {}) => {
    const params = [shift_id];
    const conds = ['shift_id = @param0'];

    if (Array.isArray(assigned_locators) && assigned_locators.length > 0) {
      const placeholders = assigned_locators.map((code) => {
        params.push(String(code));
        return `@param${params.length - 1}`;
      });
      conds.push(`locator_code IN (${placeholders.join(', ')})`);
    }

    const rows = await query(
      `SELECT
         COUNT(*)                       AS line_count,
         COUNT(DISTINCT locator_code)   AS locator_count,
         COUNT(DISTINCT item_code)      AS item_count,
         ISNULL(SUM(beginning_qty), 0)  AS beginning_qty,
         ISNULL(SUM(released_qty), 0)   AS released_qty,
         ISNULL(SUM(qty_on_hand), 0)    AS qty_on_hand,
         ISNULL(SUM(total_value), 0)    AS total_value
       FROM dbo.vw_underground_current_inventory
       WHERE ${conds.join(' AND ')}`,
      params
    );
    return rows[0] || null;
  },

  listShifts: async ({ warehouse_id, status, handler_username, page = 1, limit = 50 } = {}) => {
    const params = [];
    const conds = [];

    if (warehouse_id != null) {
      params.push(warehouse_id);
      conds.push(`s.warehouse_id = @param${params.length - 1}`);
    }
    if (status) {
      params.push(status);
      conds.push(`s.status = @param${params.length - 1}`);
    }
    if (handler_username) {
      params.push(handler_username);
      conds.push(`s.handler_username = @param${params.length - 1}`);
    }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
    const safePage  = Math.max(parseInt(page, 10) || 1, 1);
    const offset    = (safePage - 1) * safeLimit;

    const countRows = await query(
      `SELECT COUNT(*) AS total FROM dbo.underground_shift s ${where}`,
      params
    );
    const total = countRows[0]?.total || 0;

    const listParams = [...params, offset, safeLimit];
    const offIdx = listParams.length - 2;
    const limIdx = listParams.length - 1;

    const rawRows = await query(
      `SELECT
         s.*,
         rt.issued_qty,
         rt.issued_val,
         rt.damaged_qty,
         rt.damaged_val,
         rt.trans_out_qty,
         rt.trans_out_val,
         rt.trans_in_qty,
         rt.trans_in_val,
         seed_log.performed_at   AS seed_imported_at,
         close_log.performed_at  AS closing_exported_at,
         recon_log.performed_at  AS reconciliation_log_at,
         recon_log.export_format AS reconciliation_format
       FROM dbo.underground_shift s
       LEFT JOIN (
         SELECT shift_id,
                SUM(CASE WHEN line_kind = 'Release' THEN qty ELSE 0 END) AS issued_qty,
                SUM(CASE WHEN line_kind = 'Release' THEN line_total ELSE 0 END) AS issued_val,
                SUM(CASE WHEN line_kind = 'Damage' THEN qty ELSE 0 END) AS damaged_qty,
                SUM(CASE WHEN line_kind = 'Damage' THEN line_total ELSE 0 END) AS damaged_val,
                SUM(CASE WHEN line_kind = 'Transfer-Out' THEN qty ELSE 0 END) AS trans_out_qty,
                SUM(CASE WHEN line_kind = 'Transfer-Out' THEN line_total ELSE 0 END) AS trans_out_val,
                SUM(CASE WHEN line_kind = 'Transfer-In' THEN qty ELSE 0 END) AS trans_in_qty,
                SUM(CASE WHEN line_kind = 'Transfer-In' THEN line_total ELSE 0 END) AS trans_in_val
           FROM dbo.underground_shift_lines
          GROUP BY shift_id
       ) rt ON rt.shift_id = s.shift_id
       LEFT JOIN dbo.locator_export_log seed_log
         ON seed_log.export_id = s.seed_log_id
       LEFT JOIN dbo.locator_export_log close_log
         ON close_log.export_id = s.closing_log_id
       LEFT JOIN dbo.locator_export_log recon_log
         ON recon_log.export_id = s.reconciliation_log_id
       ${where}
       ORDER BY s.started_at DESC, s.shift_id DESC
       OFFSET @param${offIdx} ROWS FETCH NEXT @param${limIdx} ROWS ONLY`,
      listParams
    );

    const rows = rawRows.map((r) => {
      const { 
        issued_qty, issued_val, damaged_qty, damaged_val, 
        trans_out_qty, trans_out_val, trans_in_qty, trans_in_val, 
        ...rest 
      } = r;

      if (r.status !== 'Open') {
        return {
          ...rest,
          issued_qty: Number(issued_qty) || 0,
          issued_value: Number(issued_val) || 0,
          damaged_qty: Number(damaged_qty) || 0,
          damaged_value: Number(damaged_val) || 0,
          transfer_out_qty: Number(trans_out_qty) || 0,
          transfer_out_value: Number(trans_out_val) || 0,
          trans_in_qty: Number(trans_in_qty) || 0,
          trans_in_value: Number(trans_in_val) || 0,
        };
      }

      const relQty = (Number(issued_qty) || 0) + (Number(damaged_qty) || 0) + (Number(trans_out_qty) || 0);
      const relVal = (Number(issued_val) || 0) + (Number(damaged_val) || 0) + (Number(trans_out_val) || 0);
      const inQty  = Number(trans_in_qty) || 0;
      const inVal  = Number(trans_in_val) || 0;
      
      return {
        ...rest,
        issued_qty: Number(issued_qty) || 0,
        issued_value: Number(issued_val) || 0,
        damaged_qty: Number(damaged_qty) || 0,
        damaged_value: Number(damaged_val) || 0,
        transfer_out_qty: Number(trans_out_qty) || 0,
        transfer_out_value: Number(trans_out_val) || 0,
        trans_in_qty: inQty,
        trans_in_value: inVal,
        released_qty:   relQty,
        released_value: relVal,
        ending_qty:     round4(Number(r.beginning_qty)   - relQty + inQty),
        ending_value:   round4(Number(r.beginning_value) - relVal + inVal),
      };
    });

    const totalPages = Math.max(Math.ceil(total / safeLimit), 1);
    return { rows, total, page: safePage, limit: safeLimit, totalPages };
  },

  getShiftLines: async (shift_id, { kind, page = 1, limit = 50 } = {}) => {
    const params = [shift_id];
    const conds = ['shift_id = @param0'];

    if (kind) {
      params.push(kind);
      conds.push(`line_kind = @param${params.length - 1}`);
    }
    const where = `WHERE ${conds.join(' AND ')}`;

    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
    const safePage  = Math.max(parseInt(page, 10) || 1, 1);
    const offset    = (safePage - 1) * safeLimit;

    const countRows = await query(
      `SELECT COUNT(*) AS total FROM dbo.underground_shift_lines ${where}`,
      params
    );
    const total = countRows[0]?.total || 0;

    const listParams = [...params, offset, safeLimit];
    const offIdx = listParams.length - 2;
    const limIdx = listParams.length - 1;

    const rows = await query(
      `SELECT *
         FROM dbo.underground_shift_lines
         ${where}
        ORDER BY line_kind, locator_code, item_code, line_id
        OFFSET @param${offIdx} ROWS FETCH NEXT @param${limIdx} ROWS ONLY`,
      listParams
    );

    const totalPages = Math.max(Math.ceil(total / safeLimit), 1);
    return { rows, total, page: safePage, limit: safeLimit, totalPages };
  },

  openShift: async ({
    warehouse_id,
    warehouse_code,
    handler_id,
    handler_username,
    handler_position,
    seed_log_id,
    seed_export_uid,
    seed_file_hash,
    seed_lines = [],
  }) => {
    if (!warehouse_id)     throw new Error('warehouse_id is required.');
    if (!warehouse_code)   throw new Error('warehouse_code is required.');
    if (!handler_username) throw new Error('handler_username is required.');
    if (!Array.isArray(seed_lines) || seed_lines.length === 0) {
      throw new Error('seed_lines must be a non-empty array.');
    }

    const pool = await ensurePool();
    const tx   = new sql.Transaction(pool);
    await tx.begin();

    try {
      const guard = await new sql.Request(tx)
        .input('warehouse_id',     sql.Int,          Number(warehouse_id))
        .input('handler_username', sql.NVarChar(50), handler_username)
        .query(`
          SELECT shift_id FROM dbo.underground_shift WITH (UPDLOCK, HOLDLOCK)
           WHERE warehouse_id     = @warehouse_id
             AND handler_username = @handler_username
             AND status           = 'Open'
        `);
      if (guard.recordset.length) {
        throw new Error(
          `You already have an open shift at ${warehouse_code} ` +
          `(shift_id=${guard.recordset[0].shift_id}). ` +
          `Close it before opening a new one.`
        );
      }

      const begLocators = new Set();
      const begItems    = new Set();
      let begQty = 0, begVal = 0;
      for (const l of seed_lines) {
        begLocators.add(l.locator_code);
        begItems.add(l.item_code);
        begQty += Number(l.qty)        || 0;
        begVal += Number(l.line_total) || 0;
      }

      const insRes = await new sql.Request(tx)
        .input('warehouse_id',     sql.Int,           Number(warehouse_id))
        .input('warehouse_code',   sql.NVarChar(20),  warehouse_code)
        .input('handler_id',       sql.Int,           handler_id ?? null)
        .input('handler_username', sql.NVarChar(50),  handler_username)
        .input('handler_position', sql.NVarChar(100), handler_position ?? null)
        .input('seed_log_id',      sql.Int,           seed_log_id ?? null)
        .input('seed_export_uid',  sql.NVarChar(30),  seed_export_uid ?? null)
        .input('seed_file_hash',   sql.NVarChar(100), seed_file_hash ?? null)
        .input('beg_loc_count',    sql.Int,           begLocators.size)
        .input('beg_item_count',   sql.Int,           begItems.size)
        .input('beg_qty',          sql.Decimal(18,4), round4(begQty))
        .input('beg_val',          sql.Decimal(18,4), round4(begVal))
        .query(`
          INSERT INTO dbo.underground_shift
            (warehouse_id, warehouse_code, handler_id, handler_username, handler_position,
             seed_log_id, seed_export_uid, seed_file_hash,
             status, beginning_locator_count, beginning_item_count,
             beginning_qty, beginning_value, ending_qty, ending_value)
          OUTPUT INSERTED.shift_id
          VALUES
            (@warehouse_id, @warehouse_code, @handler_id, @handler_username, @handler_position,
             @seed_log_id, @seed_export_uid, @seed_file_hash,
             'Open', @beg_loc_count, @beg_item_count,
             @beg_qty, @beg_val, @beg_qty, @beg_val)
        `);
      const shift_id = insRes.recordset[0].shift_id;

      const tbl = new sql.Table('dbo.underground_shift_lines');
      tbl.create = false;
      tbl.columns.add('shift_id',       sql.Int,           { nullable: false });
      tbl.columns.add('line_kind',      sql.NVarChar(20),  { nullable: false });
      tbl.columns.add('locator_code',   sql.NVarChar(50),  { nullable: false });
      tbl.columns.add('locator_name',   sql.NVarChar(200), { nullable: true  });
      tbl.columns.add('item_code',      sql.NVarChar(50),  { nullable: false });
      tbl.columns.add('item_name',      sql.NVarChar(400), { nullable: true  });
      tbl.columns.add('uom',            sql.NVarChar(50),  { nullable: true  });
      tbl.columns.add('barcode',        sql.NVarChar(100), { nullable: true  });
      tbl.columns.add('category',       sql.NVarChar(100), { nullable: true  });
      tbl.columns.add('purchase_class', sql.NVarChar(100), { nullable: true  });
      tbl.columns.add('gl_class',       sql.NVarChar(20),  { nullable: true  });
      tbl.columns.add('qty',            sql.Decimal(18,4), { nullable: false });
      tbl.columns.add('unit_cost',      sql.Decimal(18,6), { nullable: false });
      tbl.columns.add('line_total',     sql.Decimal(18,4), { nullable: false });

      for (const l of seed_lines) {
        const qty   = Number(l.qty)        || 0;
        const cost  = Number(l.unit_cost)  || 0;
        const total = Number(l.line_total) || round4(qty * cost);
        tbl.rows.add(
          shift_id, 'Beginning',
          String(l.locator_code || ''),
          l.locator_name ?? null,
          String(l.item_code || ''),
          l.item_name ?? null,
          l.uom ?? null,
          l.barcode ?? null,
          l.category ?? null,
          l.purchase_class ?? null,
          l.gl_class ?? null,
          qty, cost, total
        );
      }

      await new sql.Request(tx).bulk(tbl);

      await tx.commit();
      return { shift_id };
    } catch (err) {
      try { await tx.rollback(); } catch { /* noop */ }
      throw err;
    }
  },

  releaseLines: async ({ shift_id, released_by, lines = [] }) => {
    if (!shift_id)    throw new Error('shift_id is required.');
    if (!released_by) throw new Error('released_by is required.');
    if (!Array.isArray(lines) || lines.length === 0) {
      throw new Error('lines must be a non-empty array.');
    }

    const pool = await ensurePool();
    const tx   = new sql.Transaction(pool);
    await tx.begin();

    try {
      const sRes = await new sql.Request(tx)
        .input('shift_id', sql.Int, Number(shift_id))
        .query(`SELECT * FROM dbo.underground_shift WITH (UPDLOCK, HOLDLOCK) WHERE shift_id = @shift_id`);
      const shift = sRes.recordset[0];
      if (!shift)                     throw new Error(`Shift ${shift_id} not found.`);
      if (shift.status !== 'Open')    throw new Error(`Shift ${shift_id} is not Open (status=${shift.status}).`);

      const invRes = await new sql.Request(tx)
        .input('shift_id', sql.Int, Number(shift_id))
        .query(`
          SELECT locator_code, locator_name, item_code, item_name, uom, barcode,
                 category, purchase_class, gl_class, qty_on_hand, unit_cost
            FROM dbo.vw_underground_current_inventory
           WHERE shift_id = @shift_id
        `);

      const keyOf = (lc, ic) => `${lc}|${ic}`;
      const invMap = new Map();
      for (const r of invRes.recordset) invMap.set(keyOf(r.locator_code, r.item_code), r);

      const pending = new Map();
      for (const l of lines) {
        if (!l.locator_code) throw new Error('Each release line requires locator_code.');
        if (!l.item_code)    throw new Error('Each release line requires item_code.');
        const qty = Number(l.qty);
        if (!(qty > 0))      throw new Error(`Line qty must be > 0 (got ${l.qty}).`);

        const k = keyOf(l.locator_code, l.item_code);
        const avail = invMap.get(k);
        if (!avail) throw new Error(`No underground stock for locator=${l.locator_code} item=${l.item_code}.`);

        const already = pending.get(k) || 0;
        const remaining = Number(avail.qty_on_hand) - already;
        if (qty > remaining) {
          throw new Error(
            `Insufficient underground stock for locator=${l.locator_code} item=${l.item_code}. ` +
            `Available: ${remaining}, requested: ${qty}.`
          );
        }
        pending.set(k, already + qty);
      }

      const tbl = new sql.Table('dbo.underground_shift_lines');
      tbl.create = false;
      tbl.columns.add('shift_id',       sql.Int,           { nullable: false });
      tbl.columns.add('line_kind',      sql.NVarChar(20),  { nullable: false });
      tbl.columns.add('locator_code',   sql.NVarChar(50),  { nullable: false });
      tbl.columns.add('locator_name',   sql.NVarChar(200), { nullable: true  });
      tbl.columns.add('item_code',      sql.NVarChar(50),  { nullable: false });
      tbl.columns.add('item_name',      sql.NVarChar(400), { nullable: true  });
      tbl.columns.add('uom',            sql.NVarChar(50),  { nullable: true  });
      tbl.columns.add('barcode',        sql.NVarChar(100), { nullable: true  });
      tbl.columns.add('category',       sql.NVarChar(100), { nullable: true  });
      tbl.columns.add('purchase_class', sql.NVarChar(100), { nullable: true  });
      tbl.columns.add('gl_class',       sql.NVarChar(20),  { nullable: true  });
      tbl.columns.add('qty',            sql.Decimal(18,4), { nullable: false });
      tbl.columns.add('unit_cost',      sql.Decimal(18,6), { nullable: false });
      tbl.columns.add('line_total',     sql.Decimal(18,4), { nullable: false });
      tbl.columns.add('released_at',    sql.DateTime2,     { nullable: true  });
      tbl.columns.add('released_by',    sql.NVarChar(50),  { nullable: true  });
      tbl.columns.add('destination',    sql.NVarChar(200), { nullable: true  });
      tbl.columns.add('remarks',        sql.NVarChar(500), { nullable: true  });

      const now = new Date();
      for (const l of lines) {
        const k = keyOf(l.locator_code, l.item_code);
        const avail = invMap.get(k);
        const qty   = Number(l.qty);
        const cost  = Number(avail.unit_cost) || 0;
        const total = round4(qty * cost);
        tbl.rows.add(
          shift_id, 'Release',
          String(l.locator_code),
          avail.locator_name ?? null,
          String(l.item_code),
          avail.item_name ?? null,
          avail.uom ?? null,
          avail.barcode ?? null,
          avail.category ?? null,
          avail.purchase_class ?? null,
          avail.gl_class ?? null,
          qty, cost, total,
          now, released_by,
          l.destination ?? null,
          l.remarks ?? null
        );
      }

      await new sql.Request(tx).bulk(tbl);

      await tx.commit();
      return { inserted: lines.length };
    } catch (err) {
      try { await tx.rollback(); } catch { /* noop */ }
      throw err;
    }
  },

  closeShift: async ({ shift_id, notes = null }) => {
    if (!shift_id) throw new Error('shift_id is required.');

    const pool = await ensurePool();
    const tx   = new sql.Transaction(pool);
    await tx.begin();

    try {
      const sRes = await new sql.Request(tx)
        .input('shift_id', sql.Int, Number(shift_id))
        .query(`SELECT * FROM dbo.underground_shift WITH (UPDLOCK, HOLDLOCK) WHERE shift_id = @shift_id`);
      const shift = sRes.recordset[0];
      if (!shift)                  throw new Error(`Shift ${shift_id} not found.`);
      if (shift.status !== 'Open') throw new Error(`Shift ${shift_id} is not Open (status=${shift.status}).`);

      const tRes = await new sql.Request(tx)
        .input('shift_id', sql.Int, Number(shift_id))
        .query(`
          SELECT
            ISNULL(SUM(CASE WHEN line_kind IN ('Release', 'Damage', 'Transfer-Out') THEN qty END), 0) AS out_qty,
            ISNULL(SUM(CASE WHEN line_kind IN ('Release', 'Damage', 'Transfer-Out') THEN line_total END), 0) AS out_val,
            ISNULL(SUM(CASE WHEN line_kind = 'Transfer-In' THEN qty END), 0) AS in_qty,
            ISNULL(SUM(CASE WHEN line_kind = 'Transfer-In' THEN line_total END), 0) AS in_val,
            COUNT(CASE WHEN line_kind IN ('Release', 'Damage', 'Transfer-Out') THEN 1 END) AS release_lines
          FROM dbo.underground_shift_lines
          WHERE shift_id = @shift_id
        `);
      const t = tRes.recordset[0];

      const relQty = round4(t.out_qty);
      const relVal = round4(t.out_val);
      const inQty  = round4(t.in_qty);
      const inVal  = round4(t.in_val);

      const endQty = round4(Number(shift.beginning_qty) - relQty + inQty);
      const endVal = round4(Number(shift.beginning_value) - relVal + inVal);

      const updRes = await new sql.Request(tx)
        .input('shift_id',  sql.Int,           Number(shift_id))
        .input('rel_qty',   sql.Decimal(18,4), relQty)
        .input('rel_val',   sql.Decimal(18,4), relVal)
        .input('rel_lines', sql.Int,           Number(t.release_lines))
        .input('end_qty',   sql.Decimal(18,4), endQty)
        .input('end_val',   sql.Decimal(18,4), endVal)
        .input('notes',     sql.NVarChar(500), notes)
        .query(`
          UPDATE dbo.underground_shift
             SET status = 'Closed',
                 ended_at = SYSUTCDATETIME(),
                 sync_token = COALESCE(sync_token, NEWID()),
                 release_line_count = @rel_lines,
                 released_qty       = @rel_qty,
                 released_value     = @rel_val,
                 ending_qty         = @end_qty,
                 ending_value       = @end_val,
                 notes              = COALESCE(@notes, notes)
          OUTPUT INSERTED.sync_token
           WHERE shift_id = @shift_id
        `);

      const syncToken = updRes.recordset[0]?.sync_token || null;

      await tx.commit();
      return {
        shift_id,
        released_qty:       relQty,
        released_value:     relVal,
        release_line_count: Number(t.release_lines),
        ending_qty:         endQty,
        ending_value:       endVal,
        sync_token:         syncToken,
      };
    } catch (err) {
      try { await tx.rollback(); } catch { /* noop */ }
      throw err;
    }
  },

  reconcileShift: async ({ shift_id, reconciled_by_username, reconciliation_log_id = null }) => {
    if (!shift_id)               throw new Error('shift_id is required.');
    if (!reconciled_by_username) throw new Error('reconciled_by_username is required.');

    const pool = await ensurePool();
    const tx   = new sql.Transaction(pool);
    await tx.begin();

    try {
      const sRes = await new sql.Request(tx)
        .input('shift_id', sql.Int, Number(shift_id))
        .query(`SELECT * FROM dbo.underground_shift WITH (UPDLOCK, HOLDLOCK) WHERE shift_id = @shift_id`);
      const shift = sRes.recordset[0];
      if (!shift)                        throw new Error(`Shift ${shift_id} not found.`);
      if (shift.status === 'Reconciled') throw new Error(`Shift ${shift_id} is already Reconciled.`);
      if (shift.status !== 'Closed')     throw new Error(`Shift ${shift_id} must be Closed first (status=${shift.status}).`);

      const linesRes = await new sql.Request(tx)
        .input('shift_id', sql.Int, Number(shift_id))
        .query(`
          SELECT * FROM dbo.underground_shift_lines
           WHERE shift_id = @shift_id AND line_kind IN ('Release', 'Damage', 'Transfer-Out', 'Transfer-In')
           ORDER BY line_id
        `);

      const applied = await applyReleaseLinesToStock(tx, {
        warehouse_id:   shift.warehouse_id,
        warehouse_code: shift.warehouse_code,
        release_lines:  linesRes.recordset,
        reference_no:   shift.closing_export_uid || shift.seed_export_uid || `SHIFT-${shift.shift_id}`,
        reference_id:   shift.shift_id,
        actor:          reconciled_by_username,
        remarks_prefix: `Underground shift #${shift.shift_id} reconciliation`,
      });

      await new sql.Request(tx)
        .input('shift_id',  sql.Int,          Number(shift_id))
        .input('actor',     sql.NVarChar(50), reconciled_by_username)
        .input('recon_log', sql.Int,          reconciliation_log_id)
        .query(`
          UPDATE dbo.underground_shift
             SET status = 'Reconciled',
                 reconciled_at = SYSUTCDATETIME(),
                 reconciled_by_username = @actor,
                 reconciliation_log_id  = @recon_log
           WHERE shift_id = @shift_id
        `);

      await tx.commit();
      return { reconciled_lines: applied };
    } catch (err) {
      try { await tx.rollback(); } catch { /* noop */ }
      throw err;
    }
  },

  reconcileFromParsedFile: async ({
    warehouse_id,
    warehouse_code,
    release_lines = [],
    reconciled_by_username,
    reference_no = null,
  }) => {
    if (!warehouse_id)           throw new Error('warehouse_id is required.');
    if (!warehouse_code)         throw new Error('warehouse_code is required.');
    if (!reconciled_by_username) throw new Error('reconciled_by_username is required.');
    
    const pool = await ensurePool();
    const tx   = new sql.Transaction(pool);
    await tx.begin();

    try {
      const applied = await applyReleaseLinesToStock(tx, {
        warehouse_id,
        warehouse_code,
        release_lines,
        reference_no,
        reference_id:   null,
        actor:          reconciled_by_username,
        remarks_prefix: reference_no
          ? `Underground reconcile from closing file ${reference_no}`
          : 'Underground reconcile from closing file',
      });

      await tx.commit();
      return { reconciled_lines: applied };
    } catch (err) {
      try { await tx.rollback(); } catch { /* noop */ }
      throw err;
    }
  },

  setClosingLog: async ({ shift_id, closing_log_id, closing_export_uid }) => {
    await query(
      `UPDATE dbo.underground_shift
          SET closing_log_id = @param0, closing_export_uid = @param1
        WHERE shift_id = @param2`,
      [closing_log_id, closing_export_uid, shift_id]
    );
  },

  getShiftBySyncToken: async (sync_token) => {
    if (!sync_token) return null;
    const rows = await query(
      `SELECT TOP 1 * FROM dbo.underground_shift WHERE sync_token = @param0`,
      [String(sync_token).trim()]
    );
    return rows[0] || null;
  },

  getSurfaceDeltasSince: async ({ warehouse_id, since, limit = 500 }) => {
    if (warehouse_id == null) throw new Error('warehouse_id is required.');
    if (!since)               throw new Error('since is required.');

    const sinceDate = since instanceof Date ? since : new Date(since);
    if (Number.isNaN(sinceDate.getTime())) {
      throw new Error('since must be a valid date.');
    }

    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 500, 1), 2000);

    return query(
      `SELECT TOP (${safeLimit})
         m.item_code,
         MAX(wi.item_name) AS item_name,
         MAX(wi.uom)       AS uom,
         SUM(m.qty_change) AS delta_qty,
         SUM(
           CASE WHEN m.qty_change > 0 THEN  m.movement_total_value
                ELSE                       -m.movement_total_value
           END
         ) AS delta_value,
         SUM(CASE WHEN m.qty_change > 0 THEN 1 ELSE 0 END) AS receive_count,
         SUM(CASE WHEN m.qty_change < 0 THEN 1 ELSE 0 END) AS release_count,
         MAX(m.acted_at)   AS last_movement_at
       FROM dbo.warehouse_inventory_movements m
       LEFT JOIN dbo.warehouse_inventory wi
         ON wi.warehouse_id = m.warehouse_id
        AND wi.item_code    = m.item_code
       WHERE m.warehouse_id = @param0
         AND m.acted_at     >= @param1
         AND ISNULL(m.reference_type, '') <> 'UndergroundReconciliation'
       GROUP BY m.item_code
       HAVING SUM(m.qty_change) <> 0
       ORDER BY m.item_code`,
      [warehouse_id, sinceDate]
    );
  },

  listAvailableSeeds: async ({ warehouse_code, days = 7, limit = 50, show_used = false }) => {
    if (!warehouse_code) throw new Error('warehouse_code is required.');

    const safeDays  = Math.min(Math.max(parseInt(days, 10) || 7, 1), 90);
    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);

    const params = [warehouse_code, safeDays];
    let usedClause = '';
    if (!show_used) {
      usedClause = 'AND s.shift_id IS NULL';
    }

    const listParams = [...params, safeLimit];

    return query(
      `SELECT TOP (@param${listParams.length - 1})
         l.export_id,
         l.export_uid,
         l.performed_at         AS exported_at,
         l.performed_by_username AS exported_by,
         l.filename,
         l.locator_count,
         l.item_row_count,
         l.total_qty,
         l.total_value,
         CASE WHEN s.shift_id IS NULL THEN 0 ELSE 1 END AS already_used,
         s.shift_id             AS used_by_shift_id
       FROM dbo.locator_export_log l
       LEFT JOIN dbo.underground_shift s
              ON s.seed_log_id = l.export_id
       WHERE l.direction = 'Export'
         AND ISNULL(l.action_type, '') <> 'Underground Shift Close'
         AND l.source_warehouse_code = @param0
         AND l.performed_at >= DATEADD(DAY, -@param1, SYSUTCDATETIME())
         ${usedClause}
       ORDER BY l.performed_at DESC`,
      listParams
    );
  },

  getActiveShift: async (warehouse_id, handler_username) => {
    if (warehouse_id == null)     throw new Error('warehouse_id is required.');
    if (!handler_username)        throw new Error('handler_username is required.');

    const open = await query(
      `SELECT TOP 1 * FROM dbo.underground_shift
        WHERE warehouse_id     = @param0
          AND handler_username = @param1
          AND status           = 'Open'
        ORDER BY shift_id DESC`,
      [warehouse_id, String(handler_username)]
    );
    if (open[0]) {
      const live = await computeLiveReleaseTotals(open[0].shift_id);
      return { shift: overlayLiveTotals(open[0], live), state: 'open' };
    }

    const closed = await query(
      `SELECT TOP 1 * FROM dbo.underground_shift
        WHERE warehouse_id     = @param0
          AND handler_username = @param1
          AND status           = 'Closed'
          AND reconciled_at IS NULL
        ORDER BY ended_at DESC, shift_id DESC`,
      [warehouse_id, String(handler_username)]
    );
    if (closed[0]) return { shift: closed[0], state: 'closed' };

    const reconciled = await query(
      `SELECT TOP 1 * FROM dbo.underground_shift
        WHERE warehouse_id     = @param0
          AND handler_username = @param1
          AND status           = 'Reconciled'
        ORDER BY reconciled_at DESC, shift_id DESC`,
      [warehouse_id, String(handler_username)]
    );
    if (reconciled[0]) return { shift: reconciled[0], state: 'reconciled' };

    return { shift: null, state: 'none' };
  },

  listPendingSyncsForWarehouse: async (warehouse_id, { limit = 50 } = {}) => {
    if (warehouse_id == null) throw new Error('warehouse_id is required.');
    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);

    return query(
      `SELECT TOP (@param1)
         s.shift_id,
         s.warehouse_id,
         s.warehouse_code,
         s.handler_id,
         s.handler_username,
         s.handler_position,
         s.status,
         s.started_at,
         s.ended_at,
         s.seed_export_uid,
         s.closing_export_uid,
         s.beginning_qty,
         s.beginning_value,
         s.release_line_count,
         s.released_qty,
         s.released_value,
         s.ending_qty,
         s.ending_value,
         s.sync_token,
         s.reconciliation_log_id,
         s.reconciled_at,
         s.reconciled_by_username
       FROM dbo.underground_shift s
       WHERE s.warehouse_id = @param0
         AND s.status = 'Closed'
         AND s.reconciled_at IS NULL
       ORDER BY s.ended_at DESC, s.shift_id DESC`,
      [warehouse_id, safeLimit]
    );
  },

  getShiftPayloadForPush: async (shift_id) => {
    const shiftRows = await query(
      `SELECT
         s.shift_id,
         s.sync_token,
         s.warehouse_id,
         s.warehouse_code,
         s.handler_username,
         s.handler_position,
         s.status,
         s.started_at,
         s.ended_at,
         s.beginning_qty,
         s.beginning_value,
         s.released_qty,
         s.released_value,
         s.release_line_count,
         s.ending_qty,
         s.ending_value,
         s.seed_export_uid,
         s.closing_export_uid,
         s.notes,
         w.warehouse_name
       FROM dbo.underground_shift s
       LEFT JOIN dbo.warehouse_table w ON w.warehouse_id = s.warehouse_id
       WHERE s.shift_id = @param0`,
      [shift_id]
    );
    const shift = shiftRows[0] || null;
    if (!shift) return null;

    const lines = await query(
      `SELECT line_id, line_kind, locator_code, locator_name, item_code, item_name,
              barcode, uom, category, purchase_class, gl_class,
              qty, unit_cost, line_total, released_at, released_by,
              destination, remarks
         FROM dbo.underground_shift_lines
        WHERE shift_id = @param0 AND line_kind IN ('Release', 'Damage', 'Transfer-Out', 'Transfer-In')
        ORDER BY line_id`,
      [shift_id]
    );

    return { shift, release_lines: lines };
  },

  markShiftReconciledLocally: async ({
    shift_id,
    sync_token,
    reconciled_by_username,
  }) => {
    if (!shift_id)               throw new Error('shift_id is required.');
    if (!reconciled_by_username) throw new Error('reconciled_by_username is required.');

    await query(
      `UPDATE dbo.underground_shift
          SET status = 'Reconciled',
              reconciled_at = SYSUTCDATETIME(),
              reconciled_by_username = @param0
        WHERE shift_id = @param1
          AND status = 'Closed'
          AND (@param2 IS NULL OR sync_token = @param2)`,
      [reconciled_by_username, shift_id, sync_token || null]
    );
  },

  applyRemoteReconcile: async ({
    sync_token,
    warehouse_code,
    release_lines,
    source_shift_id,
    source_server,
    handler_username,
    handler_position,
    source_totals = {},
  }) => {
    if (!sync_token)               throw new Error('sync_token is required.');
    if (!warehouse_code)           throw new Error('warehouse_code is required.');
    
    const existing = await query(
      `SELECT TOP 1 export_id, export_uid
         FROM dbo.locator_export_log
        WHERE sync_token = @param0`,
      [sync_token]
    );
    if (existing[0]) {
      return {
        already_synced: true,
        export_id:      existing[0].export_id,
        export_uid:     existing[0].export_uid,
        reconciled_lines: 0,
      };
    }

    const whRows = await query(
      `SELECT warehouse_id, warehouse_code, warehouse_name, status
         FROM dbo.warehouse_table
        WHERE UPPER(warehouse_code) = UPPER(@param0)`,
      [warehouse_code]
    );
    const wh = whRows[0] || null;
    if (!wh) {
      throw new Error(`Warehouse "${warehouse_code}" not found on this server.`);
    }
    if (String(wh.status || '').trim() === 'Deactivated') {
      throw new Error(`Warehouse "${warehouse_code}" is deactivated on this server.`);
    }

    const LocatorLogModel = require('../locatorLogModel');

    const pool = await ensurePool();
    const tx   = new sql.Transaction(pool);
    await tx.begin();

    try {
      const locatorSet = new Set(release_lines.map((l) => l.locator_code));
      const totalQty   = release_lines.reduce((s, l) => s + (Number(l.qty) || 0), 0);
      const totalValue = release_lines.reduce((s, l) => s + (Number(l.line_total) || 0), 0);

      const actorLabel = `[cross-db] ${handler_username || 'underground'}`;

      const log = await LocatorLogModel.createLog({
        direction:             'Import',
        action_type:           'Underground Reconciliation',
        export_format:         'CrossDB',
        source_warehouse_code: wh.warehouse_code,
        source_warehouse_name: wh.warehouse_name,
        target_warehouse_code: wh.warehouse_code,
        target_warehouse_name: wh.warehouse_name,
        performed_by_id:       null,
        performed_by_username: actorLabel,
        performed_by_role:     'Underground Handler',
        performed_by_position: handler_position || null,
        locator_count:         locatorSet.size,
        item_row_count:        release_lines.length,
        total_qty:             round4(totalQty),
        total_value:           round4(totalValue),
        filename:              null,
        file_hash:             null,
        file_size_bytes:       null,
        notes:                 `Cross-DB online sync · shift #${source_shift_id || '?'} `
                             + `from ${source_server || 'underground'} · handler ${handler_username || '?'}`,
        linked_export_id:      null,
        sync_token,
      }, [], tx);

      const applied = await applyReleaseLinesToStock(tx, {
        warehouse_id:   wh.warehouse_id,
        warehouse_code: wh.warehouse_code,
        release_lines,
        reference_no:   sync_token,
        reference_id:   log.export_id,
        actor:          actorLabel,
        remarks_prefix: `Cross-DB sync of shift #${source_shift_id || '?'}`,
      });

      // ============================================================
      // MIRROR THE SHIFT TO THE SURFACE DATABASE
      // ============================================================
      const insShiftReq = new sql.Request(tx);
      insShiftReq.input('warehouse_id',       sql.Int,           wh.warehouse_id);
      insShiftReq.input('warehouse_code',     sql.NVarChar(20),  wh.warehouse_code);
      insShiftReq.input('handler_username',   sql.NVarChar(50),  handler_username || 'Cross-DB');
      insShiftReq.input('handler_position',   sql.NVarChar(100), handler_position || null);
      insShiftReq.input('seed_export_uid',    sql.NVarChar(30),  null);
      insShiftReq.input('closing_export_uid', sql.NVarChar(30),  String(source_shift_id) || null);
      insShiftReq.input('beg_qty',            sql.Decimal(18,4), Number(source_totals.beginning_qty) || 0);
      insShiftReq.input('beg_val',            sql.Decimal(18,4), Number(source_totals.beginning_value) || 0);
      insShiftReq.input('rel_qty',            sql.Decimal(18,4), Number(source_totals.released_qty) || totalQty);
      insShiftReq.input('rel_val',            sql.Decimal(18,4), Number(source_totals.released_value) || totalValue);
      insShiftReq.input('rel_lines',          sql.Int,           release_lines.length);
      insShiftReq.input('end_qty',            sql.Decimal(18,4), Number(source_totals.ending_qty) || 0);
      insShiftReq.input('end_val',            sql.Decimal(18,4), Number(source_totals.ending_value) || 0);
      insShiftReq.input('sync_token',         sql.UniqueIdentifier, sync_token);
      insShiftReq.input('recon_log_id',       sql.Int,           log.export_id);

      const shiftInsRes = await insShiftReq.query(`
        INSERT INTO dbo.underground_shift
          (warehouse_id, warehouse_code, handler_username, handler_position,
           seed_export_uid, closing_export_uid, status, started_at, ended_at,
           beginning_qty, beginning_value, released_qty, released_value, release_line_count,
           ending_qty, ending_value, sync_token, reconciled_at, reconciled_by_username,
           reconciliation_log_id)
        OUTPUT INSERTED.shift_id
        VALUES
          (@warehouse_id, @warehouse_code, @handler_username, @handler_position,
           @seed_export_uid, @closing_export_uid, 'Reconciled', SYSUTCDATETIME(), SYSUTCDATETIME(),
           @beg_qty, @beg_val, @rel_qty, @rel_val, @rel_lines,
           @end_qty, @end_val, @sync_token, SYSUTCDATETIME(), 'Cross-DB Sync',
           @recon_log_id)
      `);
      
      const newShiftId = shiftInsRes.recordset[0].shift_id;

      const tblLines = new sql.Table('dbo.underground_shift_lines');
      tblLines.create = false;
      tblLines.columns.add('shift_id',       sql.Int,           { nullable: false });
      tblLines.columns.add('line_kind',      sql.NVarChar(20),  { nullable: false });
      tblLines.columns.add('locator_code',   sql.NVarChar(50),  { nullable: false });
      tblLines.columns.add('locator_name',   sql.NVarChar(200), { nullable: true  });
      tblLines.columns.add('item_code',      sql.NVarChar(50),  { nullable: false });
      tblLines.columns.add('item_name',      sql.NVarChar(400), { nullable: true  });
      tblLines.columns.add('uom',            sql.NVarChar(50),  { nullable: true  });
      tblLines.columns.add('qty',            sql.Decimal(18,4), { nullable: false });
      tblLines.columns.add('unit_cost',      sql.Decimal(18,6), { nullable: false });
      tblLines.columns.add('line_total',     sql.Decimal(18,4), { nullable: false });
      tblLines.columns.add('destination',    sql.NVarChar(200), { nullable: true  });
      tblLines.columns.add('remarks',        sql.NVarChar(500), { nullable: true  });

      for (const l of release_lines) {
        tblLines.rows.add(
          newShiftId,
          l.line_kind || 'Release',
          l.locator_code,
          l.locator_name ?? null,
          l.item_code,
          l.item_name ?? null,
          l.uom ?? null,
          Number(l.qty) || 0,
          Number(l.unit_cost) || 0,
          Number(l.line_total) || 0,
          l.destination ?? null,
          l.remarks ?? null
        );
      }
      
      if (release_lines.length > 0) {
        await new sql.Request(tx).bulk(tblLines);
      }

      await tx.commit();

      return {
        already_synced:   false,
        export_id:        log.export_id,
        export_uid:       log.export_uid,
        reconciled_lines: applied,
      };
    } catch (err) {
      try { await tx.rollback(); } catch { /* noop */ }
      throw err;
    }
  },
};

module.exports = UndergroundModel;