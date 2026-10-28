// src/components/locator/locatorStyles.js
export const locatorCss = `
@keyframes locFadeIn { from { opacity: 0 } to { opacity: 1 } }
@keyframes locSlideUp {
  from { opacity: 0; transform: translateY(16px) scale(0.98) }
  to   { opacity: 1; transform: translateY(0) scale(1) }
}
@keyframes locSidebarPulse {
  0%, 100% { box-shadow: 0 0 0 3px rgba(0, 184, 176, 0.22); }
  50%      { box-shadow: 0 0 0 8px rgba(0, 184, 176, 0.05); }
}

/* ============================================================
   Theme tokens
   ============================================================ */
.inventory-locator-section {
  --locator-border: #0f172a;
  --locator-border-hover: #00d2c8;
}

/* ============================================================
   Header actions — give the primary buttons room to breathe
   so they don't visually merge with the search toolbar below.
   ============================================================ */
.inventory-locator-section .header-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

/* Universal focus ring inside this section — makes keyboard
   focus obvious on every interactive control so users don't
   mis-click into a neighbour button. */
.inventory-locator-section .header-actions button:focus-visible,
.inventory-locator-section .search-actions button:focus-visible,
.inventory-locator-section .locator-page-btn:focus-visible {
  outline: 2px solid #00b8b0;
  outline-offset: 2px;
}

/* ============================================================
   Layout — sub-sidebar + main content
   ============================================================ */
.inventory-locator-section .locator-layout {
  display: grid;
  grid-template-columns: 240px 1fr;
  gap: 18px;
  align-items: flex-start;
}

/* ============================================================
   Flagged card treatment for the filter sidebar

   Same visual language as the Damage Source sidebar:
     • Left teal accent rail running the full card height.
     • White → pale-teal gradient background.
     • Teal-tinted border + layered shadow with a teal glow.
     • Header with pulsing teal dot + title + subtitle.
     • Inner rail on buttons grows on hover / active.
   ============================================================ */
.locator-subsidebar {
  position: sticky;
  top: 12px;
  max-height: calc(100vh - 100px);
  overflow-y: auto;
  overflow-x: hidden;
  padding: 18px 14px 16px 22px;
  background: linear-gradient(180deg, #ffffff 0%, #f6fefd 100%);
  border: 1px solid #b8f1ea;
  border-radius: 14px;
  box-shadow:
    0 1px 2px rgba(15, 23, 42, 0.04),
    0 14px 32px -16px rgba(0, 184, 176, 0.35);
}

/* Left accent rail — drawn via ::before so JSX is untouched */
.locator-subsidebar::before {
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

/* ---------- Header ---------- */
.locator-subsidebar-head {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-bottom: 12px;
  border-bottom: 1px solid #ccfbf1;
  margin-bottom: 8px;
}

.locator-subsidebar-title {
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

.locator-subsidebar-dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #00b8b0;
  flex-shrink: 0;
  animation: locSidebarPulse 2.4s ease-in-out infinite;
}

.locator-subsidebar-subtitle {
  margin: 0;
  font-size: 11px;
  color: #64748b;
  line-height: 1.4;
  font-weight: 500;
}

/* ---------- Groups ---------- */
.locator-subsidebar-group {
  padding: 8px 0;
  border-bottom: 1px solid #e0faf6;
}
.locator-subsidebar-group:last-child { border-bottom: none; }

.locator-subsidebar-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 10px;
  font-weight: 800;
  color: #0f766e;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  padding: 6px 10px 6px 0;
}
.locator-subsidebar-label::before {
  content: '';
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #00b8b0;
  flex-shrink: 0;
  box-shadow: 0 0 0 2px rgba(0, 184, 176, 0.2);
}

.locator-subsidebar-empty {
  font-size: 12px;
  color: #94a3b8;
  padding: 4px 10px 8px;
  font-style: italic;
}

/* ---------- Filter buttons ---------- */
.locator-filter-item {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  padding: 9px 12px 9px 16px;
  background: transparent;
  border: none;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  color: #475569;
  cursor: pointer;
  font-family: inherit;
  text-align: left;
  transition: background 0.15s ease, color 0.15s ease;
  outline: none;
  -webkit-tap-highlight-color: transparent;
}

/* Inner left rail (grows on hover / active) */
.locator-filter-item::before {
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

.locator-filter-item:hover {
  background: rgba(0, 184, 176, 0.08);
  color: #0f172a;
}
.locator-filter-item:hover::before {
  height: 55%;
  background: #00b8b0;
}

.locator-filter-item.active {
  background: rgba(0, 184, 176, 0.14);
  color: #0f766e;
  font-weight: 700;
}
.locator-filter-item.active::before {
  height: 68%;
  background: #0f766e;
}

.locator-filter-item:focus-visible {
  box-shadow: 0 0 0 2px #00b8b0;
}

.locator-filter-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ---------- Count badge ---------- */
.locator-filter-count {
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
.locator-filter-item:hover .locator-filter-count {
  background: #d7ecf3;
  color: #334155;
}
.locator-filter-item.active .locator-filter-count {
  background: #0f766e;
  color: #ffffff;
}

/* ============================================================
   Content region
   ============================================================ */
.locator-content { min-width: 0; }

/* ------------------------------------------------------------
   Search toolbar — its own bordered "filter card" so it reads
   as a separate zone from the header's primary actions above.
   The utility buttons (Clear / Refresh) sit next to the input
   instead of being pushed to the far edge of the screen.
   ------------------------------------------------------------ */
.locator-search-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
  padding: 10px 12px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  flex-wrap: wrap;
}

/* The input grows to a comfortable cap — no further — so the
   utility buttons stay close to the field rather than shooting
   to the right edge on wide monitors. */
.search-input-wrap {
  flex: 1 1 240px;
  max-width: 520px;
  min-width: 0;
}

.search-input-wrap .filter-input {
  width: 100%;
  height: 40px;
  padding: 0 14px;
  border: 1.5px solid var(--locator-border);
  border-radius: 8px;
  font-size: 14px;
  font-family: inherit;
  color: #0f172a;
  background: #ffffff;
  outline: none;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.search-input-wrap .filter-input:focus {
  border-color: var(--locator-border-hover);
  box-shadow: 0 0 0 3px rgba(0, 210, 200, 0.15);
}
.search-input-wrap .filter-input::placeholder {
  color: #94a3b8;
}

/* Utility button group (Clear / Refresh) — deliberately styled
   as secondary so they don't compete with the header's primary
   Add Locator / Log Damage Write-off buttons. */
.search-actions {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
}

.search-actions button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 40px;
  padding: 0 14px;
  font-size: 13px;
  font-weight: 600;
  font-family: inherit;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease,
              color 0.15s ease, box-shadow 0.15s ease;
}

.search-actions .cancel-btn {
  background: transparent;
  border: 1px solid transparent;
  color: #64748b;
}
.search-actions .cancel-btn:hover {
  background: #ffffff;
  border-color: #cbd5e1;
  color: #0f172a;
}

.search-actions .refresh-btn {
  background: #ffffff;
  border: 1px solid #cbd5e1;
  color: #0f766e;
}
.search-actions .refresh-btn:hover {
  background: #f0fdfa;
  border-color: #00d2c8;
  color: #0f766e;
  box-shadow: 0 0 0 3px rgba(0, 210, 200, 0.15);
}

/* Compact search bar on small tablets / large phones */
@media (max-width: 1100px) {
  .search-input-wrap { max-width: 440px; }
}

@media (max-width: 640px) {
  .locator-search-bar {
    gap: 8px;
    padding: 8px 10px;
  }
  .search-input-wrap {
    flex: 1 1 100%;
    max-width: 100%;
  }
  .search-input-wrap .filter-input { height: 42px; }
  .search-actions {
    flex: 1 1 100%;
  }
  .search-actions button {
    flex: 1 1 0;
    height: 42px;
  }
}

@media (max-width: 380px) {
  .search-actions {
    flex-direction: column;
    align-items: stretch;
  }
  .search-actions button { width: 100%; }
  .search-input-wrap .filter-input {
    height: 40px;
    font-size: 13px;
  }
}

/* Ultra-wide — allow a slightly longer input line */
@media (min-width: 1921px) {
  .search-input-wrap { max-width: 640px; }
}

/* ============================================================
   Card grid
   ============================================================ */
.locator-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 14px;
}

.locator-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 14px 12px;
  background: #ffffff;
  border: 1.5px solid var(--locator-border);
  border-radius: 14px;
  cursor: pointer;
  overflow: hidden;
  isolation: isolate;
  min-height: 172px;
  transition:
    transform 0.22s cubic-bezier(0.34, 1.3, 0.64, 1),
    border-color 0.22s ease,
    box-shadow 0.28s ease;
  outline: none;
}

.locator-card-glow {
  position: absolute;
  inset: -1px;
  border-radius: inherit;
  pointer-events: none;
  opacity: 0;
  z-index: 0;
  background:
    radial-gradient(120% 90% at 0% 0%,     rgba(0, 224, 212, 0.22), transparent 55%),
    radial-gradient(120% 90% at 100% 100%, rgba(0, 138, 130, 0.18), transparent 55%);
  transition: opacity 0.28s ease;
}

.locator-card > *:not(.locator-card-glow) {
  position: relative;
  z-index: 1;
}

.locator-card:hover,
.locator-card:focus-visible {
  transform: translateY(-4px);
  border-color: var(--locator-border-hover);
  box-shadow:
    0 0 0 1px rgba(0, 224, 212, 0.35),
    0 18px 40px -12px rgba(0, 200, 190, 0.45),
    0 6px 18px -6px rgba(0, 138, 130, 0.35);
}
.locator-card:hover .locator-card-glow,
.locator-card:focus-visible .locator-card-glow { opacity: 1; }
.locator-card:hover .locator-card-code,
.locator-card:focus-visible .locator-card-code {
  color: #008a82;
  text-shadow: 0 0 12px rgba(0, 224, 212, 0.4);
}
.locator-card:hover .locator-card-hint,
.locator-card:focus-visible .locator-card-hint {
  color: #008a82;
}
.locator-card:active { transform: translateY(-2px) scale(0.995); }

.locator-card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}

.locator-card-code {
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-size: 15px;
  font-weight: 800;
  color: #0f172a;
  letter-spacing: 0.01em;
  transition: color 0.22s ease, text-shadow 0.22s ease;
  word-break: break-word;
  line-height: 1.2;
}

.locator-status {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
  white-space: nowrap;
  flex-shrink: 0;
}
.locator-status.active {
  background: #dcfce7;
  color: #065f46;
  border: 1px solid #86efac;
}
.locator-status.inactive {
  background: #f1f5f9;
  color: #475569;
  border: 1px solid #cbd5e1;
}

.locator-card-name {
  font-size: 12px;
  color: #475569;
  line-height: 1.35;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  min-height: 32px;
}

/* Align items to the bottom so the labels stay aligned even if values wrap */
.locator-card-stats {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-top: auto;
  padding-top: 8px;
  border-top: 1px dashed #e5e7eb;
  align-items: end; 
}
.locator-stat { min-width: 0; }
.locator-stat-label {
  font-size: 9px;
  font-weight: 700;
  color: #94a3b8;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-bottom: 1px;
}
.locator-stat-value {
  font-size: 15px;
  font-weight: 800;
  color: #0f172a;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  letter-spacing: -0.02em;
  /* Changed from nowrap/ellipsis to wrapping so currency values are never truncated */
  white-space: normal;
  overflow-wrap: anywhere; 
  line-height: 1.2;
}
.locator-stat-value.small { font-size: 11.5px; }

.locator-card-hint {
  font-size: 10px;
  font-weight: 700;
  color: #94a3b8;
  letter-spacing: 0.02em;
  text-align: right;
  transition: color 0.2s ease;
}

/* ============================================================
   Pagination bar
   ============================================================ */
.locator-pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  margin-top: 18px;
  padding: 12px 16px;
  background: #f8fafc;
  border: 1.5px solid var(--locator-border);
  border-radius: 12px;
  flex-wrap: wrap;
}

.locator-pagination-info {
  font-size: 12px;
  font-weight: 600;
  color: #64748b;
}

.locator-pagination-controls {
  display: flex;
  align-items: center;
  gap: 4px;
}

.locator-page-btn {
  min-width: 32px;
  height: 32px;
  padding: 0 10px;
  background: #ffffff;
  border: 1.5px solid var(--locator-border);
  border-radius: 8px;
  font-size: 12px;
  font-weight: 700;
  color: #334155;
  cursor: pointer;
  font-family: inherit;
  transition: all 0.15s ease;
}
.locator-page-btn:hover:not(:disabled) {
  background: #ecfeff;
  border-color: var(--locator-border-hover);
  color: #0f766e;
}
.locator-page-btn.active {
  background: linear-gradient(135deg, #00e0d4 0%, #008a82 100%);
  border-color: #008a82;
  color: #ffffff;
  box-shadow: 0 4px 12px rgba(0, 200, 190, 0.32);
}
.locator-page-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.locator-page-ellipsis {
  padding: 0 6px;
  color: #94a3b8;
  font-weight: 700;
}

/* ============================================================
   Icon helpers — sized for the locator views
   ============================================================ */

/* Section heading icon (dark on white) */
.section-heading-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1em;
  height: 1em;
  margin-right: 8px;
  vertical-align: -0.15em;
  color: #1a1f26;
}
.section-heading-icon svg {
  width: 100%;
  height: 100%;
  stroke-width: 2.2;
}

/* Generic inline button icon (inherits currentColor) */
.locator-btn-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1em;
  height: 1em;
  flex-shrink: 0;
  stroke-width: 2.4;
}
.locator-btn-icon svg {
  width: 100%;
  height: 100%;
  stroke-width: 2.4;
}

/* Filter row icon (only on the "All Locators" entry) */
.locator-filter-label--with-icon {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.locator-filter-icon {
  width: 1em;
  height: 1em;
  stroke-width: 2.4;
  flex-shrink: 0;
  color: #64748b;
  transition: color 0.15s ease;
}
.locator-filter-icon svg {
  width: 100%;
  height: 100%;
}
.locator-filter-item:hover .locator-filter-icon { color: #0f766e; }
.locator-filter-item.active .locator-filter-icon { color: #0f766e; }

/* ============================================================
   Responsive
   ============================================================ */
@media (max-width: 1400px) {
  .locator-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); }
}
@media (max-width: 1100px) {
  .locator-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}

/* Tablet + small laptop — sidebar full-width, groups become
   horizontal scroll strips. Rail hidden; header inline. */
@media (max-width: 900px) {
  .inventory-locator-section .locator-layout {
    grid-template-columns: 1fr;
  }
  .locator-subsidebar {
    position: static;
    max-height: none;
    padding: 14px 14px 12px 20px;
    overflow: visible;
  }
  .locator-subsidebar::before {
    top: 12px;
    bottom: 12px;
  }

  .locator-subsidebar-head {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    padding-bottom: 10px;
    margin-bottom: 6px;
  }
  .locator-subsidebar-subtitle {
    text-align: right;
    font-size: 10.5px;
    color: #94a3b8;
  }

  .locator-subsidebar-group {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 8px;
    padding: 6px 0;
    border-bottom: none;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: thin;
  }
  .locator-subsidebar-label {
    flex: 0 0 auto;
    padding: 0 8px 0 0;
  }
  .locator-subsidebar-empty {
    flex: 0 0 auto;
    padding: 4px 8px 4px 0;
  }

  .locator-filter-item {
    flex: 0 0 auto;
    min-width: 140px;
    padding: 9px 12px;
    background: #ffffff;
    border: 1px solid #b8f1ea;
    border-radius: 10px;
  }
  .locator-filter-item::before { display: none; }
  .locator-filter-item:hover {
    background: #f0fdfa;
    border-color: #5eead4;
  }
  .locator-filter-item.active {
    background: #f0fdfa;
    border-color: #0f766e;
  }
}

@media (max-width: 720px) {
  .locator-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

@media (max-width: 480px) {
  .locator-grid { grid-template-columns: 1fr; }
  .locator-card { padding: 12px; }
  .locator-card-code { font-size: 14px; }

  .locator-subsidebar { padding: 12px 12px 10px 16px; }
  .locator-subsidebar-subtitle { display: none; }
  .locator-filter-item {
    min-width: 118px;
    padding: 8px 10px;
    font-size: 12px;
  }
  .locator-filter-count {
    font-size: 10px;
    min-width: 20px;
    padding: 1px 6px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .locator-card,
  .locator-card-glow,
  .locator-card-code,
  .locator-card-hint,
  .locator-page-btn,
  .locator-filter-item,
  .locator-filter-item::before,
  .locator-filter-count,
  .locator-filter-icon {
    transition: none !important;
  }
  .locator-card:hover,
  .locator-card:focus-visible { transform: none; }

  .locator-subsidebar-dot {
    animation: none !important;
    box-shadow: 0 0 0 3px rgba(0, 184, 176, 0.22);
  }
}

/* ============================================================
   SURFACE-HANDLER SIDEBAR — Warehouse summary + Condition filter
   ------------------------------------------------------------
   The summary block and Condition rows are rendered by
   LocatorFilterSidebar.jsx, which ships its own base styling
   inline. These rules layer responsive tuning on top, using a
   .locator-subsidebar ancestor prefix to ensure they take
   precedence over the component's inline defaults when both
   apply.

   Because the component's inline <style> is injected into the
   DOM after this file, this file's specificity is what makes it
   the single source of truth for the summary block's layout at
   each breakpoint.
   ============================================================ */

/* Box-sizing guard so the summary's grid math never overflows */
.locator-subsidebar,
.locator-subsidebar .locator-subsidebar-summary,
.locator-subsidebar .locator-summary-cell {
  box-sizing: border-box;
}

/* ---- Tablet / small laptop (<= 900px): sidebar is full-width
   above the locator grid. The summary renders as a compact
   banner above the horizontal filter ribbons. ---- */
@media (max-width: 900px) {
  .locator-subsidebar .locator-subsidebar-summary {
    min-width: 0;
    width: 100%;
    grid-template-columns: 1fr 1fr 1.2fr;
    margin-bottom: 8px;
  }
}

/* ---- Large phones (<= 640px): drop the caption to its own row
   below the two value cells for breathing room. ---- */
@media (max-width: 640px) {
  .locator-subsidebar .locator-subsidebar-summary {
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    padding: 10px 12px;
  }
  .locator-subsidebar .locator-summary-caption {
    grid-column: 1 / -1;
    border-left: none;
    border-top: 1px dashed #b8f1ea;
    padding-left: 0;
    padding-top: 6px;
    margin-top: 2px;
    flex-direction: row;
    align-items: center;
    justify-content: flex-start;
    gap: 5px;
    flex-wrap: wrap;
  }
}

/* ---- Small phones (<= 480px): shrink typography, keep two
   columns so the two headline numbers stay side by side. ---- */
@media (max-width: 480px) {
  .locator-subsidebar .locator-subsidebar-summary {
    padding: 10px;
    gap: 6px;
  }
  .locator-subsidebar .locator-summary-value {
    font-size: 14px;
  }
  .locator-subsidebar .locator-summary-label {
    font-size: 9px;
  }
  .locator-subsidebar .locator-summary-caption {
    font-size: 10px;
  }
}

/* ---- Ultra-narrow (<= 360px): stack the two value cells so
   each gets full width; the caption remains its own row. ---- */
@media (max-width: 360px) {
  .locator-subsidebar .locator-subsidebar-summary {
    grid-template-columns: 1fr;
    padding: 8px 10px;
  }
  .locator-subsidebar .locator-summary-value {
    font-size: 13px;
  }
  .locator-subsidebar .locator-summary-caption {
    border-top: 1px dashed #b8f1ea;
    padding-top: 6px;
  }
}

/* ---- Ultra-wide (>= 1921px): more breathing room ---- */
@media (min-width: 1921px) {
  .locator-subsidebar .locator-subsidebar-summary {
    padding: 14px;
    gap: 10px;
  }
  .locator-subsidebar .locator-summary-value {
    font-size: 17px;
  }
  .locator-subsidebar .locator-summary-caption {
    font-size: 11px;
  }
}

/* ---- Reduced motion: turn off subtle transitions ---- */
@media (prefers-reduced-motion: reduce) {
  .locator-subsidebar .locator-subsidebar-summary,
  .locator-subsidebar .locator-summary-cell,
  .locator-subsidebar .locator-summary-value {
    transition: none !important;
  }
}

/* ============================================================
   NEW: Locator Card Items (Item Codes display)
   Added to show the actual item codes inside the locator card
   without breaking the card layout.
   ============================================================ */
.locator-card-items {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px 8px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  margin-top: 6px;
}

.locator-card-items-label {
  font-size: 9px;
  font-weight: 800;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.locator-card-items-codes {
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-size: 11px;
  font-weight: 600;
  color: #0f172a;
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2; /* Limits to 2 lines, then ellipsis */
  -webkit-box-orient: vertical;
  word-break: break-all;
}

/* Adjust card min-height to accommodate the new block */
.locator-card {
  min-height: 200px;
}

/* On small screens, allow more height if needed */
@media (max-width: 480px) {
  .locator-card-items-codes {
    -webkit-line-clamp: 3;
  }
}
`;

export default locatorCss;