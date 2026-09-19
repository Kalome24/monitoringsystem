// models/warehouseModel.js
const { query } = require('../db');

const WarehouseModel = {
    /**
     * Get all warehouses
     */
    getAllWarehouses: async () => {
        try {
            const rows = await query(`
                SELECT 
                    warehouse_id,
                    warehouse_name,
                    warehouse_code,
                    warehouse_location,
                    status,
                    created_at,
                    created_by,
                    updated_at,
                    updated_by
                FROM warehouse_table
                ORDER BY warehouse_id
            `);
            return rows;
        } catch (error) {
            console.error('❌ Error in getAllWarehouses:', error);
            throw error;
        }
    },

    /**
     * Get all warehouses with assigned user count.
     * Used by the frontend to show badges and disable buttons.
     */
    getAllWarehousesWithCounts: async () => {
        try {
            const rows = await query(`
                SELECT 
                    w.warehouse_id,
                    w.warehouse_name,
                    w.warehouse_code,
                    w.warehouse_location,
                    w.status,
                    w.created_at,
                    w.created_by,
                    w.updated_at,
                    w.updated_by,
                    (SELECT COUNT(*) FROM user_table u WHERE u.warehouse_assigned = w.warehouse_id) AS user_count
                FROM warehouse_table w
                ORDER BY w.warehouse_id
            `);
            return rows;
        } catch (error) {
            console.error('❌ Error in getAllWarehousesWithCounts:', error);
            throw error;
        }
    },

    /**
     * Get warehouse by ID
     */
    getWarehouseById: async (id) => {
        try {
            const rows = await query(`
                SELECT 
                    warehouse_id,
                    warehouse_name,
                    warehouse_code,
                    warehouse_location,
                    status,
                    created_at,
                    created_by,
                    updated_at,
                    updated_by
                FROM warehouse_table
                WHERE warehouse_id = @param0
            `, [id]);
            return rows[0];
        } catch (error) {
            console.error(`❌ Error in getWarehouseById for ID ${id}:`, error);
            throw error;
        }
    },

    /**
     * Get warehouse by warehouse_code (used for FK checks)
     */
    getWarehouseByCode: async (code) => {
        try {
            const rows = await query(`
                SELECT 
                    warehouse_id,
                    warehouse_name,
                    warehouse_code,
                    warehouse_location,
                    status,
                    created_at,
                    created_by,
                    updated_at,
                    updated_by
                FROM warehouse_table
                WHERE warehouse_code = @param0
            `, [code]);
            return rows[0];
        } catch (error) {
            console.error(`❌ Error in getWarehouseByCode for code ${code}:`, error);
            throw error;
        }
    },

    /**
     * Get active warehouses (for dropdown)
     */
    getActiveWarehouses: async () => {
        try {
            const rows = await query(`
                SELECT 
                    warehouse_id,
                    warehouse_name,
                    warehouse_code,
                    warehouse_location
                FROM warehouse_table
                WHERE status = 'Active'
                ORDER BY warehouse_name
            `);
            return rows;
        } catch (error) {
            console.error('❌ Error in getActiveWarehouses:', error);
            throw error;
        }
    },

    /**
     * Create warehouse
     */
    createWarehouse: async (warehouseData) => {
        try {
            const {
                warehouse_name,
                warehouse_code,
                warehouse_location,
                status,
                created_by
            } = warehouseData;

            const existing = await query(
                'SELECT warehouse_id FROM warehouse_table WHERE warehouse_code = @param0',
                [warehouse_code]
            );

            if (existing.length > 0) {
                throw new Error('Warehouse code already exists');
            }

            const result = await query(`
                INSERT INTO warehouse_table (
                    warehouse_name,
                    warehouse_code,
                    warehouse_location,
                    status,
                    created_by
                )
                VALUES (
                    @param0, @param1, @param2, @param3, @param4
                );
                SELECT SCOPE_IDENTITY() AS id;
            `, [
                warehouse_name,
                warehouse_code,
                warehouse_location || null,
                status || 'Active',
                created_by || 'System'
            ]);

            return result[0]?.id || null;
        } catch (error) {
            console.error('❌ Error in createWarehouse:', error);
            throw error;
        }
    },

    /**
     * Update warehouse
     */
    updateWarehouse: async (id, warehouseData) => {
        try {
            const {
                warehouse_name,
                warehouse_code,
                warehouse_location,
                status,
                updated_by
            } = warehouseData;

            // Check code conflict with a different warehouse
            const existing = await query(
                'SELECT warehouse_id FROM warehouse_table WHERE warehouse_code = @param0 AND warehouse_id != @param1',
                [warehouse_code, id]
            );
            if (existing.length > 0) {
                throw new Error('Warehouse code already exists for a different warehouse');
            }

            await query(`
                UPDATE warehouse_table SET
                    warehouse_name = @param0,
                    warehouse_code = @param1,
                    warehouse_location = @param2,
                    status = @param3,
                    updated_at = GETDATE(),
                    updated_by = @param4
                WHERE warehouse_id = @param5
            `, [
                warehouse_name,
                warehouse_code,
                warehouse_location || null,
                status,
                updated_by || 'System',
                id
            ]);

            return true;
        } catch (error) {
            console.error(`❌ Error in updateWarehouse for ID ${id}:`, error);
            throw error;
        }
    },

    /**
     * Deactivate warehouse (soft delete)
     */
    deactivateWarehouse: async (id, updated_by) => {
        try {
            await query(`
                UPDATE warehouse_table SET
                    status = 'Deactivated',
                    updated_at = GETDATE(),
                    updated_by = @param0
                WHERE warehouse_id = @param1
            `, [updated_by || 'System', id]);

            return true;
        } catch (error) {
            console.error(`❌ Error in deactivateWarehouse for ID ${id}:`, error);
            throw error;
        }
    },

    /**
     * Activate warehouse
     */
    activateWarehouse: async (id, updated_by) => {
        try {
            await query(`
                UPDATE warehouse_table SET
                    status = 'Active',
                    updated_at = GETDATE(),
                    updated_by = @param0
                WHERE warehouse_id = @param1
            `, [updated_by || 'System', id]);

            return true;
        } catch (error) {
            console.error(`❌ Error in activateWarehouse for ID ${id}:`, error);
            throw error;
        }
    },

    /**
     * PERMANENT delete of a warehouse.
     * Caller must have already checked user constraints.
     */
    deleteWarehouse: async (id) => {
        try {
            await query('DELETE FROM warehouse_table WHERE warehouse_id = @param0', [id]);
            return true;
        } catch (error) {
            console.error(`❌ Error in deleteWarehouse for ID ${id}:`, error);
            throw error;
        }
    },

    /**
     * Check if warehouse code exists
     */
    warehouseCodeExists: async (code) => {
        try {
            const rows = await query(
                'SELECT warehouse_id FROM warehouse_table WHERE warehouse_code = @param0',
                [code]
            );
            return rows.length > 0;
        } catch (error) {
            console.error(`❌ Error in warehouseCodeExists for code ${code}:`, error);
            throw error;
        }
    },

    /**
     * Count users assigned to a warehouse (by warehouse_id).
     * Used to block deletion of any warehouse that still has users.
     */
    countUsersInWarehouse: async (warehouseId) => {
        try {
            const rows = await query(
                'SELECT COUNT(*) AS cnt FROM user_table WHERE warehouse_assigned = @param0',
                [warehouseId]
            );
            return rows[0]?.cnt || 0;
        } catch (error) {
            console.error(`❌ Error in countUsersInWarehouse for ID ${warehouseId}:`, error);
            throw error;
        }
    }
};

module.exports = WarehouseModel;