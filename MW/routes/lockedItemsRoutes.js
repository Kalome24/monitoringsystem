// routes/lockedItemsRoutes.js
const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/lockedItemsController');
const { auth, authorize } = require('../middleware/auth');

router.use(auth);

router.get('/',       authorize(['Super Admin', 'Admin']), ctrl.list);
router.get('/:id',    authorize(['Super Admin', 'Admin']), ctrl.getOne);
router.post('/',      authorize(['Super Admin', 'Admin']), ctrl.create);
router.post('/bulk',  authorize(['Super Admin', 'Admin']), ctrl.bulkCreate);
router.put('/:id',    authorize(['Super Admin', 'Admin']), ctrl.update);
router.delete('/:id', authorize(['Super Admin', 'Admin']), ctrl.remove);

module.exports = router;