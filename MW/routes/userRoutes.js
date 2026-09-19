// routes/userRoutes.js
const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { auth, authorize } = require('../middleware/auth');

// ============================================
// PUBLIC ROUTES (No authentication required)
// ============================================
router.post('/login', userController.login);

// ============================================
// PROTECTED ROUTES (Authentication required)
// ============================================

// Auth
router.post('/logout', auth, userController.logout);
router.get('/me', auth, userController.getCurrentUser);
router.put('/me/profile-image', auth, userController.updateMyProfileImage);
router.get('/verify', auth, userController.verifyToken);

// ============================================
// READ-ONLY (Any authenticated user, incl. Admin for the Users tab)
// ============================================
router.get('/', auth, userController.getAllUsers);
router.get('/search', auth, userController.searchUsers);
router.get('/status/:status', auth, userController.getUsersByStatus);
router.get('/public/:publicUserId', auth, userController.getUserByPublicId);
router.get('/:id', auth, userController.getUserById);

// ============================================
// SUPER ADMIN ONLY (Create, edit, activate, deactivate, reset, force-logout)
// Admin has users.view but NOT these mutations.
// ============================================
router.post(
  '/',
  auth,
  authorize(['Super Admin']),
  userController.createUser
);

router.put(
  '/:id',
  auth,
  authorize(['Super Admin']),
  userController.updateUser
);

router.patch(
  '/:id/deactivate',
  auth,
  authorize(['Super Admin']),
  userController.deactivateUser
);

router.patch(
  '/:id/activate',
  auth,
  authorize(['Super Admin']),
  userController.activateUser
);

router.put(
  '/:id/password',
  auth,
  authorize(['Super Admin']),
  userController.updatePassword
);

router.post(
  '/:id/force-logout',
  auth,
  authorize(['Super Admin']),
  userController.forceLogout
);

module.exports = router;