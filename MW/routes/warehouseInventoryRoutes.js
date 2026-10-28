// routes/warehouseInventoryRoutes.js
//
// Session 8: the query surface is richer, but route order is
// unchanged. `/movements` MUST stay above `/:item_code` so Express
// doesn't try to look up a warehouse inventory row for the literal
// string "movements".
//
// New query params (all optional except warehouse targeting):
//   ?warehouse_code=<code>          preferred anchor
//   ?warehouse_id=<int>             legacy id form
//   &item_code=<code>               narrow to one item
//   &reference_type=<type>          narrow movements to one source:
//                                     'PO' | 'STS' | 'UndergroundReconciliation' | ...
//   &search=<term>                  (list only) matches code or name
//   &limit=<int>                    cap returned rows

const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/warehouseInventoryController');
const { auth, requireWarehouse } = require('../middleware/auth');

router.use(auth);

// /movements must come BEFORE /:item_code
router.get('/movements',  requireWarehouse, ctrl.listMovements);
router.get('/',           requireWarehouse, ctrl.listInventory);
router.get('/:item_code', requireWarehouse, ctrl.getInventory);

module.exports = router;