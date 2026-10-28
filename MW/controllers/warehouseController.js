// controllers/warehouseController.js
const WarehouseModel = require('../models/warehouseModel');
const { clearUserCache } = require('../middleware/auth');

const warehouseController = {
    /**
     * Get all warehouses (with assigned user count badge)
     * GET /api/warehouses
     */
    getAllWarehouses: async (req, res) => {
        try {
            const warehouses = await WarehouseModel.getAllWarehousesWithCounts();
            res.status(200).json({
                success: true,
                data: warehouses
            });
        } catch (error) {
            console.error('❌ Error fetching warehouses:', error);
            res.status(500).json({
                success: false,
                message: 'Error fetching warehouses',
                error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
            });
        }
    },

    /**
     * Get warehouse by ID
     * GET /api/warehouses/:id
     */
    getWarehouseById: async (req, res) => {
        try {
            const { id } = req.params;
            const warehouse = await WarehouseModel.getWarehouseById(id);

            if (!warehouse) {
                return res.status(404).json({
                    success: false,
                    message: 'Warehouse not found'
                });
            }

            res.status(200).json({
                success: true,
                data: warehouse
            });
        } catch (error) {
            console.error('❌ Error fetching warehouse:', error);
            res.status(500).json({
                success: false,
                message: 'Error fetching warehouse',
                error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
            });
        }
    },

    /**
     * Get active warehouses (for dropdown)
     * GET /api/warehouses/active
     */
    getActiveWarehouses: async (req, res) => {
        try {
            const warehouses = await WarehouseModel.getActiveWarehouses();
            res.status(200).json({
                success: true,
                data: warehouses
            });
        } catch (error) {
            console.error('❌ Error fetching active warehouses:', error);
            res.status(500).json({
                success: false,
                message: 'Error fetching active warehouses',
                error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
            });
        }
    },

    /**
     * Create warehouse
     * POST /api/warehouses
     */
    createWarehouse: async (req, res) => {
        try {
            const {
                warehouse_name,
                warehouse_code,
                warehouse_location,
                status
            } = req.body;

            if (!warehouse_name || !warehouse_code) {
                return res.status(400).json({
                    success: false,
                    message: 'Warehouse Name and Code are required'
                });
            }

            const codeExists = await WarehouseModel.warehouseCodeExists(warehouse_code);
            if (codeExists) {
                return res.status(409).json({
                    success: false,
                    message: 'Warehouse code already exists. Please use a unique code.'
                });
            }

            const warehouseId = await WarehouseModel.createWarehouse({
                warehouse_name,
                warehouse_code,
                warehouse_location: warehouse_location || null,
                status: status || 'Active',
                created_by: req.user?.username || 'System'
            });

            const newWarehouse = await WarehouseModel.getWarehouseById(warehouseId);

            res.status(201).json({
                success: true,
                message: 'Warehouse created successfully',
                data: newWarehouse
            });
        } catch (error) {
            console.error('❌ Error creating warehouse:', error);
            res.status(500).json({
                success: false,
                message: 'Error creating warehouse',
                error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
            });
        }
    },

    /**
     * Update warehouse
     * PUT /api/warehouses/:id
     */
    updateWarehouse: async (req, res) => {
        try {
            const { id } = req.params;
            const {
                warehouse_name,
                warehouse_code,
                warehouse_location,
                status
            } = req.body;

            const existingWarehouse = await WarehouseModel.getWarehouseById(id);
            if (!existingWarehouse) {
                return res.status(404).json({
                    success: false,
                    message: 'Warehouse not found'
                });
            }

            if (!warehouse_name || !warehouse_code) {
                return res.status(400).json({
                    success: false,
                    message: 'Warehouse Name and Code are required'
                });
            }

            const codeExists = await WarehouseModel.warehouseCodeExists(warehouse_code);
            if (codeExists && existingWarehouse.warehouse_code !== warehouse_code) {
                return res.status(409).json({
                    success: false,
                    message: 'Warehouse code already exists. Please use a unique code.'
                });
            }

            await WarehouseModel.updateWarehouse(id, {
                warehouse_name,
                warehouse_code,
                warehouse_location: warehouse_location || null,
                status,
                updated_by: req.user?.username || 'System'
            });

            // If the update changed the warehouse status (via the general
            // update endpoint rather than the dedicated activate/deactivate
            // endpoints), we need to invalidate the auth cache for every
            // user assigned to this warehouse — otherwise their cached
            // warehouse_status would serve stale data for up to 60 s.
            const statusChanged = existingWarehouse.status !== status;
            if (statusChanged) {
                const affected = await require('../db').query(
                    'SELECT id FROM user_table WHERE warehouse_assigned = @param0',
                    [id]
                );
                affected.forEach((row) => clearUserCache(row.id));
            }

            const updatedWarehouse = await WarehouseModel.getWarehouseById(id);

            res.status(200).json({
                success: true,
                message: 'Warehouse updated successfully',
                data: updatedWarehouse
            });
        } catch (error) {
            console.error('❌ Error updating warehouse:', error);
            res.status(500).json({
                success: false,
                message: 'Error updating warehouse',
                error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
            });
        }
    },

    /**
     * Deactivate warehouse (soft delete).
     * PATCH /api/warehouses/:id/deactivate
     *
     * Side effect: every user assigned to this warehouse is signed out
     * immediately. Their active_session_token is wiped, and the auth
     * cache for each user is cleared so the next request re-reads the
     * fresh warehouse_status.
     */
    deactivateWarehouse: async (req, res) => {
        try {
            const { id } = req.params;
            const updated_by = req.user?.username || 'System';

            console.log(`🔧 Deactivating warehouse ID: ${id} by ${updated_by}`);

            const existingWarehouse = await WarehouseModel.getWarehouseById(id);
            if (!existingWarehouse) {
                return res.status(404).json({
                    success: false,
                    message: 'Warehouse not found'
                });
            }

            if (existingWarehouse.status === 'Deactivated') {
                return res.status(400).json({
                    success: false,
                    message: 'Warehouse is already deactivated'
                });
            }

            const { affectedUserIds } = await WarehouseModel.deactivateWarehouse(id, updated_by);

            // Drop the auth cache so the next request from each affected
            // user hits a fresh DB read and sees the deactivated warehouse.
            affectedUserIds.forEach((uid) => clearUserCache(uid));

            const updatedWarehouse = await WarehouseModel.getWarehouseById(id);

            console.log(
                `🔒 Warehouse ${existingWarehouse.warehouse_code} deactivated — ` +
                `${affectedUserIds.length} user session(s) cleared.`
            );

            res.status(200).json({
                success: true,
                message: 'Warehouse deactivated successfully',
                data: updatedWarehouse,
                affectedUsers: affectedUserIds.length
            });
        } catch (error) {
            console.error('❌ Error deactivating warehouse:', error);
            res.status(500).json({
                success: false,
                message: 'Error deactivating warehouse',
                error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
            });
        }
    },

    /**
     * Activate warehouse
     * PATCH /api/warehouses/:id/activate
     */
    activateWarehouse: async (req, res) => {
        try {
            const { id } = req.params;
            const updated_by = req.user?.username || 'System';

            console.log(`🔧 Activating warehouse ID: ${id} by ${updated_by}`);

            const existingWarehouse = await WarehouseModel.getWarehouseById(id);
            if (!existingWarehouse) {
                return res.status(404).json({
                    success: false,
                    message: 'Warehouse not found'
                });
            }

            if (existingWarehouse.status === 'Active') {
                return res.status(400).json({
                    success: false,
                    message: 'Warehouse is already active'
                });
            }

            const { affectedUserIds } = await WarehouseModel.activateWarehouse(id, updated_by);

            // Clear the cache so users assigned here aren't blocked by a
            // stale 'Deactivated' entry for up to 60 s.
            affectedUserIds.forEach((uid) => clearUserCache(uid));

            const updatedWarehouse = await WarehouseModel.getWarehouseById(id);

            res.status(200).json({
                success: true,
                message: 'Warehouse activated successfully',
                data: updatedWarehouse
            });
        } catch (error) {
            console.error('❌ Error activating warehouse:', error);
            res.status(500).json({
                success: false,
                message: 'Error activating warehouse',
                error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
            });
        }
    },

    /**
     * PERMANENTLY delete a warehouse.
     * DELETE /api/warehouses/:id
     *
     * Rules enforced:
     *  1. Request body must contain { confirm: "DELETE" } (case-sensitive).
     *  2. Cannot delete if any user is assigned to this warehouse_id.
     */
    deleteWarehouse: async (req, res) => {
        try {
            const { id } = req.params;
            const { confirm } = req.body || {};

            // ---------- Rule 1: typed confirmation ----------
            if (confirm !== 'DELETE') {
                return res.status(400).json({
                    success: false,
                    message: 'Deletion cancelled: confirmation text must be exactly "DELETE".'
                });
            }

            // ---------- Load warehouse ----------
            const existing = await WarehouseModel.getWarehouseById(id);
            if (!existing) {
                return res.status(404).json({
                    success: false,
                    message: 'Warehouse not found'
                });
            }

            // ---------- Rule 2: user assignment check ----------
            const userCount = await WarehouseModel.countUsersInWarehouse(existing.warehouse_id);
            if (userCount > 0) {
                return res.status(409).json({
                    success: false,
                    message:
                        `Cannot delete warehouse "${existing.warehouse_code}" because ` +
                        `${userCount} user(s) are assigned to it. Reassign them first.`
                });
            }

            // ---------- All checks passed — delete ----------
            await WarehouseModel.deleteWarehouse(id);

            console.log(`🗑️ Warehouse permanently deleted: ${existing.warehouse_code} (ID ${id}) by ${req.user?.username || 'System'}`);

            return res.status(200).json({
                success: true,
                message: `Warehouse "${existing.warehouse_code}" permanently deleted.`,
                data: { warehouse_id: existing.warehouse_id, warehouse_code: existing.warehouse_code }
            });
        } catch (error) {
            // Foreign key guard (in case some other table references this warehouse)
            const isFkViolation =
                error?.number === 547 ||
                error?.originalError?.number === 547 ||
                (typeof error?.message === 'string' && error.message.includes('REFERENCE constraint'));

            if (isFkViolation) {
                return res.status(409).json({
                    success: false,
                    message: 'Cannot delete warehouse because it is referenced by other records.'
                });
            }

            console.error('❌ Error deleting warehouse:', error);
            return res.status(500).json({
                success: false,
                message: 'Error deleting warehouse',
                error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
            });
        }
    }
};

module.exports = warehouseController;