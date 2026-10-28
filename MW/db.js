// D:\IMDBE\db.js
const sql = require('mssql');
const dotenv = require('dotenv');

dotenv.config();

const config = {
    user: process.env.DB_USER || 'sa',
    password: process.env.DB_PASSWORD || 'Password1',
    server: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'imd_monitoring',
    port: parseInt(process.env.DB_PORT) || 1433,

    // ---- Per-request timeouts ----
    // Generous enough to survive a slow query under load, but not so long
    // that a stuck request freezes the whole pool forever.
    connectionTimeout: 30000,   // 30s to open a new TCP connection
    requestTimeout:    60000,   // 60s for a query to finish

    options: {
        encrypt: false,
        trustServerCertificate: true,
        enableArithAbort: true,

        // Keep the underlying TCP socket alive so idle connections don't
        // get silently killed by Windows firewall / router / SQL Server.
        keepAlive: true,

        // ⚡ CRITICAL — return DECIMAL / NUMERIC columns as JS Numbers
        //    instead of strings. Without this, tedious hands back
        //    "123.4567" as a string, and any downstream BCP bulk insert
        //    (e.g. LocatorLogModel.createLog → locator_export_log_items)
        //    fails with:
        //        "Invalid column type from bcp client for colid N"
        //    Numbers up to ~15 significant digits are preserved exactly,
        //    which comfortably covers DECIMAL(18,4) inventory amounts.
        decimalNumbers: true,
    },

    pool: {
        // ---- Sized for 50–150 concurrent users ----
        max: 100,
        min: 10,
        idleTimeoutMillis: 60000,
        acquireTimeoutMillis: 30000,
        reapIntervalMillis: 15000,
    },
};

// ---------------------------------------------------------------------------
// Create the pool once. Everything in the app shares it.
// ---------------------------------------------------------------------------
const pool = new sql.ConnectionPool(config);

// ---------------------------------------------------------------------------
// Connection lifecycle
//
// The pool is created lazily and heals itself:
//   • ensurePool() opens a connection if one isn't already live.
//   • A failed connect clears the cached promise so the next call retries.
//   • A dropped pool (post-sleep, network blip, SQL restart) takes the same
//     path — the next query reconnects instead of getting a dead socket.
// ---------------------------------------------------------------------------
let poolConnectPromise = null;

function ensurePool() {
    // Already live — hand back the pool immediately.
    if (pool.connected) return Promise.resolve(pool);

    // A connect is already in flight — let every caller share it.
    if (poolConnectPromise) return poolConnectPromise;

    poolConnectPromise = pool
        .connect()
        .then(() => {
            console.log('✅ Connected to SQL Server successfully');
            return pool;
        })
        .catch((err) => {
            console.error('⚠️  SQL pool connect failed (will retry on next query):', err.message || err);
            poolConnectPromise = null; // allow the next caller to retry
            throw err;
        });

    return poolConnectPromise;
}

// Warm the pool at boot without blocking startup. If SQL Server is slow to
// come up, this fails harmlessly and the first real query retries.
const poolConnect = ensurePool().catch(() => {});

// When the pool drops, clear the cached promise so the next query reconnects.
pool.on('error', (err) => {
    console.error('❌ SQL pool error:', err.message || err);
    poolConnectPromise = null;
});

// ---------------------------------------------------------------------------
// Promisified query function
// ---------------------------------------------------------------------------
const query = async (queryString, params = []) => {
    // Heal the pool if it's not currently connected, then run the query.
    await ensurePool();

    const request = pool.request();

    if (params && params.length > 0) {
        params.forEach((param, index) => {
            request.input(`param${index}`, param);
        });
    }

    try {
        const result = await request.query(queryString);
        return result.recordset;
    } catch (error) {
        console.error('Database query error:', error.message || error);
        throw error;
    }
};

module.exports = {
    pool,
    poolConnect,   // legacy: resolves after the boot-time connect attempt (never rejects)
    ensurePool,    // preferred: call before critical work
    query,
    sql,
};