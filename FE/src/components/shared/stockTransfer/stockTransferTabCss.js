// src/components/shared/stockTransfer/stockTransferTabCss.js

// ============================================================
// Shared tsc-* / tsa-* tab-level CSS for the Stock Transfer tabs.
//
// Previously duplicated:
//   • tabCss in TabStockTransferApproval.jsx  (tsa-* / indigo accents)
//   • tabCss in TabStockTransfer.jsx          (tsc-* / teal accents)
//
// The skeleton (layout, sidebar, cards, pagination) is structurally
// identical between the two tabs. What differs:
//
//   1. Class-name prefix        → 'tsa' or 'tsc'
//   2. Accent color             → indigo (Dept Head) vs teal (Handler)
//                                 for row hover, card active, view-hint
//                                 pill, big STS number, page-btn focus
//   3. Table column width map   → Dept Head uses col-route; handler
//                                 uses col-wh
//   4. Per-tab unique cells     → .tsa-route-* cells vs
//                                 .tsc-wh-* + .tsc-action-row
//   5. Tiny per-tab extras      → 900px / 480px overrides and one
//                                 extra print hide selector
//
// The sidebar's active-tab gradient is TEAL in BOTH tabs and is
// therefore NOT themed — it is shared here as-is.
//
// The .po-* card classes, the .sk-* skeleton classes, and the
// .no-items-clear button are also shared (no per-tab prefix).
//
// Icon-container rules (v2, Feather migration):
//   • .tsa-route-arrow (approval theme only) → FiArrowRight at 1em
//   • .no-items-clear                        → optional FiXCircle /
//                                              FiRefreshCw at 1em
//   • .<prefix>-filter-item                  → optional leading icon
//                                              at 1em (safe fallback)
//   Every rule drives SVG size off the parent font-size, so all
//   existing breakpoints (900 / 768 / 640 / 480 / 360 / print)
//   already scale the icons proportionally.
//
// Usage (in each tab, top of module):
//
//   import {
//     buildStockTransferTabCss,
//     TAB_THEME_APPROVAL,
//     TAB_THEME_HANDLER,
//   } from '../shared/stockTransfer/stockTransferTabCss';
//
//   const tabCss = buildStockTransferTabCss(TAB_THEME_APPROVAL);
//
// Then, in JSX (unchanged from before):
//
//   <style>{tabCss}</style>
// ============================================================

// ------------------------------------------------------------
// Preset: Department Head — Transfer Approval tab (tsa-* / indigo)
// ------------------------------------------------------------
export const TAB_THEME_APPROVAL = Object.freeze({
  prefix: 'tsa',

  accent: {
    rowHoverBg:        '#eef2ff',
    rowActiveBg:       '#e0e7ff',
    cardActiveBorder:  '#6366f1',
    cardActiveShadow:  '0 2px 8px rgba(99, 102, 241, 0.15)',
    hintTextColor:     '#4338ca',
    hintBorder:        '#c7d2fe',
    hintBg:            '#eef2ff',
    hintHoverBg:       '#e0e7ff',
    hintHoverBorder:   '#a5b4fc',
    hintFocus:         '#6366f1',
    noBigColor:        '#4338ca',
    pageBtnFocus:      '#6366f1',
  },

  tableCols: `
.tsa-table .col-item    { width: 22%; }
.tsa-table .col-sts     { width: 12%; }
.tsa-table .col-route   { width: 20%; }
.tsa-table .col-by      { width: 12%; }
.tsa-table .col-date    { width: 10%; }
.tsa-table .col-qty     { width: 9%;  }
.tsa-table .col-status  { width: 11%; }
.tsa-table .col-actions { width: 12%; }
`,

  uniqueCells: `
.tsa-route-cell {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
.tsa-route-line {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  min-width: 0;
}
.tsa-route-wh {
  font-weight: 700;
  font-size: 12.5px;
  color: #0f172a;
  line-height: 1.25;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 130px;
}
.tsa-route-arrow {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #94a3b8;
  font-weight: 700;
  flex-shrink: 0;
}
/* Feather icon sizing — 1em off inherited font-size */
.tsa-route-arrow svg {
  width: 1em;
  height: 1em;
  stroke-width: 2.5;
  flex-shrink: 0;
}
.tsa-route-codes {
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-weight: 600;
  font-size: 10.5px;
  color: #64748b;
  letter-spacing: 0.03em;
  word-break: break-word;
}
`,

  media900Extra: '.tsa-route-wh { max-width: 100px; }',
  media480Extra: '',
  printExtra:    '',
});

// ------------------------------------------------------------
// Preset: Stock Handler — Transfer Stocks tab (tsc-* / teal)
// ------------------------------------------------------------
export const TAB_THEME_HANDLER = Object.freeze({
  prefix: 'tsc',

  accent: {
    rowHoverBg:        '#f0fdfa',
    rowActiveBg:       '#e6fffb',
    cardActiveBorder:  '#00d2c8',
    cardActiveShadow:  '0 2px 8px rgba(0, 210, 200, 0.15)',
    hintTextColor:     '#0f766e',
    hintBorder:        '#99f6e4',
    hintBg:            '#f0fdfa',
    hintHoverBg:       '#ccfbf1',
    hintHoverBorder:   '#5eead4',
    hintFocus:         '#00d2c8',
    noBigColor:        '#0f766e',
    pageBtnFocus:      '#00d2c8',
  },

  tableCols: `
.tsc-table .col-item    { width: 24%; }
.tsc-table .col-sts     { width: 13%; }
.tsc-table .col-wh      { width: 18%; }
.tsc-table .col-by      { width: 12%; }
.tsc-table .col-date    { width: 10%; }
.tsc-table .col-qty     { width: 9%;  }
.tsc-table .col-status  { width: 11%; }
.tsc-table .col-actions { width: 12%; }
`,

  uniqueCells: `
.tsc-wh-name {
  display: block;
  font-weight: 700;
  font-size: 13.5px;
  color: #0f172a;
  line-height: 1.25;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 260px;
}
.tsc-wh-code {
  display: block;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-weight: 600;
  font-size: 11px;
  color: #64748b;
  margin-top: 2px;
  letter-spacing: 0.04em;
}

.tsc-action-row {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex-wrap: nowrap;
}
`,

  media900Extra: '.tsc-wh-name { max-width: 160px; }',
  media480Extra: '.tsc-action-row { flex-wrap: wrap; gap: 6px; }',
  printExtra:    '.header-actions .add-user-btn',
});

// ------------------------------------------------------------
// Builder
// ------------------------------------------------------------
export const buildStockTransferTabCss = (theme) => {
  const t = theme || TAB_THEME_HANDLER;
  const p = t.prefix;
  const a = t.accent;

  // Print @media hide list — assembled to preserve the original
  // ordering while making the handler-only extra optional.
  const printSelectors = [
    `.${p}-subsidebar`,
    '.dashboard-search-section',
    `.${p}-pagination`,
    ...(t.printExtra ? [t.printExtra] : []),
    '.tsm-overlay',
  ].join(',\n  ');

  return `
/* ============================================================
   Layout — mini sidebar + content
   ============================================================ */
.${p}-layout {
  display: grid;
  grid-template-columns: 240px 1fr;
  gap: 18px;
  align-items: flex-start;
}

.${p}-subsidebar {
  background: #f8fafc;
  border: 1.5px solid #0f172a;
  border-radius: 12px;
  padding: 10px;
  position: sticky;
  top: 12px;
  max-height: calc(100vh - 100px);
  overflow-y: auto;
}

.${p}-subsidebar-group {
  padding: 8px 4px;
  border-bottom: 1px solid #eef2f6;
}
.${p}-subsidebar-group:last-child { border-bottom: none; }

.${p}-subsidebar-label {
  font-size: 10px;
  font-weight: 700;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  padding: 6px 10px 4px;
}

.${p}-filter-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 10px 12px;
  background: transparent;
  border: none;
  border-radius: 8px;
  font-size: 13.5px;
  font-weight: 600;
  color: #334155;
  cursor: pointer;
  font-family: inherit;
  text-align: left;
  gap: 8px;
  transition: background 0.12s ease, color 0.12s ease;
}
/* Feather icon sizing — safe fallback for optional leading icons */
.${p}-filter-item svg {
  width: 1em;
  height: 1em;
  stroke-width: 2.2;
  flex-shrink: 0;
}
.${p}-filter-item:hover { background: #e2e8f0; }
.${p}-filter-item.active {
  background: linear-gradient(135deg, #00e0d4 0%, #008a82 100%);
  color: #fff;
}
.${p}-filter-count {
  font-size: 11px;
  font-weight: 700;
  background: rgba(15,23,42,0.08);
  padding: 2px 8px;
  border-radius: 999px;
  flex-shrink: 0;
  min-width: 24px;
  text-align: center;
}
.${p}-filter-item.active .${p}-filter-count {
  background: rgba(255,255,255,0.25);
  color: #fff;
}

.${p}-content { min-width: 0; }

/* ============================================================
   Table
   ============================================================ */
.${p}-table { width: 100%; min-width: 1000px; table-layout: fixed; }
${t.tableCols}
.${p}-table thead th,
.${p}-table tbody td { text-align: left; }
.${p}-table thead th.col-actions,
.${p}-table tbody td.col-actions {
  text-align: right;
  padding-left: 4px;
  padding-right: 12px;
}
.${p}-row { cursor: pointer; transition: background 0.15s ease; }
.${p}-row:hover { background: ${a.rowHoverBg} !important; }
.${p}-row:active { background: ${a.rowActiveBg} !important; }

.${p}-item-cell {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.${p}-item-code {
  font-weight: 700;
  font-size: 12.5px;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  color: #4338ca;
  line-height: 1.2;
  word-break: break-word;
}
.${p}-item-name {
  font-size: 11.5px;
  color: #475569;
  margin-top: 1px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 1.3;
}
.${p}-more-chip {
  display: inline-block;
  margin-top: 4px;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 700;
  color: #4338ca;
  background: #eef2ff;
  border: 1px solid #c7d2fe;
  letter-spacing: 0.02em;
}
${t.uniqueCells}
.${p}-qty {
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-weight: 700;
  font-size: 13px;
  color: #0f172a;
}

.sts-color { color: #4338ca !important; }

/* ============================================================
   Sticky table header + bounded vertical scroll region
   ------------------------------------------------------------
   The global .table-wrapper sets overflow-x: auto only. Per CSS
   spec, that forces the computed overflow-y to auto as well, so
   the wrapper is already a scroll container — but with an
   unbounded height it never scrolls vertically, so a plain
   position: sticky on the header does nothing.

   Fix: give the wrapper a bounded max-height so it becomes the
   vertical scroll region for long lists. The header then sticks
   to the top of the wrapper as rows scroll underneath.

   Scoped to .${p}-content so nothing global is touched. Only the
   desktop table is affected — below 640px .po-desktop-only hides
   the wrapper entirely and the card layout takes over.
   ============================================================ */
.${p}-content .table-wrapper {
  max-height: clamp(300px, calc(100vh - 380px), 1200px);
  overflow-y: auto;
  /* Preserve horizontal scroll for the wide fixed-layout table. */
  overflow-x: auto;
}

/* Solid background on the sticky cells so scrolled rows don't
   bleed through. Matches .daily-items-section background (#ffffff). */
.${p}-table thead th {
  position: sticky;
  top: 0;
  z-index: 1;
  background: #ffffff;
}

/* Shared helper classes used by the tab */
.po-desktop-only { display: block; }
.po-mobile-only  { display: none; }

.po-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 16px;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  background: #ffffff;
  margin-bottom: 10px;
  cursor: pointer;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.po-card:active {
  border-color: ${a.cardActiveBorder};
  box-shadow: ${a.cardActiveShadow};
}
.po-card-row-1 {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}
.po-card-row-2 {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 18px;
  font-size: 13px;
  color: #475569;
}
.po-card-row-2 strong {
  color: #64748b;
  font-weight: 600;
  margin-right: 4px;
}
.po-card-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 8px;
  border-top: 1px dashed #e5e7eb;
  min-height: 30px;
  flex-wrap: wrap;
}

.po-view-hint {
  display: inline-block;
  font-size: 13px;
  font-weight: 600;
  color: ${a.hintTextColor};
  padding: 7px 12px;
  border: 1px solid ${a.hintBorder};
  background: ${a.hintBg};
  border-radius: 8px;
  white-space: nowrap;
  cursor: pointer;
  font-family: inherit;
  transition: background 0.15s ease, border-color 0.15s ease, transform 0.1s ease;
}
.po-view-hint:hover { background: ${a.hintHoverBg}; border-color: ${a.hintHoverBorder}; }
.po-view-hint:active { transform: scale(0.97); }
.po-view-hint:focus-visible { outline: 2px solid ${a.hintFocus}; outline-offset: 2px; }

.po-no-big {
  display: inline-block;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-weight: 700;
  color: ${a.noBigColor};
  letter-spacing: 0.02em;
  line-height: 1.2;
  word-break: break-word;
}

.${p}-card-item { align-items: flex-start !important; }

/* ============================================================
   Skeleton loading placeholders
   ------------------------------------------------------------
   Used by <SkeletonTable /> and <SkeletonCards /> while a list's
   first page is loading. Neutral slate palette (no theme accent)
   so both tabs share the same visual. Consumed by the desktop
   table path and the mobile card path respectively — same
   sections that already toggle via .po-desktop-only / .po-mobile-only.
   ============================================================ */
.sk-table {
  display: flex;
  flex-direction: column;
  width: 100%;
  /* Match the fixed-layout table so the wrapper's scroll region
     doesn't collapse while loading. */
  min-width: 1000px;
}

.sk-row {
  display: grid;
  /* Column widths approximate both tsa-table and tsc-table.
     Alignment doesn't need to be pixel-perfect — this is a
     placeholder, only structural similarity matters. */
  grid-template-columns: 22% 13% 20% 12% 10% 9% 11% 13%;
  align-items: center;
  gap: 12px;
  padding: clamp(12px, 1.2vw, 16px) clamp(12px, 1.2vw, 18px);
  border-bottom: 1px solid #f0f0eb;
}
.sk-row:last-child { border-bottom: none; }

.sk-cell { min-width: 0; }
.sk-cell--item {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.sk-cell--wh {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.sk-lines {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
  min-width: 0;
}

/* ---- The shimmer block itself ---- */
.sk-shimmer {
  display: block;
  background: linear-gradient(
    90deg,
    #e2e8f0 0%,
    #f1f5f9 50%,
    #e2e8f0 100%
  );
  background-size: 200% 100%;
  animation: skShimmer 1.4s ease-in-out infinite;
  border-radius: 4px;
}

@keyframes skShimmer {
  0%   { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

/* ---- Shape variants ---- */
.sk-thumb {
  width: 44px;
  height: 44px;
  border-radius: 8px;
  flex-shrink: 0;
}

.sk-line {
  height: 12px;
  border-radius: 4px;
}
.sk-line--short { width: 40%; max-width: 90px; }
.sk-line--med   { width: 65%; max-width: 160px; }
.sk-line--long  { width: 90%; max-width: 220px; }

.sk-pill {
  width: 68px;
  height: 22px;
  border-radius: 999px;
}

.sk-btn {
  width: 72px;
  height: 32px;
  border-radius: 8px;
}

/* ---- Mobile card skeleton ---- */
.sk-cards {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.sk-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 16px;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  background: #ffffff;
}

.sk-card-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.sk-card-row--actions {
  justify-content: flex-end;
  padding-top: 8px;
  border-top: 1px dashed #e5e7eb;
}

/* ============================================================
   Empty-state action button
   ------------------------------------------------------------
   Rendered inside .no-items-message when the current list is
   empty AND at least one filter is active. The parent block
   (styled globally in DashboardLayout.css) already centers its
   contents and provides vertical padding — this button just
   needs its own chrome. Shared across both tabs, so no prefix.
   ============================================================ */
.no-items-clear {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin-top: 14px;
  padding: 9px 18px;
  background: #ffffff;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  color: #334155;
  font-family: inherit;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.01em;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease, transform 0.1s ease;
}
/* Feather icon sizing — 1em off font-size:13px */
.no-items-clear svg {
  width: 1em;
  height: 1em;
  stroke-width: 2.3;
  flex-shrink: 0;
}
.no-items-clear:hover {
  background: #f1f5f9;
  border-color: #94a3b8;
  color: #0f172a;
}
.no-items-clear:active { transform: scale(0.98); }
.no-items-clear:focus-visible {
  outline: 2px solid #6366f1;
  outline-offset: 2px;
}

/* ============================================================
   Pagination footer
   ============================================================ */
.${p}-pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 4px 2px;
  margin-top: 12px;
  border-top: 1px solid #e2e8f0;
  flex-wrap: wrap;
}
.${p}-pagination-info {
  font-size: 12.5px;
  font-weight: 600;
  color: #64748b;
}
.${p}-pagination-controls {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.${p}-page-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 7px 14px;
  border: 1px solid #cbd5e1;
  background: #ffffff;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  color: #334155;
  cursor: pointer;
  font-family: inherit;
  transition: background 0.15s ease, border-color 0.15s ease;
}
.${p}-page-btn:hover:not(:disabled) { background: #f1f5f9; border-color: #94a3b8; }
.${p}-page-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.${p}-page-btn:focus-visible { outline: 2px solid ${a.pageBtnFocus}; outline-offset: 2px; }
.${p}-page-indicator {
  font-size: 13px;
  font-weight: 700;
  color: #0f172a;
  padding: 0 10px;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  white-space: nowrap;
}

/* ============================================================
   Responsive
   ============================================================ */
@media (max-width: 900px) {
  .${p}-layout { grid-template-columns: 1fr; }
  .${p}-subsidebar { position: static; max-height: none; }

  .${p}-table thead th,
  .${p}-table tbody td { padding: 10px 12px; font-size: 13px; }
  .${p}-table .col-actions .action-btn { font-size: 12px; padding: 6px 10px; }
  ${t.media900Extra}

  .sk-row { padding: 10px 12px; gap: 10px; }
  .sk-thumb { width: 40px; height: 40px; }
  .sk-line { height: 11px; }
}

@media (max-width: 768px) {
  .dashboard-filters .filter-row { flex-direction: column; align-items: stretch; }
  .dashboard-filters .filter-group { width: 100%; }
}

@media (max-width: 640px) {
  .${p}-subsidebar { padding: 8px; }
  .${p}-subsidebar-group {
    padding: 0;
    border-bottom: none;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
  .${p}-subsidebar-label { display: none; }
  .${p}-filter-item {
    justify-content: center;
    min-height: 44px;
    padding: 10px 10px;
    font-size: 13px;
  }

  .po-desktop-only { display: none !important; }
  .po-mobile-only  { display: block !important; }

  .${p}-pagination { flex-direction: column; align-items: stretch; gap: 8px; }
  .${p}-pagination-controls { justify-content: center; }
}

@media (max-width: 480px) {
  .po-no-big { font-size: 15px; }
  .${p}-filter-item { font-size: 12.5px; padding: 9px 8px; gap: 6px; }
  .${p}-filter-count { min-width: 22px; font-size: 10.5px; padding: 2px 6px; }
  ${t.media480Extra}
  .${p}-page-btn { padding: 6px 10px; font-size: 12px; }
  .${p}-page-indicator { font-size: 12px; padding: 0 6px; }

  .sk-thumb { width: 36px; height: 36px; }
  .sk-line { height: 10px; }

  .no-items-clear { padding: 8px 14px; font-size: 12.5px; }
}

@media (max-width: 360px) {
  .${p}-filter-item { font-size: 12px; gap: 4px; min-height: 42px; }
  .${p}-filter-count { min-width: 20px; font-size: 10px; padding: 2px 5px; }

  .sk-thumb { width: 32px; height: 32px; }
  .sk-line { height: 9px; }
  .sk-pill { width: 56px; height: 20px; }
  .sk-btn { width: 60px; height: 28px; }

  .no-items-clear { padding: 7px 12px; font-size: 12px; }
}

@media (prefers-reduced-motion: reduce) {
  .po-card, .${p}-row, .po-view-hint, .${p}-filter-item, .${p}-page-btn { transition: none !important; }
  .sk-shimmer { animation: none !important; }
  .no-items-clear { transition: none !important; }
  .no-items-clear:active { transform: none !important; }
}

@media print {
  ${printSelectors} { display: none !important; }
  .${p}-layout { grid-template-columns: 1fr !important; }
  .po-mobile-only { display: none !important; }
  .po-desktop-only { display: block !important; }
  /* Print: no scroll region, no sticky — show the full table. */
  .${p}-content .table-wrapper {
    max-height: none !important;
    overflow: visible !important;
  }
  .${p}-table thead th {
    position: static !important;
  }
  /* Print: skeletons are always irrelevant. */
  .sk-table,
  .sk-cards { display: none !important; }
  /* Print: the empty-state clear button is a UI action, not content. */
  .no-items-clear { display: none !important; }
}
`;
};

export default buildStockTransferTabCss;