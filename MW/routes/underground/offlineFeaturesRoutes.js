// routes/underground/offlineFeaturesRoutes.js
const express = require('express');
const router = express.Router();
const controller = require('../../controllers/underground/offlineFeaturesController');
const { auth } = require('../../middleware/auth');

router.use(auth);

// Damage Write-off Routes
router.post('/damage', controller.recordDamage);
router.get('/damage/history', controller.getDamageHistory);

// Offline Transfer Routes
router.get('/transfer/next-sts-no', controller.getNextStsNo);
router.get('/transfer/items', controller.getTransferItems);
router.get('/transfer/destinations', controller.getDestinationLocators); // ← NEW
router.post('/transfer', controller.createTransfer);
router.get('/transfer/history', controller.getTransferHistory);

module.exports = router;