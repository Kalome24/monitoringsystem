// routes/costCenterRoutes.js
const express = require('express');
const router = express.Router();
const costCenterController = require('../controllers/costCenterController');
const { auth, authorize } = require('../middleware/auth');

router.use(auth);

router.post('/',              costCenterController.createCostCenter);
router.get('/',               costCenterController.getAllCostCenters);
router.get('/:value',         costCenterController.getCostCenterByValue);
router.put('/:value',         costCenterController.updateCostCenter);
router.patch('/:value/deactivate', costCenterController.deactivateCostCenter);
router.patch('/:value/activate',   costCenterController.activateCostCenter);
router.delete(
  '/:value',
  authorize(['Super Admin', 'Admin']),
  costCenterController.deleteCostCenter
);

module.exports = router;