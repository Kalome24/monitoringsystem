// models/userModel.js
const { query } = require('../db');

const UserModel = {
    /* ============================================================
       READ — every user SELECT now returns profile_image and the
       is_currently_logged_in flag so the frontend can show status.
       ============================================================ */

    getAllUsers: async () => {
        try {
            const rows = await query(`
                SELECT 
                    u.id,
                    u.public_user_id,
                    u.username,
                    u.password_hash,
                    u.first_name,
                    u.last_name,
                    u.user_role,
                    u.emp_position,
                    u.can_approve_sts,
                    u.warehouse_assigned,
                    u.email,
                    u.status,
                    u.profile_image,
                    u.active_session_token,
                    u.active_session_at,
                    u.created_at,
                    u.created_by,
                    u.updated_at,
                    u.updated_by,
                    u.last_login,
                    w.warehouse_code,
                    w.warehouse_name AS warehouse_name,
                    w.warehouse_location,
                    w.status AS warehouse_status,
                    CASE
                        WHEN u.active_session_token IS NOT NULL
                         AND u.active_session_at IS NOT NULL
                         AND DATEDIFF(HOUR, u.active_session_at, GETDATE()) < 24
                        THEN 1 ELSE 0
                    END AS is_currently_logged_in
                FROM user_table u
                LEFT JOIN warehouse_table w ON u.warehouse_assigned = w.warehouse_id
                ORDER BY u.id
            `);
            return rows;
        } catch (error) {
            console.error('❌ Error in getAllUsers:', error);
            throw error;
        }
    },

    getUserById: async (id) => {
        try {
            const rows = await query(`
                SELECT 
                    u.id,
                    u.public_user_id,
                    u.username,
                    u.password_hash,
                    u.first_name,
                    u.last_name,
                    u.user_role,
                    u.emp_position,
                    u.can_approve_sts,
                    u.warehouse_assigned,
                    u.email,
                    u.status,
                    u.profile_image,
                    u.active_session_token,
                    u.active_session_at,
                    u.created_at,
                    u.created_by,
                    u.updated_at,
                    u.updated_by,
                    u.last_login,
                    w.warehouse_code,
                    w.warehouse_name AS warehouse_name,
                    w.warehouse_location,
                    w.status AS warehouse_status,
                    CASE
                        WHEN u.active_session_token IS NOT NULL
                         AND u.active_session_at IS NOT NULL
                         AND DATEDIFF(HOUR, u.active_session_at, GETDATE()) < 24
                        THEN 1 ELSE 0
                    END AS is_currently_logged_in
                FROM user_table u
                LEFT JOIN warehouse_table w ON u.warehouse_assigned = w.warehouse_id
                WHERE u.id = @param0
            `, [id]);
            return rows[0];
        } catch (error) {
            console.error(`❌ Error in getUserById for ID ${id}:`, error);
            throw error;
        }
    },

    getUserByPublicId: async (publicUserId) => {
        try {
            const rows = await query(`
                SELECT 
                    u.id,
                    u.public_user_id,
                    u.username,
                    u.password_hash,
                    u.first_name,
                    u.last_name,
                    u.user_role,
                    u.emp_position,
                    u.can_approve_sts,
                    u.warehouse_assigned,
                    u.email,
                    u.status,
                    u.profile_image,
                    u.active_session_token,
                    u.active_session_at,
                    u.created_at,
                    u.created_by,
                    u.updated_at,
                    u.updated_by,
                    u.last_login,
                    w.warehouse_code,
                    w.warehouse_name AS warehouse_name,
                    w.warehouse_location,
                    w.status AS warehouse_status,
                    CASE
                        WHEN u.active_session_token IS NOT NULL
                         AND u.active_session_at IS NOT NULL
                         AND DATEDIFF(HOUR, u.active_session_at, GETDATE()) < 24
                        THEN 1 ELSE 0
                    END AS is_currently_logged_in
                FROM user_table u
                LEFT JOIN warehouse_table w ON u.warehouse_assigned = w.warehouse_id
                WHERE u.public_user_id = @param0
            `, [publicUserId]);
            return rows[0];
        } catch (error) {
            console.error(`❌ Error in getUserByPublicId for ${publicUserId}:`, error);
            throw error;
        }
    },

    /**
     * Get user by username (used during login)
     * Includes active session columns so the login controller can
     * enforce the single-session rule.
     */
    getUserByUsername: async (username) => {
        try {
            const rows = await query(`
                SELECT 
                    u.id,
                    u.public_user_id,
                    u.username,
                    u.password_hash,
                    u.first_name,
                    u.last_name,
                    u.user_role,
                    u.emp_position,
                    u.can_approve_sts,
                    u.warehouse_assigned,
                    u.email,
                    u.status,
                    u.profile_image,
                    u.active_session_token,
                    u.active_session_at,
                    u.created_at,
                    u.created_by,
                    u.updated_at,
                    u.updated_by,
                    u.last_login,
                    w.warehouse_code,
                    w.warehouse_name AS warehouse_name,
                    w.warehouse_location,
                    w.status AS warehouse_status
                FROM user_table u
                LEFT JOIN warehouse_table w ON u.warehouse_assigned = w.warehouse_id
                WHERE u.username = @param0
            `, [username]);
            return rows[0];
        } catch (error) {
            console.error(`❌ Error in getUserByUsername for ${username}:`, error);
            throw error;
        }
    },

    usernameExists: async (username) => {
        try {
            const rows = await query(
                'SELECT id FROM user_table WHERE username = @param0',
                [username]
            );
            return rows.length > 0;
        } catch (error) {
            console.error(`❌ Error in usernameExists for ${username}:`, error);
            throw error;
        }
    },

    emailExists: async (email) => {
        try {
            const rows = await query(
                'SELECT id FROM user_table WHERE email = @param0',
                [email]
            );
            return rows.length > 0;
        } catch (error) {
            console.error(`❌ Error in emailExists for ${email}:`, error);
            throw error;
        }
    },

    getNextPublicId: async () => {
        try {
            const rows = await query(`
                SELECT ISNULL(MAX(CAST(REPLACE(public_user_id, 'USR-', '') AS INT)), 0) + 1 as nextId
                FROM user_table
            `);
            return rows[0]?.nextId || 1;
        } catch (error) {
            console.error('❌ Error in getNextPublicId:', error);
            throw error;
        }
    },

    getUsersByStatus: async (status) => {
        try {
            const rows = await query(`
                SELECT 
                    u.id,
                    u.public_user_id,
                    u.username,
                    u.password_hash,
                    u.first_name,
                    u.last_name,
                    u.user_role,
                    u.emp_position,
                    u.can_approve_sts,
                    u.warehouse_assigned,
                    u.email,
                    u.status,
                    u.profile_image,
                    w.warehouse_code,
                    w.warehouse_name AS warehouse_name,
                    w.status AS warehouse_status,
                    CASE
                        WHEN u.active_session_token IS NOT NULL
                         AND u.active_session_at IS NOT NULL
                         AND DATEDIFF(HOUR, u.active_session_at, GETDATE()) < 24
                        THEN 1 ELSE 0
                    END AS is_currently_logged_in
                FROM user_table u
                LEFT JOIN warehouse_table w ON u.warehouse_assigned = w.warehouse_id
                WHERE u.status = @param0
                ORDER BY u.last_name, u.first_name
            `, [status]);
            return rows;
        } catch (error) {
            console.error(`❌ Error in getUsersByStatus for status ${status}:`, error);
            throw error;
        }
    },

    searchUsers: async (searchTerm) => {
        try {
            const rows = await query(`
                SELECT 
                    u.id,
                    u.public_user_id,
                    u.username,
                    u.password_hash,
                    u.first_name,
                    u.last_name,
                    u.user_role,
                    u.emp_position,
                    u.can_approve_sts,
                    u.warehouse_assigned,
                    u.email,
                    u.status,
                    u.profile_image,
                    u.created_at,
                    u.created_by,
                    w.warehouse_code,
                    w.warehouse_name AS warehouse_name,
                    w.status AS warehouse_status,
                    CASE
                        WHEN u.active_session_token IS NOT NULL
                         AND u.active_session_at IS NOT NULL
                         AND DATEDIFF(HOUR, u.active_session_at, GETDATE()) < 24
                        THEN 1 ELSE 0
                    END AS is_currently_logged_in
                FROM user_table u
                LEFT JOIN warehouse_table w ON u.warehouse_assigned = w.warehouse_id
                WHERE u.first_name LIKE '%' + @param0 + '%'
                   OR u.last_name LIKE '%' + @param0 + '%'
                   OR u.username LIKE '%' + @param0 + '%'
                   OR u.email LIKE '%' + @param0 + '%'
                   OR u.public_user_id LIKE '%' + @param0 + '%'
                   OR u.emp_position LIKE '%' + @param0 + '%'
                ORDER BY u.last_name, u.first_name
            `, [searchTerm]);
            return rows;
        } catch (error) {
            console.error(`❌ Error in searchUsers for term "${searchTerm}":`, error);
            throw error;
        }
    },

    /* ============================================================
       WRITE
       ============================================================ */

    createUser: async (userData) => {
        try {
            const {
                username,
                password_hash,
                first_name,
                last_name,
                user_role,
                emp_position,
                can_approve_sts,
                warehouse_assigned,
                email,
                status,
                created_by
            } = userData;

            const nextId = await UserModel.getNextPublicId();
            const public_user_id = 'USR-' + String(nextId).padStart(3, '0');

            const result = await query(`
                INSERT INTO user_table (
                    username,
                    password_hash,
                    first_name,
                    last_name,
                    user_role,
                    emp_position,
                    can_approve_sts,
                    warehouse_assigned,
                    email,
                    status,
                    created_by,
                    public_user_id
                )
                VALUES (
                    @param0, @param1, @param2, @param3, 
                    @param4, @param5, @param6, @param7, 
                    @param8, @param9, @param10, @param11
                );
                SELECT SCOPE_IDENTITY() AS id;
            `, [
                username,
                password_hash,
                first_name,
                last_name,
                user_role,
                emp_position || null,
                can_approve_sts ? 1 : 0,
                warehouse_assigned || null,
                email,
                status || 'Active',
                created_by,
                public_user_id
            ]);

            return result[0]?.id || null;
        } catch (error) {
            console.error('❌ Error in createUser:', error);
            throw error;
        }
    },

    updateUser: async (id, userData) => {
        try {
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
                password_hash,
                updated_by
            } = userData;

            const updates = [];
            const params = [];

            const fields = [
                { name: 'username', value: username },
                { name: 'first_name', value: first_name },
                { name: 'last_name', value: last_name },
                { name: 'user_role', value: user_role },
                { name: 'emp_position', value: emp_position || null },
                { name: 'can_approve_sts', value: can_approve_sts ? 1 : 0 },
                { name: 'warehouse_assigned', value: warehouse_assigned || null },
                { name: 'email', value: email },
                { name: 'status', value: status },
                { name: 'updated_by', value: updated_by }
            ];

            fields.forEach(field => {
                updates.push(`${field.name} = @param${params.length}`);
                params.push(field.value);
            });

            if (password_hash) {
                updates.push(`password_hash = @param${params.length}`);
                params.push(password_hash);
            }

            updates.push(`updated_at = GETDATE()`);
            params.push(id);

            const queryString = `
                UPDATE user_table SET
                    ${updates.join(', ')}
                WHERE id = @param${params.length - 1}
            `;

            await query(queryString, params);
            return true;
        } catch (error) {
            console.error(`❌ Error in updateUser for ID ${id}:`, error);
            throw error;
        }
    },

    updatePassword: async (id, password_hash, updated_by) => {
        try {
            await query(`
                UPDATE user_table SET
                    password_hash = @param0,
                    updated_at = GETDATE(),
                    updated_by = @param1
                WHERE id = @param2
            `, [password_hash, updated_by, id]);

            return true;
        } catch (error) {
            console.error(`❌ Error in updatePassword for ID ${id}:`, error);
            throw error;
        }
    },

    updateLastLogin: async (id) => {
        try {
            await query(`
                UPDATE user_table SET
                    last_login = GETDATE()
                WHERE id = @param0
            `, [id]);
            return true;
        } catch (error) {
            console.error(`❌ Error in updateLastLogin for ID ${id}:`, error);
            throw error;
        }
    },

    /**
     * Update the user's profile image (base64 data URL).
     */
    updateProfileImage: async (id, profileImage) => {
        try {
            await query(`
                UPDATE user_table SET
                    profile_image = @param0,
                    updated_at = GETDATE()
                WHERE id = @param1
            `, [profileImage || null, id]);
            return true;
        } catch (error) {
            console.error(`❌ Error in updateProfileImage for ID ${id}:`, error);
            throw error;
        }
    },

    /**
     * Deactivate user — also clears any active session so a
     * deactivated account cannot remain logged in.
     */
    deactivateUser: async (id, updated_by) => {
        try {
            await query(`
                UPDATE user_table SET
                    status = 'Inactive',
                    active_session_token = NULL,
                    active_session_at = NULL,
                    updated_at = GETDATE(),
                    updated_by = @param0
                WHERE id = @param1
            `, [updated_by, id]);

            return true;
        } catch (error) {
            console.error(`❌ Error in deactivateUser for ID ${id}:`, error);
            throw error;
        }
    },

    activateUser: async (id, updated_by) => {
        try {
            await query(`
                UPDATE user_table SET
                    status = 'Active',
                    updated_at = GETDATE(),
                    updated_by = @param0
                WHERE id = @param1
            `, [updated_by, id]);

            return true;
        } catch (error) {
            console.error(`❌ Error in activateUser for ID ${id}:`, error);
            throw error;
        }
    },

    /* ============================================================
       SESSION MANAGEMENT — single active login per user
       ============================================================ */

    /**
     * Read the raw active session info for a user.
     * @returns {Promise<{token: string, startedAt: Date}|null>}
     */
    getActiveSessionInfo: async (userId) => {
        try {
            const rows = await query(
                `SELECT active_session_token, active_session_at
                 FROM user_table
                 WHERE id = @param0`,
                [userId]
            );
            const row = rows[0];
            if (!row || !row.active_session_token) return null;
            return {
                token: row.active_session_token,
                startedAt: row.active_session_at
            };
        } catch (error) {
            console.error(`❌ Error in getActiveSessionInfo for ID ${userId}:`, error);
            throw error;
        }
    },

    /**
     * Store the JWT as the user's active session (called on login).
     */
    setActiveSession: async (userId, token) => {
        try {
            await query(
                `UPDATE user_table
                 SET active_session_token = @param0,
                     active_session_at = GETDATE()
                 WHERE id = @param1`,
                [token, userId]
            );
            return true;
        } catch (error) {
            console.error(`❌ Error in setActiveSession for ID ${userId}:`, error);
            throw error;
        }
    },

    /**
     * Clear the user's active session.
     * Used on logout, deactivate, force-logout, and stale sweep.
     */
    clearActiveSession: async (userId) => {
        try {
            await query(
                `UPDATE user_table
                 SET active_session_token = NULL,
                     active_session_at = NULL
                 WHERE id = @param0`,
                [userId]
            );
            return true;
        } catch (error) {
            console.error(`❌ Error in clearActiveSession for ID ${userId}:`, error);
            throw error;
        }
    },

    /**
     * Housekeeping — clear all sessions older than 24 hours.
     */
    sweepStaleSessions: async () => {
        try {
            await query(
                `UPDATE user_table
                 SET active_session_token = NULL,
                     active_session_at = NULL
                 WHERE active_session_token IS NOT NULL
                   AND active_session_at IS NOT NULL
                   AND DATEDIFF(HOUR, active_session_at, GETDATE()) >= 24`
            );
            return true;
        } catch (error) {
            console.error('❌ Error in sweepStaleSessions:', error);
            throw error;
        }
    }
};

module.exports = UserModel;