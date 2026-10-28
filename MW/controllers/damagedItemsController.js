// controllers/damagedItemsController.js
const DamagedItemsModel = require('../models/damagedItemsModel');
const { sql, pool, poolConnect } = require('../db');

const sendServerError = (res, error) => {
  console.error('❌ damagedItemsController error:', error);
  return res.status(500).json({
    success: false,
    message: 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
  });
};

/* ============================================================
   SCOPE RESOLVER

   Admin / Super Admin  → unrestricted, honour ?warehouse_id
   Stock Registrar /    → forced to their assigned warehouse
   Stock Handler
   Anyone else          → -1 (matches no rows)
   ============================================================ */
const resolveScopedWarehouseId = (req, requestedWarehouseId) => {
  const role = req.user?.role;

  if (role === 'Admin' || role === 'Super Admin') {
    if (requestedWarehouseId != null && requestedWarehouseId !== '') {
      const n = Number(requestedWarehouseId);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  }

  if (role === 'Stock Registrar' || role === 'Stock Handler') {
    const assigned = Number(req.user?.warehouse_assigned);
    return Number.isFinite(assigned) && assigned > 0 ? assigned : -1;
  }

  return -1;
};

/* ============================================================
   LIST — paginated + aggregated
   ============================================================ */
const listDamagedItems = async (req, res) => {
  try {
    const {
      start_date, end_date,
      warehouse_id, item_code, source_type,
      page  = 1,
      limit = 50,
    } = req.query;

    const scopedWarehouseId = resolveScopedWarehouseId(req, warehouse_id);

    const filters = {
      start_date,
      end_date,
      warehouse_id: scopedWarehouseId,
      item_code,
      source_type,
    };

    const countsFilters = { ...filters, source_type: undefined };

    const [listResult, totals, warehouses, sourceCounts] = await Promise.all([
      DamagedItemsModel.listPaginated({ ...filters, page, limit }),
      DamagedItemsModel.getTotals(filters),
      DamagedItemsModel.listWarehousesWithDamage(filters),
      DamagedItemsModel.getSourceCounts(countsFilters),
    ]);

    const safePage  = Math.max(1, Number(page)  || 1);
    const safeLimit = Math.min(10000, Math.max(1, Number(limit) || 50));

    return res.status(200).json({
      success: true,
      data: listResult.rows,
      total: listResult.total,
      page: safePage,
      limit: safeLimit,
      totalPages: Math.max(1, Math.ceil(listResult.total / safeLimit)),
      totals,
      warehouses,
      source_counts: sourceCounts,
    });
  } catch (error) {
    return sendServerError(res, error);
  }
};

/* ============================================================
   TOTALS
   ============================================================ */
const getDamagedTotals = async (req, res) => {
  try {
    const { start_date, end_date, warehouse_id, item_code, source_type } = req.query;

    const scopedWarehouseId = resolveScopedWarehouseId(req, warehouse_id);

    const totals = await DamagedItemsModel.getTotals({
      start_date,
      end_date,
      warehouse_id: scopedWarehouseId,
      item_code,
      source_type,
    });
    return res.status(200).json({ success: true, data: totals });
  } catch (error) {
    return sendServerError(res, error);
  }
};

/* ============================================================
   TOP ITEMS
   ============================================================ */
const getTopDamagedItems = async (req, res) => {
  try {
    const { start_date, end_date, warehouse_id, item_code, source_type, limit } = req.query;

    const scopedWarehouseId = resolveScopedWarehouseId(req, warehouse_id);

    const rows = await DamagedItemsModel.getTopItems({
      start_date,
      end_date,
      warehouse_id: scopedWarehouseId,
      item_code,
      source_type,
      limit,
    });
    return res.status(200).json({ success: true, data: rows });
  } catch (error) {
    return sendServerError(res, error);
  }
};

/* ============================================================
   DAILY TREND
   ============================================================ */
const getDamagedTrend = async (req, res) => {
  try {
    const { start_date, end_date, warehouse_id, item_code, source_type, days } = req.query;

    const scopedWarehouseId = resolveScopedWarehouseId(req, warehouse_id);

    const rows = await DamagedItemsModel.getDailyTrend({
      start_date,
      end_date,
      warehouse_id: scopedWarehouseId,
      item_code,
      source_type,
      days,
    });
    return res.status(200).json({ success: true, data: rows });
  } catch (error) {
    return sendServerError(res, error);
  }
};

/* ============================================================
   WAREHOUSE SUMMARY
   ============================================================ */
const getDamagedWarehouses = async (req, res) => {
  try {
    const { start_date, end_date, warehouse_id, item_code, source_type } = req.query;

    const scopedWarehouseId = resolveScopedWarehouseId(req, warehouse_id);

    const rows = await DamagedItemsModel.listWarehousesWithDamage({
      start_date,
      end_date,
      warehouse_id: scopedWarehouseId,
      item_code,
      source_type,
    });
    return res.status(200).json({ success: true, data: rows });
  } catch (error) {
    return sendServerError(res, error);
  }
};

/* ============================================================
   RECORD MANUAL ADJUSTMENT

   Body:
     {
       warehouse_id?,          // required for Admin / Super Admin;
                               // ignored (and silently overridden)
                               // for Handler / Registrar
       locator_code,           // source locator holding the item
       item_code,              // item being written off
       qty,                    // units to write off (> 0)
       reason                  // free-text explanation (required)
     }

   Everything runs in one transaction. Any failure rolls back
   the locator decrement, the on_hand decrement, the DAMAGE-XX
   locator upsert, and the writeoff row together.
   ============================================================ */
const recordManualAdjustment = async (req, res) => {
  try {
    const {
      locator_code,
      item_code,
      qty,
      reason,
    } = req.body || {};

    /* ---- Resolve the target warehouse ---- */
    const scopedWarehouseId = resolveScopedWarehouseId(req, req.body?.warehouse_id);

    if (scopedWarehouseId == null) {
      return res.status(400).json({
        success: false,
        message:
          'A specific warehouse is required. Admin / Super Admin must pass `warehouse_id`; other roles need an assigned warehouse.',
      });
    }
    if (scopedWarehouseId === -1) {
      return res.status(403).json({
        success: false,
        message: 'You are not assigned to any warehouse.',
      });
    }

    /* ---- Validate inputs ---- */
    if (!locator_code || !String(locator_code).trim()) {
      return res.status(400).json({ success: false, message: 'A source locator is required.' });
    }
    if (!item_code || !String(item_code).trim()) {
      return res.status(400).json({ success: false, message: 'An item code is required.' });
    }
    const q = Number(qty);
    if (!Number.isFinite(q) || q <= 0) {
      return res.status(400).json({ success: false, message: 'Quantity must be greater than 0.' });
    }
    if (!reason || !String(reason).trim()) {
      return res.status(400).json({ success: false, message: 'A reason is required.' });
    }

    /* ---- Resolve warehouse_code from warehouse_id ---- */
    await poolConnect;
    const whReq = pool.request();
    whReq.input('id', sql.Int, Number(scopedWarehouseId));
    const whRes = await whReq.query(`
      SELECT warehouse_id, warehouse_code, status
        FROM warehouse_table
       WHERE warehouse_id = @id
    `);
    const wh = whRes.recordset[0];
    if (!wh) {
      return res.status(400).json({ success: false, message: 'Warehouse not found.' });
    }
    if (wh.status !== 'Active') {
      return res.status(400).json({ success: false, message: `Warehouse ${wh.warehouse_code} is not active.` });
    }

    /* ---- Run the whole write-off inside one transaction ---- */
    const tx = new sql.Transaction(pool);
    await tx.begin();
    let result;
    try {
      result = await DamagedItemsModel.recordManualWriteoff(tx, {
        warehouse_id:   wh.warehouse_id,
        warehouse_code: wh.warehouse_code,
        locator_code:   String(locator_code).trim(),
        item_code:      String(item_code).trim(),
        qty:            q,
        reason:         String(reason).trim(),
        actor:          req.user?.username || 'System',
      });
      await tx.commit();
    } catch (txErr) {
      try { await tx.rollback(); } catch { /* ignore */ }
      throw txErr;
    }

    return res.status(201).json({
      success: true,
      message:
        `Wrote off ${result.qty_written_off} × ${item_code} from ${result.source_locator_code} ` +
        `(moved to ${result.damage_locator_code}).`,
      data: result,
    });
  } catch (error) {
    /* ---- Known user-facing errors → 400 ---- */
    const msg = String(error?.message || '');
    if (
      /Write-off qty|warehouse_id and warehouse_code|source locator|item code|reason is required|item master|does not hold|Cannot write off/i.test(msg)
    ) {
      return res.status(400).json({ success: false, message: msg });
    }
    return sendServerError(res, error);
  }
};

module.exports = {
  listDamagedItems,
  getDamagedTotals,
  getTopDamagedItems,
  getDamagedTrend,
  getDamagedWarehouses,
  recordManualAdjustment,
};