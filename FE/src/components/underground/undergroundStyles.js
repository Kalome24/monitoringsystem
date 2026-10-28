// src/components/underground/undergroundStyles.js
//
// All CSS for the Underground Handler UI (dashboard, inventory, history,
// modals). Kept in one file so the shell imports a single <style>.
//
// Prefixes:
//   ug-       → shared
//   ugdash-   → dashboard
//   uginv-    → inventory
//   ughist-   → history
//   ugmodal-  → modals (seed / release / close)

export const undergroundCss = `
/* ============================================================
   ROOT TOKENS
   ============================================================ */
.ug-root {
  --ug-accent:        #00d2c8;
  --ug-accent-strong: #00b8b0;
  --ug-accent-dark:   #008a82;
  --ug-accent-soft:   rgba(0, 210, 200, 0.12);
  --ug-accent-glow:   rgba(0, 210, 200, 0.35);

  --ug-amber:        #f59e0b;
  --ug-amber-soft:   rgba(245, 158, 11, 0.12);
  --ug-amber-strong: #b45309;

  --ug-red:        #dc2626;
  --ug-red-soft:   rgba(220, 38, 38, 0.10);
  --ug-red-strong: #991b1b;

  --ug-green:        #10b981;
  --ug-green-soft:   rgba(16, 185, 129, 0.12);
  --ug-green-strong: #047857;

  --ug-slate-900: #0f172a;
  --ug-slate-800: #1e293b;
  --ug-slate-700: #334155;
  --ug-slate-500: #64748b;
  --ug-slate-400: #94a3b8;
  --ug-slate-200: #e2e8f0;
  --ug-slate-100: #f1f5f9;
  --ug-slate-50:  #f8fafc;

  --ug-radius-sm: 8px;
  --ug-radius:    12px;
  --ug-radius-lg: 16px;

  --ug-shadow-card:  0 1px 2px rgba(15, 23, 42, 0.04), 0 4px 12px rgba(15, 23, 42, 0.03);
  --ug-shadow-hover: 0 4px 14px rgba(15, 23, 42, 0.08), 0 12px 32px rgba(15, 23, 42, 0.06);
  --ug-shadow-modal: 0 24px 60px rgba(15, 23, 42, 0.28), 0 4px 14px rgba(15, 23, 42, 0.14);
}

/* ============================================================
   SECTION CONTAINER — reuse the same "items-section" chrome
   so the underground UI looks native next to other tabs.
   ============================================================ */
.ug-section {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: clamp(14px, 1.6vw, 22px);
}

/* ============================================================
   SUB-TABS — same visual language as locator sub-tabs.
   ============================================================ */
.ug-subtabs {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 4px;
  background: var(--ug-slate-100);
  border: 1px solid var(--ug-slate-200);
  border-radius: 10px;
  width: 100%;
  max-width: 560px;
  box-sizing: border-box;
}

.ug-subtab {
  flex: 1 1 0;
  min-width: 0;
  min-height: 40px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 8px 14px;
  background: transparent;
  border: none;
  border-radius: 8px;
  color: var(--ug-slate-700);
  font: inherit;
  font-size: 13.5px;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.16s ease, color 0.16s ease, box-shadow 0.16s ease;
}
.ug-subtab:hover:not(.is-active) {
  color: var(--ug-slate-900);
  background: rgba(255, 255, 255, 0.55);
}
.ug-subtab.is-active {
  background: #ffffff;
  color: var(--ug-accent-dark);
  box-shadow:
    0 1px 3px rgba(15, 23, 42, 0.08),
    0 0 0 1px var(--ug-accent-glow);
}
.ug-subtab:focus-visible {
  outline: 2px solid var(--ug-accent-strong);
  outline-offset: 2px;
}
.ug-subtab-icon {
  width: 15px;
  height: 15px;
  flex-shrink: 0;
}

@media (max-width: 480px) {
  .ug-subtabs { max-width: 100%; }
  .ug-subtab  { min-height: 44px; font-size: 12.5px; padding: 6px 8px; gap: 6px; }
  .ug-subtab-icon { width: 14px; height: 14px; }
  .ug-subtab > span { overflow: hidden; text-overflow: ellipsis; }
}

@media (max-width: 360px) {
  .ug-subtab { font-size: 11.5px; padding: 6px 4px; gap: 4px; }
  .ug-subtab-icon { width: 12px; height: 12px; }
}

/* ============================================================
   HEADER TOOLBAR — title + shift-state pill + actions
   ============================================================ */
.ug-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: clamp(10px, 1.4vw, 20px);
  flex-wrap: wrap;
  width: 100%;
}

.ug-header-left {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  flex-wrap: wrap;
}

.ug-header-icon {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #00e0d4 0%, #008a82 100%);
  color: #ffffff;
  flex-shrink: 0;
  box-shadow: 0 4px 12px rgba(0, 200, 190, 0.32);
}
.ug-header-icon svg { width: 20px; height: 20px; stroke-width: 2.2; }

.ug-header-info { min-width: 0; }
.ug-header-title {
  margin: 0;
  font-size: clamp(16px, 1.7vw, 20px);
  font-weight: 800;
  color: var(--ug-slate-900);
  line-height: 1.15;
  letter-spacing: -0.01em;
}
.ug-header-sub {
  margin-top: 2px;
  font-size: clamp(11px, 1.1vw, 12.5px);
  color: var(--ug-slate-500);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}

.ug-header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

/* ---------- Shift state pill ---------- */
.ug-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 999px;
  font-size: 11.5px;
  font-weight: 800;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  border: 1px solid transparent;
  white-space: nowrap;
}
.ug-pill-dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: currentColor;
  flex-shrink: 0;
}
.ug-pill--open       { background: var(--ug-green-soft);  border-color: #6ee7b7; color: var(--ug-green-strong); }
.ug-pill--closed     { background: var(--ug-amber-soft);  border-color: #fcd34d; color: var(--ug-amber-strong); }
.ug-pill--reconciled { background: rgba(59, 130, 246, 0.10); border-color: #93c5fd; color: #1d4ed8; }
.ug-pill--rejected   { background: var(--ug-red-soft);    border-color: #fca5a5; color: var(--ug-red-strong); }
.ug-pill--none       { background: var(--ug-slate-100);   border-color: var(--ug-slate-200); color: var(--ug-slate-500); }
.ug-pill--open .ug-pill-dot {
  animation: ugPulse 1.8s ease-in-out infinite;
  box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.25);
}
@keyframes ugPulse {
  0%, 100% { box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.25); }
  50%      { box-shadow: 0 0 0 6px rgba(16, 185, 129, 0.05); }
}

@media (max-width: 480px) {
  .ug-header { flex-direction: column; align-items: stretch; }
  .ug-header-actions { justify-content: flex-start; }
  .ug-header-icon { width: 36px; height: 36px; border-radius: 9px; }
  .ug-header-icon svg { width: 18px; height: 18px; }
}

/* ============================================================
   BUTTONS
   ============================================================ */
.ug-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 40px;
  padding: 9px 16px;
  border-radius: 8px;
  border: 1px solid transparent;
  font-family: inherit;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.01em;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.15s ease, border-color 0.15s ease,
              color 0.15s ease, box-shadow 0.15s ease, transform 0.1s ease;
}
.ug-btn svg { width: 15px; height: 15px; stroke-width: 2.4; flex-shrink: 0; }
.ug-btn:focus-visible { outline: 2px solid var(--ug-accent-strong); outline-offset: 2px; }
.ug-btn:disabled { opacity: 0.5; cursor: not-allowed; transform: none !important; box-shadow: none !important; }

/* Primary */
.ug-btn--primary {
  background: #00b8b0;
  color: #ffffff;
  border-color: #007a72;
  text-shadow: 0 1px 1px rgba(0, 0, 0, 0.16);
  box-shadow:
    0 1px 0 rgba(255, 255, 255, 0.28) inset,
    0 2px 4px rgba(0, 122, 114, 0.24),
    0 6px 16px rgba(0, 184, 176, 0.24);
}
.ug-btn--primary:hover:not(:disabled) {
  transform: translateY(-1px);
  background: #00d4cb;
  box-shadow:
    0 1px 0 rgba(255, 255, 255, 0.4) inset,
    0 4px 10px rgba(0, 122, 114, 0.32),
    0 14px 32px rgba(0, 184, 176, 0.4);
}

/* Secondary */
.ug-btn--secondary {
  background: #ffffff;
  color: var(--ug-slate-800);
  border-color: #94a3b8;
  box-shadow:
    0 1px 0 rgba(255, 255, 255, 0.9) inset,
    0 1px 3px rgba(15, 23, 42, 0.08);
}
.ug-btn--secondary:hover:not(:disabled) {
  transform: translateY(-1px);
  background: #f0fdfa;
  border-color: var(--ug-accent-strong);
  color: var(--ug-accent-dark);
  box-shadow:
    0 1px 0 rgba(255, 255, 255, 1) inset,
    0 4px 10px rgba(0, 184, 176, 0.18);
}

/* Danger */
.ug-btn--danger {
  background: #dc2626;
  color: #ffffff;
  border-color: #991b1b;
  text-shadow: 0 1px 1px rgba(0, 0, 0, 0.18);
  box-shadow:
    0 1px 0 rgba(255, 255, 255, 0.24) inset,
    0 2px 4px rgba(153, 27, 27, 0.24),
    0 6px 16px rgba(220, 38, 38, 0.24);
}
.ug-btn--danger:hover:not(:disabled) {
  transform: translateY(-1px);
  background: #ef4444;
}

/* Ghost */
.ug-btn--ghost {
  background: transparent;
  color: var(--ug-slate-700);
  border-color: transparent;
}
.ug-btn--ghost:hover:not(:disabled) {
  background: var(--ug-slate-100);
  color: var(--ug-slate-900);
}

/* Small variant */
.ug-btn--sm {
  min-height: 32px;
  padding: 6px 12px;
  font-size: 12px;
  gap: 5px;
}
.ug-btn--sm svg { width: 13px; height: 13px; }

/* Full-width on phones */
@media (max-width: 480px) {
  .ug-btn { min-height: 44px; }
  .ug-header-actions .ug-btn { flex: 1 1 auto; }
}

/* ============================================================
   CARDS
   ============================================================ */
.ug-card {
  background: #ffffff;
  border: 1px solid rgba(15, 23, 42, 0.06);
  border-radius: var(--ug-radius);
  padding: clamp(14px, 1.8vw, 22px);
  box-shadow: var(--ug-shadow-card);
}

.ug-card-title {
  margin: 0 0 12px;
  font-size: clamp(14px, 1.4vw, 16px);
  font-weight: 700;
  color: var(--ug-slate-900);
  display: flex;
  align-items: center;
  gap: 8px;
  line-height: 1.25;
}
.ug-card-title::before {
  content: '';
  display: inline-block;
  width: 4px;
  height: 16px;
  background: linear-gradient(180deg, var(--ug-accent) 0%, var(--ug-accent-dark) 100%);
  border-radius: 2px;
  flex-shrink: 0;
}

/* ============================================================
   STATS GRID (dashboard)
   ============================================================ */
.ugdash-stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: clamp(10px, 1.2vw, 16px);
}

.ugdash-stat {
  position: relative;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 18px;
  background: #ffffff;
  border: 1px solid rgba(15, 23, 42, 0.06);
  border-radius: var(--ug-radius);
  box-shadow: var(--ug-shadow-card);
  overflow: hidden;
  min-height: 84px;
  transition: transform 0.24s cubic-bezier(0.34, 1.4, 0.64, 1), box-shadow 0.24s ease;
}
.ugdash-stat::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  right: 0;
  width: 5px;
  background: linear-gradient(180deg, var(--ug-tone-a, #00e0d4) 0%, var(--ug-tone-b, #008a82) 100%);
  box-shadow: -2px 0 14px var(--ug-tone-shadow, rgba(0, 210, 200, 0.35));
  pointer-events: none;
}
.ugdash-stat:hover {
  transform: translateY(-3px);
  box-shadow: var(--ug-shadow-hover);
}

.ugdash-stat-icon {
  width: 46px;
  height: 46px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  background: linear-gradient(135deg, var(--ug-tone-a, #00e0d4) 0%, var(--ug-tone-b, #008a82) 100%);
  color: #ffffff;
  box-shadow:
    0 1px 0 rgba(255, 255, 255, 0.28) inset,
    0 4px 12px var(--ug-tone-shadow, rgba(0, 210, 200, 0.28));
}
.ugdash-stat-icon svg { width: 22px; height: 22px; stroke-width: 2.2; }

.ugdash-stat-info { min-width: 0; flex: 1; }
.ugdash-stat-value {
  display: block;
  font-size: clamp(20px, 2.2vw, 26px);
  font-weight: 800;
  color: var(--ug-slate-900);
  line-height: 1.05;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
}
.ugdash-stat-label {
  display: block;
  font-size: 11px;
  font-weight: 700;
  color: var(--ug-slate-500);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-top: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Tones */
.ugdash-stat--seed   { --ug-tone-a: #00e0d4; --ug-tone-b: #008a82; --ug-tone-shadow: rgba(0, 210, 200, 0.30); }
.ugdash-stat--rel    { --ug-tone-a: #fbbf24; --ug-tone-b: #d97706; --ug-tone-shadow: rgba(217, 119, 6, 0.30); }
.ugdash-stat--qty    { --ug-tone-a: #818cf8; --ug-tone-b: #4338ca; --ug-tone-shadow: rgba(99, 102, 241, 0.30); }
.ugdash-stat--value  { --ug-tone-a: #34d399; --ug-tone-b: #047857; --ug-tone-shadow: rgba(16, 185, 129, 0.30); }

@media (max-width: 1100px) {
  .ugdash-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 480px) {
  .ugdash-stats { grid-template-columns: 1fr; gap: 10px; }
  .ugdash-stat { padding: 12px 14px; min-height: 72px; }
  .ugdash-stat-icon { width: 40px; height: 40px; border-radius: 10px; }
  .ugdash-stat-icon svg { width: 18px; height: 18px; }
}

/* ============================================================
   DASHBOARD: two-column layout for shift info + recent shifts
   ============================================================ */
.ugdash-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr);
  gap: clamp(12px, 1.6vw, 20px);
}
@media (max-width: 1024px) {
  .ugdash-grid { grid-template-columns: 1fr; }
}

/* Key-value rows inside shift info */
.ugdash-kv {
  display: grid;
  grid-template-columns: minmax(140px, 0.6fr) minmax(0, 1fr);
  gap: 10px 16px;
  margin: 0;
}
.ugdash-kv dt {
  font-size: 11px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--ug-slate-500);
  align-self: center;
}
.ugdash-kv dd {
  margin: 0;
  font-size: 13.5px;
  font-weight: 600;
  color: var(--ug-slate-800);
  word-break: break-word;
}
.ugdash-kv dd.is-mono {
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-size: 12.5px;
}
.ugdash-kv dd.is-muted { color: var(--ug-slate-400); font-weight: 500; }

@media (max-width: 480px) {
  .ugdash-kv { grid-template-columns: 1fr; gap: 6px; }
  .ugdash-kv dt { margin-top: 6px; }
}

/* Recent shifts list */
.ugdash-recent { display: flex; flex-direction: column; gap: 8px; }

.ugdash-recent-item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  background: var(--ug-slate-50);
  border: 1px solid var(--ug-slate-200);
  border-radius: 10px;
  transition: background 0.15s ease, border-color 0.15s ease;
}
.ugdash-recent-item:hover {
  background: #f0fdfa;
  border-color: var(--ug-accent-strong);
}
.ugdash-recent-main { min-width: 0; }
.ugdash-recent-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--ug-slate-800);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ugdash-recent-meta {
  font-size: 11px;
  color: var(--ug-slate-500);
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Empty / loading */
.ug-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 32px 16px;
  text-align: center;
  color: var(--ug-slate-500);
  border: 1px dashed var(--ug-slate-200);
  border-radius: 10px;
  background: var(--ug-slate-50);
}
.ug-empty svg { width: 36px; height: 36px; color: var(--ug-slate-400); }
.ug-empty-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--ug-slate-700);
}
.ug-empty-sub {
  font-size: 12.5px;
  max-width: 42ch;
  line-height: 1.5;
}

.ug-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 32px 16px;
  color: var(--ug-slate-500);
  font-size: 13px;
}

.ug-error {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  background: var(--ug-red-soft);
  border: 1px solid #fecaca;
  border-left: 4px solid var(--ug-red);
  border-radius: 10px;
  color: var(--ug-red-strong);
  font-size: 13px;
}
.ug-error svg { width: 18px; height: 18px; flex-shrink: 0; }
.ug-error button {
  margin-left: auto;
  padding: 6px 12px;
  border: 1px solid var(--ug-red);
  background: transparent;
  color: var(--ug-red);
  border-radius: 8px;
  font: inherit;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}
.ug-error button:hover { background: var(--ug-red); color: #ffffff; }

/* Spinner utility */
.ug-spin {
  animation: ugSpin 0.9s linear infinite;
  display: inline-block;
}
@keyframes ugSpin { to { transform: rotate(360deg); } }

/* ============================================================
   INVENTORY toolbar + table
   ============================================================ */
.uginv-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding: 10px 12px;
  background: var(--ug-slate-50);
  border: 1px solid var(--ug-slate-200);
  border-radius: 10px;
}
.uginv-search {
  position: relative;
  flex: 1 1 260px;
  min-width: 0;
  max-width: 480px;
}
.uginv-search svg {
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--ug-slate-400);
  width: 15px;
  height: 15px;
  pointer-events: none;
}
.uginv-search input {
  width: 100%;
  min-height: 40px;
  padding: 10px 14px 10px 36px;
  border: 1.5px solid var(--ug-slate-200);
  border-radius: 8px;
  background: #ffffff;
  font: inherit;
  font-size: 14px;
  color: var(--ug-slate-900);
  box-sizing: border-box;
  outline: none;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.uginv-search input:focus {
  border-color: var(--ug-accent);
  box-shadow: 0 0 0 3px rgba(0, 210, 200, 0.15);
}

.uginv-table-wrap {
  width: 100%;
  overflow-x: auto;
  border: 1px solid var(--ug-slate-200);
  border-radius: 12px;
  background: #ffffff;
  -webkit-overflow-scrolling: touch;
}
.uginv-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  min-width: 900px;
}
.uginv-table thead th {
  position: sticky;
  top: 0;
  z-index: 1;
  text-align: left;
  padding: 12px 14px;
  font-size: 10.5px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  font-weight: 800;
  color: var(--ug-slate-500);
  background: var(--ug-slate-50);
  border-bottom: 1px solid var(--ug-slate-200);
  white-space: nowrap;
}
.uginv-table tbody td {
  padding: 12px 14px;
  border-bottom: 1px solid #f1f5f9;
  color: var(--ug-slate-800);
  vertical-align: middle;
}
.uginv-table tbody tr:last-child td { border-bottom: none; }
.uginv-table tbody tr:hover { background: #f0fdfa; }

.uginv-num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.uginv-num--cur { color: var(--ug-green-strong); font-weight: 700; }

.uginv-code {
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-weight: 700;
  font-size: 12.5px;
  color: var(--ug-slate-900);
}
.uginv-tag--piece {
  display: inline-flex;
  align-items: center;
  padding: 2px 6px;
  background: #eef2ff;
  color: #4338ca;
  border: 1px solid #c7d2fe;
  border-radius: 4px;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.05em;
  line-height: 1.2;
}
.uginv-name {
  font-size: 11px;
  color: var(--ug-slate-500);
  margin-top: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 260px;
}

/* Colored Columns */
.uginv-color-issued { color: #16a34a !important; font-weight: 700 !important; }
.uginv-color-damaged { color: #dc2626 !important; font-weight: 700 !important; }
.uginv-color-transferred { color: #2563eb !important; font-weight: 700 !important; }

/* Bodega Group Header */
.uginv-bodega-header td {
  padding: 14px 24px;
  background: linear-gradient(90deg, #f8fafc 0%, #ffffff 100%);
  border-top: 2px solid #e2e8f0;
  border-bottom: 1px solid #e2e8f0;
  font-weight: 800;
  color: #0f766e;
  font-size: 13.5px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.uginv-bodega-header svg { margin-right: 8px; vertical-align: -2px; color: #00b8b0; }

/* On Hand Highlight Pill */
.uginv-onhand-pill {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 6px 12px;
  border-radius: 8px;
  background: #f0fdfa;
  border: 1.5px solid #5eead4;
  color: #0f766e;
  font-weight: 800;
  font-family: 'JetBrains Mono', monospace;
  box-shadow: 0 1px 2px rgba(0,0,0,0.05);
}
.uginv-qty-breakdown {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 2px;
  line-height: 1.2;
}
.uginv-qty-total { font-weight: 800; color: #0f172a; font-size: 14px; }
.uginv-qty-detail {
  display: inline-flex; align-items: center; justify-content: center; gap: 4px;
  font-size: 10.5px; font-weight: 700; color: #0f766e;
  background: #ffffff; border: 1px solid #99f6e4; border-radius: 4px; padding: 1px 6px;
}
.uginv-qty-detail svg { width: 10px; height: 10px; stroke-width: 2.6; }

/* Mobile card list — replaces the table ≤ 900px */
.uginv-cardlist { display: none; flex-direction: column; gap: 10px; }
.uginv-card {
  background: #ffffff;
  border: 1px solid var(--ug-slate-200);
  border-radius: 12px;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.uginv-card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}
.uginv-card-head-info { min-width: 0; }
.uginv-card-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px 12px;
  margin: 0;
}
.uginv-card-grid dt {
  font-size: 10px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--ug-slate-500);
  margin: 0;
}
.uginv-card-grid dd {
  margin: 2px 0 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--ug-slate-900);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.uginv-card-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 8px;
  border-top: 1px dashed var(--ug-slate-200);
}

/* Mobile Movement Grid */
.uginv-card-moves {
  display: grid; grid-template-columns: 1fr 1fr; gap: 8px;
  margin-top: 12px; padding-top: 12px; border-top: 1px dashed var(--ug-slate-200);
}
.uginv-move-item { display: flex; flex-direction: column; gap: 2px; }
.uginv-move-label { font-size: 10px; font-weight: 700; color: var(--ug-slate-500); text-transform: uppercase; }
.uginv-move-val { font-family: 'JetBrains Mono', monospace; font-size: 13px; font-weight: 700; }

@media (max-width: 900px) {
  .uginv-table-wrap { display: none; }
  .uginv-cardlist  { display: flex; }
}
@media (max-width: 480px) {
  .uginv-onhand-pill { align-items: flex-start; padding: 4px 10px; }
  .uginv-qty-breakdown { align-items: flex-start; text-align: left; }
}
@media (max-width: 360px) {
  .uginv-card-grid { grid-template-columns: 1fr; gap: 4px; }
}

/* ============================================================
   HISTORY — reuses the same shape as LocatorSyncHistory
   ============================================================ */
.ughist-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.ughist-search {
  position: relative;
  flex: 1 1 260px;
  min-width: 0;
}
.ughist-search svg {
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--ug-slate-400);
  width: 15px;
  height: 15px;
  pointer-events: none;
}
.ughist-search input {
  width: 100%;
  min-height: 42px;
  padding: 10px 14px 10px 36px;
  border: 1.5px solid var(--ug-slate-200);
  border-radius: 10px;
  background: #ffffff;
  font: inherit;
  font-size: 14px;
  color: var(--ug-slate-900);
  box-sizing: border-box;
  outline: none;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.ughist-search input:focus {
  border-color: var(--ug-accent);
  box-shadow: 0 0 0 3px rgba(0, 210, 200, 0.15);
}

.ughist-table-wrap {
  overflow-x: auto;
  border: 1px solid var(--ug-slate-200);
  border-radius: 12px;
  background: #ffffff;
  -webkit-overflow-scrolling: touch;
}
.ughist-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  min-width: 980px;
}
.ughist-table thead th {
  text-align: left;
  padding: 12px 14px;
  font-size: 10.5px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  font-weight: 800;
  color: var(--ug-slate-500);
  background: var(--ug-slate-50);
  border-bottom: 1px solid var(--ug-slate-200);
  white-space: nowrap;
  position: sticky;
  top: 0;
  z-index: 1;
}
.ughist-table tbody td {
  padding: 12px 14px;
  border-bottom: 1px solid #f1f5f9;
  color: var(--ug-slate-800);
  vertical-align: middle;
}
.ughist-table tbody tr:last-child td { border-bottom: none; }
.ughist-row { cursor: pointer; transition: background 0.12s ease; }
.ughist-row:hover { background: #f0fdfa; }
.ughist-row:focus-visible {
  outline: 2px solid var(--ug-accent-strong);
  outline-offset: -2px;
  background: #f0fdfa;
}
.ughist-num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.ughist-num--cur { color: var(--ug-green-strong); font-weight: 700; }

.ughist-uid {
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-weight: 800;
  font-size: 12.5px;
  color: var(--ug-accent-dark);
  white-space: nowrap;
}

.ughist-cardlist { display: none; flex-direction: column; gap: 10px; }
.ughist-card {
  background: #ffffff;
  border: 1px solid var(--ug-slate-200);
  border-radius: 10px;
  padding: 12px 14px;
  cursor: pointer;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.06);
  transition: box-shadow 0.12s ease;
}
.ughist-card:hover { box-shadow: var(--ug-shadow-hover); }
.ughist-card-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}
.ughist-card-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px 12px;
  margin: 0;
}
.ughist-card-grid dt {
  font-size: 10px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--ug-slate-500);
  margin: 0;
}
.ughist-card-grid dd {
  margin: 2px 0 0;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--ug-slate-900);
  overflow: hidden;
  text-overflow: ellipsis;
}
.ughist-card-grid dd.ughist-num--cur { color: var(--ug-green-strong); }

@media (max-width: 900px) {
  .ughist-table-wrap { display: none; }
  .ughist-cardlist  { display: flex; }
}

/* Pagination */
.ughist-pagination {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 12px 4px;
}
.ughist-pagination-info { font-size: 12.5px; color: var(--ug-slate-500); }
.ughist-pagination-info strong { color: var(--ug-slate-900); }
.ughist-pagination-controls {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
  justify-content: center;
}
.ughist-page-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 34px;
  height: 34px;
  padding: 0 8px;
  border: 1px solid var(--ug-slate-200);
  border-radius: 8px;
  background: #ffffff;
  color: var(--ug-slate-700);
  font: inherit;
  font-size: 12.5px;
  font-weight: 700;
  cursor: pointer;
  transition: border-color 0.12s ease, background 0.12s ease, color 0.12s ease;
}
.ughist-page-btn:hover:not(:disabled) {
  border-color: var(--ug-accent-strong);
  background: #f0fdfa;
  color: var(--ug-accent-dark);
}
.ughist-page-btn.is-active {
  background: var(--ug-accent-strong);
  border-color: var(--ug-accent-strong);
  color: #ffffff;
}
.ughist-page-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.ughist-page-btn svg { width: 14px; height: 14px; }
.ughist-page-ellipsis { padding: 0 4px; color: var(--ug-slate-400); font-weight: 700; }

@media (min-width: 641px) {
  .ughist-pagination { flex-direction: row; justify-content: space-between; }
  .ughist-pagination-info { text-align: left; }
}

/* ============================================================
   MODALS — seed import / release / shift close
   Shared shell (.ugmodal-*) + per-modal body classes.
   ============================================================ */
.ugmodal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.6);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: clamp(8px, 2vw, 24px);
  z-index: 10000;
  animation: ugFadeIn 0.16s ease-out;
}
@keyframes ugFadeIn { from { opacity: 0; } to { opacity: 1; } }

.ugmodal-card {
  background: #ffffff;
  border-radius: var(--ug-radius-lg);
  width: 100%;
  max-width: 560px;
  max-height: 92vh;
  max-height: 92dvh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: var(--ug-shadow-modal);
  animation: ugSlideUp 0.22s cubic-bezier(0.34, 1.3, 0.64, 1);
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}
.ugmodal-card--wide { max-width: 840px; }

@keyframes ugSlideUp {
  from { opacity: 0; transform: translateY(16px) scale(0.98); }
  to   { opacity: 1; transform: translateY(0)    scale(1); }
}

.ugmodal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: clamp(14px, 1.8vw, 20px) clamp(16px, 2.2vw, 22px);
  border-bottom: 1px solid var(--ug-slate-200);
  background: linear-gradient(135deg, #ffffff 0%, #f8fafc 100%);
  flex-shrink: 0;
}
.ugmodal-header-left {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  flex: 1;
}
.ugmodal-header-icon {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #00e0d4 0%, #008a82 100%);
  color: #ffffff;
  flex-shrink: 0;
  box-shadow: 0 4px 12px rgba(0, 200, 190, 0.32);
}
.ugmodal-header-icon svg { width: 20px; height: 20px; stroke-width: 2.2; }
.ugmodal-title {
  margin: 0;
  font-size: clamp(15px, 1.5vw, 17px);
  font-weight: 800;
  color: var(--ug-slate-900);
  line-height: 1.2;
}
.ugmodal-sub {
  margin-top: 2px;
  font-size: 12px;
  color: var(--ug-slate-500);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ugmodal-close {
  width: 34px;
  height: 34px;
  border-radius: 8px;
  border: none;
  background: transparent;
  color: var(--ug-slate-500);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: background 0.15s ease, color 0.15s ease;
}
.ugmodal-close:hover { background: var(--ug-slate-100); color: var(--ug-slate-900); }
.ugmodal-close svg { width: 18px; height: 18px; }
.ugmodal-close:disabled { opacity: 0.4; cursor: not-allowed; }

.ugmodal-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: clamp(16px, 2vw, 22px);
  display: flex;
  flex-direction: column;
  gap: 14px;
  background: #ffffff;
  -webkit-overflow-scrolling: touch;
}
.ugmodal-body::-webkit-scrollbar { width: 8px; }
.ugmodal-body::-webkit-scrollbar-track { background: var(--ug-slate-100); border-radius: 4px; }
.ugmodal-body::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 4px; }
.ugmodal-body::-webkit-scrollbar-thumb:hover { background: var(--ug-slate-400); }

.ugmodal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: clamp(12px, 1.6vw, 16px) clamp(16px, 2.2vw, 22px);
  border-top: 1px solid var(--ug-slate-200);
  background: var(--ug-slate-50);
  flex-shrink: 0;
}

.ugmodal-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ugmodal-label {
  font-size: 13px;
  font-weight: 700;
  color: var(--ug-slate-700);
}
.ugmodal-required { color: var(--ug-red); }
.ugmodal-hint {
  font-size: 11.5px;
  color: var(--ug-slate-500);
  margin-top: 2px;
}
.ugmodal-input,
.ugmodal-select,
.ugmodal-textarea {
  width: 100%;
  padding: 10px 12px;
  border: 1.5px solid var(--ug-slate-200);
  border-radius: 8px;
  font-size: 14px;
  font-family: inherit;
  color: var(--ug-slate-900);
  outline: none;
  background: #ffffff;
  box-sizing: border-box;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.ugmodal-input:focus,
.ugmodal-select:focus,
.ugmodal-textarea:focus {
  border-color: var(--ug-accent);
  box-shadow: 0 0 0 3px rgba(0, 210, 200, 0.15);
}
.ugmodal-input:disabled,
.ugmodal-select:disabled,
.ugmodal-textarea:disabled {
  background: var(--ug-slate-50);
  color: var(--ug-slate-400);
  cursor: not-allowed;
}
.ugmodal-textarea {
  min-height: 80px;
  resize: vertical;
  font-family: inherit;
}
select.ugmodal-select { cursor: pointer; }

/* Inline row (two fields side by side, collapses on narrow) */
.ugmodal-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 12px;
}
@media (max-width: 520px) {
  .ugmodal-row { grid-template-columns: 1fr; }
}

/* Seed import: list of available exports */
.ugmodal-seed-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 320px;
  overflow-y: auto;
  padding-right: 4px;
}
.ugmodal-seed-item {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  width: 100%;
  padding: 12px 14px;
  background: #ffffff;
  border: 1.5px solid var(--ug-slate-200);
  border-radius: 10px;
  cursor: pointer;
  text-align: left;
  font-family: inherit;
  transition: border-color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease;
}
.ugmodal-seed-item:hover {
  border-color: var(--ug-accent-strong);
  background: #f0fdfa;
}
.ugmodal-seed-item.is-selected {
  border-color: var(--ug-accent);
  background: #f0fdfa;
  box-shadow: 0 0 0 3px rgba(0, 210, 200, 0.14);
}
.ugmodal-seed-item-main { flex: 1; min-width: 0; }
.ugmodal-seed-item-title {
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-size: 13px;
  font-weight: 800;
  color: var(--ug-accent-dark);
  margin-bottom: 2px;
}
.ugmodal-seed-item-meta {
  font-size: 11.5px;
  color: var(--ug-slate-500);
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
}
.ugmodal-seed-item-meta strong { color: var(--ug-slate-700); }

/* Release: line editor */
.ugmodal-release-line {
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) minmax(0, 1.6fr) 110px auto;
  gap: 8px;
  align-items: end;
}
@media (max-width: 720px) {
  .ugmodal-release-line {
    grid-template-columns: 1fr 1fr;
  }
  .ugmodal-release-line .ugmodal-field--qty { grid-column: 1 / 2; }
  .ugmodal-release-line .ugmodal-field--remove { grid-column: 2 / 3; justify-self: end; }
}
@media (max-width: 480px) {
  .ugmodal-release-line { grid-template-columns: 1fr; }
  .ugmodal-release-line .ugmodal-field--qty,
  .ugmodal-release-line .ugmodal-field--remove { grid-column: auto; }
}
.ugmodal-release-line + .ugmodal-release-line {
  padding-top: 12px;
  border-top: 1px dashed var(--ug-slate-200);
}

/* Selected item chip inside release rows */
.ugmodal-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  background: var(--ug-slate-100);
  border-radius: 999px;
  font-size: 11.5px;
  font-weight: 700;
  color: var(--ug-slate-700);
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
}

/* Close-shift summary table */
.ugmodal-summary {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 8px 16px;
  padding: 14px 16px;
  background: var(--ug-slate-50);
  border: 1px solid var(--ug-slate-200);
  border-radius: 10px;
}
.ugmodal-summary dt {
  font-size: 12.5px;
  color: var(--ug-slate-500);
  font-weight: 600;
  margin: 0;
}
.ugmodal-summary dd {
  margin: 0;
  font-size: 13.5px;
  font-weight: 800;
  color: var(--ug-slate-900);
  font-variant-numeric: tabular-nums;
  text-align: right;
  white-space: nowrap;
}
.ugmodal-summary dd.ugmodal-summary--cur { color: var(--ug-green-strong); }

/* Warning banner inside modal */
.ugmodal-warn {
  display: flex;
  gap: 10px;
  padding: 12px 14px;
  background: var(--ug-amber-soft);
  border: 1px solid #fcd34d;
  border-left: 4px solid var(--ug-amber);
  border-radius: 10px;
  color: var(--ug-amber-strong);
  font-size: 12.5px;
  line-height: 1.5;
}
.ugmodal-warn svg { width: 18px; height: 18px; flex-shrink: 0; margin-top: 1px; }

/* Error/feedback banner inside modal */
.ugmodal-feedback {
  display: flex;
  gap: 10px;
  padding: 12px 14px;
  border-radius: 10px;
  font-size: 12.5px;
  line-height: 1.5;
}
.ugmodal-feedback svg { width: 18px; height: 18px; flex-shrink: 0; margin-top: 1px; }
.ugmodal-feedback--error {
  background: var(--ug-red-soft);
  border: 1px solid #fecaca;
  border-left: 4px solid var(--ug-red);
  color: var(--ug-red-strong);
}
.ugmodal-feedback--info {
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  border-left: 4px solid #3b82f6;
  color: #1e40af;
}

/* Fullscreen on phones */
@media (max-width: 640px) {
  .ugmodal-overlay { padding: 0; align-items: stretch; }
  .ugmodal-card {
    max-width: 100vw;
    width: 100vw;
    height: 100vh;
    height: 100dvh;
    max-height: 100vh;
    max-height: 100dvh;
    border-radius: 0;
    animation: none;
  }
  .ugmodal-header { padding: 12px 14px; }
  .ugmodal-header-icon { width: 34px; height: 34px; border-radius: 9px; }
  .ugmodal-header-icon svg { width: 17px; height: 17px; }
  .ugmodal-title { font-size: 15px; }
  .ugmodal-sub { font-size: 11px; }
  .ugmodal-body { padding: 14px; gap: 12px; }
  .ugmodal-input, .ugmodal-select, .ugmodal-textarea { font-size: 16px; min-height: 44px; }
  .ugmodal-footer { padding: 12px 14px; flex-direction: row-reverse; }
  .ugmodal-footer > button { flex: 1; min-height: 44px; }
}
@media (max-width: 380px) {
  .ugmodal-footer { flex-direction: column-reverse; }
  .ugmodal-footer > button { width: 100%; }
}

/* Landscape short viewport */
@media (max-height: 520px) and (orientation: landscape) {
  .ugmodal-overlay { padding: 8px; align-items: center; }
  .ugmodal-card {
    height: auto;
    max-height: 96vh;
    border-radius: 12px;
    max-width: 96vw;
  }
  .ugmodal-header { padding: 8px 14px; }
  .ugmodal-body { padding: 10px 14px; gap: 10px; }
  .ugmodal-footer { padding: 8px 14px; }
}

/* ============================================================
   ACCESSIBILITY / PREFERENCES
   ============================================================ */
@media (prefers-reduced-motion: reduce) {
  .ugmodal-overlay,
  .ugmodal-card { animation: none !important; }
  .ug-spin { animation: none !important; }
  .ugdash-stat,
  .ugdash-stat:hover { transition: none !important; transform: none !important; }
  .ug-pill--open .ug-pill-dot { animation: none !important; }
}

@media (prefers-contrast: high) {
  .ugdash-stat,
  .ug-card,
  .uginv-table-wrap,
  .ughist-table-wrap,
  .ugmodal-card {
    border-color: #000 !important;
    box-shadow: none !important;
  }
  .ug-btn--secondary {
    border-color: #000 !important;
    color: #000 !important;
  }
  .ug-btn--primary,
  .ug-btn--danger {
    border-width: 2px !important;
  }
}

/* Ultra-wide */
@media (min-width: 1921px) {
  .ugdash-stat { min-height: 96px; padding: 20px 22px; }
  .ugdash-stat-icon { width: 52px; height: 52px; }
  .ugdash-stat-value { font-size: 30px; }
  .uginv-table, .ughist-table { font-size: 14px; }
  .ug-subtab { font-size: 14.5px; min-height: 44px; }
}
`;

export default undergroundCss;