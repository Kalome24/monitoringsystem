// src/components/shared/stockTransfer/statusBadge.jsx
import React from 'react';

// ============================================================
// Shared status badge + style map for Stock Transfer slips.
//
// Session 9 F5 — Added a label-override layer so a status like
// 'For Shipping' can render as 'For Transfer' in the UI while
// the color scheme keeps keying off the raw DB value. The DB
// value is unchanged; only the pill's text differs.
//
// Exports:
//   • stsStatusBadgeStyle(status)  → { background, color, border }
//   • stsStatusBadgeLabel(status)  → string shown inside the pill
//   • StatusBadge                  → default + named React component
// ============================================================

/**
 * Pill-style background / color / border for a given STS status.
 * Unknown or empty statuses fall through to the neutral slate look.
 */
export const stsStatusBadgeStyle = (status) => {
  switch (status) {
    case 'Pending':      return { background: '#fef3c7', color: '#92400e', border: '1px solid #fcd34d' };
    case 'For Shipping': return { background: '#dbeafe', color: '#1e40af', border: '1px solid #93c5fd' };
    case 'In-Transit':   return { background: '#e0e7ff', color: '#3730a3', border: '1px solid #a5b4fc' };
    case 'Received':     return { background: '#dcfce7', color: '#065f46', border: '1px solid #86efac' };
    case 'Completed':    return { background: '#dcfce7', color: '#065f46', border: '1px solid #86efac' };
    case 'Rejected':     return { background: '#fee2e2', color: '#991b1b', border: '1px solid #fca5a5' };
    case 'Cancelled':    return { background: '#f1f5f9', color: '#475569', border: '1px solid #cbd5e1' };
    default:             return { background: '#f1f5f9', color: '#475569', border: '1px solid #cbd5e1' };
  }
};

/**
 * User-facing label for a given STS status.
 *
 * The DB value is kept intact ('For Shipping') but the client asked
 * for the pill to read "For Transfer". Any status not listed here
 * renders verbatim — the function is purely additive.
 */
export const stsStatusBadgeLabel = (status) => {
  switch (status) {
    case 'For Shipping': return 'For Transfer';
    default:             return status;
  }
};

/**
 * Renders a status pill.
 * Falls back to the existing `tpm-uom-tag` style with an em-dash when
 * no status is supplied — matches both tabs' previous behavior exactly.
 */
export const StatusBadge = ({ status }) => {
  if (!status) return <span className="tpm-uom-tag">—</span>;

  const label = stsStatusBadgeLabel(status);

  return (
    <span
      style={{
        display: 'inline-block',
        padding: '4px 12px',
        borderRadius: 999,
        fontSize: 11.5,
        fontWeight: 700,
        letterSpacing: '0.03em',
        whiteSpace: 'nowrap',
        ...stsStatusBadgeStyle(status),
      }}
    >
      {label}
    </span>
  );
};

export default StatusBadge;