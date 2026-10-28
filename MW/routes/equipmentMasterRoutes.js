// routes/equipmentMasterRoutes.js
const express = require('express');
const router = express.Router();
const equipmentMasterController = require('../controllers/equipmentMasterController');
const { auth, authorize } = require('../middleware/auth');

// All routes require authentication
router.use(auth);

// Bulk image lookup — MUST be defined above /:code, otherwise
// Express would match POST /images against the /:code param route.
router.post('/images', equipmentMasterController.getEquipmentImagesByCodes);

// Create a new equipment in equipment_master table
router.post('/', equipmentMasterController.createEquipmentMaster);

// Get all equipment with pagination & search
router.get('/', equipmentMasterController.getAllEquipmentMasters);

// Get a single equipment by Equipment_Code
router.get('/:code', equipmentMasterController.getEquipmentMasterByCode);

// Update an equipment (by Equipment_Code)
router.put('/:code', equipmentMasterController.updateEquipmentMaster);

// Deactivate (set Status = 'Inactive')
router.patch('/:code/deactivate', equipmentMasterController.deactivateEquipmentMaster);

// Activate (set Status = 'Active')
router.patch('/:code/activate', equipmentMasterController.activateEquipmentMaster);

// Permanently DELETE an equipment (Super Admin / Admin only)
router.delete(
  '/:code',
  authorize(['Super Admin', 'Admin']),
  equipmentMasterController.deleteEquipmentMaster
);

module.exports = router;