// controllers/userController.js
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const UserModel = require('../models/userModel');
const WarehouseModel = require('../models/warehouseModel');
const LocatorModel = require('../models/locatorModel');
const { clearUserCache } = require('../middleware/auth');

const DEFAULT_RESET_PASSWORD = 'P@ssword1';

// ---------------------------------------------------------------------------
// Lepanto email policy
// ---------------------------------------------------------------------------
const LEPANTO_EMAIL_PATTERN = /^[A-Za-z0-9._%+-]+@lepantomining\.com$/i;

const isLepantoEmail = (email) => {
    if (typeof email !== 'string') return false;
    return LEPANTO_EMAIL_PATTERN.test(email.trim());
};

const HANDLER_POSITIONS = Object.freeze({
    SURFACE:     'Surface Handler',
    UNDERGROUND: 'Underground Handler',
});

const HANDLER_WAREHOUSE_CODES = Object.freeze(['UG', 'LUMB']);

const isHandlerWarehouse = (warehouseCode) => {
    const code = String(warehouseCode || '').trim().toUpperCase();
    return HANDLER_WAREHOUSE_CODES.includes(code);
};

const normalizeHandlerPosition = (requestedPosition) => {
    const req = String(requestedPosition || '').trim();
    return req === HANDLER_POSITIONS.UNDERGROUND
        ? HANDLER_POSITIONS.UNDERGROUND
        : HANDLER_POSITIONS.SURFACE;
};

const SESSION_ABANDONED_HOURS = 4;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';

const FAILED_ATTEMPT_WINDOW_MS = 5 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 5;
const failedAttempts = new Map();

const isRateLimited = (key) => {
    const entry = failedAttempts.get(key);
    if (!entry) return false;
    if (Date.now() - entry.lastAt > FAILED_ATTEMPT_WINDOW_MS) {
        failedAttempts.delete(key);
        return false;
    }
    return entry.count >= MAX_FAILED_ATTEMPTS;
};

const getRateLimitRetryAfter = (key) => {
    const entry = failedAttempts.get(key);
    if (!entry) return Math.ceil(FAILED_ATTEMPT_WINDOW_MS / 1000);
    const elapsed = Date.now() - entry.lastAt;
    const remaining = FAILED_ATTEMPT_WINDOW_MS - elapsed;
    return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
};

const recordFailedAttempt = (key) => {
    const now = Date.now();
    const entry = failedAttempts.get(key);
    if (!entry || now - entry.lastAt > FAILED_ATTEMPT_WINDOW_MS) {
        failedAttempts.set(key, { count: 1, lastAt: now });
    } else {
        entry.count++;
        entry.lastAt = now;
    }
};

const clearFailedAttempts = (key) => failedAttempts.delete(key);

const failedAttemptsCleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of failedAttempts) {
        if (now - entry.lastAt > FAILED_ATTEMPT_WINDOW_MS) {
            failedAttempts.delete(key);
        }
    }
}, 60 * 1000);
if (failedAttemptsCleanup.unref) failedAttemptsCleanup.unref();

const sanitizeUser = (user) => {
    if (!user) return user;
    const clean = { ...user };
    delete clean.password_hash;
    delete clean.active_session_token;
    delete clean.active_session_at;
    delete clean.active_session_last_seen;
    return clean;
};

const getEffectivePosition = (user_role, requestedPosition, warehouseCode) => {
    const role = String(user_role || '').trim();
    const req  = String(requestedPosition || '').trim();

    if (role === 'Super Admin') return 'Programmer';

    if (role === 'Stock Registrar') {
        return 'Inventory Controllers';
    }

    if (role === 'Stock Handler') {
        if (isHandlerWarehouse(warehouseCode)) {
            return normalizeHandlerPosition(req);
        }
        return 'Inventory Controllers';
    }

    if (role === 'Admin') {
        const allowed = ['Department Head', 'Inventory Controller Manager'];
        return allowed.includes(req) ? req : 'Inventory Controller Manager';
    }

    return null;
};

const PASSWORD_POLICY = {
    MIN: 6,
    MAX: 100,
    SPECIAL_PATTERN: /[!@#$%^&*(),.?":{}|<>]/,
};

const getPasswordPolicyViolations = (password) => {
    const pw = String(password || '');
    const violations = [];

    if (pw.length < PASSWORD_POLICY.MIN) {
        violations.push(`At least ${PASSWORD_POLICY.MIN} characters`);
    }
    if (!/[A-Z]/.test(pw)) {
        violations.push('At least 1 uppercase letter');
    }
    if (!/[a-z]/.test(pw)) {
        violations.push('At least 1 lowercase letter');
    }
    if (!/[0-9]/.test(pw)) {
        violations.push('At least 1 number');
    }
    if (!PASSWORD_POLICY.SPECIAL_PATTERN.test(pw)) {
        violations.push('At least 1 special character');
    }

    return violations;
};

const SELF_EDIT = {
    FIRST_NAME_MAX: 100,
    LAST_NAME_MAX: 100,
    USERNAME_MIN: 3,
    USERNAME_MAX: 50,
    USERNAME_PATTERN: /^[A-Za-z0-9._-]+$/,
    EMAIL_MAX: 100,
    EMAIL_PATTERN: LEPANTO_EMAIL_PATTERN,
    PASSWORD_MIN: PASSWORD_POLICY.MIN,
    PASSWORD_MAX: PASSWORD_POLICY.MAX,
};

/* ============================================================
   BODEGA ASSIGNMENT VALIDATION
   ------------------------------------------------------------
   Returns a normalised list of locator codes (or []) after:
     • coercing to array of trimmed strings
     • de-duplicating
     • verifying each code exists in locator_table for the
       target warehouse

   If the user should NOT have any assignments (admin role,
   surface handler, non-UG/LUMB warehouse), returns [].
   ============================================================ */
const normalizeAndValidateBodegas = async ({
    requestedLocators,
    user_role,
    finalPosition,
    warehouseCode,
}) => {
    if (!Array.isArray(requestedLocators) || requestedLocators.length === 0) {
        return [];
    }

    // Only Underground Handlers at a UG/LUMB warehouse get scoped bodegas.
    if (user_role !== 'Stock Handler') return [];
    if (finalPosition !== HANDLER_POSITIONS.UNDERGROUND) return [];
    if (!isHandlerWarehouse(warehouseCode)) return [];

    const unique = Array.from(
        new Set(requestedLocators.map((c) => String(c || '').trim()).filter(Boolean))
    );
    if (unique.length === 0) return [];

    // Verify every code exists in this warehouse.
    const existing = await LocatorModel.listLocatorsByWarehouse({
        warehouse_code: warehouseCode,
        search: null,
        limit: 5000,
        offset: 0,
    });
    const existingSet = new Set((existing || []).map((r) => r.locator_code));

    const invalid = unique.filter((c) => !existingSet.has(c));
    if (invalid.length > 0) {
        throw Object.assign(
            new Error(
                `Invalid locator(s) for warehouse ${warehouseCode}: ${invalid.join(', ')}. ` +
                `Each locator must exist in the warehouse before it can be assigned.`
            ),
            { statusCode: 400 }
        );
    }

    return unique;
};

const userController = {
    // ============================================
    // AUTHENTICATION
    // ============================================

    login: async (req, res) => {
        try {
            const { username, password } = req.body;

            if (!username || !password) {
                return res.status(400).json({
                    success: false,
                    message: 'Username and password are required'
                });
            }

            const ip = req.ip || req.connection?.remoteAddress || 'unknown';
            const rateKey = `${ip}:${String(username).toLowerCase()}`;

            if (isRateLimited(rateKey)) {
                return res.status(429).json({
                    success: false,
                    code: 'RATE_LIMITED',
                    message: 'Too many failed attempts. Please wait a few minutes and try again.',
                    retry_after_seconds: getRateLimitRetryAfter(rateKey)
                });
            }

            const user = await UserModel.getUserByUsername(username);

            if (!user || user.username !== username) {
                recordFailedAttempt(rateKey);
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

            if (user.warehouse_assigned && user.warehouse_status === 'Deactivated') {
                return res.status(403).json({
                    success: false,
                    message:
                        `Your assigned warehouse "${user.warehouse_code || ''}" is deactivated. ` +
                        `Please contact your administrator.`
                });
            }

            if (user.active_session_token) {
                let sessionStillLive = false;
                try {
                    jwt.verify(user.active_session_token, process.env.JWT_SECRET);
                    sessionStillLive = true;
                } catch {
                    sessionStillLive = false;
                }

                if (sessionStillLive) {
                    const referenceTime = user.active_session_last_seen
                        ? new Date(user.active_session_last_seen)
                        : new Date(user.active_session_at);

                    const idleHours = (new Date() - referenceTime) / (1000 * 60 * 60);

                    if (idleHours < SESSION_ABANDONED_HOURS) {
                        return res.status(403).json({
                            success: false,
                            code: 'SESSION_ACTIVE',
                            message:
                                'This account is already logged in on another device. ' +
                                'If you cannot access that device, use ' +
                                '"Can\'t log in? Log out from other devices" below.',
                            active_session_at: user.active_session_at
                        });
                    }
                }

                await UserModel.clearActiveSession(user.id);
            }

            const isPasswordValid = await bcrypt.compare(password, user.password_hash);
            if (!isPasswordValid) {
                recordFailedAttempt(rateKey);
                return res.status(401).json({
                    success: false,
                    message: 'Invalid username or password'
                });
            }

            clearFailedAttempts(rateKey);

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
                { expiresIn: JWT_EXPIRES_IN }
            );

            await UserModel.setActiveSession(user.id, token);
            clearUserCache(user.id);

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

    logout: async (req, res) => {
        try {
            const userId = req.user?.id;
            const username = req.user?.username;

            if (userId) {
                await UserModel.clearActiveSession(userId);
                clearUserCache(userId);
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
            clearUserCache(id);

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

    logoutOtherDevices: async (req, res) => {
        try {
            const { username, password } = req.body;

            if (!username || !password) {
                return res.status(400).json({
                    success: false,
                    message: 'Username and password are required.'
                });
            }

            const ip = req.ip || req.connection?.remoteAddress || 'unknown';
            const rateKey = `${ip}:${String(username).toLowerCase()}`;

            if (isRateLimited(rateKey)) {
                return res.status(429).json({
                    success: false,
                    code: 'RATE_LIMITED',
                    message: 'Too many failed attempts. Please wait a few minutes and try again.',
                    retry_after_seconds: getRateLimitRetryAfter(rateKey)
                });
            }

            const user = await UserModel.getUserByUsername(username);

            if (!user || user.username !== username) {
                recordFailedAttempt(rateKey);
                return res.status(401).json({
                    success: false,
                    message: 'Invalid username or password.'
                });
            }

            if (user.status !== 'Active') {
                return res.status(403).json({
                    success: false,
                    message: 'Account is deactivated. Please contact administrator.'
                });
            }

            const isPasswordValid = await bcrypt.compare(password, user.password_hash);
            if (!isPasswordValid) {
                recordFailedAttempt(rateKey);
                return res.status(401).json({
                    success: false,
                    message: 'Invalid username or password.'
                });
            }

            clearFailedAttempts(rateKey);

            if (!user.active_session_token) {
                return res.status(200).json({
                    success: true,
                    message: 'No active session to clear. You can log in now.'
                });
            }

            await UserModel.clearActiveSession(user.id);
            clearUserCache(user.id);

            console.log(`🔓 User "${user.username}" cleared their own stuck session.`);

            res.status(200).json({
                success: true,
                message: 'Other sessions have been logged out. You can log in now.'
            });
        } catch (error) {
            console.error('❌ Error in logoutOtherDevices:', error);
            res.status(500).json({
                success: false,
                message: 'Error clearing session',
                error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
            });
        }
    },

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

    getUserAvatar: async (req, res) => {
        try {
            const raw = req.params.id;
            const userId = Number(raw);

            if (!Number.isFinite(userId) || userId <= 0 || !Number.isInteger(userId)) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid user id.'
                });
            }

            const user = await UserModel.getUserById(userId);
            if (!user) {
                return res.status(404).end();
            }

            const stored = user.profile_image;
            if (!stored || typeof stored !== 'string') {
                return res.status(404).end();
            }

            const match = /^data:([^;]+);base64,(.+)$/i.exec(stored);
            if (!match) {
                console.warn(`⚠️ Stored avatar for user ${userId} is not a valid data URL.`);
                return res.status(500).json({
                    success: false,
                    message: 'Stored avatar is not a valid data URL.'
                });
            }

            const mimeType = match[1];
            const buffer = Buffer.from(match[2], 'base64');

            res.set('Content-Type', mimeType);
            res.set('Cache-Control', 'private, max-age=300, must-revalidate');
            res.set('Content-Length', String(buffer.length));
            res.status(200).send(buffer);
        } catch (error) {
            console.error('❌ Error in getUserAvatar:', error);
            res.status(500).json({
                success: false,
                message: 'Error fetching avatar',
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

    createUser: async (req, res) => {
        try {
            const {
                username,
                password,
                first_name,
                last_name,
                user_role,
                emp_position,
                can_approve_sts,
                warehouse_assigned,
                email,
                status,
                assigned_bodegas,
            } = req.body;

            if (!username || !password || !first_name || !last_name || !user_role || !email) {
                return res.status(400).json({
                    success: false,
                    message: 'All required fields must be filled'
                });
            }

            if (!isLepantoEmail(email)) {
                return res.status(400).json({
                    success: false,
                    message: 'Email must be a Lepanto email (@lepantomining.com)'
                });
            }

            const normalizedEmail = String(email).trim().toLowerCase();

            const pwViolations = getPasswordPolicyViolations(password);
            if (pwViolations.length > 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Password must contain: ' + pwViolations.join(' · ')
                });
            }
            if (password.length > PASSWORD_POLICY.MAX) {
                return res.status(400).json({
                    success: false,
                    message: 'Password is too long.'
                });
            }

            const globalRoles = ['Super Admin', 'Admin'];
            const warehouseRoles = ['Stock Registrar', 'Stock Handler'];
            let finalWarehouse = null;
            let resolvedWarehouseCode = null;

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
                resolvedWarehouseCode = warehouse.warehouse_code;
            } else {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid user role. Allowed roles: Super Admin, Admin, Stock Registrar, Stock Handler.'
                });
            }

            const finalPosition = getEffectivePosition(user_role, emp_position, resolvedWarehouseCode);

            let finalCanApprove = false;
            if (user_role === 'Admin') {
                if (finalPosition === 'Department Head') {
                    finalCanApprove = true;
                } else {
                    finalCanApprove = Boolean(can_approve_sts);
                }
            }

            const usernameExists = await UserModel.usernameExists(username);
            if (usernameExists) {
                return res.status(409).json({
                    success: false,
                    message: 'Username already exists'
                });
            }

            const emailExists = await UserModel.emailExists(normalizedEmail);
            if (emailExists) {
                return res.status(409).json({
                    success: false,
                    message: 'Email already exists'
                });
            }

            let validatedBodegas = [];
            try {
                validatedBodegas = await normalizeAndValidateBodegas({
                    requestedLocators: assigned_bodegas,
                    user_role,
                    finalPosition,
                    warehouseCode: resolvedWarehouseCode,
                });
            } catch (bodegaErr) {
                return res.status(bodegaErr.statusCode || 400).json({
                    success: false,
                    message: bodegaErr.message,
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
                email: normalizedEmail,
                status: status || 'Active',
                created_by: req.user?.username || 'System'
            });

            if (validatedBodegas.length > 0) {
                await UserModel.setUserBodegaAssignments(
                    userId,
                    validatedBodegas,
                    resolvedWarehouseCode,
                    req.user?.id || null // FIXED: Pass user ID, not username
                );
            }

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
                can_approve_sts,
                warehouse_assigned,
                email,
                status,
                password,
                assigned_bodegas,
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

            if (!isLepantoEmail(email)) {
                return res.status(400).json({
                    success: false,
                    message: 'Email must be a Lepanto email (@lepantomining.com)'
                });
            }

            const normalizedEmail = String(email).trim().toLowerCase();

            const globalRoles = ['Super Admin', 'Admin'];
            const warehouseRoles = ['Stock Registrar', 'Stock Handler'];
            let finalWarehouse = null;
            let resolvedWarehouseCode = null;

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
                resolvedWarehouseCode = warehouse.warehouse_code;
            } else {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid user role. Allowed roles: Super Admin, Admin, Stock Registrar, Stock Handler.'
                });
            }

            const finalPosition = getEffectivePosition(user_role, emp_position, resolvedWarehouseCode);

            let finalCanApprove = false;
            if (user_role === 'Admin') {
                if (finalPosition === 'Department Head') {
                    finalCanApprove = true;
                } else {
                    finalCanApprove = Boolean(can_approve_sts);
                }
            }

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

            const emailCheck = await UserModel.emailExistsExcept(normalizedEmail, id);
            if (emailCheck) {
                return res.status(409).json({
                    success: false,
                    message: 'Email already exists'
                });
            }

            let validatedBodegas = [];
            try {
                validatedBodegas = await normalizeAndValidateBodegas({
                    requestedLocators: assigned_bodegas,
                    user_role,
                    finalPosition,
                    warehouseCode: resolvedWarehouseCode,
                });
            } catch (bodegaErr) {
                return res.status(bodegaErr.statusCode || 400).json({
                    success: false,
                    message: bodegaErr.message,
                });
            }

            let password_hash = null;
            if (password) {
                const pwViolations = getPasswordPolicyViolations(password);
                if (pwViolations.length > 0) {
                    return res.status(400).json({
                        success: false,
                        message: 'Password must contain: ' + pwViolations.join(' · ')
                    });
                }
                if (password.length > PASSWORD_POLICY.MAX) {
                    return res.status(400).json({
                        success: false,
                        message: 'Password is too long.'
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
                email: normalizedEmail,
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

            await UserModel.setUserBodegaAssignments(
                id,
                validatedBodegas,
                resolvedWarehouseCode || null,
                req.user?.id || null // FIXED: Pass user ID, not username
            );

            if (password_hash) {
                await UserModel.clearActiveSession(id);
            }

            clearUserCache(id);

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

            clearUserCache(id);

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

            clearUserCache(id);

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

            if (!newPassword) {
                return res.status(400).json({
                    success: false,
                    message: 'New password is required.'
                });
            }

            const pwViolations = getPasswordPolicyViolations(newPassword);
            if (pwViolations.length > 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Password must contain: ' + pwViolations.join(' · ')
                });
            }
            if (newPassword.length > PASSWORD_POLICY.MAX) {
                return res.status(400).json({
                    success: false,
                    message: 'Password is too long.'
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

            await UserModel.clearActiveSession(id);
            clearUserCache(id);

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

    resetPasswordToDefault: async (req, res) => {
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
                    message: 'You cannot reset your own password from this action. Use the Change Password flow instead.'
                });
            }

            const saltRounds = parseInt(process.env.BCRYPT_SALT_ROUNDS) || 10;
            const password_hash = await bcrypt.hash(DEFAULT_RESET_PASSWORD, saltRounds);

            const updated = await UserModel.updatePassword(
                id,
                password_hash,
                req.user?.username || 'System'
            );

            if (!updated) {
                return res.status(500).json({
                    success: false,
                    message: 'Failed to reset password'
                });
            }

            await UserModel.clearActiveSession(id);
            clearUserCache(id);

            console.log(
                `🔐 Password for "${existingUser.username}" reset to default by ${req.user?.username || 'System'}.`
            );

            res.status(200).json({
                success: true,
                message: `Password for "${existingUser.username}" reset to the default.`,
                data: { username: existingUser.username }
            });
        } catch (error) {
            console.error('❌ Error resetting password:', error);
            res.status(500).json({
                success: false,
                message: 'Error resetting password',
                error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
            });
        }
    },

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
    },

    updateMyProfile: async (req, res) => {
        try {
            const userId = req.user.id;
            const currentUser = await UserModel.getUserById(userId);

            if (!currentUser) {
                return res.status(404).json({
                    success: false,
                    message: 'User not found'
                });
            }

            const {
                first_name,
                last_name,
                username,
                email,
                current_password,
                new_password
            } = req.body || {};

            const cleanFirst    = String(first_name ?? '').trim();
            const cleanLast     = String(last_name  ?? '').trim();
            const cleanUsername = String(username   ?? '').trim();
            const cleanEmail    = String(email      ?? '').trim().toLowerCase();

            if (!cleanFirst || !cleanLast || !cleanUsername || !cleanEmail) {
                return res.status(400).json({
                    success: false,
                    message: 'First name, last name, username, and email are required.'
                });
            }

            if (cleanFirst.length > SELF_EDIT.FIRST_NAME_MAX ||
                cleanLast.length  > SELF_EDIT.LAST_NAME_MAX) {
                return res.status(400).json({
                    success: false,
                    message: 'Name is too long.'
                });
            }

            if (cleanUsername.length < SELF_EDIT.USERNAME_MIN ||
                cleanUsername.length > SELF_EDIT.USERNAME_MAX) {
                return res.status(400).json({
                    success: false,
                    message: `Username must be between ${SELF_EDIT.USERNAME_MIN} and ${SELF_EDIT.USERNAME_MAX} characters.`
                });
            }

            if (!SELF_EDIT.USERNAME_PATTERN.test(cleanUsername)) {
                return res.status(400).json({
                    success: false,
                    message: 'Username may only contain letters, numbers, dots, underscores, and hyphens.'
                });
            }

            if (cleanEmail.length > SELF_EDIT.EMAIL_MAX ||
                !SELF_EDIT.EMAIL_PATTERN.test(cleanEmail)) {
                return res.status(400).json({
                    success: false,
                    message: 'Email must be a Lepanto email (@lepantomining.com).'
                });
            }

            const usernameChanged = cleanUsername.toLowerCase() !== String(currentUser.username || '').toLowerCase();
            const emailChanged    = cleanEmail.toLowerCase()    !== String(currentUser.email    || '').toLowerCase();
            const firstNameChanged = cleanFirst !== (currentUser.first_name || '');
            const lastNameChanged  = cleanLast  !== (currentUser.last_name  || '');
            const wantsPasswordChange =
                typeof new_password === 'string' && new_password.length > 0;

            const anyChange =
                usernameChanged ||
                emailChanged ||
                firstNameChanged ||
                lastNameChanged ||
                wantsPasswordChange;

            if (!anyChange) {
                return res.status(400).json({
                    success: false,
                    message: 'No changes to save.'
                });
            }

            const sensitiveChange = usernameChanged || emailChanged || wantsPasswordChange;
            if (sensitiveChange) {
                if (!current_password || typeof current_password !== 'string') {
                    return res.status(400).json({
                        success: false,
                        message: 'Your current password is required to change your username, email, or password.'
                    });
                }

                const passwordOk = await bcrypt.compare(current_password, currentUser.password_hash);
                if (!passwordOk) {
                    return res.status(401).json({
                        success: false,
                        message: 'Current password is incorrect.'
                    });
                }
            }

            let password_hash = null;
            if (wantsPasswordChange) {
                if (new_password.length > PASSWORD_POLICY.MAX) {
                    return res.status(400).json({
                        success: false,
                        message: 'New password is too long.'
                    });
                }

                const pwViolations = getPasswordPolicyViolations(new_password);
                if (pwViolations.length > 0) {
                    return res.status(400).json({
                        success: false,
                        message: 'Password must contain: ' + pwViolations.join(' · ')
                    });
                }

                const sameAsCurrent = await bcrypt.compare(new_password, currentUser.password_hash);
                if (sameAsCurrent) {
                    return res.status(400).json({
                        success: false,
                        message: 'New password must be different from your current password.'
                    });
                }

                const saltRounds = parseInt(process.env.BCRYPT_SALT_ROUNDS) || 10;
                password_hash = await bcrypt.hash(new_password, saltRounds);
            }

            if (usernameChanged) {
                const taken = await UserModel.usernameExistsExcept(cleanUsername, userId);
                if (taken) {
                    return res.status(409).json({
                        success: false,
                        message: 'That username is already taken.'
                    });
                }
            }

            if (emailChanged) {
                const taken = await UserModel.emailExistsExcept(cleanEmail, userId);
                if (taken) {
                    return res.status(409).json({
                        success: false,
                        message: 'That email is already in use.'
                    });
                }
            }

            await UserModel.updateSelf(userId, {
                first_name: cleanFirst,
                last_name: cleanLast,
                username: cleanUsername,
                email: cleanEmail,
                password_hash,
                updated_by: currentUser.username || 'Self'
            });

            await UserModel.clearActiveSession(userId);
            clearUserCache(userId);

            const changedFields = [];
            if (firstNameChanged) changedFields.push('first_name');
            if (lastNameChanged)  changedFields.push('last_name');
            if (usernameChanged)  changedFields.push('username');
            if (emailChanged)     changedFields.push('email');
            if (wantsPasswordChange) changedFields.push('password');

            console.log(
                `👤 Self-update: "${currentUser.username}" changed [${changedFields.join(', ')}] — session cleared.`
            );

            return res.status(200).json({
                success: true,
                code: 'CREDENTIALS_UPDATED',
                message: 'Your credentials have been updated. Please log in again.',
                data: {
                    requiresReauth: true,
                    changedFields
                }
            });
        } catch (error) {
            console.error('❌ Error in updateMyProfile:', error);
            return res.status(500).json({
                success: false,
                message: 'Error updating profile',
                error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
            });
        }
    }
};

module.exports = userController;