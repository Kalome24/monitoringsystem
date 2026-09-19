// server.js
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { poolConnect } = require('./db');
const userRoutes          = require('./routes/userRoutes');
const warehouseRoutes     = require('./routes/warehouseRoutes');
const masterRoutes        = require('./routes/masterRoutes');
const itemMasterRoutes    = require('./routes/itemMasterRoutes');
const importPoRoutes      = require('./routes/importPoRoutes');
const stockTransferRoutes = require('./routes/stockTransferRoutes');

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

poolConnect.then(() => {
    console.log('✅ Connected to SQL Server successfully');
}).catch(err => {
    console.error('❌ Failed to connect to SQL Server:', err.message);
});

// ============================================
// ROUTES
// ============================================

app.use('/api/users',           userRoutes);
app.use('/api/warehouses',      warehouseRoutes);
app.use('/api/master',          masterRoutes);
app.use('/api/item-master',     itemMasterRoutes);
app.use('/api/import-po',       importPoRoutes);
app.use('/api/stock-transfer',  stockTransferRoutes);

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
    console.log(`🚚 Stock Transfer API: http://localhost:${PORT}/api/stock-transfer`);
});