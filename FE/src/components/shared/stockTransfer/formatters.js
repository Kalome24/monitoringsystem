// src/components/shared/stockTransfer/formatters.js

// ============================================================
// Shared formatters for the Stock Transfer tabs
// (Dept Head approval + Stock Handler)
//
// Behavior is identical to the local helpers previously defined
// inline in TabStockTransferApproval.jsx and TabStockTransfer.jsx.
// Nothing here touches the DOM or React — pure JS.
// ============================================================

/**
 * Local-date-only string.
 *   - falsy input            → '—'
 *   - unparseable Date       → returns the raw value
 *   - otherwise              → d.toLocaleDateString()
 */
export const formatDate = (v) => {
  if (!v) return '—';
  try {
    const d = new Date(v);
    if (isNaN(d.getTime())) return v;
    return d.toLocaleDateString();
  } catch { return v; }
};

/**
 * Local date+time string.
 *   - falsy input            → '—'
 *   - anything parseable     → d.toLocaleString()
 *   - anything that throws   → returns the raw value
 */
export const formatDateTime = (v) => {
  if (!v) return '—';
  try { return new Date(v).toLocaleString(); } catch { return v; }
};

// ------------------------------------------------------------
// Warehouse display helpers
// Convention: name is primary in UI, code is secondary.
// ------------------------------------------------------------

/**
 * Primary warehouse label.
 * Order of preference: name → code → '—'
 */
export const whPrimary = (name, code) => name || code || '—';

/**
 * Secondary warehouse label (the code).
 * Returns '' when either the name or the code is missing — so the
 * caller can safely use it as a truthy guard for rendering.
 */
export const whSecondary = (name, code) => (name && code ? code : '');