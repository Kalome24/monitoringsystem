// src/components/shared/stockTransfer/stockTransferModalCss.js

// ============================================================
// Shared tsm-* modal chrome for the Stock Transfer tabs.
//
// Previously duplicated:
//   • modalCss in TabStockTransferApproval.jsx  (indigo accent)
//   • modalCss in TabStockTransfer.jsx          (teal accent)
//
// The handler version is the structural superset — it carries the
// extra modal classes for HybridSelect, locator chips, locator
// preview table, success screen, pills, and readonly inputs. The
// Dept Head tab simply doesn't use those classes at runtime; the
// extra rules are inert for it.
//
// Only the accent color varies. That is parameterized below.
//
// Icon-container rules (v2, Feather migration):
//   • `.tsm-header-icon`  → SVG sized via 1em off font-size:22px
//   • `.tsm-close`        → 1em off font-size:18px
//   • `.tsm-route-arrow`  → 1em off font-size:22px (rotates 90°
//                            on mobile via existing @media rule)
//   • `.tsm-rejection-icon` → 1em off font-size:18px
//   • `.tsm-note-icon`    → 1em off font-size:14px
//   • `.tsm-success-icon` → 1em off font-size:64px (→48px mobile)
//   Every one scales with its parent font-size, so all existing
//   @media breakpoints (900 / 640 / 380 / landscape) already
//   shrink the icons proportionally.
//
// Usage (in each tab, top of module):
//
//   import {
//     buildStockTransferModalCss,
//     MODAL_THEME_TEAL,
//     MODAL_THEME_INDIGO,
//   } from '../shared/stockTransfer/stockTransferModalCss';
//
//   const modalCss = buildStockTransferModalCss(MODAL_THEME_TEAL);
//
// Then, in JSX (unchanged from before):
//
//   <style>{modalCss}</style>
// ============================================================

// ------------------------------------------------------------
// Theme presets — one per tab.
//
// TEAL   → Stock Handler's Transfer Stocks tab
// INDIGO → Department Head's Transfer Approval tab
// ------------------------------------------------------------

export const MODAL_THEME_TEAL = Object.freeze({
  // Header icon gradient + glow
  accentGradient: 'linear-gradient(135deg, #00e0d4 0%, #008a82 100%)',
  accentShadow:   '0 4px 12px rgba(0, 210, 200, 0.32)',
  // Input / textarea focus ring
  focusBorder:    '#00b8b0',
  focusRing:      'rgba(0, 184, 176, 0.18)',
});

export const MODAL_THEME_INDIGO = Object.freeze({
  accentGradient: 'linear-gradient(135deg, #6366f1 0%, #4338ca 100%)',
  accentShadow:   '0 4px 12px rgba(99, 102, 241, 0.32)',
  focusBorder:    '#6366f1',
  focusRing:      'rgba(99, 102, 241, 0.18)',
});

// ------------------------------------------------------------
// Builder — returns the CSS string for a given theme.
// ------------------------------------------------------------

export const buildStockTransferModalCss = (theme) => {
  // Defensive fallback so a missing theme doesn't break modals.
  const t = theme || MODAL_THEME_TEAL;

  return `
@keyframes tsmFadeIn { from { opacity: 0 } to { opacity: 1 } }
@keyframes tsmSlideUp {
  from { opacity: 0; transform: translateY(16px) scale(0.98) }
  to   { opacity: 1; transform: translateY(0) scale(1) }
}

.tsm-overlay {
  position: fixed; inset: 0;
  background: rgba(15, 23, 42, 0.62);
  backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
  display: flex; align-items: center; justify-content: center;
  z-index: 10000;
  padding: clamp(8px, 2vw, 24px);
  animation: tsmFadeIn 0.18s ease;
}
.tsm-card {
  background: #ffffff;
  border-radius: clamp(12px, 1.5vw, 18px);
  width: 100%;
  max-width: 640px;
  max-height: 92vh;
  max-height: 92dvh;
  display: flex; flex-direction: column;
  overflow: hidden;
  box-shadow: 0 24px 64px rgba(15, 23, 42, 0.28), 0 4px 14px rgba(15, 23, 42, 0.14);
  animation: tsmSlideUp 0.22s cubic-bezier(0.34, 1.3, 0.64, 1);
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}
.tsm-card--sm { max-width: 480px; }
.tsm-card--md { max-width: 720px; }

.tsm-header {
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px;
  padding: clamp(16px, 2vw, 22px) clamp(18px, 2.4vw, 28px);
  border-bottom: 1px solid #e5e7eb;
  background: linear-gradient(135deg, #ffffff 0%, #f8fafc 100%);
  flex-shrink: 0;
}
.tsm-header-left { display: flex; align-items: center; gap: 14px; flex: 1; min-width: 0; }
.tsm-header-info { min-width: 0; flex: 1; }
.tsm-header-icon {
  width: 44px; height: 44px; border-radius: 12px;
  background: ${t.accentGradient};
  color: #fff; display: flex; align-items: center; justify-content: center;
  font-size: 22px; box-shadow: ${t.accentShadow};
  flex-shrink: 0;
}
/* Feather icon sizing — 1em off font-size:22px, scales with breakpoints */
.tsm-header-icon svg {
  width: 1em;
  height: 1em;
  stroke-width: 2.2;
  flex-shrink: 0;
}
.tsm-header-title {
  margin: 0; font-size: clamp(16px, 1.6vw, 20px); font-weight: 700;
  color: #0f172a; letter-spacing: -0.01em; line-height: 1.2;
}
.tsm-header-sub {
  font-size: clamp(11px, 1vw, 13px); color: #64748b; margin-top: 3px;
  display: flex; flex-wrap: wrap; align-items: center; gap: 6px;
}
.tsm-header-pono {
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-weight: 700; color: #4338ca;
}
.tsm-header-dot { color: #cbd5e1; }
.tsm-close {
  background: transparent; border: none;
  width: 36px; height: 36px; border-radius: 8px; cursor: pointer;
  font-size: 18px; color: #64748b; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
}
/* Feather icon sizing — 1em off font-size:18px */
.tsm-close svg {
  width: 1em;
  height: 1em;
  stroke-width: 2.2;
}
.tsm-close:hover:not(:disabled) { background: #f1f5f9; color: #0f172a; }
.tsm-close:disabled { opacity: 0.4; cursor: not-allowed; }

.tsm-body {
  flex: 1; min-height: 0; overflow-y: auto;
  padding: clamp(18px, 2.4vw, 28px);
  display: flex; flex-direction: column;
  gap: clamp(14px, 1.6vw, 18px);
  background: #ffffff;
  -webkit-overflow-scrolling: touch;
}
.tsm-body > * { flex-shrink: 0; }
.tsm-body::-webkit-scrollbar { width: 8px; }
.tsm-body::-webkit-scrollbar-track { background: #f1f5f9; border-radius: 4px; }
.tsm-body::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 4px; }
.tsm-body::-webkit-scrollbar-thumb:hover { background: #94a3b8; }

.tsm-footer {
  display: flex; justify-content: flex-end; align-items: center; gap: 10px;
  padding: clamp(12px, 1.6vw, 18px) clamp(18px, 2.4vw, 28px);
  border-top: 1px solid #e5e7eb; background: #f8fafc;
  flex-shrink: 0; flex-wrap: wrap;
}

.tsm-head-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: clamp(12px, 1.4vw, 18px);
}
.tsm-field-block { display: flex; flex-direction: column; gap: 4px; }
.tsm-field-label {
  font-size: 12px; font-weight: 700; color: #334155;
  text-transform: uppercase; letter-spacing: 0.05em;
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
}
.tsm-required { color: #dc2626; font-weight: 700; }
.tsm-pill {
  font-size: 10px; font-weight: 600;
  padding: 1px 7px; border-radius: 999px;
  text-transform: none; letter-spacing: 0;
}
.tsm-pill--auto { color: #6b7280; background: #f3f4f6; }
.tsm-pill--optional {
  color: #94a3b8; background: #f1f5f9; font-style: italic; font-weight: 500;
}

.tsm-readonly-input {
  width: 100%; padding: 10px 12px; font-size: 14px;
  border: 1px solid #e2e8f0; border-radius: 8px;
  background: #f8fafc; color: #0f172a; font-weight: 600;
  font-family: inherit;
  outline: none; cursor: not-allowed; box-sizing: border-box;
}
.tsm-readonly-input--placeholder { color: #94a3b8; font-style: italic; font-weight: 500; }
.tsm-input {
  width: 100%; padding: 10px 12px; font-size: 14px;
  border: 1px solid #cbd5e1; border-radius: 8px;
  background: #ffffff; color: #0f172a;
  font-family: inherit; outline: none; box-sizing: border-box;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.tsm-input:focus {
  border-color: ${t.focusBorder};
  box-shadow: 0 0 0 3px ${t.focusRing};
}
.tsm-input:disabled { background: #f8fafc; color: #94a3b8; cursor: not-allowed; }

.tsm-textarea {
  width: 100%; padding: 10px 12px; font-size: 14px;
  border: 1px solid #cbd5e1; border-radius: 8px;
  background: #ffffff; color: #0f172a;
  font-family: inherit; outline: none; box-sizing: border-box;
  resize: vertical; min-height: 60px;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.tsm-textarea:focus {
  border-color: ${t.focusBorder};
  box-shadow: 0 0 0 3px ${t.focusRing};
}
.tsm-helper-text { font-size: 11px; color: #64748b; margin-top: 2px; }
.tsm-helper-text--error { color: #dc2626; font-weight: 600; }

.tsm-hybrid { position: relative; width: 100%; }
.tsm-hybrid-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  left: 0; right: 0;
  z-index: 100;
  max-height: 260px; overflow-y: auto;
  background: #ffffff;
  border: 1px solid #cbd5e1;
  border-radius: 10px;
  box-shadow: 0 12px 28px rgba(15, 23, 42, 0.18);
  padding: 4px;
  animation: tsmFadeIn 0.12s ease;
}
.tsm-hybrid-option {
  padding: 9px 12px; border-radius: 7px; cursor: pointer;
  transition: background 0.1s ease;
}
.tsm-hybrid-option.is-highlighted { background: #ecfeff; }
.tsm-hybrid-option:hover { background: #f0fdfa; }
.tsm-hybrid-option-value {
  font-size: 13px; font-weight: 700; color: #0f172a;
  letter-spacing: 0.01em; word-break: break-word;
}
.tsm-hybrid-option-label {
  font-size: 12px; color: #64748b; margin-top: 2px;
  word-break: break-word;
}
.tsm-hybrid-empty {
  padding: 14px; text-align: center;
  font-size: 12.5px; color: #94a3b8;
}

.tsm-route-badge {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  background: linear-gradient(135deg, #f0fdfa 0%, #ecfeff 100%);
  border: 1px solid #99f6e4;
  border-radius: 12px;
}
.tsm-route-wh { text-align: center; min-width: 0; }
.tsm-route-label {
  font-size: 10px; font-weight: 700; color: #0f766e;
  text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 3px;
}
.tsm-route-name {
  font-weight: 700; font-size: 15px; color: #0f172a;
  line-height: 1.25; word-break: break-word;
}
.tsm-route-code {
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-weight: 600; font-size: 11.5px; color: #64748b;
  letter-spacing: 0.04em; margin-top: 3px;
  word-break: break-all;
}
.tsm-route-arrow {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  color: #0f766e;
  font-weight: 700;
  flex-shrink: 0;
}
/* Feather icon sizing — 1em off font-size:22px; rotates 90° on mobile */
.tsm-route-arrow svg {
  width: 1em;
  height: 1em;
  stroke-width: 2.5;
  flex-shrink: 0;
}

/* Locators panel with clickable chips */
.tsm-locator-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px 16px;
  background: linear-gradient(135deg, #fefce8 0%, #fef9c3 100%);
  border: 1px solid #fde68a;
  border-radius: 12px;
}
.tsm-locator-section-label {
  font-size: 10px;
  font-weight: 700;
  color: #854d0e;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
.tsm-locator-chips {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}
.tsm-locator-chip {
  display: inline-flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
  padding: 10px 14px;
  background: #ffffff;
  border: 1.5px solid #fbbf24;
  border-radius: 10px;
  cursor: pointer;
  font-family: inherit;
  text-align: left;
  min-width: 150px;
  transition: background 0.15s ease, border-color 0.15s ease, transform 0.1s ease, box-shadow 0.15s ease;
}
.tsm-locator-chip:hover {
  background: #fffbeb;
  border-color: #f59e0b;
  box-shadow: 0 2px 8px rgba(245, 158, 11, 0.25);
}
.tsm-locator-chip:active { transform: scale(0.98); }
.tsm-locator-chip:focus-visible { outline: 2px solid #f59e0b; outline-offset: 2px; }
.tsm-locator-chip--target {
  border-color: #34d399;
}
.tsm-locator-chip--target:hover {
  background: #ecfdf5;
  border-color: #10b981;
  box-shadow: 0 2px 8px rgba(16, 185, 129, 0.25);
}
.tsm-locator-chip--target:focus-visible { outline-color: #10b981; }
.tsm-locator-chip-label {
  font-size: 10px;
  font-weight: 700;
  color: #92400e;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.tsm-locator-chip--target .tsm-locator-chip-label { color: #065f46; }
.tsm-locator-chip-code {
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-weight: 700;
  font-size: 14px;
  color: #0f172a;
  letter-spacing: 0.02em;
}

/* Locator preview table */
.tsm-preview-table-wrap {
  overflow: auto;
  max-height: 50vh;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  background: #ffffff;
}
.tsm-preview-table {
  width: 100%;
  border-collapse: collapse;
  min-width: 480px;
  font-size: 13px;
}
.tsm-preview-th {
  padding: 10px 12px;
  text-align: left;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #64748b;
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
  position: sticky;
  top: 0;
  z-index: 1;
  white-space: nowrap;
}
.tsm-preview-tr { border-bottom: 1px solid #f1f5f9; }
.tsm-preview-tr:last-child { border-bottom: none; }
.tsm-preview-td {
  padding: 10px 12px;
  color: #0f172a;
  vertical-align: middle;
}
.tsm-preview-code {
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-weight: 700;
  font-size: 12px;
  color: #4338ca;
  line-height: 1.2;
}
.tsm-preview-name {
  font-size: 11.5px;
  color: #475569;
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 320px;
}

.tsm-meta-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 10px;
}
.tsm-meta-box {
  padding: 10px 12px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  min-width: 0;
}
.tsm-meta-label {
  font-size: 10px; font-weight: 700; color: #64748b;
  text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 3px;
}
.tsm-meta-value {
  font-size: 13px; font-weight: 600; color: #0f172a;
  word-break: break-word;
}

.tsm-rejection-banner {
  padding: 14px 16px;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-left: 4px solid #ef4444;
  border-radius: 10px;
  color: #7f1d1d;
  display: flex; flex-direction: column; gap: 6px;
}
.tsm-rejection-header {
  display: flex; align-items: center; gap: 8px;
  font-weight: 700; font-size: 14px; color: #991b1b;
}
.tsm-rejection-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  line-height: 1;
  flex-shrink: 0;
}
/* Feather icon sizing — 1em off font-size:18px */
.tsm-rejection-icon svg {
  width: 1em;
  height: 1em;
  stroke-width: 2.3;
  flex-shrink: 0;
}
.tsm-rejection-title { font-size: 14px; font-weight: 700; }
.tsm-rejection-body {
  font-size: 13px; line-height: 1.55;
  white-space: pre-wrap; color: #7f1d1d;
}
.tsm-rejection-meta {
  font-size: 11px; font-style: italic; color: #b91c1c;
}

.tsm-remarks-box {
  padding: 12px 14px;
  background: #fffbeb;
  border: 1px solid #fde68a;
  border-radius: 8px;
  font-size: 13px; line-height: 1.5;
  color: #78350f;
  white-space: pre-wrap;
  word-break: break-word;
}

.tsm-section-head {
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px; flex-wrap: wrap;
}
.tsm-section-title { font-size: 14px; font-weight: 700; color: #0f172a; }
.tsm-section-count { color: #64748b; font-weight: 500; }

.tsm-lines-list { display: flex; flex-direction: column; gap: 12px; }
.tsm-line-card {
  display: flex; flex-direction: column; gap: 12px;
  padding: 14px 16px;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
}
.tsm-line-top {
  display: flex; align-items: center; gap: 12px; min-width: 0;
}
.tsm-line-info { min-width: 0; flex: 1; }
.tsm-line-code-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.tsm-line-code {
  font-weight: 700; font-size: 14px;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  color: #4338ca; letter-spacing: 0.02em; line-height: 1.2;
}
.tsm-line-name {
  font-size: 12px; color: #475569; margin-top: 2px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  line-height: 1.3;
}
.tsm-line-uom-wrap { flex-shrink: 0; }

.tsm-line-metrics {
  display: grid; grid-template-columns: repeat(3, 1fr);
  gap: 12px; padding-top: 10px;
  border-top: 1px dashed #e5e7eb;
}
.tsm-metric { display: flex; flex-direction: column; gap: 2px; }
.tsm-metric-label {
  font-size: 10px; font-weight: 700; color: #64748b;
  text-transform: uppercase; letter-spacing: 0.05em;
}
.tsm-metric-value {
  font-size: 16px; font-weight: 700; color: #0f172a;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
}
.tsm-line-bottom {
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
}
.tsm-max-hint {
  font-size: 11px; color: #64748b; font-style: italic;
  flex: 1; min-width: 0;
}
.tsm-max-hint strong { color: #4338ca; font-style: normal; }

.tsm-note-block {
  display: flex; align-items: flex-start; gap: 8px;
  padding: 12px 14px;
  background: #f8fafc;
  border: 1px solid #e2e8f0; border-radius: 8px;
  font-size: 12px; color: #475569; line-height: 1.5;
}
.tsm-note-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  flex-shrink: 0;
  margin-top: 1px;
}
/* Feather icon sizing — 1em off font-size:14px */
.tsm-note-icon svg {
  width: 1em;
  height: 1em;
  stroke-width: 2.2;
  flex-shrink: 0;
}

.tsm-success-wrap {
  display: flex; flex-direction: column; align-items: center;
  padding: clamp(20px, 4vw, 40px) 20px;
  text-align: center;
}
.tsm-success-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 64px;
  line-height: 1;
  margin-bottom: 16px;
}
/* Feather icon sizing — 1em off font-size:64px (48px on ≤640px) */
.tsm-success-icon svg {
  width: 1em;
  height: 1em;
  stroke-width: 1.8;
  flex-shrink: 0;
}
.tsm-success-title {
  margin: 0; font-size: clamp(20px, 2.4vw, 26px); font-weight: 700;
  color: #0f172a; letter-spacing: -0.01em;
}
.tsm-success-subtitle {
  margin: 8px 0 24px; color: #64748b; font-size: 14px;
  max-width: 460px; line-height: 1.5;
}
.tsm-success-card {
  width: 100%; max-width: 520px;
  background: linear-gradient(135deg, #f0fdfa 0%, #ecfeff 100%);
  border: 1.5px solid #99f6e4; border-radius: 14px;
  padding: 18px 22px;
  display: flex; flex-direction: column; gap: 12px;
}
.tsm-success-row {
  display: flex; justify-content: space-between; align-items: center;
  gap: 12px; padding-bottom: 10px;
  border-bottom: 1px dashed rgba(0, 138, 130, 0.2);
}
.tsm-success-row:last-child { border-bottom: none; padding-bottom: 0; }
.tsm-success-label {
  font-size: 12px; font-weight: 700; color: #0f766e;
  text-transform: uppercase; letter-spacing: 0.05em; flex-shrink: 0;
}
.tsm-success-value-small {
  font-size: 13px; font-weight: 600; color: #0f172a;
  text-align: right; word-break: break-word;
}
.tsm-success-badge {
  font-size: 11px; font-weight: 700; color: #92400e;
  background: #fef3c7; padding: 3px 10px;
  border-radius: 999px; letter-spacing: 0.05em;
}

@media (max-width: 900px) {
  .tsm-card { max-width: 96vw; }
  .tsm-card--md { max-width: 96vw; }
  .tsm-body { padding: 16px; }
  .tsm-footer { padding: 12px 16px; }
}

@media (max-width: 640px) {
  .tsm-overlay { padding: 0 !important; align-items: stretch !important; }
  .tsm-card,
  .tsm-card--sm,
  .tsm-card--md {
    max-height: 100vh !important;
    max-height: 100dvh !important;
    width: 100vw !important;
    max-width: 100vw !important;
    height: 100vh !important;
    height: 100dvh !important;
    border-radius: 0 !important;
    animation: none !important;
  }
  .tsm-header { padding: 12px 14px !important; }
  .tsm-header-icon {
    width: 36px !important; height: 36px !important;
    font-size: 18px !important; border-radius: 10px !important;
  }
  .tsm-header-title { font-size: 15px !important; }
  .tsm-header-sub { font-size: 11px !important; }

  .tsm-body { padding: 14px !important; gap: 12px !important; }
  .tsm-head-grid { grid-template-columns: 1fr !important; gap: 12px !important; }

  .tsm-input,
  .tsm-textarea { font-size: 16px !important; }

  .tsm-route-badge { grid-template-columns: 1fr !important; gap: 8px !important; }
  .tsm-route-arrow { transform: rotate(90deg); text-align: center; }

  .tsm-locator-chips { flex-direction: column; }
  .tsm-locator-chip { width: 100%; }

  .tsm-line-metrics { grid-template-columns: 1fr 1fr !important; }
  .tsm-line-bottom { flex-direction: column; align-items: stretch !important; gap: 6px !important; }
  .tsm-max-hint { text-align: center; flex: initial; }

  .tsm-section-head { flex-direction: column; align-items: flex-start !important; gap: 6px !important; }

  .tsm-footer { padding: 10px 14px !important; gap: 8px !important; }
  .tsm-footer > button {
    flex: 1 1 auto; min-height: 44px;
    padding: 12px 16px !important; font-size: 14px !important;
  }

  .tsm-success-wrap { padding: 16px 8px; }
  .tsm-success-icon { font-size: 48px !important; }
  .tsm-success-card { padding: 14px 16px; }
  .tsm-success-subtitle { font-size: 13px; }

  .tsm-rejection-banner { padding: 12px 14px; }
  .tsm-rejection-title { font-size: 13px; }
  .tsm-rejection-body { font-size: 12px; }
}

@media (max-width: 380px) {
  .tsm-header-icon {
    width: 32px !important; height: 32px !important; font-size: 16px !important;
  }
  .tsm-header-title { font-size: 14px !important; }
  .tsm-line-metrics { grid-template-columns: 1fr !important; }
  .tsm-footer { flex-direction: column-reverse !important; }
  .tsm-footer > button { width: 100%; }
  .tsm-meta-grid { grid-template-columns: 1fr !important; }
}

@media (max-height: 500px) and (orientation: landscape) {
  .tsm-overlay { padding: 8px !important; align-items: center !important; }
  .tsm-card,
  .tsm-card--sm,
  .tsm-card--md {
    height: auto !important; max-height: 96vh !important;
    border-radius: 12px !important; max-width: 96vw !important;
  }
  .tsm-header { padding: 8px 14px !important; }
  .tsm-body   { padding: 10px 14px !important; gap: 10px !important; }
  .tsm-footer { padding: 8px 14px !important; }
}

@media (prefers-reduced-motion: reduce) {
  .tsm-card, .tsm-overlay, .tsm-hybrid-dropdown { animation: none !important; }
  .tsm-hybrid-option { transition: none !important; }
  .tsm-locator-chip { transition: none !important; }
}
`;
};

export default buildStockTransferModalCss;