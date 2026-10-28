// routes/userRoutes.js
const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { auth, authorize } = require('../middleware/auth');

// ============================================
// PUBLIC ROUTES (No authentication required)
// ============================================

// Standard login — verifies credentials, applies hybrid single-session rule.
router.post('/login', userController.login);

// Self-service session reclaim — verifies credentials, then clears the
// user's stored session so they can log in normally. Used by the Login
// page's "Log out from other devices" button.
// Body: { username, password }
router.post('/logout-other-devices', userController.logoutOtherDevices);

// ============================================
// PROTECTED ROUTES (Authentication required)
// ============================================

// Auth
router.post('/logout', auth, userController.logout);
router.get('/me', auth, userController.getCurrentUser);
router.put('/me/profile-image', auth, userController.updateMyProfileImage);
router.patch('/me', auth, userController.updateMyProfile);
router.get('/verify', auth, userController.verifyToken);

// ============================================
// READ-ONLY (Any authenticated user)
// ============================================
router.get('/', auth, userController.getAllUsers);
router.get('/search', auth, userController.searchUsers);
router.get('/status/:status', auth, userController.getUsersByStatus);
router.get('/public/:publicUserId', auth, userController.getUserByPublicId);

// Avatar — declared BEFORE /:id so the literal 'avatar' segment wins.
// Returns raw image bytes.
router.get('/:id/avatar', auth, userController.getUserAvatar);

router.get('/:id', auth, userController.getUserById);

// ============================================
// SUPER ADMIN ONLY
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
  '/:id/reset-password',
  auth,
  authorize(['Super Admin']),
  userController.resetPasswordToDefault
);

router.post(
  '/:id/force-logout',
  auth,
  authorize(['Super Admin']),
  userController.forceLogout
);

module.exports = router;