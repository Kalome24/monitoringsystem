// src/utils/poImport.js
// Excel parsing + column-mapping helpers for importing Purchase Orders.
//
// UOM, item_name, barcode, gl_class_code, gl_description, purchase_class,
// and category are intentionally NOT in the aliases — they are auto-filled
// on the backend from item_master, based on the ITEM CODE.
//
// Warehouse rule: every row must have a WAREHOUSE CODE. Each (PO No. or
// PR No.) group must use exactly ONE warehouse code — but different groups
// in the same file may use different warehouses.
// `checkPerPoWarehouseConsistency` enforces this after `mapRows`.
//
// Multi-currency:
//   • Reads CURR + FOREX. CURR=PHP forces forex=1.
//   • Non-PHP rows REQUIRE a FOREX value > 0 AND with at most 3 decimal
//     places. Rows with more decimals are REJECTED (not rounded).
//   • Reads DELIVERED QTY. Blank → treated as equal to QTY (Complete).
//   • Computes FUNC AMOUNT = unit_price × delivered_qty × forex, rounded
//     to 3 decimals.
//
// Delivery status:
//   • The Excel file MUST include a STATUS column whose value is
//     "Complete" or "Partial Received" (a few friendly aliases are
//     accepted: "Partial", "Full", "Completed", "Partially Received", …).
//   • The old rule (auto-derive from QTY vs DELIVERED QTY) is gone.
//   • Legacy rows in the DB may still hold 'Partial'; both spellings are
//     treated as equivalent everywhere downstream.
//
// PR-based rows (this revision):
//   • PO NO. is now OPTIONAL. If blank but PR NO. is present, the row is
//     imported with `has_po = 0` and the PR No. is used as the grouping
//     identifier — both for preview and (server-side) for storage, so all
//     downstream systems that key off `po_no` keep working unchanged.
//   • Both PO NO. and PR NO. blank → row error.
//   • `group_key` is the resolved grouping identifier (po_no || pr_no).
//
// Date handling:
//   • SheetJS with `cellDates: true` constructs Date objects at LOCAL
//     midnight. We read LOCAL getters (getFullYear / getMonth / getDate)
//     so the round-trip is symmetric and correct in every timezone.

import * as XLSX from 'xlsx';

const MAX_FOREX_DECIMALS = 3;

const COLUMN_ALIASES = {
  po_date:         ['po date', 'podate', 'date', 'order date'],
  pr_no:           ['pr no', 'pr_no', 'prno', 'pr number', 'pr #', 'purchase request'],
  po_no:           ['po no', 'po_no', 'pono', 'po number', 'po #', 'purchase order'],
  vendor_name:     ['vendor name', 'vendor_name', 'vendor', 'supplier', 'supplier name'],
  item_code:       ['item code', 'item_code', 'itemcode', 'code', 'sku'],
  qty:             ['qty', 'qty.', 'quantity', 'ordered qty', 'order qty'],
  unit_price:      ['unit price', 'unit_price', 'price', 'cost'],
  currency:        ['curr', 'currency', 'ccy'],
  forex:           ['forex', 'fx', 'fx rate', 'exchange rate', 'ex rate'],
  delivered_qty:   ['delivered qty', 'delivered_qty', 'delivered', 'delivered quantity', 'del qty'],
  // STATUS — user-supplied delivery status (Complete / Partial Received)
  delivery_status: ['status', 'delivery status', 'delivery_status', 'delivery'],
  buyer:           ['buyer', 'purchaser', 'encoded by'],
  warehouse_code: [
    'warehouse code', 'warehouse_code', 'warehousecode',
    'warehouse', 'wh code', 'wh_code', 'whcode',
    'sub', 'subinventory',
    'destination', 'dest warehouse', 'dest_warehouse',
    'buyer warehouse', 'buyer_warehouse',
  ],
};

// PO NO. is intentionally NOT in REQUIRED_FIELDS — a row is valid if it
// has at least one of PO NO. / PR NO. That validation happens per-row.
const REQUIRED_FIELDS = [
  'po_date', 'item_code', 'qty', 'unit_price', 'warehouse_code',
  'delivery_status',
];

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

/**
 * Format a JS Date as YYYY-MM-DD using LOCAL getters.
 * IMPORTANT: do NOT use toISOString() here — it converts to UTC and shifts
 * the calendar date backward in any timezone east of UTC (e.g. PHT/UTC+8).
 */
const formatLocalDate = (d) => {
  const y  = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${mm}-${dd}`;
};

/** Convert an Excel cell into a YYYY-MM-DD string. */
const toIsoDate = (v) => {
  if (v === null || v === undefined || v === '') return '';

  if (typeof v === 'number') {
    const d = XLSX.SSF.parse_date_code(v);
    if (!d) return '';
    const mm = String(d.m).padStart(2, '0');
    const dd = String(d.d).padStart(2, '0');
    return `${d.y}-${mm}-${dd}`;
  }

  if (v instanceof Date && !isNaN(v.getTime())) {
    return formatLocalDate(v);
  }

  const s = String(v).trim();

  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (m) {
    return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  }

  m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (m) {
    return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  }

  const d = new Date(s);
  if (!isNaN(d.getTime())) return formatLocalDate(d);
  return '';
};

/** Parse a numeric cell — strips commas, currency symbols, spaces */
const toNumber = (v) => {
  if (v === null || v === undefined || v === '') return 0;
  const cleaned = String(v).replace(/[₱$€£¥,\s]/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Count the significant decimal places in the raw input.
 * Trailing zeros are ignored: "56.500" → 1, not 3.
 * Returns -1 if the value can't be interpreted as a plain decimal.
 */
const countDecimals = (raw) => {
  if (raw === null || raw === undefined) return 0;
  const s = String(raw).replace(/[₱$€£¥,\s]/g, '');
  if (s === '') return 0;
  if (/[eE]/.test(s)) return -1;
  const n = Number(s);
  if (!Number.isFinite(n)) return -1;
  const dot = s.indexOf('.');
  if (dot === -1) return 0;
  const decimals = s.slice(dot + 1).replace(/0+$/, '');
  return decimals.length;
};

/* ============================================================
   DELIVERY STATUS (user-supplied from Excel STATUS column)
   ============================================================ */
const normalizeDeliveryStatus = (raw) => {
  const s = String(raw == null ? '' : raw).trim().toLowerCase();
  if (!s) return null;

  if (
    s === 'complete' ||
    s === 'completed' ||
    s === 'full' ||
    s === 'full received' ||
    s === 'fully received'
  ) {
    return 'Complete';
  }

  if (
    s === 'partial' ||
    s === 'partial received' ||
    s === 'partial_received' ||
    s === 'partialreceived' ||
    s === 'partially received' ||
    s === 'incomplete'
  ) {
    return 'Partial Received';
  }

  return null;
};

/* ============================================================
   MULTI-CURRENCY MATH
   ============================================================ */
const resolveForex = (rawForex, currency) => {
  const c = String(currency || '').trim().toUpperCase();
  const isPhp = c === '' || c === 'PHP';
  if (isPhp) return { ok: true, value: 1 };

  const decs = countDecimals(rawForex);
  if (decs === -1) {
    return { ok: false, error: `FOREX value "${rawForex}" is not a valid number.` };
  }
  if (decs > MAX_FOREX_DECIMALS) {
    return {
      ok: false,
      error: `FOREX has ${decs} decimal places — only up to ${MAX_FOREX_DECIMALS} are allowed.`,
    };
  }
  const fx = Number(String(rawForex).replace(/[₱$€£¥,\s]/g, ''));
  if (!Number.isFinite(fx) || fx <= 0) {
    return { ok: false, error: `FOREX must be greater than 0.` };
  }
  return { ok: true, value: fx };
};

const computeFuncAmount = (unitPrice, deliveredQty, forex) => {
  const up = Number(unitPrice);
  const q  = Number(deliveredQty);
  const fx = Number(forex);
  if (!Number.isFinite(up) || !Number.isFinite(q) || !Number.isFinite(fx)) return 0;
  return Number((up * q * fx).toFixed(3));
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
 *
 * Each row carries:
 *   po_no       — raw PO No. (may be '')
 *   pr_no       — raw PR No. (may be '')
 *   group_key   — po_no || pr_no (used for grouping & warehouse checks)
 *   has_po      — 1 if a real PO No. was present, 0 if PR-based
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

  // The file must expose at least one of PO NO. / PR NO. as a column so
  // we can resolve the group_key.
  const hasPoCol = Object.values(colMap).includes('po_no');
  const hasPrCol = Object.values(colMap).includes('pr_no');
  if (!hasPoCol && !hasPrCol) {
    throw new Error('Missing required column(s): PO NO. or PR NO.');
  }

  const rows = [];
  const errors = [];

  for (let i = 1; i < rawRows.length; i++) {
    const r = rawRows[i];
    const excelRow = i + 1;

    if (!r || r.every((c) => c === '' || c === null || c === undefined)) continue;

    const obj = {};
    for (const [idxStr, field] of Object.entries(colMap)) {
      obj[field] = r[Number(idxStr)];
    }

    const raw_po_no      = String(obj.po_no || '').trim();
    const pr_no          = String(obj.pr_no || '').trim();
    const item_code      = String(obj.item_code || '').trim();
    const po_date        = toIsoDate(obj.po_date);
    const qty            = toNumber(obj.qty);
    const unit_price     = toNumber(obj.unit_price);
    const vendor_name    = String(obj.vendor_name || '').trim();
    const currency       = String(obj.currency || 'PHP').trim().toUpperCase().slice(0, 3) || 'PHP';
    const buyer          = String(obj.buyer || '').trim();
    const warehouse_code = String(obj.warehouse_code || '').trim().toUpperCase();

    // ---- PO / PR resolution ----
    const hasPo    = Boolean(raw_po_no);
    const group_key = hasPo ? raw_po_no : pr_no;

    if (!group_key) {
      errors.push({
        row: excelRow,
        message: 'Missing PO NO. and PR NO. — at least one is required.',
      });
      continue;
    }

    if (!item_code)      { errors.push({ row: excelRow, message: 'Missing ITEM CODE' }); continue; }
    if (!po_date)        { errors.push({ row: excelRow, message: 'Invalid or missing PO DATE' }); continue; }
    if (qty <= 0)        { errors.push({ row: excelRow, message: 'QTY. must be greater than 0' }); continue; }
    if (!warehouse_code) { errors.push({ row: excelRow, message: 'Missing WAREHOUSE CODE' }); continue; }

    // ---- DELIVERY STATUS (user-supplied, required) ----
    const delivery_status = normalizeDeliveryStatus(obj.delivery_status);
    if (!delivery_status) {
      errors.push({
        row: excelRow,
        message:
          'STATUS is required and must be either "Complete" or "Partial Received".',
      });
      continue;
    }

    // ---- DELIVERED QTY (blank → treated as == qty) ----
    const rawDelivered = obj.delivered_qty;
    const deliveredBlank = rawDelivered == null || rawDelivered === '';
    const delivered_qty  = deliveredBlank ? qty : toNumber(rawDelivered);
    if (delivered_qty < 0) {
      errors.push({ row: excelRow, message: 'DELIVERED QTY cannot be negative' });
      continue;
    }

    // ---- FOREX (required for non-PHP; max 3 decimals) ----
    const fxResult = resolveForex(obj.forex, currency);
    if (!fxResult.ok) {
      errors.push({ row: excelRow, message: fxResult.error });
      continue;
    }
    const forex = fxResult.value;

    // ---- FUNC AMOUNT (derived; preview only) ----
    const func_amount = computeFuncAmount(unit_price, delivered_qty, forex);

    rows.push({
      excelRow,
      po_date,
      po_no: raw_po_no,     // raw — may be ''
      pr_no,                // raw — may be ''
      group_key,            // resolved grouping key
      has_po: hasPo ? 1 : 0,
      vendor_name,
      item_code,
      qty,
      delivered_qty,
      unit_price,
      currency,
      forex,
      func_amount,
      delivery_status,
      buyer,
      warehouse_code,
    });
  }

  return { rows, errors, headerRow };
};

/**
 * Enforce that each group (PO No. or PR No.) uses exactly ONE
 * warehouse_code. Different groups may use different warehouses.
 */
export const checkPerPoWarehouseConsistency = (rows = []) => {
  const byGroup = new Map();
  for (const r of rows) {
    const key = r.group_key || '';
    if (!byGroup.has(key)) byGroup.set(key, []);
    byGroup.get(key).push(r);
  }

  const violations = [];
  for (const [group_key, groupRows] of byGroup.entries()) {
    const groups = new Map();
    for (const r of groupRows) {
      const wc = (r.warehouse_code || '').toUpperCase();
      if (!groups.has(wc)) groups.set(wc, []);
      groups.get(wc).push(r.excelRow);
    }
    if (groups.size > 1) {
      violations.push({
        po_no: group_key,
        has_po: groupRows[0]?.has_po ?? 1,
        warehouses: [...groups.entries()].map(([warehouse_code, rowNumbers]) => ({
          warehouse_code,
          rows: rowNumbers,
        })),
      });
    }
  }

  if (violations.length === 0) return { ok: true };
  return { ok: false, code: 'MIXED_WAREHOUSE_CODES_PER_PO', violations };
};

/**
 * Group a flat array of mapped rows into PO buckets for the preview UI.
 *
 * Buckets are keyed by `group_key` (PO No. or PR No.). Each bucket exposes:
 *   group_key   — resolved identifier
 *   po_no       — raw PO No. from the first line (may be '')
 *   pr_no       — raw PR No. from the first line (may be '')
 *   has_po      — 1 (real PO) or 0 (PR-based)
 *   display_id  — what to show in the "PO No." column (po_no || pr_no)
 *   lines       — the item lines
 *   ...plus aggregate fields used by the preview
 */
export const groupByPo = (rows = []) => {
  const map = new Map();
  for (const r of rows) {
    const key = r.group_key;
    if (!map.has(key)) {
      map.set(key, {
        group_key: key,
        po_no: r.po_no || '',
        pr_no: r.pr_no || '',
        has_po: r.has_po,
        display_id: r.po_no || r.pr_no || key,
        po_date: r.po_date,
        vendor_name: r.vendor_name,
        buyer: r.buyer,
        currency: r.currency,
        warehouse_code: r.warehouse_code,
        lines: [],
        funcTotal: 0,
        partialCount: 0,
        hasPartial: false,
        hasNonPhp: false,
        currencies: new Set(),
      });
    }
    const bucket = map.get(key);
    bucket.lines.push(r);
    bucket.funcTotal += Number(r.func_amount) || 0;
    if (r.delivery_status === 'Partial' || r.delivery_status === 'Partial Received') {
      bucket.partialCount += 1;
    }
    if (r.currency && r.currency !== 'PHP') bucket.hasNonPhp = true;
    bucket.currencies.add(r.currency || 'PHP');
  }

  for (const bucket of map.values()) {
    bucket.funcTotal = Number(bucket.funcTotal.toFixed(3));
    bucket.hasPartial = bucket.partialCount > 0;
    bucket.currencies = [...bucket.currencies];
  }

  return [...map.values()];
};