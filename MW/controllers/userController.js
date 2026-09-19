// controllers/userController.js
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const UserModel = require('../models/userModel');
const WarehouseModel = require('../models/warehouseModel');

const SESSION_EXPIRY_HOURS = 24;

/**
 * Strip sensitive fields before returning a user to the client.
 * Never expose the raw active_session_token / active_session_at.
 * emp_position and can_approve_sts ARE exposed (needed by the UI).
 */
const sanitizeUser = (user) => {
    if (!user) return user;
    const clean = { ...user };
    delete clean.password_hash;
    delete clean.active_session_token;
    delete clean.active_session_at;
    return clean;
};

/**
 * Compute the effective emp_position for a user based on their role.
 *
 *   Super Admin     → 'Programmer'                    (fixed)
 *   Admin           → requested if valid, else 'Inventory Controller Manager'
 *                     valid: 'Department Head' | 'Inventory Controller Manager'
 *   Stock Registrar → 'Inventory Controllers'         (fixed)
 *   Stock Handler   → 'Inventory Controllers'         (fixed)
 *
 * Never trust the client to set positions that don't match the role.
 */
const getEffectivePosition = (user_role, requestedPosition) => {
    const role = String(user_role || '').trim();
    const req  = String(requestedPosition || '').trim();

    if (role === 'Super Admin') return 'Programmer';

    if (role === 'Stock Registrar' || role === 'Stock Handler') {
        return 'Inventory Controllers';
    }

    if (role === 'Admin') {
        const allowed = ['Department Head', 'Inventory Controller Manager'];
        return allowed.includes(req) ? req : 'Inventory Controller Manager';
    }

    return null;
};

/**
 * The one and only source of truth for STS approval rights.
 *
 *   can_approve_sts = 1  ⟺  user_role = 'Admin' AND emp_position = 'Department Head'
 *
 * Programmers (Super Admin) do NOT approve. Registrars/Handlers never approve.
 * Computed on the backend — client input is ignored.
 */
const computeCanApproveSts = (user_role, emp_position) => {
    const role = String(user_role || '').trim();
    const pos  = String(emp_position || '').trim();
    return role === 'Admin' && pos === 'Department Head';
};

const userController = {
    // ============================================
    // AUTHENTICATION
    // ============================================

    /**
     * Login user with JWT
     * POST /api/users/login
     */
    login: async (req, res) => {
        try {
            const { username, password } = req.body;

            if (!username || !password) {
                return res.status(400).json({
                    success: false,
                    message: 'Username and password are required'
                });
            }

            const user = await UserModel.getUserByUsername(username);

            // Reject both "not found" and "wrong case" with the same generic message.
            if (!user || user.username !== username) {
                return res.status(401).json({
                    success: false,
                    message: 'Invalid username or password'
                });
            }

            if (user.status !== 'Active') {
                return res.status(403).json({
                    success: false,
                    message: 'Account is deactivated. Please contact administrator.'
                });
            }

            // ---------- Main warehouse deactivation check ----------
            if (user.warehouse_assigned && user.warehouse_status === 'Deactivated') {
                return res.status(403).json({
                    success: false,
                    message:
                        `Your assigned warehouse "${user.warehouse_code || ''}" is deactivated. ` +
                        `Please contact your administrator.`
                });
            }

            // ---------- SINGLE-SESSION ENFORCEMENT ----------
            if (user.active_session_token && user.active_session_at) {
                const startedAt = new Date(user.active_session_at);
                const hoursSince = (new Date() - startedAt) / (1000 * 60 * 60);

                if (hoursSince < SESSION_EXPIRY_HOURS) {
                    return res.status(403).json({
                        success: false,
                        code: 'SESSION_ACTIVE',
                        message:
                            'This account is already logged in on another device. ' +
                            'Please log out there first, or contact your administrator.',
                        active_session_at: user.active_session_at
                    });
                }

                // Stale — clear and let the login proceed
                await UserModel.clearActiveSession(user.id);
            }

            // ---------- Password check ----------
            const isPasswordValid = await bcrypt.compare(password, user.password_hash);
            if (!isPasswordValid) {
                return res.status(401).json({
                    success: false,
                    message: 'Invalid username or password'
                });
            }

            await UserModel.updateLastLogin(user.id);

            const token = jwt.sign(
                {
                    id: user.id,
                    username: user.username,
                    role: user.user_role,
                    emp_position: user.emp_position,
                    can_approve_sts: user.can_approve_sts,
                    warehouse_assigned: user.warehouse_assigned,
                    public_user_id: user.public_user_id,
                    email: user.email
                },
                process.env.JWT_SECRET,
                { expiresIn: '24h' }
            );

            // Register the token as the active session
            await UserModel.setActiveSession(user.id, token);

            res.status(200).json({
                success: true,
                message: 'Login successful',
                data: {
                    user: sanitizeUser(user),
                    token: token
                }
            });
        } catch (error) {
            console.error('❌ Error during login:', error);
            res.status(500).json({
                success: false,
                message: 'Error during login',
                error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
            });
        }
    },

    /**
     * Logout user
     * POST /api/users/logout
     */
    logout: async (req, res) => {
        try {
            const userId = req.user?.id;
            const username = req.user?.username;

            if (userId) {
                await UserModel.clearActiveSession(userId);
                console.log(`👤 User logged out: ${username || userId}`);
            }

            res.status(200).json({
                success: true,
                message: 'Logout successful'
            });
        } catch (error) {
            console.error('❌ Error during logout:', error);
            res.status(500).json({
                success: false,
                message: 'Error during logout',
                error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
            });
        }
    },

    /**
     * Force-terminate a user's session (Admin / Super Admin only).
     * POST /api/users/:id/force-logout
     */
    forceLogout: async (req, res) => {
        try {
            const { id } = req.params;

            const targetUser = await UserModel.getUserById(id);
            if (!targetUser) {
                return res.status(404).json({
                    success: false,
                    message: 'User not found'
                });
            }

            if (!targetUser.active_session_token) {
                return res.status(200).json({
                    success: true,
                    message: `User "${targetUser.username}" has no active session.`
                });
            }

            await UserModel.clearActiveSession(id);

            res.status(200).json({
                success: true,
                message: `Session for "${targetUser.username}" has been terminated.`
            });
        } catch (error) {
            console.error('❌ Error in forceLogout:', error);
            res.status(500).json({
                success: false,
                message: 'Error forcing logout',
                error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
            });
        }
    },

    /**
     * Get current authenticated user
     * GET /api/users/me
     */
    getCurrentUser: async (req, res) => {
        try {
            const userId = req.user.id;
            const user = await UserModel.getUserById(userId);

            if (!user) {
                return res.status(404).json({
                    success: false,
                    message: 'User not found'
                });
            }

            res.status(200).json({
                success: true,
                data: { user: sanitizeUser(user) }
            });
        } catch (error) {
            console.error('❌ Error getting current user:', error);
            res.status(500).json({
                success: false,
                message: 'Error getting user data',
                error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
            });
        }
    },

    /**
     * Verify token validity
     * GET /api/users/verify
     */
    verifyToken: async (req, res) => {
        try {
            const userId = req.user.id;
            const user = await UserModel.getUserById(userId);

            if (!user) {
                return res.status(404).json({
                    success: false,
                    message: 'User not found'
                });
            }

            if (user.status !== 'Active') {
                return res.status(403).json({
                    success: false,
                    message: 'Account is deactivated'
                });
            }

            res.status(200).json({
                success: true,
                message: 'Token is valid'
            });
        } catch (error) {
            console.error('❌ Error verifying token:', error);
            res.status(500).json({
                success: false,
                message: 'Error verifying token',
                error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
            });
        }
    },

    // ============================================
    // USER MANAGEMENT
    // ============================================

    getAllUsers: async (req, res) => {
        try {
            const users = await UserModel.getAllUsers();
            res.status(200).json({
                success: true,
                data: users.map(sanitizeUser)
            });
        } catch (error) {
            console.error('❌ Error fetching users:', error);
            res.status(500).json({
                success: false,
                message: 'Error fetching users',
                error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
            });
        }
    },

    getUserById: async (req, res) => {
        try {
            const { id } = req.params;
            const user = await UserModel.getUserById(id);

            if (!user) {
                return res.status(404).json({
                    success: false,
                    message: 'User not found'
                });
            }

            res.status(200).json({ success: true, data: sanitizeUser(user) });
        } catch (error) {
            console.error('❌ Error fetching user:', error);
            res.status(500).json({
                success: false,
                message: 'Error fetching user',
                error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
            });
        }
    },

    getUserByPublicId: async (req, res) => {
        try {
            const { publicUserId } = req.params;
            const user = await UserModel.getUserByPublicId(publicUserId);

            if (!user) {
                return res.status(404).json({
                    success: false,
                    message: 'User not found'
                });
            }

            res.status(200).json({ success: true, data: sanitizeUser(user) });
        } catch (error) {
            console.error('❌ Error fetching user by public ID:', error);
            res.status(500).json({
                success: false,
                message: 'Error fetching user',
                error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
            });
        }
    },

    searchUsers: async (req, res) => {
        try {
            const { q } = req.query;
            if (!q) {
                return res.status(400).json({
                    success: false,
                    message: 'Search term is required'
                });
            }

            const users = await UserModel.searchUsers(q);
            res.status(200).json({
                success: true,
                data: users.map(sanitizeUser)
            });
        } catch (error) {
            console.error('❌ Error searching users:', error);
            res.status(500).json({
                success: false,
                message: 'Error searching users',
                error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
            });
        }
    },

    getUsersByStatus: async (req, res) => {
        try {
            const { status } = req.params;

            if (!status || !['Active', 'Inactive'].includes(status)) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid status. Must be Active or Inactive'
                });
            }

            const users = await UserModel.getUsersByStatus(status);
            res.status(200).json({
                success: true,
                data: users.map(sanitizeUser)
            });
        } catch (error) {
            console.error('❌ Error fetching users by status:', error);
            res.status(500).json({
                success: false,
                message: 'Error fetching users',
                error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
            });
        }
    },

    // ============================================
    // USER CRUD OPERATIONS
    // ============================================

    createUser: async (req, res) => {
        try {
            const {
                username,
                password,
                first_name,
                last_name,
                user_role,
                emp_position,
                warehouse_assigned,
                email,
                status
            } = req.body;

            if (!username || !password || !first_name || !last_name || !user_role || !email) {
                return res.status(400).json({
                    success: false,
                    message: 'All required fields must be filled'
                });
            }

            if (!email.includes('@lepanto.com.ph') && !email.includes('@lepanto.com')) {
                return res.status(400).json({
                    success: false,
                    message: 'Email must be a Lepanto email (@lepanto.com.ph or @lepanto.com)'
                });
            }

            if (password.length < 6) {
                return res.status(400).json({
                    success: false,
                    message: 'Password must be at least 6 characters'
                });
            }

            const globalRoles = ['Super Admin', 'Admin'];
            const warehouseRoles = ['Stock Registrar', 'Stock Handler'];
            let finalWarehouse = null;

            if (globalRoles.includes(user_role)) {
                if (warehouse_assigned !== null && warehouse_assigned !== undefined && warehouse_assigned !== '') {
                    return res.status(400).json({
                        success: false,
                        message: `Users with role "${user_role}" must not be assigned to a warehouse. Please leave warehouse field empty.`
                    });
                }
                finalWarehouse = null;
            } else if (warehouseRoles.includes(user_role)) {
                if (!warehouse_assigned) {
                    return res.status(400).json({
                        success: false,
                        message: `Users with role "${user_role}" must be assigned to a warehouse. Please select a warehouse.`
                    });
                }

                const warehouse = await WarehouseModel.getWarehouseById(warehouse_assigned);
                if (!warehouse) {
                    return res.status(400).json({
                        success: false,
                        message: 'The selected warehouse does not exist.'
                    });
                }
                if (warehouse.status !== 'Active') {
                    return res.status(400).json({
                        success: false,
                        message: 'The selected warehouse is not active. Please choose an active warehouse.'
                    });
                }
                finalWarehouse = warehouse_assigned;
            } else {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid user role. Allowed roles: Super Admin, Admin, Stock Registrar, Stock Handler.'
                });
            }

            // ---------- emp_position + can_approve_sts (backend-authoritative) ----------
            const finalPosition = getEffectivePosition(user_role, emp_position);
            const finalCanApprove = computeCanApproveSts(user_role, finalPosition);

            const usernameExists = await UserModel.usernameExists(username);
            if (usernameExists) {
                return res.status(409).json({
                    success: false,
                    message: 'Username already exists'
                });
            }

            const emailExists = await UserModel.emailExists(email);
            if (emailExists) {
                return res.status(409).json({
                    success: false,
                    message: 'Email already exists'
                });
            }

            const saltRounds = parseInt(process.env.BCRYPT_SALT_ROUNDS) || 10;
            const password_hash = await bcrypt.hash(password, saltRounds);

            const userId = await UserModel.createUser({
                username,
                password_hash,
                first_name,
                last_name,
                user_role,
                emp_position: finalPosition,
                can_approve_sts: finalCanApprove,
                warehouse_assigned: finalWarehouse,
                email,
                status: status || 'Active',
                created_by: req.user?.username || 'System'
            });

            const newUser = await UserModel.getUserById(userId);

            res.status(201).json({
                success: true,
                message: 'User created successfully',
                data: sanitizeUser(newUser)
            });
        } catch (error) {
            console.error('❌ Error creating user:', error);
            res.status(500).json({
                success: false,
                message: 'Error creating user',
                error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
            });
        }
    },

    updateUser: async (req, res) => {
        try {
            const { id } = req.params;
            const {
                username,
                first_name,
                last_name,
                user_role,
                emp_position,
                warehouse_assigned,
                email,
                status,
                password
            } = req.body;

            const existingUser = await UserModel.getUserById(id);
            if (!existingUser) {
                return res.status(404).json({
                    success: false,
                    message: 'User not found'
                });
            }

            if (!username || !first_name || !last_name || !user_role || !email) {
                return res.status(400).json({
                    success: false,
                    message: 'All required fields must be filled'
                });
            }

            if (!email.includes('@lepanto.com.ph') && !email.includes('@lepanto.com')) {
                return res.status(400).json({
                    success: false,
                    message: 'Email must be a Lepanto email (@lepanto.com.ph or @lepanto.com)'
                });
            }

            const globalRoles = ['Super Admin', 'Admin'];
            const warehouseRoles = ['Stock Registrar', 'Stock Handler'];
            let finalWarehouse = null;

            if (globalRoles.includes(user_role)) {
                if (warehouse_assigned !== null && warehouse_assigned !== undefined && warehouse_assigned !== '') {
                    return res.status(400).json({
                        success: false,
                        message: `Users with role "${user_role}" must not be assigned to a warehouse. Please leave warehouse field empty.`
                    });
                }
                finalWarehouse = null;
            } else if (warehouseRoles.includes(user_role)) {
                if (!warehouse_assigned) {
                    return res.status(400).json({
                        success: false,
                        message: `Users with role "${user_role}" must be assigned to a warehouse. Please select a warehouse.`
                    });
                }

                const warehouse = await WarehouseModel.getWarehouseById(warehouse_assigned);
                if (!warehouse) {
                    return res.status(400).json({
                        success: false,
                        message: 'The selected warehouse does not exist.'
                    });
                }
                if (warehouse.status !== 'Active') {
                    return res.status(400).json({
                        success: false,
                        message: 'The selected warehouse is not active. Please choose an active warehouse.'
                    });
                }
                finalWarehouse = warehouse_assigned;
            } else {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid user role. Allowed roles: Super Admin, Admin, Stock Registrar, Stock Handler.'
                });
            }

            // ---------- emp_position + can_approve_sts (backend-authoritative) ----------
            const finalPosition = getEffectivePosition(user_role, emp_position);
            const finalCanApprove = computeCanApproveSts(user_role, finalPosition);

            const usernameCheck = await UserModel.usernameExists(username);
            if (usernameCheck) {
                const userWithUsername = await UserModel.getUserByUsername(username);
                if (userWithUsername && userWithUsername.id !== parseInt(id)) {
                    return res.status(409).json({
                        success: false,
                        message: 'Username already exists'
                    });
                }
            }

            let password_hash = null;
            if (password) {
                if (password.length < 6) {
                    return res.status(400).json({
                        success: false,
                        message: 'Password must be at least 6 characters'
                    });
                }
                const saltRounds = parseInt(process.env.BCRYPT_SALT_ROUNDS) || 10;
                password_hash = await bcrypt.hash(password, saltRounds);
            }

            const updated = await UserModel.updateUser(id, {
                username,
                first_name,
                last_name,
                user_role,
                emp_position: finalPosition,
                can_approve_sts: finalCanApprove,
                warehouse_assigned: finalWarehouse,
                email,
                status,
                password_hash,
                updated_by: req.user?.username || 'System'
            });

            if (!updated) {
                return res.status(500).json({
                    success: false,
                    message: 'Failed to update user'
                });
            }

            const updatedUser = await UserModel.getUserById(id);

            res.status(200).json({
                success: true,
                message: 'User updated successfully',
                data: sanitizeUser(updatedUser)
            });
        } catch (error) {
            console.error('❌ Error updating user:', error);
            res.status(500).json({
                success: false,
                message: 'Error updating user',
                error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
            });
        }
    },

    deactivateUser: async (req, res) => {
        try {
            const { id } = req.params;

            const existingUser = await UserModel.getUserById(id);
            if (!existingUser) {
                return res.status(404).json({
                    success: false,
                    message: 'User not found'
                });
            }

            if (req.user && req.user.id === parseInt(id)) {
                return res.status(403).json({
                    success: false,
                    message: 'You cannot deactivate your own account'
                });
            }

            const deactivated = await UserModel.deactivateUser(id, req.user?.username || 'System');

            if (!deactivated) {
                return res.status(500).json({
                    success: false,
                    message: 'Failed to deactivate user'
                });
            }

            const updatedUser = await UserModel.getUserById(id);

            res.status(200).json({
                success: true,
                message: 'User deactivated successfully',
                data: sanitizeUser(updatedUser)
            });
        } catch (error) {
            console.error('❌ Error deactivating user:', error);
            res.status(500).json({
                success: false,
                message: 'Error deactivating user',
                error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
            });
        }
    },

    activateUser: async (req, res) => {
        try {
            const { id } = req.params;

            const existingUser = await UserModel.getUserById(id);
            if (!existingUser) {
                return res.status(404).json({
                    success: false,
                    message: 'User not found'
                });
            }

            const activated = await UserModel.activateUser(id, req.user?.username || 'System');

            if (!activated) {
                return res.status(500).json({
                    success: false,
                    message: 'Failed to activate user'
                });
            }

            const updatedUser = await UserModel.getUserById(id);

            res.status(200).json({
                success: true,
                message: 'User activated successfully',
                data: sanitizeUser(updatedUser)
            });
        } catch (error) {
            console.error('❌ Error activating user:', error);
            res.status(500).json({
                success: false,
                message: 'Error activating user',
                error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
            });
        }
    },

    updatePassword: async (req, res) => {
        try {
            const { id } = req.params;
            const { newPassword } = req.body;

            if (!newPassword || newPassword.length < 6) {
                return res.status(400).json({
                    success: false,
                    message: 'Password must be at least 6 characters'
                });
            }

            const existingUser = await UserModel.getUserById(id);
            if (!existingUser) {
                return res.status(404).json({
                    success: false,
                    message: 'User not found'
                });
            }

            const saltRounds = parseInt(process.env.BCRYPT_SALT_ROUNDS) || 10;
            const password_hash = await bcrypt.hash(newPassword, saltRounds);

            const updated = await UserModel.updatePassword(id, password_hash, req.user?.username || 'System');

            if (!updated) {
                return res.status(500).json({
                    success: false,
                    message: 'Failed to update password'
                });
            }

            res.status(200).json({
                success: true,
                message: 'Password updated successfully'
            });
        } catch (error) {
            console.error('❌ Error updating password:', error);
            res.status(500).json({
                success: false,
                message: 'Error updating password',
                error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
            });
        }
    },

    /**
     * Update the authenticated user's own profile image.
     * PUT /api/users/me/profile-image
     * Body: { profile_image: "data:image/png;base64,..." }
     */
    updateMyProfileImage: async (req, res) => {
        try {
            const { profile_image } = req.body;
            const userId = req.user.id;

            if (profile_image && typeof profile_image !== 'string') {
                return res.status(400).json({
                    success: false,
                    message: 'profile_image must be a base64 data URL string'
                });
            }

            await UserModel.updateProfileImage(userId, profile_image || null);
            const updated = await UserModel.getUserById(userId);

            res.status(200).json({
                success: true,
                message: 'Profile image updated',
                data: sanitizeUser(updated)
            });
        } catch (error) {
            console.error('❌ Error updating profile image:', error);
            res.status(500).json({
                success: false,
                message: 'Error updating profile image',
                error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
            });
        }
    }
};

module.exports = userController;