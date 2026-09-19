// routes/masterRoutes.js
const express = require('express');
const router = express.Router();
const { auth, authorize } = require('../middleware/auth');
const {
    glController,
    categoryController,
    itemCodeController,
    purchaseClassController,
    uomController
} = require('../controllers/masterController');

// All routes require authentication
router.use(auth);

// ============================================
// GL CLASSES
// ============================================
router.get('/gl', glController.getAll);
router.get('/gl/:id', glController.getOne);
router.post('/gl', authorize(['Super Admin', 'Admin']), glController.create);
router.put('/gl/:id', authorize(['Super Admin', 'Admin']), glController.update);
router.patch('/gl/:id/deactivate', authorize(['Super Admin', 'Admin']), glController.deactivate);
router.patch('/gl/:id/activate', authorize(['Super Admin', 'Admin']), glController.activate);

// ============================================
// CATEGORIES
// ============================================
router.get('/category', categoryController.getAll);
router.get('/category/:id', categoryController.getOne);
router.post('/category', authorize(['Super Admin', 'Admin']), categoryController.create);
router.put('/category/:id', authorize(['Super Admin', 'Admin']), categoryController.update);
router.patch('/category/:id/deactivate', authorize(['Super Admin', 'Admin']), categoryController.deactivate);
router.patch('/category/:id/activate', authorize(['Super Admin', 'Admin']), categoryController.activate);

// ============================================
// ITEM CODES
// ============================================
router.get('/item-codes', itemCodeController.getAll);
router.get('/item-codes/:id', itemCodeController.getOne);
router.post('/item-codes', authorize(['Super Admin', 'Admin']), itemCodeController.create);
router.put('/item-codes/:id', authorize(['Super Admin', 'Admin']), itemCodeController.update);
router.patch('/item-codes/:id/deactivate', authorize(['Super Admin', 'Admin']), itemCodeController.deactivate);
router.patch('/item-codes/:id/activate', authorize(['Super Admin', 'Admin']), itemCodeController.activate);

// ============================================
// PURCHASE CLASSES
// ============================================
router.get('/purchase-class', purchaseClassController.getAll);
router.get('/purchase-class/:id', purchaseClassController.getOne);
router.post('/purchase-class', authorize(['Super Admin', 'Admin']), purchaseClassController.create);
router.put('/purchase-class/:id', authorize(['Super Admin', 'Admin']), purchaseClassController.update);
router.patch('/purchase-class/:id/deactivate', authorize(['Super Admin', 'Admin']), purchaseClassController.deactivate);
router.patch('/purchase-class/:id/activate', authorize(['Super Admin', 'Admin']), purchaseClassController.activate);

// ============================================
// UOM
// ============================================
router.get('/uom', uomController.getAll);
router.get('/uom/:id', uomController.getOne);
router.post('/uom', authorize(['Super Admin', 'Admin']), uomController.create);
router.put('/uom/:id', authorize(['Super Admin', 'Admin']), uomController.update);
router.patch('/uom/:id/deactivate', authorize(['Super Admin', 'Admin']), uomController.deactivate);
router.patch('/uom/:id/activate', authorize(['Super Admin', 'Admin']), uomController.activate);

module.exports = router;