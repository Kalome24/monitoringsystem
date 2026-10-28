// src/components/shared/ItemCodeSearchCard.jsx
//
// ============================================================
// ITEM CODE SEARCH CARD
// ============================================================
//
// Cross-warehouse item search. Two scopes:
//   • scope="global"     → Admin / Super Admin. Searches ALL
//                          warehouses for the given item code,
//                          description, or inventory name.
//   • scope="warehouse"  → Stock Handler. Backend forces the
//                          caller's warehouse, so totals reflect
//                          only their own stock.
//
// Behaviour:
//   • Debounced input (350ms). Min 2 characters.
//   • Prominent Grand Total panel (qty + value) above the rows.
//   • Per-row breakdown: warehouse · locator · item code ·
//     description · UOM · qty · value.
//   • Stale-response guard via request ID ref.
//   • Fully responsive: table on >=900px, cards below.
//
// ============================================================

import React, { useEffect, useRef, useState } from 'react';
import {
  FiSearch,
  FiX,
  FiLoader,
  FiPackage,
  FiHome,
  FiDollarSign,
  FiBox,
  FiAlertTriangle,
  FiInbox,
} from 'react-icons/fi';
import { locatorsApi } from '../../services/api';

const DEBOUNCE_MS = 350;
const MIN_SEARCH_LEN = 2;

const intFmt = new Intl.NumberFormat('en-PH');
const curFmt = new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const fmtInt = (n) => intFmt.format(Number(n) || 0);
const fmtCur = (n) => curFmt.format(Number(n) || 0);

const ItemCodeSearchCard = ({ scope = 'global' }) => {
  const [search, setSearch]                 = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [loading, setLoading]               = useState(false);
  const [error, setError]                   = useState(null);
  const [result, setResult]                 = useState(null);

  const debounceRef = useRef(null);
  const reqIdRef    = useRef(0);

  /* ---------- debounce ---------- */
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(search.trim());
    }, DEBOUNCE_MS);
    return () => clearTimeout(debounceRef.current);
  }, [search]);

  /* ---------- fetch ---------- */
  useEffect(() => {
    const term = debouncedSearch;
    if (!term || term.length < MIN_SEARCH_LEN) {
      setResult(null);
      setError(null);
      setLoading(false);
      return;
    }

    const myId = ++reqIdRef.current;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await locatorsApi.searchItem(term);
        if (myId !== reqIdRef.current) return; // stale
        if (!res.ok) {
          setError(res?.data?.message || 'Search failed.');
          setResult(null);
        } else {
          setResult(res.data);
        }
      } catch (err) {
        if (myId !== reqIdRef.current) return;
        setError(err?.message || 'Search failed.');
        setResult(null);
      } finally {
        if (myId === reqIdRef.current) setLoading(false);
      }
    })();
  }, [debouncedSearch]);

  const handleClear = () => {
    setSearch('');
    setDebouncedSearch('');
    setResult(null);
    setError(null);
  };

  const showIdle = !debouncedSearch || debouncedSearch.length < MIN_SEARCH_LEN;
  const rows     = result?.rows || [];
  const totals   = result?.totals || {
    total_qty: 0,
    total_value: 0,
    warehouse_count: 0,
    item_count: 0,
    row_count: 0,
  };

  return (
    <section className="icsc-root" aria-label="Item code search">
      <style>{css}</style>

      {/* -------- Head -------- */}
      <div className="icsc-head">
        <div className="icsc-head-icon"><FiSearch /></div>
        <div className="icsc-head-text">
          <h3 className="icsc-title">
            <span>Item Code Search</span>
            <span className={`icsc-scope icsc-scope--${scope}`}>
              {scope === 'global' ? 'All Warehouses' : 'This Warehouse'}
            </span>
          </h3>
          <p className="icsc-subtitle">
            {scope === 'global'
              ? 'Search any item code or description to see total qty & value across every warehouse.'
              : 'Search any item code or description stored in your warehouse.'}
          </p>
        </div>
      </div>

      {/* -------- Search bar -------- */}
      <div className="icsc-searchbar">
        <span className="icsc-search-icon"><FiSearch /></span>
        <input
          type="text"
          className="icsc-search-input"
          placeholder="Type an item code or description (e.g. ABSB, ABSORBER)…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          spellCheck={false}
          autoComplete="off"
          aria-label="Search item code"
        />
        {search && (
          <button
            type="button"
            className="icsc-clear-btn"
            onClick={handleClear}
            aria-label="Clear search"
          >
            <FiX />
          </button>
        )}
      </div>

      {/* -------- Idle hint -------- */}
      {showIdle && (
        <div className="icsc-hint">
          <FiPackage />
          <span>Type at least {MIN_SEARCH_LEN} characters to search.</span>
        </div>
      )}

      {/* -------- Loading -------- */}
      {!showIdle && loading && (
        <div className="icsc-loading">
          <FiLoader className="icsc-spin" />
          <span>Searching…</span>
        </div>
      )}

      {/* -------- Error -------- */}
      {!showIdle && !loading && error && (
        <div className="icsc-error">
          <FiAlertTriangle />
          <span>{error}</span>
        </div>
      )}

      {/* -------- Empty -------- */}
      {!showIdle && !loading && !error && result && rows.length === 0 && (
        <div className="icsc-empty">
          <FiInbox />
          <div>
            <div className="icsc-empty-title">No matching items</div>
            <div className="icsc-empty-sub">
              Nothing stored matches “{debouncedSearch}”.
            </div>
          </div>
        </div>
      )}

      {/* -------- Results -------- */}
      {!showIdle && !loading && !error && result && rows.length > 0 && (
        <>
          {/* Grand Total panel */}
          <div className="icsc-totals">
            <div className="icsc-totals-top">
              <div className="icsc-totals-label">Grand Total</div>
              <div className="icsc-totals-query">“{debouncedSearch}”</div>
            </div>

            <div className="icsc-totals-grid">
              <div className="icsc-total-cell">
                <div className="icsc-total-icon icsc-total-icon--qty">
                  <FiBox />
                </div>
                <div className="icsc-total-body">
                  <div className="icsc-total-label">Total Qty</div>
                  <div className="icsc-total-value">{fmtInt(totals.total_qty)}</div>
                </div>
              </div>

              <div className="icsc-total-cell">
                <div className="icsc-total-icon icsc-total-icon--val">
                  <FiDollarSign />
                </div>
                <div className="icsc-total-body">
                  <div className="icsc-total-label">Total Value</div>
                  <div className="icsc-total-value icsc-total-value--cur">
                    {fmtCur(totals.total_value)}
                  </div>
                </div>
              </div>
            </div>

            <div className="icsc-totals-caption">
              <strong>{fmtInt(totals.item_count)}</strong>
              <span>item code{totals.item_count === 1 ? '' : 's'}</span>
              <span className="icsc-caption-dot">·</span>
              <strong>{fmtInt(totals.warehouse_count)}</strong>
              <span>warehouse{totals.warehouse_count === 1 ? '' : 's'}</span>
              <span className="icsc-caption-dot">·</span>
              <strong>{fmtInt(totals.row_count)}</strong>
              <span>stock row{totals.row_count === 1 ? '' : 's'}</span>
            </div>
          </div>

          {/* Table (desktop / tablet) */}
          <div className="icsc-table-wrap">
            <table className="icsc-table">
              <thead>
                <tr>
                  <th scope="col">Warehouse</th>
                  <th scope="col">Locator</th>
                  <th scope="col">Item Code</th>
                  <th scope="col">Description</th>
                  <th scope="col">UOM</th>
                  <th scope="col" className="icsc-num">Qty</th>
                  <th scope="col" className="icsc-num">Value</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, idx) => (
                  <tr key={`${r.WarehouseCode}-${r.LocatorCode}-${r.ItemCode}-${idx}`}>
                    <td data-label="Warehouse">
                      <span className="icsc-wh-chip">
                        <FiHome className="icsc-wh-icon" />
                        {r.WarehouseCode}
                      </span>
                      {r.WarehouseName && (
                        <div className="icsc-wh-name">{r.WarehouseName}</div>
                      )}
                    </td>
                    <td data-label="Locator">
                      <div className="icsc-loc-code">{r.LocatorCode}</div>
                      {r.LocatorName && (
                        <div className="icsc-loc-name">{r.LocatorName}</div>
                      )}
                    </td>
                    <td data-label="Item Code">
                      <span className="icsc-item-code">{r.ItemCode}</span>
                    </td>
                    <td data-label="Description" className="icsc-desc-cell" title={r.ItemDescription || ''}>
                      {r.ItemDescription || '—'}
                    </td>
                    <td data-label="UOM">
                      <span className="icsc-uom">{r.UomCode || '—'}</span>
                    </td>
                    <td data-label="Qty" className="icsc-num">
                      {fmtInt(r.TotalQty)}
                    </td>
                    <td data-label="Value" className="icsc-num icsc-num--cur">
                      {fmtCur(r.TotalValue)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Cards (mobile) */}
          <div className="icsc-card-list">
            {rows.map((r, idx) => (
              <article key={`m-${idx}`} className="icsc-card">
                <header className="icsc-card-head">
                  <span className="icsc-wh-chip">
                    <FiHome className="icsc-wh-icon" />
                    {r.WarehouseCode}
                  </span>
                  <span className="icsc-item-code">{r.ItemCode}</span>
                </header>
                <div className="icsc-card-desc">{r.ItemDescription || '—'}</div>
                <dl className="icsc-card-grid">
                  <div>
                    <dt>Locator</dt>
                    <dd>{r.LocatorCode}</dd>
                  </div>
                  <div>
                    <dt>UOM</dt>
                    <dd>{r.UomCode || '—'}</dd>
                  </div>
                  <div>
                    <dt>Qty</dt>
                    <dd className="icsc-num--cur">{fmtInt(r.TotalQty)}</dd>
                  </div>
                  <div>
                    <dt>Value</dt>
                    <dd className="icsc-num--cur">{fmtCur(r.TotalValue)}</dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
};

/* ============================================================ */
/* Scoped CSS — everything is prefixed `icsc-` to avoid collisions */
/* ============================================================ */
const css = `
.icsc-root {
  position: relative;
  background: linear-gradient(135deg, #ffffff 0%, #f6fefd 100%);
  border: 1px solid #b8f1ea;
  border-radius: 14px;
  padding: clamp(14px, 2vw, 22px);
  margin-bottom: clamp(14px, 2vw, 20px);
  box-shadow:
    0 1px 2px rgba(15, 23, 42, 0.04),
    0 14px 32px -18px rgba(0, 184, 176, 0.35);
  box-sizing: border-box;
  font-family: inherit;
}
.icsc-root *,
.icsc-root *::before,
.icsc-root *::after {
  box-sizing: border-box;
}

/* Left accent rail */
.icsc-root::before {
  content: '';
  position: absolute;
  left: 0;
  top: 14px;
  bottom: 14px;
  width: 4px;
  border-radius: 0 4px 4px 0;
  background: linear-gradient(180deg, #00e0d4 0%, #008a82 100%);
  box-shadow: 0 0 14px rgba(0, 184, 176, 0.4);
  pointer-events: none;
}

/* ==================== HEAD ==================== */
.icsc-head {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 14px;
}
.icsc-head-icon {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  background: linear-gradient(135deg, #00e0d4 0%, #008a82 100%);
  color: #ffffff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  box-shadow: 0 4px 12px rgba(0, 210, 200, 0.32);
}
.icsc-head-icon svg {
  width: 20px;
  height: 20px;
  stroke-width: 2.2;
}
.icsc-head-text {
  min-width: 0;
  flex: 1;
}
.icsc-title {
  margin: 0;
  font-size: clamp(15px, 1.4vw, 17px);
  font-weight: 800;
  color: #0f172a;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  line-height: 1.2;
}
.icsc-scope {
  display: inline-flex;
  align-items: center;
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 10.5px;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  white-space: nowrap;
}
.icsc-scope--global {
  background: #eef2ff;
  color: #4338ca;
  border: 1px solid #c7d2fe;
}
.icsc-scope--warehouse {
  background: #f0fdfa;
  color: #0f766e;
  border: 1px solid #99f6e4;
}
.icsc-subtitle {
  margin: 4px 0 0;
  font-size: 12.5px;
  color: #64748b;
  line-height: 1.45;
  max-width: 70ch;
}

/* ==================== SEARCH BAR ==================== */
.icsc-searchbar {
  position: relative;
  display: flex;
  align-items: center;
  background: #ffffff;
  border: 1.5px solid #cbd5e1;
  border-radius: 10px;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.icsc-searchbar:focus-within {
  border-color: #00b8b0;
  box-shadow: 0 0 0 3px rgba(0, 184, 176, 0.15);
}
.icsc-search-icon {
  position: absolute;
  left: 14px;
  color: #94a3b8;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}
.icsc-search-icon svg {
  width: 16px;
  height: 16px;
  stroke-width: 2.2;
}
.icsc-search-input {
  width: 100%;
  min-height: 46px;
  padding: 10px 44px 10px 42px;
  border: none;
  border-radius: 10px;
  background: transparent;
  color: #0f172a;
  font-family: inherit;
  font-size: 14px;
  outline: none;
}
.icsc-search-input::placeholder {
  color: #94a3b8;
}
.icsc-clear-btn {
  position: absolute;
  right: 8px;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  border: none;
  background: transparent;
  color: #64748b;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s ease, color 0.15s ease;
}
.icsc-clear-btn:hover {
  background: #f1f5f9;
  color: #0f172a;
}
.icsc-clear-btn:focus-visible {
  outline: 2px solid #00b8b0;
  outline-offset: 2px;
}
.icsc-clear-btn svg {
  width: 16px;
  height: 16px;
  stroke-width: 2.4;
}

/* ==================== STATES ==================== */
.icsc-hint,
.icsc-loading,
.icsc-error,
.icsc-empty {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 12px;
  padding: 12px 14px;
  border-radius: 10px;
  font-size: 13px;
}
.icsc-hint {
  background: #f8fafc;
  border: 1px dashed #cbd5e1;
  color: #64748b;
}
.icsc-loading {
  background: #f0fdfa;
  border: 1px solid #99f6e4;
  color: #0f766e;
  font-weight: 600;
}
.icsc-error {
  background: #fef2f2;
  border: 1px solid #fecaca;
  color: #991b1b;
  font-weight: 600;
}
.icsc-empty {
  background: #f8fafc;
  border: 1px dashed #cbd5e1;
  color: #64748b;
}
.icsc-hint svg,
.icsc-loading svg,
.icsc-error svg,
.icsc-empty svg {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}
.icsc-spin {
  animation: icsc-spin 0.9s linear infinite;
}
@keyframes icsc-spin {
  to { transform: rotate(360deg); }
}
.icsc-empty-title {
  font-weight: 700;
  color: #0f172a;
  font-size: 13.5px;
}
.icsc-empty-sub {
  font-size: 12px;
  color: #64748b;
  margin-top: 2px;
}

/* ==================== TOTALS ==================== */
.icsc-totals {
  margin-top: 14px;
  padding: 16px 18px;
  border-radius: 12px;
  background: linear-gradient(135deg, #0f766e 0%, #008a82 100%);
  color: #ffffff;
  box-shadow: 0 10px 24px -12px rgba(15, 118, 110, 0.5);
}
.icsc-totals-top {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.icsc-totals-label {
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.85);
}
.icsc-totals-query {
  font-size: 12px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.78);
  font-style: italic;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.icsc-totals-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 12px;
}
.icsc-total-cell {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  background: rgba(255, 255, 255, 0.10);
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 10px;
  min-width: 0;
}
.icsc-total-icon {
  width: 38px;
  height: 38px;
  border-radius: 9px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  background: rgba(255, 255, 255, 0.20);
  color: #ffffff;
}
.icsc-total-icon svg {
  width: 18px;
  height: 18px;
  stroke-width: 2.4;
}
.icsc-total-body {
  min-width: 0;
  flex: 1;
}
.icsc-total-label {
  font-size: 10.5px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.85);
}
.icsc-total-value {
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-size: clamp(20px, 2vw, 26px);
  font-weight: 800;
  color: #ffffff;
  line-height: 1.1;
  letter-spacing: -0.01em;
  margin-top: 2px;
  word-break: break-word;
}
.icsc-total-value--cur {
  color: #fef3c7;
}
.icsc-totals-caption {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.18);
  font-size: 12px;
  color: rgba(255, 255, 255, 0.85);
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.icsc-totals-caption strong {
  color: #ffffff;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-weight: 800;
}
.icsc-caption-dot {
  opacity: 0.5;
}

/* ==================== TABLE (desktop) ==================== */
.icsc-table-wrap {
  display: none;
  margin-top: 14px;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  overflow-x: auto;
  background: #ffffff;
  -webkit-overflow-scrolling: touch;
}
.icsc-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  min-width: 760px;
}
.icsc-table thead th {
  position: sticky;
  top: 0;
  background: #f1f5f9;
  color: #475569;
  font-size: 10.5px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  font-weight: 800;
  text-align: left;
  padding: 10px 14px;
  border-bottom: 1px solid #e2e8f0;
  white-space: nowrap;
  z-index: 1;
}
.icsc-table thead th.icsc-num {
  text-align: right;
}
.icsc-table tbody td {
  padding: 11px 14px;
  border-bottom: 1px solid #f1f5f9;
  color: #0f172a;
  vertical-align: middle;
}
.icsc-table tbody tr:last-child td {
  border-bottom: none;
}
.icsc-table tbody tr {
  transition: background 0.12s ease;
}
.icsc-table tbody tr:hover {
  background: #f0fdfa;
}
.icsc-num {
  text-align: right;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.icsc-num--cur {
  color: #065f46;
  font-weight: 700;
}
.icsc-wh-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 9px;
  border-radius: 999px;
  background: #f0fdfa;
  color: #0f766e;
  border: 1px solid #99f6e4;
  font-size: 11px;
  font-weight: 800;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  white-space: nowrap;
}
.icsc-wh-icon {
  width: 11px;
  height: 11px;
  stroke-width: 2.4;
}
.icsc-wh-name {
  font-size: 11px;
  color: #64748b;
  margin-top: 3px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 200px;
}
.icsc-loc-code {
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-weight: 700;
  font-size: 12.5px;
  color: #334155;
}
.icsc-loc-name {
  font-size: 11px;
  color: #94a3b8;
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 220px;
}
.icsc-item-code {
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-weight: 800;
  color: #4338ca;
  font-size: 12.5px;
}
.icsc-desc-cell {
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #334155;
}
.icsc-uom {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 6px;
  background: #f1f5f9;
  color: #334155;
  font-size: 11px;
  font-weight: 700;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
}

/* ==================== CARD LIST (mobile) ==================== */
.icsc-card-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 14px;
}
.icsc-card {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 12px 14px;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.05);
}
.icsc-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
  flex-wrap: wrap;
}
.icsc-card-desc {
  font-size: 12.5px;
  color: #334155;
  margin-bottom: 10px;
  line-height: 1.4;
}
.icsc-card-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px 12px;
  margin: 0;
  border-top: 1px dashed #e2e8f0;
  padding: 10px 0 0;
}
.icsc-card-grid > div {
  min-width: 0;
}
.icsc-card-grid dt {
  margin: 0;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #64748b;
}
.icsc-card-grid dd {
  margin: 3px 0 0;
  font-weight: 700;
  color: #0f172a;
  font-variant-numeric: tabular-nums;
  font-size: 13px;
  word-break: break-word;
}
.icsc-card-grid dd.icsc-num--cur {
  color: #065f46;
}

/* ==================== RESPONSIVE ==================== */
@media (min-width: 900px) {
  .icsc-table-wrap { display: block; }
  .icsc-card-list  { display: none; }
}

@media (max-width: 640px) {
  .icsc-root {
    padding: 14px 14px 16px;
  }
  .icsc-root::before {
    top: 12px;
    bottom: 12px;
  }
  .icsc-head-icon {
    width: 34px;
    height: 34px;
    border-radius: 9px;
  }
  .icsc-head-icon svg {
    width: 17px;
    height: 17px;
  }
  .icsc-search-input {
    font-size: 16px; /* prevent iOS zoom-on-focus */
  }
  .icsc-totals {
    padding: 14px;
  }
  .icsc-total-value {
    font-size: 20px;
  }
  .icsc-totals-query {
    white-space: normal;
    overflow: visible;
    text-overflow: unset;
  }
}

@media (max-width: 480px) {
  .icsc-title {
    font-size: 14px;
  }
  .icsc-subtitle {
    font-size: 12px;
  }
  .icsc-totals-grid {
    grid-template-columns: 1fr;
    gap: 8px;
  }
  .icsc-total-cell {
    padding: 10px 12px;
  }
  .icsc-card-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 360px) {
  .icsc-root {
    padding: 12px;
  }
  .icsc-scope {
    font-size: 9.5px;
    padding: 2px 8px;
  }
  .icsc-total-value {
    font-size: 18px;
  }
}

@media (min-width: 1921px) {
  .icsc-root {
    padding: 22px 24px;
  }
  .icsc-total-value {
    font-size: 28px;
  }
  .icsc-search-input {
    font-size: 15px;
    min-height: 50px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .icsc-root * {
    transition: none !important;
    animation: none !important;
  }
  .icsc-spin {
    animation: none !important;
  }
}
`;

export default ItemCodeSearchCard;