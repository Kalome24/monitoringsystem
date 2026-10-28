// src/components/underground/fileHash.js
//
// Shared hashing + Excel parsing helpers for the physical-file flow.
//
// Used by:
//   • UndergroundSeedImportModal        — hash + parse the surface's export
//   • UndergroundReconcileImportModal   — hash only (no parse needed)
//   • UndergroundShiftCloseModal        — hash via shiftCloseExport
//
// The hash matches what locatorExport.js produces: lowercase hex
// SHA-256 of the exact file bytes. This is what makes the two-sided
// handoff tamper-evident — the file that reaches the surface handler
// must be byte-identical to what the underground handler produced.
//
import * as XLSX from 'xlsx';

/* ============================================================
   SHA-256 — same encoding as locatorExport.js
   ============================================================ */
export const sha256Hex = async (arrayBuffer) => {
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

/* ============================================================
   File → ArrayBuffer
   ============================================================ */
export const readFileAsArrayBuffer = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('Failed to read file.'));
    reader.readAsArrayBuffer(file);
  });

/* ============================================================
   Human-readable byte size
   ============================================================ */
export const formatBytes = (bytes) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n.toFixed(n < 10 && i > 0 ? 2 : 0)} ${units[i]}`;
};

/* ============================================================
   Excel → normalized seed lines
   ============================================================ */
const toNumber = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// Must stay in sync with DETAIL_COLUMNS in locatorExport.js
const FIELD_MAP = {
  'Storage Locator':  'locator_code',
  'Locator Name':     'locator_name',
  'Item Code':        'item_code',
  'Item Description': 'item_name',
  'Barcode':          'barcode',
  'UOM':              'uom',
  'Category':         'category',
  'Purchase Class':   'purchase_class',
  'GL Class':         'gl_class',
  'Qty':              'qty',
  'Unit Cost':        'unit_cost',
  'Line Total':       'line_total',
};

const normalizeDetailRow = (raw) => {
  const out = {
    locator_code:   '',
    locator_name:   null,
    item_code:      '',
    item_name:      null,
    barcode:        null,
    uom:            null,
    category:       null,
    purchase_class: null,
    gl_class:       null,
    qty:            0,
    unit_cost:      0,
    line_total:     0,
  };
  for (const [header, field] of Object.entries(FIELD_MAP)) {
    const v = raw[header];
    if (v !== undefined && v !== null && v !== '') out[field] = v;
  }
  out.qty        = toNumber(out.qty);
  out.unit_cost  = toNumber(out.unit_cost);
  out.line_total = toNumber(out.line_total) || out.qty * out.unit_cost;
  out.locator_code = String(out.locator_code || '').trim();
  out.item_code    = String(out.item_code || '').trim();
  return out;
};

/* ============================================================
   Excel parser — surface-export format
   ============================================================ */
/**
 * Parse a surface-export Excel file into { meta, lines, summary }.
 * Skips the TOTAL row and any zero-qty rows — the underground_shift_lines
 * table has a check constraint (CK_ug_line_qty_positive) requiring qty > 0.
 */
export const parseSeedFile = async (arrayBuffer) => {
  const wb = XLSX.read(arrayBuffer, { type: 'array' });

  // ---- Meta sheet — read all Field/Value pairs ----
  const metaSheet = wb.Sheets['Meta'];
  const metaRaw = {};
  if (metaSheet) {
    const rows = XLSX.utils.sheet_to_json(metaSheet, { header: 1, blankrows: false });
    for (const row of rows) {
      if (Array.isArray(row) && row.length >= 2 && row[0]) {
        metaRaw[String(row[0]).trim()] = row[1];
      }
    }
  }

  // ---- Detail sheet — one row per item line ----
  const detailSheet = wb.Sheets['Detail'];
  const rawRows = detailSheet
    ? XLSX.utils.sheet_to_json(detailSheet, { defval: '', raw: false })
    : [];

  const lines = [];
  for (const raw of rawRows) {
    const code = String(raw['Storage Locator'] || '').trim();
    // Skip the TOTAL footer row and any blank rows
    if (!code || code.toUpperCase() === 'TOTAL') continue;

    const ln = normalizeDetailRow(raw);
    if (!ln.locator_code || !ln.item_code) continue;
    if (!(ln.qty > 0)) continue;
    lines.push(ln);
  }

  const locatorSet = new Set(lines.map((l) => l.locator_code));
  const totalQty   = lines.reduce((s, l) => s + l.qty, 0);
  const totalValue = lines.reduce((s, l) => s + l.line_total, 0);

  return {
    meta: {
      export_version: metaRaw['Export Version'] || null,
      exported_by:    metaRaw['Exported By']    || null,
      exported_at:    metaRaw['Exported At']    || null,
      warehouse_code: metaRaw['Warehouse Code'] || null,
      warehouse_name: metaRaw['Warehouse Name'] || null,
      locator_count:  Number(metaRaw['Locator Count']) || locatorSet.size,
      item_row_count: Number(metaRaw['Item Row Count']) || lines.length,
      app:            metaRaw['App'] || null,
    },
    lines,
    summary: {
      locator_count:  locatorSet.size,
      item_row_count: lines.length,
      total_qty:      Number(totalQty.toFixed(4)),
      total_value:    Number(totalValue.toFixed(4)),
    },
  };
};

/* ============================================================
   Convenience wrappers
   ============================================================ */
/**
 * Hash + parse a File in one shot. Used by the seed import modal.
 */
export const hashAndParseSeedFile = async (file) => {
  const arrayBuffer = await readFileAsArrayBuffer(file);
  const [fileHash, parsed] = await Promise.all([
    sha256Hex(arrayBuffer),
    parseSeedFile(arrayBuffer),
  ]);
  return {
    fileHash,
    fileSizeBytes: arrayBuffer.byteLength,
    filename: file.name,
    meta:    parsed.meta,
    lines:   parsed.lines,
    summary: parsed.summary,
  };
};

/**
 * Hash-only — used by the reconcile import modal (no parse needed;
 * the backend already has the release lines) and by the close-shift
 * export (which uses shiftCloseExport's own hasher internally).
 */
export const hashFileOnly = async (file) => {
  const arrayBuffer = await readFileAsArrayBuffer(file);
  const fileHash = await sha256Hex(arrayBuffer);
  return {
    fileHash,
    fileSizeBytes: arrayBuffer.byteLength,
    filename: file.name,
  };
};

/* ============================================================
   Default export
   ============================================================ */
const fileHash = {
  sha256Hex,
  readFileAsArrayBuffer,
  formatBytes,
  parseSeedFile,
  hashAndParseSeedFile,
  hashFileOnly,
};

export default fileHash;