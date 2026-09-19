// routes/stockTransferRoutes.js
const express = require('express');
const router = express.Router();
const stockTransferController = require('../controllers/stockTransferController');
const { auth, authorize, requireWarehouse } = require('../middleware/auth');

// All routes require authentication
router.use(auth);

// ------------------------------------------------------------
// Summary — must be defined BEFORE /:id so it isn't shadowed
// ------------------------------------------------------------
router.get(
  '/summary',
  stockTransferController.getSummary
);

// ------------------------------------------------------------
// Registrar-facing incoming queue
// (must ALSO come before /:id)
// ------------------------------------------------------------
router.get(
  '/incoming',
  requireWarehouse,
  stockTransferController.listIncomingSTSs
);

router.get(
  '/incoming-summary',
  requireWarehouse,
  stockTransferController.getIncomingSummary
);

// ------------------------------------------------------------
// Transferred qty lookup — also BEFORE /:id
// ------------------------------------------------------------
router.get(
  '/transferred-qty',
  requireWarehouse,
  stockTransferController.getTransferredQty
);

// ------------------------------------------------------------
// Create a new Stock Transfer Slip
// Allow: Super Admin, Admin, Stock Handler
// ------------------------------------------------------------
router.post(
  '/',
  authorize(['Super Admin', 'Admin', 'Stock Handler']),
  requireWarehouse,
  stockTransferController.createSTS
);

// ------------------------------------------------------------
// List slips (supports ?scope=mine|pending|all)
// ------------------------------------------------------------
router.get(
  '/',
  requireWarehouse,
  stockTransferController.listSTSs
);

// ------------------------------------------------------------
// Detail (header + lines) of one slip
// ------------------------------------------------------------
router.get(
  '/:id',
  requireWarehouse,
  stockTransferController.getSTSDetail
);

// ------------------------------------------------------------
// Approve — Department Heads (or Super Admin)
// ------------------------------------------------------------
router.post(
  '/:id/approve',
  authorize(['Super Admin', 'Admin']),
  requireWarehouse,
  stockTransferController.approveSTS
);

// ------------------------------------------------------------
// Reject — Department Heads (or Super Admin)
// ------------------------------------------------------------
router.post(
  '/:id/reject',
  authorize(['Super Admin', 'Admin']),
  requireWarehouse,
  stockTransferController.rejectSTS
);

// ------------------------------------------------------------
// Receive — the target warehouse's Stock Registrar
// (Super Admin is also allowed for ops/testing)
// ------------------------------------------------------------
router.post(
  '/:id/receive',
  authorize(['Super Admin', 'Stock Registrar', 'Admin']),
  requireWarehouse,
  stockTransferController.receiveSTS
);

// ------------------------------------------------------------
// Cancel — the original submitter
// ------------------------------------------------------------
router.post(
  '/:id/cancel',
  requireWarehouse,
  stockTransferController.cancelSTS
);

// ------------------------------------------------------------
// Complete — marks the physical transfer as done (handler side)
// ------------------------------------------------------------
router.post(
  '/:id/complete',
  authorize(['Super Admin', 'Admin', 'Stock Handler']),
  requireWarehouse,
  stockTransferController.completeSTS
);

module.exports = router;