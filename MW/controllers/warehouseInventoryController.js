// controllers/warehouseInventoryController.js
//
// Warehouse-scoped reads for the surface inventory tabs.
//
// Session 8 refactor:
//   • Every list endpoint now accepts `warehouse_code` in addition to
//     `warehouse_id`. warehouse_code is the preferred anchor — it's
//     what reports, activity feeds, and movement trails key off of.
//   • When both are supplied, warehouse_code wins.
//   • Non-admins are forced to their own assigned warehouse (they
//     cannot read another warehouse's data even if they try).
//   • Admins must specify a warehouse (by id or code) — no global
//     "everything" reads on a paginated list.
//   • /movements accepts an optional `reference_type` filter so the
//     admin can pull "just the STS movements" or "just the PO
//     movements" without a client-side post-filter.
//
// RED-FLAG FIX (this version):
//   • listInventory and listMovements previously returned
//     `total: rows.length` — a lie that made the UI think "500 of 500"
//     even when the underlying table had 3,000 rows. Pagination on
//     the frontend silently capped out at the limit, and any "Export
//     all" button that read `total` would only export the visible page.
//   • Now both endpoints:
//       1. Accept `page` (default 1) + `limit` (default 500)
//       2. Compute `offset = (page - 1) * limit`
//       3. Query the real COUNT via the model's countInventory /
//          countMovements (which shares the EXACT same WHERE clause)
//       4. Return the true { total, page, limit, totalPages }
//       5. Return rows for the requested page (OFFSET-based in model)
//   • The `limit` cap is now 5,000 (was 500) so an admin can request
//     a bigger slice without overloading the DB in one shot, but
//     larger datasets are properly paginated rather than truncated.
//
// BUG FIX (this version):
//   • `listMovements` now actually forwards `reference_type` to the
//     model. Previously the route documented this filter, and the
//     controller accepted it, but the model ignored it — the "show
//     only STS movements" toggle was a no-op.

const WarehouseInventoryModel = require('../models/warehouseInventoryModel');
const UserModel = require('../models/userModel');
const { query } = require('../db');

const isSuperAdmin = (u) => u?.user_role === 'Super Admin';
const isAdmin      = (u) => u?.user_role === 'Admin';

const getFreshUser = async (req) => {
  if (!req.user?.id) return null;
  try { return await UserModel.getUserById(req.user.id); } catch { return null; }
};

/* ------------------------------------------------------------
   Resolve the target warehouse for a read request.

   Returns { ok, warehouse_id?, warehouse_code?, error? }.

   Priority:
     1. Non-admin  → user's assigned warehouse (query ignored).
     2. Admin + warehouse_code → look up id, return both.
     3. Admin + warehouse_id   → look up code, return both.
     4. Admin + neither        → error.

   We always return BOTH id and code when possible so downstream
   callers don't need to re-look-up.
   ------------------------------------------------------------ */
const resolveWarehouse = async (me, req) => {
  if (!me) return { ok: false, error: 'User not found.', code: 401 };

  const globalUser = isSuperAdmin(me) || isAdmin(me);

  const qCode = req.query.warehouse_code && String(req.query.warehouse_code).trim()
    ? String(req.query.warehouse_code).trim()
    : null;
  const qId = req.query.warehouse_id != null && req.query.warehouse_id !== ''
    ? Number(req.query.warehouse_id)
    : null;

  /* ---- Non-admin: always their own warehouse. ---- */
  if (!globalUser) {
    if (!me.warehouse_assigned) {
      return { ok: false, error: 'You are not assigned to any warehouse.', code: 400 };
    }
    const rows = await query(
      `SELECT warehouse_id, warehouse_code
         FROM dbo.warehouse_table
        WHERE warehouse_id = @param0`,
      [me.warehouse_assigned]
    );
    const wh = rows[0];
    if (!wh) return { ok: false, error: 'Assigned warehouse not found.', code: 404 };
    return { ok: true, warehouse_id: wh.warehouse_id, warehouse_code: wh.warehouse_code };
  }

  /* ---- Admin: by code first, then id. ---- */
  if (qCode) {
    const rows = await query(
      `SELECT warehouse_id, warehouse_code, status
         FROM dbo.warehouse_table
        WHERE warehouse_code = @param0`,
      [qCode]
    );
    const wh = rows[0];
    if (!wh) return { ok: false, error: `Warehouse code "${qCode}" not found.`, code: 404 };
    return { ok: true, warehouse_id: wh.warehouse_id, warehouse_code: wh.warehouse_code };
  }

  if (qId != null && Number.isFinite(qId)) {
    const rows = await query(
      `SELECT warehouse_id, warehouse_code, status
         FROM dbo.warehouse_table
        WHERE warehouse_id = @param0`,
      [qId]
    );
    const wh = rows[0];
    if (!wh) return { ok: false, error: `Warehouse id ${qId} not found.`, code: 404 };
    return { ok: true, warehouse_id: wh.warehouse_id, warehouse_code: wh.warehouse_code };
  }

  return {
    ok: false,
    error: 'Admins must specify warehouse_code or warehouse_id.',
    code: 400,
  };
};

/* ------------------------------------------------------------
   Pagination parsing (shared by both list endpoints).
   - page:  1-indexed, minimum 1
   - limit: 1..5000, default 500
   - offset computed here
   ------------------------------------------------------------ */
const parsePagination = (req) => {
  const rawPage  = parseInt(req.query.page,  10);
  const rawLimit = parseInt(req.query.limit, 10);

  const page  = Number.isFinite(rawPage)  && rawPage  > 0 ? rawPage  : 1;
  const limit = Number.isFinite(rawLimit) && rawLimit > 0
    ? Math.min(5000, Math.max(1, rawLimit))
    : 500;
  const offset = (page - 1) * limit;

  return { page, limit, offset };
};

const warehouseInventoryController = {

  /* ============================================================
     GET /api/warehouse-inventory
     Query: ?warehouse_code= OR ?warehouse_id=,
            &search=, &page=, &limit=

     Response: { success, data, total, page, limit, totalPages, warehouse_code }
     ============================================================ */
  listInventory: async (req, res) => {
    try {
      const me = await getFreshUser(req);
      if (!me) return res.status(401).json({ success: false, message: 'User not found.' });

      const wh = await resolveWarehouse(me, req);
      if (!wh.ok) return res.status(wh.code).json({ success: false, message: wh.error });

      const { page, limit, offset } = parsePagination(req);

      // Run count + rows in parallel — they share the same WHERE
      // clause on the model side, so `total` always matches what
      // you'd get by concatenating every page.
      const [rows, total] = await Promise.all([
        WarehouseInventoryModel.listInventory({
          warehouse_id: wh.warehouse_id,
          search:       req.query.search,
          limit,
          offset,
        }),
        WarehouseInventoryModel.countInventory({
          warehouse_id: wh.warehouse_id,
          search:       req.query.search,
        }),
      ]);

      const totalPages = Math.max(1, Math.ceil(total / limit));

      return res.status(200).json({
        success: true,
        data: rows,
        total,
        page,
        limit,
        totalPages,
        warehouse_code: wh.warehouse_code,
      });
    } catch (err) {
      console.error('❌ warehouseInventory.listInventory:', err);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  },

  /* ============================================================
     GET /api/warehouse-inventory/:item_code
     Query: ?warehouse_code= OR ?warehouse_id=
     (Single item — no pagination needed.)
     ============================================================ */
  getInventory: async (req, res) => {
    try {
      const me = await getFreshUser(req);
      if (!me) return res.status(401).json({ success: false, message: 'User not found.' });

      const { item_code } = req.params;
      if (!item_code) {
        return res.status(400).json({ success: false, message: 'item_code is required.' });
      }

      const wh = await resolveWarehouse(me, req);
      if (!wh.ok) return res.status(wh.code).json({ success: false, message: wh.error });

      const row = await WarehouseInventoryModel.getInventory({
        warehouse_id: wh.warehouse_id,
        item_code,
      });
      if (!row) {
        return res.status(404).json({ success: false, message: 'Inventory not found.' });
      }

      return res.status(200).json({
        success: true,
        data: row,
        warehouse_code: wh.warehouse_code,
      });
    } catch (err) {
      console.error('❌ warehouseInventory.getInventory:', err);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  },

  /* ============================================================
     GET /api/warehouse-inventory/movements
     Query:
       ?warehouse_code= OR ?warehouse_id=    (required for admins)
       &item_code=                           (optional)
       &reference_type=                      (optional — 'PO' | 'STS' | 'UndergroundReconciliation' | ...)
       &page=                                (optional, default 1)
       &limit=                               (optional, default 500, max 5000)

     RED-FLAG FIX:
       Previously `reference_type` was silently dropped by the
       model, and `total: rows.length` was a fake count capped at
       `limit`. Both fixed — filter is honoured end-to-end, and
       `total` is a real COUNT that shares the WHERE clause with
       the page query.
     ============================================================ */
  listMovements: async (req, res) => {
    try {
      const me = await getFreshUser(req);
      if (!me) return res.status(401).json({ success: false, message: 'User not found.' });

      const wh = await resolveWarehouse(me, req);
      if (!wh.ok) return res.status(wh.code).json({ success: false, message: wh.error });

      const referenceType = req.query.reference_type && String(req.query.reference_type).trim()
        ? String(req.query.reference_type).trim()
        : null;

      const { page, limit, offset } = parsePagination(req);

      const [rows, total] = await Promise.all([
        WarehouseInventoryModel.listMovements({
          warehouse_id:   wh.warehouse_id,
          warehouse_code: wh.warehouse_code,
          item_code:      req.query.item_code,
          reference_type: referenceType,
          limit,
          offset,
        }),
        WarehouseInventoryModel.countMovements({
          warehouse_id:   wh.warehouse_id,
          warehouse_code: wh.warehouse_code,
          item_code:      req.query.item_code,
          reference_type: referenceType,
        }),
      ]);

      const totalPages = Math.max(1, Math.ceil(total / limit));

      return res.status(200).json({
        success: true,
        data: rows,
        total,
        page,
        limit,
        totalPages,
        warehouse_code: wh.warehouse_code,
      });
    } catch (err) {
      console.error('❌ warehouseInventory.listMovements:', err);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  },
};

module.exports = warehouseInventoryController;