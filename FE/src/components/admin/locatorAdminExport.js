// src/components/admin/locatorAdminExport.js
import * as XLSX from 'xlsx';

/* ============================================================
   HELPER: Robustly parse row data regardless of key casing
   ============================================================ */
const getVal = (obj, keys) => {
  for (let k of keys) {
    if (obj[k] !== undefined && obj[k] !== null) return obj[k];
  }
  return undefined;
};

const parseRow = (r) => {
  const qty = Number(getVal(r, ['qty', 'Qty', 'QTY', 'total_qty', 'TotalQty']) || 0);
  const unitCost = Number(getVal(r, ['avg_unit_cost', 'avgUnitCost', 'AvgUnitCost', 'unit_cost', 'UnitCost']) || 0);
  const totalValue = Number(getVal(r, ['total_value', 'totalValue', 'TotalValue'])) || (qty * unitCost);
  
  return {
    locatorCode: getVal(r, ['locator_code', 'locatorCode', 'LocatorCode']) || '',
    locatorName: getVal(r, ['locator_name', 'locatorName', 'LocatorName']) || '',
    itemCode: getVal(r, ['item_code', 'itemCode', 'ItemCode']) || '',
    itemName: getVal(r, ['item_name', 'itemName', 'ItemName']) || '',
    uom: getVal(r, ['uom', 'UOM', 'Uom']) || '',
    qty,
    unitCost,
    totalValue
  };
};

/* ============================================================
   EXCEL EXPORT
   ============================================================ */
export const exportAllWarehousesExcel = (warehousesData, exportedBy = 'Admin') => {
  const wb = XLSX.utils.book_new();
  const rows = [];
  
  // Headers
  rows.push([
    'Warehouse', 'Locator Code', 'Locator Name', 'Item Code', 'Item Description', 'UOM', 
    'Qty', 'Unit Cost', 'Total Value'
  ]);

  let grandQty = 0;
  let grandValue = 0;

  warehousesData.forEach(w => {
    if (!w.rows || w.rows.length === 0) return;

    // Group by locator
    const locatorsMap = new Map();
    w.rows.forEach(r => {
      const parsed = parseRow(r);
      if (!locatorsMap.has(parsed.locatorCode)) {
        locatorsMap.set(parsed.locatorCode, []);
      }
      locatorsMap.get(parsed.locatorCode).push(parsed);
    });

    let whQty = 0;
    let whValue = 0;

    locatorsMap.forEach((items, locCode) => {
      let locQty = 0;
      let locValue = 0;
      const locName = items[0].locatorName;

      // Aggregate same items within locator
      const itemsMap = new Map();
      items.forEach(it => {
        if (!itemsMap.has(it.itemCode)) {
          itemsMap.set(it.itemCode, { ...it, qty: 0, totalValue: 0 });
        }
        const existing = itemsMap.get(it.itemCode);
        existing.qty += it.qty;
        existing.totalValue += it.totalValue;
      });

      itemsMap.forEach(it => {
        locQty += it.qty;
        locValue += it.totalValue;

        rows.push([
          w.warehouse_code,
          locCode,
          locName,
          it.itemCode,
          it.itemName,
          it.uom,
          it.qty,
          it.unitCost,
          it.totalValue
        ]);
      });

      // Locator Subtotal
      rows.push([
        '', `TOTAL: ${locCode}`, '', '', '', '',
        locQty, '', locValue
      ]);
      rows.push([]); // Spacer

      whQty += locQty;
      whValue += locValue;
    });

    // Warehouse Subtotal
    rows.push([
      `TOTAL: ${w.warehouse_name || w.warehouse_code}`, '', '', '', '', '',
      whQty, '', whValue
    ]);
    rows.push([]);
    rows.push([]);

    grandQty += whQty;
    grandValue += whValue;
  });

  // Grand Total
  rows.push([
    'GRAND TOTAL', '', '', '', '', '',
    grandQty, '', grandValue
  ]);

  const ws = XLSX.utils.aoa_to_sheet(rows);
  
  // Basic column widths
  ws['!cols'] = [
    { wch: 25 }, // Warehouse
    { wch: 15 }, // Locator
    { wch: 25 }, // Locator Name
    { wch: 15 }, // Item Code
    { wch: 30 }, // Item Description
    { wch: 10 }, // UOM
    { wch: 12 }, // Qty
    { wch: 15 }, // Unit Cost
    { wch: 15 }, // Total Value
  ];

  XLSX.utils.book_append_sheet(wb, ws, 'Inventory Report');

  const dateStr = new Date().toISOString().split('T')[0];
  XLSX.writeFile(wb, `Inventory_All_Warehouses_${dateStr}.xlsx`);
};

/* ============================================================
   WORD EXPORT (HTML-based for styling)
   ============================================================ */
export const exportAllWarehousesWord = (warehousesData, exportedBy = 'Admin') => {
  const dateStr = new Date().toLocaleString('en-PH', { dateStyle: 'long', timeStyle: 'short' });
  
  let html = `
    <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
    <head>
      <meta charset='utf-8'>
      <title>Inventory Stock Report</title>
      <style>
        body { font-family: 'Segoe UI', Arial, sans-serif; color: #334155; font-size: 10pt; }
        h1 { color: #0f766e; font-size: 20pt; border-bottom: 2px solid #0f766e; padding-bottom: 6px; margin-bottom: 4px; }
        .meta { font-size: 9pt; color: #64748b; margin-bottom: 20px; }
        
        .warehouse-section { margin-top: 30px; page-break-inside: avoid; }
        .wh-header { background-color: #f0fdfa; border-left: 4px solid #0f766e; padding: 10px 15px; margin-bottom: 10px; }
        .wh-title { font-size: 14pt; font-weight: bold; color: #0f766e; margin: 0; }
        .wh-stats { font-size: 10pt; color: #475569; margin-top: 4px; font-weight: 600; }
        
        table { width: 100%; border-collapse: collapse; font-size: 9pt; margin-bottom: 15px; }
        th { background-color: #0f766e; color: #ffffff; padding: 8px; text-align: left; font-weight: 600; border: 1px solid #0f766e; }
        td { padding: 6px 8px; border: 1px solid #cbd5e1; }
        tr:nth-child(even) td { background-color: #f8fafc; }
        
        .row-loc-total td { background-color: #f1f5f9 !important; font-weight: bold; border-top: 2px solid #94a3b8; }
        .row-wh-total td { background-color: #e2e8f0 !important; font-weight: bold; border-top: 2px solid #475569; font-size: 10pt; }
        
        .num { text-align: right; font-family: 'Consolas', monospace; }
        .currency { color: #047857; font-weight: 600; }
        .text-mute { color: #64748b; font-size: 8pt; }
      </style>
    </head>
    <body>
      <h1>Inventory Stock Report</h1>
      <div class='meta'>Exported by: <strong>${exportedBy}</strong> &nbsp;|&nbsp; Date: ${dateStr} &nbsp;|&nbsp; Scope: All Warehouses</div>
  `;

  let grandQty = 0;
  let grandValue = 0;

  warehousesData.forEach(w => {
    if (!w.rows || w.rows.length === 0) return;
    
    // Group by locator
    const locatorsMap = new Map();
    w.rows.forEach(r => {
      const parsed = parseRow(r);
      if (!locatorsMap.has(parsed.locatorCode)) {
        locatorsMap.set(parsed.locatorCode, []);
      }
      locatorsMap.get(parsed.locatorCode).push(parsed);
    });

    let whQty = 0;
    let whValue = 0;
    let tableRowsHtml = '';

    locatorsMap.forEach((items, locCode) => {
      let locQty = 0;
      let locValue = 0;
      const locName = items[0].locatorName;

      // Aggregate
      const itemsMap = new Map();
      items.forEach(it => {
        if (!itemsMap.has(it.itemCode)) {
          itemsMap.set(it.itemCode, { ...it, qty: 0, totalValue: 0 });
        }
        const existing = itemsMap.get(it.itemCode);
        existing.qty += it.qty;
        existing.totalValue += it.totalValue;
      });

      itemsMap.forEach(it => {
        locQty += it.qty;
        locValue += it.totalValue;

        tableRowsHtml += `
          <tr>
            <td><strong>${locCode}</strong><br/><span class="text-mute">${locName}</span></td>
            <td>${it.itemCode}</td>
            <td>${it.itemName}</td>
            <td>${it.uom}</td>
            <td class="num">${it.qty.toLocaleString()}</td>
            <td class="num currency">₱ ${it.unitCost.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:4})}</td>
            <td class="num currency">₱ ${it.totalValue.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:4})}</td>
          </tr>
        `;
      });

      // Locator subtotal
      tableRowsHtml += `
        <tr class="row-loc-total">
          <td colspan="4" style="text-align:right">TOTAL: ${locCode}</td>
          <td class="num">${locQty.toLocaleString()}</td>
          <td class="num"></td>
          <td class="num currency">₱ ${locValue.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:4})}</td>
        </tr>
      `;

      whQty += locQty;
      whValue += locValue;
    });

    // Warehouse subtotal
    tableRowsHtml += `
      <tr class="row-wh-total">
        <td colspan="4" style="text-align:right">TOTAL: ${w.warehouse_name || w.warehouse_code} (${w.warehouse_code})</td>
        <td class="num">${whQty.toLocaleString()}</td>
        <td class="num"></td>
        <td class="num currency">₱ ${whValue.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:4})}</td>
      </tr>
    `;

    grandQty += whQty;
    grandValue += whValue;

    // Warehouse Section
    html += `
      <div class='warehouse-section'>
        <div class='wh-header'>
          <div class='wh-title'>${w.warehouse_name || w.warehouse_code} (${w.warehouse_code})</div>
          <div class='wh-stats'>
            <span style="margin-right: 15px;">Locators: ${w.locator_count}</span>
            <span style="margin-right: 15px;">Total Qty: ${whQty.toLocaleString()}</span>
            <span>Total Value: ₱ ${whValue.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:4})}</span>
          </div>
        </div>
        <table>
          <thead>
            <tr>
              <th width="20%">Locator</th>
              <th width="15%">Item Code</th>
              <th width="25%">Item Description</th>
              <th width="10%">UOM</th>
              <th width="10%" class="num">Qty</th>
              <th width="10%" class="num">Unit Cost</th>
              <th width="10%" class="num">Total Value</th>
            </tr>
          </thead>
          <tbody>
            ${tableRowsHtml}
          </tbody>
        </table>
      </div>
    `;
  });

  html += `
      <div style="margin-top: 40px; border-top: 2px solid #0f766e; padding-top: 10px;">
        <h2 style="color: #0f766e; font-size: 14pt; margin: 0;">GRAND TOTAL (All Warehouses)</h2>
        <div style="font-size: 11pt; font-weight: bold; margin-top: 5px;">
          Total Qty: ${grandQty.toLocaleString()} &nbsp; | &nbsp; Total Value: ₱ ${grandValue.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:4})}
        </div>
      </div>
    </body></html>
  `;

  const blob = new Blob(['\ufeff', html], { type: 'application/msword' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  const dateFile = new Date().toISOString().split('T')[0];
  link.download = `Inventory_All_Warehouses_${dateFile}.doc`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};