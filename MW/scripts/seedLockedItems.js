const fs = require('fs');
const XLSX = require('xlsx');
const { pool, poolConnect, sql } = require('../db');

(async () => {
  const startTime = Date.now();
  try {
    const filePath = process.argv[2];
    if (!filePath) {
      console.error('Usage: node scripts/seedLockedItems.js <path-to-locked-items.xlsx>');
      process.exit(1);
    }

    console.log('START');
    console.log('Reading: ' + filePath);
    const wb = XLSX.readFile(filePath);
    const sheetName = wb.SheetNames[0];
    const sheet = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    console.log('Sheet "' + sheetName + '" - ' + rows.length + ' rows');
    console.log('Columns: ' + JSON.stringify(Object.keys(rows[0] || {})));

    console.log('Connecting to database...');
    await poolConnect;
    console.log('Connected');

    const itemRes = await pool.request().query('SELECT Item_Code FROM item_master');
    const validItems = new Set(itemRes.recordset.map(r => String(r.Item_Code).trim()));
    console.log('Item codes in item_master: ' + validItems.size);

    const whRes = await pool.request().query("SELECT warehouse_code FROM warehouse_table WHERE status = 'Active'");
    const validWh = new Set(whRes.recordset.map(r => String(r.warehouse_code).trim().toUpperCase()));
    console.log('Active warehouses: ' + validWh.size);

    const locRes = await pool.request().query('SELECT locator_code, warehouse_code FROM locator_table');
    const locatorMap = new Map(locRes.recordset.map(r => [String(r.locator_code).trim(), String(r.warehouse_code).trim().toUpperCase()]));
    console.log('Locators in locator_table: ' + locatorMap.size);

    const lockedRes = await pool.request().query('SELECT item_code FROM locked_items');
    const alreadyLocked = new Set(lockedRes.recordset.map(r => String(r.item_code).trim()));
    console.log('Items already locked: ' + alreadyLocked.size);

    const cleaned = [];
    const failed = [];
    const seen = new Set();
    let skippedExisting = 0, skippedDupFile = 0;

    for (const row of rows) {
      const item_code = String(row['Item Code'] || row.Item_Code || '').trim();
      const warehouse_code = String(row.Sub || row.sub || '').trim().toUpperCase();
      const locator_code = String(row.Locator || row.locator || '').trim() || null;

      if (!item_code || !warehouse_code) { failed.push({ item_code, warehouse_code, reason: 'missing item_code or Sub' }); continue; }
      if (seen.has(item_code)) { skippedDupFile++; continue; }
      if (alreadyLocked.has(item_code)) { skippedExisting++; continue; }
      if (!validItems.has(item_code)) { failed.push({ item_code, warehouse_code, reason: 'item_code not in item_master' }); continue; }
      if (!validWh.has(warehouse_code)) { failed.push({ item_code, warehouse_code, reason: 'warehouse "' + warehouse_code + '" not active' }); continue; }
      if (locator_code) {
        const locWh = locatorMap.get(locator_code);
        if (!locWh) { failed.push({ item_code, warehouse_code, reason: 'locator "' + locator_code + '" not found' }); continue; }
        if (locWh !== warehouse_code) { failed.push({ item_code, warehouse_code, reason: 'locator "' + locator_code + '" belongs to "' + locWh + '", not "' + warehouse_code + '"' }); continue; }
      }
      seen.add(item_code);
      cleaned.push({ item_code, warehouse_code, locator_code });
    }

    console.log('To insert: ' + cleaned.length + ' | already locked: ' + skippedExisting + ' | dupes in file: ' + skippedDupFile + ' | failed: ' + failed.length);

    let inserted = 0;
    const actor = 'Seed Script';
    for (let i = 0; i < cleaned.length; i++) {
      const r = cleaned[i];
      const req = pool.request();
      req.input('i', sql.NVarChar(50), r.item_code);
      req.input('w', sql.NVarChar(20), r.warehouse_code);
      req.input('l', sql.NVarChar(50), r.locator_code);
      req.input('a', sql.NVarChar(100), actor);
      try {
        const result = await req.query('INSERT INTO locked_items (item_code, warehouse_code, locator_code, is_active, created_by) VALUES (@i, @w, @l, 1, @a)');
        inserted += result.rowsAffected[0] || 0;
      } catch (e) {
        failed.push({ item_code: r.item_code, warehouse_code: r.warehouse_code, reason: e.message });
      }
    }

    const secs = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log('');
    console.log('Done in ' + secs + 's');
    console.log('   Inserted:  ' + inserted);
    console.log('   Failed:    ' + failed.length);

    if (failed.length) {
      fs.writeFileSync('locked-items-failures.csv',
        'item_code,warehouse_code,reason\n' +
        failed.map(f => '"' + f.item_code + '","' + f.warehouse_code + '","' + String(f.reason).replace(/"/g, '""') + '"').join('\n')
      );
      console.log('Wrote ' + failed.length + ' failures to locked-items-failures.csv');
    }
    process.exit(0);
  } catch (err) {
    console.error('Seed failed: ' + err.message);
    console.error(err.stack);
    process.exit(1);
  }
})();
