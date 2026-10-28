// routes/underground/undergroundRoutes.js
const express = require('express');
const router = express.Router();
const controller          = require('../../controllers/underground/undergroundController');
const issueFormController = require('../../controllers/underground/undergroundIssueFormController');
const offlineFeaturesRoutes = require('./offlineFeaturesRoutes'); // ← NEW IMPORT
const { auth, syncKeyAuth } = require('../../middleware/auth');

// All routes require authentication. Role gating is done inside the controller
// via getFreshUser() + emp_position / warehouse checks.
//
// Session 16 — /receive-online-sync, /peer-heartbeat, /peer-command-result,
// /remote-export/* are the exceptions: they use a shared-secret header
// (X-IMS-Sync-Key), NOT a user JWT. Remote peers are not logged in as users.

// =======================================================================
// Cross-DB sync — shared-secret routes (Session 16 / 16b)
// =======================================================================
// Registered before anything with :id params so literals always win.
// All of these use syncKeyAuth (X-IMS-Sync-Key header), NOT auth.

// Surface-side receivers
router.post('/receive-online-sync',   syncKeyAuth, controller.receiveOnlineSync);
router.post('/peer-heartbeat',        syncKeyAuth, controller.peerHeartbeat);
router.post('/peer-command-result',   syncKeyAuth, controller.peerCommandResult);

// Peer-side endpoints (called by the surface when it wants to pull)
router.get('/remote-export/pending',        syncKeyAuth, controller.remoteExportPending);
router.get('/remote-export/shift/:id',      syncKeyAuth, controller.remoteExportShift);
router.post('/remote-export/mark-reconciled', syncKeyAuth, controller.remoteMarkReconciled);

// =======================================================================
// Authenticated (JWT) routes below this line
// =======================================================================

// ▸ NEW: Mount the Offline Damage & Transfer Features
router.use('/offline-features', offlineFeaturesRoutes);

// Dashboard + summary
router.get('/dashboard',            auth, controller.dashboard);

// Current shift + current inventory
router.get('/shift/current',        auth, controller.currentShift);
router.get('/inventory',            auth, controller.currentInventory);

// History
// NOTE: literal segments must come before parameterized ones.
router.get('/shifts',               auth, controller.listShifts);
router.get('/shifts/surface',       auth, controller.surfaceShifts);

// Session 15 (S1+) — surface-handler view of pending underground syncs.
// Powers the Online Sync modal on the surface side.
router.get('/shifts/pending',       auth, controller.listPendingSyncs);

// Session 16b — peer registry (surface handler only; scope = own warehouse).
router.get('/peers',                auth, controller.listPeers);
router.get('/peers/:server_id/commands', auth, controller.listPeerCommands);
router.post('/peers/:server_id/command', auth, controller.createPeerCommand);

// Session 15 (S1+) — the newest Open/Closed/Reconciled shift for the
// handler's warehouse. MUST come before /shift/:id so 'active' isn't
// treated as an id param.
router.get('/shift/active',         auth, controller.activeShift);

router.get('/shift/:id',            auth, controller.getShift);
router.get('/shift/:id/lines',      auth, controller.getShiftLines);
router.get('/shift/:id/close-payload', auth, controller.getClosePayload);
router.get('/shift/:shiftId/issue-forms', auth, issueFormController.listForShift);

// Session 15 (S3) — surface exports available for the handler to pick from.
router.get('/available-seeds',      auth, controller.availableSeeds);

// Lifecycle — DB-driven (legacy / fallback)
router.post('/shift/open',           auth, controller.openShift);
router.post('/shift/:id/release',    auth, controller.releaseLines);
router.post('/shift/:id/close',      auth, controller.closeShift);
router.post('/shift/:id/reconcile',  auth, controller.reconcileShift);

// Session 15 (S1) — online sync.
// Callable by Underground Handler (their own shift) OR Surface Handler
// (pending shift at their warehouse). Gate is checkSyncGate.
// Session 16 — auto-branches to a cross-DB push when SURFACE_BASE_URL
// + SURFACE_SYNC_KEY are configured.
router.post('/shift/:id/sync-online', auth, controller.syncOnline);

// Session 15 (S2) — live surface deltas for the current shift.
router.get('/shift/:id/live-deltas',  auth, controller.liveDeltas);

// Lifecycle — physical-file transfer
router.post('/shift/open-from-file',        auth, controller.openFromFile || controller.openShiftFromFile);
router.post('/shift/reconcile-from-file',   auth, controller.reconcileFromFile);

// Issue forms (MER / MSR / MSF / MSB)
router.get('/issue-form-meta',      auth, issueFormController.formMeta);
router.get('/issue-forms',          auth, issueFormController.listHistory);
router.get('/issue-form/:id',       auth, issueFormController.getOne);
router.post('/issue-form',          auth, issueFormController.create);

module.exports = router;