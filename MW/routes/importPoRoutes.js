// routes/importPoRoutes.js
const express = require('express');
const router = express.Router();
const importPoController = require('../controllers/importPoController');
const { auth, authorize, requireWarehouse } = require('../middleware/auth');

router.use(auth);

router.post(
  '/',
  authorize(['Super Admin', 'Admin', 'Stock Registrar']),
  importPoController.importPurchaseOrders
);

router.post(
  '/check-duplicates',
  authorize(['Super Admin', 'Admin', 'Stock Registrar']),
  importPoController.checkDuplicatePOs
);

router.get(
  '/handler-items',
  requireWarehouse,
  importPoController.listHandlerItems
);

/* ============================================================
   RECEIVED PO'S — centralized registry for Admin / Super Admin.
   Must be declared BEFORE '/:po_no' so the literal paths win.
   ============================================================ */
router.get(
  '/received-lines',
  authorize(['Super Admin', 'Admin']),
  importPoController.listReceivedPOLines
);

router.get(
  '/received-trend',
  authorize(['Super Admin', 'Admin']),
  importPoController.getReceivedPOTrend
);

/* ============================================================
   WAREHOUSE ACTIVITY FEED — cross-PO chronological stream for
   one warehouse. Must come BEFORE '/:po_no' since it is a single
   segment.
   ============================================================ */
router.get(
  '/activity-feed',
  importPoController.getWarehouseActivityFeed
);

router.get(
  '/',
  importPoController.listPurchaseOrders
);

/* ============================================================
   PO ACTIVITY — enriched event stream from po_activity_log.
   ============================================================ */
router.get(
  '/:po_no/activity',
  importPoController.getPOActivity
);

router.get(
  '/:po_no',
  importPoController.getPurchaseOrderDetail
);

router.post(
  '/:po_no/receive',
  authorize(['Super Admin', 'Admin', 'Stock Registrar']),
  requireWarehouse,
  importPoController.receivePurchaseOrder
);

router.post(
  '/:po_no/forward',
  authorize(['Super Admin', 'Admin', 'Stock Registrar']),
  requireWarehouse,
  importPoController.forwardPurchaseOrder
);

router.post(
  '/:po_no/store',
  authorize(['Super Admin', 'Admin', 'Stock Handler']),
  requireWarehouse,
  importPoController.storePurchaseOrderLine
);

router.post(
  '/:po_no/release',
  authorize(['Super Admin', 'Admin', 'Stock Handler']),
  requireWarehouse,
  importPoController.releasePurchaseOrderLine
);

router.delete(
  '/:po_no',
  authorize(['Super Admin', 'Admin']),
  importPoController.deletePurchaseOrder
);

module.exports = router;