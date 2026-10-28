// src/components/underground/UndergroundDashboard.jsx
import React, { useCallback, useEffect, useState } from 'react';
import {
  FiPackage,
  FiSend,
  FiBox,
  FiDollarSign,
  FiLoader,
  FiUploadCloud,
  FiLock,
  FiRefreshCw,
  FiInbox,
  FiAlertTriangle,
  FiChevronDown,
  FiChevronUp,
  FiTrendingDown,
  FiShield, // For scope badge
} from 'react-icons/fi';
import { undergroundApi } from '../../services/api';
import { useToast } from '../shared/ToastProvider';

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

const fmtDateTime = (value) => {
  if (!value) return '—';
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return '—';
  }
};

const fmtSignedInt = (n) => {
  const v = Number(n) || 0;
  if (v === 0) return '0';
  return v > 0 ? `+${fmtInt(v)}` : `−${fmtInt(Math.abs(v))}`;
};

const statusPillClass = (status) => {
  const s = String(status || '').toLowerCase();
  if (s === 'open')       return 'ug-pill ug-pill--open';
  if (s === 'closed')     return 'ug-pill ug-pill--closed';
  if (s === 'reconciled') return 'ug-pill ug-pill--reconciled';
  if (s === 'rejected')   return 'ug-pill ug-pill--rejected';
  return 'ug-pill ug-pill--none';
};

const SurfaceActivityNotice = ({ shift }) => {
  const [data, setData] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);

  const shiftId = shift?.shift_id ?? null;
  const isOpen  = shiftId != null && shift?.status === 'Open';

  const fetchData = useCallback(async () => {
    if (!isOpen) return;
    setLoading(true);
    try {
      const res = await undergroundApi.liveDeltas(shiftId);
      if (res.ok && res.data) setData(res.data);
    } catch (err) {
      console.warn('SurfaceActivityNotice fetch:', err);
    } finally {
      setLoading(false);
    }
  }, [isOpen, shiftId]);

  // ⚡ FIX: Removed the setInterval. It now only fetches once when opened or when shift changes.
  useEffect(() => {
    if (!isOpen) { setData(null); return; }
    fetchData();
  }, [isOpen, fetchData]);

  const items = Array.isArray(data?.items) ? data.items : [];
  const reduced = items.filter((r) => Number(r.delta_qty) < 0);

  if (!isOpen || reduced.length === 0) return null;

  const count = reduced.length;
  const totalReducedQty = reduced.reduce(
    (s, r) => s + Math.abs(Number(r.delta_qty) || 0),
    0
  );

  return (
    <div className="ugsan">
      <style>{surfaceNoticeCss}</style>

      <div className="ugsan-head" style={{ cursor: 'default' }}>
        <span className="ugsan-icon" aria-hidden="true">
          <FiTrendingDown />
        </span>
        <div 
          className="ugsan-main" 
          onClick={() => setExpanded((v) => !v)}
          style={{ cursor: 'pointer' }}
        >
          <span className="ugsan-title">
            Surface reduced {count} item{count === 1 ? '' : 's'} while this shift is open
          </span>
          <span className="ugsan-sub">
            {fmtInt(totalReducedQty)} unit{totalReducedQty === 1 ? '' : 's'} removed
            {' · '}
            review before releasing
          </span>
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button 
            type="button" 
            className="ugsan-refresh" 
            onClick={fetchData}
            disabled={loading}
            title="Refresh surface activity"
          >
            <FiRefreshCw className={loading ? "ugsan-spin" : ""} />
          </button>
          <button
            type="button"
            className="ugsan-chev"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-label="Toggle details"
          >
            {expanded ? <FiChevronUp /> : <FiChevronDown />}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="ugsan-body">
          <div className="ugsan-list">
            {reduced.map((r) => (
              <div key={r.item_code} className="ugsan-row">
                <div className="ugsan-row-info">
                  <div className="ugsan-row-code">{r.item_code}</div>
                  {r.item_name && (
                    <div className="ugsan-row-name" title={r.item_name}>
                      {r.item_name}
                    </div>
                  )}
                </div>
                <div className="ugsan-row-uom">
                  {r.uom ? <span className="ugsan-uom">{r.uom}</span> : null}
                </div>
                <div className="ugsan-row-delta">
                  <FiTrendingDown />
                  <span>{fmtSignedInt(r.delta_qty)}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="ugsan-foot">
            <FiAlertTriangle />
            <span>
              Your snapshot is unchanged. This notice is only a heads-up: the
              surface has moved these items since the shift opened.
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

const surfaceNoticeCss = `
.ugsan {
  position: relative;
  background: linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%);
  border: 1.5px solid #fcd34d;
  border-left: 5px solid #f59e0b;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 1px 2px rgba(245, 158, 11, 0.08);
}
.ugsan-head {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 12px 14px;
  border: none;
  background: transparent;
  font-family: inherit;
  text-align: left;
  color: #78350f;
  transition: background 0.15s ease;
  -webkit-tap-highlight-color: transparent;
}
.ugsan-head:hover { background: rgba(255, 255, 255, 0.4); }

.ugsan-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 9px;
  background: linear-gradient(135deg, #fbbf24 0%, #b45309 100%);
  color: #ffffff;
  flex-shrink: 0;
  box-shadow: 0 3px 10px rgba(180, 83, 9, 0.28);
}
.ugsan-icon svg { width: 18px; height: 18px; stroke-width: 2.4; }

.ugsan-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}
.ugsan-title {
  font-size: 13.5px;
  font-weight: 800;
  letter-spacing: 0.005em;
  line-height: 1.25;
  color: #78350f;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ugsan-sub {
  font-size: 12px;
  font-weight: 600;
  color: #92400e;
  line-height: 1.35;
}

.ugsan-refresh {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  background: rgba(255, 255, 255, 0.5);
  border-radius: 50%;
  color: #b45309;
  cursor: pointer;
  transition: all 0.15s ease;
}
.ugsan-refresh:hover:not(:disabled) { background: #ffffff; color: #78350f; }
.ugsan-refresh:disabled { opacity: 0.5; cursor: not-allowed; }
.ugsan-refresh svg { width: 14px; height: 14px; stroke-width: 2.6; }

.ugsan-chev {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: #92400e;
  border: none;
  background: transparent;
  cursor: pointer;
  padding: 4px;
}
.ugsan-chev svg { width: 18px; height: 18px; stroke-width: 2.4; }

.ugsan-spin { animation: ugsanSpin 0.9s linear infinite; }
@keyframes ugsanSpin { to { transform: rotate(360deg); } }

.ugsan-body {
  padding: 0 14px 14px;
  animation: ugsanFade 0.18s ease-out;
}
@keyframes ugsanFade {
  from { opacity: 0; transform: translateY(-3px); }
  to   { opacity: 1; transform: translateY(0); }
}

.ugsan-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  background: #ffffff;
  border: 1px solid #fde68a;
  border-radius: 9px;
  max-height: 280px;
  overflow-y: auto;
}
.ugsan-row {
  display: grid;
  grid-template-columns: 1fr auto auto;
  gap: 10px;
  align-items: center;
  padding: 8px 4px;
  border-bottom: 1px solid #fef3c7;
}
.ugsan-row:last-child { border-bottom: none; }
.ugsan-row-info { min-width: 0; }
.ugsan-row-code {
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-size: 12.5px;
  font-weight: 800;
  color: #0f172a;
  line-height: 1.2;
}
.ugsan-row-name {
  font-size: 11.5px;
  color: #64748b;
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 320px;
}
.ugsan-row-uom { flex-shrink: 0; }
.ugsan-uom {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 6px;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-size: 11px;
  font-weight: 700;
  background: #f1f5f9;
  color: #334155;
}
.ugsan-row-delta {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-weight: 800;
  font-size: 13px;
  color: #b91c1c;
  white-space: nowrap;
  flex-shrink: 0;
}
.ugsan-row-delta svg { width: 13px; height: 13px; stroke-width: 2.6; }

.ugsan-foot {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-top: 10px;
  padding: 9px 11px;
  background: rgba(255, 255, 255, 0.55);
  border: 1px dashed #fcd34d;
  border-radius: 8px;
  font-size: 12px;
  color: #78350f;
  line-height: 1.5;
}
.ugsan-foot svg {
  width: 14px;
  height: 14px;
  stroke-width: 2.4;
  flex-shrink: 0;
  margin-top: 1px;
  color: #d97706;
}

@media (max-width: 480px) {
  .ugsan-head { padding: 10px 12px; gap: 10px; }
  .ugsan-icon { width: 30px; height: 30px; border-radius: 8px; }
  .ugsan-icon svg { width: 16px; height: 16px; }
  .ugsan-title { font-size: 12.5px; white-space: normal; }
  .ugsan-sub { font-size: 11px; }
  .ugsan-body { padding: 0 12px 12px; }
  .ugsan-list { padding: 8px 10px; max-height: 240px; }
  .ugsan-row { gap: 8px; }
  .ugsan-row-name { max-width: 200px; }
}
@media (max-width: 360px) {
  .ugsan-title { font-size: 12px; }
  .ugsan-sub { font-size: 10.5px; }
  .ugsan-row-delta { font-size: 12px; }
}
@media (min-width: 1921px) {
  .ugsan-head { padding: 14px 18px; gap: 14px; }
  .ugsan-icon { width: 40px; height: 40px; border-radius: 10px; }
  .ugsan-icon svg { width: 20px; height: 20px; }
  .ugsan-title { font-size: 15px; }
  .ugsan-sub { font-size: 13px; }
  .ugsan-body { padding: 0 18px 18px; }
  .ugsan-list { padding: 12px 16px; }
  .ugsan-row-code { font-size: 13.5px; }
  .ugsan-row-name { font-size: 12.5px; max-width: 420px; }
}
@media (prefers-reduced-motion: reduce) {
  .ugsan-head { transition: none !important; }
  .ugsan-body { animation: none !important; }
  .ugsan-spin { animation: none !important; }
}
`;

const UndergroundDashboard = ({
  currentShift,
  summary,
  loading,
  onOpenSeedImport,
  onOpenCloseShift,
  onRefresh,
  scopedBodegas,
}) => {
  const toast = useToast();
  const [recent, setRecent] = useState([]);
  const [recentLoading, setRecentLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadRecent = useCallback(async ({ silent = false } = {}) => {
    if (silent) setRefreshing(true);
    else setRecentLoading(true);
    try {
      const res = await undergroundApi.listShifts({ page: 1, limit: 8 });
      if (res.ok) setRecent(Array.isArray(res.data) ? res.data : []);
      else setRecent([]);
    } catch (err) {
      console.warn('Failed to load recent shifts:', err);
      setRecent([]);
    } finally {
      setRecentLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadRecent();
  }, [loadRecent, currentShift?.shift_id]);

  const handleRefresh = async () => {
    await Promise.all([
      onRefresh?.({ silent: true }),
      loadRecent({ silent: true }),
    ]);
  };

  if (!loading && !currentShift) {
    return (
      <div className="ug-section">
        <header className="ug-header">
          <div className="ug-header-left">
            <div className="ug-header-icon"><FiPackage /></div>
            <div className="ug-header-info">
              <h2 className="ug-header-title">Underground Workspace</h2>
              <div className="ug-header-sub">No open shift</div>
            </div>
          </div>
          <div className="ug-header-actions">
            <button
              type="button"
              className="ug-btn ug-btn--primary"
              onClick={onOpenSeedImport}
            >
              <FiUploadCloud />
              <span>Import Surface Export</span>
            </button>
          </div>
        </header>

        <div className="ug-card">
          <div className="ug-empty">
            <FiInbox />
            <div className="ug-empty-title">No active shift</div>
            <div className="ug-empty-sub">
              Import the latest surface export to open a new shift. That file
              becomes the beginning balance for the underground's work today.
            </div>
          </div>
        </div>

        <RecentShiftsCard
          recent={recent}
          loading={recentLoading}
          refreshing={refreshing}
          onRefresh={handleRefresh}
        />
      </div>
    );
  }

  const begQty   = Number(currentShift?.beginning_qty)   || 0;
  const relQty   = Number(currentShift?.released_qty)    || 0;
  const endQty   = Number(currentShift?.ending_qty)      || Number(summary?.qty_on_hand) || 0;
  const begVal   = Number(currentShift?.beginning_value) || 0;
  const hasScope = Array.isArray(scopedBodegas) && scopedBodegas.length > 0;

  return (
    <div className="ug-section">
      <style>{dashboardExtrasCss}</style>

      <header className="ug-header">
        <div className="ug-header-left">
          <div className="ug-header-icon"><FiPackage /></div>
          <div className="ug-header-info">
            <h2 className="ug-header-title">
              Shift #{currentShift.shift_id}
            </h2>
            <div className="ug-header-sub">
              {currentShift.warehouse_code} · started {fmtDateTime(currentShift.started_at)}
              {hasScope && (
                <span
                  className="ugdash-scope-badge"
                  title={`You only see: ${scopedBodegas.join(', ')}`}
                >
                  <FiShield size={12} />
                  <span>Scoped to {scopedBodegas.length} Bodega{scopedBodegas.length === 1 ? '' : 's'}</span>
                </span>
              )}
            </div>
          </div>
          <span className={statusPillClass(currentShift.status)}>
            <span className="ug-pill-dot" />
            {currentShift.status}
          </span>
        </div>
        <div className="ug-header-actions">
          <button
            type="button"
            className="ug-btn ug-btn--secondary ug-btn--sm"
            onClick={handleRefresh}
            disabled={refreshing}
          >
            <FiRefreshCw className={refreshing ? 'ug-spin' : ''} />
            <span>{refreshing ? 'Refreshing…' : 'Refresh'}</span>
          </button>
          {currentShift.status === 'Open' && (
            <button
              type="button"
              className="ug-btn ug-btn--danger ug-btn--sm"
              onClick={onOpenCloseShift}
            >
              <FiLock />
              <span>End Shift</span>
            </button>
          )}
        </div>
      </header>

      {currentShift.status === 'Open' && (
        <SurfaceActivityNotice shift={currentShift} />
      )}

      <section className="ugdash-stats">
        <div className="ugdash-stat ugdash-stat--seed">
          <div className="ugdash-stat-icon"><FiPackage /></div>
          <div className="ugdash-stat-info">
            <span className="ugdash-stat-value">{fmtInt(begQty)}</span>
            <span className="ugdash-stat-label">Beginning Qty</span>
          </div>
        </div>
        <div className="ugdash-stat ugdash-stat--rel">
          <div className="ugdash-stat-icon"><FiSend /></div>
          <div className="ugdash-stat-info">
            <span className="ugdash-stat-value">{fmtInt(relQty)}</span>
            <span className="ugdash-stat-label">Released This Shift</span>
          </div>
        </div>
        <div className="ugdash-stat ugdash-stat--qty">
          <div className="ugdash-stat-icon"><FiBox /></div>
          <div className="ugdash-stat-info">
            <span className="ugdash-stat-value">{fmtInt(endQty)}</span>
            <span className="ugdash-stat-label">On Hand Now</span>
          </div>
        </div>
        <div className="ugdash-stat ugdash-stat--value">
          <div className="ugdash-stat-icon"><FiDollarSign /></div>
          <div className="ugdash-stat-info">
            <span className="ugdash-stat-value">{fmtCur(begVal)}</span>
            <span className="ugdash-stat-label">Beginning Value</span>
          </div>
        </div>
      </section>

      <div className="ugdash-grid">
        {/* SIMPLIFIED SHIFT DETAILS CARD */}
        <div className="ug-card">
          <h3 className="ug-card-title">Shift Details</h3>
          <dl className="ugdash-kv">
            <dt>Warehouse</dt>
            <dd>{currentShift.warehouse_code}</dd>

            <dt>Handler</dt>
            <dd>{currentShift.handler_username || '—'}</dd>

            <dt>Started</dt>
            <dd>{fmtDateTime(currentShift.started_at)}</dd>

            <dt>Ended</dt>
            <dd className={currentShift.ended_at ? '' : 'is-muted'}>
              {currentShift.ended_at ? fmtDateTime(currentShift.ended_at) : 'Not yet'}
            </dd>

            <dt>Seed Ref</dt>
            <dd className="is-mono">
              {currentShift.seed_export_uid || '—'}
            </dd>

            <dt>Closing Ref</dt>
            <dd className={`is-mono ${currentShift.closing_export_uid ? '' : 'is-muted'}`}>
              {currentShift.closing_export_uid || 'Pending'}
            </dd>

            <dt>Reconciled</dt>
            <dd className={currentShift.reconciled_at ? '' : 'is-muted'}>
              {currentShift.reconciled_at
                ? `${fmtDateTime(currentShift.reconciled_at)} · ${currentShift.reconciled_by_username || ''}`
                : 'Pending'}
            </dd>
          </dl>
        </div>

        <RecentShiftsCard
          recent={recent}
          loading={recentLoading}
          refreshing={refreshing}
          onRefresh={handleRefresh}
        />
      </div>

      {currentShift.status !== 'Open' && (
        <div className="ugmodal-warn">
          <FiAlertTriangle />
          <div>
            This shift is <strong>{currentShift.status}</strong>.
            {currentShift.status === 'Closed' && (
              <> Export the closing file and deliver it to the surface handler for reconciliation.</>
            )}
            {currentShift.status === 'Reconciled' && (
              <> The surface side has committed these deductions to real stock. Ready for the next shift.</>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const RecentShiftsCard = ({ recent, loading, refreshing, onRefresh }) => {
  return (
    <div className="ug-card">
      <h3 className="ug-card-title">
        Recent Shifts
        <button
          type="button"
          className="ug-btn ug-btn--ghost ug-btn--sm"
          onClick={onRefresh}
          disabled={refreshing}
          style={{ marginLeft: 'auto' }}
          title="Refresh"
        >
          <FiRefreshCw className={refreshing ? 'ug-spin' : ''} />
        </button>
      </h3>

      {loading ? (
        <div className="ug-loading">
          <FiLoader className="ug-spin" />
          <span>Loading…</span>
        </div>
      ) : recent.length === 0 ? (
        <div className="ug-empty">
          <FiInbox />
          <div className="ug-empty-title">No shifts yet</div>
          <div className="ug-empty-sub">
            Your completed shifts will appear here.
          </div>
        </div>
      ) : (
        <div className="ugdash-recent">
          {recent.map((s) => (
            <div key={s.shift_id} className="ugdash-recent-item">
              <div className="ugdash-recent-main">
                <div className="ugdash-recent-title">
                  Shift #{s.shift_id} · {s.warehouse_code}
                  {s.handler_username && <> · {s.handler_username}</>}
                </div>
                <div className="ugdash-recent-meta">
                  {fmtDateTime(s.started_at)} — {fmtInt(s.released_qty)} qty released
                  {s.closing_export_uid ? ` · ${s.closing_export_uid}` : ''}
                </div>
              </div>
              <span className={statusPillClass(s.status)}>
                <span className="ug-pill-dot" />
                {s.status}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default UndergroundDashboard;

// ============================================================
// Component-scoped CSS for the dashboard scope badge
// ============================================================
const dashboardExtrasCss = `
.ugdash-scope-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: 8px;
  padding: 2px 8px;
  border-radius: 999px;
  background: #e0f2fe;
  color: #0369a1;
  border: 1px solid #7dd3fc;
  font-size: 11px;
  font-weight: 700;
  vertical-align: middle;
  white-space: nowrap;
}

@media (max-width: 640px) {
  .ugdash-scope-badge {
    display: flex;
    width: fit-content;
    margin-left: 0;
    margin-top: 6px;
  }
}
`;