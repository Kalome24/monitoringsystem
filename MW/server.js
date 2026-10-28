// server.js
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const UserModel                = require('./models/userModel');
const userRoutes               = require('./routes/userRoutes');
const warehouseRoutes          = require('./routes/warehouseRoutes');
const masterRoutes             = require('./routes/masterRoutes');
const itemMasterRoutes         = require('./routes/itemMasterRoutes');
const equipmentMasterRoutes    = require('./routes/equipmentMasterRoutes');
const importPoRoutes           = require('./routes/importPoRoutes');
const stockTransferRoutes      = require('./routes/stockTransferRoutes');
const lockedItemsRoutes        = require('./routes/lockedItemsRoutes');
const locatorRoutes            = require('./routes/locatorRoutes');
const locatorLogRoutes         = require('./routes/locatorLogRoutes');
const warehouseInventoryRoutes = require('./routes/warehouseInventoryRoutes');
const damagedItemsRoutes       = require('./routes/damagedItemsRoutes');
const undergroundRoutes        = require('./routes/underground/undergroundRoutes');
const offlineConfigRoutes      = require('./routes/offlineConfigRoutes');
const { sweepExpiredKeys }     = require('./middleware/idempotency');
const peerHeartbeat            = require('./services/peerHeartbeat');
const costCenterRoutes         = require('./routes/costCenterRoutes');
const uomConversionRoutes      = require('./routes/uomConversionRoutes'); // <-- ADDED

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    credentials: true
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.use((req, res, next) => {
    console.log(`📡 ${req.method} ${req.path}`);
    next();
});

// ============================================
// SESSION HYGIENE + IDEMPOTENCY SWEEP
// ============================================
const runSweeps = async () => {
    await Promise.allSettled([
        UserModel.sweepStaleSessions()
            .catch(err => console.error('⚠️  Session sweep failed:', err.message || err)),
        sweepExpiredKeys()
            .catch(err => console.error('⚠️  Idempotency sweep failed:', err.message || err)),
    ]);
};

runSweeps();

const SWEEP_INTERVAL_MS = 60 * 60 * 1000;   // 1 hour
const sweepTimer = setInterval(runSweeps, SWEEP_INTERVAL_MS);
if (sweepTimer.unref) sweepTimer.unref();

// ============================================
// SESSION 16 — PEER HEARTBEAT
// ============================================
peerHeartbeat.start();

// ============================================
// ROUTES
// ============================================

app.use('/api/users',                userRoutes);
app.use('/api/warehouses',           warehouseRoutes);
app.use('/api/master',               masterRoutes);
app.use('/api/item-master',          itemMasterRoutes);
app.use('/api/equipment-master',     equipmentMasterRoutes);
app.use('/api/import-po',            importPoRoutes);
app.use('/api/stock-transfer',       stockTransferRoutes);
app.use('/api/locked-items',         lockedItemsRoutes);
app.use('/api/locators',             locatorRoutes);
app.use('/api/locator-logs',         locatorLogRoutes);
app.use('/api/warehouse-inventory',  warehouseInventoryRoutes);
app.use('/api/damaged-items',        damagedItemsRoutes);
app.use('/api/underground',          undergroundRoutes);
app.use('/api/offline-config',       offlineConfigRoutes);
app.use('/api/cost-center',          costCenterRoutes);
app.use('/api/uom-conversions',      uomConversionRoutes); // <-- ADDED

// Health check
app.get('/api/health', (req, res) => {
    res.json({
        success: true,
        status: 'OK',
        timestamp: new Date().toISOString()
    });
});

// Test route
app.get('/api/test', (req, res) => {
    res.json({
        success: true,
        message: 'API is working!',
        endpoints: {
            auth: {
                login: 'POST /api/users/login',
                logoutOtherDevices: 'POST /api/users/logout-other-devices — body { username, password }',
                logout: 'POST /api/users/logout',
                verify: 'GET /api/users/verify',
                me: 'GET /api/users/me'
            },
            users: {
                list: 'GET /api/users',
                search: 'GET /api/users/search?q=term',
                byPublicId: 'GET /api/users/public/:publicUserId',
                byId: 'GET /api/users/:id',
                create: 'POST /api/users (Admin only)',
                update: 'PUT /api/users/:id (Admin only)',
                deactivate: 'PATCH /api/users/:id/deactivate (Admin only)',
                activate: 'PATCH /api/users/:id/activate (Admin only)',
                password: 'PUT /api/users/:id/password (Admin only)'
            },
            warehouses: {
                list: 'GET /api/warehouses',
                active: 'GET /api/warehouses/active',
                byId: 'GET /api/warehouses/:id',
                create: 'POST /api/warehouses (Admin only)',
                update: 'PUT /api/warehouses/:id (Admin only)',
                deactivate: 'PATCH /api/warehouses/:id/deactivate (Admin only)',
                activate: 'PATCH /api/warehouses/:id/activate (Admin only)',
                delete: 'DELETE /api/warehouses/:id (Admin only) — body { confirm: "DELETE" }'
            },
            master: {
                gl: 'GET /api/master/gl, POST, PUT, PATCH /:id/deactivate, /:id/activate',
                category: 'GET /api/master/category, POST, PUT, PATCH',
                itemCodes: 'GET /api/master/item-codes, POST, PUT, PATCH',
                purchaseClass: 'GET /api/master/purchase-class, POST, PUT, PATCH',
                uom: 'GET /api/master/uom, POST, PUT, PATCH'
            },
            itemMaster: {
                create: 'POST /api/item-master',
                getAll: 'GET /api/item-master?page=1&limit=50&search=',
                getOne: 'GET /api/item-master/:itemCode',
                update: 'PUT /api/item-master/:itemCode',
                deactivate: 'PATCH /api/item-master/:itemCode/deactivate',
                activate: 'PATCH /api/item-master/:itemCode/activate',
                delete: 'DELETE /api/item-master/:itemCode (Super Admin / Admin only)'
            },
            equipmentMaster: {
                create: 'POST /api/equipment-master',
                getAll: 'GET /api/equipment-master?page=1&limit=50&search=',
                getOne: 'GET /api/equipment-master/:code',
                update: 'PUT /api/equipment-master/:code',
                deactivate: 'PATCH /api/equipment-master/:code/deactivate',
                activate: 'PATCH /api/equipment-master/:code/activate',
                delete: 'DELETE /api/equipment-master/:code (Super Admin / Admin only)'
            },
            uomConversions: {
                create: 'POST /api/uom-conversions',
                getAll: 'GET /api/uom-conversions?page=1&limit=50&search=',
                getOne: 'GET /api/uom-conversions/:id',
                update: 'PUT /api/uom-conversions/:id',
                delete: 'DELETE /api/uom-conversions/:id (Super Admin / Admin only)'
            },
            lockedItems: {
                list:   'GET    /api/locked-items (Admin only)',
                getOne: 'GET    /api/locked-items/:id (Admin only)',
                create: 'POST   /api/locked-items (Admin only)',
                bulk:   'POST   /api/locked-items/bulk (Admin only)',
                update: 'PUT    /api/locked-items/:id (Admin only)',
                remove: 'DELETE /api/locked-items/:id (Admin only)'
            },
            locators: {
                list: 'GET /api/locators?warehouse_code=&search=&limit='
            },
            locatorLogs: {
                create:  'POST /api/locator-logs — body { direction, action_type, export_format, source_warehouse_code, ... , lines: [...] }',
                list:    'GET  /api/locator-logs?page=1&limit=50&direction=&search=&start_date=&end_date=&scope=all|mine',
                getOne:  'GET  /api/locator-logs/:id',
                getLines:'GET  /api/locator-logs/:id/lines?page=1&limit=50'
            },
            warehouseInventory: {
                list:      'GET /api/warehouse-inventory?warehouse_id=&search=&limit=',
                getOne:    'GET /api/warehouse-inventory/:item_code?warehouse_id=',
                movements: 'GET /api/warehouse-inventory/movements?warehouse_id=&item_code=&limit='
            },
            importPoStore: {
                store: 'POST /api/import-po/:po_no/store — body { item_id, qty_to_store, remarks? }'
            },
            stockTransfer: {
                create:   'POST /api/stock-transfer',
                list:     'GET  /api/stock-transfer',
                incoming: 'GET  /api/stock-transfer/incoming',
                summary:  'GET  /api/stock-transfer/summary',
                detail:   'GET  /api/stock-transfer/:id',
                approve:  'POST /api/stock-transfer/:id/approve',
                reject:   'POST /api/stock-transfer/:id/reject',
                arrived:  'POST /api/stock-transfer/:id/arrived — body { remarks? }',
                receive:  'POST /api/stock-transfer/:id/receive — body { remarks?, lines: [{ sts_line_id, received_qty, damaged_qty, damage_reason? }] }',
                cancel:   'POST /api/stock-transfer/:id/cancel',
                complete: 'POST /api/stock-transfer/:id/complete'
            },
            damagedItems: {
                list:       'GET /api/damaged-items?start_date=&end_date=&warehouse_id=&item_code=&source_type=&page=1&limit=50 (Admin only)',
                totals:     'GET /api/damaged-items/totals?start_date=&end_date=&warehouse_id=&item_code=&source_type= (Admin only)',
                topItems:   'GET /api/damaged-items/top-items?limit=20 (Admin only)',
                trend:      'GET /api/damaged-items/trend?days=30 (Admin only)',
                warehouses: 'GET /api/damaged-items/warehouses (Admin only)'
            },
            underground: {
                dashboard:      'GET  /api/underground/dashboard',
                currentShift:   'GET  /api/underground/shift/current',
                currentInventory:'GET /api/underground/inventory?search=&locator_code=&item_code=&limit=',
                listShifts:     'GET  /api/underground/shifts?page=1&limit=50&status=',
                getShift:       'GET  /api/underground/shift/:id',
                getShiftLines:  'GET  /api/underground/shift/:id/lines?kind=Beginning|Release&page=1&limit=50',
                openShift:      'POST /api/underground/shift/open — body { seed_log_id } OR { seed_export_uid }',
                releaseLines:   'POST /api/underground/shift/:id/release — body { lines: [{ locator_code, item_code, qty, destination?, remarks? }] }',
                closeShift:     'POST /api/underground/shift/:id/close — body { filename?, file_hash?, file_size_bytes?, notes? }',
                reconcileShift: 'POST /api/underground/shift/:id/reconcile — body { filename?, file_hash?, file_size_bytes?, notes? }',
                issueFormMeta:  'GET  /api/underground/issue-form-meta',
                createIssueForm:'POST /api/underground/issue-form — body { form_type, lines:[...], bdm_lines?[...], header fields }',
                getIssueForm:   'GET  /api/underground/issue-form/:id',
                shiftIssueForms:'GET  /api/underground/shift/:shiftId/issue-forms',
                issueFormsHist: 'GET  /api/underground/issue-forms?form_type=&page=&limit='
            },
            offlineConfig: {
                getAll:         'GET    /api/offline-config',
                createItem:     'POST   /api/offline-config/item',
                updateItem:     'PUT    /api/offline-config/item/:id',
                deleteItem:     'DELETE /api/offline-config/item/:id',
                listSignatures: 'GET    /api/offline-config/signatures',
                createSignature:'POST   /api/offline-config/signatures',
                updateSignature:'PUT    /api/offline-config/signatures/:id',
                deleteSignature:'DELETE /api/offline-config/signatures/:id',
                exportSync:     'GET    /api/offline-config/sync/export',
                importSync:     'POST   /api/offline-config/sync/import',
                history:        'GET    /api/offline-config/sync/history'
            },
            health: 'GET /api/health',
            test: 'GET /api/test'
        }
    });
});

// ============================================
// ERROR HANDLING
// ============================================

app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: 'Route not found',
        path: req.originalUrl
    });
});

app.use((err, req, res, next) => {
    console.error('❌ Error:', err.stack);
    res.status(500).json({
        success: false,
        message: 'Something went wrong!',
        error: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
    });
});

// ============================================
// START SERVER
// ============================================

app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📡 Health: http://localhost:${PORT}/api/health`);
    console.log(`📡 Test API: http://localhost:${PORT}/api/test`);
    console.log(`👥 Users API: http://localhost:${PORT}/api/users`);
    console.log(`🏭 Warehouses API: http://localhost:${PORT}/api/warehouses`);
    console.log(`📋 Master API: http://localhost:${PORT}/api/master`);
    console.log(`📦 Item Master API: http://localhost:${PORT}/api/item-master`);
    console.log(`⚙️  Equipment Master API: http://localhost:${PORT}/api/equipment-master`);
    console.log(`🔀 UOM Conversions API: http://localhost:${PORT}/api/uom-conversions`);
    console.log(`🚚 Stock Transfer API: http://localhost:${PORT}/api/stock-transfer`);
    console.log(`🔒 Locked Items API: http://localhost:${PORT}/api/locked-items`);
    console.log(`🗺️  Locators API: http://localhost:${PORT}/api/locators`);
    console.log(`📤 Locator Logs API: http://localhost:${PORT}/api/locator-logs`);
    console.log(`🏬 Warehouse Inventory API: http://localhost:${PORT}/api/warehouse-inventory`);
    console.log(`⚠️  Damaged Items API: http://localhost:${PORT}/api/damaged-items`);
    console.log(`⛏️  Underground API: http://localhost:${PORT}/api/underground`);
    console.log(`⚙️  Offline Config API: http://localhost:${PORT}/api/offline-config`);
    console.log(`🧹 Sweeps: hourly + on boot (sessions + idempotency keys)`);
});