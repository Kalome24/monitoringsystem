// routes/uomConversionRoutes.js
const express = require('express');
const router = express.Router();
const uomConversionController = require('../controllers/uomConversionController');
const { auth, authorize } = require('../middleware/auth');

// All routes require authentication
router.use(auth);

// Get all with pagination & search
router.get('/', uomConversionController.getAll);

// Get single by ID
router.get('/:id', uomConversionController.getById);

// Admin/Super Admin only modifications
router.post('/', authorize(['Super Admin', 'Admin']), uomConversionController.create);
router.put('/:id', authorize(['Super Admin', 'Admin']), uomConversionController.update);
router.delete('/:id', authorize(['Super Admin', 'Admin']), uomConversionController.remove);

module.exports = router;