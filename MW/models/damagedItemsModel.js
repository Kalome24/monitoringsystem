// models/damagedItemsModel.js
const { sql, pool, poolConnect } = require('../db');
const WarehouseInventoryModel   = require('./warehouseInventoryModel');

/**
 * DamagedItemsModel
 * -----------------
 * Wraps the `damage_writeoffs` table. Every time a damaged unit is
 * recorded anywhere in the pipeline (PO line store, STS receive, manual
 * adjustment), a row lands here so the money is never lost.
 *
 *   qty × unit_cost = total_value   ← the exact ₱ written off
 *
 * Callers MUST pass a transaction when inserting from a store/receive
 * flow so the write-off either succeeds with the movement or rolls back
 * with it.
 *
 * Warehouse-name resolution:
 *   Reads join `warehouse_table` on `warehouse_id` so every row and
 *   summary carries a friendly `warehouse_name` alongside the code.
 */
class DamagedItemsModel {
  /* ============================================================
     RECORD — insert a write-off row (must be inside a tx)
     ============================================================ */
  static async record(tx, {
    source_type,     // 'PO' | 'STS' | 'ADJUST'
    source_id = null,
    source_ref = null,
    line_ref = null,
    item_code,
    item_name = null,
    warehouse_id,
    warehouse_code,
    locator_code = null,
    qty,
    unit_cost,
    currency = null,
    reason = null,
    actor,
  }) {
    const q = Number(qty);
    const c = Number(unit_cost) || 0;
    if (!Number.isFinite(q) || q <= 0) {
      throw new Error('damage write-off qty must be greater than 0.');
    }
    if (!warehouse_id || !warehouse_code) {
      throw new Error('warehouse_id and warehouse_code are required.');
    }
    if (!item_code) {
      throw new Error('item_code is required.');
    }

    const total = Number((q * c).toFixed(4));

    const req = new sql.Request(tx);
    req.input('source_type',    sql.VarChar(10),   source_type);
    req.input('source_id',      sql.BigInt,        source_id);
    req.input('source_ref',     sql.VarChar(50),   source_ref);
    req.input('line_ref',       sql.BigInt,        line_ref);
    req.input('item_code',      sql.NVarChar(50),  item_code);
    req.input('item_name',      sql.NVarChar(400), item_name);
    req.input('warehouse_id',   sql.Int,           Number(warehouse_id));
    req.input('warehouse_code', sql.NVarChar(20),  warehouse_code);
    req.input('locator_code',   sql.NVarChar(50),  locator_code);
    req.input('qty',            sql.Decimal(18,4), q);
    req.input('unit_cost',      sql.Decimal(18,6), c);
    req.input('total_value',    sql.Decimal(18,4), total);
    req.input('currency',       sql.NVarChar(3),   currency);
    req.input('reason',         sql.NVarChar(500), reason);
    req.input('actor',          sql.NVarChar(100), actor || 'System');

    const res = await req.query(`
      INSERT INTO damage_writeoffs
        (source_type, source_id, source_ref, line_ref,
         item_code, item_name, warehouse_id, warehouse_code, locator_code,
         qty, unit_cost, total_value, currency, reason, actor, acted_at)
      VALUES
        (@source_type, @source_id, @source_ref, @line_ref,
         @item_code, @item_name, @warehouse_id, @warehouse_code, @locator_code,
         @qty, @unit_cost, @total_value, @currency, @reason, @actor, GETDATE());
      SELECT SCOPE_IDENTITY() AS writeoff_id;
    `);

    return {
      writeoff_id: res.recordset[0]?.writeoff_id,
      qty:         q,
      unit_cost:   c,
      total_value: total,
    };
  }

  /* ============================================================
     _ensureDamageLocator

     Same contract as the PO / STS helpers: return the existing
     Damage-type locator code for this warehouse, or create one.
     Duplicated here (rather than imported) to keep this model
     free of circular dependencies on the PO/STS domain models.
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

  /* ============================================================
     recordManualWriteoff  —  ADJUST-source damage

     Used by the Manual Adjustment modal on the Inventory Locator
     tab. Moves N units from a specific locator into the warehouse's
     DAMAGE-XX locator, decrements warehouse_inventory.on_hand, and
     writes a `damage_writeoffs` row with `source_type = 'ADJUST'`.
     All inside the caller's transaction.

     Preconditions (verified here, not trusted from the client):
       • locator row exists and holds >= qty of item_code
       • item_code exists in item_master (for name / uom)
     ============================================================ */
  static async recordManualWriteoff(tx, {
    warehouse_id,
    warehouse_code,
    locator_code,
    item_code,
    qty,
    reason,
    actor,
  }) {
    const q = Number(qty);
    if (!Number.isFinite(q) || q <= 0) {
      throw new Error('Write-off qty must be greater than 0.');
    }
    if (!warehouse_id || !warehouse_code) {
      throw new Error('warehouse_id and warehouse_code are required.');
    }
    if (!locator_code) {
      throw new Error('A source locator is required.');
    }
    if (!item_code) {
      throw new Error('An item code is required.');
    }
    if (!reason || !String(reason).trim()) {
      throw new Error('A reason is required for a manual write-off.');
    }

    /* ---- 1. Look up item master for name / uom ---- */
    const metaReq = new sql.Request(tx);
    metaReq.input('code', sql.NVarChar(50), item_code);
    const metaRes = await metaReq.query(`
      SELECT TOP 1 Item_Description, Uom_Code
        FROM item_master
       WHERE Item_Code = @code
    `);
    if (!metaRes.recordset[0]) {
      throw new Error(`Item "${item_code}" not found in item master.`);
    }
    const itemName = metaRes.recordset[0].Item_Description || null;
    const uom      = metaRes.recordset[0].Uom_Code         || null;

    /* ---- 2. Lock & read the source locator row ---- */
    const srcReq = new sql.Request(tx);
    srcReq.input('wh',  sql.NVarChar(20), warehouse_code);
    srcReq.input('it',  sql.NVarChar(50), item_code);
    srcReq.input('loc', sql.NVarChar(50), locator_code);
    const srcRes = await srcReq.query(`
      SELECT qty, avg_unit_cost, total_value
        FROM inventory_locator WITH (UPDLOCK, ROWLOCK)
       WHERE warehouse_code = @wh
         AND item_code      = @it
         AND locator_code   = @loc
    `);
    const srcRow = srcRes.recordset[0];
    if (!srcRow) {
      throw new Error(
        `Locator "${locator_code}" does not hold ${item_code}.`
      );
    }
    const srcQty   = Number(srcRow.qty) || 0;
    if (srcQty < q) {
      throw new Error(
        `Cannot write off ${q} — locator "${locator_code}" only holds ${srcQty} of ${item_code}.`
      );
    }
    const unitCost = Number(srcRow.avg_unit_cost) || 0;

    /* ---- 3. Decrement the source locator (avg unchanged) ---- */
    const newSrcQty = srcQty - q;
    const newSrcVal = Number((newSrcQty * unitCost).toFixed(4));
    const updSrcReq = new sql.Request(tx);
    updSrcReq.input('wh',  sql.NVarChar(20),  warehouse_code);
    updSrcReq.input('it',  sql.NVarChar(50),  item_code);
    updSrcReq.input('loc', sql.NVarChar(50),  locator_code);
    updSrcReq.input('q',   sql.Decimal(18,4), newSrcQty);
    updSrcReq.input('v',   sql.Decimal(18,4), newSrcVal);
    await updSrcReq.query(`
      UPDATE inventory_locator
         SET qty         = @q,
             total_value = @v,
             updated_at  = GETDATE()
       WHERE warehouse_code = @wh
         AND item_code      = @it
         AND locator_code   = @loc
    `);

    /* ---- 4. Decrement warehouse_inventory.on_hand ---- */
    /*      (applyMovement logs the movement row and keeps the      */
    /*       warehouse-level running average untouched — the unit   */
    /*       cost of the removed stock is already known.)           */
    await WarehouseInventoryModel.applyMovement(tx, {
      warehouse_id:   Number(warehouse_id),
      item_code,
      item_name:      itemName,
      uom,
      movement_type:  'Adjustment',
      qty_change:     -q,
      unit_cost:      unitCost,
      reference_type: 'ADJUST',
      reference_id:   null,
      reference_no:   null,
      actor:          actor || 'System',
      remarks:        `Manual damage write-off: ${q} × ${item_code} from ${locator_code}`,
    });

    /* ---- 5. Ensure the DAMAGE-XX locator exists ---- */
    const damageCode = await DamagedItemsModel._ensureDamageLocator(tx, warehouse_code);

    /* ---- 6. Upsert DAMAGE-XX locator (+qty at source avg cost) ---- */
    const dmgGetReq = new sql.Request(tx);
    dmgGetReq.input('wh',  sql.NVarChar(20), warehouse_code);
    dmgGetReq.input('it',  sql.NVarChar(50), item_code);
    dmgGetReq.input('loc', sql.NVarChar(50), damageCode);
    const dmgGetRes = await dmgGetReq.query(`
      SELECT qty, avg_unit_cost, total_value
        FROM inventory_locator
       WHERE warehouse_code = @wh
         AND item_code      = @it
         AND locator_code   = @loc
    `);

    const dCurQty = Number(dmgGetRes.recordset[0]?.qty)          || 0;
    const dCurAvg = Number(dmgGetRes.recordset[0]?.avg_unit_cost) || 0;
    const dNewQty = dCurQty + q;
    const dNewVal = (dCurQty * dCurAvg) + (q * unitCost);
    const dNewAvg = dNewQty > 0 ? Number((dNewVal / dNewQty).toFixed(6)) : 0;
    const dNewTot = Number((dNewQty * dNewAvg).toFixed(4));

    if (dmgGetRes.recordset[0]) {
      const dUpdReq = new sql.Request(tx);
      dUpdReq.input('wh',  sql.NVarChar(20),  warehouse_code);
      dUpdReq.input('it',  sql.NVarChar(50),  item_code);
      dUpdReq.input('loc', sql.NVarChar(50),  damageCode);
      dUpdReq.input('q',   sql.Decimal(18,4), dNewQty);
      dUpdReq.input('a',   sql.Decimal(18,6), dNewAvg);
      dUpdReq.input('v',   sql.Decimal(18,4), dNewTot);
      await dUpdReq.query(`
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
      const dInsReq = new sql.Request(tx);
      dInsReq.input('wh',  sql.NVarChar(20),  warehouse_code);
      dInsReq.input('it',  sql.NVarChar(50),  item_code);
      dInsReq.input('loc', sql.NVarChar(50),  damageCode);
      dInsReq.input('q',   sql.Decimal(18,4), dNewQty);
      dInsReq.input('a',   sql.Decimal(18,6), dNewAvg);
      dInsReq.input('v',   sql.Decimal(18,4), dNewTot);
      await dInsReq.query(`
        INSERT INTO inventory_locator
          (warehouse_code, item_code, locator_code, qty,
           avg_unit_cost, total_value, created_at, updated_at)
        VALUES
          (@wh, @it, @loc, @q, @a, @v, GETDATE(), GETDATE())
      `);
    }

    /* ---- 7. Write the damage_writeoffs row ---- */
    const writeoff = await DamagedItemsModel.record(tx, {
      source_type:    'ADJUST',
      source_id:      null,
      source_ref:     null,
      line_ref:       null,
      item_code,
      item_name:      itemName,
      warehouse_id:   Number(warehouse_id),
      warehouse_code,
      locator_code:   damageCode,
      qty:            q,
      unit_cost:      unitCost,
      currency:       'PHP',
      reason:         String(reason).trim(),
      actor:          actor || 'System',
    });

    return {
      writeoff_id:          writeoff.writeoff_id,
      damage_locator_code:  damageCode,
      qty_written_off:      q,
      unit_cost:            unitCost,
      total_value:          writeoff.total_value,
      source_locator_code:  locator_code,
      remaining_in_source:  newSrcQty,
    };
  }

  /* ============================================================
     Internal helper — build WHERE clause + inputs for filters.

     All conditions are prefixed with `d.` because every caller
     aliases the source table as `d` (needed for the JOIN to
     warehouse_table that resolves the friendly warehouse name).
     ============================================================ */
  static _buildFilters(request, {
    warehouse_id, item_code, source_type, source_ref,
    start_date, end_date,
  } = {}) {
    const conditions = [];

    if (warehouse_id != null && warehouse_id !== '') {
      request.input('warehouse_id', sql.Int, Number(warehouse_id));
      conditions.push('d.warehouse_id = @warehouse_id');
    }
    if (item_code && String(item_code).trim()) {
      request.input('item_code', sql.NVarChar(50), String(item_code).trim());
      conditions.push('d.item_code = @item_code');
    }
    if (source_type && source_type !== 'All') {
      request.input('source_type', sql.VarChar(10), source_type);
      conditions.push('d.source_type = @source_type');
    }
    if (source_ref && String(source_ref).trim()) {
      request.input('source_ref', sql.VarChar(50), String(source_ref).trim());
      conditions.push('d.source_ref = @source_ref');
    }
    if (start_date) {
      request.input('start_date', sql.Date, start_date);
      conditions.push('d.acted_at >= @start_date');
    }
    if (end_date) {
      request.input('end_date', sql.Date, end_date);
      conditions.push('d.acted_at < DATEADD(day, 1, @end_date)');
    }

    return conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  }

  /* ============================================================
     LIST — paginated
     ============================================================ */
  static async listPaginated({
    warehouse_id, item_code, source_type, source_ref,
    start_date, end_date,
    page = 1, limit = 50,
  } = {}) {
    await poolConnect;

    const safePage  = Math.max(1, Number(page)  || 1);
    const safeLimit = Math.min(10000, Math.max(1, Number(limit) || 50));
    const offset    = (safePage - 1) * safeLimit;

    const countReq = pool.request();
    const countWhere = DamagedItemsModel._buildFilters(countReq, {
      warehouse_id, item_code, source_type, source_ref, start_date, end_date,
    });
    const countRes = await countReq.query(`
      SELECT COUNT(*) AS total
        FROM damage_writeoffs d
        ${countWhere}
    `);
    const total = countRes.recordset[0]?.total || 0;

    const rowsReq = pool.request();
    const rowsWhere = DamagedItemsModel._buildFilters(rowsReq, {
      warehouse_id, item_code, source_type, source_ref, start_date, end_date,
    });
    rowsReq.input('offset', sql.Int, offset);
    rowsReq.input('limit',  sql.Int, safeLimit);

    const rowsRes = await rowsReq.query(`
      SELECT d.writeoff_id, d.source_type, d.source_id, d.source_ref, d.line_ref,
             d.item_code, d.item_name,
             d.warehouse_id, d.warehouse_code, d.locator_code,
             d.qty, d.unit_cost, d.total_value, d.currency,
             d.reason, d.actor, d.acted_at,
             w.warehouse_name AS warehouse_name
        FROM damage_writeoffs d
        LEFT JOIN warehouse_table w ON w.warehouse_id = d.warehouse_id
        ${rowsWhere}
       ORDER BY d.warehouse_code ASC, d.acted_at DESC, d.writeoff_id DESC
       OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `);

    return { rows: rowsRes.recordset, total };
  }

  /* ============================================================
     WAREHOUSE SUMMARY
     ============================================================ */
  static async listWarehousesWithDamage({
    warehouse_id, item_code, source_type, source_ref,
    start_date, end_date,
  } = {}) {
    await poolConnect;
    const request = pool.request();
    const where = DamagedItemsModel._buildFilters(request, {
      warehouse_id, item_code, source_type, source_ref, start_date, end_date,
    });

    const res = await request.query(`
      SELECT d.warehouse_id,
             d.warehouse_code,
             MAX(w.warehouse_name) AS warehouse_name,
             COUNT(*)              AS writeoff_count,
             ISNULL(SUM(d.qty), 0)         AS total_qty,
             ISNULL(SUM(d.total_value), 0) AS total_value
        FROM damage_writeoffs d
        LEFT JOIN warehouse_table w ON w.warehouse_id = d.warehouse_id
        ${where}
       GROUP BY d.warehouse_id, d.warehouse_code
       ORDER BY d.warehouse_code ASC
    `);
    return res.recordset;
  }

  /* ============================================================
     TOTALS
     ============================================================ */
  static async getTotals({
    warehouse_id, item_code, source_type, source_ref,
    start_date, end_date,
  } = {}) {
    await poolConnect;
    const request = pool.request();
    const where = DamagedItemsModel._buildFilters(request, {
      warehouse_id, item_code, source_type, source_ref, start_date, end_date,
    });

    const res = await request.query(`
      SELECT
        COUNT(*)                      AS writeoff_count,
        ISNULL(SUM(d.qty), 0)         AS total_qty,
        ISNULL(SUM(d.total_value), 0) AS total_value
        FROM damage_writeoffs d
        ${where}
    `);
    return res.recordset[0] || { writeoff_count: 0, total_qty: 0, total_value: 0 };
  }

  /* ============================================================
     SOURCE COUNTS — per-source counts for the sidebar

     Deliberately OMITS `source_type` from its own filters so it
     returns a count for EVERY source. Scoping (warehouse, dates,
     item) still applies, so non-admins see only their warehouse.
     ============================================================ */
  static async getSourceCounts({
    warehouse_id, item_code, source_ref,
    start_date, end_date,
  } = {}) {
    await poolConnect;
    const request = pool.request();
    const where = DamagedItemsModel._buildFilters(request, {
      warehouse_id, item_code, source_ref, start_date, end_date,
    });

    const res = await request.query(`
      SELECT d.source_type,
             COUNT(*)                      AS event_count,
             ISNULL(SUM(d.total_value), 0) AS total_value
        FROM damage_writeoffs d
        ${where}
       GROUP BY d.source_type
       ORDER BY d.source_type
    `);
    return res.recordset;
  }

  /* ============================================================
     TOP ITEMS
     ============================================================ */
  static async getTopItems({
    warehouse_id, item_code, source_type, source_ref,
    start_date, end_date,
    limit = 20,
  } = {}) {
    await poolConnect;
    const request = pool.request();
    const where = DamagedItemsModel._buildFilters(request, {
      warehouse_id, item_code, source_type, source_ref, start_date, end_date,
    });
    request.input('limit', sql.Int, Number(limit) || 20);

    const res = await request.query(`
      SELECT TOP (@limit)
             d.item_code,
             MAX(d.item_name)   AS item_name,
             SUM(d.qty)         AS total_qty,
             SUM(d.total_value) AS total_value,
             COUNT(*)           AS event_count
        FROM damage_writeoffs d
        ${where}
       GROUP BY d.item_code
       ORDER BY total_value DESC
    `);
    return res.recordset;
  }

  /* ============================================================
     DAILY TREND
     ============================================================ */
  static async getDailyTrend({
    warehouse_id, item_code, source_type, source_ref,
    start_date, end_date,
    days = 30,
  } = {}) {
    await poolConnect;
    const request = pool.request();

    if (!start_date && !end_date) {
      request.input('days', sql.Int, Number(days) || 30);
    }

    const filters = DamagedItemsModel._buildFilters(request, {
      warehouse_id, item_code, source_type, source_ref, start_date, end_date,
    });

    const dateClause = (!start_date && !end_date)
      ? `d.acted_at >= DATEADD(day, -@days, CAST(GETDATE() AS DATE))`
      : null;

    const where = [filters.replace(/^WHERE\s+/i, ''), dateClause]
      .filter(Boolean).join(' AND ');

    const res = await request.query(`
      SELECT
        CAST(d.acted_at AS DATE)      AS day,
        COUNT(*)                      AS event_count,
        ISNULL(SUM(d.qty), 0)         AS total_qty,
        ISNULL(SUM(d.total_value), 0) AS total_value
        FROM damage_writeoffs d
        ${where ? `WHERE ${where}` : ''}
       GROUP BY CAST(d.acted_at AS DATE)
       ORDER BY day ASC
    `);
    return res.recordset;
  }
}

module.exports = DamagedItemsModel;