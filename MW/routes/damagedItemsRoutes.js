// routes/damagedItemsRoutes.js
const express = require('express');
const router = express.Router();
const damagedItemsController = require('../controllers/damagedItemsController');
const { auth, authorize } = require('../middleware/auth');

router.use(auth);

/* ============================================================
   Role gate

   Admin / Super Admin: global view (all warehouses)
   Stock Registrar:     auto-scoped to their own warehouse
   Stock Handler:       auto-scoped to their own warehouse

   The controller (`resolveScopedWarehouseId`) enforces the scoping.
   Even if a Handler/Registrar sends ?warehouse_id=, it's ignored.
   ============================================================ */
const ALLOWED_ROLES = ['Super Admin', 'Admin', 'Stock Registrar', 'Stock Handler'];

router.get('/',           authorize(ALLOWED_ROLES), damagedItemsController.listDamagedItems);
router.get('/totals',     authorize(ALLOWED_ROLES), damagedItemsController.getDamagedTotals);
router.get('/top-items',  authorize(ALLOWED_ROLES), damagedItemsController.getTopDamagedItems);
router.get('/trend',      authorize(ALLOWED_ROLES), damagedItemsController.getDamagedTrend);
router.get('/warehouses', authorize(ALLOWED_ROLES), damagedItemsController.getDamagedWarehouses);

/* ------------------------------------------------------------
   Manual adjustment — a write-off with no PO or STS to attach
   to. Used by the Inventory Locator tab to move stock from a
   regular locator into the warehouse's DAMAGE-XX hold.
   ------------------------------------------------------------ */
router.post('/manual',    authorize(ALLOWED_ROLES), damagedItemsController.recordManualAdjustment);

module.exports = router;