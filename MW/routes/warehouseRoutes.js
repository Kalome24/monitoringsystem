// routes/warehouseRoutes.js
const express = require('express');
const router = express.Router();
const warehouseController = require('../controllers/warehouseController');
const { auth, authorize } = require('../middleware/auth');

// ============================================
// PROTECTED ROUTES (Authentication required)
// ============================================

// Get all warehouses (now includes sub_warehouse_count + user_count)
router.get('/', auth, warehouseController.getAllWarehouses);

// Get active warehouses (for dropdown)
router.get('/active', auth, warehouseController.getActiveWarehouses);

// Get warehouse by ID
router.get('/:id', auth, warehouseController.getWarehouseById);

// ============================================
// ADMIN ONLY ROUTES
// ============================================

// Create warehouse
router.post('/', auth, authorize(['Super Admin', 'Admin']), warehouseController.createWarehouse);

// Update warehouse
router.put('/:id', auth, authorize(['Super Admin', 'Admin']), warehouseController.updateWarehouse);

// Deactivate warehouse (soft delete)
router.patch('/:id/deactivate', auth, authorize(['Super Admin', 'Admin']), warehouseController.deactivateWarehouse);

// Activate warehouse
router.patch('/:id/activate', auth, authorize(['Super Admin', 'Admin']), warehouseController.activateWarehouse);

// PERMANENT delete (requires body: { confirm: "DELETE" })
router.delete('/:id', auth, authorize(['Super Admin', 'Admin']), warehouseController.deleteWarehouse);

module.exports = router;