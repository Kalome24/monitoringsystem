// src/components/shared/stockTransfer/SkeletonRows.jsx
import React from 'react';

// ============================================================
// Skeleton loading placeholders for the Stock Transfer tabs.
//
// Two exports:
//   • SkeletonTable — fake table body rows (desktop path)
//   • SkeletonCards — fake mobile cards (mobile path)
//
// Both accept a `rows` prop (default 5 / 4). Both are marked
// aria-hidden so assistive tech skips them entirely.
//
// Styling comes from the .sk-* rules in the shared tab CSS
// (stockTransferTabCss.js). The palette is neutral slate so
// the same skeleton works for both tabs — no theme prop.
// ============================================================

/**
 * Desktop skeleton: renders a set of shimmer rows that visually
 * mimic a table body while the real data loads.
 *
 * Column widths approximate the real tsa-table / tsc-table
 * columns so the swap feels seamless.
 */
export const SkeletonTable = ({ rows = 5 }) => {
  const count = Math.max(1, Math.min(20, Number(rows) || 5));
  return (
    <div className="sk-table" aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="sk-row">
          {/* Item cell: thumb + two stacked lines */}
          <div className="sk-cell sk-cell--item">
            <span className="sk-shimmer sk-thumb" />
            <span className="sk-lines">
              <span className="sk-shimmer sk-line sk-line--short" />
              <span className="sk-shimmer sk-line sk-line--med" />
            </span>
          </div>

          {/* STS No. */}
          <div className="sk-cell sk-cell--sts">
            <span className="sk-shimmer sk-line sk-line--med" />
          </div>

          {/* Route / Warehouse */}
          <div className="sk-cell sk-cell--wh">
            <span className="sk-shimmer sk-line sk-line--med" />
            <span className="sk-shimmer sk-line sk-line--short" />
          </div>

          {/* Submitted By */}
          <div className="sk-cell sk-cell--by">
            <span className="sk-shimmer sk-line sk-line--med" />
          </div>

          {/* Date */}
          <div className="sk-cell sk-cell--date">
            <span className="sk-shimmer sk-line sk-line--short" />
          </div>

          {/* Lines / Qty */}
          <div className="sk-cell sk-cell--qty">
            <span className="sk-shimmer sk-line sk-line--short" />
          </div>

          {/* Status pill */}
          <div className="sk-cell sk-cell--status">
            <span className="sk-shimmer sk-pill" />
          </div>

          {/* Actions */}
          <div className="sk-cell sk-cell--actions">
            <span className="sk-shimmer sk-btn" />
          </div>
        </div>
      ))}
    </div>
  );
};

/**
 * Mobile skeleton: renders a set of shimmer cards matching the
 * real .po-card layout while the real data loads.
 */
export const SkeletonCards = ({ rows = 4 }) => {
  const count = Math.max(1, Math.min(20, Number(rows) || 4));
  return (
    <div className="sk-cards" aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="sk-card">
          <div className="sk-card-row">
            <div className="sk-cell sk-cell--item">
              <span className="sk-shimmer sk-thumb" />
              <span className="sk-lines">
                <span className="sk-shimmer sk-line sk-line--short" />
                <span className="sk-shimmer sk-line sk-line--med" />
              </span>
            </div>
            <span className="sk-shimmer sk-pill" />
          </div>

          <div className="sk-card-row">
            <span className="sk-shimmer sk-line sk-line--med" />
          </div>

          <div className="sk-card-row">
            <span className="sk-shimmer sk-line sk-line--long" />
            <span className="sk-shimmer sk-line sk-line--med" />
          </div>

          <div className="sk-card-row sk-card-row--actions">
            <span className="sk-shimmer sk-btn" />
          </div>
        </div>
      ))}
    </div>
  );
};

export default SkeletonTable;