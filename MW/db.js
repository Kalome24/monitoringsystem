// D:\Desktop\IMDBE\db.js
const sql = require('mssql');
const dotenv = require('dotenv');

dotenv.config();

const config = {
    user: process.env.DB_USER || 'sa',
    password: process.env.DB_PASSWORD || 'Password1',
    server: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'imd_monitoring',
    port: parseInt(process.env.DB_PORT) || 1433,
    options: {
        encrypt: false,
        trustServerCertificate: true,
        enableArithAbort: true
    },
    pool: {
        max: 10,
        min: 0,
        idleTimeoutMillis: 30000
    }
};

// Create connection pool
const pool = new sql.ConnectionPool(config);
const poolConnect = pool.connect();

// Promisified query function
const query = async (queryString, params = []) => {
    try {
        await poolConnect;
        const request = pool.request();
        
        if (params && params.length > 0) {
            params.forEach((param, index) => {
                request.input(`param${index}`, param);
            });
        }
        
        const result = await request.query(queryString);
        return result.recordset;
    } catch (error) {
        console.error('Database query error:', error);
        throw error;
    }
};

module.exports = {
    pool,
    poolConnect,
    query,
    sql
};