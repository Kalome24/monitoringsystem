// routes/itemMasterRoutes.js
const express = require('express');
const router = express.Router();
const itemMasterController = require('../controllers/itemMasterController');
const { auth, authorize } = require('../middleware/auth');

// All routes require authentication
router.use(auth);

// Bulk image lookup — MUST be defined above /:itemCode, otherwise
// Express would match POST /images against the /:itemCode param route.
router.post('/images', itemMasterController.getItemImagesByCodes);

// Create a new item in item_master table
router.post('/', itemMasterController.createItemMaster);

// Get all items with pagination & search
router.get('/', itemMasterController.getAllItemMasters);

// Get a single item by Item_Code
router.get('/:itemCode', itemMasterController.getItemMasterByCode);

// Update an item (by Item_Code)
router.put('/:itemCode', itemMasterController.updateItemMaster);

// Deactivate (set Status = 'Inactive')
router.patch('/:itemCode/deactivate', itemMasterController.deactivateItemMaster);

// Activate (set Status = 'Active')
router.patch('/:itemCode/activate', itemMasterController.activateItemMaster);

// Permanently DELETE an item (Super Admin / Admin only)
router.delete(
  '/:itemCode',
  authorize(['Super Admin', 'Admin']),
  itemMasterController.deleteItemMaster
);

module.exports = router;