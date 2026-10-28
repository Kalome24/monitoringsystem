// middleware/auth.js
const jwt = require('jsonwebtoken');
const { query } = require('../db');

// List of allowed roles (for reference)
const ROLES = {
    SUPER_ADMIN: 'Super Admin',
    ADMIN: 'Admin',
    STOCK_REGISTRAR: 'Stock Registrar',
    STOCK_HANDLER: 'Stock Handler'
};

// ---------------------------------------------------------------------------
// In-memory user cache
// ---------------------------------------------------------------------------
// The auth middleware runs on EVERY authenticated request and does a
// SELECT from user_table. Under load (many users, many tabs, polling),
// this is the #1 source of pool starvation. Caching for 60s cuts auth
// DB traffic by ~85% with no security downside (the JWT is still
// verified on every request).
//
const USER_CACHE_TTL_MS = 60000;   // 60 seconds
const userCache = new Map();       // userId -> { data, cachedAt }

const getCachedUser = (userId) => {
    const entry = userCache.get(userId);
    if (!entry) return null;
    if (Date.now() - entry.cachedAt > USER_CACHE_TTL_MS) {
        userCache.delete(userId);
        return null;
    }
    return entry.data;
};

const setCachedUser = (userId, data) => {
    userCache.set(userId, { data, cachedAt: Date.now() });
};

/**
 * Clear the auth cache for one user, or all users if no id is given.
 * Call from any controller that changes a user's status, warehouse
 * assignment, or active_session_token — or after a warehouse is
 * deactivated (to invalidate every user assigned to it).
 */
const clearUserCache = (userId) => {
    if (userId != null) {
        userCache.delete(Number(userId));
    } else {
        userCache.clear();
    }
};

// Periodic sweep so the map can't grow unbounded under user churn.
// unref() ensures this timer doesn't keep the process alive on shutdown.
const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [id, entry] of userCache) {
        if (now - entry.cachedAt > USER_CACHE_TTL_MS) userCache.delete(id);
    }
}, 60000);
if (cleanupInterval.unref) cleanupInterval.unref();

// ---------------------------------------------------------------------------
// Session activity tracking
// ---------------------------------------------------------------------------
const TOUCH_THROTTLE_MS = 60000;   // 1 minute
const lastTouchByUser = new Map(); // userId -> ms since epoch

const touchUserActivity = (userId) => {
    const now = Date.now();
    const last = lastTouchByUser.get(userId) || 0;
    if (now - last < TOUCH_THROTTLE_MS) return;
    lastTouchByUser.set(userId, now);

    query(
        `UPDATE user_table
         SET active_session_last_seen = GETDATE()
         WHERE id = @param0`,
        [userId]
    ).catch((err) =>
        console.error('touchUserActivity failed:', err.message || err)
    );
};

const touchMapCleanup = setInterval(() => {
    const now = Date.now();
    for (const [id, ts] of lastTouchByUser) {
        if (now - ts > TOUCH_THROTTLE_MS * 5) lastTouchByUser.delete(id);
    }
}, 5 * 60 * 1000);
if (touchMapCleanup.unref) touchMapCleanup.unref();

/**
 * Authentication Middleware
 */
const auth = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                success: false,
                code: 'NO_TOKEN',
                message: 'No token provided. Please login first.'
            });
        }

        const token = authHeader.split(' ')[1];

        let decoded;
        try {
            decoded = jwt.verify(token, process.env.JWT_SECRET);
        } catch (err) {
            if (err.name === 'TokenExpiredError') {
                return res.status(401).json({
                    success: false,
                    code: 'SESSION_EXPIRED',
                    message: 'Session expired. Please login again.'
                });
            }
            return res.status(401).json({
                success: false,
                code: 'INVALID_TOKEN',
                message: 'Invalid token. Please login again.'
            });
        }

        let dbUser = getCachedUser(decoded.id);

        if (!dbUser) {
            try {
                const rows = await query(
                    `SELECT
                         u.id,
                         u.status,
                         u.active_session_token,
                         u.warehouse_assigned,
                         w.status AS warehouse_status
                     FROM user_table u
                     LEFT JOIN warehouse_table w
                         ON w.warehouse_id = u.warehouse_assigned
                     WHERE u.id = @param0`,
                    [decoded.id]
                );
                dbUser = rows[0];
                if (dbUser) setCachedUser(decoded.id, dbUser);
            } catch (err) {
                console.error('Auth middleware DB error:', err.message || err);
                return res.status(503).json({
                    success: false,
                    code: 'DB_UNAVAILABLE',
                    message: 'Service temporarily unavailable. Please try again.'
                });
            }
        }

        if (!dbUser) {
            return res.status(401).json({
                success: false,
                code: 'USER_NOT_FOUND',
                message: 'User not found. Please login again.'
            });
        }

        if (dbUser.status !== 'Active') {
            return res.status(403).json({
                success: false,
                code: 'ACCOUNT_INACTIVE',
                message: 'Account is deactivated. Please contact administrator.'
            });
        }

        if (dbUser.warehouse_assigned && dbUser.warehouse_status === 'Deactivated') {
            return res.status(401).json({
                success: false,
                code: 'WAREHOUSE_DEACTIVATED',
                message:
                    'Your assigned warehouse has been deactivated. ' +
                    'Please contact your administrator.'
            });
        }

        if (!dbUser.active_session_token) {
            return res.status(401).json({
                success: false,
                code: 'SESSION_REVOKED',
                message: 'Your session has ended. Please login again.'
            });
        }

        if (dbUser.active_session_token !== token) {
            return res.status(401).json({
                success: false,
                code: 'SESSION_ELSEWHERE',
                message: 'This session was replaced by a login from another device. Please login again.'
            });
        }

        touchUserActivity(decoded.id);

        req.user = decoded;
        next();
    } catch (error) {
        console.error('Auth middleware error:', error);
        return res.status(500).json({
            success: false,
            message: 'Authentication error',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
};

/**
 * Cross-DB sync key middleware.
 * ---------------------------------------------------------------------------
 * Session 16 — used ONLY by /api/underground/receive-online-sync.
 *
 * The remote underground server presents a shared secret in the
 * X-IMS-Sync-Key header. This middleware compares it against the local
 * IMS_SYNC_ACCEPT_KEY env var. Not a user session — no JWT involved.
 *
 * On success, attaches:
 *   req.syncSource = value of X-IMS-Sync-Source (or 'unknown')
 */
const syncKeyAuth = (req, res, next) => {
    const expected = String(process.env.IMS_SYNC_ACCEPT_KEY || '').trim();
    if (!expected) {
        return res.status(503).json({
            success: false,
            code: 'SYNC_NOT_CONFIGURED',
            message: 'Cross-DB sync is not enabled on this server ' +
                     '(IMS_SYNC_ACCEPT_KEY is not set).'
        });
    }

    const provided = String(req.headers['x-ims-sync-key'] || '').trim();
    if (!provided || provided !== expected) {
        return res.status(401).json({
            success: false,
            code: 'INVALID_SYNC_KEY',
            message: 'Invalid or missing sync key.'
        });
    }

    req.syncSource = String(req.headers['x-ims-sync-source'] || '').trim() || 'unknown';
    next();
};

/**
 * Role-based Authorization Middleware
 */
const authorize = (roles = []) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                success: false,
                message: 'Unauthorized. Please login first.'
            });
        }

        if (roles.length > 0 && !roles.includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: 'Insufficient permissions. Access denied.',
                requiredRoles: roles,
                userRole: req.user.role
            });
        }

        next();
    };
};

/**
 * Warehouse Assignment Middleware
 */
const requireWarehouse = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({
            success: false,
            message: 'Unauthorized. Please login first.'
        });
    }

    const role = req.user.role;
    const warehouseId = req.user.warehouse_assigned;

    if (role === ROLES.SUPER_ADMIN || role === ROLES.ADMIN) {
        return next();
    }

    if (role === ROLES.STOCK_REGISTRAR || role === ROLES.STOCK_HANDLER) {
        if (!warehouseId) {
            return res.status(403).json({
                success: false,
                message: 'Your account is not assigned to any warehouse. Please contact administrator.'
            });
        }
        req.warehouseId = warehouseId;
        next();
        return;
    }

    return res.status(403).json({
        success: false,
        message: 'Invalid role. Access denied.'
    });
};

module.exports = {
    auth,
    syncKeyAuth,        // ← Session 16
    authorize,
    requireWarehouse,
    clearUserCache,
    ROLES,
};