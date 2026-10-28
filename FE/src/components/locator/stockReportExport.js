// src/components/locator/stockReportExport.js
//
// ============================================================
// STOCK REPORT EXPORT — reporting only.
// ============================================================
//
// ⚠️ NOT the same as `locatorExport.js`:
//
//   locatorExport.js        → SYNC export. Produces a multi-sheet
//                             workbook (Summary + Detail + Meta)
//                             with a SHA-256 file hash, writes a
//                             locator_export_log row, and is only
//                             available to UG / LUMB warehouses.
//                             That file physically walks between
//                             the underground and the surface.
//
//   stockReportExport.js    → REPORTING export (this file). Flat,
//                             one row per (locator, item) pair.
//                             No hash, no log write, available to
//                             every warehouse. Just an .xlsx a
//                             manager opens in Excel and pivots.
//
// ============================================================

import * as XLSX from 'xlsx';

/* ------------------------------------------------------------ */
/* Helpers                                                       */
/* ------------------------------------------------------------ */
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

const pad2 = (n) => String(n).padStart(2, '0');

const dateStamp = () => {
  const d = new Date();
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}_${pad2(d.getHours())}${pad2(d.getMinutes())}`;
};

const slug = (s) =>
  String(s || 'warehouse')
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');

/* ------------------------------------------------------------ */
/* Main export function                                          */
/* ------------------------------------------------------------ */
/**
 * Generate and download a Stock Report Excel file.
 *
 * @param {Object} opts
 * @param {Array<Object>} opts.rows            Rows from GET /locators/export-stock-report
 * @param {string}        opts.warehouseCode   Warehouse code (used in filename + summary)
 * @param {string}        [opts.warehouseName] Optional display name for the Summary sheet
 * @param {string}        [opts.exportedBy]    Optional username for the Summary sheet
 * @returns {{ filename: string, rowCount: number, totalQty: number, totalValue: number }}
 */
export const exportLocatorStockReport = ({
  rows,
  warehouseCode,
  warehouseName = '',
  exportedBy = '',
}) => {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('No stock rows available to export.');
  }

  /* ---------- Map to display columns ---------- */
  const sheetRows = rows.map((r) => ({
    Warehouse:          r.WarehouseCode  || r.warehouse_code  || warehouseCode || '',
    Locator:            r.LocatorCode    || r.locator_code    || '',
    'Locator Name':     r.LocatorName    || r.locator_name    || '',
    'Item Code':        r.ItemCode       || r.item_code       || '',
    'Item Description': r.ItemDescription || r.item_description || '',
    'UOM Code':         r.UomCode        || r.uom_code        || '',
    'UOM Description':  r.UomDescription || r.uom_description || '',
    'Total Qty':        num(r.TotalQty   ?? r.total_qty   ?? r.qty),
    'Avg Unit Cost':    num(r.AvgUnitCost ?? r.avg_unit_cost),
    'Total Value':      num(r.TotalValue  ?? r.total_value),
  }));

  /* ---------- Sheet 1: flat stock rows ---------- */
  const ws = XLSX.utils.json_to_sheet(sheetRows, {
    header: [
      'Warehouse', 'Locator', 'Locator Name', 'Item Code', 'Item Description',
      'UOM Code', 'UOM Description', 'Total Qty', 'Avg Unit Cost', 'Total Value',
    ],
  });

  ws['!cols'] = [
    { wch: 12 }, // Warehouse
    { wch: 18 }, // Locator
    { wch: 30 }, // Locator Name
    { wch: 16 }, // Item Code
    { wch: 52 }, // Item Description
    { wch: 10 }, // UOM Code
    { wch: 18 }, // UOM Description
    { wch: 12 }, // Total Qty
    { wch: 14 }, // Avg Unit Cost
    { wch: 16 }, // Total Value
  ];

  // Number formats
  const range = XLSX.utils.decode_range(ws['!ref']);
  for (let R = range.s.r + 1; R <= range.e.r; R++) {
    const qtyRef  = XLSX.utils.encode_cell({ r: R, c: 7 });
    const costRef = XLSX.utils.encode_cell({ r: R, c: 8 });
    const valRef  = XLSX.utils.encode_cell({ r: R, c: 9 });
    if (ws[qtyRef])  ws[qtyRef].z  = '#,##0.00';
    if (ws[costRef]) ws[costRef].z = '#,##0.0000';
    if (ws[valRef])  ws[valRef].z  = '#,##0.00';
  }

  // Freeze the header row
  ws['!freeze'] = { xSplit: 0, ySplit: 1, topLeftCell: 'A2', activePane: 'bottomLeft' };

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Stock Report');

  /* ---------- Sheet 2: Summary ---------- */
  const totalQty   = sheetRows.reduce((s, r) => s + (r['Total Qty']   || 0), 0);
  const totalValue = sheetRows.reduce((s, r) => s + (r['Total Value'] || 0), 0);

  const uniqueLocators = new Set(sheetRows.map((r) => r.Locator)).size;
  const uniqueItems    = new Set(sheetRows.map((r) => r['Item Code'])).size;

  const summaryWs = XLSX.utils.json_to_sheet([
    { Metric: 'Warehouse',        Value: warehouseCode || '' },
    { Metric: 'Warehouse Name',   Value: warehouseName || '' },
    { Metric: 'Generated At',     Value: new Date().toLocaleString('en-PH') },
    { Metric: 'Exported By',      Value: exportedBy || '' },
    { Metric: 'Locator Count',    Value: uniqueLocators },
    { Metric: 'Item Count',       Value: uniqueItems },
    { Metric: 'Row Count',        Value: sheetRows.length },
    { Metric: 'Total Qty',        Value: totalQty },
    { Metric: 'Total Value',      Value: totalValue },
  ]);
  summaryWs['!cols'] = [{ wch: 22 }, { wch: 46 }];

  const rangeS = XLSX.utils.decode_range(summaryWs['!ref']);
  for (let R = rangeS.s.r + 1; R <= rangeS.e.r; R++) {
    const vRef = XLSX.utils.encode_cell({ r: R, c: 1 });
    if (!summaryWs[vRef]) continue;
    const metricCell = summaryWs[XLSX.utils.encode_cell({ r: R, c: 0 })];
    const metric = metricCell?.v;
    if (metric === 'Total Qty')   summaryWs[vRef].z = '#,##0.00';
    if (metric === 'Total Value') summaryWs[vRef].z = '#,##0.00';
    if (metric === 'Locator Count' || metric === 'Item Count' || metric === 'Row Count') {
      summaryWs[vRef].z = '#,##0';
    }
  }

  XLSX.utils.book_append_sheet(wb, summaryWs, 'Summary');

  /* ---------- Write ---------- */
  const filename = `Stock_Report_${slug(warehouseCode)}_${dateStamp()}.xlsx`;
  XLSX.writeFile(wb, filename);

  return {
    filename,
    rowCount:   sheetRows.length,
    totalQty,
    totalValue,
  };
};

export default exportLocatorStockReport;