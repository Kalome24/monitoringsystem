// src/utils/poImport.js
// Excel parsing + column-mapping helpers for importing Purchase Orders.
//
// UOM is intentionally NOT in the aliases — it is auto-filled on the
// backend from item_master, based on the ITEM CODE.

import * as XLSX from 'xlsx';

const COLUMN_ALIASES = {
  po_date:     ['po date', 'podate', 'date', 'order date'],
  pr_no:       ['pr no', 'pr_no', 'prno', 'pr number', 'pr #', 'purchase request'],
  po_no:       ['po no', 'po_no', 'pono', 'po number', 'po #', 'purchase order'],
  vendor_name: ['vendor name', 'vendor_name', 'vendor', 'supplier', 'supplier name'],
  item_code:   ['item code', 'item_code', 'itemcode', 'code', 'sku'],
  qty:         ['qty', 'qty.', 'quantity', 'ordered qty', 'order qty'],
  unit_price:  ['unit price', 'unit_price', 'price', 'cost'],
  currency:    ['curr', 'currency', 'ccy'],
  buyer:       ['buyer', 'purchaser', 'encoded by'],
};

const REQUIRED_FIELDS = ['po_date', 'po_no', 'item_code', 'qty', 'unit_price'];

const normalize = (s) =>
  String(s ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '');

/** Build { columnIndex -> canonicalField } from the header row */
const buildColumnMap = (headerRow) => {
  const map = {};
  headerRow.forEach((h, idx) => {
    const n = normalize(h);
    for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
      if (Object.values(map).includes(field)) continue;
      if (aliases.some((a) => normalize(a) === n)) {
        map[idx] = field;
        break;
      }
    }
  });
  return map;
};

/** Convert an Excel cell into a YYYY-MM-DD string. */
const toIsoDate = (v) => {
  if (v === null || v === undefined || v === '') return '';

  // Excel serial (e.g. 45567)
  if (typeof v === 'number') {
    const d = XLSX.SSF.parse_date_code(v);
    if (!d) return '';
    const mm = String(d.m).padStart(2, '0');
    const dd = String(d.d).padStart(2, '0');
    return `${d.y}-${mm}-${dd}`;
  }

  // Native Date (cellDates: true)
  if (v instanceof Date && !isNaN(v.getTime())) {
    return v.toISOString().split('T')[0];
  }

  // String — try common patterns
  const s = String(v).trim();

  // YYYY-MM-DD or YYYY/MM/DD
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (m) {
    return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  }

  // MM/DD/YYYY or M/D/YYYY
  m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (m) {
    return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  }

  // Fallback: native parse
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
  return '';
};

/** Parse a numeric cell — strips commas, currency symbols, spaces */
const toNumber = (v) => {
  if (v === null || v === undefined || v === '') return 0;
  const cleaned = String(v).replace(/[₱$€£¥,\s]/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
};

/** Read the first sheet into raw arrays-of-arrays */
export const readExcel = async (file) => {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array', cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) throw new Error('The file has no sheets.');
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
};

/**
 * Map raw rows into normalized PO-line objects.
 * Returns { rows, errors, headerRow }
 */
export const mapRows = (rawRows) => {
  if (!Array.isArray(rawRows) || rawRows.length === 0) {
    return { rows: [], errors: [], headerRow: [] };
  }

  const headerRow = rawRows[0];
  const colMap = buildColumnMap(headerRow);

  const missing = REQUIRED_FIELDS.filter(
    (f) => !Object.values(colMap).includes(f),
  );
  if (missing.length) {
    const pretty = missing.map((f) => f.toUpperCase().replace(/_/g, ' '));
    throw new Error(`Missing required column(s): ${pretty.join(', ')}`);
  }

  const rows = [];
  const errors = [];

  for (let i = 1; i < rawRows.length; i++) {
    const r = rawRows[i];
    const excelRow = i + 1; // human-friendly row number (1-indexed + header)

    // Skip blank lines
    if (!r || r.every((c) => c === '' || c === null || c === undefined)) continue;

    const obj = {};
    for (const [idxStr, field] of Object.entries(colMap)) {
      obj[field] = r[Number(idxStr)];
    }

    const po_no       = String(obj.po_no || '').trim();
    const item_code   = String(obj.item_code || '').trim();
    const po_date     = toIsoDate(obj.po_date);
    const qty         = toNumber(obj.qty);
    const unit_price  = toNumber(obj.unit_price);
    const pr_no       = String(obj.pr_no || '').trim();
    const vendor_name = String(obj.vendor_name || '').trim();
    const currency    = String(obj.currency || 'PHP').trim().toUpperCase().slice(0, 3) || 'PHP';
    const buyer       = String(obj.buyer || '').trim();

    if (!po_no)     { errors.push({ row: excelRow, message: 'Missing PO NO.' }); continue; }
    if (!item_code) { errors.push({ row: excelRow, message: 'Missing ITEM CODE' }); continue; }
    if (!po_date)   { errors.push({ row: excelRow, message: 'Invalid or missing PO DATE' }); continue; }
    if (qty <= 0)   { errors.push({ row: excelRow, message: 'QTY. must be greater than 0' }); continue; }

    rows.push({
      excelRow,
      po_date,
      pr_no,
      po_no,
      vendor_name,
      item_code,
      qty,
      unit_price,
      currency,
      buyer,
    });
  }

  return { rows, errors, headerRow };
};

/** Group a flat array of mapped rows into PO buckets for the preview UI. */
export const groupByPo = (rows = []) => {
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.po_no)) {
      map.set(r.po_no, {
        po_no: r.po_no,
        po_date: r.po_date,
        pr_no: r.pr_no,
        vendor_name: r.vendor_name,
        buyer: r.buyer,
        currency: r.currency,
        lines: [],
      });
    }
    map.get(r.po_no).lines.push(r);
  }
  return [...map.values()];
};