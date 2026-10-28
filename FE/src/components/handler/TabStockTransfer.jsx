// src/components/handler/TabStockTransfer.jsx
import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import {
  FiTruck,
  FiPackage,
  FiSend,
  FiList,
  FiPlus,
  FiDownload,
  FiInfo,
  FiFileText,
  FiMapPin,
  FiCheckCircle,
  FiAlertTriangle,
  FiRefreshCw,
  FiX,
  FiTarget,
  FiXCircle,
  FiSlash,
  FiInbox,
  FiHome,
  FiAward,
  FiCircle,
  FiClock,
  FiUser,
  FiActivity,
} from 'react-icons/fi';
import { usePermissions } from '../../permissions/usePermissions';
import { getUser } from '../../secure/auth';
import { useToast } from '../shared/ToastProvider';
import ModalBanner from '../shared/ModalBanner';
import ItemImageThumb from '../shared/ItemImageThumb';
import {
  warehouseApi,
  stockTransferApi,
  itemMasterApi,
  locatorsApi,
} from '../../services/api';
import { usePaginatedList } from '../../hooks/usePaginatedList';
import { useSessionState } from '../../hooks/useSessionState';

import {
  formatDate,
  formatDateTime,
  whPrimary,
  whSecondary,
  StatusBadge,
  HybridSelect,
  SkeletonTable,
  SkeletonCards,
  exportSTSCsv,
  buildStockTransferModalCss,
  buildStockTransferTabCss,
  MODAL_THEME_TEAL,
  TAB_THEME_HANDLER,
} from '../shared/stockTransfer';

import { eventLabel, stageMeta } from '../shared/activityStyles';

const modalCss = buildStockTransferModalCss(MODAL_THEME_TEAL);
const tabCss   = buildStockTransferTabCss(TAB_THEME_HANDLER);

// Session 13 (I4) — The STS No. placeholder used across this tab.
// Before approval, a slip has no STS No. — display "STS No. ?" so
// the internal sts_id (DRAFT-<id>) is never leaked to the user.
const STS_NO_PLACEHOLDER = 'STS No. ?';

const iconCss = `
.tsc-btn-icon {
  width: 1em; height: 1em; flex-shrink: 0;
  stroke-width: 2.4;
}
.tsc-inline-icon {
  width: 1em; height: 1em; flex-shrink: 0;
  stroke-width: 2.4;
  vertical-align: -0.12em;
}
.tsc-section-heading-icon {
  display: inline-flex; align-items: center; justify-content: center;
  width: 1em; height: 1em; margin-right: 8px; vertical-align: -0.15em;
  color: #1a1f26;
}
.tsc-section-heading-icon svg { width: 100%; height: 100%; stroke-width: 2.2; }
.tsm-header-icon svg {
  width: 22px; height: 22px;
  stroke-width: 2.2;
  color: #ffffff;
}
.tsm-close svg {
  width: 18px; height: 18px;
  stroke-width: 2.4;
}
.tsm-note-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.tsm-note-icon svg {
  width: 16px; height: 16px;
  stroke-width: 2.4;
  color: #475569;
}
.tsm-section-title {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.tsm-section-title svg {
  width: 16px; height: 16px;
  stroke-width: 2.2;
  color: #334155;
}
.tsm-rejection-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.tsm-rejection-icon svg {
  width: 16px; height: 16px;
  stroke-width: 2.4;
  color: #dc2626;
}
.tsm-locator-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.tsm-locator-chip-label {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.tsm-locator-chip-label svg {
  width: 1em; height: 1em;
  stroke-width: 2.4;
}
.tsm-locator-chip--source .tsm-locator-chip-label svg { color: #b45309; }
.tsm-locator-chip--target .tsm-locator-chip-label svg { color: #0f766e; }
.tsm-success-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.tsm-success-icon svg {
  width: 56px; height: 56px;
  stroke-width: 1.8;
  color: #059669;
}
.tsc-banner-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 18px; height: 18px;
}
.tsc-banner-icon svg {
  width: 100%; height: 100%;
  stroke-width: 2.2;
}
.tsc-banner-icon--info    { color: #1e3a8a; }
.tsc-banner-icon--store   { color: #0e7490; }
.tsc-banner-icon--release { color: #9a3412; }
.tsc-filter-item > span:first-child {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.tsc-filter-item > span:first-child svg {
  width: 15px; height: 15px;
  stroke-width: 2.2;
  flex-shrink: 0;
  color: #64748b;
  transition: color 0.15s ease;
}
.tsc-subsidebar.tsc-subsidebar--flag .tsc-filter-item:hover > span:first-child svg {
  color: #0f766e;
}
.tsc-subsidebar.tsc-subsidebar--flag .tsc-filter-item.active > span:first-child svg {
  color: #0f766e;
}
.save-btn,
.action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}
.save-btn svg,
.action-btn svg {
  width: 1em; height: 1em;
  stroke-width: 2.4;
  flex-shrink: 0;
}
.tsm-locator-chip .tsc-inline-icon {
  width: 1em; height: 1em;
}
@media (prefers-reduced-motion: reduce) {
  .tsc-filter-item > span:first-child svg { transition: none !important; }
}
`;

const subSidebarFlagCss = `
.tsc-subsidebar.tsc-subsidebar--flag {
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
.tsc-subsidebar.tsc-subsidebar--flag::before {
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
.tsc-subsidebar-flag-head {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-bottom: 12px;
  border-bottom: 1px solid #ccfbf1;
  margin-bottom: 12px;
}
.tsc-subsidebar-flag-title {
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
.tsc-subsidebar-flag-dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #00b8b0;
  flex-shrink: 0;
  animation: tsc-subsidebar-pulse 2.4s ease-in-out infinite;
}
@keyframes tsc-subsidebar-pulse {
  0%, 100% { box-shadow: 0 0 0 3px rgba(0, 184, 176, 0.22); }
  50%      { box-shadow: 0 0 0 8px rgba(0, 184, 176, 0.05); }
}
.tsc-subsidebar-flag-subtitle {
  margin: 0;
  font-size: 11px;
  color: #64748b;
  line-height: 1.4;
  font-weight: 500;
}
.tsc-subsidebar.tsc-subsidebar--flag .tsc-subsidebar-group {
  padding: 0;
  border-bottom: none;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.tsc-subsidebar.tsc-subsidebar--flag .tsc-subsidebar-group > .tsc-subsidebar-label {
  display: none;
}
.tsc-subsidebar.tsc-subsidebar--flag .tsc-filter-item {
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
.tsc-subsidebar.tsc-subsidebar--flag .tsc-filter-item:hover {
  background: rgba(0, 184, 176, 0.07);
  color: #0f172a;
}
.tsc-subsidebar.tsc-subsidebar--flag .tsc-filter-item:focus-visible {
  outline: 2px solid #00b8b0;
  outline-offset: 2px;
}
.tsc-subsidebar.tsc-subsidebar--flag .tsc-filter-item.active {
  background: rgba(0, 184, 176, 0.12);
  color: #0f766e;
}
.tsc-subsidebar.tsc-subsidebar--flag .tsc-filter-item::before {
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
.tsc-subsidebar.tsc-subsidebar--flag .tsc-filter-item:hover::before {
  height: 55%;
  background: #00b8b0;
}
.tsc-subsidebar.tsc-subsidebar--flag .tsc-filter-item.active::before {
  height: 68%;
  background: #0f766e;
}
.tsc-subsidebar.tsc-subsidebar--flag .tsc-filter-count {
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
.tsc-subsidebar.tsc-subsidebar--flag .tsc-filter-item:hover .tsc-filter-count {
  background: #d7ecf3;
  color: #334155;
}
.tsc-subsidebar.tsc-subsidebar--flag .tsc-filter-item.active .tsc-filter-count {
  background: #0f766e;
  color: #ffffff;
}
@media (max-width: 900px) {
  .tsc-subsidebar.tsc-subsidebar--flag {
    padding: 12px 14px 12px 20px;
  }
  .tsc-subsidebar.tsc-subsidebar--flag::before {
    top: 10px;
    bottom: 10px;
  }
  .tsc-subsidebar-flag-head {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    padding-bottom: 8px;
    margin-bottom: 8px;
  }
  .tsc-subsidebar-flag-subtitle {
    text-align: right;
    font-size: 10.5px;
    color: #94a3b8;
  }
  .tsc-subsidebar.tsc-subsidebar--flag .tsc-subsidebar-group {
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
  .tsc-subsidebar.tsc-subsidebar--flag .tsc-filter-item {
    flex: 0 0 auto;
    min-width: 170px;
    padding: 9px 12px;
    border: 1px solid #b8f1ea;
    border-radius: 10px;
    background: #ffffff;
  }
  .tsc-subsidebar.tsc-subsidebar--flag .tsc-filter-item:hover {
    background: #f0fdfa;
    border-color: #5eead4;
  }
  .tsc-subsidebar.tsc-subsidebar--flag .tsc-filter-item.active {
    background: #f0fdfa;
    border-color: #0f766e;
  }
  .tsc-subsidebar.tsc-subsidebar--flag .tsc-filter-item::before {
    display: none;
  }
}
@media (max-width: 480px) {
  .tsc-subsidebar-flag-subtitle { display: none; }
  .tsc-subsidebar.tsc-subsidebar--flag .tsc-filter-item {
    min-width: 150px;
    font-size: 12px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .tsc-subsidebar-flag-dot { animation: none !important; box-shadow: 0 0 0 3px rgba(0, 184, 176, 0.22); }
  .tsc-subsidebar.tsc-subsidebar--flag .tsc-filter-item,
  .tsc-subsidebar.tsc-subsidebar--flag .tsc-filter-item::before,
  .tsc-subsidebar.tsc-subsidebar--flag .tsc-filter-count {
    transition: none !important;
  }
}
`;

const stsTimelineCss = `
.sts-tl-state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 18px 16px;
  background: #f8fafc;
  border: 1px dashed #e2e8f0;
  border-radius: 10px;
  font-size: 12.5px;
  color: #64748b;
}
.sts-tl-state-icon {
  width: 16px;
  height: 16px;
  stroke-width: 2.2;
  flex-shrink: 0;
}
.sts-tl-state-icon--spin { animation: stsTlSpin 0.9s linear infinite; }
@keyframes stsTlSpin { to { transform: rotate(360deg); } }
.sts-tl-wrap {
  display: flex;
  flex-direction: column;
  padding: 4px 0;
}
.sts-tl-item {
  display: flex;
  gap: 14px;
  align-items: flex-start;
}
.sts-tl-rail {
  display: flex;
  flex-direction: column;
  align-items: center;
  flex-shrink: 0;
  width: 32px;
}
.sts-tl-dot {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #ffffff;
  flex-shrink: 0;
}
.sts-tl-icon {
  width: 14px;
  height: 14px;
  stroke-width: 2.4;
}
.sts-tl-line {
  width: 2px;
  flex: 1;
  min-height: 24px;
  background: #e2e8f0;
  margin: 2px 0;
}
.sts-tl-body {
  flex: 1;
  padding-bottom: 14px;
  min-width: 0;
}
.sts-tl-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 5px;
}
.sts-tl-title {
  font-size: 13px;
  font-weight: 700;
  color: #0f172a;
  line-height: 1.35;
  word-break: break-word;
}
.sts-tl-time {
  font-size: 10.5px;
  color: #94a3b8;
  font-weight: 600;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  flex-shrink: 0;
}
.sts-tl-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  align-items: center;
}
.sts-tl-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.02em;
  border: 1px solid transparent;
  white-space: nowrap;
  max-width: 100%;
}
.sts-tl-chip svg {
  width: 11px;
  height: 11px;
  stroke-width: 2.4;
  flex-shrink: 0;
}
.sts-tl-chip > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 180px;
}
.sts-tl-chip--item {
  background: #eef2ff;
  color: #4338ca;
  border-color: #c7d2fe;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
}
.sts-tl-chip--locator {
  background: #f0fdfa;
  color: #0f766e;
  border-color: #99f6e4;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
}
.sts-tl-chip--actor {
  background: #ffffff;
  color: #475569;
  border-color: #e2e8f0;
}
.sts-tl-qty {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 9px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 800;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  letter-spacing: 0.02em;
  white-space: nowrap;
}
.sts-tl-qty.is-pos {
  background: #dcfce7;
  color: #065f46;
  border: 1px solid #86efac;
}
.sts-tl-qty.is-neg {
  background: #fee2e2;
  color: #991b1b;
  border: 1px solid #fca5a5;
}
.sts-tl-qty-arrow {
  opacity: 0.7;
  font-weight: 600;
}
.sts-tl-detail {
  margin-top: 5px;
  font-size: 11.5px;
  color: #64748b;
  font-style: italic;
  line-height: 1.55;
  word-break: break-word;
}
@media (max-width: 640px) {
  .sts-tl-item { gap: 10px; }
  .sts-tl-rail { width: 26px; }
  .sts-tl-dot { width: 24px; height: 24px; }
  .sts-tl-icon { width: 12px; height: 12px; }
  .sts-tl-title { font-size: 12.5px; }
  .sts-tl-time { font-size: 10px; }
  .sts-tl-chip { font-size: 10px; padding: 2px 6px; }
  .sts-tl-chip > span { max-width: 120px; }
  .sts-tl-qty { font-size: 10px; padding: 2px 7px; }
  .sts-tl-detail { font-size: 11px; }
}
@media (max-width: 380px) {
  .sts-tl-head {
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
  }
  .sts-tl-chip { font-size: 9.5px; padding: 2px 6px; }
  .sts-tl-chip svg { width: 10px; height: 10px; }
  .sts-tl-chip > span { max-width: 90px; }
  .sts-tl-qty { font-size: 9.5px; padding: 2px 6px; }
}
@media (min-width: 1921px) {
  .sts-tl-rail { width: 36px; }
  .sts-tl-dot { width: 32px; height: 32px; }
  .sts-tl-icon { width: 16px; height: 16px; }
  .sts-tl-title { font-size: 14px; }
  .sts-tl-time { font-size: 11.5px; }
  .sts-tl-chip { font-size: 11.5px; padding: 3px 10px; }
  .sts-tl-chip svg { width: 12px; height: 12px; }
  .sts-tl-chip > span { max-width: 220px; }
  .sts-tl-qty { font-size: 12px; padding: 3px 10px; }
  .sts-tl-detail { font-size: 12.5px; }
}
@media (prefers-reduced-motion: reduce) {
  .sts-tl-state-icon--spin { animation: none !important; }
}
`;

// ============================================================
// Session 9 F7 — table-fit CSS.
//
// Fixes the F6 overlap between the Status column and the
// Actions column:
//   • Every cell clips its overflow → nothing bleeds into the
//     neighbor cell.
//   • Column widths re-balanced — Status gets 13%, Actions 14%.
//   • Action button uses a compact label ("Transfer"), a tight
//     padding, and min-width: 0 so it shrinks into its column
//     instead of pushing outward.
// ============================================================
const tscTableFitCss = `
/* ---------- Base: fill the container, no forced min-width ---------- */
.items-section .tsc-table {
  table-layout: fixed;
  width: 100%;
  min-width: 0;
}

.items-section .tsc-table thead th,
.items-section .tsc-table tbody td {
  padding: 12px 10px;
  vertical-align: middle;
  box-sizing: border-box;
}

/* ---------- Cell-level overflow clipping ----------
   Stops the Status pill from spilling into the Actions cell
   (and vice versa) when the viewport is tight. */
.items-section .tsc-table thead th,
.items-section .tsc-table tbody td {
  overflow: hidden;
}

/* ---------- Column proportions (>= 1400px viewport) ---------- */
.items-section .tsc-table .col-item    { width: 20%; }
.items-section .tsc-table .col-sts     { width: 12%; }
.items-section .tsc-table .col-wh      { width: 14%; }
.items-section .tsc-table .col-by      { width: 10%; }
.items-section .tsc-table .col-date    { width:  9%; }
.items-section .tsc-table .col-qty     { width:  8%; text-align: center; }
.items-section .tsc-table .col-status  { width: 13%; }
.items-section .tsc-table .col-actions { width: 14%; text-align: right; padding-right: 12px; }

/* ---------- Text cells truncate cleanly ---------- */
.items-section .tsc-table .tsc-item-code,
.items-section .tsc-table .tsc-item-name,
.items-section .tsc-table .tsc-wh-name,
.items-section .tsc-table .tsc-wh-code,
.items-section .tsc-table .col-by,
.items-section .tsc-table .col-date {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ---------- Status cell: pill stays inside ---------- */
.items-section .tsc-table .col-status > span {
  max-width: 100%;
  box-sizing: border-box;
}

/* ---------- Action button: compact, never overflows its column ---------- */
.items-section .tsc-table .col-actions .action-btn,
.items-section .tsc-table .col-actions .po-view-hint {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 12px;
  font-size: 12.5px;
  font-weight: 700;
  white-space: nowrap;
  max-width: 100%;
  min-width: 0;
  box-sizing: border-box;
  overflow: hidden;
  text-overflow: ellipsis;
}

.items-section .tsc-table .col-actions .action-btn > span,
.items-section .tsc-table .col-actions .po-view-hint > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

/* ---------- 1200–1400px: tighten the button ---------- */
@media (max-width: 1400px) {
  .items-section .tsc-table .col-actions .action-btn,
  .items-section .tsc-table .col-actions .po-view-hint {
    padding: 7px 10px;
    font-size: 12px;
  }
}

/* ---------- 900–1200px: shrink header / cell text ---------- */
@media (max-width: 1200px) {
  .items-section .tsc-table thead th {
    padding: 10px 8px;
    font-size: 11px;
  }
  .items-section .tsc-table tbody td {
    padding: 10px 8px;
    font-size: 12.5px;
  }
}

/* ---------- 1000–1100px: icon-only action button ---------- */
@media (max-width: 1100px) {
  .items-section .tsc-table .col-actions .action-btn > span,
  .items-section .tsc-table .col-actions .po-view-hint > span {
    display: none;
  }
  .items-section .tsc-table .col-actions .action-btn,
  .items-section .tsc-table .col-actions .po-view-hint {
    padding: 8px 10px;
    min-width: 36px;
    gap: 0;
  }
  .items-section .tsc-table .col-actions .action-btn svg,
  .items-section .tsc-table .col-actions .po-view-hint svg {
    margin: 0;
  }
}

/* ---------- Below 900px: drop Submitted By, rebalance ---------- */
@media (max-width: 900px) {
  .items-section .tsc-table .col-by {
    display: none;
  }
  .items-section .tsc-table .col-item    { width: 24%; }
  .items-section .tsc-table .col-sts     { width: 13%; }
  .items-section .tsc-table .col-wh      { width: 16%; }
  .items-section .tsc-table .col-date    { width: 10%; }
  .items-section .tsc-table .col-qty     { width:  8%; }
  .items-section .tsc-table .col-status  { width: 14%; }
  .items-section .tsc-table .col-actions { width: 15%; }
}

/* ---------- Very small desktop / landscape phone ---------- */
@media (max-width: 720px) {
  .items-section .tsc-table thead th,
  .items-section .tsc-table tbody td {
    padding: 8px 6px;
    font-size: 11.5px;
  }
  .items-section .tsc-table .col-wh {
    display: none;
  }
  .items-section .tsc-table .col-item    { width: 30%; }
  .items-section .tsc-table .col-sts     { width: 15%; }
  .items-section .tsc-table .col-date    { width: 12%; }
  .items-section .tsc-table .col-qty     { width: 10%; }
  .items-section .tsc-table .col-status  { width: 16%; }
  .items-section .tsc-table .col-actions { width: 17%; }
}

/* ---------- Ultrawide ---------- */
@media (min-width: 1921px) {
  .items-section .tsc-table thead th {
    padding: 14px 14px;
    font-size: 12.5px;
  }
  .items-section .tsc-table tbody td {
    padding: 14px 14px;
    font-size: 14px;
  }
  .items-section .tsc-table .col-actions .action-btn,
  .items-section .tsc-table .col-actions .po-view-hint {
    padding: 9px 16px;
    font-size: 13.5px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .items-section .tsc-table .col-actions .action-btn,
  .items-section .tsc-table .col-actions .po-view-hint {
    transition: none !important;
  }
}
`;

const notifyStsChanged = () => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('sts:changed'));
  }
};

const SEGMENT_FOR_TRANSFER = 'for-shipping';
const SEGMENT_MY_REQUESTS  = 'my-requests';

const ITEM_SEARCH_DEBOUNCE_MS = 300;
const ITEM_SEARCH_LIMIT       = 25;

const SEARCH_DEBOUNCE_MS = 300;
const PAGE_SIZE          = 50;

const STORAGE_KEYS = Object.freeze({
  segment:  'sts:handler:segment',
  transfer: 'sts:handler:ship',
  mine:     'sts:handler:mine',
});

const TRANSFER_INITIAL_FILTERS = Object.freeze({
  startDate: '',
  endDate:   '',
});

const MINE_INITIAL_FILTERS = Object.freeze({
  status:    'All',
  startDate: '',
  endDate:   '',
});

const stsEventIcon = (type) => {
  switch (type) {
    case 'REQUEST_SUBMITTED': return FiPackage;
    case 'QTY_ADJUSTED':      return FiTarget;
    case 'APPROVED':          return FiCheckCircle;
    case 'REJECTED':          return FiXCircle;
    case 'CANCELLED':         return FiSlash;
    case 'SHIPPED':           return FiTruck;
    case 'TRANSFERRED':       return FiTruck;
    case 'ARRIVED':           return FiInbox;
    case 'RECEIVED':          return FiInbox;
    case 'STORE_LINE':        return FiHome;
    case 'COMPLETED':         return FiAward;
    default:                  return FiCircle;
  }
};

const StsActivityTimeline = ({ events, loading }) => {
  if (loading) {
    return (
      <div className="sts-tl-state">
        <FiRefreshCw className="sts-tl-state-icon sts-tl-state-icon--spin" />
        <span>Loading activity…</span>
      </div>
    );
  }

  if (!Array.isArray(events) || events.length === 0) {
    return (
      <div className="sts-tl-state">
        <FiActivity className="sts-tl-state-icon" />
        <span>No activity recorded yet for this slip.</span>
      </div>
    );
  }

  return (
    <div className="sts-tl-wrap">
      {events.map((evt, idx) => {
        const isLast = idx === events.length - 1;
        const stage  = stageMeta(evt.stage);
        const Icon   = stsEventIcon(evt.event_type);

        const change = evt.qty_change != null ? Number(evt.qty_change) : null;
        const hasChange = Number.isFinite(change) && change !== 0;
        const hasPrevNext = evt.qty_before != null && evt.qty_after != null;
        const isNeg = hasChange && change < 0;

        const displayPrev = evt.qty_before != null ? Number(evt.qty_before) : null;
        const displayNext = evt.qty_after  != null ? Number(evt.qty_after)  : null;

        return (
          <div key={evt.log_id} className="sts-tl-item">
            <div className="sts-tl-rail">
              <div
                className="sts-tl-dot"
                style={{ background: stage.dot, boxShadow: `0 0 0 3px ${stage.bg}` }}
              >
                <Icon className="sts-tl-icon" />
              </div>
              {!isLast && <div className="sts-tl-line" />}
            </div>

            <div className="sts-tl-body">
              <div className="sts-tl-head">
                <span className="sts-tl-title">{eventLabel(evt.event_type)}</span>
                <span
                  className="sts-tl-time"
                  title={evt.acted_at ? new Date(evt.acted_at).toLocaleString() : ''}
                >
                  {formatDateTime(evt.acted_at)}
                </span>
              </div>

              <div className="sts-tl-chips">
                {evt.stage && (
                  <span
                    className="sts-tl-chip"
                    style={{
                      background:  stage.bg,
                      color:       stage.fg,
                      borderColor: stage.border,
                    }}
                  >
                    {stage.label}
                  </span>
                )}

                {evt.item_code && (
                  <span
                    className="sts-tl-chip sts-tl-chip--item"
                    title={evt.item_name || evt.item_code}
                  >
                    <FiPackage />
                    <span>{evt.item_code}</span>
                  </span>
                )}

                {evt.locator_code && (
                  <span className="sts-tl-chip sts-tl-chip--locator">
                    <FiMapPin />
                    <span>{evt.locator_code}</span>
                  </span>
                )}

                {hasPrevNext && displayPrev !== displayNext && (
                  <span className={`sts-tl-qty ${isNeg ? 'is-neg' : 'is-pos'}`}>
                    <span>{displayPrev}</span>
                    <span className="sts-tl-qty-arrow">→</span>
                    <span>{displayNext}</span>
                    {hasChange && (
                      <span style={{ marginLeft: 4 }}>
                        ({change > 0 ? '+' : ''}{change})
                      </span>
                    )}
                  </span>
                )}

                {!hasPrevNext && hasChange && (
                  <span className={`sts-tl-qty ${isNeg ? 'is-neg' : 'is-pos'}`}>
                    {change > 0 ? `+${change}` : change}
                  </span>
                )}

                {evt.actor && (
                  <span
                    className="sts-tl-chip sts-tl-chip--actor"
                    title={evt.actor_role || ''}
                  >
                    <FiUser />
                    <span>{evt.actor}</span>
                  </span>
                )}
              </div>

              {evt.remarks && (
                <div className="sts-tl-detail">{evt.remarks}</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

const RequestTransferModal = ({
  open, onClose, onSubmitted,
  myWarehouse, allWarehouses, myLocators, prefill,
}) => {
  const [sourceWarehouse, setSourceWarehouse] = useState(null);
  const [item, setItem]                       = useState(null);
  const [uom, setUom]                         = useState('');
  const [qty, setQty]                         = useState('');
  const [targetLocator, setTargetLocator]     = useState('');
  const [remarks, setRemarks]                 = useState('');
  const [submitting, setSubmitting]           = useState(false);
  const [submitted, setSubmitted]             = useState(null);
  const [feedback, setFeedback]               = useState(null);
  const [itemQuery, setItemQuery]             = useState('');
  const [itemResults, setItemResults]         = useState([]);
  const [itemLoading, setItemLoading]         = useState(false);
  const debounceRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    if (prefill) {
      setSourceWarehouse(prefill.sourceWarehouse || null);
      setItem(prefill.item || null);
      setUom(prefill.uom || '');
      setQty(prefill.qty != null ? String(prefill.qty) : '');
      setTargetLocator(prefill.targetLocator || '');
      setRemarks(prefill.remarks || '');
      setItemResults(prefill.item ? [prefill.item] : []);
      setItemQuery(prefill.item?.value || '');
    } else {
      setSourceWarehouse(null);
      setItem(null);
      setUom('');
      setQty('');
      setTargetLocator('');
      setRemarks('');
      setItemResults([]);
      setItemQuery('');
    }
    setFeedback(null);
    setSubmitted(null);
  }, [open, prefill]);

  const warehouseOptions = useMemo(() => {
    if (!Array.isArray(allWarehouses)) return [];
    return allWarehouses
      .filter((w) => w.status === 'Active')
      .filter((w) => !myWarehouse?.warehouse_id || Number(w.warehouse_id) !== Number(myWarehouse.warehouse_id))
      .map((w) => ({
        value: w.warehouse_code,
        label: w.warehouse_name || '',
      }));
  }, [allWarehouses, myWarehouse]);

  const locatorOptions = useMemo(() => {
    if (!Array.isArray(myLocators)) return [];
    return myLocators
      .filter((l) => l.status === 'Active' && (l.locator_type || 'Regular') !== 'Damage')
      .map((l) => ({
        value: l.locator_code,
        label: l.locator_name || l.description || '',
      }));
  }, [myLocators]);

  useEffect(() => {
    if (!open) return undefined;
    if (item) return undefined;

    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = itemQuery.trim();

    debounceRef.current = setTimeout(async () => {
      setItemLoading(true);
      try {
        const res = await itemMasterApi.getAllItemMasters({
          page: 1,
          limit: ITEM_SEARCH_LIMIT,
          search: q,
        });
        if (res.ok && res.data) {
          const list = res.data.data || [];
          setItemResults(
            list.map((im) => ({
              value: im.Item_Code,
              label: im.Item_Description || '',
              sub:   im.Uom_Code || '',
              uom:   im.Uom_Code || '',
            }))
          );
        } else {
          setItemResults([]);
        }
      } catch {
        setItemResults([]);
      } finally {
        setItemLoading(false);
      }
    }, ITEM_SEARCH_DEBOUNCE_MS);

    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [open, itemQuery, item]);

  useEffect(() => { if (item?.uom) setUom(item.uom); }, [item]);

  const submit = async () => {
    setFeedback(null);

    if (!myWarehouse?.warehouse_code) {
      setFeedback({ type: 'error', title: 'Warehouse missing', message: 'Your assigned warehouse could not be resolved.' });
      return;
    }
    if (!sourceWarehouse) {
      setFeedback({ type: 'warning', title: 'Source required', message: 'Choose the warehouse to request from.' });
      return;
    }
    if (!item) {
      setFeedback({ type: 'warning', title: 'Item required', message: 'Choose an item.' });
      return;
    }
    const q = Number(qty);
    if (!Number.isInteger(q) || q <= 0) {
      setFeedback({ type: 'warning', title: 'Invalid quantity', message: 'Quantity must be a positive integer.' });
      return;
    }
    if (!targetLocator) {
      setFeedback({ type: 'warning', title: 'Locator required', message: 'Choose the target locator for the incoming stock.' });
      return;
    }

    setSubmitting(true);
    try {
      const res = await stockTransferApi.createRequest({
        from_warehouse_code: sourceWarehouse.value,
        to_warehouse_code:   myWarehouse.warehouse_code,
        item_code:           item.value,
        item_name:           item.label || null,
        uom:                 uom || item.uom || null,
        qty:                 q,
        target_locator_code: targetLocator,
        remarks:             remarks.trim() || null,
        
      });

      if (res.ok && res.data?.success !== false) {
        setSubmitted(res.data?.data || {});
        onSubmitted?.();
      } else {
        setFeedback({
          type: 'error',
          title: 'Submission failed',
          message: res.data?.message || 'Failed to submit request.',
        });
      }
    } catch (err) {
      console.error(err);
      setFeedback({
        type: 'error',
        title: 'Submission failed',
        message: 'Error connecting to server.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  const targetLocatorLabel = locatorOptions.find((l) => l.value === targetLocator)?.label || '';

  return (
    <>
      <style>{modalCss}</style>
      <style>{iconCss}</style>
      <div className="tsm-overlay" onClick={submitting ? undefined : onClose}>
        <div className="tsm-card" onClick={(e) => e.stopPropagation()}>
          <div className="tsm-header">
            <div className="tsm-header-left">
              <div className="tsm-header-icon"><FiSend /></div>
              <div className="tsm-header-info">
                <h3 className="tsm-header-title">
                  {submitted ? 'Request Submitted' : 'New Transfer Request'}
                </h3>
                <div className="tsm-header-sub">
                  <span>{myWarehouse?.warehouse_name || '—'}</span>
                  {myWarehouse?.warehouse_code && (
                    <>
                      <span className="tsm-header-dot">·</span>
                      <span className="tsm-header-pono">{myWarehouse.warehouse_code}</span>
                    </>
                  )}
                </div>
              </div>
            </div>
            <button type="button" className="tsm-close" onClick={onClose} disabled={submitting} aria-label="Close">
              <FiX />
            </button>
          </div>

          <div className="tsm-body">
            {feedback && (
              <ModalBanner
                type={feedback.type}
                title={feedback.title}
                message={feedback.message}
                onClose={() => setFeedback(null)}
              />
            )}

            {submitted ? (
              <div className="tsm-success-wrap">
                <div className="tsm-success-icon"><FiCheckCircle /></div>
                <h2 className="tsm-success-title">Transfer Request Submitted</h2>
                <p className="tsm-success-subtitle">
                  Your request has been sent to the Department Head for approval.
                  Once approved, it will appear in the source warehouse's
                  <strong> For Transfer </strong> queue. You'll then track it here
                  in <strong>My Requests</strong> through transfer and receipt.
                </p>
                <div className="tsm-success-card">
                  <div className="tsm-success-row">
                    <span className="tsm-success-label">Requesting</span>
                    <span className="tsm-success-value-small">
                      {myWarehouse?.warehouse_name || '—'}
                      {myWarehouse?.warehouse_code ? ` · ${myWarehouse.warehouse_code}` : ''}
                    </span>
                  </div>
                  <div className="tsm-success-row">
                    <span className="tsm-success-label">Source</span>
                    <span className="tsm-success-value-small">
                      {sourceWarehouse?.label || sourceWarehouse?.value || '—'}
                      {sourceWarehouse?.label && sourceWarehouse?.value ? ` · ${sourceWarehouse.value}` : ''}
                    </span>
                  </div>
                  <div className="tsm-success-row">
                    <span className="tsm-success-label">Item</span>
                    <span className="tsm-success-value-small">{item?.value} · {qty} {uom}</span>
                  </div>
                  <div className="tsm-success-row">
                    <span className="tsm-success-label">Locator</span>
                    <span className="tsm-success-value-small">
                      {targetLocator}{targetLocatorLabel ? ` — ${targetLocatorLabel}` : ''}
                    </span>
                  </div>
                  <div className="tsm-success-row">
                    <span className="tsm-success-label">Status</span>
                    <span className="tsm-success-badge">PENDING</span>
                  </div>
                </div>
              </div>
            ) : (
              <>
                <div className="tsm-field-block">
                  <label className="tsm-field-label">
                    Requesting Warehouse
                    <span className="tsm-pill tsm-pill--auto">auto</span>
                  </label>
                  <input
                    type="text"
                    value={
                      myWarehouse
                        ? `${myWarehouse.warehouse_name || ''}${myWarehouse.warehouse_code ? ` · ${myWarehouse.warehouse_code}` : ''}`.trim()
                        : 'Not assigned'
                    }
                    readOnly
                    disabled
                    className="tsm-readonly-input"
                  />
                  <small className="tsm-helper-text">This is your assigned warehouse.</small>
                </div>

                <div className="tsm-field-block">
                  <label className="tsm-field-label">
                    Warehouse to Request From <span className="tsm-required">*</span>
                  </label>
                  <HybridSelect
                    value={sourceWarehouse?.value || ''}
                    displayText={sourceWarehouse?.label || ''}
                    onChange={setSourceWarehouse}
                    items={warehouseOptions}
                    placeholder="Type to search warehouses…"
                    emptyLabel="No matching warehouse"
                    disabled={submitting}
                    primaryField="label"
                  />
                  <small className="tsm-helper-text">Where the stock will come from.</small>
                </div>

                <div className="tsm-field-block">
                  <label className="tsm-field-label">
                    Item Code <span className="tsm-required">*</span>
                  </label>
                  <HybridSelect
                    value={item?.value || ''}
                    onChange={setItem}
                    items={itemResults}
                    loading={itemLoading}
                    onQueryChange={setItemQuery}
                    placeholder="Search item code or description…"
                    emptyLabel="No items found"
                    disabled={submitting}
                  />
                  {item?.label && <small className="tsm-helper-text">{item.label}</small>}
                </div>

                <div className="tsm-head-grid">
                  <div className="tsm-field-block">
                    <label className="tsm-field-label">
                      UOM
                      <span className="tsm-pill tsm-pill--auto">auto</span>
                    </label>
                    <input
                      type="text"
                      value={uom || ''}
                      readOnly
                      disabled
                      className={`tsm-readonly-input ${!uom ? 'tsm-readonly-input--placeholder' : ''}`}
                      placeholder="Auto-filled from item"
                    />
                  </div>
                  <div className="tsm-field-block">
                    <label className="tsm-field-label" htmlFor="tsm-qty">
                      Quantity <span className="tsm-required">*</span>
                    </label>
                    <input
                      id="tsm-qty"
                      type="number"
                      min={1}
                      step={1}
                      inputMode="numeric"
                      className="tsm-input"
                      value={qty}
                      onChange={(e) => setQty(e.target.value.replace(/[^\d]/g, ''))}
                      placeholder="e.g. 5"
                      disabled={submitting}
                    />
                  </div>
                </div>

                <div className="tsm-field-block">
                  <label className="tsm-field-label" htmlFor="tsm-loc">
                    Target Locator <span className="tsm-required">*</span>
                  </label>
                  <select
                    id="tsm-loc"
                    className="tsm-input"
                    value={targetLocator}
                    onChange={(e) => setTargetLocator(e.target.value)}
                    disabled={submitting || locatorOptions.length === 0}
                  >
                    <option value="">— Select a locator in your warehouse —</option>
                    {locatorOptions.map((l) => (
                      <option key={l.value} value={l.value}>
                        {l.value}{l.label ? ` — ${l.label}` : ''}
                      </option>
                    ))}
                  </select>
                  <small className="tsm-helper-text">
                    Received good units will be stored directly in this locator.
                  </small>
                  {locatorOptions.length === 0 && (
                    <small className="tsm-helper-text tsm-helper-text--error">
                      Your warehouse has no active Regular locators. Add one in the Inventory Locator tab first.
                    </small>
                  )}
                </div>

                <div className="tsm-field-block">
                  <label className="tsm-field-label" htmlFor="tsm-remarks">
                    Remarks <span className="tsm-pill tsm-pill--optional">optional</span>
                  </label>
                  <textarea
                    id="tsm-remarks"
                    className="tsm-textarea"
                    rows={3}
                    value={remarks}
                    onChange={(e) => setRemarks(e.target.value)}
                    placeholder="Add any notes for the Department Head…"
                    disabled={submitting}
                  />
                </div>

                <div className="tsm-note-block">
                  <span className="tsm-note-icon"><FiInfo /></span>
                  <span>
                    Once approved, an <strong>STS number</strong> is issued and the request
                    appears in the source warehouse's <strong>For Transfer</strong> queue.
                    The source handler will then <em>transfer</em> the stock, and it becomes{' '}
                    <strong>In-Transit</strong>. You'll see it here in My Requests and can{' '}
                    <strong>Receive</strong> it as soon as it arrives.
                  </span>
                </div>
              </>
            )}
          </div>

          <div className="tsm-footer">
            {submitted ? (
              <button type="button" className="save-btn" onClick={onClose}>Close</button>
            ) : (
              <>
                <button type="button" className="cancel-btn" onClick={onClose} disabled={submitting}>Cancel</button>
                <button
                  type="button"
                  className="save-btn"
                  onClick={submit}
                  disabled={submitting || locatorOptions.length === 0}
                >
                  {submitting ? (
                    'Submitting…'
                  ) : (
                    <>
                      <FiCheckCircle className="tsc-btn-icon" />
                      <span>Submit Request</span>
                    </>
                  )}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

const TransferModal = ({ open, onClose, onConfirm, transfer, submitting }) => {
  const [remarks, setRemarks]               = useState('');
  const [sourceLocator, setSourceLocator]   = useState('');
  const [locators, setLocators]             = useState([]);
  const [locatorsLoading, setLocatorsLoading] = useState(false);
  const [filtered, setFiltered]             = useState(false);
  const [feedback, setFeedback]             = useState(null);

  useEffect(() => {
    if (open) {
      setRemarks('');
      setSourceLocator('');
      setFeedback(null);
      setLocators([]);
      setFiltered(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open || !transfer?.sts_id || !transfer?.from_warehouse_code) return undefined;
    let cancelled = false;
    setLocatorsLoading(true);

    (async () => {
      try {
        const eligibleRes = await stockTransferApi.eligibleSourceLocators(transfer.sts_id);
        if (cancelled) return;

        const eligible = (eligibleRes.ok ? eligibleRes.data : []) || [];

        if (eligible.length > 0) {
          setLocators(
            eligible.map((l) => {
              const name = l.locator_name || '';
              const matchBits = [];
              if (Number(l.match_count) > 0) {
                matchBits.push(`${Number(l.match_count)} item${Number(l.match_count) === 1 ? '' : 's'}`);
              }
              if (Number(l.match_qty) > 0) {
                matchBits.push(`${Number(l.match_qty)} u`);
              }
              const suffix = matchBits.length ? ` · matches ${matchBits.join(', ')}` : '';
              const sub = l.matching_items ? `${l.matching_items}${suffix}` : suffix.replace(/^ · /, '');
              return {
                value: l.locator_code,
                label: name,
                sub,
              };
            })
          );
          setFiltered(true);
          return;
        }

        const fallbackRes = await locatorsApi.list({
          warehouse_code: transfer.from_warehouse_code,
          status: 'Active',
          limit: 500,
        });
        if (cancelled) return;
        const list = (fallbackRes.ok ? fallbackRes.data : []) || [];
        setLocators(
          list
            .filter((l) => (l.locator_type || 'Regular') !== 'Damage')
            .map((l) => ({
              value: l.locator_code,
              label: l.locator_name || l.description || '',
            }))
        );
        setFiltered(false);
      } catch (err) {
        console.warn('Could not load source warehouse locators:', err);
        if (!cancelled) {
          setLocators([]);
          setFiltered(false);
        }
      } finally {
        if (!cancelled) setLocatorsLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [open, transfer?.sts_id, transfer?.from_warehouse_code]);

  if (!open || !transfer) return null;

  const requiresLocator = locators.length > 0;

  const handleConfirm = () => {
    setFeedback(null);
    if (requiresLocator && !sourceLocator) {
      setFeedback({
        type: 'warning',
        title: 'Source locator required',
        message: 'Select the locator you are pulling the stock FROM so the receiving warehouse knows its origin.',
      });
      return;
    }
    onConfirm?.(remarks.trim() || null, sourceLocator || null);
  };

  return (
    <>
      <style>{modalCss}</style>
      <style>{iconCss}</style>
      <div className="tsm-overlay" onClick={submitting ? undefined : onClose}>
        <div className="tsm-card tsm-card--sm" onClick={(e) => e.stopPropagation()}>
          <div className="tsm-header">
            <div className="tsm-header-left">
              <div className="tsm-header-icon"><FiTruck /></div>
              <div className="tsm-header-info">
                <h3 className="tsm-header-title">Transfer Stocks</h3>
                <div className="tsm-header-sub">
                  <span className="tsm-header-pono">
                    {/* Session 13 (I4) — display "STS No. ?" until approved. */}
                    {transfer.sts_no || STS_NO_PLACEHOLDER}
                  </span>
                </div>
              </div>
            </div>
            <button type="button" className="tsm-close" onClick={onClose} disabled={submitting} aria-label="Close">
              <FiX />
            </button>
          </div>

          <div className="tsm-body">
            {feedback && (
              <ModalBanner
                type={feedback.type}
                title={feedback.title}
                message={feedback.message}
                onClose={() => setFeedback(null)}
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

            <div className="tsm-meta-grid">
              <div className="tsm-meta-box">
                <div className="tsm-meta-label">Lines</div>
                <div className="tsm-meta-value">{transfer.line_count ?? '—'}</div>
              </div>
              <div className="tsm-meta-box">
                <div className="tsm-meta-label">Total Qty</div>
                <div className="tsm-meta-value">{Number(transfer.total_qty) || 0}</div>
              </div>
            </div>

            <div className="tsm-field-block">
              <label className="tsm-field-label" htmlFor="tsm-transfer-locator">
                Source Locator
                {requiresLocator && <span className="tsm-required">*</span>}
                {filtered && (
                  <span className="tsm-pill tsm-pill--auto">filtered</span>
                )}
                {!requiresLocator && !locatorsLoading && (
                  <span className="tsm-pill tsm-pill--optional">none configured</span>
                )}
              </label>
              <select
                id="tsm-transfer-locator"
                className="tsm-input"
                value={sourceLocator}
                onChange={(e) => setSourceLocator(e.target.value)}
                disabled={submitting || locatorsLoading || !requiresLocator}
              >
                <option value="">
                  {locatorsLoading
                    ? 'Loading locators…'
                    : requiresLocator
                    ? '— Select the locator you are pulling from —'
                    : '— No active Regular locators —'}
                </option>
                {locators.map((l) => (
                  <option key={l.value} value={l.value}>
                    {l.value}
                    {l.label ? ` — ${l.label}` : ''}
                    {l.sub ? ` (${l.sub})` : ''}
                  </option>
                ))}
              </select>
              <small className="tsm-helper-text">
                {filtered ? (
                  <>
                    Filtered to locators that currently hold the requested item(s)
                    in <strong>{transfer.from_warehouse_code}</strong>. The locator you
                    pick is shown to the receiving warehouse alongside the target locator.
                  </>
                ) : (
                  <>
                    The locator the stock was physically pulled from. Shown to the
                    receiving warehouse alongside the target locator.
                  </>
                )}
              </small>
              {!filtered && !locatorsLoading && requiresLocator && (
                <small className="tsm-helper-text">
                  No locator in this warehouse currently holds the requested item(s) —
                  showing all active Regular locators.
                </small>
              )}
              {!requiresLocator && !locatorsLoading && (
                <small className="tsm-helper-text">
                  This warehouse has no active Regular locators — you may transfer without one.
                </small>
              )}
            </div>

            <div className="tsm-field-block">
              <label className="tsm-field-label" htmlFor="tsm-transfer-remarks">
                Transfer Remarks <span className="tsm-pill tsm-pill--optional">optional</span>
              </label>
              <textarea
                id="tsm-transfer-remarks"
                className="tsm-textarea"
                rows={3}
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder="Optional note for the destination warehouse…"
                disabled={submitting}
              />
            </div>

            <div className="tsm-note-block">
              <span className="tsm-note-icon"><FiInfo /></span>
              <span>
                Marking as <strong>In-Transit</strong> notifies the destination warehouse
                that the stock is on its way. They will be able to <strong>Receive</strong> it
                as soon as it arrives.
              </span>
            </div>
          </div>

          <div className="tsm-footer">
            <button type="button" className="cancel-btn" onClick={onClose} disabled={submitting}>Cancel</button>
            <button
              type="button"
              className="save-btn"
              onClick={handleConfirm}
              disabled={submitting}
            >
              {submitting ? (
                'Transferring…'
              ) : (
                <>
                  <FiTruck className="tsc-btn-icon" />
                  <span>Confirm Transfer</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </>
  );
};

const ReceiveModal = ({
  open, onClose, onConfirm, detail, lines, setLines,
  remarks, setRemarks, images,
  submitting, loading, feedback, onDismissFeedback,
}) => {
  if (!open) return null;

  const isRequested = detail?.request_origin === 'Requested';

  const updateLine = (idx, field, value) => {
    setLines((prev) =>
      prev.map((l, i) => (i === idx ? { ...l, [field]: value } : l))
    );
  };

  return (
    <>
      <style>{modalCss}</style>
      <style>{iconCss}</style>
      <div className="tsm-overlay" onClick={submitting ? undefined : onClose}>
        <div className="tsm-card" onClick={(e) => e.stopPropagation()}>
          <div className="tsm-header">
            <div className="tsm-header-left">
              <div className="tsm-header-icon"><FiPackage /></div>
              <div className="tsm-header-info">
                <h3 className="tsm-header-title">Receive Transfer</h3>
                <div className="tsm-header-sub">
                  <span className="tsm-header-pono">
                    {/* Session 13 (I4) — display "STS No. ?" when no STS No. yet. */}
                    {detail?.sts_no || STS_NO_PLACEHOLDER}
                  </span>
                  {detail?.request_origin && (
                    <>
                      <span className="tsm-header-dot">·</span>
                      <span>{detail.request_origin}</span>
                    </>
                  )}
                </div>
              </div>
            </div>
            <button type="button" className="tsm-close" onClick={onClose} disabled={submitting} aria-label="Close">
              <FiX />
            </button>
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

            {loading ? (
              <div className="loading-spinner" style={{ margin: '40px auto' }} />
            ) : (
              <>
                <div className="tsm-route-badge">
                  <div className="tsm-route-wh">
                    <div className="tsm-route-label">FROM</div>
                    <div className="tsm-route-name">
                      {whPrimary(detail?.from_warehouse_name, detail?.from_warehouse_code)}
                    </div>
                    {whSecondary(detail?.from_warehouse_name, detail?.from_warehouse_code) && (
                      <div className="tsm-route-code">{detail.from_warehouse_code}</div>
                    )}
                  </div>
                  <div className="tsm-route-arrow" aria-hidden="true">→</div>
                  <div className="tsm-route-wh">
                    <div className="tsm-route-label">TO</div>
                    <div className="tsm-route-name">
                      {whPrimary(detail?.to_warehouse_name, detail?.to_warehouse_code)}
                    </div>
                    {whSecondary(detail?.to_warehouse_name, detail?.to_warehouse_code) && (
                      <div className="tsm-route-code">{detail.to_warehouse_code}</div>
                    )}
                  </div>
                </div>

                <div className="tsm-note-block">
                  <span className="tsm-note-icon"><FiInfo /></span>
                  <span>
                    {isRequested ? (
                      <>
                        Good units will be <strong>auto-stored</strong> into the locator
                        chosen when the request was created. No separate store step needed.
                      </>
                    ) : (
                      <>
                        Good units will be added to your <strong>warehouse inventory</strong>.
                        You can assign them to a locator afterwards in the Store step.
                      </>
                    )}
                  </span>
                </div>

                <div className="tsm-section-head">
                  <span className="tsm-section-title">
                    <FiPackage />
                    <span>Lines <span className="tsm-section-count">({lines.length})</span></span>
                  </span>
                </div>

                <div className="tsm-lines-list">
                  {lines.map((l, idx) => {
                    const sent = Number(l.qty) || 0;
                    const recv = Number(l.received_qty) || 0;
                    const dmg  = Number(l.damaged_qty)  || 0;
                    const good = Math.max(0, recv - dmg);

                    return (
                      <div key={l.sts_line_id} className="tsm-line-card">
                        <div className="tsm-line-top">
                          <ItemImageThumb
                            src={images[l.item_code]}
                            alt={l.item_code}
                            size={44}
                          />
                          <div className="tsm-line-info">
                            <div className="tsm-line-code-row">
                              <span className="tsm-line-code">{l.item_code}</span>
                            </div>
                            <div className="tsm-line-name" title={l.item_name}>
                              {l.item_name || '—'}
                            </div>
                          </div>
                          <div className="tsm-line-uom-wrap">
                            <span className="tpm-uom-tag">{l.uom || '—'}</span>
                          </div>
                        </div>

                        <div className="tsm-meta-grid">
                          <div className="tsm-meta-box">
                            <div className="tsm-meta-label">Sent</div>
                            <div className="tsm-meta-value">{sent}</div>
                          </div>
                          <div className="tsm-meta-box">
                            <div className="tsm-meta-label">Good</div>
                            <div className="tsm-meta-value" style={{ color: '#059669' }}>{good}</div>
                          </div>
                        </div>

                        <div className="tsm-head-grid">
                          <div className="tsm-field-block">
                            <label className="tsm-field-label">Received Qty</label>
                            <input
                              type="number"
                              min={0}
                              max={sent}
                              step={1}
                              inputMode="numeric"
                              className="tsm-input"
                              value={l.received_qty}
                              onChange={(e) =>
                                updateLine(idx, 'received_qty', e.target.value.replace(/[^\d]/g, ''))
                              }
                              disabled={submitting}
                            />
                          </div>
                          <div className="tsm-field-block">
                            <label className="tsm-field-label">Damaged Qty</label>
                            <input
                              type="number"
                              min={0}
                              max={recv}
                              step={1}
                              inputMode="numeric"
                              className="tsm-input"
                              value={l.damaged_qty}
                              onChange={(e) =>
                                updateLine(idx, 'damaged_qty', e.target.value.replace(/[^\d]/g, ''))
                              }
                              disabled={submitting}
                            />
                          </div>
                        </div>

                        {dmg > 0 && (
                          <div className="tsm-field-block">
                            <label className="tsm-field-label">
                              Damage Reason <span className="tsm-required">*</span>
                            </label>
                            <textarea
                              className="tsm-textarea"
                              rows={2}
                              value={l.damage_reason}
                              onChange={(e) => updateLine(idx, 'damage_reason', e.target.value)}
                              placeholder="Describe the damage…"
                              disabled={submitting}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div className="tsm-field-block">
                  <label className="tsm-field-label" htmlFor="tsm-receive-remarks">
                    Receive Remarks <span className="tsm-pill tsm-pill--optional">optional</span>
                  </label>
                  <textarea
                    id="tsm-receive-remarks"
                    className="tsm-textarea"
                    rows={2}
                    value={remarks}
                    onChange={(e) => setRemarks(e.target.value)}
                    placeholder="Any notes about this receipt…"
                    disabled={submitting}
                  />
                </div>
              </>
            )}
          </div>

          <div className="tsm-footer">
            <button type="button" className="cancel-btn" onClick={onClose} disabled={submitting || loading}>Cancel</button>
            <button
              type="button"
              className="save-btn"
              onClick={onConfirm}
              disabled={submitting || loading}
            >
              {submitting ? (
                'Receiving…'
              ) : (
                <>
                  <FiPackage className="tsc-btn-icon" />
                  <span>Confirm Receive</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </>
  );
};

const LocatorPreviewModal = ({
  open, warehouseCode, warehouseName, locatorCode, onClose,
}) => {
  const [items, setItems]     = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);

  useEffect(() => {
    if (!open || !warehouseCode || !locatorCode) return undefined;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setItems([]);

    (async () => {
      try {
        const res = await locatorsApi.getItems(warehouseCode, locatorCode);
        if (cancelled) return;
        if (res.ok) setItems(Array.isArray(res.data) ? res.data : []);
        else setError(res.data?.message || 'Could not load the locator contents.');
      } catch (err) {
        console.error('Locator preview error:', err);
        if (!cancelled) setError('Error connecting to server.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [open, warehouseCode, locatorCode]);

  if (!open) return null;

  const totalQty = items.reduce((s, it) => s + (Number(it.qty) || 0), 0);
  const totalValue = items.reduce(
    (s, it) => s + (Number(it.qty) || 0) * (Number(it.avg_unit_cost) || 0),
    0
  );

  const formatMoney = (n) =>
    Number(n || 0).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

  return (
    <>
      <style>{modalCss}</style>
      <style>{iconCss}</style>
      <div
        className="tsm-overlay"
        style={{ zIndex: 10500 }}
        onClick={onClose}
      >
        <div className="tsm-card tsm-card--md" onClick={(e) => e.stopPropagation()}>
          <div className="tsm-header">
            <div className="tsm-header-left">
              <div className="tsm-header-icon"><FiMapPin /></div>
              <div className="tsm-header-info">
                <h3 className="tsm-header-title">{locatorCode || '—'}</h3>
                <div className="tsm-header-sub">
                  <span>{warehouseName || warehouseCode || '—'}</span>
                  {warehouseName && warehouseCode && (
                    <>
                      <span className="tsm-header-dot">·</span>
                      <span className="tsm-header-pono">{warehouseCode}</span>
                    </>
                  )}
                </div>
              </div>
            </div>
            <button type="button" className="tsm-close" onClick={onClose} aria-label="Close">
              <FiX />
            </button>
          </div>

          <div className="tsm-body">
            {loading ? (
              <div className="loading-spinner" style={{ margin: '40px auto' }} />
            ) : error ? (
              <ModalBanner type="error" title="Preview failed" message={error} />
            ) : items.length === 0 ? (
              <div className="tsm-note-block">
                <span className="tsm-note-icon"><FiInfo /></span>
                <span>This locator is currently empty.</span>
              </div>
            ) : (
              <>
                <div className="tsm-meta-grid">
                  <div className="tsm-meta-box">
                    <div className="tsm-meta-label">Items</div>
                    <div className="tsm-meta-value">{items.length}</div>
                  </div>
                  <div className="tsm-meta-box">
                    <div className="tsm-meta-label">Total Qty</div>
                    <div className="tsm-meta-value">{totalQty}</div>
                  </div>
                  <div className="tsm-meta-box">
                    <div className="tsm-meta-label">Total Value</div>
                    <div className="tsm-meta-value">{formatMoney(totalValue)}</div>
                  </div>
                </div>

                <div className="tsm-preview-table-wrap">
                  <table className="tsm-preview-table">
                    <thead>
                      <tr>
                        <th className="tsm-preview-th">Item</th>
                        <th className="tsm-preview-th" style={{ textAlign: 'center' }}>Qty</th>
                        <th className="tsm-preview-th" style={{ textAlign: 'right' }}>Avg Cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((it, idx) => (
                        <tr key={it.item_code || idx} className="tsm-preview-tr">
                          <td className="tsm-preview-td">
                            <div className="tsm-preview-code">{it.item_code || '—'}</div>
                            <div className="tsm-preview-name" title={it.item_name || ''}>
                              {it.item_name || '—'}
                            </div>
                          </td>
                          <td className="tsm-preview-td" style={{ textAlign: 'center', fontWeight: 700 }}>
                            {Number(it.qty) || 0}
                          </td>
                          <td className="tsm-preview-td" style={{ textAlign: 'right' }}>
                            {it.avg_unit_cost != null ? formatMoney(it.avg_unit_cost) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>

          <div className="tsm-footer">
            <button type="button" className="cancel-btn" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    </>
  );
};

const DetailModal = ({
  detail, images, onClose,
  onReRequest, onReceive,
  onPreviewLocator,
  showRequestActions = false,
  activity = [],
  activityLoading = false,
}) => {
  if (!detail) return null;
  const lines = detail.lines || [];
  const targetLocatorCode = lines[0]?.locator_code || null;
  const hasAnyLocator = !!(detail.source_locator_code || targetLocatorCode);

  const showReceiveBtn  = showRequestActions && detail.status === 'In-Transit';
  const showReRequestBtn = detail.status === 'Rejected' && !!onReRequest;

  return (
    <>
      <style>{modalCss}</style>
      <style>{iconCss}</style>
      <style>{stsTimelineCss}</style>
      <div className="tsm-overlay" onClick={onClose}>
        <div className="tsm-card" onClick={(e) => e.stopPropagation()}>
          <div className="tsm-header">
            <div className="tsm-header-left">
              <div className="tsm-header-icon"><FiFileText /></div>
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
            <button type="button" className="tsm-close" onClick={onClose} aria-label="Close">
              <FiX />
            </button>
          </div>

          <div className="tsm-body">
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

            {hasAnyLocator && (
              <div className="tsm-locator-section">
                <div className="tsm-locator-section-label">Locators</div>
                <div className="tsm-locator-chips">
                  {detail.source_locator_code && (
                    <button
                      type="button"
                      className="tsm-locator-chip tsm-locator-chip--source"
                      onClick={() => onPreviewLocator?.({
                        warehouseCode: detail.from_warehouse_code,
                        warehouseName: detail.from_warehouse_name,
                        locatorCode:   detail.source_locator_code,
                      })}
                      title="Click to preview what's currently in this locator"
                    >
                      <span className="tsm-locator-chip-label">
                        <FiMapPin />
                        <span>Transfer From</span>
                      </span>
                      <span className="tsm-locator-chip-code">{detail.source_locator_code}</span>
                    </button>
                  )}
                  {targetLocatorCode && (
                    <button
                      type="button"
                      className="tsm-locator-chip tsm-locator-chip--target"
                      onClick={() => onPreviewLocator?.({
                        warehouseCode: detail.to_warehouse_code,
                        warehouseName: detail.to_warehouse_name,
                        locatorCode:   targetLocatorCode,
                      })}
                      title="Click to preview what's currently in this locator"
                    >
                      <span className="tsm-locator-chip-label">
                        <FiDownload />
                        <span>Stored To</span>
                      </span>
                      <span className="tsm-locator-chip-code">{targetLocatorCode}</span>
                    </button>
                  )}
                </div>
              </div>
            )}

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
                <div className="tsm-meta-label">Approved At</div>
                <div className="tsm-meta-value">
                  {detail.approved_at ? formatDateTime(detail.approved_at) : '—'}
                </div>
              </div>
              <div className="tsm-meta-box">
                <div className="tsm-meta-label">Transferred At</div>
                <div className="tsm-meta-value">
                  {detail.shipped_at ? formatDateTime(detail.shipped_at) : '—'}
                </div>
              </div>
              <div className="tsm-meta-box">
                <div className="tsm-meta-label">Received At</div>
                <div className="tsm-meta-value">
                  {detail.received_at ? formatDateTime(detail.received_at) : '—'}
                </div>
              </div>
            </div>

            {detail.status === 'Rejected' && detail.rejection_reason && (
              <div className="tsm-rejection-banner">
                <div className="tsm-rejection-header">
                  <span className="tsm-rejection-icon"><FiAlertTriangle /></span>
                  <span className="tsm-rejection-title">Rejected by {detail.rejected_by || '—'}</span>
                </div>
                <div className="tsm-rejection-body">{detail.rejection_reason}</div>
                <div className="tsm-rejection-meta">{formatDateTime(detail.rejected_at)}</div>
              </div>
            )}

            {detail.remarks && (
              <div className="tsm-field-block">
                <label className="tsm-field-label">Remarks</label>
                <div className="tsm-remarks-box">{detail.remarks}</div>
              </div>
            )}

            <div className="tsm-section-head">
              <span className="tsm-section-title">
                <FiPackage />
                <span>Lines <span className="tsm-section-count">({lines.length})</span></span>
              </span>
            </div>

            <div className="tsm-lines-list">
              {lines.map((l) => {
                const requested = l.requested_qty != null ? Number(l.requested_qty) : Number(l.qty) || 0;
                const approved  = l.approved_qty  != null ? Number(l.approved_qty)  : null;

                return (
                  <div key={l.sts_line_id} className="tsm-line-card">
                    <div className="tsm-line-top">
                      <ItemImageThumb src={images[l.item_code]} alt={l.item_code} size={48} />
                      <div className="tsm-line-info">
                        <div className="tsm-line-code-row">
                          <span className="tsm-line-code">{l.item_code}</span>
                        </div>
                        <div className="tsm-line-name" title={l.item_name}>
                          {l.item_name || '—'}
                        </div>
                      </div>
                      <div className="tsm-line-uom-wrap">
                        <span className="tpm-uom-tag">{l.uom || '—'}</span>
                      </div>
                    </div>

                    <div className="tsm-line-metrics">
                      <div className="tsm-metric">
                        <div className="tsm-metric-label">Requested</div>
                        <div className="tsm-metric-value">{requested}</div>
                      </div>
                      <div className="tsm-metric">
                        <div className="tsm-metric-label">Approved</div>
                        <div className="tsm-metric-value">
                          {approved != null ? approved : '—'}
                        </div>
                      </div>
                      <div className="tsm-metric">
                        <div className="tsm-metric-label">Received</div>
                        <div className="tsm-metric-value">{Number(l.received_qty) || 0}</div>
                      </div>
                      <div className="tsm-metric">
                        <div className="tsm-metric-label">Damaged</div>
                        <div className="tsm-metric-value">{Number(l.damaged_qty) || 0}</div>
                      </div>
                    </div>

                    {l.qty_change_reason && (
                      <div className="tsm-field-block">
                        <label className="tsm-field-label">Adjustment reason</label>
                        <div className="tsm-remarks-box">{l.qty_change_reason}</div>
                        {l.qty_changed_by && (
                          <small className="tsm-helper-text">
                            Changed by {l.qty_changed_by}
                            {l.qty_changed_at ? ` · ${formatDateTime(l.qty_changed_at)}` : ''}
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
              <span className="tsm-note-icon"><FiInfo /></span>
              <span>
                <strong>What&apos;s next:</strong>{' '}
                {detail.status === 'Pending'      ? 'Waiting for Department Head approval.' :
                 detail.status === 'For Shipping' ? 'Waiting for the source warehouse to transfer the items.' :
                 detail.status === 'In-Transit'   ? 'Waiting for the destination warehouse to receive.' :
                 detail.status === 'Received'     ? 'Waiting for the destination warehouse to store.' :
                 detail.status === 'Completed'    ? 'Transfer complete.' :
                 detail.status === 'Rejected'     ? 'Rejected. You may re-request.' :
                 detail.status === 'Cancelled'    ? 'Cancelled.' :
                 '—'}
              </span>
            </div>

            <div className="tsm-section-head">
              <span className="tsm-section-title">
                <FiClock />
                <span>Activity Timeline{' '}
                  <span className="tsm-section-count">
                    ({activityLoading ? '…' : activity.length})
                  </span>
                </span>
              </span>
            </div>

            <StsActivityTimeline events={activity} loading={activityLoading} />
          </div>

          <div className="tsm-footer">
            <button type="button" className="cancel-btn" onClick={onClose}>Close</button>

            {showReRequestBtn && (
              <button
                type="button"
                className="save-btn"
                onClick={() => onReRequest(detail)}
              >
                <FiRefreshCw className="tsc-btn-icon" />
                <span>Re-request</span>
              </button>
            )}

            {showReceiveBtn && (
              <button
                type="button"
                className="save-btn"
                onClick={() => onReceive?.(detail)}
                style={{ background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)' }}
              >
                <FiPackage className="tsc-btn-icon" />
                <span>Receive</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

const TabStockTransfer = () => {
  const toast   = useToast();
  const { can } = usePermissions();
  const currentUser = getUser();
  const userWarehouseId = currentUser?.warehouse_assigned;

  const [myWarehouse, setMyWarehouse]     = useState(null);
  const [allWarehouses, setAllWarehouses] = useState([]);
  const [myLocators, setMyLocators]       = useState([]);
  const [itemsImages, setItemsImages]     = useState({});

  const [segment, setSegment] = useSessionState(
    STORAGE_KEYS.segment,
    SEGMENT_FOR_TRANSFER
  );

  const [showRequest, setShowRequest]           = useState(false);
  const [requestPrefill, setRequestPrefill]     = useState(null);

  const [transferTarget, setTransferTarget]     = useState(null);
  const [transferSubmitting, setTransferSubmitting] = useState(false);

  const [receiveTarget, setReceiveTarget]       = useState(null);
  const [receiveLines, setReceiveLines]         = useState([]);
  const [receiveRemarks, setReceiveRemarks]     = useState('');
  const [receiveSubmitting, setReceiveSubmitting] = useState(false);
  const [receiveLoading, setReceiveLoading]     = useState(false);
  const [receiveFeedback, setReceiveFeedback]   = useState(null);

  const [detail, setDetail]                     = useState(null);
  const [detailActivity, setDetailActivity]     = useState([]);
  const [detailActivityLoading, setDetailActivityLoading] = useState(false);
  const [locatorPreview, setLocatorPreview]     = useState(null);

  const [exporting, setExporting]               = useState(false);

  const firstLineCacheRef = useRef(new Map());
  const detailReqIdRef  = useRef(0);
  const receiveReqIdRef = useRef(0);

  const transferLoader = useCallback(async ({ page, limit, search, startDate, endDate }) => {
    return stockTransferApi.forShipping({
      page,
      limit,
      search:     search || undefined,
      start_date: startDate || undefined,
      end_date:   endDate || undefined,
    });
  }, []);

  const mineLoader = useCallback(async ({ page, limit, search, status, startDate, endDate }) => {
    return stockTransferApi.myRequests({
      page,
      limit,
      search:     search || undefined,
      status:     status === 'All' ? undefined : status,
      start_date: startDate || undefined,
      end_date:   endDate || undefined,
    });
  }, []);

  const transfer = usePaginatedList({
    loader: transferLoader,
    initialFilters: TRANSFER_INITIAL_FILTERS,
    pageSize: PAGE_SIZE,
    debounceMs: SEARCH_DEBOUNCE_MS,
    storageKey: STORAGE_KEYS.transfer,
  });

  const mine = usePaginatedList({
    loader: mineLoader,
    initialFilters: MINE_INITIAL_FILTERS,
    pageSize: PAGE_SIZE,
    debounceMs: SEARCH_DEBOUNCE_MS,
    storageKey: STORAGE_KEYS.mine,
  });

  useEffect(() => {
    (async () => {
      try {
        const res = await warehouseApi.getAllWarehouses();
        if (res.ok && Array.isArray(res.data)) setAllWarehouses(res.data);
      } catch (err) {
        console.warn('Could not load warehouses:', err);
      }
    })();
  }, []);

  useEffect(() => {
    if (!userWarehouseId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await warehouseApi.getWarehouseById(userWarehouseId);
        if (cancelled) return;
        if (res.ok && res.data) {
          const wh = res.data.data || res.data;
          if (wh && (wh.warehouse_code || wh.warehouse_name)) {
            setMyWarehouse({
              warehouse_id: wh.warehouse_id ?? userWarehouseId,
              warehouse_code: wh.warehouse_code || '',
              warehouse_name: wh.warehouse_name || '',
            });
          }
        }
      } catch (err) {
        console.warn('Could not load assigned warehouse:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [userWarehouseId]);

  useEffect(() => {
    if (!myWarehouse?.warehouse_code) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await locatorsApi.list({
          warehouse_code: myWarehouse.warehouse_code,
          limit: 500,
          status: 'Active',
        });
        if (cancelled) return;
        if (res.ok) setMyLocators(res.data || []);
      } catch (err) {
        console.warn('Could not load locators:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [myWarehouse?.warehouse_code]);

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
                item_code: first.item_code || null,
                item_name: first.item_name || null,
                uom:       first.uom || null,
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
        setItemsImages((prev) => ({ ...prev, ...res.data.images }));
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { if (transfer.rows.length > 0) loadImagesForRows(transfer.rows); }, [transfer.rows, loadImagesForRows]);
  useEffect(() => { if (mine.rows.length > 0) loadImagesForRows(mine.rows); }, [mine.rows, loadImagesForRows]);

  const getRowItem = useCallback((row) => {
    const cached = firstLineCacheRef.current.get(row.sts_id);
    if (!cached) return null;
    return {
      item_code: cached.item_code,
      item_name: cached.item_name,
      line_count: cached.line_count ?? row.line_count ?? 1,
    };
  }, []);

  const forTransferCount = transfer.total;
  const myRequestsCount  = mine.total;

  const openNewRequest = () => {
    setRequestPrefill(null);
    setShowRequest(true);
  };

  const openReRequest = (row) => {
    const firstLine = row.lines?.[0] || row;
    setRequestPrefill({
      sourceWarehouse: row.from_warehouse_code
        ? { value: row.from_warehouse_code, label: row.from_warehouse_name || '' }
        : null,
      item: (firstLine.item_code || row.item_code)
        ? {
            value: firstLine.item_code || row.item_code,
            label: firstLine.item_name || row.item_name || '',
            uom:   firstLine.uom || row.uom || '',
          }
        : null,
      uom: firstLine.uom || row.uom || '',
      qty: firstLine.qty || row.qty || '',
      targetLocator: firstLine.locator_code || row.locator_code || '',
      remarks: '',
    });
    setDetail(null);
    setShowRequest(true);
  };

  const onRequestSubmitted = () => {
    mine.reload();
    transfer.reload();
    toast.success('Transfer request submitted for approval.');
  };

  const confirmTransfer = async (remarks, sourceLocatorCode) => {
    if (!transferTarget) return;
    setTransferSubmitting(true);
    try {
      const res = await stockTransferApi.ship(transferTarget.sts_id, {
        remarks,
        source_locator_code: sourceLocatorCode,
      });
      if (res.ok && res.data?.success !== false) {
        toast.success(res.data?.message || 'Transfer marked as In-Transit.');
        setTransferTarget(null);
        await Promise.all([transfer.reload(), mine.reload()]);
        notifyStsChanged();
      } else {
        toast.error(res.data?.message || 'Failed to transfer items.');
      }
    } catch (err) {
      console.error('Transfer error:', err);
      toast.error('Error connecting to server.');
    } finally {
      setTransferSubmitting(false);
    }
  };

  const openReceive = async (row) => {
    const reqId = ++receiveReqIdRef.current;
    const isStale = () => reqId !== receiveReqIdRef.current;

    setReceiveLoading(true);
    setReceiveFeedback(null);
    setReceiveTarget(null);
    setReceiveLines([]);
    setReceiveRemarks('');
    try {
      const res = await stockTransferApi.getSTSDetail(row.sts_id);
      if (isStale()) return;
      if (!res.ok || !res.data) {
        toast.error('Could not load the transfer details.');
        return;
      }
      const d = res.data;
      setReceiveTarget(d);
setReceiveLines(
  (d.lines || []).map((l) => {
    const requested = Number(l.requested_qty ?? l.qty) || 0;
    const approved  = l.approved_qty != null ? Number(l.approved_qty) : requested;
    // What the source warehouse actually shipped is the approved qty.
    const sent = approved;
    return {
      sts_line_id:   l.sts_line_id,
      item_code:     l.item_code,
      item_name:     l.item_name || '',
      uom:           l.uom || '',
      qty:           sent,
      received_qty:  String(sent),
      damaged_qty:   '0',
      damage_reason: '',
    };
  })
);

      const codes = [...new Set((d.lines || []).map((l) => l.item_code).filter(Boolean))];
      if (codes.length) {
        try {
          const imgRes = await itemMasterApi.getImagesByCodes(codes);
          if (isStale()) return;
          if (imgRes.ok && imgRes.data?.images) {
            setItemsImages((prev) => ({ ...prev, ...imgRes.data.images }));
          }
        } catch { /* ignore */ }
      }
    } catch (err) {
      if (isStale()) return;
      console.error('Receive open error:', err);
      toast.error('Error connecting to server.');
    } finally {
      if (!isStale()) setReceiveLoading(false);
    }
  };

  const closeReceive = () => {
    if (receiveSubmitting) return;
    setReceiveTarget(null);
    setReceiveLines([]);
    setReceiveRemarks('');
    setReceiveFeedback(null);
  };

  const confirmReceive = async () => {
    if (!receiveTarget) return;
    setReceiveFeedback(null);

    for (let i = 0; i < receiveLines.length; i++) {
      const l = receiveLines[i];
      const recv = Number(l.received_qty) || 0;
      const dmg  = Number(l.damaged_qty)  || 0;
      if (recv < 0 || dmg < 0) {
        setReceiveFeedback({ type: 'error', message: `Line ${i + 1}: quantities cannot be negative.` });
        return;
      }
      if (recv > l.qty) {
        setReceiveFeedback({ type: 'error', message: `Line ${i + 1}: received (${recv}) cannot exceed sent (${l.qty}).` });
        return;
      }
      if (dmg > recv) {
        setReceiveFeedback({ type: 'error', message: `Line ${i + 1}: damaged (${dmg}) cannot exceed received (${recv}).` });
        return;
      }
      if (dmg > 0 && !l.damage_reason.trim()) {
        setReceiveFeedback({ type: 'warning', title: 'Damage reason required', message: `Line ${i + 1}: please describe the damage.` });
        return;
      }
    }

    setReceiveSubmitting(true);
    try {
      const payload = {
        remarks: receiveRemarks.trim() || null,
        lines: receiveLines.map((l) => ({
          sts_line_id:   l.sts_line_id,
          received_qty:  Number(l.received_qty) || 0,
          damaged_qty:   Number(l.damaged_qty)  || 0,
          damage_reason: l.damage_reason.trim() || null,
        })),
      };
      const res = await stockTransferApi.receiveSTS(receiveTarget.sts_id, payload);
      if (!res.ok || res.data?.success === false) {
        setReceiveFeedback({
          type: 'error',
          title: 'Receive failed',
          message: res.data?.message || 'Failed to receive this transfer.',
        });
        return;
      }
      toast.success(res.data?.message || 'Transfer received.');
      setReceiveTarget(null);
      setReceiveLines([]);
      setReceiveRemarks('');
      await Promise.all([mine.reload(), transfer.reload()]);
      notifyStsChanged();
    } catch (err) {
      console.error('Receive error:', err);
      setReceiveFeedback({
        type: 'error',
        title: 'Receive failed',
        message: 'Error connecting to server.',
      });
    } finally {
      setReceiveSubmitting(false);
    }
  };

  const openDetail = async (row) => {
    const reqId = ++detailReqIdRef.current;
    const isStale = () => reqId !== detailReqIdRef.current;

    setDetailActivity([]);
    setDetailActivityLoading(true);

    try {
      const [res, actRes] = await Promise.all([
        stockTransferApi.getSTSDetail(row.sts_id),
        stockTransferApi.getSTSActivity(row.sts_id),
      ]);
      if (isStale()) return;

      if (res.ok && res.data) {
        setDetail(res.data);
        const codes = [...new Set((res.data.lines || []).map((l) => l.item_code).filter(Boolean))];
        if (codes.length) {
          try {
            const imgRes = await itemMasterApi.getImagesByCodes(codes);
            if (isStale()) return;
            if (imgRes.ok && imgRes.data?.images) setItemsImages(imgRes.data.images);
          } catch { /* ignore */ }
        }
      } else {
        toast.error('Could not load transfer details.');
      }

      if (actRes?.ok && Array.isArray(actRes.data)) {
        setDetailActivity(actRes.data);
      }
    } catch (err) {
      if (isStale()) return;
      console.error('Detail error:', err);
      toast.error('Error connecting to server.');
    } finally {
      if (!isStale()) setDetailActivityLoading(false);
    }

    if (row.status === 'Rejected') {
      stockTransferApi
        .acknowledgeRejection(row.sts_id)
        .then(() => notifyStsChanged())
        .catch((e) => console.warn('Acknowledge rejection failed (non-fatal):', e));
    }
  };

  const closeDetail = () => {
    setDetail(null);
    setDetailActivity([]);
  };

  const handleReceiveFromDetail = (row) => {
    setDetail(null);
    setDetailActivity([]);
    openReceive(row);
  };

  const openLocatorPreview = (payload) => {
    if (!payload?.warehouseCode || !payload?.locatorCode) return;
    setLocatorPreview(payload);
  };

  const closeLocatorPreview = () => setLocatorPreview(null);

  const handleExport = async () => {
    if (exporting) return;

    setExporting(true);
    try {
      const EXPORT_LIMIT = 500;
      const activeList = isMyRequests ? mine : transfer;
      const segmentSlug = isMyRequests ? 'my-requests' : 'for-transfer';

      const rows = await activeList.fetchAll(EXPORT_LIMIT);

      if (!rows || rows.length === 0) {
        toast.info('Nothing to export — the current filters match no slips.');
        return;
      }

      const truncated = activeList.total > rows.length;
      const filename = exportSTSCsv(rows, segmentSlug);

      if (truncated) {
        toast.warning(
          `Exported the first ${rows.length} of ${activeList.total} rows to ${filename}. ` +
          `Narrow the filters to export the rest.`,
          { duration: 7000 }
        );
      } else {
        toast.success(`Exported ${rows.length} row${rows.length === 1 ? '' : 's'} to ${filename}.`);
      }
    } catch (err) {
      console.error('Export error:', err);
      toast.error('Export failed. Please try again.');
    } finally {
      setExporting(false);
    }
  };

  const clearFilters = () => {
    if (segment === SEGMENT_FOR_TRANSFER) transfer.clearAll();
    else mine.clearAll();
  };

  const refreshCurrent = () => {
    if (segment === SEGMENT_FOR_TRANSFER) transfer.reload();
    else mine.reload();
  };

  const isMyRequests = segment === SEGMENT_MY_REQUESTS;
  const rows    = isMyRequests ? mine.rows : transfer.rows;
  const loading = isMyRequests ? mine.loading : transfer.loading;

  const transferHasActiveFilter =
    !!transfer.search.trim() ||
    !!transfer.filters.startDate ||
    !!transfer.filters.endDate;

  const mineHasActiveFilter =
    !!mine.search.trim() ||
    mine.filters.status !== 'All' ||
    !!mine.filters.startDate ||
    !!mine.filters.endDate;

  const activeSegmentHasFilter = isMyRequests
    ? mineHasActiveFilter
    : transferHasActiveFilter;

  const activeTotal      = isMyRequests ? mine.total : transfer.total;
  const activePage       = isMyRequests ? mine.page : transfer.page;
  const activeTotalPages = isMyRequests ? mine.totalPages : transfer.totalPages;
  const showingStart     = isMyRequests ? mine.showingStart : transfer.showingStart;
  const showingEnd       = isMyRequests ? mine.showingEnd : transfer.showingEnd;

  const gotoPrevPage = () => {
    if (isMyRequests) mine.prevPage();
    else transfer.prevPage();
  };
  const gotoNextPage = () => {
    if (isMyRequests) mine.nextPage();
    else transfer.nextPage();
  };

  const renderRowActions = (r) => {
    if (isMyRequests) {
      if (r.status === 'In-Transit') {
        return (
          <div className="tsc-action-row">
            <button
              type="button"
              className="action-btn edit"
              onClick={() => openReceive(r)}
              title="Receive this transfer with good/damaged split"
            >
              <FiPackage className="tsc-btn-icon" />
              <span>Receive</span>
            </button>
            <button
              type="button"
              className="po-view-hint"
              onClick={() => openDetail(r)}
              title="View details"
            >
              <span>View ›</span>
            </button>
          </div>
        );
      }
      if (r.status === 'Rejected') {
        return (
          <button
            type="button"
            className="action-btn edit"
            onClick={() => openReRequest(r)}
            title="Create a new request with the same details"
          >
            <FiRefreshCw className="tsc-btn-icon" />
            <span>Re-request</span>
          </button>
        );
      }
      return (
        <button
          type="button"
          className="po-view-hint"
          onClick={() => openDetail(r)}
          title="View details"
        >
          <span>View ›</span>
        </button>
      );
    }

    // 'For Shipping' is the DB status; UI label reads "Transfer".
    if (r.status === 'For Shipping') {
      return (
        <button
          type="button"
          className="action-btn edit"
          onClick={() => setTransferTarget(r)}
          title="Mark as In-Transit"
        >
          <FiTruck className="tsc-btn-icon" />
          <span>Transfer</span>
        </button>
      );
    }
    return (
      <button
        type="button"
        className="po-view-hint"
        onClick={() => openDetail(r)}
        title="View details"
      >
        <span>View ›</span>
      </button>
    );
  };

  const renderDesktopTable = () => (
    <div className="table-wrapper">
      {loading ? (
        <SkeletonTable rows={6} />
      ) : rows.length > 0 ? (
        <table className="data-table tsc-table">
          <thead>
            <tr>
              <th className="col-item">Item</th>
              <th className="col-sts">STS No.</th>
              <th className="col-wh">{isMyRequests ? 'Source Warehouse' : 'Destination Warehouse'}</th>
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
              const whName = isMyRequests ? r.from_warehouse_name : r.to_warehouse_name;
              const whCode = isMyRequests ? r.from_warehouse_code : r.to_warehouse_code;

              return (
                <tr
                  key={r.sts_id}
                  className="tsc-row"
                  onClick={() => openDetail(r)}
                >
                  <td className="col-item">
                    <div className="tsc-item-cell">
                      <ItemImageThumb
                        src={item?.item_code ? itemsImages[item.item_code] : null}
                        alt={item?.item_code || 'item'}
                        size={44}
                      />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div className="tsc-item-code" title={item?.item_code || ''}>
                          {item?.item_code || '—'}
                        </div>
                        <div className="tsc-item-name" title={item?.item_name || ''}>
                          {item?.item_name || '—'}
                        </div>
                        {extraLines > 0 && (
                          <span className="tsc-more-chip">+{extraLines} more</span>
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
                  <td className="col-wh">
                    <span className="tsc-wh-name" title={whPrimary(whName, whCode)}>
                      {whPrimary(whName, whCode)}
                    </span>
                    {whSecondary(whName, whCode) && (
                      <span className="tsc-wh-code">{whCode}</span>
                    )}
                  </td>
                  <td className="col-by">{r.submitted_by || '—'}</td>
                  <td className="col-date">{formatDate(r.submitted_at)}</td>
                  <td className="col-qty">
                    <span className="tsc-qty">
                      {r.line_count ?? 0} · {Number(r.total_qty) || 0}
                    </span>
                  </td>
                  <td className="col-status"><StatusBadge status={r.status} /></td>
                  <td className="col-actions" onClick={(e) => e.stopPropagation()}>
                    {renderRowActions(r)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <div className="no-items-message">
          <p>
            {isMyRequests
              ? 'No requests match the current filters.'
              : 'No approved transfers match the current filters.'}
          </p>
          {activeSegmentHasFilter && (
            <button
              type="button"
              className="no-items-clear"
              onClick={clearFilters}
            >
              ✕ Clear filters
            </button>
          )}
        </div>
      )}
    </div>
  );

  const renderMobileCards = () => (
    <>
      {loading ? (
        <SkeletonCards rows={4} />
      ) : rows.length > 0 ? (
        rows.map((r) => {
          const item = getRowItem(r);
          const extraLines = item ? Math.max(0, (item.line_count || 1) - 1) : 0;
          const whName = isMyRequests ? r.from_warehouse_name : r.to_warehouse_name;
          const whCode = isMyRequests ? r.from_warehouse_code : r.to_warehouse_code;

          return (
            <div
              key={r.sts_id}
              className="po-card"
              onClick={() => openDetail(r)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && openDetail(r)}
            >
              <div className="po-card-row-1 tsc-card-item">
                <div className="tsc-item-cell">
                  <ItemImageThumb
                    src={item?.item_code ? itemsImages[item.item_code] : null}
                    alt={item?.item_code || 'item'}
                    size={40}
                  />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="tsc-item-code">{item?.item_code || '—'}</div>
                    <div className="tsc-item-name" title={item?.item_name || ''}>
                      {item?.item_name || '—'}
                    </div>
                    {extraLines > 0 && (
                      <span className="tsc-more-chip">+{extraLines} more</span>
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
                  <strong>{isMyRequests ? 'From:' : 'To:'}</strong>{' '}
                  {whPrimary(whName, whCode)}
                  {whSecondary(whName, whCode) ? ` · ${whCode}` : ''}
                </span>
                <span><strong>Lines:</strong> {r.line_count ?? 0}</span>
                <span><strong>Qty:</strong> {Number(r.total_qty) || 0}</span>
              </div>

              <div className="po-card-row-2" style={{ fontSize: 12, color: '#64748b' }}>
                <span><strong>By:</strong> {r.submitted_by || '—'}</span>
                <span>{formatDate(r.submitted_at)}</span>
              </div>

              <div className="po-card-actions" onClick={(e) => e.stopPropagation()}>
                {renderRowActions(r)}
              </div>
            </div>
          );
        })
      ) : (
        <div className="no-items-message">
          <p>
            {isMyRequests
              ? 'No requests match the current filters.'
              : 'No approved transfers match the current filters.'}
          </p>
          {activeSegmentHasFilter && (
            <button
              type="button"
              className="no-items-clear"
              onClick={clearFilters}
            >
              ✕ Clear filters
            </button>
          )}
        </div>
      )}
    </>
  );

  return (
    <div className="items-section">
      <style>{tabCss}</style>
      <style>{subSidebarFlagCss}</style>
      <style>{iconCss}</style>
      <style>{tscTableFitCss}</style>

      <div className="section-header">
        <h3>
          <FiTruck className="tsc-section-heading-icon" />
          <span>Transfer Stocks</span>
        </h3>
        <div className="header-actions">
          <span className="item-count">
            {forTransferCount} for transfer · {myRequestsCount} request{myRequestsCount === 1 ? '' : 's'}
          </span>
          {can('stocktransfer.create') && (
            <button
              type="button"
              className="add-user-btn"
              onClick={openNewRequest}
            >
              <FiPlus className="tsc-btn-icon" />
              <span>New Request</span>
            </button>
          )}
          <button
            type="button"
            className="export-btn"
            onClick={handleExport}
            disabled={exporting || activeTotal === 0}
            title="Download the currently-filtered slips as CSV"
          >
            {exporting ? (
              'Exporting…'
            ) : (
              <>
                <FiDownload className="tsc-btn-icon" />
                <span>Export CSV</span>
              </>
            )}
          </button>
        </div>
      </div>

      <div className="tsc-layout">
        <aside className="tsc-subsidebar tsc-subsidebar--flag" aria-label="Queues">
          <div className="tsc-subsidebar-flag-head">
            <div className="tsc-subsidebar-flag-title">
              <span className="tsc-subsidebar-flag-dot" aria-hidden="true" />
              <span>Queues</span>
            </div>
            <p className="tsc-subsidebar-flag-subtitle">
              Switch between transfers and your requests.
            </p>
          </div>

          <div className="tsc-subsidebar-group">
            <button
              type="button"
              className={`tsc-filter-item${!isMyRequests ? ' active' : ''}`}
              onClick={() => setSegment(SEGMENT_FOR_TRANSFER)}
            >
              <span>
                <FiPackage />
                <span>For Transfer</span>
              </span>
              <span className="tsc-filter-count">{forTransferCount}</span>
            </button>
            <button
              type="button"
              className={`tsc-filter-item${isMyRequests ? ' active' : ''}`}
              onClick={() => setSegment(SEGMENT_MY_REQUESTS)}
            >
              <span>
                <FiList />
                <span>My Requests</span>
              </span>
              <span className="tsc-filter-count">{myRequestsCount}</span>
            </button>
          </div>
        </aside>

        <div className="tsc-content">
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
            <span className="tsc-banner-icon tsc-banner-icon--info"><FiInfo /></span>
            <span>
              <strong>Request</strong> stock from another warehouse. Once the Department Head
              approves and the source transfers it, the transfer appears in your{' '}
              <strong>My Requests</strong> as <em>In-Transit</em> — click{' '}
              <strong>Receive</strong> to record good and damaged units. Good units are
              auto-stored into the locator you chose when you made the request.
              Click any row to view its full activity timeline.
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
                    placeholder={isMyRequests
                      ? 'Search STS No., source warehouse…'
                      : 'Search STS No., submitted by, destination…'}
                    value={isMyRequests ? mine.search : transfer.search}
                    onChange={(e) => {
                      if (isMyRequests) mine.setSearch(e.target.value);
                      else transfer.setSearch(e.target.value);
                    }}
                  />
                </div>

                {isMyRequests && (
                  <div className="filter-group">
                    <label>Status</label>
                    <select
                      className="filter-input"
                      value={mine.filters.status}
                      onChange={(e) => mine.setFilter('status', e.target.value)}
                    >
                      <option value="All">All statuses</option>
                      <option value="Pending">Pending</option>
                      {/* value sent to backend is the DB status; label is user-facing */}
                      <option value="For Shipping">For Transfer</option>
                      <option value="In-Transit">In-Transit</option>
                      <option value="Received">Received</option>
                      <option value="Completed">Completed</option>
                      <option value="Rejected">Rejected</option>
                      <option value="Cancelled">Cancelled</option>
                    </select>
                  </div>
                )}

                <div className="filter-group">
                  <label>Start Date</label>
                  <input
                    type="date"
                    className="filter-input"
                    value={isMyRequests ? mine.filters.startDate : transfer.filters.startDate}
                    onChange={(e) => {
                      if (isMyRequests) mine.setFilter('startDate', e.target.value);
                      else transfer.setFilter('startDate', e.target.value);
                    }}
                  />
                </div>

                <div className="filter-group">
                  <label>End Date</label>
                  <input
                    type="date"
                    className="filter-input"
                    value={isMyRequests ? mine.filters.endDate : transfer.filters.endDate}
                    onChange={(e) => {
                      if (isMyRequests) mine.setFilter('endDate', e.target.value);
                      else transfer.setFilter('endDate', e.target.value);
                    }}
                  />
                </div>

                <div className="filter-group action-group">
                  <button className="cancel-btn" onClick={clearFilters} style={{ padding: '8px 16px' }}>
                    Clear
                  </button>
                  <button className="add-user-btn" onClick={refreshCurrent} style={{ padding: '8px 16px' }}>
                    Refresh
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="daily-items-section">
            <div className="daily-items-header">
              <h4>{isMyRequests ? 'My Transfer Requests' : 'Pending Transfers'}</h4>
              <span className="daily-items-count">
                {rows.length} row{rows.length === 1 ? '' : 's'}
              </span>
            </div>

            <div className="po-desktop-only">{renderDesktopTable()}</div>
            <div className="po-mobile-only">{renderMobileCards()}</div>

            {!loading && activeTotal > 0 && (
              <div className="tsc-pagination">
                <div className="tsc-pagination-info">
                  Showing {showingStart}–{showingEnd} of {activeTotal}
                </div>
                <div className="tsc-pagination-controls">
                  <button
                    type="button"
                    className="tsc-page-btn"
                    onClick={gotoPrevPage}
                    disabled={activePage <= 1}
                  >
                    ‹ Prev
                  </button>
                  <span className="tsc-page-indicator">
                    Page {activePage} of {activeTotalPages}
                  </span>
                  <button
                    type="button"
                    className="tsc-page-btn"
                    onClick={gotoNextPage}
                    disabled={activePage >= activeTotalPages}
                  >
                    Next ›
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <RequestTransferModal
        open={showRequest}
        onClose={() => { setShowRequest(false); setRequestPrefill(null); }}
        onSubmitted={onRequestSubmitted}
        myWarehouse={myWarehouse}
        allWarehouses={allWarehouses}
        myLocators={myLocators}
        prefill={requestPrefill}
      />

      <TransferModal
        open={!!transferTarget}
        onClose={() => !transferSubmitting && setTransferTarget(null)}
        onConfirm={confirmTransfer}
        transfer={transferTarget}
        submitting={transferSubmitting}
      />

      <ReceiveModal
        open={!!receiveTarget || receiveLoading}
        onClose={closeReceive}
        onConfirm={confirmReceive}
        detail={receiveTarget}
        lines={receiveLines}
        setLines={setReceiveLines}
        remarks={receiveRemarks}
        setRemarks={setReceiveRemarks}
        images={itemsImages}
        submitting={receiveSubmitting}
        loading={receiveLoading}
        feedback={receiveFeedback}
        onDismissFeedback={() => setReceiveFeedback(null)}
      />

      <DetailModal
        detail={detail}
        images={itemsImages}
        onClose={closeDetail}
        onReRequest={openReRequest}
        onReceive={handleReceiveFromDetail}
        onPreviewLocator={openLocatorPreview}
        showRequestActions={isMyRequests}
        activity={detailActivity}
        activityLoading={detailActivityLoading}
      />

      <LocatorPreviewModal
        open={!!locatorPreview}
        warehouseCode={locatorPreview?.warehouseCode || null}
        warehouseName={locatorPreview?.warehouseName || null}
        locatorCode={locatorPreview?.locatorCode || null}
        onClose={closeLocatorPreview}
      />
    </div>
  );
};

export default TabStockTransfer;