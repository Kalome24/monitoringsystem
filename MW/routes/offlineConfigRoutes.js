// routes/offlineConfigRoutes.js
const express = require('express');
const router = express.Router();
const controller = require('../controllers/offlineConfigController');
const { auth, syncKeyAuth } = require('../middleware/auth');

/* ============================================================
   PEER-TO-PEER ROUTES (syncKeyAuth — shared secret)
   ============================================================ */
router.get('/sync/peer-export', syncKeyAuth, controller.peerExport);

/* ============================================================
   USER ROUTES (auth — user JWT)
   ============================================================ */
router.use(auth);

// Dropdown CRUD
router.get('/',             controller.getAll);
router.post('/item',        controller.createItem);
router.put('/item/:id',     controller.updateItem);
router.delete('/item/:id',  controller.deleteItem);

// Signatures CRUD (Merged)
router.get('/signatures',            controller.listSignatures);
router.get('/signatures/:id',        controller.getSignature);
router.post('/signatures',           controller.createSignature);
router.put('/signatures/:id',        controller.updateSignature);
router.delete('/signatures/:id',     controller.deleteSignature);

// Sync — user-facing
router.get('/sync/export',             controller.exportSync);
router.get('/sync/status',             controller.syncStatus);
router.get('/sync/history',            controller.getHistory);
router.post('/sync/import',            controller.importSync);
router.post('/sync/pull-from-surface', controller.pullFromSurface);

module.exports = router;