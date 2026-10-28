// src/components/underground/shiftCloseExport.js
import * as XLSX from 'xlsx';
import { sha256Hex } from './fileHash';

export const CLOSE_FORMAT_VERSION = '1.0';
export const CLOSE_FILE_KIND      = 'UndergroundShiftClose';

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
  } catch { return ''; }
};

const toNumber = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export const buildCloseFilename = (warehouseCode, shiftId, ext = 'xlsx') => {
  const code = String(warehouseCode || 'UG').trim().toUpperCase();
  return `underground-shift-${code}-${shiftId}-close-${fmtTimestampForFilename()}.${ext}`;
};

const SUMMARY_COLUMNS = ['Field', 'Value'];

const RELEASE_COLUMNS = [
  'Storage Locator',
  'Item Code',
  'Item Description',
  'UOM',
  'Type',
  'Qty Released',
  'Unit Cost',
  'Line Total',
  'Released At',
  'Released By',
  'Destination',
  'Remarks',
];

const META_COLUMNS = ['Field', 'Value'];

const buildSummaryRows = (shift, warehouse, summary, generatedAt) => {
  const rows = [
    { Field: 'Closing Export Version', Value: CLOSE_FORMAT_VERSION },
    { Field: 'File Kind',              Value: CLOSE_FILE_KIND },
    { Field: 'Shift ID',               Value: shift.shift_id ?? '' },
    { Field: 'Warehouse Code',         Value: warehouse.code || shift.warehouse_code || '' },
    { Field: 'Warehouse Name',         Value: warehouse.name || '' },
    { Field: 'Handler Username',       Value: shift.handler_username || '' },
    { Field: 'Handler Position',       Value: shift.handler_position || '' },
    { Field: 'Seed Export UID',        Value: shift.seed_export_uid || '' },
    { Field: 'Seed File Hash',         Value: shift.seed_file_hash  || '' },
    { Field: 'Started At',             Value: fmtTimestampForCell(shift.started_at) },
    { Field: 'Generated At',           Value: fmtTimestampForCell(generatedAt) },
    { Field: '',                       Value: '' },
    { Field: 'Beginning Locator Count', Value: summary.beginning_line_count ?? '' },
    { Field: 'Beginning Qty',          Value: toNumber(summary.beginning_qty) },
    { Field: 'Beginning Value',        Value: toNumber(summary.beginning_value) },
    { Field: 'Total Line Count',       Value: summary.release_line_count ?? '' },
    { Field: 'Total Out Qty',          Value: toNumber(summary.released_qty) },
    { Field: 'Total Out Value',        Value: toNumber(summary.released_value) },
    { Field: 'Total In Qty',           Value: toNumber(summary.trans_in_qty) },
    { Field: 'Total In Value',         Value: toNumber(summary.trans_in_value) },
    { Field: 'Ending Qty',             Value: toNumber(summary.ending_qty) },
    { Field: 'Ending Value',           Value: toNumber(summary.ending_value) },
    { Field: 'Locator Count',          Value: summary.locator_count ?? '' },
    { Field: '',                       Value: '' },
    { Field: 'App',                    Value: 'IMS · Inventory Management System' },
  ];
  return rows;
};

const buildReleaseRows = (releaseLines) => {
  const rows = releaseLines.map((ln) => ({
    'Storage Locator':  ln.locator_code || '',
    'Item Code':        ln.item_code    || '',
    'Item Description': ln.item_name    || '',
    'UOM':              ln.uom          || '',
    'Type':             ln.line_kind    || 'Release',
    'Qty Released':     toNumber(ln.qty),
    'Unit Cost':        toNumber(ln.unit_cost),
    'Line Total':       toNumber(ln.line_total),
    'Released At':      fmtTimestampForCell(ln.released_at),
    'Released By':      ln.released_by  || '',
    'Destination':      ln.destination  || '',
    'Remarks':          ln.remarks      || '',
  }));

  const totals = rows.reduce(
    (acc, r) => ({
      qty:   acc.qty   + r['Qty Released'],
      value: acc.value + r['Line Total'],
    }),
    { qty: 0, value: 0 }
  );

  rows.push({});
  rows.push({
    'Storage Locator': 'TOTAL',
    'Qty Released':    Number(totals.qty.toFixed(4)),
    'Line Total':      Number(totals.value.toFixed(4)),
  });

  return { rows, totals };
};

const buildMetaRows = (shift, warehouse, releaseLineCount, generatedAt) => [
  { Field: 'Format Version',     Value: CLOSE_FORMAT_VERSION },
  { Field: 'File Kind',          Value: CLOSE_FILE_KIND },
  { Field: 'Shift ID',           Value: shift.shift_id ?? '' },
  { Field: 'Warehouse Code',     Value: warehouse.code || shift.warehouse_code || '' },
  { Field: 'Warehouse Name',     Value: warehouse.name || '' },
  { Field: 'Seed Export UID',    Value: shift.seed_export_uid || '' },
  { Field: 'Closing Log UID',    Value: shift.closing_export_uid || '' },
  { Field: 'Release Line Count', Value: releaseLineCount },
  { Field: 'Generated At',       Value: fmtTimestampForCell(generatedAt) },
  { Field: 'App',                Value: 'IMS · Inventory Management System' },
];

export const buildShiftCloseFile = async (payload) => {
  const {
    shift,
    warehouse = {},
    summary = {},
    release_lines: releaseLines = [],
    generated_at: generatedAt,
  } = payload || {};

  if (!shift) {
    throw new Error('Shift data is required to build the closing file.');
  }

  const generatedAtDate = generatedAt ? new Date(generatedAt) : new Date();
  const wb = XLSX.utils.book_new();

  const summaryRows = buildSummaryRows(shift, warehouse, summary, generatedAtDate);
  const wsSummary = XLSX.utils.json_to_sheet(summaryRows, { header: SUMMARY_COLUMNS });
  wsSummary['!cols'] = [{ wch: 26 }, { wch: 52 }];
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');

  const { rows: releaseRows, totals } = buildReleaseRows(releaseLines);
  const wsRelease = XLSX.utils.json_to_sheet(releaseRows, { header: RELEASE_COLUMNS });
  wsRelease['!cols'] = [
    { wch: 18 }, // Storage Locator
    { wch: 18 }, // Item Code
    { wch: 32 }, // Item Description
    { wch:  8 }, // UOM
    { wch: 14 }, // Type
    { wch: 12 }, // Qty Released
    { wch: 12 }, // Unit Cost
    { wch: 14 }, // Line Total
    { wch: 20 }, // Released At
    { wch: 16 }, // Released By
    { wch: 20 }, // Destination
    { wch: 30 }, // Remarks
  ];
  XLSX.utils.book_append_sheet(wb, wsRelease, 'Release Lines');

  const metaRows = buildMetaRows(
    shift,
    warehouse,
    releaseLines.length,
    generatedAtDate
  );
  const wsMeta = XLSX.utils.json_to_sheet(metaRows, { header: META_COLUMNS });
  wsMeta['!cols'] = [{ wch: 22 }, { wch: 52 }];
  XLSX.utils.book_append_sheet(wb, wsMeta, 'Meta');

  const arrayBuffer = XLSX.write(wb, {
    bookType: 'xlsx',
    type: 'array',
  });

  const fileHash = await sha256Hex(arrayBuffer);
  const filename = buildCloseFilename(
    warehouse.code || shift.warehouse_code,
    shift.shift_id
  );

  return {
    arrayBuffer,
    filename,
    fileHash,
    fileSizeBytes: arrayBuffer.byteLength,
    releaseCount:  releaseLines.length,
    totalQty:      Number(totals.qty.toFixed(4)),
    totalValue:    Number(totals.value.toFixed(4)),
  };
};

export const triggerDownload = (arrayBuffer, mimeType, filename) => {
  const blob = new Blob([arrayBuffer], { type: mimeType });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  return blob.size;
};

export const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const shiftCloseExport = {
  CLOSE_FORMAT_VERSION,
  CLOSE_FILE_KIND,
  XLSX_MIME,
  buildShiftCloseFile,
  buildCloseFilename,
  triggerDownload,
};

export default shiftCloseExport;