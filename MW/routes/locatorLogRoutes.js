// routes/locatorLogRoutes.js
const express = require('express');
const router = express.Router();
const controller = require('../controllers/locatorLogController');
const { auth } = require('../middleware/auth');

// Any authenticated user can create a locator log (they just exported a
// file). The controller overwrites the performer identity from req.user.
router.post('/', auth, controller.create);

// List — role-aware: admins see all, everyone else sees only their own.
router.get('/', auth, controller.list);

// Single header + paginated line drill-down.
router.get('/:id',        auth, controller.getOne);
router.get('/:id/lines',  auth, controller.getLines);

module.exports = router;