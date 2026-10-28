// src/components/underground/UndergroundLiveStock.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FiRefreshCw,
  FiTrendingUp,
  FiTrendingDown,
  FiMinus,
  FiAlertTriangle,
  FiInfo,
  FiActivity,
  FiInbox,
  FiArrowUpRight,
  FiArrowDownRight,
  FiBox,
} from 'react-icons/fi';
import { undergroundApi, uomConversionApi } from '../../services/api';

const POLL_MS = 30000;

/* ============================================================
   Formatters — 4-DECIMAL STRICT for money
   ============================================================ */
const intFmt = new Intl.NumberFormat('en-PH');
const curFmt = new Intl.NumberFormat('en-PH', {
  style: 'currency', currency: 'PHP',
  minimumFractionDigits: 4, maximumFractionDigits: 4,
});
const fmtInt = (n) => intFmt.format(Number(n) || 0);
const fmtCur = (n) => curFmt.format(Number(n) || 0);

const fmtSignedInt = (n) => {
  const v = Number(n) || 0;
  if (v === 0) return '0';
  return v > 0 ? `+${fmtInt(v)}` : `−${fmtInt(Math.abs(v))}`;
};

const fmtSignedCur = (n) => {
  const v = Number(n) || 0;
  if (v === 0) return curFmt.format(0);
  const prefix = v > 0 ? '+' : '−';
  return `${prefix}${curFmt.format(Math.abs(v))}`;
};

const fmtRelative = (iso) => {
  if (!iso) return '—';
  try {
    const then = new Date(iso).getTime();
    if (!Number.isFinite(then)) return '—';
    const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
    if (secs < 5)  return 'just now';
    if (secs < 60) return `${secs}s ago`;
    const mins = Math.round(secs / 60);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24)  return `${hrs}h ago`;
    return `${Math.round(hrs / 24)}d ago`;
  } catch {
    return '—';
  }
};

const fmtDateTime = (v) => {
  if (!v) return '—';
  try {
    const d = new Date(v);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' });
  } catch { return '—'; }
};

/* ============================================================
   Component CSS — scoped `ugls-` prefix
   ============================================================ */
const LIVE_STOCK_CSS = `
.ugls { display: flex; flex-direction: column; gap: 16px; }

/* ---------- Header ---------- */
.ugls-head {
  display: flex; align-items: flex-start; justify-content: space-between;
  gap: 12px; flex-wrap: wrap;
}
.ugls-head-left { display: flex; align-items: flex-start; gap: 12px; min-width: 0; }
.ugls-head-icon {
  width: 36px; height: 36px; border-radius: 10px; flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, #6366f1 0%, #4338ca 100%);
  color: #ffffff;
  box-shadow: 0 4px 12px rgba(99, 102, 241, 0.28);
}
.ugls-head-icon svg { width: 18px; height: 18px; stroke-width: 2.4; }
.ugls-head-info { min-width: 0; }
.ugls-title {
  margin: 0; font-size: 15px; font-weight: 800; color: #0f172a;
  line-height: 1.2; letter-spacing: -0.01em;
}
.ugls-sub { font-size: 12px; color: #64748b; margin-top: 2px; line-height: 1.4; }
.ugls-sub strong { color: #0f766e; }

.ugls-refresh {
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  min-height: 40px; padding: 8px 16px;
  border: 1.5px solid #cbd5e1; border-radius: 10px;
  background: #ffffff; color: #334155;
  font-family: inherit; font-size: 13px; font-weight: 700;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
  -webkit-tap-highlight-color: transparent;
}
.ugls-refresh svg { width: 14px; height: 14px; stroke-width: 2.4; }
.ugls-refresh:hover:not(:disabled) { background: #f0fdfa; border-color: #00b8b0; color: #007a72; }
.ugls-refresh:disabled { opacity: 0.5; cursor: not-allowed; }
.ugls-spin { animation: uglsSpin 0.9s linear infinite; }
@keyframes uglsSpin { to { transform: rotate(360deg); } }

/* ---------- Summary strip ---------- */
.ugls-summary {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 10px;
}
.ugls-sum-card {
  padding: 12px 14px; border-radius: 10px;
  background: #ffffff; border: 1px solid #e2e8f0;
  display: flex; flex-direction: column; gap: 3px;
}
.ugls-sum-label {
  font-size: 10.5px; font-weight: 800; letter-spacing: 0.08em;
  text-transform: uppercase; color: #64748b;
}
.ugls-sum-value {
  font-family: 'JetBrains Mono','SF Mono',Monaco,Menlo,monospace;
  font-size: 18px; font-weight: 800; color: #0f172a;
  font-variant-numeric: tabular-nums; line-height: 1.15;
}
.ugls-sum-value--pos { color: #047857; }
.ugls-sum-value--neg { color: #b91c1c; }
.ugls-sum-value--neutral { color: #64748b; }

/* ---------- List (table on desktop) ---------- */
.ugls-list-wrap {
  border: 1px solid #e2e8f0; border-radius: 12px;
  background: #ffffff; overflow: hidden;
}
.ugls-table {
  width: 100%; border-collapse: collapse; font-size: 13px;
}
.ugls-table thead th {
  text-align: left; padding: 10px 14px;
  font-size: 10.5px; font-weight: 800; letter-spacing: 0.06em;
  text-transform: uppercase; color: #475569;
  background: #f8fafc; border-bottom: 1px solid #e2e8f0;
  white-space: nowrap;
}
.ugls-table thead th.ugls-num { text-align: right; }
.ugls-table tbody td {
  padding: 11px 14px;
  border-bottom: 1px solid #f1f5f9;
  color: #0f172a; vertical-align: middle;
}
.ugls-table tbody tr:last-child td { border-bottom: none; }
.ugls-table tbody tr:hover { background: #f8fafc; }

.ugls-cell-code {
  font-family: 'JetBrains Mono','SF Mono',Monaco,Menlo,monospace;
  font-size: 12.5px; font-weight: 800; color: #0f172a;
}
.ugls-cell-name {
  font-size: 11.5px; color: #64748b; margin-top: 2px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  max-width: 320px;
}
.ugls-cell-uom {
  display: inline-block; padding: 2px 8px; border-radius: 6px;
  font-family: 'JetBrains Mono','SF Mono',Monaco,Menlo,monospace;
  font-size: 11px; font-weight: 700;
  background: #f1f5f9; color: #334155;
}
.ugls-num {
  text-align: right;
  font-variant-numeric: tabular-nums; white-space: nowrap;
}
.ugls-delta {
  display: inline-flex; align-items: center; gap: 6px;
  font-family: 'JetBrains Mono','SF Mono',Monaco,Menlo,monospace;
  font-weight: 800; font-size: 13px;
}
.ugls-delta svg { width: 13px; height: 13px; stroke-width: 2.6; }
.ugls-delta--pos { color: #047857; }
.ugls-delta--neg { color: #b91c1c; }
.ugls-delta--zero { color: #64748b; }

/* NEW: Box Breakdown Styles */
.ugls-qty-breakdown {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
  line-height: 1.2;
}
.ugls-qty-detail {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  font-weight: 700;
  color: #0f766e;
  background: #f0fdfa;
  border: 1px solid #99f6e4;
  border-radius: 4px;
  padding: 1px 6px;
}
.ugls-qty-detail svg {
  width: 10px;
  height: 10px;
  stroke-width: 2.6;
}

.ugls-activity {
  display: inline-flex; gap: 4px; flex-wrap: wrap;
}
.ugls-act-chip {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 2px 8px; border-radius: 999px;
  font-size: 10.5px; font-weight: 800; letter-spacing: 0.02em;
}
.ugls-act-chip svg { width: 10px; height: 10px; stroke-width: 2.6; }
.ugls-act-chip--in  { background: #ecfdf5; color: #065f46; border: 1px solid #a7f3d0; }
.ugls-act-chip--out { background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; }

.ugls-last {
  font-size: 11.5px; color: #64748b;
  font-family: 'JetBrains Mono','SF Mono',Monaco,Menlo,monospace;
  white-space: nowrap;
}

/* ---------- Card list (mobile) ---------- */
.ugls-cardlist { display: none; flex-direction: column; }
.ugls-card {
  display: grid; gap: 8px;
  padding: 14px;
  border-bottom: 1px solid #f1f5f9;
}
.ugls-card:last-child { border-bottom: none; }
.ugls-card-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; }
.ugls-card-head-info { min-width: 0; flex: 1; }
.ugls-card-meta {
  display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px;
}
.ugls-card-row {
  display: flex; justify-content: space-between; align-items: center;
  font-size: 12px; color: #475569;
}
.ugls-card-row-label { font-weight: 700; color: #64748b; }
.ugls-card-row-value {
  font-family: 'JetBrains Mono','SF Mono',Monaco,Menlo,monospace;
  font-weight: 800; color: #0f172a;
}

/* ---------- Empty / loading / error ---------- */
.ugls-state {
  display: flex; align-items: center; justify-content: center;
  gap: 10px; padding: 40px 20px; color: #64748b; font-size: 14px;
  border: 1px dashed #cbd5e1; border-radius: 12px;
  background: #f8fafc; text-align: center;
}
.ugls-state svg { width: 20px; height: 20px; stroke-width: 2.2; flex-shrink: 0; }
.ugls-state--error {
  background: #fef2f2; border-color: #fecaca; color: #991b1b;
  border-style: solid; border-left: 4px solid #dc2626;
  justify-content: flex-start; text-align: left;
}
.ugls-state--error svg { color: #dc2626; }

/* ---------- Info banner ---------- */
.ugls-info {
  display: flex; align-items: flex-start; gap: 10px;
  padding: 12px 14px; border-radius: 10px;
  background: #eff6ff; border: 1px solid #bfdbfe; color: #1e3a8a;
  font-size: 12.5px; line-height: 1.5;
}
.ugls-info svg { width: 16px; height: 16px; stroke-width: 2.4; flex-shrink: 0; margin-top: 1px; }

/* ---------- Offline strip ---------- */
.ugls-offline {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 14px; border-radius: 10px;
  background: #fffbeb; border: 1px solid #fde68a; color: #78350f;
  font-size: 12.5px; font-weight: 700;
}
.ugls-offline svg { width: 15px; height: 15px; stroke-width: 2.4; flex-shrink: 0; }

@media (max-width: 900px) {
  .ugls-summary { grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 8px; }
  .ugls-sum-value { font-size: 16px; }
}

@media (max-width: 720px) {
  .ugls-table { display: none; }
  .ugls-cardlist { display: flex; }
  .ugls-list-wrap { border-radius: 10px; }
}

@media (max-width: 480px) {
  .ugls { gap: 14px; }
  .ugls-head { flex-direction: column; align-items: stretch; }
  .ugls-refresh { width: 100%; min-height: 46px; }
  .ugls-head-icon { width: 32px; height: 32px; border-radius: 9px; }
  .ugls-head-icon svg { width: 16px; height: 16px; }
  .ugls-title { font-size: 14px; }
  .ugls-summary { grid-template-columns: 1fr 1fr; }
  .ugls-sum-card { padding: 10px 12px; }
  .ugls-sum-value { font-size: 15px; }
  .ugls-sum-label { font-size: 10px; }
  .ugls-card { padding: 12px; }
  .ugls-info { font-size: 12px; }
  .ugls-qty-breakdown { align-items: flex-start; }
}

@media (max-width: 380px) {
  .ugls-summary { grid-template-columns: 1fr; }
  .ugls-card { gap: 6px; padding: 10px; }
  .ugls-state { padding: 28px 14px; font-size: 13px; }
}

@media (min-width: 1921px) {
  .ugls-title { font-size: 16px; }
  .ugls-sum-value { font-size: 20px; }
  .ugls-table { font-size: 13.5px; }
  .ugls-table thead th, .ugls-table tbody td { padding: 12px 16px; }
  .ugls-card { padding: 16px 18px; }
}

@media (prefers-reduced-motion: reduce) {
  .ugls-spin { animation: none !important; }
  .ugls-refresh { transition: none !important; }
}
`;

/* ============================================================
   Component
   ============================================================ */
const UndergroundLiveStock = ({ shift, connectionOk = false }) => {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);
  const [lastFetch, setLastFetch] = useState(null);
  const [tick, setTick]       = useState(0);
  
  // NEW: UOM Rules
  const [uomRules, setUomRules] = useState({});

  const reqIdRef = useRef(0);

  const shiftId   = shift?.shift_id ?? null;
  const shiftStat = shift?.status ?? null;

  const isViewable = shiftId != null
    && (shiftStat === 'Open' || shiftStat === 'Closed');

  // Fetch UOM Rules on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await uomConversionApi.getAll({ limit: 5000 });
        if (cancelled) return;
        if (res.ok && res.data?.data) {
          const map = {};
          res.data.data.forEach((r) => {
            if (r.Status === 'Active') {
              map[r.piece_item_code] = Number(r.pieces_per_box);
            }
          });
          setUomRules(map);
        }
      } catch (err) {
        console.warn('Could not load UOM rules:', err);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ---- Fetch ----
  const fetchData = useCallback(async () => {
    if (!shiftId || !isViewable) {
      setData(null);
      setError(null);
      return;
    }
    const reqId = ++reqIdRef.current;
    const isStale = () => reqId !== reqIdRef.current;

    setLoading(true);
    setError(null);
    try {
      const res = await undergroundApi.liveDeltas(shiftId);
      if (isStale()) return;
      if (res.ok && res.data) {
        setData(res.data);
        setLastFetch(Date.now());
      } else {
        setError(res?.data?.message || 'Failed to load live activity.');
      }
    } catch (err) {
      if (isStale()) return;
      console.error('liveDeltas fetch:', err);
      setError('Could not reach the server.');
    } finally {
      if (!isStale()) setLoading(false);
    }
  }, [shiftId, isViewable]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (!isViewable) return undefined;
    if (!connectionOk) return undefined;

    let timer = null;
    const schedule = () => {
      if (timer) clearInterval(timer);
      timer = setInterval(() => {
        if (typeof document !== 'undefined' && document.hidden) return;
        fetchData();
      }, POLL_MS);
    };
    schedule();

    const onVisibility = () => {
      if (typeof document === 'undefined') return;
      if (!document.hidden && connectionOk) fetchData();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      if (timer) clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [isViewable, connectionOk, fetchData]);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 15000);
    return () => clearInterval(id);
  }, []);

  // ---- Derived ----
  const items = useMemo(() => Array.isArray(data?.items) ? data.items : [], [data]);
  const totals = data?.totals || { net_qty: 0, net_value: 0, items: 0 };

  const hasAnything = items.length > 0;
  const asOfDisplay = data?.as_of || (lastFetch ? new Date(lastFetch).toISOString() : null);

  // Helper to render the Box + Loose breakdown
  const renderQtyBreakdown = (deltaQty, itemCode) => {
    const totalQty = Math.abs(Number(deltaQty)) || 0;
    const piecesPerBox = uomRules[itemCode];

    if (!piecesPerBox || totalQty <= 0) {
      return null;
    }

    const boxes = Math.floor(totalQty / piecesPerBox);
    const loose = totalQty % piecesPerBox;

    if (boxes === 0) {
      return null;
    }

    return (
      <span className="ugls-qty-detail">
        <FiBox /> 
        {boxes} Box{boxes !== 1 ? 'es' : ''}
        {loose > 0 ? `, ${loose} Pcs` : ''}
      </span>
    );
  };

  // ---- Render ----
  return (
    <section className="ugls">
      <style>{LIVE_STOCK_CSS}</style>

      {/* Header */}
      <div className="ugls-head">
        <div className="ugls-head-left">
          <div className="ugls-head-icon"><FiActivity /></div>
          <div className="ugls-head-info">
            <h4 className="ugls-title">Live Surface Activity</h4>
            <div className="ugls-sub">
              Changes at <strong>{data?.warehouse_code || '—'}</strong> since this shift opened
              {asOfDisplay ? <> · <span title={fmtDateTime(asOfDisplay)}>updated {fmtRelative(asOfDisplay)}</span></> : null}
            </div>
          </div>
        </div>
        <button
          type="button"
          className="ugls-refresh"
          onClick={fetchData}
          disabled={loading || !isViewable}
        >
          <FiRefreshCw className={loading ? 'ugls-spin' : ''} />
          <span>{loading ? 'Refreshing…' : 'Refresh'}</span>
        </button>
      </div>

      {/* Not viewable state */}
      {!isViewable && (
        <div className="ugls-state">
          <FiInfo />
          <span>
            {shiftId == null
              ? 'Open a shift to see live surface activity.'
              : `Live view is unavailable while the shift is ${shiftStat}.`}
          </span>
        </div>
      )}

      {/* Offline strip */}
      {isViewable && !connectionOk && (
        <div className="ugls-offline">
          <FiAlertTriangle />
          <span>
            You are offline. Showing the last successful fetch — polling will
            resume when the connection returns.
          </span>
        </div>
      )}

      {/* Error */}
      {isViewable && error && (
        <div className="ugls-state ugls-state--error">
          <FiAlertTriangle />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 800, marginBottom: 2 }}>Could not load activity</div>
            <div>{error}</div>
          </div>
        </div>
      )}

      {/* Content */}
      {isViewable && !error && (
        <>
          {/* Summary strip */}
          <div className="ugls-summary">
            <div className="ugls-sum-card">
              <span className="ugls-sum-label">Net qty change</span>
              <span className={`ugls-sum-value ${
                totals.net_qty > 0 ? 'ugls-sum-value--pos'
                : totals.net_qty < 0 ? 'ugls-sum-value--neg'
                : 'ugls-sum-value--neutral'
              }`}>
                {fmtSignedInt(totals.net_qty)}
              </span>
            </div>
            <div className="ugls-sum-card">
              <span className="ugls-sum-label">Net value change</span>
              <span className={`ugls-sum-value ${
                totals.net_value > 0 ? 'ugls-sum-value--pos'
                : totals.net_value < 0 ? 'ugls-sum-value--neg'
                : 'ugls-sum-value--neutral'
              }`}>
                {fmtSignedCur(totals.net_value)}
              </span>
            </div>
            <div className="ugls-sum-card">
              <span className="ugls-sum-label">Items touched</span>
              <span className="ugls-sum-value">{fmtInt(totals.items)}</span>
            </div>
          </div>

          {/* Empty / loading / list */}
          {loading && !data && (
            <div className="ugls-state">
              <FiRefreshCw className="ugls-spin" />
              <span>Loading live activity…</span>
            </div>
          )}

          {!loading && !hasAnything && (
            <div className="ugls-state">
              <FiInbox />
              <span>No surface movements recorded since this shift opened.</span>
            </div>
          )}

          {hasAnything && (
            <>
              {/* Desktop table */}
              <div className="ugls-list-wrap">
                <table className="ugls-table">
                  <thead>
                    <tr>
                      <th scope="col">Item</th>
                      <th scope="col">UOM</th>
                      <th scope="col" className="ugls-num">Net change</th>
                      <th scope="col" className="ugls-num">Net value</th>
                      <th scope="col">Activity</th>
                      <th scope="col">Last movement</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((r) => {
                      const delta = Number(r.delta_qty) || 0;
                      const value = Number(r.delta_value) || 0;
                      const deltaClass =
                        delta > 0 ? 'ugls-delta--pos'
                        : delta < 0 ? 'ugls-delta--neg'
                        : 'ugls-delta--zero';
                      const DeltaIcon = delta > 0 ? FiArrowUpRight
                        : delta < 0 ? FiArrowDownRight
                        : FiMinus;
                      return (
                        <tr key={r.item_code}>
                          <td>
                            <div className="ugls-cell-code">{r.item_code}</div>
                            {r.item_name && (
                              <div className="ugls-cell-name" title={r.item_name}>
                                {r.item_name}
                              </div>
                            )}
                          </td>
                          <td>
                            {r.uom ? <span className="ugls-cell-uom">{r.uom}</span> : '—'}
                          </td>
                          <td className="ugls-num">
                            <div className="ugls-qty-breakdown">
                              <span className={`ugls-delta ${deltaClass}`}>
                                <DeltaIcon />
                                {fmtSignedInt(delta)}
                              </span>
                              {renderQtyBreakdown(delta, r.item_code)}
                            </div>
                          </td>
                          <td className="ugls-num">
                            <span className={`ugls-delta ${deltaClass}`}>
                              {fmtSignedCur(value)}
                            </span>
                          </td>
                          <td>
                            <div className="ugls-activity">
                              {Number(r.receive_count) > 0 && (
                                <span className="ugls-act-chip ugls-act-chip--in">
                                  <FiTrendingUp />
                                  {fmtInt(r.receive_count)} in
                                </span>
                              )}
                              {Number(r.release_count) > 0 && (
                                <span className="ugls-act-chip ugls-act-chip--out">
                                  <FiTrendingDown />
                                  {fmtInt(r.release_count)} out
                                </span>
                              )}
                            </div>
                          </td>
                          <td>
                            <span className="ugls-last" title={fmtDateTime(r.last_movement_at)}>
                              {fmtRelative(r.last_movement_at)}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile cards */}
              <div className="ugls-list-wrap ugls-cardlist">
                {items.map((r) => {
                  const delta = Number(r.delta_qty) || 0;
                  const value = Number(r.delta_value) || 0;
                  const deltaClass =
                    delta > 0 ? 'ugls-delta--pos'
                    : delta < 0 ? 'ugls-delta--neg'
                    : 'ugls-delta--zero';
                  const DeltaIcon = delta > 0 ? FiArrowUpRight
                    : delta < 0 ? FiArrowDownRight
                    : FiMinus;
                  return (
                    <div key={`c-${r.item_code}`} className="ugls-card">
                      <div className="ugls-card-head">
                        <div className="ugls-card-head-info">
                          <div className="ugls-cell-code">{r.item_code}</div>
                          {r.item_name && (
                            <div className="ugls-cell-name" title={r.item_name}>
                              {r.item_name}
                            </div>
                          )}
                          <div className="ugls-card-meta">
                            {r.uom && <span className="ugls-cell-uom">{r.uom}</span>}
                            {Number(r.receive_count) > 0 && (
                              <span className="ugls-act-chip ugls-act-chip--in">
                                <FiTrendingUp />
                                {fmtInt(r.receive_count)} in
                              </span>
                            )}
                            {Number(r.release_count) > 0 && (
                              <span className="ugls-act-chip ugls-act-chip--out">
                                <FiTrendingDown />
                                {fmtInt(r.release_count)} out
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="ugls-card-row">
                        <span className="ugls-card-row-label">Net qty</span>
                        <div className="ugls-qty-breakdown">
                          <span className={`ugls-delta ${deltaClass}`}>
                            <DeltaIcon />
                            {fmtSignedInt(delta)}
                          </span>
                          {renderQtyBreakdown(delta, r.item_code)}
                        </div>
                      </div>
                      <div className="ugls-card-row">
                        <span className="ugls-card-row-label">Net value</span>
                        <span className={`ugls-delta ${deltaClass}`}>
                          {fmtSignedCur(value)}
                        </span>
                      </div>
                      <div className="ugls-card-row">
                        <span className="ugls-card-row-label">Last movement</span>
                        <span className="ugls-last" title={fmtDateTime(r.last_movement_at)}>
                          {fmtRelative(r.last_movement_at)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Footer note */}
              <div className="ugls-info">
                <FiInfo />
                <span>
                  This is a read-only overlay. It does not change how releases
                  are recorded or how the shift reconciles. Every release is
                  still limited to the snapshot the underground started with.
                </span>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
};

export default UndergroundLiveStock;