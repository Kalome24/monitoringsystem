// src/components/departmenthead/TabStockTransferApproval.jsx
import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import {
  FiXCircle,
  FiX,
  FiAlertTriangle,
  FiCheckCircle,
  FiFileText,
  FiPackage,
  FiTarget,
  FiDownload,
  FiClock,
  FiList,
  FiInfo,
  FiEdit3,
  FiRotateCcw,
} from 'react-icons/fi';
import { useToast } from '../shared/ToastProvider';
import ModalBanner from '../shared/ModalBanner';
import ConfirmModal from '../shared/ConfirmModal';
import ItemImageThumb from '../shared/ItemImageThumb';
import { stockTransferApi, itemMasterApi, warehouseApi } from '../../services/api';
import { usePaginatedList } from '../../hooks/usePaginatedList';
import { useSessionState } from '../../hooks/useSessionState';

import {
  formatDate,
  formatDateTime,
  whPrimary,
  whSecondary,
  StatusBadge,
  SkeletonTable,
  SkeletonCards,
  exportSTSCsv,
  buildStockTransferModalCss,
  buildStockTransferTabCss,
  MODAL_THEME_INDIGO,
  TAB_THEME_APPROVAL,
} from '../shared/stockTransfer';

// ============================================================
// Shared CSS — built once at module load from the shared
// builders using the Dept Head (indigo) theme preset.
// ============================================================
const modalCss = buildStockTransferModalCss(MODAL_THEME_INDIGO);
const tabCss   = buildStockTransferTabCss(TAB_THEME_APPROVAL);

// Session 13 (I4) — display "STS No. ?" for slips that haven't
// been approved yet (no STS No. assigned).
const STS_NO_PLACEHOLDER = 'STS No. ?';

// ============================================================
// Sub-sidebar flag CSS — unchanged from Session 8.
// ============================================================
const subSidebarFlagCss = `
/* ---------- Card level ---------- */
.tsa-subsidebar.tsa-subsidebar--flag {
  position: relative;
  background: linear-gradient(180deg, #ffffff 0%, #f6fefd 100%);
  border: 1px solid #b8f1ea;
  border-radius: 14px;
  padding: 18px 14px 16px 22px;
  box-shadow:
    0 1px 2px rgba(15, 23, 42, 0.04),
    0 14px 32px -16px rgba(0, 184, 176, 0.35);
  overflow: hidden;
}
.tsa-subsidebar.tsa-subsidebar--flag::before {
  content: '';
  position: absolute;
  left: 0;
  top: 16px;
  bottom: 16px;
  width: 4px;
  background: linear-gradient(180deg, #00e0d4 0%, #008a82 100%);
  border-radius: 0 4px 4px 0;
  box-shadow: 0 0 14px rgba(0, 184, 176, 0.45);
  pointer-events: none;
}
.tsa-subsidebar-flag-head {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-bottom: 12px;
  border-bottom: 1px solid #ccfbf1;
  margin-bottom: 12px;
}
.tsa-subsidebar-flag-title {
  display: flex;
  align-items: center;
  gap: 9px;
  font-size: 11px;
  font-weight: 800;
  color: #0f766e;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  line-height: 1.2;
  margin: 0;
}
.tsa-subsidebar-flag-dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #00b8b0;
  flex-shrink: 0;
  animation: tsa-subsidebar-pulse 2.4s ease-in-out infinite;
}
@keyframes tsa-subsidebar-pulse {
  0%, 100% { box-shadow: 0 0 0 3px rgba(0, 184, 176, 0.22); }
  50%      { box-shadow: 0 0 0 8px rgba(0, 184, 176, 0.05); }
}
.tsa-subsidebar-flag-subtitle {
  margin: 0;
  font-size: 11px;
  color: #64748b;
  line-height: 1.4;
  font-weight: 500;
}
.tsa-subsidebar.tsa-subsidebar--flag .tsa-subsidebar-group {
  padding: 0;
  border-bottom: none;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.tsa-subsidebar.tsa-subsidebar--flag .tsa-subsidebar-group > .tsa-subsidebar-label {
  display: none;
}
.tsa-subsidebar.tsa-subsidebar--flag .tsa-filter-item {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  padding: 10px 12px 10px 16px;
  background: transparent;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-family: inherit;
  font-size: 13px;
  font-weight: 600;
  color: #475569;
  text-align: left;
  transition: background 0.15s ease, color 0.15s ease;
  -webkit-tap-highlight-color: transparent;
}
.tsa-subsidebar.tsa-subsidebar--flag .tsa-filter-item:hover {
  background: rgba(0, 184, 176, 0.07);
  color: #0f172a;
}
.tsa-subsidebar.tsa-subsidebar--flag .tsa-filter-item:focus-visible {
  outline: 2px solid #00b8b0;
  outline-offset: 2px;
}
.tsa-subsidebar.tsa-subsidebar--flag .tsa-filter-item.active {
  background: rgba(0, 184, 176, 0.12);
  color: #0f766e;
}
.tsa-filter-item-label {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.tsa-filter-item-label svg {
  width: 15px;
  height: 15px;
  stroke-width: 2.2;
  flex-shrink: 0;
  color: #64748b;
  transition: color 0.15s ease;
}
.tsa-subsidebar.tsa-subsidebar--flag .tsa-filter-item:hover .tsa-filter-item-label svg {
  color: #0f766e;
}
.tsa-subsidebar.tsa-subsidebar--flag .tsa-filter-item.active .tsa-filter-item-label svg {
  color: #0f766e;
}
.tsa-subsidebar.tsa-subsidebar--flag .tsa-filter-item::before {
  content: '';
  position: absolute;
  left: 4px;
  top: 50%;
  transform: translateY(-50%);
  width: 2px;
  height: 0;
  border-radius: 2px;
  background: #cbd5e1;
  transition:
    height 0.22s cubic-bezier(0.34, 1.4, 0.64, 1),
    background 0.15s ease;
}
.tsa-subsidebar.tsa-subsidebar--flag .tsa-filter-item:hover::before {
  height: 55%;
  background: #00b8b0;
}
.tsa-subsidebar.tsa-subsidebar--flag .tsa-filter-item.active::before {
  height: 68%;
  background: #0f766e;
}
.tsa-subsidebar.tsa-subsidebar--flag .tsa-filter-count {
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-size: 11px;
  font-weight: 700;
  color: #94a3b8;
  background: #f1f5f9;
  padding: 1px 7px;
  border-radius: 999px;
  min-width: 22px;
  text-align: center;
  line-height: 1.4;
  flex-shrink: 0;
  transition: background 0.15s ease, color 0.15s ease;
}
.tsa-subsidebar.tsa-subsidebar--flag .tsa-filter-item:hover .tsa-filter-count {
  background: #d7ecf3;
  color: #334155;
}
.tsa-subsidebar.tsa-subsidebar--flag .tsa-filter-item.active .tsa-filter-count {
  background: #0f766e;
  color: #ffffff;
}

@media (max-width: 900px) {
  .tsa-subsidebar.tsa-subsidebar--flag {
    padding: 12px 14px 12px 20px;
  }
  .tsa-subsidebar.tsa-subsidebar--flag::before {
    top: 10px;
    bottom: 10px;
  }
  .tsa-subsidebar-flag-head {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    padding-bottom: 8px;
    margin-bottom: 8px;
  }
  .tsa-subsidebar-flag-subtitle {
    text-align: right;
    font-size: 10.5px;
    color: #94a3b8;
  }
  .tsa-subsidebar.tsa-subsidebar--flag .tsa-subsidebar-group {
    flex-direction: row;
    gap: 8px;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    padding-bottom: 4px;
    scrollbar-width: thin;
    margin: 0 -4px;
    padding-left: 4px;
    padding-right: 4px;
  }
  .tsa-subsidebar.tsa-subsidebar--flag .tsa-filter-item {
    flex: 0 0 auto;
    min-width: 170px;
    padding: 9px 12px;
    border: 1px solid #b8f1ea;
    border-radius: 10px;
    background: #ffffff;
  }
  .tsa-subsidebar.tsa-subsidebar--flag .tsa-filter-item:hover {
    background: #f0fdfa;
    border-color: #5eead4;
  }
  .tsa-subsidebar.tsa-subsidebar--flag .tsa-filter-item.active {
    background: #f0fdfa;
    border-color: #0f766e;
  }
  .tsa-subsidebar.tsa-subsidebar--flag .tsa-filter-item::before {
    display: none;
  }
}
@media (max-width: 480px) {
  .tsa-subsidebar-flag-subtitle { display: none; }
  .tsa-subsidebar.tsa-subsidebar--flag .tsa-filter-item {
    min-width: 150px;
    font-size: 12px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .tsa-subsidebar-flag-dot { animation: none !important; box-shadow: 0 0 0 3px rgba(0, 184, 176, 0.22); }
  .tsa-subsidebar.tsa-subsidebar--flag .tsa-filter-item,
  .tsa-subsidebar.tsa-subsidebar--flag .tsa-filter-item::before,
  .tsa-subsidebar.tsa-subsidebar--flag .tsa-filter-count,
  .tsa-filter-item-label svg {
    transition: none !important;
  }
}
`;

// ============================================================
// Icon CSS — unchanged from Session 8.
// ============================================================
const tsaIconCss = `
.tsm-header-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.tsm-header-icon svg {
  width: 22px;
  height: 22px;
  stroke-width: 2.2;
  color: #ffffff;
}
.tsm-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.tsm-close svg {
  width: 18px;
  height: 18px;
  stroke-width: 2.4;
}
.tsm-rejection-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.tsm-rejection-icon svg {
  width: 16px;
  height: 16px;
  stroke-width: 2.4;
  color: #dc2626;
}
.tsm-note-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.tsm-note-icon svg {
  width: 16px;
  height: 16px;
  stroke-width: 2.4;
  color: #0f766e;
}
.tsm-note-block .tsm-note-icon svg {
  color: #b45309;
}
.tsm-section-title {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.tsm-section-title svg {
  width: 16px;
  height: 16px;
  stroke-width: 2.2;
  color: #334155;
}
.tsa-btn-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1em;
  height: 1em;
  flex-shrink: 0;
  margin-right: 6px;
  vertical-align: -0.12em;
  line-height: 1;
}
.tsa-btn-icon svg {
  width: 100%;
  height: 100%;
  stroke-width: 2.4;
}
.tsa-section-heading {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}
.tsa-section-heading svg {
  width: 20px;
  height: 20px;
  stroke-width: 2.2;
  color: #1a1f26;
}
.tsa-info-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-top: 1px;
}
.tsa-info-icon svg {
  width: 18px;
  height: 18px;
  stroke-width: 2.2;
  color: #1e3a8a;
}
.no-items-clear {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.no-items-clear svg {
  width: 1em;
  height: 1em;
  stroke-width: 2.4;
}
.export-btn .tsa-btn-icon { margin-right: 6px; }

@media (prefers-reduced-motion: reduce) {
  .tsa-btn-icon, .tsa-info-icon,
  .tsm-section-title svg, .tsm-note-icon svg, .tsm-rejection-icon svg {
    transition: none !important;
  }
}
`;

// ============================================================
// Session 9 (F2) — CSS for inline quantity adjustment.
// Every selector is prefixed with `tsa-` so nothing leaks into
// the shared modal / tab CSS.
// ============================================================
const tsaQtyCss = `
/* ---------- Edit banner (top of lines list, pending only) ---------- */
.tsa-edit-banner {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 11px 14px;
  background: linear-gradient(135deg, #eef2ff 0%, #e0e7ff 100%);
  border: 1px solid #c7d2fe;
  border-radius: 10px;
  color: #1e1b4b;
  font-size: 12.5px;
  line-height: 1.55;
}
.tsa-edit-banner-icon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  margin-top: 1px;
  color: #4338ca;
  stroke-width: 2.4;
}
.tsa-edit-banner-body { min-width: 0; }
.tsa-edit-banner-title {
  font-size: 11px;
  font-weight: 800;
  color: #4338ca;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 3px;
}

/* ---------- Line metrics grid: 3-column editable ---------- */
.tsm-line-metrics.tsm-line-metrics--edit {
  grid-template-columns: repeat(3, 1fr);
}

.tsa-metric--edit {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

/* Numeric input */
.tsa-qty-input {
  width: 100%;
  padding: 8px 10px;
  min-height: 38px;
  font-size: 15px;
  font-weight: 700;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  color: #0f172a;
  background: #ffffff;
  border: 1.5px solid #cbd5e1;
  border-radius: 8px;
  text-align: center;
  outline: none;
  box-sizing: border-box;
  transition: border-color 0.15s ease, box-shadow 0.15s ease, background 0.15s ease, color 0.15s ease;
}
.tsa-qty-input:hover:not(:disabled) { border-color: #94a3b8; }
.tsa-qty-input:focus {
  border-color: #6366f1;
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.18);
}
.tsa-qty-input:disabled { background: #f8fafc; color: #94a3b8; cursor: not-allowed; }
.tsa-qty-input.is-changed { border-color: #6366f1; background: #eef2ff; color: #3730a3; }
.tsa-qty-input.is-dropped { border-color: #fca5a5; background: #fef2f2; color: #991b1b; }
.tsa-qty-input.is-raised  { border-color: #86efac; background: #f0fdf4; color: #166534; }

/* Delta display */
.tsa-delta {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 14px;
  font-weight: 800;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  letter-spacing: -0.01em;
  line-height: 1.2;
  white-space: nowrap;
}
.tsa-delta.is-zero    { color: #64748b; }
.tsa-delta.is-partial { color: #b45309; }
.tsa-delta.is-dropped { color: #dc2626; }
.tsa-delta.is-raised  { color: #047857; }

/* Line tags (Dropped / Reduced / Raised) */
.tsa-line-tag {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  white-space: nowrap;
}
.tsa-line-tag--changed { background: #eef2ff; color: #3730a3; border: 1px solid #c7d2fe; }
.tsa-line-tag--dropped { background: #fee2e2; color: #991b1b; border: 1px solid #fca5a5; }
.tsa-line-tag--raised  { background: #d1fae5; color: #065f46; border: 1px solid #6ee7b7; }

/* Reason field */
.tsa-reason-block {
  display: flex;
  flex-direction: column;
  gap: 5px;
  animation: tsaReasonIn 0.16s ease;
}
@keyframes tsaReasonIn {
  from { opacity: 0; transform: translateY(-3px); }
  to   { opacity: 1; transform: translateY(0); }
}
.tsa-reason-label {
  font-size: 11px;
  font-weight: 800;
  color: #334155;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.tsa-reason-required { color: #dc2626; font-weight: 800; }
.tsa-reason-input {
  width: 100%;
  padding: 9px 11px;
  border: 1.5px solid #cbd5e1;
  border-radius: 8px;
  background: #ffffff;
  color: #0f172a;
  font-family: inherit;
  font-size: 13px;
  line-height: 1.5;
  outline: none;
  resize: vertical;
  min-height: 52px;
  box-sizing: border-box;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.tsa-reason-input:focus {
  border-color: #6366f1;
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.18);
}
.tsa-reason-input:disabled { background: #f8fafc; color: #94a3b8; cursor: not-allowed; }
.tsa-reason-error {
  font-size: 11px;
  color: #b91c1c;
  font-weight: 600;
}

/* All-zero warning */
.tsa-all-zero-warning {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 14px;
  background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%);
  border: 1px solid #fcd34d;
  border-left: 4px solid #dc2626;
  border-radius: 10px;
  color: #78350f;
  font-size: 12.5px;
  line-height: 1.55;
}
.tsa-all-zero-warning-icon {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  margin-top: 1px;
  color: #b91c1c;
  stroke-width: 2.4;
}

/* Footer adjustment summary */
.tsa-adj-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
  margin-right: auto;
  padding: 10px 14px;
  background: linear-gradient(135deg, #f0fdfa 0%, #ecfeff 100%);
  border: 1px solid #99f6e4;
  border-radius: 10px;
  font-size: 12.5px;
  color: #0f766e;
  min-width: 0;
}
.tsa-adj-summary-stats {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
}
.tsa-adj-summary-stat {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-weight: 600;
  white-space: nowrap;
}
.tsa-adj-summary-stat strong {
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-weight: 800;
  color: #0f172a;
}
.tsa-adj-summary-total {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-size: 12px;
  font-weight: 700;
  color: #0f766e;
  white-space: nowrap;
}
.tsa-adj-summary-arrow { color: #0f766e; opacity: 0.6; }
.tsa-adj-summary-total-new { color: #047857; }

/* Reset adjustments button */
.tsa-reset-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 9px 14px;
  border-radius: 8px;
  border: 1px solid #cbd5e1;
  background: #ffffff;
  color: #475569;
  font-family: inherit;
  font-size: 12.5px;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;
}
.tsa-reset-btn:hover:not(:disabled) { background: #f8fafc; border-color: #94a3b8; }
.tsa-reset-btn:disabled { opacity: 0.55; cursor: not-allowed; }

/* Responsive */
@media (max-width: 900px) {
  .tsm-line-metrics.tsm-line-metrics--edit { grid-template-columns: repeat(3, 1fr); }
}
@media (max-width: 640px) {
  .tsm-line-metrics.tsm-line-metrics--edit { grid-template-columns: 1fr 1fr; }
  .tsa-qty-input { font-size: 16px; min-height: 44px; }
  .tsa-reason-input { font-size: 16px; }
  .tsa-adj-summary {
    width: 100%;
    flex-direction: column;
    align-items: stretch;
    margin-right: 0;
  }
  .tsa-adj-summary-stats { justify-content: space-between; }
  .tsa-adj-summary-total { justify-content: space-between; }
}
@media (max-width: 480px) {
  .tsm-line-metrics.tsm-line-metrics--edit { grid-template-columns: 1fr; }
  .tsa-line-tag { font-size: 9px; padding: 2px 6px; }
  .tsa-delta { font-size: 13px; }
  .tsa-adj-summary { font-size: 12px; }
}
@media (max-width: 380px) {
  .tsa-edit-banner { font-size: 12px; padding: 10px 12px; }
  .tsa-adj-summary { padding: 9px 12px; gap: 8px; }
  .tsa-adj-summary-stats { flex-direction: column; align-items: flex-start; gap: 5px; }
  .tsa-adj-summary-total { flex-direction: column; align-items: flex-start; gap: 2px; }
}
@media (min-width: 1921px) {
  .tsa-qty-input { font-size: 16px; padding: 10px 12px; min-height: 44px; }
  .tsa-reason-input { font-size: 14px; }
  .tsa-adj-summary { font-size: 14px; padding: 12px 18px; }
}
@media (prefers-reduced-motion: reduce) {
  .tsa-reason-block { animation: none !important; }
  .tsa-qty-input,
  .tsa-reason-input,
  .tsa-reset-btn { transition: none !important; }
}
`;

// ============================================================
// Cross-component notification
// ============================================================
const notifyStsChanged = () => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('sts:changed'));
  }
};

// ============================================================
// Constants
// ============================================================
const SEGMENT_PENDING = 'pending';
const SEGMENT_HISTORY = 'history';

const HISTORY_STATUS_FILTERS = [
  'All',
  'For Shipping',
  'In-Transit',
  'Received',
  'Completed',
  'Rejected',
  'Cancelled',
];

const PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 300;

const STORAGE_KEYS = Object.freeze({
  segment: 'sts:deptHead:segment',
  pending: 'sts:deptHead:pending',
  history: 'sts:deptHead:history',
});

const PENDING_INITIAL_FILTERS = Object.freeze({});

const HISTORY_INITIAL_FILTERS = Object.freeze({
  status:        'All',
  startDate:     '',
  endDate:       '',
  warehouse:     '',
  warehouseSide: 'either',
});

// ============================================================
// Pure helpers (F2)
// ============================================================

/* Baseline for a line = requested_qty when present, else legacy qty. */
const baselineOfLine = (line) => {
  const rq = Number(line?.requested_qty);
  if (Number.isFinite(rq) && rq >= 0) return rq;
  const q = Number(line?.qty);
  return Number.isFinite(q) && q >= 0 ? q : 0;
};

/* Build a fresh draft from a set of lines. */
const buildInitialEdits = (lines) => {
  const out = {};
  if (!Array.isArray(lines)) return out;
  for (const l of lines) {
    const id = l?.sts_line_id;
    if (id == null) continue;
    out[id] = {
      approved_qty: String(baselineOfLine(l)),
      qty_change_reason: '',
    };
  }
  return out;
};

/* Classify the delta of one line for display. */
const classifyDelta = (baseline, finalQty) => {
  if (finalQty === baseline) return 'unchanged';
  if (finalQty === 0)       return 'dropped';
  if (finalQty < baseline)  return 'partial';
  return 'raised';
};

/* Parse a raw draft value into a real number, with baseline fallback. */
const parseDraftQty = (raw, baseline) => {
  if (raw === '' || raw == null) return baseline;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return baseline;
  return n;
};

/* Compute the summary + validation state for a whole draft. */
const summarizeDraft = (detail, edits) => {
  const empty = {
    total: 0, changed: 0, dropped: 0, reduced: 0, raised: 0,
    totalRequested: 0, totalApproved: 0,
    allZeroed: false, missingReasons: 0,
    invalidQty: 0, changedLineIds: [],
  };
  if (!detail?.lines || detail.lines.length === 0) return empty;

  let total = 0, changed = 0, dropped = 0, reduced = 0, raised = 0;
  let totalRequested = 0, totalApproved = 0;
  let missingReasons = 0, invalidQty = 0;
  let anyPositive = false;
  const changedLineIds = [];

  for (const l of detail.lines) {
    const baseline = baselineOfLine(l);
    const edit = edits[l.sts_line_id] || {};
    const raw = edit.approved_qty;

    let finalQty = baseline;
    if (raw !== '' && raw != null) {
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0) {
        invalidQty += 1;
        finalQty = baseline;
      } else {
        finalQty = n;
      }
    }

    total += 1;
    totalRequested += baseline;
    totalApproved += finalQty;
    if (finalQty > 0) anyPositive = true;

    if (finalQty !== baseline) {
      changed += 1;
      changedLineIds.push(l.sts_line_id);
      if (finalQty === 0) dropped += 1;
      else if (finalQty < baseline) reduced += 1;
      else raised += 1;

      const reason = (edit.qty_change_reason || '').trim();
      if (!reason) missingReasons += 1;
    }
  }

  return {
    total, changed, dropped, reduced, raised,
    totalRequested, totalApproved,
    allZeroed: total > 0 && !anyPositive,
    missingReasons, invalidQty,
    changedLineIds,
  };
};

/* Build the approved_lines array for the backend. */
const buildApprovedLinesPayload = (detail, edits) => {
  if (!detail?.lines) return [];
  return detail.lines.map((l) => {
    const baseline = baselineOfLine(l);
    const edit = edits[l.sts_line_id] || {};
    const finalQty = parseDraftQty(edit.approved_qty, baseline);
    const reason = (edit.qty_change_reason || '').trim();
    return {
      sts_line_id: l.sts_line_id,
      approved_qty: finalQty,
      qty_change_reason: finalQty !== baseline ? (reason || null) : null,
    };
  });
};

// ============================================================
// nextStepForSTS helper
// ============================================================
const nextStepForSTS = (status) => {
  switch (status) {
    case 'Pending':      return 'Your decision is required — review the slip and Approve or Reject it.';
    case 'For Shipping': return 'Approved. Waiting for the source warehouse to ship the stock.';
    case 'In-Transit':   return 'In transit. Waiting for the destination warehouse to confirm arrival.';
    case 'Received':     return 'Received. Good units have been stored in the pre-chosen locator.';
    case 'Completed':    return 'Transfer complete. No further action needed.';
    case 'Rejected':     return 'Rejected. The requester may submit a new request.';
    case 'Cancelled':    return 'This slip was cancelled before approval.';
    default:             return '—';
  }
};

// ============================================================
// RejectModal — unchanged.
// ============================================================
const RejectModal = ({
  open, onClose, onConfirm, transfer, submitting,
  feedback: parentFeedback, onDismissFeedback,
}) => {
  const [reason, setReason]     = useState('');
  const [feedback, setFeedback] = useState(null);

  useEffect(() => {
    if (open) { setReason(''); setFeedback(null); }
  }, [open]);

  if (!open || !transfer) return null;

  const activeFeedback = feedback || parentFeedback;

  const dismissFeedback = () => {
    if (feedback) setFeedback(null);
    if (parentFeedback) onDismissFeedback?.();
  };

  const confirm = () => {
    setFeedback(null);
    const trimmed = reason.trim();
    if (!trimmed) {
      setFeedback({
        type: 'warning',
        title: 'Reason required',
        message: 'Please enter a reason for rejecting this transfer request.',
      });
      return;
    }
    onConfirm?.(trimmed);
  };

  return (
    <>
      <style>{modalCss}</style>
      <style>{tsaIconCss}</style>
      <div className="tsm-overlay" onClick={submitting ? undefined : onClose}>
        <div className="tsm-card tsm-card--sm" onClick={(e) => e.stopPropagation()}>

          <div className="tsm-header">
            <div className="tsm-header-left">
              <div className="tsm-header-icon" style={{ background: 'linear-gradient(135deg, #ef4444, #b91c1c)' }}>
                <FiXCircle />
              </div>
              <div className="tsm-header-info">
                <h3 className="tsm-header-title">Reject Transfer Request</h3>
                <div className="tsm-header-sub">
                  <span className="tsm-header-pono">
                    {/* Session 13 (I4) — display "STS No. ?" until approved. */}
                    {transfer.sts_no || STS_NO_PLACEHOLDER}
                  </span>
                </div>
              </div>
            </div>
            <button
              type="button"
              className="tsm-close"
              onClick={onClose}
              disabled={submitting}
              aria-label="Close"
            ><FiX /></button>
          </div>

          <div className="tsm-body">
            {activeFeedback && (
              <ModalBanner
                type={activeFeedback.type}
                title={activeFeedback.title}
                message={activeFeedback.message}
                onClose={dismissFeedback}
              />
            )}

            <div className="tsm-route-badge">
              <div className="tsm-route-wh">
                <div className="tsm-route-label">FROM</div>
                <div className="tsm-route-name">
                  {whPrimary(transfer.from_warehouse_name, transfer.from_warehouse_code)}
                </div>
                {whSecondary(transfer.from_warehouse_name, transfer.from_warehouse_code) && (
                  <div className="tsm-route-code">{transfer.from_warehouse_code}</div>
                )}
              </div>
              <div className="tsm-route-arrow" aria-hidden="true">→</div>
              <div className="tsm-route-wh">
                <div className="tsm-route-label">TO</div>
                <div className="tsm-route-name">
                  {whPrimary(transfer.to_warehouse_name, transfer.to_warehouse_code)}
                </div>
                {whSecondary(transfer.to_warehouse_name, transfer.to_warehouse_code) && (
                  <div className="tsm-route-code">{transfer.to_warehouse_code}</div>
                )}
              </div>
            </div>

            <div className="tsm-field-block">
              <label className="tsm-field-label" htmlFor="tsa-reject-reason">
                Rejection Reason <span className="tsm-required">*</span>
              </label>
              <textarea
                id="tsa-reject-reason"
                className="tsm-textarea"
                rows={4}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Explain why this request is being rejected…"
                disabled={submitting}
                autoFocus
              />
              <small className="tsm-helper-text">
                This reason is shown to the requester. Rejection is terminal —
                they will need to submit a new request.
              </small>
            </div>

            <div className="tsm-note-block">
              <span className="tsm-note-icon"><FiAlertTriangle /></span>
              <span>
                Rejecting is terminal. No inventory was reserved for this
                pending slip, so nothing needs to be released back to the
                source warehouse.
              </span>
            </div>
          </div>

          <div className="tsm-footer">
            <button
              type="button"
              className="cancel-btn"
              onClick={onClose}
              disabled={submitting}
            >
              <span className="tsa-btn-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="19" y1="12" x2="5" y2="12" />
                  <polyline points="12 19 5 12 12 5" />
                </svg>
              </span>
              Back
            </button>
            <button
              type="button"
              className="save-btn"
              onClick={confirm}
              disabled={submitting || !reason.trim()}
              style={{
                background: submitting ? undefined : 'linear-gradient(135deg, #ef4444 0%, #b91c1c 100%)',
              }}
            >
              {submitting ? 'Rejecting…' : (
                <>
                  <span className="tsa-btn-icon"><FiXCircle /></span>
                  Confirm Reject
                </>
              )}
            </button>
          </div>

        </div>
      </div>
    </>
  );
};

// ============================================================
// DetailModal
// ------------------------------------------------------------
// Presentational. The parent owns the draft (`edits`) and
// passes down:  edits, onQtyChange, onReasonChange,
// onResetEdits, summary.
// ============================================================
const DetailModal = ({
  detail, images, onClose, onApprove, onReject,
  acting, feedback, onDismissFeedback,
  edits, onQtyChange, onReasonChange, onResetEdits,
  summary,
}) => {
  if (!detail) return null;

  const lines = detail.lines || [];
  const isPending = detail.status === 'Pending';

  return (
    <>
      <style>{modalCss}</style>
      <style>{tsaIconCss}</style>
      <style>{tsaQtyCss}</style>
      <div className="tsm-overlay" onClick={acting ? undefined : onClose}>
        <div className="tsm-card" onClick={(e) => e.stopPropagation()}>

          <div className="tsm-header">
            <div className="tsm-header-left">
              <div className="tsm-header-icon" style={{ background: 'linear-gradient(135deg, #00d2c8, #008a82)' }}>
                <FiFileText />
              </div>
              <div className="tsm-header-info">
                <h3 className="tsm-header-title">
                  {/* Session 13 (I4) — display "STS No. ?" until approved. */}
                  {detail.sts_no || STS_NO_PLACEHOLDER}
                </h3>
                <div className="tsm-header-sub">
                  <StatusBadge status={detail.status} />
                  {detail.request_origin && (
                    <>
                      <span className="tsm-header-dot">·</span>
                      <span>{detail.request_origin}</span>
                    </>
                  )}
                </div>
              </div>
            </div>
            <button
              type="button"
              className="tsm-close"
              onClick={onClose}
              disabled={acting}
              aria-label="Close"
            ><FiX /></button>
          </div>

          <div className="tsm-body">
            {feedback && (
              <ModalBanner
                type={feedback.type}
                title={feedback.title}
                message={feedback.message}
                onClose={onDismissFeedback}
              />
            )}

            <div className="tsm-route-badge">
              <div className="tsm-route-wh">
                <div className="tsm-route-label">FROM</div>
                <div className="tsm-route-name">
                  {whPrimary(detail.from_warehouse_name, detail.from_warehouse_code)}
                </div>
                {whSecondary(detail.from_warehouse_name, detail.from_warehouse_code) && (
                  <div className="tsm-route-code">{detail.from_warehouse_code}</div>
                )}
              </div>
              <div className="tsm-route-arrow" aria-hidden="true">→</div>
              <div className="tsm-route-wh">
                <div className="tsm-route-label">TO</div>
                <div className="tsm-route-name">
                  {whPrimary(detail.to_warehouse_name, detail.to_warehouse_code)}
                </div>
                {whSecondary(detail.to_warehouse_name, detail.to_warehouse_code) && (
                  <div className="tsm-route-code">{detail.to_warehouse_code}</div>
                )}
              </div>
            </div>

            <div className="tsm-meta-grid">
              <div className="tsm-meta-box">
                <div className="tsm-meta-label">Submitted By</div>
                <div className="tsm-meta-value">{detail.submitted_by || '—'}</div>
              </div>
              <div className="tsm-meta-box">
                <div className="tsm-meta-label">Submitted At</div>
                <div className="tsm-meta-value">{formatDateTime(detail.submitted_at)}</div>
              </div>
              <div className="tsm-meta-box">
                <div className="tsm-meta-label">Approved By</div>
                <div className="tsm-meta-value">{detail.approved_by || '—'}</div>
              </div>
              <div className="tsm-meta-box">
                <div className="tsm-meta-label">Approved At</div>
                <div className="tsm-meta-value">
                  {detail.approved_at ? formatDateTime(detail.approved_at) : '—'}
                </div>
              </div>
            </div>

            {detail.status === 'Rejected' && detail.rejection_reason && (
              <div className="tsm-rejection-banner">
                <div className="tsm-rejection-header">
                  <span className="tsm-rejection-icon"><FiAlertTriangle /></span>
                  <span className="tsm-rejection-title">
                    Rejected by {detail.rejected_by || '—'}
                  </span>
                </div>
                <div className="tsm-rejection-body">{detail.rejection_reason}</div>
                <div className="tsm-rejection-meta">
                  {formatDateTime(detail.rejected_at)}
                </div>
              </div>
            )}

            {detail.remarks && (
              <div className="tsm-field-block">
                <label className="tsm-field-label">Remarks from submitter</label>
                <div className="tsm-remarks-box">{detail.remarks}</div>
              </div>
            )}

            {isPending && (
              <div className="tsa-edit-banner">
                <FiEdit3 className="tsa-edit-banner-icon" />
                <div className="tsa-edit-banner-body">
                  <div className="tsa-edit-banner-title">Adjust quantities (optional)</div>
                  <div>
                    Change the approved qty per line if you are issuing less or
                    more than requested. Set a line to <strong>0</strong> to drop
                    it. A reason is required for every changed line. If every
                    line is set to 0, the slip auto-rejects on submit.
                  </div>
                </div>
              </div>
            )}

            {isPending && summary.allZeroed && (
              <div className="tsa-all-zero-warning">
                <FiAlertTriangle className="tsa-all-zero-warning-icon" />
                <span>
                  <strong>All lines are set to 0.</strong> Submitting will{' '}
                  <strong>auto-reject</strong> this slip with the reason
                  &ldquo;All lines were adjusted to zero by the approver.&rdquo;
                </span>
              </div>
            )}

            <div className="tsm-section-head">
              <span className="tsm-section-title">
                <FiPackage />
                <span>Items <span className="tsm-section-count">({lines.length})</span></span>
              </span>
              {isPending && summary.changed > 0 && (
                <span
                  className="tsm-summary-chip"
                  style={{ background: '#eef2ff', color: '#4338ca' }}
                >
                  {summary.changed} adjustment{summary.changed === 1 ? '' : 's'}
                </span>
              )}
            </div>

            <div className="tsm-lines-list">
              {lines.map((l) => {
                const baseline = baselineOfLine(l);
                const edit = edits[l.sts_line_id] || {};
                const rawQty = edit.approved_qty != null ? edit.approved_qty : String(baseline);
                const parsed = parseDraftQty(rawQty, baseline);
                const delta = parsed - baseline;
                const kind = classifyDelta(baseline, parsed);
                const rawIsBad = rawQty !== '' && rawQty != null
                  && (!Number.isFinite(Number(rawQty)) || Number(rawQty) < 0);
                const reasonMissing = isPending
                  && kind !== 'unchanged'
                  && !((edit.qty_change_reason || '').trim());

                const storedApproved = l.approved_qty != null ? Number(l.approved_qty) : null;

                const inputClass = rawIsBad
                  ? 'tsa-qty-input is-dropped'
                  : kind === 'dropped' ? 'tsa-qty-input is-dropped'
                  : kind === 'partial' ? 'tsa-qty-input is-changed'
                  : kind === 'raised'  ? 'tsa-qty-input is-raised'
                  : 'tsa-qty-input';

                const deltaLabel =
                  delta === 0 ? 'No change'
                  : delta > 0 ? `+${delta}`
                  : `${delta}`;

                const deltaClass =
                  delta === 0 ? 'is-zero'
                  : kind === 'dropped' ? 'is-dropped'
                  : kind === 'partial' ? 'is-partial'
                  : 'is-raised';

                return (
                  <div key={l.sts_line_id} className="tsm-line-card">
                    <div className="tsm-line-top">
                      <ItemImageThumb
                        src={images[l.item_code]}
                        alt={l.item_code}
                        size={48}
                      />
                      <div className="tsm-line-info">
                        <div className="tsm-line-code-row">
                          <span className="tsm-line-code">{l.item_code}</span>
                          {isPending && kind === 'dropped' && (
                            <span className="tsa-line-tag tsa-line-tag--dropped">Dropped</span>
                          )}
                          {isPending && kind === 'partial' && (
                            <span className="tsa-line-tag tsa-line-tag--changed">Reduced</span>
                          )}
                          {isPending && kind === 'raised' && (
                            <span className="tsa-line-tag tsa-line-tag--raised">Raised</span>
                          )}
                        </div>
                        <div className="tsm-line-name" title={l.item_name}>
                          {l.item_name || '—'}
                        </div>
                      </div>
                      <div className="tsm-line-uom-wrap">
                        <span className="tpm-uom-tag">{l.uom || '—'}</span>
                      </div>
                    </div>

                    {isPending ? (
                      <div className="tsm-line-metrics tsm-line-metrics--edit">
                        <div className="tsm-metric">
                          <div className="tsm-metric-label">Requested</div>
                          <div className="tsm-metric-value">{baseline}</div>
                        </div>
                        <div className="tsm-metric tsa-metric--edit">
                          <div className="tsm-metric-label">Approve</div>
                          <input
                            type="number"
                            min={0}
                            step={1}
                            inputMode="numeric"
                            className={inputClass}
                            value={rawQty}
                            onChange={(e) => onQtyChange(l.sts_line_id, e.target.value)}
                            disabled={acting}
                            aria-label={`Approved quantity for ${l.item_code}`}
                          />
                        </div>
                        <div className="tsm-metric">
                          <div className="tsm-metric-label">Change</div>
                          <div className={`tsa-delta ${deltaClass}`}>{deltaLabel}</div>
                        </div>
                      </div>
                    ) : (
                      <div className="tsm-line-metrics">
                        <div className="tsm-metric">
                          <div className="tsm-metric-label">Requested</div>
                          <div className="tsm-metric-value">{baseline}</div>
                        </div>
                        <div className="tsm-metric">
                          <div className="tsm-metric-label">Approved</div>
                          <div className="tsm-metric-value">
                            {storedApproved != null ? storedApproved : '—'}
                          </div>
                        </div>
                        <div className="tsm-metric">
                          <div className="tsm-metric-label">Received</div>
                          <div className="tsm-metric-value">
                            {Number(l.received_qty) || 0}
                          </div>
                        </div>
                      </div>
                    )}

                    {isPending && kind !== 'unchanged' && (
                      <div className="tsa-reason-block">
                        <label className="tsa-reason-label">
                          Reason for change
                          <span className="tsa-reason-required">*</span>
                        </label>
                        <textarea
                          className="tsa-reason-input"
                          rows={2}
                          value={edit.qty_change_reason || ''}
                          onChange={(e) => onReasonChange(l.sts_line_id, e.target.value)}
                          placeholder={
                            kind === 'dropped'
                              ? 'Why is this line being dropped?'
                              : kind === 'partial'
                              ? 'Why is the qty being reduced?'
                              : 'Why is the qty being raised?'
                          }
                          disabled={acting}
                        />
                        {reasonMissing && (
                          <div className="tsa-reason-error">
                            A reason is required for adjusted lines.
                          </div>
                        )}
                      </div>
                    )}

                    {!isPending && l.qty_change_reason && (
                      <div className="tsm-field-block">
                        <label className="tsm-field-label">Adjustment reason</label>
                        <div className="tsm-remarks-box">{l.qty_change_reason}</div>
                        {l.qty_changed_by && (
                          <small className="tsm-helper-text">
                            Changed by {l.qty_changed_by}
                            {l.qty_changed_at
                              ? ` · ${formatDateTime(l.qty_changed_at)}`
                              : ''}
                          </small>
                        )}
                      </div>
                    )}

                    {l.locator_code && (
                      <div className="tsm-line-bottom">
                        <span className="tsm-max-hint">
                          Target locator: <strong>{l.locator_code}</strong>
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="tsm-note-block">
              <span className="tsm-note-icon"><FiTarget /></span>
              <span>
                <strong>What&apos;s next:</strong> {nextStepForSTS(detail.status)}
              </span>
            </div>
          </div>

          <div className="tsm-footer">
            {isPending ? (
              <>
                {summary.changed > 0 && (
                  <div className="tsa-adj-summary">
                    <div className="tsa-adj-summary-stats">
                      <span className="tsa-adj-summary-stat">
                        <strong>{summary.changed}</strong> of{' '}
                        <strong>{summary.total}</strong> line
                        {summary.total === 1 ? '' : 's'} adjusted
                      </span>
                      {summary.dropped > 0 && (
                        <span className="tsa-adj-summary-stat">
                          <strong>{summary.dropped}</strong> dropped
                        </span>
                      )}
                      {summary.reduced > 0 && (
                        <span className="tsa-adj-summary-stat">
                          <strong>{summary.reduced}</strong> reduced
                        </span>
                      )}
                      {summary.raised > 0 && (
                        <span className="tsa-adj-summary-stat">
                          <strong>{summary.raised}</strong> raised
                        </span>
                      )}
                    </div>
                    <div className="tsa-adj-summary-total">
                      <span>{summary.totalRequested}</span>
                      <span className="tsa-adj-summary-arrow">→</span>
                      <span className="tsa-adj-summary-total-new">
                        {summary.totalApproved}
                      </span>
                    </div>
                  </div>
                )}

                {summary.changed > 0 && (
                  <button
                    type="button"
                    className="tsa-reset-btn"
                    onClick={onResetEdits}
                    disabled={acting}
                    title="Reset every line back to its requested qty"
                  >
                    <FiRotateCcw size={13} />
                    Reset
                  </button>
                )}

                <button
                  type="button"
                  className="cancel-btn"
                  onClick={onClose}
                  disabled={acting}
                >
                  Close
                </button>

                <button
                  type="button"
                  className="save-btn"
                  onClick={onReject}
                  disabled={acting}
                  style={{
                    background: 'linear-gradient(135deg, #ef4444 0%, #b91c1c 100%)',
                  }}
                >
                  <span className="tsa-btn-icon"><FiXCircle /></span>
                  Reject
                </button>

                <button
                  type="button"
                  className="save-btn"
                  onClick={onApprove}
                  disabled={acting || summary.missingReasons > 0 || summary.invalidQty > 0}
                  style={{
                    background:
                      acting || summary.missingReasons > 0 || summary.invalidQty > 0
                        ? undefined
                        : 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                  }}
                  title={
                    summary.invalidQty > 0
                      ? 'Fix invalid quantities before approving'
                      : summary.missingReasons > 0
                      ? 'Add a reason for every changed line to continue'
                      : 'Approve with the current per-line quantities'
                  }
                >
                  <span className="tsa-btn-icon"><FiCheckCircle /></span>
                  {summary.changed > 0 ? 'Approve with adjustments' : 'Approve'}
                </button>
              </>
            ) : (
              <button type="button" className="cancel-btn" onClick={onClose}>
                Close
              </button>
            )}
          </div>

        </div>
      </div>
    </>
  );
};

// ============================================================
// Main component
// ============================================================
const TabStockTransferApproval = () => {
  const toast = useToast();

  const [segment, setSegment] = useSessionState(
    STORAGE_KEYS.segment,
    SEGMENT_PENDING
  );

  const [warehouses, setWarehouses]         = useState([]);

  const [detail, setDetail]                 = useState(null);
  const [detailLoading, setDetailLoading]   = useState(false);
  const [detailFeedback, setDetailFeedback] = useState(null);
  const [images, setImages]                 = useState({});

  const [showReject, setShowReject]         = useState(false);
  const [rejectFeedback, setRejectFeedback] = useState(null);

  const [showApproveConfirm, setShowApproveConfirm] = useState(false);

  const [acting, setActing]                 = useState(false);

  const [exporting, setExporting]           = useState(false);

  // ---- F2: qty-adjust draft (owned by the parent so the whole
  //          approve flow can read from a single source of truth). ----
  const [edits, setEdits]                   = useState({});

  const firstLineCacheRef = useRef(new Map());
  const detailReqIdRef    = useRef(0);

  // ============================================================
  // Pending queue (paginated, server-filtered)
  // ============================================================
  const pendingLoader = useCallback(async ({ page, limit, search }) => {
    return stockTransferApi.approvalQueue({
      page,
      limit,
      search: search || undefined,
    });
  }, []);

  const pending = usePaginatedList({
    loader: pendingLoader,
    initialFilters: PENDING_INITIAL_FILTERS,
    pageSize: PAGE_SIZE,
    debounceMs: SEARCH_DEBOUNCE_MS,
    storageKey: STORAGE_KEYS.pending,
  });

  // ============================================================
  // History (paginated, server-filtered)
  // ============================================================
  const historyLoader = useCallback(async ({
    page, limit, search, status, startDate, endDate,
    warehouse, warehouseSide,
  }) => {
    return stockTransferApi.listSTSs({
      scope:      'all',
      page,
      limit,
      search:     search || undefined,
      status:     status === 'All' ? undefined : status,
      start_date: startDate || undefined,
      end_date:   endDate || undefined,
      warehouse_code: warehouse || undefined,
      warehouse_side: warehouse ? (warehouseSide || 'either') : undefined,
    });
  }, []);

  const history = usePaginatedList({
    loader: historyLoader,
    initialFilters: HISTORY_INITIAL_FILTERS,
    pageSize: PAGE_SIZE,
    debounceMs: SEARCH_DEBOUNCE_MS,
    storageKey: STORAGE_KEYS.history,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await warehouseApi.getAllWarehouses();
        if (cancelled) return;
        if (res.ok && Array.isArray(res.data)) setWarehouses(res.data);
      } catch (err) {
        console.warn('Could not load warehouses:', err);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ============================================================
  // Load first-line info + item images for visible rows
  // ============================================================
  const loadImagesForRows = useCallback(async (rows) => {
    if (!Array.isArray(rows) || rows.length === 0) return;

    const codes = new Set();
    const uncached = [];

    for (const row of rows) {
      if (firstLineCacheRef.current.has(row.sts_id)) {
        const cached = firstLineCacheRef.current.get(row.sts_id);
        if (cached?.item_code) codes.add(cached.item_code);
      } else if (row.sts_id) {
        uncached.push(row);
      }
    }

    if (uncached.length > 0) {
      await Promise.all(
        uncached.map(async (row) => {
          try {
            const res = await stockTransferApi.getSTSDetail(row.sts_id);
            if (res.ok && res.data?.lines?.length) {
              const first = res.data.lines[0];
              firstLineCacheRef.current.set(row.sts_id, {
                item_code:  first.item_code || null,
                item_name:  first.item_name || null,
                uom:        first.uom || null,
                line_count: res.data.lines.length,
              });
              if (first.item_code) codes.add(first.item_code);
            } else {
              firstLineCacheRef.current.set(row.sts_id, null);
            }
          } catch {
            firstLineCacheRef.current.set(row.sts_id, null);
          }
        })
      );
    }

    if (codes.size === 0) return;

    try {
      const res = await itemMasterApi.getImagesByCodes([...codes]);
      if (res.ok && res.data?.images) {
        setImages((prev) => ({ ...prev, ...res.data.images }));
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (pending.rows.length > 0) loadImagesForRows(pending.rows);
  }, [pending.rows, loadImagesForRows]);

  useEffect(() => {
    if (history.rows.length > 0) loadImagesForRows(history.rows);
  }, [history.rows, loadImagesForRows]);

  const getRowItem = useCallback((row) => {
    const cached = firstLineCacheRef.current.get(row.sts_id);
    if (!cached) return null;
    return {
      item_code:  cached.item_code,
      item_name:  cached.item_name,
      line_count: cached.line_count ?? row.line_count ?? 1,
    };
  }, []);

  // ============================================================
  // F2 — draft lifecycle
  // ============================================================

  /* Reset the draft whenever the modal opens a new slip. */
  useEffect(() => {
    if (!detail?.lines) { setEdits({}); return; }
    setEdits(buildInitialEdits(detail.lines));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail?.sts_id]);

  /* Derived summary from the draft + detail. */
  const draftSummary = useMemo(
    () => summarizeDraft(detail, edits),
    [detail, edits]
  );

  const handleQtyChange = useCallback((lineId, raw) => {
    setEdits((prev) => ({
      ...prev,
      [lineId]: {
        ...(prev[lineId] || {}),
        approved_qty: raw,
      },
    }));
  }, []);

  const handleReasonChange = useCallback((lineId, raw) => {
    setEdits((prev) => ({
      ...prev,
      [lineId]: {
        ...(prev[lineId] || {}),
        qty_change_reason: raw,
      },
    }));
  }, []);

  const handleResetEdits = useCallback(() => {
    if (!detail?.lines) return;
    setEdits(buildInitialEdits(detail.lines));
  }, [detail]);

  // ============================================================
  // Segment selection
  // ============================================================
  const isPendingSegment = segment === SEGMENT_PENDING;
  const activeList       = isPendingSegment ? pending : history;
  const rows             = activeList.rows;
  const loading          = activeList.loading;

  const pendingCount = pending.total;
  const historyCount = history.total;

  const pendingHasActiveFilter = !!pending.search.trim();
  const historyHasActiveFilter =
    !!history.search.trim() ||
    history.filters.status !== 'All' ||
    !!history.filters.startDate ||
    !!history.filters.endDate ||
    !!history.filters.warehouse;

  const activeSegmentHasFilter = isPendingSegment
    ? pendingHasActiveFilter
    : historyHasActiveFilter;

  // ============================================================
  // Detail modal
  // ============================================================
  const openDetail = async (row) => {
    const reqId = ++detailReqIdRef.current;
    const isStale = () => reqId !== detailReqIdRef.current;

    setDetailLoading(true);
    setDetailFeedback(null);
    setImages({});
    try {
      const res = await stockTransferApi.getSTSDetail(row.sts_id);
      if (isStale()) return;
      if (res.ok && res.data) {
        setDetail(res.data);
        const codes = [...new Set((res.data.lines || []).map((l) => l.item_code).filter(Boolean))];
        if (codes.length) {
          try {
            const imgRes = await itemMasterApi.getImagesByCodes(codes);
            if (isStale()) return;
            if (imgRes.ok && imgRes.data?.images) {
              setImages(imgRes.data.images);
            }
          } catch { /* ignore */ }
        }
      } else {
        toast.error('Could not load the transfer details.');
      }
    } catch (err) {
      if (isStale()) return;
      console.error('Detail error:', err);
      toast.error('Error connecting to server.');
    } finally {
      if (!isStale()) setDetailLoading(false);
    }
  };

  const closeDetail = () => {
    if (acting) return;
    setDetail(null);
    setDetailFeedback(null);
    setShowReject(false);
    setShowApproveConfirm(false);
    setEdits({});
  };

  // ============================================================
  // Approve — F2
  // ============================================================
  const handleApproveClick = () => {
    if (!detail) return;
    setDetailFeedback(null);

    /* Client-side gate before showing the confirm modal. */
    if (draftSummary.invalidQty > 0) {
      setDetailFeedback({
        type: 'error',
        title: 'Invalid quantity',
        message: 'One or more lines have an invalid approved qty. Please fix them before approving.',
      });
      return;
    }
    if (draftSummary.missingReasons > 0) {
      setDetailFeedback({
        type: 'warning',
        title: 'Reason required',
        message: 'Every line whose qty was changed needs a reason before you can approve.',
      });
      return;
    }

    setShowApproveConfirm(true);
  };

  const handleApproveCancel = () => {
    if (acting) return;
    setShowApproveConfirm(false);
  };

  const handleApproveConfirm = async () => {
    if (!detail) return;

    const approved_lines = buildApprovedLinesPayload(detail, edits);

    setActing(true);
    setDetailFeedback(null);
    try {
      const res = await stockTransferApi.approveSTS(detail.sts_id, { approved_lines });

      if (!res.ok || res.data?.success === false) {
        setShowApproveConfirm(false);
        setDetailFeedback({
          type: 'error',
          title: 'Approval failed',
          message: res.data?.message || 'Failed to approve this transfer request.',
        });
        return;
      }

      const allZeroed = res.data?.data?.all_zeroed === true;
      if (allZeroed) {
        toast.warning(
          res.data?.message ||
          'All lines were zeroed — the transfer was auto-rejected.'
        );
        setShowApproveConfirm(false);
        closeDetail();
        await pending.reload();
        await history.reload();
        notifyStsChanged();
        return;
      }

      const issuedStsNo =
        res.data?.data?.sts_no ||
        res.data?.sts_no ||
        null;

      const adjustedCount = approved_lines.reduce((acc, p) => {
        const line = detail.lines.find((x) => x.sts_line_id === p.sts_line_id);
        if (!line) return acc;
        const baseline = baselineOfLine(line);
        return acc + (p.approved_qty !== baseline ? 1 : 0);
      }, 0);

      let msg;
      if (issuedStsNo && adjustedCount > 0) {
        msg = `Approved with ${adjustedCount} adjustment${adjustedCount === 1 ? '' : 's'}. STS No. ${issuedStsNo} issued.`;
      } else if (issuedStsNo) {
        msg = `Approved. STS No. ${issuedStsNo} issued — transfer is now For Shipping.`;
      } else if (adjustedCount > 0) {
        msg = `Approved with ${adjustedCount} adjustment${adjustedCount === 1 ? '' : 's'}. Transfer is now For Shipping.`;
      } else {
        msg = res.data?.message || 'Approved. Transfer is now For Shipping.';
      }

      toast.success(msg);

      setShowApproveConfirm(false);
      closeDetail();
      await pending.reload();
      await history.reload();
      notifyStsChanged();
    } catch (err) {
      console.error('Approve error:', err);
      setShowApproveConfirm(false);
      setDetailFeedback({
        type: 'error',
        title: 'Approval failed',
        message: 'Error connecting to server.',
      });
    } finally {
      setActing(false);
    }
  };

  // ============================================================
  // Reject
  // ============================================================
  const openReject = () => {
    if (!detail) return;
    setRejectFeedback(null);
    setShowReject(true);
  };

  const closeReject = () => {
    if (acting) return;
    setShowReject(false);
    setRejectFeedback(null);
  };

  const handleRejectConfirm = async (reason) => {
    if (!detail) return;
    setActing(true);
    setRejectFeedback(null);
    try {
      const res = await stockTransferApi.rejectSTS(detail.sts_id, reason);
      if (!res.ok || res.data?.success === false) {
        setRejectFeedback({
          type: 'error',
          title: 'Rejection failed',
          message: res.data?.message || 'Failed to reject this transfer request.',
        });
        return;
      }

      toast.success(
        res.data?.message ||
        'Transfer request rejected. The requester can submit a new one.'
      );

      setShowReject(false);
      setDetail(null);
      setDetailFeedback(null);
      setEdits({});

      await pending.reload();
      await history.reload();
      notifyStsChanged();
    } catch (err) {
      console.error('Reject error:', err);
      setRejectFeedback({
        type: 'error',
        title: 'Rejection failed',
        message: 'Error connecting to server.',
      });
    } finally {
      setActing(false);
    }
  };

  // ============================================================
  // Export
  // ============================================================
  const handleExport = async () => {
    if (exporting) return;
    if (isPendingSegment) return;

    setExporting(true);
    try {
      const EXPORT_LIMIT = 500;
      const exportRows = await history.fetchAll(EXPORT_LIMIT);

      if (!exportRows || exportRows.length === 0) {
        toast.info('Nothing to export — the current filters match no slips.');
        return;
      }

      const truncated = history.total > exportRows.length;
      const filename = exportSTSCsv(exportRows, 'all-slips');

      if (truncated) {
        toast.warning(
          `Exported the first ${exportRows.length} of ${history.total} rows to ${filename}. ` +
          `Narrow the filters to export the rest.`,
          { duration: 7000 }
        );
      } else {
        toast.success(
          `Exported ${exportRows.length} row${exportRows.length === 1 ? '' : 's'} to ${filename}.`
        );
      }
    } catch (err) {
      console.error('Export error:', err);
      toast.error('Export failed. Please try again.');
    } finally {
      setExporting(false);
    }
  };

  // ============================================================
  // Misc
  // ============================================================
  const clearFilters = () => {
    if (isPendingSegment) pending.clearAll();
    else history.clearAll();
  };

  const refreshCurrent = () => {
    if (isPendingSegment) pending.reload();
    else history.reload();
  };

  // ============================================================
  // Desktop table
  // ============================================================
  const renderDesktopTable = () => (
    <div className="table-wrapper">
      {loading ? (
        <SkeletonTable rows={6} />
      ) : rows.length > 0 ? (
        <table className="data-table tsa-table">
          <thead>
            <tr>
              <th className="col-item">Item</th>
              <th className="col-sts">STS No.</th>
              <th className="col-route">Route</th>
              <th className="col-by">Submitted By</th>
              <th className="col-date">Date</th>
              <th className="col-qty">Lines / Qty</th>
              <th className="col-status">Status</th>
              <th className="col-actions">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const item = getRowItem(r);
              const extraLines = item ? Math.max(0, (item.line_count || 1) - 1) : 0;
              const isPendingRow = r.status === 'Pending';

              return (
                <tr
                  key={r.sts_id}
                  className="tsa-row"
                  onClick={() => openDetail(r)}
                >
                  <td className="col-item">
                    <div className="tsa-item-cell">
                      <ItemImageThumb
                        src={item?.item_code ? images[item.item_code] : null}
                        alt={item?.item_code || 'item'}
                        size={44}
                      />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div className="tsa-item-code">{item?.item_code || '—'}</div>
                        <div className="tsa-item-name" title={item?.item_name || ''}>
                          {item?.item_name || '—'}
                        </div>
                        {extraLines > 0 && (
                          <span className="tsa-more-chip">+{extraLines} more</span>
                        )}
                      </div>
                    </div>
                  </td>

                  <td className="col-sts">
                    <span className="po-no-big sts-color" style={{ fontSize: 14 }}>
                      {/* Session 13 (I4) — display "STS No. ?" until approved. */}
                      {r.sts_no || STS_NO_PLACEHOLDER}
                    </span>
                  </td>

                  <td className="col-route">
                    <div className="tsa-route-cell">
                      <div className="tsa-route-line">
                        <span className="tsa-route-wh">
                          {whPrimary(r.from_warehouse_name, r.from_warehouse_code)}
                        </span>
                        <span className="tsa-route-arrow">→</span>
                        <span className="tsa-route-wh">
                          {whPrimary(r.to_warehouse_name, r.to_warehouse_code)}
                        </span>
                      </div>
                      <div className="tsa-route-codes">
                        {r.from_warehouse_code || '—'} → {r.to_warehouse_code || '—'}
                      </div>
                    </div>
                  </td>

                  <td className="col-by">{r.submitted_by || '—'}</td>
                  <td className="col-date">{formatDate(r.submitted_at)}</td>

                  <td className="col-qty">
                    <span className="tsa-qty">
                      {r.line_count ?? 0} · {Number(r.total_qty) || 0}
                    </span>
                  </td>

                  <td className="col-status"><StatusBadge status={r.status} /></td>

                  <td className="col-actions" onClick={(e) => e.stopPropagation()}>
                    {isPendingRow ? (
                      <button
                        type="button"
                        className="action-btn edit"
                        onClick={() => openDetail(r)}
                        title="Review this request"
                      >
                        Review
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="po-view-hint"
                        onClick={() => openDetail(r)}
                        title="View details"
                      >
                        View ›
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <div className="no-items-message">
          <p>
            {isPendingSegment
              ? (pendingHasActiveFilter
                  ? 'No pending requests match your search.'
                  : 'No transfer requests are awaiting your approval right now.')
              : 'No slips match the current filters.'}
          </p>
          {activeSegmentHasFilter && (
            <button
              type="button"
              className="no-items-clear"
              onClick={clearFilters}
            >
              <FiX />
              <span>Clear filters</span>
            </button>
          )}
        </div>
      )}
    </div>
  );

  // ============================================================
  // Mobile cards
  // ============================================================
  const renderMobileCards = () => (
    <>
      {loading ? (
        <SkeletonCards rows={4} />
      ) : rows.length > 0 ? (
        rows.map((r) => {
          const item = getRowItem(r);
          const extraLines = item ? Math.max(0, (item.line_count || 1) - 1) : 0;
          const isPendingRow = r.status === 'Pending';

          return (
            <div
              key={r.sts_id}
              className="po-card"
              onClick={() => openDetail(r)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && openDetail(r)}
            >
              <div className="po-card-row-1 tsa-card-item">
                <div className="tsa-item-cell">
                  <ItemImageThumb
                    src={item?.item_code ? images[item.item_code] : null}
                    alt={item?.item_code || 'item'}
                    size={40}
                  />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="tsa-item-code">{item?.item_code || '—'}</div>
                    <div className="tsa-item-name" title={item?.item_name || ''}>
                      {item?.item_name || '—'}
                    </div>
                    {extraLines > 0 && (
                      <span className="tsa-more-chip">+{extraLines} more</span>
                    )}
                  </div>
                </div>
                <StatusBadge status={r.status} />
              </div>

              <div className="po-card-row-1">
                <span className="po-no-big sts-color" style={{ fontSize: 16 }}>
                  {/* Session 13 (I4) — display "STS No. ?" until approved. */}
                  {r.sts_no || STS_NO_PLACEHOLDER}
                </span>
              </div>

              <div className="po-card-row-2">
                <span>
                  <strong>From:</strong>{' '}
                  {whPrimary(r.from_warehouse_name, r.from_warehouse_code)}
                  {whSecondary(r.from_warehouse_name, r.from_warehouse_code)
                    ? ` · ${r.from_warehouse_code}`
                    : ''}
                </span>
                <span>
                  <strong>To:</strong>{' '}
                  {whPrimary(r.to_warehouse_name, r.to_warehouse_code)}
                  {whSecondary(r.to_warehouse_name, r.to_warehouse_code)
                    ? ` · ${r.to_warehouse_code}`
                    : ''}
                </span>
              </div>

              <div className="po-card-row-2">
                <span><strong>Lines:</strong> {r.line_count ?? 0}</span>
                <span><strong>Qty:</strong> {Number(r.total_qty) || 0}</span>
              </div>

              <div className="po-card-row-2" style={{ fontSize: 12, color: '#64748b' }}>
                <span><strong>By:</strong> {r.submitted_by || '—'}</span>
                <span>{formatDate(r.submitted_at)}</span>
              </div>

              <div className="po-card-actions" onClick={(e) => e.stopPropagation()}>
                {isPendingRow ? (
                  <button
                    type="button"
                    className="action-btn edit"
                    onClick={() => openDetail(r)}
                  >
                    Review
                  </button>
                ) : (
                  <button
                    type="button"
                    className="po-view-hint"
                    onClick={() => openDetail(r)}
                  >
                    View ›
                  </button>
                )}
              </div>
            </div>
          );
        })
      ) : (
        <div className="no-items-message">
          <p>
            {isPendingSegment
              ? (pendingHasActiveFilter
                  ? 'No pending requests match your search.'
                  : 'No transfer requests are awaiting your approval right now.')
              : 'No slips match the current filters.'}
          </p>
          {activeSegmentHasFilter && (
            <button
              type="button"
              className="no-items-clear"
              onClick={clearFilters}
            >
              <FiX />
              <span>Clear filters</span>
            </button>
          )}
        </div>
      )}
    </>
  );

  // ============================================================
  // Approve confirmation message
  // ============================================================
  const approveConfirmMessage = detail ? (
    <>
      An STS number will be issued and this request will move to the
      source warehouse&apos;s <strong>For Shipping</strong> queue.
      <br /><br />
      <strong>From:</strong>{' '}
      {whPrimary(detail.from_warehouse_name, detail.from_warehouse_code)}
      <br />
      <strong>To:</strong>{' '}
      {whPrimary(detail.to_warehouse_name, detail.to_warehouse_code)}

      {draftSummary.changed > 0 && (
        <>
          <br /><br />
          <span style={{ fontSize: 12.5 }}>
            <strong>{draftSummary.changed}</strong> of{' '}
            <strong>{draftSummary.total}</strong> line
            {draftSummary.total === 1 ? '' : 's'} adjusted.
            {draftSummary.dropped > 0 && ` ${draftSummary.dropped} dropped.`}
            {draftSummary.reduced > 0 && ` ${draftSummary.reduced} reduced.`}
            {draftSummary.raised  > 0 && ` ${draftSummary.raised} raised.`}
          </span>
        </>
      )}

      {draftSummary.allZeroed && (
        <>
          <br /><br />
          <span style={{ fontSize: 12.5, color: '#b91c1c', fontWeight: 700 }}>
            All lines are zeroed — this will auto-reject the slip.
          </span>
        </>
      )}
    </>
  ) : null;

  // ============================================================
  // Main render
  // ============================================================
  return (
    <div className="items-section">
      <style>{tabCss}</style>
      <style>{subSidebarFlagCss}</style>
      <style>{tsaIconCss}</style>
      <style>{tsaQtyCss}</style>

      <div className="section-header">
        <h3>
          <span className="tsa-section-heading">
            <FiCheckCircle />
            <span>Stock Transfer Approval</span>
          </span>
        </h3>
        <div className="header-actions">
          <span className="item-count">
            {pendingCount} pending · {historyCount} total
          </span>
          {!isPendingSegment && (
            <button
              type="button"
              className="export-btn"
              onClick={handleExport}
              disabled={exporting || history.total === 0}
              title="Download the currently-filtered slips as CSV"
            >
              {exporting ? 'Exporting…' : (
                <>
                  <span className="tsa-btn-icon"><FiDownload /></span>
                  Export CSV
                </>
              )}
            </button>
          )}
        </div>
      </div>

      <div className="tsa-layout">
        <aside className="tsa-subsidebar tsa-subsidebar--flag" aria-label="Queues">
          <div className="tsa-subsidebar-flag-head">
            <div className="tsa-subsidebar-flag-title">
              <span className="tsa-subsidebar-flag-dot" aria-hidden="true" />
              <span>Queues</span>
            </div>
            <p className="tsa-subsidebar-flag-subtitle">
              Switch between pending approvals and full history.
            </p>
          </div>

          <div className="tsa-subsidebar-group">
            <button
              type="button"
              className={`tsa-filter-item${isPendingSegment ? ' active' : ''}`}
              onClick={() => setSegment(SEGMENT_PENDING)}
            >
              <span className="tsa-filter-item-label">
                <FiClock />
                <span>Pending Approval</span>
              </span>
              <span className="tsa-filter-count">{pendingCount}</span>
            </button>
            <button
              type="button"
              className={`tsa-filter-item${!isPendingSegment ? ' active' : ''}`}
              onClick={() => setSegment(SEGMENT_HISTORY)}
            >
              <span className="tsa-filter-item-label">
                <FiList />
                <span>All Slips</span>
              </span>
              <span className="tsa-filter-count">{historyCount}</span>
            </button>
          </div>
        </aside>

        <div className="tsa-content">
          <div
            style={{
              background: '#eff6ff',
              border: '1px solid #bfdbfe',
              borderRadius: 8,
              padding: '10px 14px',
              marginBottom: 16,
              fontSize: 13,
              color: '#1e3a8a',
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
              lineHeight: 1.55,
            }}
          >
            <span className="tsa-info-icon" aria-hidden="true"><FiInfo /></span>
            <span>
              Transfer requests submitted by Stock Handlers appear in the{' '}
              <strong>Pending Approval</strong> queue. Approving issues the
              STS number and moves the request to the source warehouse&apos;s{' '}
              <strong>For Shipping</strong> queue. You can also adjust the
              approved qty per line — a reason is required for every changed
              line. Rejecting is terminal.
            </span>
          </div>

          <div className="dashboard-search-section">
            <div className="dashboard-filters">
              <div className="filter-row">
                <div className="filter-group search-group">
                  <label>Search</label>
                  <input
                    type="text"
                    className="filter-input"
                    placeholder="Search STS No., submitted by, warehouse…"
                    value={activeList.search}
                    onChange={(e) => activeList.setSearch(e.target.value)}
                  />
                </div>

                {!isPendingSegment && (
                  <div className="filter-group">
                    <label>Status</label>
                    <select
                      className="filter-input"
                      value={history.filters.status}
                      onChange={(e) => history.setFilter('status', e.target.value)}
                    >
                      {HISTORY_STATUS_FILTERS.map((s) => (
                        <option key={s} value={s}>
                          {s === 'All' ? 'All statuses' : s}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {!isPendingSegment && (
                  <div className="filter-group">
                    <label>Warehouse</label>
                    <select
                      className="filter-input"
                      value={history.filters.warehouse}
                      onChange={(e) => history.setFilter('warehouse', e.target.value)}
                    >
                      <option value="">All warehouses</option>
                      {warehouses.map((w) => (
                        <option key={w.warehouse_code} value={w.warehouse_code}>
                          {whPrimary(w.warehouse_name, w.warehouse_code)}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {!isPendingSegment && history.filters.warehouse && (
                  <div className="filter-group">
                    <label>Direction</label>
                    <select
                      className="filter-input"
                      value={history.filters.warehouseSide}
                      onChange={(e) => history.setFilter('warehouseSide', e.target.value)}
                    >
                      <option value="either">Either</option>
                      <option value="from">From (source)</option>
                      <option value="to">To (destination)</option>
                    </select>
                  </div>
                )}

                {!isPendingSegment && (
                  <div className="filter-group">
                    <label>Start Date</label>
                    <input
                      type="date"
                      className="filter-input"
                      value={history.filters.startDate}
                      onChange={(e) => history.setFilter('startDate', e.target.value)}
                    />
                  </div>
                )}

                {!isPendingSegment && (
                  <div className="filter-group">
                    <label>End Date</label>
                    <input
                      type="date"
                      className="filter-input"
                      value={history.filters.endDate}
                      onChange={(e) => history.setFilter('endDate', e.target.value)}
                    />
                  </div>
                )}

                <div className="filter-group action-group">
                  <button
                    className="cancel-btn"
                    onClick={clearFilters}
                    style={{ padding: '8px 16px' }}
                  >
                    Clear
                  </button>
                  <button
                    className="add-user-btn"
                    onClick={refreshCurrent}
                    style={{ padding: '8px 16px' }}
                  >
                    Refresh
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="daily-items-section">
            <div className="daily-items-header">
              <h4>
                {isPendingSegment
                  ? 'Requests Awaiting Your Approval'
                  : 'All Stock Transfer Slips'}
              </h4>
              <span className="daily-items-count">
                {rows.length} row{rows.length === 1 ? '' : 's'}
              </span>
            </div>

            <div className="po-desktop-only">{renderDesktopTable()}</div>
            <div className="po-mobile-only">{renderMobileCards()}</div>

            {activeList.total > 0 && (
              <div className="tsa-pagination">
                <div className="tsa-pagination-info">
                  Showing {activeList.showingStart}–{activeList.showingEnd} of {activeList.total}
                </div>
                <div className="tsa-pagination-controls">
                  <button
                    type="button"
                    className="tsa-page-btn"
                    onClick={activeList.prevPage}
                    disabled={loading || activeList.page <= 1}
                  >
                    ‹ Prev
                  </button>
                  <span className="tsa-page-indicator">
                    Page {activeList.page} of {activeList.totalPages}
                  </span>
                  <button
                    type="button"
                    className="tsa-page-btn"
                    onClick={activeList.nextPage}
                    disabled={loading || activeList.page >= activeList.totalPages}
                  >
                    Next ›
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <DetailModal
        detail={detail}
        images={images}
        onClose={closeDetail}
        onApprove={handleApproveClick}
        onReject={openReject}
        acting={acting || detailLoading}
        feedback={detailFeedback}
        onDismissFeedback={() => setDetailFeedback(null)}
        edits={edits}
        onQtyChange={handleQtyChange}
        onReasonChange={handleReasonChange}
        onResetEdits={handleResetEdits}
        summary={draftSummary}
      />

      <RejectModal
        open={showReject && !!detail}
        onClose={closeReject}
        onConfirm={handleRejectConfirm}
        transfer={detail}
        submitting={acting}
        feedback={rejectFeedback}
        onDismissFeedback={() => setRejectFeedback(null)}
      />

      <ConfirmModal
        isOpen={showApproveConfirm && !!detail}
        onConfirm={handleApproveConfirm}
        onCancel={handleApproveCancel}
        title="Approve this transfer?"
        message={approveConfirmMessage}
        confirmLabel="Yes, Approve"
        cancelLabel="Cancel"
        variant="primary"
        icon={<FiCheckCircle />}
        isLoading={acting}
      />
    </div>
  );
};

export default TabStockTransferApproval;