// scripts/seedLocators.js
// Usage: node scripts/seedLocators.js path/to/Locator.xlsx
const XLSX = require('xlsx');
const { pool, poolConnect, sql } = require('../db');

(async () => {
  try {
    const filePath = process.argv[2];
    if (!filePath) {
      console.error('Usage: node scripts/seedLocators.js <path-to-Locator.xlsx>');
      process.exit(1);
    }

    const wb    = XLSX.readFile(filePath);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows  = XLSX.utils.sheet_to_json(sheet, { defval: '' });

    if (!rows.length) {
      console.error('No rows found in the first sheet.');
      process.exit(1);
    }

    console.log(`📄 Loaded ${rows.length} rows from ${filePath}`);

    await poolConnect;

    // Validate warehouse_code against warehouse_table
    const whRes = await pool.request().query(
      `SELECT warehouse_code FROM warehouse_table WHERE status = 'Active'`
    );
    const validCodes = new Set(
      whRes.recordset.map(r => String(r.warehouse_code).trim().toUpperCase())
    );

    let inserted = 0, skipped = 0, invalidWH = 0;
    const invalid = [];

    for (const row of rows) {
      const locator_code   = String(row.Locator || row.locator || '').trim();
      const description    = String(row.Description || row.description || '').trim();
      const warehouse_code = String(
        row.Subinventory || row.subinventory || row.Sub || ''
      ).trim().toUpperCase();

      if (!locator_code || !warehouse_code) { skipped++; continue; }
      if (!validCodes.has(warehouse_code)) {
        invalidWH++;
        invalid.push({ locator_code, warehouse_code });
        continue;
      }

      const req = pool.request();
      req.input('locator_code',   sql.NVarChar, locator_code);
      req.input('description',    sql.NVarChar, description || null);
      req.input('warehouse_code', sql.NVarChar, warehouse_code);

      const result = await req.query(`
        IF NOT EXISTS (SELECT 1 FROM locator_table WHERE locator_code = @locator_code)
        BEGIN
          INSERT INTO locator_table (locator_code, description, warehouse_code)
          VALUES (@locator_code, @description, @warehouse_code);
          SELECT 1 AS inserted;
        END
        ELSE SELECT 0 AS inserted;
      `);

      if (result.recordset[0]?.inserted === 1) inserted++;
      else skipped++;
    }

    console.log(`\n✅ Done.`);
    console.log(`   Inserted:                          ${inserted}`);
    console.log(`   Skipped (exists / blank):          ${skipped}`);
    console.log(`   Skipped (invalid warehouse_code):  ${invalidWH}`);
    if (invalid.length) {
      console.log(`\n⚠️  First 20 invalid rows:`);
      console.table(invalid.slice(0, 20));
    }
    process.exit(0);
  } catch (err) {
    console.error('❌ Seed failed:', err);
    process.exit(1);
  }
})();