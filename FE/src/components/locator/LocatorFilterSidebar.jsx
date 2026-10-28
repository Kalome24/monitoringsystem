// src/components/locator/LocatorFilterSidebar.jsx
//
// Left-hand filter sidebar for the surface handler's Inventory Locator tab.
//
// Layout (top to bottom):
//   1. Header (title + subtitle)
//   2. Warehouse summary — total qty + total value for the caller's warehouse
//   3. "All Locators" reset button
//   4. Condition — All / Good / Damaged (locator_type)
//   5. Purchase Class
//   6. Category
//   7. Status
//
// All filter buttons set the parent's `filter` state through `onSelect`,
// which `LocatorController.list` translates into WHERE clauses.

import React from 'react';
import { FiLayers, FiPackage, FiDollarSign, FiAlertTriangle } from 'react-icons/fi';

/* ============================================================
   Formatters
   ============================================================ */
const intFmt = new Intl.NumberFormat('en-PH');
const curFmt = new Intl.NumberFormat('en-PH', {
  style: 'currency', currency: 'PHP',
  minimumFractionDigits: 4, maximumFractionDigits: 4,
});
const fmtInt = (n) => intFmt.format(Number(n) || 0);
const fmtCur = (n) => curFmt.format(Number(n) || 0);

/* ============================================================
   Condition labels
   ------------------------------------------------------------
   `locator_type` in the DB holds 'Regular' or 'Damage'. We surface
   them to the user as 'Good' and 'Damaged' — clearer business terms.
   ============================================================ */
const CONDITION_OPTIONS = [
  { key: 'all',     label: 'All',     dbValue: null,       tone: 'all' },
  { key: 'good',    label: 'Good',    dbValue: 'Regular',  tone: 'good' },
  { key: 'damaged', label: 'Damaged', dbValue: 'Damage',   tone: 'damaged' },
];

const LocatorFilterSidebar = ({
  filter,
  totalCount,
  purchaseClasses = [],
  categories = [],
  statuses = [],
  locatorTypes = [],
  summary = null,
  onSelect,
}) => {
  /* --------------------------------------------------------
     Active checks
     -------------------------------------------------------- */
  const isActive = (type, value) =>
    filter.type === type && String(filter.value ?? '') === String(value ?? '');

  // Condition uses locator_type under the hood. We match on the DB value.
  const isConditionActive = (dbValue) => {
    if (filter.type !== 'locator_type') return dbValue === null;
    if (dbValue === null) return false;
    return String(filter.value ?? '') === String(dbValue);
  };

  /* --------------------------------------------------------
     Condition counts — pulled from locatorTypes[]
     -------------------------------------------------------- */
  const goodCount    = locatorTypes.find((t) => String(t.value) === 'Regular')?.count || 0;
  const damagedCount = locatorTypes.find((t) => String(t.value) === 'Damage')?.count  || 0;

  const conditionCount = (dbValue) => {
    if (dbValue === null) {
      // "All" count — prefer the summary's locator_count (source of truth)
      return Number(summary?.locator_count) || Number(totalCount) || 0;
    }
    if (dbValue === 'Regular') return goodCount;
    if (dbValue === 'Damage')  return damagedCount;
    return 0;
  };

  /* --------------------------------------------------------
     Render
     -------------------------------------------------------- */
  return (
    <aside className="locator-subsidebar" aria-label="Locator filters">
      <style>{sidebarExtraCss}</style>

      {/* ---------- Header ---------- */}
      <div className="locator-subsidebar-head">
        <div className="locator-subsidebar-title">
          <span className="locator-subsidebar-dot" aria-hidden="true" />
          <span>Filters</span>
        </div>
        <p className="locator-subsidebar-subtitle">
          Narrow the grid by condition, class, category, or status.
        </p>
      </div>

      {/* ---------- Warehouse summary ---------- */}
      {summary && (
        <div className="locator-subsidebar-summary" aria-label="Warehouse totals">
          <div className="locator-summary-cell">
            <div className="locator-summary-label">
              <FiPackage className="locator-summary-icon" aria-hidden="true" />
              <span>Total Qty</span>
            </div>
            <div className="locator-summary-value">
              {fmtInt(summary.total_qty)}
            </div>
          </div>

          <div className="locator-summary-cell">
            <div className="locator-summary-label">
              <FiDollarSign className="locator-summary-icon" aria-hidden="true" />
              <span>Total Value</span>
            </div>
            <div className="locator-summary-value locator-summary-value--cur" title={fmtCur(summary.total_value)}>
              {fmtCur(summary.total_value)}
            </div>
          </div>

          <div className="locator-summary-caption">
            <strong>{fmtInt(summary.locator_count)}</strong> locator
            {summary.locator_count === 1 ? '' : 's'}
            <span className="locator-summary-dot">·</span>
            <strong>{fmtInt(summary.item_count)}</strong> item
            {summary.item_count === 1 ? '' : 's'}
          </div>
        </div>
      )}

      {/* ---------- All Locators (reset) ---------- */}
      <div className="locator-subsidebar-group">
        <button
          type="button"
          className={`locator-filter-item ${isActive('all', null) ? 'active' : ''}`}
          onClick={() => onSelect('all', null)}
        >
          <span className="locator-filter-label locator-filter-label--with-icon">
            <FiLayers className="locator-filter-icon" />
            <span>All Locators</span>
          </span>
          <span className="locator-filter-count">{totalCount ?? 0}</span>
        </button>
      </div>

      {/* ---------- Condition ---------- */}
      <div className="locator-subsidebar-group">
        <div className="locator-subsidebar-label">Condition</div>
        {CONDITION_OPTIONS.map((opt) => {
          const active = isConditionActive(opt.dbValue);
          const cnt    = conditionCount(opt.dbValue);
          return (
            <button
              type="button"
              key={opt.key}
              className={
                `locator-filter-item locator-filter-item--${opt.tone}` +
                (active ? ' active' : '')
              }
              onClick={() =>
                opt.dbValue === null
                  ? onSelect('all', null)
                  : onSelect('locator_type', opt.dbValue)
              }
            >
              <span className="locator-filter-label locator-filter-label--with-icon">
                {opt.tone === 'damaged' && (
                  <FiAlertTriangle className="locator-filter-icon locator-filter-icon--damage" />
                )}
                <span>{opt.label}</span>
              </span>
              <span className="locator-filter-count">{cnt}</span>
            </button>
          );
        })}
      </div>

      {/* ---------- Purchase Class ---------- */}
      <div className="locator-subsidebar-group">
        <div className="locator-subsidebar-label">Purchase Class</div>
        {purchaseClasses.length === 0 ? (
          <div className="locator-subsidebar-empty">No classes</div>
        ) : (
          purchaseClasses.map((pc) => (
            <button
              type="button"
              key={pc.value}
              className={`locator-filter-item ${isActive('purchase_class', pc.value) ? 'active' : ''}`}
              onClick={() => onSelect('purchase_class', pc.value)}
            >
              <span className="locator-filter-label">{pc.value}</span>
              <span className="locator-filter-count">{pc.count}</span>
            </button>
          ))
        )}
      </div>

      {/* ---------- Category ---------- */}
      <div className="locator-subsidebar-group">
        <div className="locator-subsidebar-label">Category</div>
        {categories.length === 0 ? (
          <div className="locator-subsidebar-empty">No categories</div>
        ) : (
          categories.map((cat) => (
            <button
              type="button"
              key={cat.value}
              className={`locator-filter-item ${isActive('category', cat.value) ? 'active' : ''}`}
              onClick={() => onSelect('category', cat.value)}
            >
              <span className="locator-filter-label">{cat.value}</span>
              <span className="locator-filter-count">{cat.count}</span>
            </button>
          ))
        )}
      </div>

      {/* ---------- Status ---------- */}
      <div className="locator-subsidebar-group">
        <div className="locator-subsidebar-label">Status</div>
        {statuses.length === 0 ? (
          <>
            <button
              type="button"
              className={`locator-filter-item ${isActive('status', 'Active') ? 'active' : ''}`}
              onClick={() => onSelect('status', 'Active')}
            >
              <span className="locator-filter-label">Active</span>
            </button>
            <button
              type="button"
              className={`locator-filter-item ${isActive('status', 'Inactive') ? 'active' : ''}`}
              onClick={() => onSelect('status', 'Inactive')}
            >
              <span className="locator-filter-label">Inactive</span>
            </button>
          </>
        ) : (
          statuses.map((st) => (
            <button
              type="button"
              key={st.value}
              className={`locator-filter-item ${isActive('status', st.value) ? 'active' : ''}`}
              onClick={() => onSelect('status', st.value)}
            >
              <span className="locator-filter-label">{st.value}</span>
              <span className="locator-filter-count">{st.count}</span>
            </button>
          ))
        )}
      </div>
    </aside>
  );
};

/* ============================================================
   Component-scoped CSS — only the two new blocks.
   The shell (.locator-subsidebar, .locator-filter-item, etc.) lives
   in locatorStyles.js and is unchanged.
   ============================================================ */
const sidebarExtraCss = `
/* ---------- Warehouse summary block ---------- */
.locator-subsidebar-summary {
  display: grid;
  /* Give the value cell more space than the qty cell so currency fits */
  grid-template-columns: 1fr 1.35fr;
  gap: 6px;
  padding: 12px 10px;
  margin-bottom: 10px;
  background: linear-gradient(135deg, #f0fdfa 0%, #ecfeff 100%);
  border: 1px solid #b8f1ea;
  border-radius: 10px;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.03);
}

.locator-summary-cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.locator-summary-label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 9px;
  font-weight: 800;
  color: #0f766e;
  text-transform: uppercase;
  /* Reduced letter-spacing to ensure it fits without ellipsis */
  letter-spacing: 0.02em; 
  line-height: 1.2;
  white-space: nowrap;
  overflow: visible;
}

.locator-summary-icon {
  width: 11px;
  height: 11px;
  stroke-width: 2.6;
  flex-shrink: 0;
  color: #0f766e;
}

.locator-summary-value {
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-size: 13.5px;
  font-weight: 800;
  color: #0f172a;
  line-height: 1.2;
  /* Tighter letter spacing helps the long numbers fit */
  letter-spacing: -0.03em; 
  /* Prevent wrapping the cents to the next line */
  white-space: nowrap; 
}

.locator-summary-value--cur {
  color: #047857;
}

.locator-summary-caption {
  grid-column: 1 / -1;
  font-size: 10.5px;
  color: #475569;
  margin-top: 2px;
  padding-top: 6px;
  border-top: 1px dashed #b8f1ea;
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
}

.locator-summary-caption strong {
  color: #0f172a;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-weight: 800;
  font-size: 11px;
}

.locator-summary-dot {
  color: #cbd5e1;
  font-weight: 700;
}

/* ---------- Condition accents ---------- */
.locator-filter-item--damaged::before {
  background: #fca5a5;
}
.locator-filter-item--damaged:hover::before {
  background: #dc2626;
}
.locator-filter-item--damaged.active::before {
  background: #b91c1c;
}
.locator-filter-item--damaged.active {
  background: rgba(220, 38, 38, 0.10);
  color: #991b1b;
}

.locator-filter-icon--damage {
  color: #b91c1c;
}
.locator-filter-item--damaged:hover .locator-filter-icon--damage,
.locator-filter-item--damaged.active .locator-filter-icon--damage {
  color: #991b1b;
}

.locator-filter-item--good.active {
  background: rgba(16, 185, 129, 0.12);
  color: #047857;
}
.locator-filter-item--good.active::before {
  background: #047857;
}

/* ---------- Responsive ---------- */
@media (max-width: 900px) {
  .locator-subsidebar-summary {
    grid-template-columns: 1fr 1.35fr 1.2fr;
    flex: 0 0 auto;
    min-width: 320px;
    margin-bottom: 6px;
    padding: 10px 12px;
  }
  .locator-summary-caption {
    grid-column: auto;
    border-top: none;
    border-left: 1px dashed #b8f1ea;
    padding-top: 0;
    padding-left: 10px;
    margin-top: 0;
    flex-direction: column;
    align-items: flex-start;
    justify-content: center;
    gap: 2px;
  }
}

@media (max-width: 480px) {
  .locator-subsidebar-summary {
    padding: 10px;
    gap: 8px;
  }
  .locator-summary-value {
    font-size: 13px;
  }
  .locator-summary-caption {
    font-size: 10px;
  }
}

@media (max-width: 360px) {
  .locator-subsidebar-summary {
    min-width: 280px;
    padding: 8px 10px;
  }
  .locator-summary-value {
    font-size: 12px;
  }
  .locator-summary-label {
    font-size: 8px;
  }
}

/* Ultra-wide — allow a touch more breathing room. */
@media (min-width: 1921px) {
  .locator-summary-value { font-size: 15px; }
  .locator-subsidebar-summary { padding: 14px; gap: 10px; }
}

/* Accessibility */
@media (prefers-reduced-motion: reduce) {
  .locator-filter-item--damaged::before {
    transition: none !important;
  }
}
`;

export default LocatorFilterSidebar;