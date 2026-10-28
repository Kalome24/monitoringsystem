// models/userModel.js
const { query } = require('../db');

/* ============================================================
   BODEGA ASSIGNMENT HELPERS
   ============================================================ */

const ASSIGNED_BODEGAS_SQL = `
  (
    SELECT STRING_AGG(locator_code, ',') WITHIN GROUP (ORDER BY locator_code)
    FROM dbo.user_bodega_assignments
    WHERE user_id = u.id
  ) AS assigned_bodegas_csv
`;

const parseAssignments = (row) => {
    if (!row) return row;
    const csv = row.assigned_bodegas_csv;
    delete row.assigned_bodegas_csv;
    return {
        ...row,
        assigned_bodegas: csv ? String(csv).split(',').filter(Boolean) : [],
    };
};

const UserModel = {
    /* ============================================================
       READ
       ============================================================ */

    getUserBodegaAssignments: async (userId) => {
        try {
            const rows = await query(
                `SELECT locator_code, warehouse_code
                   FROM dbo.user_bodega_assignments
                  WHERE user_id = @param0
                  ORDER BY locator_code`,
                [userId]
            );
            return rows;
        } catch (error) {
            console.error(`❌ Error in getUserBodegaAssignments for ID ${userId}:`, error);
            throw error;
        }
    },

    /**
     * Returns null when the caller should see EVERY locator in the
     * warehouse (admins, non-handlers, or handlers with no assignments).
     * Returns an array of locator codes when the caller should be scoped.
     *
     * Callers pass a fully-hydrated user row (with user_role +
     * emp_position + id + warehouse_assigned).
     */
    getAssignedLocatorsForUser: async (user) => {
        if (!user) return null;
        const role = String(user.user_role || '').trim();
        const pos  = String(user.emp_position || '').trim();

        if (role === 'Admin' || role === 'Super Admin') return null;
        if (pos !== 'Underground Handler') return null;

        const assignments = await UserModel.getUserBodegaAssignments(user.id);
        if (!assignments || assignments.length === 0) return null;
        return assignments.map((a) => a.locator_code);
    },

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
                    CASE WHEN u.profile_image IS NOT NULL THEN 1 ELSE 0 END AS has_profile_image,
                    u.active_session_token,
                    u.active_session_at,
                    u.active_session_last_seen,
                    u.password_changed_at,
                    u.created_at,
                    u.created_by,
                    u.updated_at,
                    u.updated_by,
                    u.last_login,
                    ${ASSIGNED_BODEGAS_SQL},
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
            return rows.map(parseAssignments);
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
                    u.active_session_last_seen,
                    u.password_changed_at,
                    u.created_at,
                    u.created_by,
                    u.updated_at,
                    u.updated_by,
                    u.last_login,
                    ${ASSIGNED_BODEGAS_SQL},
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
            return parseAssignments(rows[0]);
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
                    u.active_session_last_seen,
                    u.password_changed_at,
                    u.created_at,
                    u.created_by,
                    u.updated_at,
                    u.updated_by,
                    u.last_login,
                    ${ASSIGNED_BODEGAS_SQL},
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
            return parseAssignments(rows[0]);
        } catch (error) {
            console.error(`❌ Error in getUserByPublicId for ${publicUserId}:`, error);
            throw error;
        }
    },

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
                    u.active_session_last_seen,
                    u.password_changed_at,
                    u.created_at,
                    u.created_by,
                    u.updated_at,
                    u.updated_by,
                    u.last_login,
                    ${ASSIGNED_BODEGAS_SQL},
                    w.warehouse_code,
                    w.warehouse_name AS warehouse_name,
                    w.warehouse_location,
                    w.status AS warehouse_status
                FROM user_table u
                LEFT JOIN warehouse_table w ON u.warehouse_assigned = w.warehouse_id
                WHERE u.username = @param0
            `, [username]);
            return parseAssignments(rows[0]);
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

    usernameExistsExcept: async (username, excludeId) => {
        try {
            const rows = await query(
                'SELECT id FROM user_table WHERE username = @param0 AND id <> @param1',
                [username, excludeId]
            );
            return rows.length > 0;
        } catch (error) {
            console.error(`❌ Error in usernameExistsExcept for ${username}:`, error);
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

    emailExistsExcept: async (email, excludeId) => {
        try {
            const rows = await query(
                'SELECT id FROM user_table WHERE email = @param0 AND id <> @param1',
                [email, excludeId]
            );
            return rows.length > 0;
        } catch (error) {
            console.error(`❌ Error in emailExistsExcept for ${email}:`, error);
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
                    CASE WHEN u.profile_image IS NOT NULL THEN 1 ELSE 0 END AS has_profile_image,
                    ${ASSIGNED_BODEGAS_SQL},
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
            return rows.map(parseAssignments);
        } catch (error) {
            console.error(`❌ Error in getUsersByStatus for status ${status}:`, error);
            throw error;
        }
    },

    getDepartmentHeads: async () => {
        try {
            const rows = await query(`
                SELECT
                    u.id,
                    u.username,
                    u.email,
                    u.first_name,
                    u.last_name,
                    u.emp_position
                FROM user_table u
                WHERE u.user_role = 'Admin'
                  AND (u.emp_position = 'Department Head' OR u.can_approve_sts = 1)
                  AND u.status     = 'Active'
                  AND u.email IS NOT NULL
                  AND LTRIM(RTRIM(u.email)) <> ''
                ORDER BY u.id
            `);
            return rows;
        } catch (error) {
            console.error('❌ Error in getDepartmentHeads:', error);
            throw error;
        }
    },

    getAdminsAndSuperAdmins: async () => {
        try {
            const rows = await query(`
                SELECT
                    u.id,
                    u.username,
                    u.email,
                    u.first_name,
                    u.last_name,
                    u.user_role
                FROM user_table u
                WHERE u.user_role IN ('Admin', 'Super Admin')
                  AND u.status     = 'Active'
                  AND u.email IS NOT NULL
                  AND LTRIM(RTRIM(u.email)) <> ''
                ORDER BY u.id
            `);
            return rows;
        } catch (error) {
            console.error('❌ Error in getAdminsAndSuperAdmins:', error);
            throw error;
        }
    },

    getHandlersByWarehouseId: async (warehouseId) => {
        try {
            if (warehouseId == null || warehouseId === '') return [];
            const rows = await query(`
                SELECT
                    u.id,
                    u.username,
                    u.email,
                    u.first_name,
                    u.last_name,
                    u.warehouse_assigned
                FROM user_table u
                WHERE u.user_role          = 'Stock Handler'
                  AND u.status             = 'Active'
                  AND u.warehouse_assigned = @param0
                  AND u.email IS NOT NULL
                  AND LTRIM(RTRIM(u.email)) <> ''
                ORDER BY u.id
            `, [Number(warehouseId)]);
            return rows;
        } catch (error) {
            console.error(`❌ Error in getHandlersByWarehouseId for ${warehouseId}:`, error);
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
                    CASE WHEN u.profile_image IS NOT NULL THEN 1 ELSE 0 END AS has_profile_image,
                    u.created_at,
                    u.created_by,
                    ${ASSIGNED_BODEGAS_SQL},
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
            return rows.map(parseAssignments);
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
                    public_user_id,
                    password_changed_at
                )
                VALUES (
                    @param0, @param1, @param2, @param3,
                    @param4, @param5, @param6, @param7,
                    @param8, @param9, @param10, @param11,
                    GETDATE()
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
                updates.push(`password_changed_at = GETDATE()`);
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

    updateSelf: async (userId, fields) => {
        try {
            const {
                first_name,
                last_name,
                username,
                email,
                password_hash,
                updated_by
            } = fields;

            const updates = [];
            const params = [];

            updates.push(`first_name = @param${params.length}`);  params.push(first_name);
            updates.push(`last_name = @param${params.length}`);   params.push(last_name);
            updates.push(`username = @param${params.length}`);    params.push(username);
            updates.push(`email = @param${params.length}`);       params.push(email);
            updates.push(`updated_by = @param${params.length}`);  params.push(updated_by);

            if (password_hash) {
                updates.push(`password_hash = @param${params.length}`);        params.push(password_hash);
                updates.push(`password_changed_at = GETDATE()`);
            }

            updates.push(`updated_at = GETDATE()`);
            params.push(userId);

            await query(
                `UPDATE user_table SET ${updates.join(', ')} WHERE id = @param${params.length - 1}`,
                params
            );
            return true;
        } catch (error) {
            console.error(`❌ Error in updateSelf for ID ${userId}:`, error);
            throw error;
        }
    },

    updatePassword: async (id, password_hash, updated_by) => {
        try {
            await query(`
                UPDATE user_table SET
                    password_hash = @param0,
                    password_changed_at = GETDATE(),
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

    deactivateUser: async (id, updated_by) => {
        try {
            await query(`
                UPDATE user_table SET
                    status = 'Inactive',
                    active_session_token = NULL,
                    active_session_at = NULL,
                    active_session_last_seen = NULL,
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
       BODEGA ASSIGNMENT WRITE
       ============================================================ */

    /**
     * Replace all bodega assignments for a user.
     * locatorCodes: array of strings (may be empty).
     * warehouseCode: the user's assigned warehouse_code.
     */
    setUserBodegaAssignments: async (userId, locatorCodes, warehouseCode, assignedBy) => {
        try {
            // Wipe existing
            await query(`DELETE FROM dbo.user_bodega_assignments WHERE user_id = @param0`, [userId]);

            if (!Array.isArray(locatorCodes) || locatorCodes.length === 0) return true;
            if (!warehouseCode) throw new Error('warehouse_code is required to save bodega assignments.');

            const unique = Array.from(new Set(locatorCodes.map(c => String(c).trim()).filter(Boolean)));

            for (const code of unique) {
                await query(`
                    INSERT INTO dbo.user_bodega_assignments
                        (user_id, warehouse_code, locator_code, assigned_by)
                    VALUES
                        (@param0, @param1, @param2, @param3)
                `, [userId, warehouseCode, code, assignedBy || null]);
            }

            return true;
        } catch (error) {
            console.error(`❌ Error in setUserBodegaAssignments for ID ${userId}:`, error);
            throw error;
        }
    },

    /* ============================================================
       SESSION MANAGEMENT
       ============================================================ */

    getActiveSessionInfo: async (userId) => {
        try {
            const rows = await query(
                `SELECT active_session_token, active_session_at, active_session_last_seen
                 FROM user_table
                 WHERE id = @param0`,
                [userId]
            );
            const row = rows[0];
            if (!row || !row.active_session_token) return null;
            return {
                token: row.active_session_token,
                startedAt: row.active_session_at,
                lastSeenAt: row.active_session_last_seen
            };
        } catch (error) {
            console.error(`❌ Error in getActiveSessionInfo for ID ${userId}:`, error);
            throw error;
        }
    },

    setActiveSession: async (userId, token) => {
        try {
            await query(
                `UPDATE user_table
                 SET active_session_token     = @param0,
                     active_session_at        = GETDATE(),
                     active_session_last_seen = GETDATE()
                 WHERE id = @param1`,
                [token, userId]
            );
            return true;
        } catch (error) {
            console.error(`❌ Error in setActiveSession for ID ${userId}:`, error);
            throw error;
        }
    },

    clearActiveSession: async (userId) => {
        try {
            await query(
                `UPDATE user_table
                 SET active_session_token     = NULL,
                     active_session_at        = NULL,
                     active_session_last_seen = NULL
                 WHERE id = @param0`,
                [userId]
            );
            return true;
        } catch (error) {
            console.error(`❌ Error in clearActiveSession for ID ${userId}:`, error);
            throw error;
        }
    },

    touchActiveSession: async (userId) => {
        try {
            await query(
                `UPDATE user_table
                 SET active_session_last_seen = GETDATE()
                 WHERE id = @param0`,
                [userId]
            );
            return true;
        } catch (error) {
            console.error(`❌ Error in touchActiveSession for ID ${userId}:`, error);
            throw error;
        }
    },

    sweepStaleSessions: async () => {
        try {
            await query(
                `UPDATE user_table
                 SET active_session_token     = NULL,
                     active_session_at        = NULL,
                     active_session_last_seen = NULL
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