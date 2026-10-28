// src/components/underground/TabSync.jsx
//
// Session 15 (S1) — Underground Handler "SYNC" tab.
// Session 15 (S2) — adds the Live Surface Activity panel.
// Session 15 (S4) — writes a pending-sync marker on network
//                   failure so UndergroundHandler can auto-retry.
// Session 15 (UX) — listens for UG_DATA_CHANGED so the tab
//                   refreshes its shift state when a sibling
//                   action closes the shift.
// Session 15 (S1+) — calls the new /shift/active endpoint so a
//                    Closed-but-unreconciled shift is picked up
//                    right after End Shift. Previously the tab
//                    only queried the Open shift, so the Sync
//                    Online button never appeared after closing.
//
// Session 16b — when this device is in ISOLATED topology (i.e.
// SURFACE_BASE_URL + SURFACE_SYNC_KEY are set), the Sync Online
// button pushes over HTTP to the surface. The response carries
// data.path = 'cross-db-online' in that case. The success banner
// surfaces that so the handler knows the shift crossed the peer
// channel rather than being applied on this DB.
//
// Design: tablet-first. Minimum 48px taps, 16px body text.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FiRefreshCw,
  FiWifi,
  FiWifiOff,
  FiCheckCircle,
  FiAlertTriangle,
  FiClock,
  FiPackage,
  FiTruck,
  FiInfo,
  FiZap,
  FiServer,
} from 'react-icons/fi';
import { useToast } from '../shared/ToastProvider';
import { undergroundApi, locatorLogApi } from '../../services/api';
import UndergroundLiveStock from './UndergroundLiveStock';

// Session 15 (UX) — reload our own shift snapshot whenever the
// shell mutates shift state (End Shift, seed import, issue form)
// or when the user returns to this tab.
import useRefreshOnFocus, { UG_DATA_CHANGED } from '../../hooks/useRefreshOnFocus';

const HEALTH_PING_MS = 25000;

const fmtMoney = (n) =>
  Number(n || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const fmtDateTime = (v) => {
  if (!v) return '—';
  try {
    const d = new Date(v);
    if (isNaN(d.getTime())) return '—';
    const pad = (x) => String(x).padStart(2, '0');
    return (
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
      `${pad(d.getHours())}:${pad(d.getMinutes())}`
    );
  } catch {
    return '—';
  }
};

/* ============================================================
   Path label — how the last successful sync reached the surface.
   Only shown on the success banner when data.path is present.
   ============================================================ */
const describeSyncPath = (path) => {
  if (path === 'cross-db-online') return 'via Cross-DB (peer channel)';
  if (path === 'online')          return 'via Online (shared DB)';
  if (path === 'shared-db')       return 'via Shared DB';
  if (path === 'offline-file')    return 'via closing file';
  return null;
};

const TAB_SYNC_CSS = `
.tab-sync { display: flex; flex-direction: column; gap: 20px; }

/* ---------- Connection strip ---------- */
.ts-conn {
  display: inline-flex; align-items: center; gap: 10px;
  padding: 10px 16px; border-radius: 999px;
  font-size: 14px; font-weight: 700; letter-spacing: 0.01em;
  width: fit-content; max-width: 100%;
}
.ts-conn-dot {
  width: 10px; height: 10px; border-radius: 50%;
  flex-shrink: 0; box-shadow: 0 0 0 4px rgba(0,0,0,0.05);
}
.ts-conn--online   { background: #ecfdf5; color: #065f46; border: 1px solid #a7f3d0; }
.ts-conn--online   .ts-conn-dot { background: #10b981; animation: tsPulse 2.4s ease-in-out infinite; }
.ts-conn--offline  { background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; }
.ts-conn--offline  .ts-conn-dot { background: #ef4444; }
.ts-conn--checking { background: #fef9c3; color: #854d0e; border: 1px solid #fde68a; }
.ts-conn--checking .ts-conn-dot { background: #f59e0b; animation: tsPulse 1.4s ease-in-out infinite; }
@keyframes tsPulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }

/* ---------- Hero card ---------- */
.ts-hero {
  background: linear-gradient(135deg, #ffffff 0%, #f6fefd 100%);
  border: 1px solid #b8f1ea;
  border-radius: 16px;
  padding: 22px 22px 24px;
  box-shadow: 0 1px 2px rgba(15,23,42,0.04), 0 14px 32px -16px rgba(0,184,176,0.35);
  display: flex; flex-direction: column; gap: 18px;
}
.ts-hero--empty { background: #f8fafc; border-color: #e2e8f0; box-shadow: none; }
.ts-hero--reconciled { background: linear-gradient(135deg, #f0fdfa 0%, #ccfbf1 100%); border-color: #5eead4; }

.ts-hero-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; flex-wrap: wrap; }
.ts-hero-title {
  display: inline-flex; align-items: center; gap: 10px;
  font-size: 13px; font-weight: 800; color: #0f766e;
  text-transform: uppercase; letter-spacing: 0.12em; margin: 0;
}
.ts-hero-title svg { width: 16px; height: 16px; stroke-width: 2.4; }

.ts-shift-no {
  font-size: 28px; font-weight: 800; color: #0f172a;
  font-family: 'JetBrains Mono','SF Mono',Monaco,Menlo,monospace;
  letter-spacing: -0.01em; line-height: 1.1;
}

.ts-status-pill {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 5px 12px; border-radius: 999px;
  font-size: 12px; font-weight: 800;
  text-transform: uppercase; letter-spacing: 0.08em;
}
.ts-status--open       { background: #fef3c7; color: #78350f; border: 1px solid #fde68a; }
.ts-status--closed     { background: #dbeafe; color: #1e3a8a; border: 1px solid #bfdbfe; }
.ts-status--reconciled { background: #d1fae5; color: #065f46; border: 1px solid #6ee7b7; }
.ts-status--other      { background: #f1f5f9; color: #475569; border: 1px solid #cbd5e1; }

.ts-metrics {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 12px;
}
.ts-metric {
  padding: 12px 14px; border-radius: 10px;
  background: #ffffff; border: 1px solid #e2e8f0;
}
.ts-metric-label { font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.08em; }
.ts-metric-value { font-size: 20px; font-weight: 800; color: #0f172a; font-family: 'JetBrains Mono','SF Mono',Monaco,Menlo,monospace; margin-top: 4px; }

/* ---------- Primary action ---------- */
.ts-primary {
  display: inline-flex; align-items: center; justify-content: center; gap: 12px;
  width: 100%; min-height: 60px; padding: 16px 24px;
  border: none; border-radius: 14px;
  background: linear-gradient(135deg, #0ea5a5 0%, #0f766e 100%);
  color: #ffffff; font-family: inherit;
  font-size: 17px; font-weight: 800; letter-spacing: 0.01em;
  cursor: pointer; box-shadow: 0 6px 20px -6px rgba(15,118,110,0.5);
  transition: transform 0.12s ease, box-shadow 0.12s ease, opacity 0.15s ease;
  -webkit-tap-highlight-color: transparent;
}
.ts-primary svg { width: 22px; height: 22px; stroke-width: 2.4; }
.ts-primary:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 10px 24px -6px rgba(15,118,110,0.6); }
.ts-primary:active:not(:disabled) { transform: translateY(0); }
.ts-primary:disabled { opacity: 0.55; cursor: not-allowed; box-shadow: none; }

.ts-secondary {
  display: inline-flex; align-items: center; justify-content: center; gap: 10px;
  width: 100%; min-height: 52px; padding: 14px 20px;
  border: 2px solid #cbd5e1; border-radius: 12px;
  background: #ffffff; color: #475569;
  font-family: inherit; font-size: 15px; font-weight: 700;
  cursor: pointer; transition: background 0.12s ease, border-color 0.12s ease;
  -webkit-tap-highlight-color: transparent;
}
.ts-secondary svg { width: 18px; height: 18px; stroke-width: 2.2; }
.ts-secondary:hover:not(:disabled) { background: #f8fafc; border-color: #94a3b8; }
.ts-secondary:disabled { opacity: 0.5; cursor: not-allowed; }

/* ---------- Banner ---------- */
.ts-banner {
  display: flex; align-items: flex-start; gap: 12px;
  padding: 14px 16px; border-radius: 10px; font-size: 14px; line-height: 1.55;
}
.ts-banner svg { width: 18px; height: 18px; stroke-width: 2.4; flex-shrink: 0; margin-top: 1px; }
.ts-banner--success { background: #ecfdf5; border: 1px solid #a7f3d0; color: #065f46; }
.ts-banner--error   { background: #fef2f2; border: 1px solid #fecaca; color: #991b1b; }
.ts-banner--warn    { background: #fffbeb; border: 1px solid #fde68a; color: #78350f; }
.ts-banner--info    { background: #eff6ff; border: 1px solid #bfdbfe; color: #1e3a8a; }

/* ---------- Banner path chip (Session 16b) ---------- */
.ts-banner-path {
  display: inline-flex; align-items: center; gap: 5px;
  margin-top: 6px;
  padding: 3px 9px;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.06);
  color: #334155;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.02em;
}
.ts-banner-path svg { width: 11px; height: 11px; stroke-width: 2.4; }
.ts-banner--success .ts-banner-path {
  background: rgba(5, 150, 105, 0.12);
  color: #065f46;
}
.ts-banner--info .ts-banner-path {
  background: rgba(37, 99, 235, 0.12);
  color: #1e3a8a;
}

/* ---------- Pending retry strip (S4) ---------- */
.ts-pending {
  display: flex; align-items: center; gap: 12px;
  padding: 14px 16px; border-radius: 10px;
  background: linear-gradient(135deg, #eef2ff 0%, #e0e7ff 100%);
  border: 1px solid #c7d2fe;
  color: #1e1b4b; font-size: 14px; line-height: 1.5;
}
.ts-pending-icon {
  width: 34px; height: 34px; border-radius: 9px;
  display: inline-flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, #818cf8 0%, #4338ca 100%);
  color: #ffffff;
  box-shadow: 0 4px 12px rgba(99, 102, 241, 0.28);
  flex-shrink: 0;
}
.ts-pending-icon svg { width: 16px; height: 16px; stroke-width: 2.4; }
.ts-pending-body { min-width: 0; flex: 1; }
.ts-pending-title {
  font-size: 13px; font-weight: 800; color: #312e81; line-height: 1.25;
}
.ts-pending-sub {
  font-size: 12px; color: #4338ca; margin-top: 2px; line-height: 1.4;
}

/* ---------- History ---------- */
.ts-history-head {
  display: flex; justify-content: space-between; align-items: center;
  margin-bottom: 10px; gap: 12px; flex-wrap: wrap;
}
.ts-history-title {
  font-size: 14px; font-weight: 800; color: #0f172a;
  display: inline-flex; align-items: center; gap: 8px; margin: 0;
}
.ts-history-title svg { width: 16px; height: 16px; stroke-width: 2.4; color: #0f766e; }

.ts-history-list { display: flex; flex-direction: column; gap: 8px; }
.ts-history-row {
  display: grid; grid-template-columns: 1fr auto; gap: 12px;
  padding: 14px 16px; border-radius: 10px;
  background: #ffffff; border: 1px solid #e2e8f0;
  align-items: center;
}
.ts-history-uid {
  font-family: 'JetBrains Mono','SF Mono',Monaco,Menlo,monospace;
  font-weight: 800; color: #0f172a; font-size: 14px;
}
.ts-history-meta { font-size: 12px; color: #64748b; margin-top: 3px; }
.ts-history-qty {
  font-family: 'JetBrains Mono','SF Mono',Monaco,Menlo,monospace;
  font-weight: 800; color: #0f766e; font-size: 15px;
  text-align: right; white-space: nowrap;
}

.ts-empty {
  padding: 28px 20px; text-align: center;
  border: 1px dashed #cbd5e1; border-radius: 12px;
  color: #64748b; font-size: 14px;
}

/* ---------- Loading ---------- */
.ts-loading {
  display: flex; align-items: center; justify-content: center;
  gap: 10px; padding: 40px 20px; color: #64748b; font-size: 14px;
}
.ts-spin { animation: tsSpin 0.9s linear infinite; }
@keyframes tsSpin { to { transform: rotate(360deg); } }

/* ---------- Responsive ---------- */
@media (max-width: 640px) {
  .ts-hero { padding: 18px 16px; }
  .ts-shift-no { font-size: 24px; }
  .ts-primary { font-size: 16px; min-height: 56px; }
  .ts-history-row { grid-template-columns: 1fr; }
  .ts-history-qty { text-align: left; }
  .ts-pending { align-items: flex-start; }
}

@media (max-width: 400px) {
  .ts-banner { font-size: 13px; padding: 12px 13px; }
  .ts-banner-path { font-size: 10.5px; padding: 2px 8px; }
}

@media (min-width: 1921px) {
  .ts-shift-no { font-size: 32px; }
  .ts-primary { font-size: 18px; min-height: 66px; }
  .ts-metric-value { font-size: 22px; }
  .ts-banner-path { font-size: 12px; padding: 4px 11px; }
}

@media (prefers-reduced-motion: reduce) {
  .ts-conn-dot, .ts-spin { animation: none !important; }
  .ts-primary, .ts-secondary { transition: none !important; }
}
`;

const TabSync = ({ onSyncQueued, onSyncSucceeded, pendingSync }) => {
  const toast = useToast();

  const [shift, setShift]                 = useState(null);
  const [shiftLoading, setShiftLoading]   = useState(true);
  const [shiftError, setShiftError]       = useState(null);

  const [history, setHistory]             = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [navOnline, setNavOnline]         = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [pingOk, setPingOk]               = useState(false);
  const [pingChecked, setPingChecked]     = useState(false);

  const [syncing, setSyncing]             = useState(false);
  const [lastResult, setLastResult]       = useState(null);

  const pingRef = useRef(null);

  // ---- Connection detection ----
  const doPing = useCallback(async () => {
    try {
      const res = await fetch(
        `${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api/health`,
        { method: 'HEAD', cache: 'no-store' }
      );
      setPingOk(res.ok);
    } catch {
      setPingOk(false);
    } finally {
      setPingChecked(true);
    }
  }, []);

  useEffect(() => {
    const goOnline  = () => setNavOnline(true);
    const goOffline = () => setNavOnline(false);
    window.addEventListener('online',  goOnline);
    window.addEventListener('offline', goOffline);
    doPing();
    pingRef.current = setInterval(doPing, HEALTH_PING_MS);
    return () => {
      window.removeEventListener('online',  goOnline);
      window.removeEventListener('offline', goOffline);
      if (pingRef.current) clearInterval(pingRef.current);
    };
  }, [doPing]);

  /* ------------------------------------------------------------
     Load the "active" shift from the backend.
     ------------------------------------------------------------ */
  const loadShift = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setShiftLoading(true);
    setShiftError(null);
    try {
      const res = await undergroundApi.activeShift();
      if (res.ok && res.data) {
        setShift(res.data.shift || null);
      } else {
        setShift(null);
      }
    } catch (err) {
      console.error('TabSync activeShift:', err);
      setShiftError('Could not load the current shift.');
    } finally {
      if (!silent) setShiftLoading(false);
    }
  }, []);

  /* ------------------------------------------------------------
     Load recent reconciliations.
     ------------------------------------------------------------ */
  const loadHistory = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setHistoryLoading(true);
    try {
      const res = await locatorLogApi.list({
        direction: 'Import',
        action_type: 'Underground Reconciliation',
        limit: 10,
      });
      if (res.ok && Array.isArray(res.data)) setHistory(res.data);
      else setHistory([]);
    } catch (err) {
      console.warn('TabSync history:', err);
    } finally {
      if (!silent) setHistoryLoading(false);
    }
  }, []);

  useEffect(() => { loadShift(); loadHistory(); }, [loadShift, loadHistory]);

  /* ============================================================
     Session 15 (UX) — auto-refresh
     ============================================================ */
  useRefreshOnFocus(
    () => {
      loadShift({ silent: true });
      loadHistory({ silent: true });
    },
    { events: [UG_DATA_CHANGED] }
  );

  // ---- Sync action ----
  const handleSync = async () => {
    if (!shift?.shift_id) return;
    setSyncing(true);
    setLastResult(null);
    try {
      const res = await undergroundApi.syncOnline(shift.shift_id, {
        sync_token: shift.sync_token || undefined,
        notes: 'Online sync from Underground Handler SYNC tab',
      });

      if (res.ok && res.data?.success !== false) {
        const d = res.data?.data || {};
        setLastResult({
          type: 'success',
          message: res.data?.message || `Synced · ${d.reconciliation_uid || ''}`,
          uid: d.reconciliation_uid,
          lines: d.reconciled_lines,
          // Session 16b — which path did this sync take?
          path: d.path || null,
        });
        toast.success(res.data?.message || 'Synced successfully.');
        onSyncSucceeded?.();
        await Promise.all([loadShift(), loadHistory()]);
        return;
      }

      if (res.status === 409 || res.data?.code === 'ALREADY_SYNCED') {
        setLastResult({
          type: 'warn',
          message: 'This shift has already been synced. No changes were applied.',
        });
        toast.warning('Already synced — no action taken.');
        onSyncSucceeded?.();
        await loadShift();
        return;
      }

      if (res.status >= 400 && res.status < 500) {
        setLastResult({
          type: 'error',
          message: res.data?.message || 'Sync failed. Please try again.',
        });
        toast.error(res.data?.message || 'Sync failed.');
        onSyncSucceeded?.();
        return;
      }

      setLastResult({
        type: 'warn',
        message:
          'Server did not respond cleanly. Sync will retry automatically.',
      });
      onSyncQueued?.({
        shift_id:   shift.shift_id,
        sync_token: shift.sync_token || null,
        at:         Date.now(),
      });
    } catch (err) {
      console.error('TabSync syncOnline:', err);
      setLastResult({
        type: 'warn',
        message:
          'Could not reach the server. Sync will retry automatically when the connection returns.',
      });
      toast.warning('Sync queued — will retry when online.');
      onSyncQueued?.({
        shift_id:   shift.shift_id,
        sync_token: shift.sync_token || null,
        at:         Date.now(),
      });
    } finally {
      setSyncing(false);
    }
  };

  // ---- Derived state ----
  const statusClass = useMemo(() => {
    const s = shift?.status;
    if (s === 'Open')       return 'ts-status--open';
    if (s === 'Closed')     return 'ts-status--closed';
    if (s === 'Reconciled') return 'ts-status--reconciled';
    return 'ts-status--other';
  }, [shift?.status]);

  const canSync =
    navOnline &&
    pingOk &&
    !syncing &&
    !!shift &&
    shift.status === 'Closed' &&
    !(pendingSync && pendingSync.shift_id === shift?.shift_id);

  const connectionOk = navOnline && pingOk;

  const connState = !pingChecked
    ? 'checking'
    : connectionOk
    ? 'online'
    : 'offline';

  const connLabel =
    connState === 'checking'
      ? 'Checking connection…'
      : connState === 'online'
      ? 'Online — ready to sync'
      : 'Offline — use the closing-file export instead';

  const hasPendingForThisShift =
    !!pendingSync && !!shift && pendingSync.shift_id === shift.shift_id;

  // ---- Render ----
  return (
    <div className="tab-sync">
      <style>{TAB_SYNC_CSS}</style>

      {/* Connection strip */}
      <div className={`ts-conn ts-conn--${connState}`}>
        <span className="ts-conn-dot" aria-hidden="true" />
        {connState === 'online' ? (
          <FiWifi size={16} />
        ) : connState === 'offline' ? (
          <FiWifiOff size={16} />
        ) : (
          <FiRefreshCw size={16} className="ts-spin" />
        )}
        <span>{connLabel}</span>
      </div>

      {/* Pending retry strip (S4) */}
      {hasPendingForThisShift && (
        <div className="ts-pending">
          <div className="ts-pending-icon">
            <FiZap />
          </div>
          <div className="ts-pending-body">
            <div className="ts-pending-title">Sync queued — retrying automatically</div>
            <div className="ts-pending-sub">
              The system will keep trying in the background. You can stay on
              any tab — you'll get a toast the moment it succeeds.
            </div>
          </div>
        </div>
      )}

      {/* Result banner */}
      {lastResult && (
        <div className={`ts-banner ts-banner--${lastResult.type}`}>
          {lastResult.type === 'success' && <FiCheckCircle />}
          {lastResult.type === 'error'   && <FiAlertTriangle />}
          {lastResult.type === 'warn'    && <FiInfo />}
          <div style={{ minWidth: 0 }}>
            <div>{lastResult.message}</div>
            {lastResult.uid && (
              <div style={{ fontSize: 12, marginTop: 4, opacity: 0.85 }}>
                Reference: <strong>{lastResult.uid}</strong>
                {lastResult.lines != null && ` · ${lastResult.lines} line(s)`}
              </div>
            )}
            {/* Session 16b — path chip on success */}
            {lastResult.type === 'success' && describeSyncPath(lastResult.path) && (
              <div className="ts-banner-path">
                <FiServer />
                <span>{describeSyncPath(lastResult.path)}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Hero card */}
      {shiftLoading ? (
        <div className="ts-hero ts-hero--empty">
          <div className="ts-loading">
            <FiRefreshCw size={18} className="ts-spin" />
            <span>Loading current shift…</span>
          </div>
        </div>
      ) : shiftError ? (
        <div className="ts-hero ts-hero--empty">
          <div className="ts-banner ts-banner--error">
            <FiAlertTriangle />
            <span>{shiftError}</span>
          </div>
          <button type="button" className="ts-secondary" onClick={loadShift}>
            <FiRefreshCw />
            <span>Retry</span>
          </button>
        </div>
      ) : !shift ? (
        <div className="ts-hero ts-hero--empty">
          <div className="ts-hero-head">
            <div>
              <h4 className="ts-hero-title">
                <FiClock />
                <span>No active shift</span>
              </h4>
              <div className="ts-empty" style={{ marginTop: 12 }}>
                Open a shift by importing a surface export, then come back here
                to sync it.
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div
          className={`ts-hero ${
            shift.status === 'Reconciled' ? 'ts-hero--reconciled' : ''
          }`}
        >
          <div className="ts-hero-head">
            <div>
              <h4 className="ts-hero-title">
                <FiPackage />
                <span>Current shift</span>
              </h4>
              <div className="ts-shift-no">Shift #{shift.shift_id}</div>
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
                Opened {fmtDateTime(shift.started_at)}
                {shift.ended_at && ` · Closed ${fmtDateTime(shift.ended_at)}`}
              </div>
            </div>
            <span className={`ts-status-pill ${statusClass}`}>
              {shift.status}
            </span>
          </div>

          <div className="ts-metrics">
            <div className="ts-metric">
              <div className="ts-metric-label">Released lines</div>
              <div className="ts-metric-value">{shift.release_line_count ?? 0}</div>
            </div>
            <div className="ts-metric">
              <div className="ts-metric-label">Released qty</div>
              <div className="ts-metric-value">
                {Number(shift.released_qty) || 0}
              </div>
            </div>
            <div className="ts-metric">
              <div className="ts-metric-label">Released value</div>
              <div className="ts-metric-value">
                ₱ {fmtMoney(shift.released_value)}
              </div>
            </div>
          </div>

          {shift.status === 'Open' && (
            <div className="ts-banner ts-banner--info">
              <FiInfo />
              <span>
                This shift is still <strong>Open</strong>. Close it in the
                Handler tab before you can sync.
              </span>
            </div>
          )}

          {shift.status === 'Closed' && !hasPendingForThisShift && (
            <>
              <button
                type="button"
                className="ts-primary"
                onClick={handleSync}
                disabled={!canSync}
                title={
                  canSync
                    ? 'Push the reconcile to the surface right now'
                    : connState === 'offline'
                    ? 'No connection — export the closing file instead'
                    : 'Waiting for a stable connection…'
                }
              >
                {syncing ? (
                  <>
                    <FiRefreshCw className="ts-spin" />
                    <span>Syncing…</span>
                  </>
                ) : (
                  <>
                    <FiTruck />
                    <span>Sync Online</span>
                  </>
                )}
              </button>

              {connState === 'offline' && (
                <div className="ts-banner ts-banner--warn">
                  <FiWifiOff />
                  <span>
                    You are offline. Walk the closing file to the surface
                    handler, or wait for Wi-Fi and try again.
                  </span>
                </div>
              )}
            </>
          )}

          {shift.status === 'Reconciled' && (
            <div className="ts-banner ts-banner--success">
              <FiCheckCircle />
              <span>
                <strong>Already synced.</strong>{' '}
                Reconciled {fmtDateTime(shift.reconciled_at)}
                {shift.reconciled_by_username
                  ? ` by ${shift.reconciled_by_username}`
                  : ''}
                .
              </span>
            </div>
          )}
        </div>
      )}

      {/* Live Surface Activity panel */}
      {!shiftLoading && shift && (
        <UndergroundLiveStock shift={shift} connectionOk={connectionOk} />
      )}

      {/* Sync history */}
      <div>
        <div className="ts-history-head">
          <h4 className="ts-history-title">
            <FiClock />
            <span>Recent reconciliations</span>
          </h4>
          <button
            type="button"
            className="ts-secondary"
            style={{ width: 'auto', minHeight: 40, padding: '8px 14px', fontSize: 13 }}
            onClick={() => loadHistory()}
            disabled={historyLoading}
          >
            <FiRefreshCw className={historyLoading ? 'ts-spin' : ''} />
            <span>Refresh</span>
          </button>
        </div>

        {historyLoading && history.length === 0 ? (
          <div className="ts-loading">
            <FiRefreshCw size={18} className="ts-spin" />
            <span>Loading…</span>
          </div>
        ) : history.length === 0 ? (
          <div className="ts-empty">No reconciliations recorded yet.</div>
        ) : (
          <div className="ts-history-list">
            {history.map((row) => (
              <div key={row.export_id} className="ts-history-row">
                <div>
                  <div className="ts-history-uid">{row.export_uid || '—'}</div>
                  <div className="ts-history-meta">
                    {fmtDateTime(row.performed_at)}
                    {row.performed_by_username
                      ? ` · ${row.performed_by_username}`
                      : ''}
                    {row.filename ? ` · file: ${row.filename}` : ' · online'}
                  </div>
                </div>
                <div className="ts-history-qty">
                  {Number(row.total_qty) || 0} u
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default TabSync;