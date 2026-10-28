// src/components/shared/activityStyles.js
//
// Shared stage + event metadata for the two activity histories:
//   Flow A (PO)  → po_activity_log
//   Flow B (STS) → stock_transfer_activity_log
//
// Every row on both feeds is normalized into one unified shape so
// WarehouseActivityFeed can render them side by side without caring
// which backend it came from.

/* ============================================================
   STAGE → TONE
   ------------------------------------------------------------
   Union of PO stages (IMPORT|RECEIVE|STORE|TRANSFER|RELEASE) and
   STS stages (REQUEST|APPROVE|SHIP|TRANSIT|RECEIVE|STORE|COMPLETE|CANCEL).
   RECEIVE and STORE are shared between the two flows and use
   the same tone.
   ============================================================ */
export const STAGE_META = {
  /* ---- PO flow ---- */
  IMPORT:   { label: 'Import',   tone: 'sky' },
  TRANSFER: { label: 'Transfer', tone: 'indigo' },
  RELEASE:  { label: 'Release',  tone: 'amber' },

  /* ---- STS flow ---- */
  REQUEST:  { label: 'Request',  tone: 'slate' },
  APPROVE:  { label: 'Approve',  tone: 'indigo' },
  SHIP:     { label: 'Ship',     tone: 'purple' },
  TRANSIT:  { label: 'Transit',  tone: 'violet' },
  COMPLETE: { label: 'Complete', tone: 'emerald' },
  CANCEL:   { label: 'Cancel',   tone: 'rose' },

  /* ---- Shared between both flows ---- */
  RECEIVE:  { label: 'Receive',  tone: 'teal' },
  STORE:    { label: 'Store',    tone: 'emerald' },
};

/* ============================================================
   TONE PALETTE — each tone resolves to a 4-tuple used by the
   pill, the dot, and the expanded panel.
   ============================================================ */
export const TONE_PALETTE = {
  sky:     { bg: '#e0f2fe', fg: '#0369a1', border: '#7dd3fc', dot: '#0284c7' },
  teal:    { bg: '#ccfbf1', fg: '#0f766e', border: '#5eead4', dot: '#0d9488' },
  emerald: { bg: '#d1fae5', fg: '#065f46', border: '#6ee7b7', dot: '#059669' },
  indigo:  { bg: '#e0e7ff', fg: '#3730a3', border: '#a5b4fc', dot: '#4338ca' },
  amber:   { bg: '#fef3c7', fg: '#92400e', border: '#fcd34d', dot: '#d97706' },
  slate:   { bg: '#f1f5f9', fg: '#334155', border: '#cbd5e1', dot: '#475569' },
  purple:  { bg: '#ede9fe', fg: '#5b21b6', border: '#c4b5fd', dot: '#7c3aed' },
  violet:  { bg: '#ede9fe', fg: '#6d28d9', border: '#ddd6fe', dot: '#8b5cf6' },
  rose:    { bg: '#fee2e2', fg: '#991b1b', border: '#fca5a5', dot: '#dc2626' },
  cyan:    { bg: '#cffafe', fg: '#0e7490', border: '#67e8f9', dot: '#0891b2' },
  /* Extra tones used to distinguish PR-based rows from real POs. */
  orange:  { bg: '#ffedd5', fg: '#9a3412', border: '#fdba74', dot: '#ea580c' },
};

/* ============================================================
   EVENT TYPE → HUMAN LABEL
   ------------------------------------------------------------
   Covers every event_type written by Session 8 controllers
   PLUS the legacy event_types already in the DB.
   ============================================================ */
export const EVENT_LABEL = {
  /* ---- PO lifecycle (Session 8) ---- */
  IMPORT_PO_LINE:       'PO line imported',
  RECEIVE_PO_LINE:      'PO line received',
  MARK_PO_LINE_DAMAGED: 'PO line damaged',
  STORE_PO_LINE:        'PO line stored to locator',
  DAMAGE_PO_LINE:       'PO line sent to damage hold',
  RELEASE_PO_LINE:      'PO line released',
  TRANSFER_PO_LINE_OUT: 'PO line shipped (via STS)',
  TRANSFER_PO_LINE_IN:  'PO line received (via STS)',

  /* ---- PO lifecycle (legacy) ---- */
  Imported:             'Imported',
  Received:             'Received',
  Stored:               'Stored',
  Released:             'Released',
  Forwarded:            'Forwarded to handler',
  TransferSubmitted:    'Transfer submitted',
  TransferResubmitted:  'Transfer resubmitted',
  TransferApproved:     'Transfer approved',
  TransferRejected:     'Transfer rejected',
  TransferCancelled:    'Transfer cancelled',
  TransferInTransit:    'Transfer shipped',
  TransferReceived:     'Transfer received',
  TransferCompleted:    'Transfer completed',

  /* ---- STS lifecycle ---- */
  REQUEST_SUBMITTED:    'STS request submitted',
  QTY_ADJUSTED:         'Qty adjusted by approver',
  APPROVED:             'STS approved',
  REJECTED:             'STS rejected',
  CANCELLED:            'STS cancelled',
  SHIPPED:              'STS shipped',
  ARRIVED:              'STS arrived at destination',
  RECEIVED:             'STS received',
  STORE_LINE:           'STS line stored to locator',
  COMPLETED:            'STS completed',
};

/* ============================================================
   HELPERS
   ============================================================ */
export const eventLabel = (type) => EVENT_LABEL[type] || type || 'Event';

export const stageMeta = (stage) => {
  const meta = STAGE_META[stage];
  if (!meta) {
    return { label: stage || '—', tone: 'slate', ...TONE_PALETTE.slate };
  }
  const palette = TONE_PALETTE[meta.tone] || TONE_PALETTE.slate;
  return { ...meta, ...palette };
};

/* ============================================================
   FILTER DROPDOWN OPTIONS
   ============================================================ */
export const PO_STAGES = [
  { value: 'All',      label: 'All stages' },
  { value: 'IMPORT',   label: 'Import' },
  { value: 'RECEIVE',  label: 'Receive' },
  { value: 'STORE',    label: 'Store' },
  { value: 'TRANSFER', label: 'Transfer' },
  { value: 'RELEASE',  label: 'Release' },
];

export const STS_STAGES = [
  { value: 'All',      label: 'All stages' },
  { value: 'REQUEST',  label: 'Request' },
  { value: 'APPROVE',  label: 'Approve' },
  { value: 'SHIP',     label: 'Ship' },
  { value: 'TRANSIT',  label: 'Transit' },
  { value: 'RECEIVE',  label: 'Receive' },
  { value: 'STORE',    label: 'Store' },
  { value: 'COMPLETE', label: 'Complete' },
  { value: 'CANCEL',   label: 'Cancel' },
];

/* ============================================================
   Unified stage list for the "All" source tab.

   Session 13 (I3) — the shared 'STORE' stage is split into three
   options so users can tell WHERE an item was stored:
     • STORE         → any Store event (PO-flow OR STS-flow)
     • STORE_IMPORT  → Store events written from the PO flow
                       (auto-stored locked items + later manual
                       storage by the handler)
     • STORE_STS     → Store events written from the transfer flow

   The pseudo-values are resolved on the client (WarehouseActivityFeed)
   using the `_source` stamp on each normalized event. Server-side,
   all three map to `stage = 'STORE'`, so pagination and load-more
   keep working exactly as before.

   Session 13 (I4) — ORDERED DROPDOWN.
   The list is now ordered to mirror the real workflow:
     All → Import → Stored Import → Request → Approved Requests →
     For Transfer → In-Transit → Received STS → Stored STS →
     Issued, then an "Others" <optgroup> at the bottom that
     collects the remaining stages (All Stored, Transfer,
     Complete, Cancel).

   Render contract:
     • A plain entry has  { value, label }   →  <option>
     • A group entry has  { group, options } →  <optgroup>
   WarehouseActivityFeed's <select> renderer handles both shapes.
   ============================================================ */
export const ALL_STAGES = [
  { value: 'All',          label: 'All Stages' },
  { value: 'IMPORT',       label: 'Import' },
  { value: 'STORE_IMPORT', label: 'Stored Import' },
  { value: 'REQUEST',      label: 'Request' },
  { value: 'APPROVE',      label: 'Approved Requests' },
  { value: 'SHIP',         label: 'For Transfer' },
  { value: 'TRANSIT',      label: 'In-Transit' },
  { value: 'RECEIVE',      label: 'Received STS' },
  { value: 'STORE_STS',    label: 'Stored STS' },
  { value: 'RELEASE',      label: 'Issued' },
  {
    group: 'Others',
    options: [
      { value: 'STORE',     label: 'All Stored' },
      { value: 'TRANSFER',  label: 'Transfer (via STS)' },
      { value: 'COMPLETE',  label: 'Complete' },
      { value: 'CANCEL',    label: 'Cancel' },
    ],
  },
];

/* ============================================================
   NORMALIZERS — PO row → unified shape
   ------------------------------------------------------------
   Input (bare row from po_activity_log, now including has_po):
     log_id, po_no, event_type, stage, event_summary, event_detail,
     item_code, warehouse_code, warehouse_id, locator_code,
     qty_change, prev_qty, new_qty, actor, acted_at, ref_sts_id,
     has_po

   Session 13 (I1) — `_ref_type` is now derived from `has_po`:
     has_po === 1  →  'PO'  (row carries a real Purchase Order No.)
     has_po === 0  →  'PR'  (row was imported without a PO No.; the
                             po_no value is actually the PR No.)
   Legacy rows (has_po missing) fall back to 'PO'.
   ============================================================ */
export const normalizePoEvent = (row) => {
  if (!row) return null;

  const hasPo = row.has_po == null ? 1 : Number(row.has_po);
  const isPrBased = hasPo === 0;

  return {
    _key:            `PO-${row.log_id}`,
    _source:         'po',
    _id:             row.log_id,
    _ref_type:       isPrBased ? 'PR' : 'PO',
    _ref_no:         row.po_no || null,
    _ref_id:         row.po_no || null,
    _stage:          row.stage || null,
    _event_type:     row.event_type,
    _title:          row.event_summary || eventLabel(row.event_type),
    _detail:         row.event_detail || null,
    _item_code:      row.item_code || null,
    _item_name:      null,
    _uom:            null,
    _locator:        row.locator_code || null,
    _warehouse_code: row.warehouse_code || null,
    _qty_before:     row.prev_qty   != null ? Number(row.prev_qty)   : null,
    _qty_after:      row.new_qty    != null ? Number(row.new_qty)    : null,
    _qty_change:     row.qty_change != null ? Number(row.qty_change) : null,
    _actor:          row.actor || 'System',
    _actor_role:     null,
    _acted_at:       row.acted_at,
    _raw:            row,
  };
};

/* ============================================================
   NORMALIZERS — STS row → unified shape
   ------------------------------------------------------------
   Input (bare row from stock_transfer_activity_log):
     log_id, sts_id, sts_no, sts_line_id, event_type, stage,
     from_warehouse_code, to_warehouse_code,
     item_code, item_name, uom,
     qty_before, qty_after, qty_change, locator_code,
     actor, actor_role, acted_at, remarks, event_detail
   ============================================================ */
export const normalizeStsEvent = (row) => {
  if (!row) return null;
  return {
    _key:            `STS-${row.log_id}`,
    _source:         'sts',
    _id:             row.log_id,
    _ref_type:       'STS',
    _ref_no:         row.sts_no || (row.sts_id ? `DRAFT-${row.sts_id}` : null),
    _ref_id:         row.sts_id,
    _stage:          row.stage || null,
    _event_type:     row.event_type,
    _title:          eventLabel(row.event_type),
    _detail:         row.event_detail || row.remarks || null,
    _item_code:      row.item_code || null,
    _item_name:      row.item_name || null,
    _uom:            row.uom || null,
    _locator:        row.locator_code || null,
    _warehouse_code: row.from_warehouse_code && row.to_warehouse_code
                       ? `${row.from_warehouse_code} → ${row.to_warehouse_code}`
                       : (row.from_warehouse_code || row.to_warehouse_code || null),
    _qty_before:     row.qty_before != null ? Number(row.qty_before) : null,
    _qty_after:      row.qty_after  != null ? Number(row.qty_after)  : null,
    _qty_change:     row.qty_change != null ? Number(row.qty_change) : null,
    _actor:          row.actor || 'System',
    _actor_role:     row.actor_role || null,
    _acted_at:       row.acted_at,
    _raw:            row,
  };
};

/* ============================================================
   SORTING — newest first, with tiebreakers for deterministic
   interleaving of PO + STS rows that share a timestamp.
   ============================================================ */
export const sortByActedAtDesc = (a, b) => {
  const ta = new Date(a._acted_at).getTime();
  const tb = new Date(b._acted_at).getTime();
  if (tb !== ta) return tb - ta;
  if (a._source !== b._source) return a._source < b._source ? -1 : 1;
  return (b._id || 0) - (a._id || 0);
};

/* ============================================================
   DAY GROUPING
   ============================================================ */
export const dayKey = (date) => {
  if (!date) return '';
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const y  = d.getFullYear();
  const m  = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
};

export const dayLabel = (key) => {
  if (!key) return '';
  try {
    const parts = key.split('-').map(Number);
    const [y, m, dd] = parts;
    const target = new Date(y, m - 1, dd);
    const today  = new Date();
    const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const diff = Math.round((t0 - target) / 86400000);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    return target.toLocaleDateString(undefined, {
      weekday: 'long', month: 'short', day: 'numeric', year: 'numeric',
    });
  } catch {
    return key;
  }
};

/* ============================================================
   QTY DELTA FORMATTING
   ============================================================ */
export const formatQtyChange = (n) => {
  if (n == null || Number.isNaN(Number(n))) return null;
  const v = Number(n);
  if (v === 0) return '0';
  const sign = v > 0 ? '+' : '-';
  const abs  = Math.abs(v);
  const str  = Number.isInteger(abs) ? String(abs) : abs.toFixed(2);
  return `${sign}${str}`;
};

/* ============================================================
   DEFAULT EXPORT — convenient for callers that want a single
   object rather than named imports.
   ============================================================ */
export default {
  STAGE_META,
  TONE_PALETTE,
  EVENT_LABEL,
  eventLabel,
  stageMeta,
  PO_STAGES,
  STS_STAGES,
  ALL_STAGES,
  normalizePoEvent,
  normalizeStsEvent,
  sortByActedAtDesc,
  dayKey,
  dayLabel,
  formatQtyChange,
};