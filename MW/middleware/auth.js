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

/**
 * Authentication Middleware
 * 1. Verifies the JWT from the Authorization header (signature + expiry).
 * 2. Enforces the single-active-session rule: the incoming token must
 *    match the `active_session_token` stored in the DB for that user.
 *    If it doesn't, the session was replaced elsewhere → 401.
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

        // ---- 1) Verify JWT ----
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

        // ---- 2) Single-session enforcement ----
        const rows = await query(
            `SELECT id, status, active_session_token
             FROM user_table
             WHERE id = @param0`,
            [decoded.id]
        );
        const dbUser = rows[0];

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

        // Attach decoded user info (including warehouse_assigned)
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
        return next();
    }

    return res.status(403).json({
        success: false,
        message: 'Invalid role. Access denied.'
    });
};

module.exports = { auth, authorize, requireWarehouse, ROLES };