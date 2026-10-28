// src/components/locator/locatorExport.js
//
// Locator export for the surface-handler Inventory Locator tab.
//
// Design A: export EVERY locator + EVERY item in the handler's own
// warehouse, ignoring the current search / filter state.
//
// On every export we compute a SHA-256 hash of the produced file so
// the accounting log can prove that the logged record matches the
// exact bytes handed to the user. The hash + totals + flat item lines
// are returned to the caller so it can POST them to /api/locator-logs.
//
// API used
//   locatorsApi.list({ warehouse_code, page, limit })
//   locatorsApi.getItems(warehouse_code, locator_code)

import * as XLSX from 'xlsx';
import { locatorsApi } from '../../services/api';

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------
const LOCATOR_PAGE_SIZE       = 100;  // how many locators per API page
const ITEM_FETCH_CONCURRENCY  = 5;    // parallel getItems() calls
const MAX_LOCATOR_PAGES       = 200;  // safety valve against runaway loops
export const EXPORT_FORMAT_VERSION = '1.0';

// ---------------------------------------------------------------------------
// Small formatting helpers
// ---------------------------------------------------------------------------
const pad2 = (n) => String(n).padStart(2, '0');

const fmtTimestampForFilename = (d = new Date()) =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` +
  `-${pad2(d.getHours())}${pad2(d.getMinutes())}`;

const fmtTimestampForCell = (value) => {
  if (!value) return '';
  try {
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return (
      `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ` +
      `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
    );
  } catch {
    return '';
  }
};

const toNumber = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// ---------------------------------------------------------------------------
// SHA-256 hash — returns lowercase hex string, or null if unavailable
// ---------------------------------------------------------------------------
const sha256Hex = async (arrayBuffer) => {
  try {
    if (typeof crypto === 'undefined' || !crypto.subtle) {
      console.warn('crypto.subtle unavailable — file hash will be null.');
      return null;
    }
    const digest = await crypto.subtle.digest('SHA-256', arrayBuffer);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  } catch (err) {
    console.warn('SHA-256 computation failed:', err);
    return null;
  }
};

// ---------------------------------------------------------------------------
// Browser download helper
// ---------------------------------------------------------------------------
const triggerDownload = (arrayBuffer, mimeType, filename) => {
  const blob = new Blob([arrayBuffer], { type: mimeType });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  return blob.size;
};

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------
const fetchAllLocators = async (warehouseCode) => {
  const all = [];
  let page = 1;
  let totalPages = 1;

  do {
    const res = await locatorsApi.list({
      warehouse_code: warehouseCode,
      page,
      limit: LOCATOR_PAGE_SIZE,
    });

    if (!res || !res.ok) {
      const msg = res?.data?.message || 'Failed to fetch locators.';
      throw new Error(msg);
    }

    const batch = Array.isArray(res.data) ? res.data : [];
    all.push(...batch);

    totalPages = Math.max(Number(res.totalPages) || 1, 1);
    page += 1;

    if (page > MAX_LOCATOR_PAGES) break;
  } while (page <= totalPages);

  return all;
};

const fetchLocatorItems = async (warehouseCode, locatorCode) => {
  try {
    const res = await locatorsApi.getItems(warehouseCode, locatorCode);
    return res && res.ok && Array.isArray(res.data) ? res.data : [];
  } catch (err) {
    console.warn(`Export: skipping items for locator ${locatorCode}`, err);
    return [];
  }
};

const mapWithConcurrency = async (arr, limit, fn) => {
  const results = new Array(arr.length);
  let cursor = 0;

  const worker = async () => {
    while (cursor < arr.length) {
      const i = cursor;
      cursor += 1;
      try {
        results[i] = await fn(arr[i], i);
      } catch (err) {
        results[i] = null;
        console.warn(`Export: worker failed for index ${i}`, err);
      }
    }
  };

  const workerCount = Math.max(1, Math.min(limit, arr.length));
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
};

/**
 * Public — build the full dataset for a warehouse.
 * @returns Promise<Array<{ locator: object, items: object[] }>>
 */
export const buildExportDataset = async (warehouseCode, onProgress) => {
  if (!warehouseCode) throw new Error('No warehouse assigned to this account.');

  onProgress?.({ phase: 'locators', done: 0, total: 0 });
  const locators = await fetchAllLocators(warehouseCode);

  onProgress?.({ phase: 'items', done: 0, total: locators.length });

  let done = 0;
  const withItems = await mapWithConcurrency(
    locators,
    ITEM_FETCH_CONCURRENCY,
    async (loc) => {
      const items = await fetchLocatorItems(warehouseCode, loc.locator_code);
      done += 1;
      onProgress?.({ phase: 'items', done, total: locators.length });
      return { locator: loc, items };
    }
  );

  return withItems.filter(Boolean);
};

// ---------------------------------------------------------------------------
// Workbook builder (Excel)
// ---------------------------------------------------------------------------
const SUMMARY_COLUMNS = [
  'Storage Locator',
  'Locator Name',
  'Type',
  'Status',
  'Purchase Class',
  'Category',
  'Items',
  'Total Qty',
  'Total Value',
  'Last Activity',
];

const DETAIL_COLUMNS = [
  'Storage Locator',
  'Locator Name',
  'Item Code',
  'Item Description',
  'Barcode',
  'UOM',
  'Category',
  'Purchase Class',
  'GL Class',
  'Qty',
  'Unit Cost',
  'Line Total',
];

const buildSummaryRows = (dataset) => {
  const rows = dataset.map(({ locator: l }) => ({
    'Storage Locator': l.locator_code || '',
    'Locator Name':    l.locator_name || l.description || '',
    'Type':            l.locator_type || 'Regular',
    'Status':          l.status || '',
    'Purchase Class':  l.purchase_class || '',
    'Category':        l.category || '',
    'Items':           toNumber(l.item_count),
    'Total Qty':       toNumber(l.total_qty),
    'Total Value':     toNumber(l.total_value),
    'Last Activity':   fmtTimestampForCell(l.last_activity_at),
  }));

  const total = rows.reduce(
    (acc, r) => ({
      Items: acc.Items + r['Items'],
      qty:   acc.qty   + r['Total Qty'],
      value: acc.value + r['Total Value'],
    }),
    { Items: 0, qty: 0, value: 0 }
  );

  rows.push({});
  rows.push({
    'Storage Locator': 'TOTAL',
    'Items':           total.Items,
    'Total Qty':       total.qty,
    'Total Value':     total.value,
  });

  return { rows, total };
};

const buildDetailRows = (dataset) => {
  const rows = [];

  for (const { locator, items } of dataset) {
    if (!Array.isArray(items) || items.length === 0) continue;
    for (const it of items) {
      const qty  = toNumber(it.qty);
      const cost = toNumber(it.avg_unit_cost);
      rows.push({
        'Storage Locator':  locator.locator_code || '',
        'Locator Name':     locator.locator_name || locator.description || '',
        'Item Code':        it.item_code || '',
        'Item Description': it.item_name || '',
        'Barcode':          it.barcode || '',
        'UOM':              it.uom || '',
        'Category':         it.category || '',
        'Purchase Class':   it.purchase_class || '',
        'GL Class':         it.gl_class_code || '',
        'Qty':              qty,
        'Unit Cost':        cost,
        'Line Total':       qty * cost,
      });
    }
  }

  const total = rows.reduce(
    (acc, r) => ({ qty: acc.qty + r['Qty'], value: acc.value + r['Line Total'] }),
    { qty: 0, value: 0 }
  );

  rows.push({});
  rows.push({
    'Storage Locator': 'TOTAL',
    'Qty':             total.qty,
    'Line Total':      total.value,
  });

  return { rows, total, itemRowCount: rows.length - 2 };
};

const buildMetaRows = ({ dataset, detailRowCount, meta }) => {
  const locatorCount = dataset.length;
  const itemRowCount = detailRowCount;

  return [
    { Field: 'Export Version',  Value: EXPORT_FORMAT_VERSION },
    { Field: 'Exported By',     Value: meta.exportedBy || '—' },
    { Field: 'Exported At',     Value: fmtTimestampForCell(meta.exportedAt || new Date()) },
    { Field: 'Warehouse Code',  Value: meta.warehouseCode },
    { Field: 'Warehouse Name',  Value: meta.warehouseName || '' },
    { Field: 'Locator Count',   Value: locatorCount },
    { Field: 'Item Row Count',  Value: itemRowCount },
    { Field: 'App',             Value: 'IMS · Inventory Management System' },
  ];
};

const buildWorkbook = (dataset, meta) => {
  const wb = XLSX.utils.book_new();

  // ---- Summary ----
  const { rows: summaryRows } = buildSummaryRows(dataset);
  const wsSummary = XLSX.utils.json_to_sheet(summaryRows, {
    header: SUMMARY_COLUMNS,
  });
  wsSummary['!cols'] = [
    { wch: 18 }, { wch: 30 }, { wch: 10 }, { wch: 10 },
    { wch: 18 }, { wch: 18 }, { wch: 8 },  { wch: 10 },
    { wch: 14 }, { wch: 20 },
  ];
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');

  // ---- Detail ----
  const { rows: detailRows, itemRowCount } = buildDetailRows(dataset);
  const wsDetail = XLSX.utils.json_to_sheet(detailRows, {
    header: DETAIL_COLUMNS,
  });
  wsDetail['!cols'] = [
    { wch: 18 }, { wch: 30 }, { wch: 18 }, { wch: 32 },
    { wch: 16 }, { wch: 8 },  { wch: 18 }, { wch: 18 },
    { wch: 12 }, { wch: 8 },  { wch: 12 }, { wch: 14 },
  ];
  XLSX.utils.book_append_sheet(wb, wsDetail, 'Detail');

  // ---- Meta ----
  const metaRows = buildMetaRows({ dataset, detailRowCount: itemRowCount, meta });
  const wsMeta = XLSX.utils.json_to_sheet(metaRows);
  wsMeta['!cols'] = [{ wch: 20 }, { wch: 44 }];
  XLSX.utils.book_append_sheet(wb, wsMeta, 'Meta');

  return { workbook: wb, locatorCount: dataset.length, itemRowCount };
};

// ---------------------------------------------------------------------------
// Filename helper
// ---------------------------------------------------------------------------
export const buildExportFilename = (warehouseCode, extension) => {
  const code = (warehouseCode || 'UNK').toUpperCase();
  return `inventory-locator-${code}-${fmtTimestampForFilename()}.${extension}`;
};

// ---------------------------------------------------------------------------
// Flatten dataset → audit-log line entries
// ---------------------------------------------------------------------------
const flattenForLog = (dataset) => {
  const lines = [];
  for (const { locator, items } of dataset) {
    if (!Array.isArray(items)) continue;
    for (const it of items) {
      const qty  = toNumber(it.qty);
      const cost = toNumber(it.avg_unit_cost);
      lines.push({
        locator_code:   locator.locator_code || '',
        locator_name:   locator.locator_name || locator.description || '',
        item_code:      it.item_code || '',
        item_name:      it.item_name || '',
        barcode:        it.barcode || '',
        uom:            it.uom || '',
        category:       it.category || '',
        purchase_class: it.purchase_class || '',
        gl_class:       it.gl_class_code || '',
        qty,
        unit_cost:      cost,
        line_total:     qty * cost,
      });
    }
  }
  return lines;
};

// ---------------------------------------------------------------------------
// Excel entry point
// ---------------------------------------------------------------------------
export const exportToExcel = async ({
  warehouseCode,
  warehouseName = '',
  exportedBy = '—',
  onProgress,
} = {}) => {
  const dataset = await buildExportDataset(warehouseCode, onProgress);

  const { workbook, locatorCount, itemRowCount } = buildWorkbook(dataset, {
    warehouseCode,
    warehouseName,
    exportedBy,
    exportedAt: new Date(),
  });

  // Produce bytes in memory (no implicit download).
  const arrayBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });

  const fileHash = await sha256Hex(arrayBuffer);
  const filename = buildExportFilename(warehouseCode, 'xlsx');
  const fileSizeBytes = triggerDownload(
    arrayBuffer,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    filename
  );

  const totals = dataset.reduce(
    (acc, { locator }) => ({
      qty:   acc.qty   + toNumber(locator.total_qty),
      value: acc.value + toNumber(locator.total_value),
    }),
    { qty: 0, value: 0 }
  );

  const lines = flattenForLog(dataset);

  return {
    filename,
    locatorCount,
    itemRowCount,
    totalQty:      totals.qty,
    totalValue:    totals.value,
    fileHash,
    fileSizeBytes,
    lines,
  };
};

// ---------------------------------------------------------------------------
// PDF entry point — Summary report
// ---------------------------------------------------------------------------
const loadPdfDeps = async () => {
  const [jspdfMod, autoTableMod] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);
  return {
    jsPDF:    jspdfMod.jsPDF || jspdfMod.default,
    autoTable: autoTableMod.default || autoTableMod.autoTable,
  };
};

export const exportToPDF = async ({
  warehouseCode,
  warehouseName = '',
  exportedBy = '—',
  onProgress,
} = {}) => {
  const dataset = await buildExportDataset(warehouseCode, onProgress);
  const { jsPDF, autoTable } = await loadPdfDeps();

  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();

  // ---- Header ----
  doc.setFontSize(16);
  doc.setTextColor(15, 23, 42);
  doc.text('Inventory Locator Report', 40, 44);

  doc.setFontSize(10);
  doc.setTextColor(100);
  doc.text(
    `Warehouse: ${warehouseCode}${warehouseName ? ' — ' + warehouseName : ''}`,
    40, 62
  );
  doc.text(`Exported by: ${exportedBy}`, 40, 76);
  doc.text(`Exported at: ${new Date().toLocaleString()}`, 40, 90);

  // ---- Summary table ----
  const summaryBody = dataset.map(({ locator: l }) => [
    l.locator_code || '',
    l.locator_name || l.description || '',
    l.locator_type || 'Regular',
    l.status || '',
    String(toNumber(l.item_count)),
    String(toNumber(l.total_qty)),
    toNumber(l.total_value).toFixed(2),
  ]);

  const totalItems = dataset.reduce((a, x) => a + toNumber(x.locator.item_count), 0);
  const totalQty   = dataset.reduce((a, x) => a + toNumber(x.locator.total_qty), 0);
  const totalValue = dataset.reduce((a, x) => a + toNumber(x.locator.total_value), 0);

  summaryBody.push([
    'TOTAL', '', '', '',
    String(totalItems),
    String(totalQty),
    totalValue.toFixed(2),
  ]);

  autoTable(doc, {
    startY: 110,
    head: [['Locator', 'Name', 'Type', 'Status', 'Items', 'Qty', 'Value (PHP)']],
    body: summaryBody,
    styles: { fontSize: 8.5, cellPadding: 4, overflow: 'linebreak' },
    headStyles: { fillColor: [0, 184, 176], textColor: 255, fontStyle: 'bold' },
    columnStyles: {
      0: { cellWidth: 90 },
      1: { cellWidth: 'auto' },
      2: { cellWidth: 60 },
      3: { cellWidth: 55 },
      4: { cellWidth: 45, halign: 'right' },
      5: { cellWidth: 55, halign: 'right' },
      6: { cellWidth: 80, halign: 'right' },
    },
    didDrawPage: () => {
      const str = `Page ${doc.internal.getNumberOfPages()}`;
      doc.setFontSize(9);
      doc.setTextColor(150);
      doc.text(str, pageWidth - 60, doc.internal.pageSize.getHeight() - 20);
    },
  });

  // Produce bytes in memory — no implicit download.
  const arrayBuffer = doc.output('arraybuffer');
  const fileHash = await sha256Hex(arrayBuffer);
  const filename = buildExportFilename(warehouseCode, 'pdf');
  const fileSizeBytes = triggerDownload(
    arrayBuffer, 'application/pdf', filename
  );

  // PDF has no item-line detail — the audit line set is empty. The
  // header still records locator_count, totals, and the hash.
  return {
    filename,
    locatorCount: dataset.length,
    itemRowCount: 0,
    totalQty,
    totalValue,
    fileHash,
    fileSizeBytes,
    lines: [],
  };
};