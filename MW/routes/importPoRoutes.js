// routes/importPoRoutes.js
const express = require('express');
const router = express.Router();
const importPoController = require('../controllers/importPoController');
const { auth, authorize, requireWarehouse } = require('../middleware/auth');

// All routes require authentication
router.use(auth);

// ------------------------------------------------------------
// Import POs from Excel rows
// Admin only — importing is centralized.
// ------------------------------------------------------------
router.post(
  '/',
  authorize(['Super Admin', 'Admin']),
  importPoController.importPurchaseOrders
);

// ------------------------------------------------------------
// Pre-flight duplicate check (used by frontend BEFORE import)
// Admin only — same gate as the import route itself.
// ------------------------------------------------------------
router.post(
  '/check-duplicates',
  authorize(['Super Admin', 'Admin']),
  importPoController.checkDuplicatePOs
);

// ------------------------------------------------------------
// NEW: Handler view — one row per ITEM (import_po line) for
// the caller's warehouse. Must come BEFORE any '/:po_no' route
// so Express doesn't treat 'handler-items' as a po_no param.
// ------------------------------------------------------------
router.get(
  '/handler-items',
  requireWarehouse,
  importPoController.listHandlerItems
);

// ------------------------------------------------------------
// List POs (grouped by po_no) — GLOBAL list.
// ------------------------------------------------------------
router.get(
  '/',
  importPoController.listPurchaseOrders
);

// ------------------------------------------------------------
// Activity log for one PO
// Must be BEFORE '/:po_no' so it isn't shadowed.
// ------------------------------------------------------------
router.get(
  '/:po_no/activity',
  importPoController.getPOActivity
);

// ------------------------------------------------------------
// Detail of a single PO (all line items)
// ------------------------------------------------------------
router.get(
  '/:po_no',
  importPoController.getPurchaseOrderDetail
);

// ------------------------------------------------------------
// Receive a PO (partial or complete)
// requireWarehouse ensures req.warehouseId is set for Registrars.
// ------------------------------------------------------------
router.post(
  '/:po_no/receive',
  authorize(['Super Admin', 'Admin', 'Stock Registrar']),
  requireWarehouse,
  importPoController.receivePurchaseOrder
);

// ------------------------------------------------------------
// Forward only the caller's warehouse's received lines to the handler.
// ------------------------------------------------------------
router.post(
  '/:po_no/forward',
  authorize(['Super Admin', 'Admin', 'Stock Registrar']),
  requireWarehouse,
  importPoController.forwardPurchaseOrder
);

// ------------------------------------------------------------
// Delete a PO (only if all lines are still Pending)
// ------------------------------------------------------------
router.delete(
  '/:po_no',
  authorize(['Super Admin', 'Admin']),
  importPoController.deletePurchaseOrder
);

module.exports = router;