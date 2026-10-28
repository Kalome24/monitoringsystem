// controllers/locatorController.js
const LocatorModel = require('../models/locatorModel');
const UserModel    = require('../models/userModel');
const { query }    = require('../db');

/**
 * Resolve the effective warehouse_code.
 * Priority matches your existing controller's behavior:
 *   query param → body → user's JWT warehouse_code.
 */
const resolveWarehouseCode = (req) => {
    return req.query.warehouse_code
        || (req.body && req.body.warehouse_code)
        || (req.user && req.user.warehouse_code)
        || null;
};

/* ============================================================
   BODEGA RESTRICTION HELPER
   ------------------------------------------------------------
   Returns:
     • null            → caller sees ALL locators in the warehouse
                         (Admin, Super Admin, non-handler, or a
                          handler with NO assignments configured)
     • string[]        → caller is scoped to these locator codes

   The rule is centralized in UserModel.getAssignedLocatorsForUser,
   which checks role + emp_position. Controllers stay agnostic —
   they just pass the result through to the model.
   ============================================================ */
const getBodegaScope = async (req) => {
    if (!req.user?.id) return null;
    let me;
    try {
        me = await UserModel.getUserById(req.user.id);
    } catch {
        return null;
    }
    if (!me) return null;
    return await UserModel.getAssignedLocatorsForUser(me);
};

const locatorController = {
    /**
     * GET /api/locators
     * ?warehouse_code=&page=1&limit=20&search=&purchase_class=&category=&status=&locator_type=
     *
     * Bodega restriction:
     *   Underground Handlers with assignments see ONLY their assigned
     *   locators. The IN-clause is applied to BOTH the count and the
     *   page rows, so pagination math remains accurate.
     */
    list: async (req, res) => {
        try {
            const warehouse_code = resolveWarehouseCode(req);
            if (!warehouse_code) {
                return res.status(400).json({
                    success: false,
                    message: 'warehouse_code is required',
                });
            }

            const page   = Math.max(1, parseInt(req.query.page, 10) || 1);
            const limit  = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 20));
            const offset = (page - 1) * limit;

            const filters = {
                warehouse_code,
                search:         req.query.search,
                purchase_class: req.query.purchase_class,
                category:       req.query.category,
                status:         req.query.status,
                locator_type:   req.query.locator_type,
            };

            // Apply bodega scope (no-op for admins / unassigned handlers).
            const assigned_locators = await getBodegaScope(req);

            const [rows, total] = await Promise.all([
                LocatorModel.list({
                    ...filters,
                    assigned_locators,
                    limit,
                    offset,
                }),
                LocatorModel.count({
                    ...filters,
                    assigned_locators,
                }),
            ]);

            res.status(200).json({
                success: true,
                data: rows,
                total,
                page,
                limit,
                totalPages: Math.max(1, Math.ceil(total / limit)),
                scoped: Array.isArray(assigned_locators) && assigned_locators.length > 0,
            });
        } catch (err) {
            console.error('❌ locator.list:', err);
            res.status(500).json({
                success: false,
                message: 'Error fetching locators',
                error: process.env.NODE_ENV === 'development' ? err.message : undefined,
            });
        }
    },

    /**
     * GET /api/locators/totals
     *
     * Admin / Super Admin only. Route is role-gated in locatorRoutes.js.
     * Not scoped by bodega (admin overview across all warehouses).
     */
    getTotals: async (req, res) => {
        try {
            const rows = await LocatorModel.getWarehouseSummaries();

            const warehouses = rows.map((r) => ({
                warehouse_code:   r.warehouse_code,
                warehouse_name:   r.warehouse_name || r.warehouse_code,
                warehouse_status: r.warehouse_status || null,
                locator_count:    Number(r.locator_count) || 0,
                item_count:       Number(r.item_count)    || 0,
                total_qty:        Number(r.total_qty)     || 0,
                total_value:      Number(r.total_value)   || 0,
            }));

            const summary = {
                warehouse_count: warehouses.length,
                locator_count:   warehouses.reduce((a, w) => a + w.locator_count, 0),
                item_count:      warehouses.reduce((a, w) => a + w.item_count, 0),
                total_qty:       warehouses.reduce((a, w) => a + w.total_qty, 0),
                total_value:     warehouses.reduce((a, w) => a + w.total_value, 0),
            };

            res.status(200).json({
                success: true,
                data: { summary, warehouses },
            });
        } catch (err) {
            console.error('❌ locator.getTotals:', err);
            res.status(500).json({
                success: false,
                message: 'Error fetching locator totals',
                error: process.env.NODE_ENV === 'development' ? err.message : undefined,
            });
        }
    },

    /**
     * GET /api/locators/totals/:warehouse_code?page=1&limit=20&search=
     *
     * Admin / Super Admin only. Not bodega-scoped (admin drill-down).
     */
    getWarehouseLocators: async (req, res) => {
        try {
            const { warehouse_code } = req.params;
            if (!warehouse_code) {
                return res.status(400).json({
                    success: false,
                    message: 'warehouse_code is required',
                });
            }

            const page   = Math.max(1, parseInt(req.query.page, 10) || 1);
            const limit  = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 20));
            const offset = (page - 1) * limit;
            const search = req.query.search;

            const [rows, total] = await Promise.all([
                LocatorModel.listLocatorsByWarehouse({
                    warehouse_code,
                    search,
                    limit,
                    offset,
                }),
                LocatorModel.countLocatorsByWarehouse({
                    warehouse_code,
                    search,
                }),
            ]);

            const locators = rows.map((r) => ({
                locator_code:       r.locator_code,
                locator_name:       r.locator_name,
                description:        r.description,
                locator_type:       r.locator_type,
                status:             r.status,
                purchase_class:     r.purchase_class,
                category:           r.category,
                item_codes:         r.item_codes || '',
                total_qty:          Number(r.total_qty)    || 0,
                total_value:        Number(r.total_value)  || 0,
                last_activity_at:   r.last_activity_at,
                locator_created_at: r.locator_created_at,
                locator_updated_at: r.locator_updated_at,
            }));

            res.status(200).json({
                success: true,
                data: {
                    warehouse_code,
                    locators,
                    total,
                    page,
                    limit,
                    totalPages: Math.max(1, Math.ceil(total / limit)),
                },
            });
        } catch (err) {
            console.error('❌ locator.getWarehouseLocators:', err);
            res.status(500).json({
                success: false,
                message: 'Error fetching warehouse locators',
                error: process.env.NODE_ENV === 'development' ? err.message : undefined,
            });
        }
    },

    /**
     * GET /api/locators/filter-options?warehouse_code=
     *
     * NOTE: this endpoint returns the "typeahead" counts for the filter
     * dropdowns. It is intentionally NOT bodega-scoped: counts reflect
     * the whole warehouse so admins / surface handlers always see the
     * warehouse-wide options. The LIST endpoint is scoped separately.
     */
    getFilterOptions: async (req, res) => {
        try {
            const warehouse_code = resolveWarehouseCode(req);
            if (!warehouse_code) {
                return res.status(400).json({
                    success: false,
                    message: 'warehouse_code is required',
                });
            }

            const data = await LocatorModel.getFilterOptions(warehouse_code);
            res.status(200).json({ success: true, data });
        } catch (err) {
            console.error('❌ locator.getFilterOptions:', err);
            res.status(500).json({
                success: false,
                message: 'Error fetching filter options',
                error: process.env.NODE_ENV === 'development' ? err.message : undefined,
            });
        }
    },

    /**
     * GET /api/locators/:locator_code/items?warehouse_code=
     *
     * Bodega restriction:
     *   When the caller is scoped, requests for a locator that is NOT
     *   in their assigned set return 403. This prevents a handler from
     *   poking the URL and pulling items out of a hidden bodega.
     */
    getItems: async (req, res) => {
        try {
            const warehouse_code = resolveWarehouseCode(req);
            const { locator_code } = req.params;

            if (!warehouse_code) {
                return res.status(400).json({
                    success: false,
                    message: 'warehouse_code is required',
                });
            }

            const assigned = await getBodegaScope(req);
            if (Array.isArray(assigned) && assigned.length > 0) {
                if (!assigned.includes(locator_code)) {
                    return res.status(403).json({
                        success: false,
                        message: `You do not have access to locator "${locator_code}".`,
                    });
                }
            }

            const rows = await LocatorModel.getItems(warehouse_code, locator_code);
            res.status(200).json({ success: true, data: rows });
        } catch (err) {
            console.error('❌ locator.getItems:', err);
            res.status(500).json({
                success: false,
                message: 'Error fetching locator items',
                error: process.env.NODE_ENV === 'development' ? err.message : undefined,
            });
        }
    },

    /**
     * GET /api/locators/export-stock-report?warehouse_code=
     *
     * Stock Report export — flat, one row per (locator, item) pair.
     * Reporting only. No file hash, no locator_export_log write.
     *
     * Role-aware:
     *   • Stock Handler / Registrar → forced to their own warehouse_code.
     *   • Admin / Super Admin       → MUST pass warehouse_code; 400 otherwise.
     *
     * NOTE: this is a reporting tool, not an interactive inventory view.
     * It is NOT bodega-scoped so a handler can generate the full stock
     * report for their warehouse for audit purposes. The interactive
     * per-item view (list / getItems / underground.currentInventory)
     * IS bodega-scoped.
     */
    exportStockReport: async (req, res) => {
        try {
            const role = req.user?.role;
            const isGlobal = role === 'Super Admin' || role === 'Admin';

            let warehouse_code;

            if (isGlobal) {
                const q = req.query.warehouse_code;
                if (!q || !String(q).trim()) {
                    return res.status(400).json({
                        success: false,
                        message: 'warehouse_code is required for Admin / Super Admin.',
                    });
                }
                warehouse_code = String(q).trim();
            } else {
                const userId = req.user?.id;
                if (!userId) {
                    return res.status(401).json({
                        success: false,
                        message: 'User not found.',
                    });
                }

                const rows = await query(
                    `SELECT w.warehouse_code
                       FROM dbo.user_table u
                       LEFT JOIN dbo.warehouse_table w
                         ON w.warehouse_id = u.warehouse_assigned
                      WHERE u.id = @param0`,
                    [userId]
                );

                warehouse_code = rows[0]?.warehouse_code || null;

                if (!warehouse_code) {
                    return res.status(400).json({
                        success: false,
                        message: 'Your account is not assigned to any warehouse.',
                    });
                }
            }

            const data = await LocatorModel.getStockReportRows(warehouse_code);

            return res.status(200).json({
                success: true,
                data,
                warehouse_code,
                total: data.length,
            });
        } catch (err) {
            console.error('❌ locator.exportStockReport:', err);
            return res.status(500).json({
                success: false,
                message: 'Error fetching stock report rows',
                error: process.env.NODE_ENV === 'development' ? err.message : undefined,
            });
        }
    },

    /**
     * GET /api/locators/search-item?search=
     *
     * Cross-warehouse item search.
     *
     * Role-aware:
     *   • Admin / Super Admin → global search across ALL warehouses.
     *   • Stock Handler       → scoped to the handler's assigned warehouse.
     *
     * NOTE: not bodega-scoped (it's an item-code lookup tool). The
     * Underground Handler's interactive inventory view is scoped via
     * /api/underground/inventory and /api/locators (list).
     */
    searchItem: async (req, res) => {
        try {
            const search = String(req.query.search || '').trim();
            if (search.length < 2) {
                return res.status(400).json({
                    success: false,
                    message: 'Search term must be at least 2 characters.',
                });
            }

            const role = req.user?.role;
            const isGlobal = role === 'Super Admin' || role === 'Admin';

            let warehouse_code = null;

            if (!isGlobal) {
                const userId = req.user?.id;
                if (!userId) {
                    return res.status(401).json({
                        success: false,
                        message: 'User not found.',
                    });
                }

                const rows = await query(
                    `SELECT w.warehouse_code
                       FROM dbo.user_table u
                       LEFT JOIN dbo.warehouse_table w
                         ON w.warehouse_id = u.warehouse_assigned
                      WHERE u.id = @param0`,
                    [userId]
                );
                warehouse_code = rows[0]?.warehouse_code || null;

                if (!warehouse_code) {
                    return res.status(400).json({
                        success: false,
                        message: 'Your account is not assigned to any warehouse.',
                    });
                }
            }

            const rows = await LocatorModel.searchItemAcrossWarehouses({
                search,
                warehouse_code,
            });

            const totalQty   = rows.reduce((s, r) => s + (Number(r.TotalQty)   || 0), 0);
            const totalValue = rows.reduce((s, r) => s + (Number(r.TotalValue) || 0), 0);

            const uniqueWarehouses = new Set(rows.map((r) => r.WarehouseCode)).size;
            const uniqueItems      = new Set(rows.map((r) => r.ItemCode)).size;

            return res.status(200).json({
                success: true,
                data: {
                    search,
                    scope: isGlobal ? 'global' : 'warehouse',
                    warehouse_code,
                    rows,
                    totals: {
                        total_qty:       totalQty,
                        total_value:     totalValue,
                        warehouse_count: uniqueWarehouses,
                        item_count:      uniqueItems,
                        row_count:       rows.length,
                    },
                },
            });
        } catch (err) {
            console.error('❌ locator.searchItem:', err);
            return res.status(500).json({
                success: false,
                message: 'Error searching items',
                error: process.env.NODE_ENV === 'development' ? err.message : undefined,
            });
        }
    },

    /**
     * GET /api/locators/:locator_code?warehouse_code=
     *
     * Bodega restriction:
     *   Same URL-poking guard as getItems — a handler cannot read the
     *   details of a locator outside their assigned set.
     */
    getOne: async (req, res) => {
        try {
            const warehouse_code = resolveWarehouseCode(req);
            const { locator_code } = req.params;

            if (!warehouse_code) {
                return res.status(400).json({
                    success: false,
                    message: 'warehouse_code is required',
                });
            }

            const assigned = await getBodegaScope(req);
            if (Array.isArray(assigned) && assigned.length > 0) {
                if (!assigned.includes(locator_code)) {
                    return res.status(403).json({
                        success: false,
                        message: `You do not have access to locator "${locator_code}".`,
                    });
                }
            }

            const row = await LocatorModel.getOne(warehouse_code, locator_code);
            if (!row) {
                return res.status(404).json({
                    success: false,
                    message: 'Locator not found',
                });
            }
            res.status(200).json({ success: true, data: row });
        } catch (err) {
            console.error('❌ locator.getOne:', err);
            res.status(500).json({
                success: false,
                message: 'Error fetching locator',
                error: process.env.NODE_ENV === 'development' ? err.message : undefined,
            });
        }
    },

    /**
     * POST /api/locators
     */
    create: async (req, res) => {
        try {
            const warehouse_code = resolveWarehouseCode(req);
            const {
                locator_code,
                locator_name,
                purchase_class,
                category,
                status,
            } = req.body;

            if (!warehouse_code || !locator_code) {
                return res.status(400).json({
                    success: false,
                    message: 'warehouse_code and locator_code are required',
                });
            }

            const exists = await LocatorModel.codeExists(warehouse_code, locator_code);
            if (exists) {
                return res.status(409).json({
                    success: false,
                    message: `Locator code "${locator_code}" already exists for this warehouse.`,
                });
            }

            await LocatorModel.create({
                warehouse_code,
                locator_code,
                locator_name,
                purchase_class,
                category,
                status,
                created_by: (req.user && req.user.username) || 'System',
            });

            const fresh = await LocatorModel.getOne(warehouse_code, locator_code);
            res.status(201).json({ success: true, data: fresh });
        } catch (err) {
            console.error('❌ locator.create:', err);
            res.status(500).json({
                success: false,
                message: 'Error creating locator',
                error: process.env.NODE_ENV === 'development' ? err.message : undefined,
            });
        }
    },

    /**
     * PUT /api/locators/:locator_code
     */
    update: async (req, res) => {
        try {
            const warehouse_code = resolveWarehouseCode(req);
            const { locator_code } = req.params;
            const {
                locator_name,
                purchase_class,
                category,
                status,
            } = req.body;

            if (!warehouse_code) {
                return res.status(400).json({
                    success: false,
                    message: 'warehouse_code is required',
                });
            }

            const existing = await LocatorModel.getOne(warehouse_code, locator_code);
            if (!existing) {
                return res.status(404).json({
                    success: false,
                    message: 'Locator not found',
                });
            }

            await LocatorModel.update({
                warehouse_code,
                locator_code,
                locator_name,
                purchase_class,
                category,
                status,
                updated_by: (req.user && req.user.username) || 'System',
            });

            const fresh = await LocatorModel.getOne(warehouse_code, locator_code);
            res.status(200).json({ success: true, data: fresh });
        } catch (err) {
            console.error('❌ locator.update:', err);
            res.status(500).json({
                success: false,
                message: 'Error updating locator',
                error: process.env.NODE_ENV === 'development' ? err.message : undefined,
            });
        }
    },
};

module.exports = locatorController;