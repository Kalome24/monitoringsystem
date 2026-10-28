// routes/stockTransferRoutes.js
const express = require('express');
const router = express.Router();
const stockTransferController = require('../controllers/stockTransferController');
const { auth, authorize, requireWarehouse } = require('../middleware/auth');

router.use(auth);

/* ---------- summary / helper routes BEFORE /:id ---------- */
router.get('/summary',             stockTransferController.getSummary);
router.get('/incoming',            requireWarehouse, stockTransferController.listIncomingSTSs);
router.get('/incoming-summary',    requireWarehouse, stockTransferController.getIncomingSummary);
router.get('/transferred-qty',     requireWarehouse, stockTransferController.getTransferredQty);

/* ---------- request flow queues (before /:id) ---------- */
router.get(
  '/approval-queue',
  authorize(['Super Admin', 'Admin']),
  requireWarehouse,
  stockTransferController.listApprovalQueue
);

router.get(
  '/for-shipping',
  authorize(['Super Admin', 'Admin', 'Stock Handler']),
  requireWarehouse,
  stockTransferController.listForShipping
);

router.get(
  '/my-requests',
  requireWarehouse,
  stockTransferController.listMyRequests
);

/* ---------- STS lines awaiting storage (must be before /:id) ---------- */
router.get(
  '/received-for-store',
  requireWarehouse,
  stockTransferController.listReceivedForStore
);

/* ============================================================
   WAREHOUSE ACTIVITY FEED — cross-STS chronological stream for
   one warehouse. Single-segment path, must come BEFORE '/:id'.
   ============================================================ */
router.get(
  '/activity-feed',
  stockTransferController.getWarehouseActivityFeed
);

/* ---------- create + list ---------- */
router.post('/', authorize(['Super Admin', 'Admin', 'Stock Handler']), requireWarehouse, stockTransferController.createSTS);
router.get('/',  requireWarehouse, stockTransferController.listSTSs);

/* ---------- request creation (new flow) ---------- */
router.post(
  '/request',
  authorize(['Super Admin', 'Admin', 'Stock Handler']),
  requireWarehouse,
  stockTransferController.createTransferRequest
);

/* ---------- STS line storage (POST, no conflict with /:id) ---------- */
router.post(
  '/lines/:sts_line_id/store',
  authorize(['Super Admin', 'Admin', 'Stock Handler']),
  requireWarehouse,
  stockTransferController.storeTransferLine
);

/* ---------- eligible source locators (must be BEFORE /:id) ---------- */
router.get(
  '/:id/eligible-source-locators',
  authorize(['Super Admin', 'Admin', 'Stock Handler']),
  requireWarehouse,
  stockTransferController.getEligibleSourceLocators
);

/* ============================================================
   STS ACTIVITY — enriched chronological timeline for one STS.
   ============================================================ */
router.get(
  '/:id/activity',
  requireWarehouse,
  stockTransferController.getSTSActivity
);

/* ---------- detail ---------- */
router.get('/:id', requireWarehouse, stockTransferController.getSTSDetail);

/* ---------- transitions ---------- */

// Approve (Dept Head) — issues STS no + flips to 'For Shipping'
// Body may include { approved_lines: [{ sts_line_id, approved_qty, qty_change_reason? }] }
router.post('/:id/approve',
  authorize(['Super Admin', 'Admin']),
  requireWarehouse,
  stockTransferController.approveSTS);

// Reject (Dept Head) — with reason
router.post('/:id/reject',
  authorize(['Super Admin', 'Admin']),
  requireWarehouse,
  stockTransferController.rejectSTS);

// Acknowledge rejection (submitter only — enforced in the model)
router.post('/:id/acknowledge-rejection',
  stockTransferController.acknowledgeRejection);

// Ship (source Handler) — 'For Shipping' → 'In-Transit'
router.post('/:id/ship',
  authorize(['Super Admin', 'Admin', 'Stock Handler']),
  requireWarehouse,
  stockTransferController.shipSTS);

// Receive (destination Handler / Registrar / Admin) — 'In-Transit' → 'Received'/'Completed'
router.post('/:id/receive',
  authorize(['Super Admin', 'Stock Registrar', 'Admin', 'Stock Handler']),
  requireWarehouse,
  stockTransferController.receiveSTS);

router.post('/:id/cancel',
  requireWarehouse,
  stockTransferController.cancelSTS);

router.post('/:id/complete',
  authorize(['Super Admin', 'Admin', 'Stock Handler']),
  requireWarehouse,
  stockTransferController.completeSTS);

module.exports = router;