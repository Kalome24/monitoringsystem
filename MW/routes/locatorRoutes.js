// routes/locatorRoutes.js
const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/locatorController');
const { auth, authorize, ROLES } = require('../middleware/auth');

router.use(auth);

// IMPORTANT — specific routes must come BEFORE /:locator_code
// so 'totals' and 'filter-options' aren't captured as locator codes.

router.get('/totals',                        authorize([ROLES.SUPER_ADMIN, ROLES.ADMIN]), ctrl.getTotals);
router.get('/totals/:warehouse_code',        authorize([ROLES.SUPER_ADMIN, ROLES.ADMIN]), ctrl.getWarehouseLocators);
router.get('/',                              ctrl.list);
router.get('/filter-options',                ctrl.getFilterOptions);

// Stock Report export — flat, one row per (locator, item) pair, qty > 0.
// Reporting only. Role-gated inside the controller.
router.get('/export-stock-report',           ctrl.exportStockReport);

// ▸ NEW — Cross-warehouse item code search.
// Admin / Super Admin → global; Handler → own warehouse.
// Role-gated inside the controller.
router.get('/search-item',                   ctrl.searchItem);

router.get('/:locator_code/items',           ctrl.getItems);
router.get('/:locator_code',                 ctrl.getOne);

router.post('/',                             ctrl.create);
router.put('/:locator_code',                 ctrl.update);

module.exports = router;