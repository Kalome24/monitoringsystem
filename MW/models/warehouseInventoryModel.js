// models/warehouseInventoryModel.js
const { sql, pool, poolConnect } = require('../db');

/* ============================================================
   STRICT ROUNDERS — 4dp for money, 6dp for unit cost averages
   ============================================================ */
const round4 = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 10000) / 10000;
};
const round6 = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 1e6) / 1e6;
};

class WarehouseInventoryModel {
  /* ============================================================
     READ
     ============================================================ */

  static async listInventory({ warehouse_id, search, limit = 500, offset = 0 } = {}) {
    await poolConnect;
    const request = pool.request();
    const conditions = ['wi.qty_on_hand > 0'];

    if (warehouse_id != null && warehouse_id !== '') {
      request.input('warehouse_id', sql.Int, Number(warehouse_id));
      conditions.push('wi.warehouse_id = @warehouse_id');
    }
    if (search && String(search).trim()) {
      request.input('search', sql.NVarChar(200), `%${String(search).trim()}%`);
      conditions.push('(wi.item_code LIKE @search OR wi.item_name LIKE @search)');
    }
    request.input('limit',  sql.Int, Number(limit)  || 500);
    request.input('offset', sql.Int, Math.max(0, Number(offset) || 0));

    const where = `WHERE ${conditions.join(' AND ')}`;

    const result = await request.query(`
      SELECT
             wi.inventory_id, wi.warehouse_id, wi.warehouse_code,
             wi.item_code, wi.item_name, wi.uom,
             wi.qty_on_hand, wi.qty_reserved,
             (wi.qty_on_hand - wi.qty_reserved) AS qty_available,
             wi.avg_unit_cost, wi.total_value,
             wi.last_updated_at,
             w.warehouse_name
        FROM warehouse_inventory wi
        LEFT JOIN warehouse_table w ON w.warehouse_id = wi.warehouse_id
        ${where}
       ORDER BY wi.item_code
       OFFSET @offset ROWS
       FETCH NEXT @limit ROWS ONLY
    `);
    return result.recordset;
  }

  static async countInventory({ warehouse_id, search } = {}) {
    await poolConnect;
    const request = pool.request();
    const conditions = ['wi.qty_on_hand > 0'];

    if (warehouse_id != null && warehouse_id !== '') {
      request.input('warehouse_id', sql.Int, Number(warehouse_id));
      conditions.push('wi.warehouse_id = @warehouse_id');
    }
    if (search && String(search).trim()) {
      request.input('search', sql.NVarChar(200), `%${String(search).trim()}%`);
      conditions.push('(wi.item_code LIKE @search OR wi.item_name LIKE @search)');
    }

    const result = await request.query(`
      SELECT COUNT(*) AS total
        FROM warehouse_inventory wi
        WHERE ${conditions.join(' AND ')}
    `);
    return Number(result.recordset[0]?.total) || 0;
  }

  static async getInventory({ warehouse_id, item_code }) {
    await poolConnect;
    const request = pool.request();
    request.input('warehouse_id', sql.Int, Number(warehouse_id));
    request.input('item_code',    sql.NVarChar(50), item_code);
    const result = await request.query(`
      SELECT * FROM warehouse_inventory
       WHERE warehouse_id = @warehouse_id AND item_code = @item_code
    `);
    return result.recordset[0] || null;
  }

  static async listMovements({
    warehouse_id,
    warehouse_code,
    item_code,
    reference_type,
    limit = 500,
    offset = 0,
  } = {}) {
    await poolConnect;
    const request = pool.request();
    const conditions = [];

    if (warehouse_code && String(warehouse_code).trim()) {
      request.input('warehouse_code', sql.NVarChar(20), String(warehouse_code).trim());
      conditions.push('m.warehouse_code = @warehouse_code');
    } else if (warehouse_id != null && warehouse_id !== '') {
      request.input('warehouse_id', sql.Int, Number(warehouse_id));
      conditions.push('m.warehouse_id = @warehouse_id');
    }
    if (item_code) {
      request.input('item_code', sql.NVarChar(50), item_code);
      conditions.push('m.item_code = @item_code');
    }
    if (reference_type && String(reference_type).trim()) {
      request.input('reference_type', sql.NVarChar(50), String(reference_type).trim());
      conditions.push('m.reference_type = @reference_type');
    }
    request.input('limit',  sql.Int, Number(limit)  || 500);
    request.input('offset', sql.Int, Math.max(0, Number(offset) || 0));

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await request.query(`
      SELECT m.*
        FROM warehouse_inventory_movements m
        ${where}
       ORDER BY m.acted_at DESC
       OFFSET @offset ROWS
       FETCH NEXT @limit ROWS ONLY
    `);
    return result.recordset;
  }

  static async countMovements({
    warehouse_id,
    warehouse_code,
    item_code,
    reference_type,
  } = {}) {
    await poolConnect;
    const request = pool.request();
    const conditions = [];

    if (warehouse_code && String(warehouse_code).trim()) {
      request.input('warehouse_code', sql.NVarChar(20), String(warehouse_code).trim());
      conditions.push('m.warehouse_code = @warehouse_code');
    } else if (warehouse_id != null && warehouse_id !== '') {
      request.input('warehouse_id', sql.Int, Number(warehouse_id));
      conditions.push('m.warehouse_id = @warehouse_id');
    }
    if (item_code) {
      request.input('item_code', sql.NVarChar(50), item_code);
      conditions.push('m.item_code = @item_code');
    }
    if (reference_type && String(reference_type).trim()) {
      request.input('reference_type', sql.NVarChar(50), String(reference_type).trim());
      conditions.push('m.reference_type = @reference_type');
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await request.query(`
      SELECT COUNT(*) AS total
        FROM warehouse_inventory_movements m
        ${where}
    `);
    return Number(result.recordset[0]?.total) || 0;
  }

  /* ============================================================
     WRITE (transactional) - STRICT 4/6 DECIMAL
     ============================================================ */

  static async applyMovement(tx, {
    warehouse_id,
    item_code,
    item_name,
    uom,
    movement_type,
    qty_change,
    unit_cost,
    reference_type = null,
    reference_id   = null,
    reference_no   = null,
    actor,
    remarks = null,
  }) {
    if (!warehouse_id)   throw new Error('warehouse_id is required.');
    if (!item_code)      throw new Error('item_code is required.');
    if (!movement_type)  throw new Error('movement_type is required.');

    const qc = Number(qty_change) || 0;
    if (qc === 0) throw new Error('qty_change cannot be zero.');

    // Warehouse code lookup
    const whReq = new sql.Request(tx);
    whReq.input('warehouse_id', sql.Int, Number(warehouse_id));
    const whRes = await whReq.query(`
      SELECT warehouse_code FROM warehouse_table WHERE warehouse_id = @warehouse_id
    `);
    const warehouse_code = whRes.recordset[0]?.warehouse_code;
    if (!warehouse_code) throw new Error(`Warehouse ${warehouse_id} not found.`);

    // Fetch or create inventory row
    const getReq = new sql.Request(tx);
    getReq.input('warehouse_id', sql.Int, Number(warehouse_id));
    getReq.input('item_code',    sql.NVarChar(50), item_code);
    const getRes = await getReq.query(`
      SELECT * FROM warehouse_inventory
       WHERE warehouse_id = @warehouse_id AND item_code = @item_code
    `);

    let row = getRes.recordset[0] || null;

    if (!row) {
      const insReq = new sql.Request(tx);
      insReq.input('warehouse_id',   sql.Int,           Number(warehouse_id));
      insReq.input('warehouse_code', sql.NVarChar(20),  warehouse_code);
      insReq.input('item_code',      sql.NVarChar(50),  item_code);
      insReq.input('item_name',      sql.NVarChar(400), item_name || null);
      insReq.input('uom',            sql.NVarChar(50),  uom || null);

      const insRes = await insReq.query(`
        INSERT INTO warehouse_inventory
          (warehouse_id, warehouse_code, item_code, item_name, uom,
           qty_on_hand, qty_reserved, avg_unit_cost, total_value)
        VALUES
          (@warehouse_id, @warehouse_code, @item_code, @item_name, @uom, 0, 0, 0, 0);
        SELECT * FROM warehouse_inventory
         WHERE warehouse_id = @warehouse_id AND item_code = @item_code;
      `);
      row = insRes.recordset[0];
    }

    const qtyBefore   = Number(row.qty_on_hand)   || 0;
    const avgBefore   = Number(row.avg_unit_cost) || 0;
    const valueBefore = Number(row.total_value)   || 0;

    let qtyAfter, avgAfter, valueAfter;
    let movement_unit_cost;
    let movement_total_value;

    if (qc > 0) {
      // ✅ ROUND everything to 4dp (or 6dp for avg cost)
      const incomingCost = round6(Number(unit_cost) || 0);
      const qcCost       = round4(qc * incomingCost);
      const newQty       = round4(qtyBefore + qc);
      const newValue     = round4(valueBefore + qcCost);

      qtyAfter   = newQty;
      avgAfter   = newQty > 0 ? round6(newValue / newQty) : 0;
      valueAfter = newValue;

      movement_unit_cost   = incomingCost;
      movement_total_value = qcCost;
    } else {
      const newQty = round4(qtyBefore + qc);
      if (newQty < 0) {
        throw new Error(
          `Insufficient stock for ${item_code} at warehouse ${warehouse_id}. ` +
          `Available: ${qtyBefore}, requested: ${Math.abs(qc)}.`
        );
      }

      const deductQty = round4(Math.abs(qc));

      // ✅ ROUND unit cost to 4dp, then deduct, then round result
      const avgBeforeTruncated = round4(avgBefore);
      const deductedValue      = round4(deductQty * avgBeforeTruncated);

      qtyAfter   = newQty;
      valueAfter = round4(valueBefore - deductedValue);

      avgAfter   = newQty > 0 ? round6(valueAfter / newQty) : 0;

      movement_unit_cost   = avgBeforeTruncated;
      movement_total_value = deductedValue;
    }

    const updReq = new sql.Request(tx);
    updReq.input('inventory_id', sql.BigInt,        row.inventory_id);
    updReq.input('qty_after',    sql.Decimal(18,4), qtyAfter);
    updReq.input('avg_after',    sql.Decimal(18,6), avgAfter);
    updReq.input('value_after',  sql.Decimal(18,4), valueAfter);
    updReq.input('item_name',    sql.NVarChar(400), item_name || row.item_name || null);
    updReq.input('uom',          sql.NVarChar(50),  uom || row.uom || null);

    await updReq.query(`
      UPDATE warehouse_inventory
         SET qty_on_hand    = @qty_after,
             avg_unit_cost  = @avg_after,
             total_value    = @value_after,
             item_name      = COALESCE(@item_name, item_name),
             uom            = COALESCE(@uom, uom),
             last_updated_at = GETDATE()
       WHERE inventory_id = @inventory_id
    `);

    const logReq = new sql.Request(tx);
    logReq.input('warehouse_id',         sql.Int,           Number(warehouse_id));
    logReq.input('warehouse_code',       sql.NVarChar(20),  warehouse_code);
    logReq.input('item_code',            sql.NVarChar(50),  item_code);
    logReq.input('movement_type',        sql.NVarChar(30),  movement_type);
    logReq.input('qty_change',           sql.Decimal(18,4), qc);
    logReq.input('qty_before',           sql.Decimal(18,4), qtyBefore);
    logReq.input('qty_after',            sql.Decimal(18,4), qtyAfter);
    logReq.input('unit_cost_before',     sql.Decimal(18,6), avgBefore);
    logReq.input('unit_cost_after',      sql.Decimal(18,6), avgAfter);
    logReq.input('value_before',         sql.Decimal(18,4), valueBefore);
    logReq.input('value_after',          sql.Decimal(18,4), valueAfter);
    logReq.input('movement_unit_cost',   sql.Decimal(18,6), movement_unit_cost);
    logReq.input('movement_total_value', sql.Decimal(18,4), movement_total_value);
    logReq.input('reference_type',       sql.NVarChar(30),  reference_type);
    logReq.input('reference_id',         sql.BigInt,        reference_id);
    logReq.input('reference_no',         sql.NVarChar(50),  reference_no);
    logReq.input('actor',                sql.NVarChar(100), actor || 'System');
    logReq.input('remarks',              sql.NVarChar(500), remarks);

    await logReq.query(`
      INSERT INTO warehouse_inventory_movements
        (warehouse_id, warehouse_code, item_code, movement_type,
         qty_change, qty_before, qty_after,
         unit_cost_before, unit_cost_after,
         value_before, value_after,
         movement_unit_cost, movement_total_value,
         reference_type, reference_id, reference_no,
         actor, remarks)
      VALUES
        (@warehouse_id, @warehouse_code, @item_code, @movement_type,
         @qty_change, @qty_before, @qty_after,
         @unit_cost_before, @unit_cost_after,
         @value_before, @value_after,
         @movement_unit_cost, @movement_total_value,
         @reference_type, @reference_id, @reference_no,
         @actor, @remarks)
    `);

    return {
      inventory_id:         row.inventory_id,
      qty_before:           qtyBefore,
      qty_after:            qtyAfter,
      avg_before:           avgBefore,
      avg_after:            avgAfter,
      value_before:         valueBefore,
      value_after:          valueAfter,
      movement_unit_cost,
      movement_total_value,
    };
  }

  static async applyReservation(tx, { warehouse_id, item_code, delta }) {
    if (!warehouse_id) throw new Error('warehouse_id is required.');
    if (!item_code)    throw new Error('item_code is required.');

    const d = Number(delta) || 0;

    if (d === 0) {
      const req0 = new sql.Request(tx);
      req0.input('warehouse_id', sql.Int,          Number(warehouse_id));
      req0.input('item_code',    sql.NVarChar(50), item_code);
      const r0 = await req0.query(`
        SELECT qty_on_hand, qty_reserved
          FROM warehouse_inventory
         WHERE warehouse_id = @warehouse_id AND item_code = @item_code
      `);
      const row0 = r0.recordset[0];
      return {
        qty_reserved_before: Number(row0?.qty_reserved) || 0,
        qty_reserved_after:  Number(row0?.qty_reserved) || 0,
        qty_available_after:
          (Number(row0?.qty_on_hand) || 0) - (Number(row0?.qty_reserved) || 0),
      };
    }

    const getReq = new sql.Request(tx);
    getReq.input('warehouse_id', sql.Int,          Number(warehouse_id));
    getReq.input('item_code',    sql.NVarChar(50), item_code);
    const getRes = await getReq.query(`
      SELECT inventory_id, qty_on_hand, qty_reserved
        FROM warehouse_inventory WITH (UPDLOCK, ROWLOCK)
       WHERE warehouse_id = @warehouse_id AND item_code = @item_code
    `);

    const row = getRes.recordset[0];
    if (!row) {
      throw new Error(
        `Cannot reserve: no inventory record for ${item_code} at warehouse ${warehouse_id}.`
      );
    }

    const onHand         = Number(row.qty_on_hand)  || 0;
    const reservedBefore = Number(row.qty_reserved) || 0;
    const available      = onHand - reservedBefore;

    if (d > 0 && available < d) {
      throw new Error(
        `Insufficient available stock for ${item_code} at warehouse ${warehouse_id}. ` +
        `Available: ${available} (on hand ${onHand}, reserved ${reservedBefore}), ` +
        `requested: ${d}.`
      );
    }
    if (d < 0 && reservedBefore < Math.abs(d)) {
      throw new Error(
        `Cannot release ${Math.abs(d)} reserved units for ${item_code} at warehouse ${warehouse_id}. ` +
        `Currently reserved: ${reservedBefore}.`
      );
    }

    const reservedAfter = reservedBefore + d;

    const updReq = new sql.Request(tx);
    updReq.input('inventory_id', sql.BigInt,        row.inventory_id);
    updReq.input('reserved',     sql.Decimal(18,4), reservedAfter);

    await updReq.query(`
      UPDATE warehouse_inventory
         SET qty_reserved    = @reserved,
             last_updated_at = GETDATE()
       WHERE inventory_id = @inventory_id
    `);

    return {
      qty_reserved_before: reservedBefore,
      qty_reserved_after:  reservedAfter,
      qty_available_after: onHand - reservedAfter,
    };
  }
}

module.exports = WarehouseInventoryModel;