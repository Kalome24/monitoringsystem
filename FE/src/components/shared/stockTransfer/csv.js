// src/components/shared/stockTransfer/csv.js

// ============================================================
// CSV helpers for the Stock Transfer tabs.
//
// Three layers:
//
//   1) escapeCell / buildCsv — generic RFC-4180 CSV serialization
//      from an array of rows + a column spec.
//   2) downloadCsv — triggers a browser download from a string.
//   3) buildSTSCsv — the STS-specific column set, shared by both
//      tabs so "export" produces identical output everywhere.
//
// Notes:
//   • Output is UTF-8 with BOM (\uFEFF) so Excel opens it without
//     mangling non-ASCII characters.
//   • Line endings are CRLF per RFC 4180.
//   • Cells containing `,` `"` `\n` `\r` are wrapped in double
//     quotes and internal quotes are doubled.
//   • null / undefined serialize as empty cells.
//   • A column's optional `format(row)` overrides the default
//     value lookup and can pull from multiple fields, join arrays,
//     or reformat dates.
// ============================================================

// ------------------------------------------------------------
// 1) Generic CSV
// ------------------------------------------------------------

/**
 * Escape a single cell value per RFC 4180.
 * - null / undefined → ''
 * - numbers / booleans → string form, unquoted
 * - strings containing `,` `"` `\n` `\r` → wrapped + quotes doubled
 */
const escapeCell = (val) => {
  if (val == null) return '';
  const s = String(val);
  if (s === '') return '';
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
};

/**
 * Turn an array of rows into a CSV string using a column spec.
 *
 * Column spec shape:
 *   { key: 'submitted_by', label: 'Submitted By' }
 *   { key: 'submitted_at', label: 'Submitted At', format: (row) => ... }
 *
 * If `format(row)` is provided it wins; otherwise the default
 * formatter reads `row[key]` and stringifies.
 *
 * Always returns a string (never null). Empty column spec → BOM
 * only (a valid, if unhelpful, CSV).
 */
export const buildCsv = (rows, columns) => {
  const list = Array.isArray(rows) ? rows : [];
  const cols = Array.isArray(columns) ? columns : [];

  if (cols.length === 0) return '\uFEFF';

  const headerLine = cols.map((c) => escapeCell(c.label)).join(',');

  const bodyLines = list.map((row) =>
    cols
      .map((c) => {
        const raw = typeof c.format === 'function'
          ? c.format(row)
          : (row ? row[c.key] : null);
        return escapeCell(raw);
      })
      .join(',')
  );

  return '\uFEFF' + [headerLine, ...bodyLines].join('\r\n');
};

// ------------------------------------------------------------
// 2) Browser download
// ------------------------------------------------------------

/**
 * Trigger a client-side download of a CSV string.
 * No-op under SSR (no document).
 *
 * The object URL is revoked on the next tick so the browser's
 * click handler has time to consume it before it disappears.
 */
export const downloadCsv = (filename, csvString) => {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = filename || 'export.csv';
  a.style.display = 'none';
  document.body.appendChild(a);
  try {
    a.click();
  } finally {
    document.body.removeChild(a);
    // Revoke after the click has been processed.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
};

// ------------------------------------------------------------
// 3) Small formatting helpers
// ------------------------------------------------------------

/**
 * Human-friendly local date+time for CSV cells.
 * Falls back to the raw value if parsing fails.
 */
export const formatCsvDateTime = (v) => {
  if (!v) return '';
  try {
    const d = new Date(v);
    if (isNaN(d.getTime())) return String(v);
    const pad = (n) => String(n).padStart(2, '0');
    return (
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
      `${pad(d.getHours())}:${pad(d.getMinutes())}`
    );
  } catch {
    return String(v);
  }
};

/**
 * `YYYYMMDD-HHMMSS` stamp for filenames.
 * Uses local time so the filename matches the user's clock.
 */
export const filenameTimestamp = (date = new Date()) => {
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
};

// ------------------------------------------------------------
// 4) STS-specific column set
// ------------------------------------------------------------

// One shared column definition so both tabs produce identical
// CSVs. Any field the backend doesn't include for a given tab
// just serializes as an empty cell — no per-tab branching.
const STS_COLUMNS = [
  {
    key: 'sts_no',
    label: 'STS No.',
    // Session 13 (I4) — before approval, the slip has no STS No.
    // Show a neutral placeholder ("STS No. ?") instead of leaking the
    // internal sts_id (DRAFT-<id>). Once approved, the backend
    // populates sts_no and it appears here.
    format: (r) => r?.sts_no || 'STS No. ?',
  },
  { key: 'status',             label: 'Status' },
  { key: 'request_origin',     label: 'Origin' },
  { key: 'submitted_by',       label: 'Submitted By' },
  { key: 'submitted_at',       label: 'Submitted At',  format: (r) => formatCsvDateTime(r?.submitted_at) },
  { key: 'approved_by',        label: 'Approved By' },
  { key: 'approved_at',        label: 'Approved At',   format: (r) => formatCsvDateTime(r?.approved_at) },
  { key: 'shipped_at',         label: 'Shipped At',    format: (r) => formatCsvDateTime(r?.shipped_at) },
  { key: 'received_at',        label: 'Received At',   format: (r) => formatCsvDateTime(r?.received_at) },
  { key: 'rejected_at',        label: 'Rejected At',   format: (r) => formatCsvDateTime(r?.rejected_at) },
  { key: 'transfer_date',      label: 'Transfer Date', format: (r) => formatCsvDateTime(r?.transfer_date) },
  { key: 'from_warehouse_code', label: 'From WH Code' },
  { key: 'from_warehouse_name', label: 'From WH Name' },
  { key: 'to_warehouse_code',   label: 'To WH Code' },
  { key: 'to_warehouse_name',   label: 'To WH Name' },
  { key: 'line_count',         label: 'Lines' },
  { key: 'total_qty',          label: 'Total Qty' },
  { key: 'remarks',            label: 'Remarks' },
  {
    key: 'rejection_reason',
    label: 'Rejection Reason',
    format: (r) => r?.rejection_reason || '',
  },
];

/**
 * Build the CSV string for a batch of STS rows.
 * Uses the shared STS_COLUMNS definition.
 */
export const buildSTSCsv = (rows) => buildCsv(rows, STS_COLUMNS);

/**
 * Convenience wrapper: build the STS CSV and immediately download it.
 * Filename: `STS_<segment>_<timestamp>.csv`
 *
 * `segment` is a short slug for the list the export came from, e.g.
 * 'all-slips', 'for-shipping', 'my-requests'. It's sanitized to a
 * URL-safe form so it can't break the filename.
 */
export const exportSTSCsv = (rows, segment = 'slips') => {
  const safeSegment = String(segment || 'slips')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'slips';

  const filename = `STS_${safeSegment}_${filenameTimestamp()}.csv`;
  downloadCsv(filename, buildSTSCsv(rows));
  return filename;
};