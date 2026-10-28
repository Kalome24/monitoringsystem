// src/components/underground/OnlineSyncModal.jsx
//
// Session 15 (S1+) — Surface handler's ONLINE SYNC modal.
//
// Lists pending underground shifts (Closed, not yet reconciled)
// for the caller's warehouse. Each row shows the underground
// handler who produced the shift and the released totals, so the
// surface handler knows exactly what will be applied.
//
// Session 16b — the modal is now PEER-AWARE.
//
//   • Top section lists every standalone underground server
//     ("peer") that heartbeats to this surface. Peers are
//     grouped by warehouse (UG handler sees UG peers only).
//
//   • Clicking "Pull All Pending" on a peer enqueues a command
//     via /peers/:server_id/command. The peer picks it up on its
//     next heartbeat (≤30s), pushes every Closed shift to this
//     surface, and marks itself reconciled locally.
//
//   • The local pending shifts section (below) is unchanged and
//     still the primary path for the shared-DB topology. It
//     gracefully stays empty when running isolated-only.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FiX,
  FiLoader,
  FiAlertTriangle,
  FiCheckCircle,
  FiUser,
  FiClock,
  FiPackage,
  FiTruck,
  FiRefreshCw,
  FiInbox,
  FiZap,
  FiServer,
  FiWifi,
  FiWifiOff,
  FiActivity,
} from 'react-icons/fi';
import { undergroundApi } from '../../services/api';
import { useToast } from '../shared/ToastProvider';

/* ============================================================
   Formatters
   ============================================================ */
const intFmt = new Intl.NumberFormat('en-PH');
const curFmt = new Intl.NumberFormat('en-PH', {
  style: 'currency', currency: 'PHP',
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});
const fmtInt = (n) => intFmt.format(Number(n) || 0);
const fmtCur = (n) => curFmt.format(Number(n) || 0);

const fmtDateTime = (v) => {
  if (!v) return '—';
  try {
    const d = new Date(v);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' });
  } catch { return '—'; }
};

const fmtRelative = (v) => {
  if (!v) return '—';
  try {
    const t = new Date(v).getTime();
    if (!Number.isFinite(t)) return '—';
    const secs = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (secs < 5)   return 'just now';
    if (secs < 60)  return `${secs}s ago`;
    const mins = Math.round(secs / 60);
    if (mins < 60)  return `${mins}m ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24)   return `${hrs}h ago`;
    return `${Math.round(hrs / 24)}d ago`;
  } catch { return '—'; }
};

/* ============================================================
   Peer status → visual
   ============================================================ */
const STATUS_VISUAL = {
  online:   { label: 'Online',   dot: '#10b981', cls: 'is-online'   },
  degraded: { label: 'Unstable', dot: '#f59e0b', cls: 'is-degraded' },
  offline:  { label: 'Offline',  dot: '#94a3b8', cls: 'is-offline'  },
  unknown:  { label: 'Unknown',  dot: '#cbd5e1', cls: 'is-unknown'  },
};
const statusVisual = (s) => STATUS_VISUAL[s] || STATUS_VISUAL.unknown;

/* ============================================================
   Component
   ============================================================ */
const OnlineSyncModal = ({ onClose, onSynced }) => {
  const toast = useToast();

  /* ---------- Local pending shifts (existing) ---------- */
  const [rows, setRows]               = useState([]);
  const [warehouse, setWarehouse]     = useState(null);
  const [loading, setLoading]         = useState(true);
  const [refreshing, setRefreshing]   = useState(false);
  const [error, setError]             = useState(null);
  const [syncingId, setSyncingId]     = useState(null);
  const [confirming, setConfirming]   = useState(null);

  /* ---------- Peers (Session 16b) ---------- */
  const [peers, setPeers]                       = useState([]);
  const [peersLoading, setPeersLoading]         = useState(true);
  const [peersError, setPeersError]             = useState(null);
  const [requestingPeerId, setRequestingPeerId] = useState(null);
  const [requestStartedAt, setRequestStartedAt] = useState(null);
  const peerPollRef = useRef(null);

  /* ============================================================
     Load — fetches pending shifts + peers in parallel
     ============================================================ */
  const load = useCallback(async ({ silent = false } = {}) => {
    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
      setPeersLoading(true);
    }
    setError(null);
    setPeersError(null);

    const [pendingRes, peersRes] = await Promise.allSettled([
      undergroundApi.listPendingSyncs({ limit: 50 }),
      undergroundApi.listPeers({}),
    ]);

    // ---- Local pending shifts ----
    if (pendingRes.status === 'fulfilled' && pendingRes.value?.ok) {
      const r = pendingRes.value;
      setRows(Array.isArray(r.data) ? r.data : []);
      if (r.warehouse) setWarehouse(r.warehouse);
    } else {
      const msg =
        (pendingRes.status === 'fulfilled' && (pendingRes.value?.data?.message || pendingRes.value?.error)) ||
        'Could not load pending syncs.';
      setError(msg);
      setRows([]);
    }

    // ---- Peers ----
    if (peersRes.status === 'fulfilled' && peersRes.value?.ok) {
      const r = peersRes.value;
      setPeers(Array.isArray(r.data) ? r.data : []);
      if (!warehouse && r.warehouse) setWarehouse(r.warehouse);
    } else {
      const msg =
        (peersRes.status === 'fulfilled' && (peersRes.value?.data?.message || peersRes.value?.error)) ||
        'Could not load peers.';
      setPeersError(msg);
      setPeers([]);
    }

    setLoading(false);
    setPeersLoading(false);
    setRefreshing(false);
  }, [warehouse]);

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  /* ============================================================
     Poll peers while a pull request is pending
     ============================================================ */
  useEffect(() => {
    if (!requestingPeerId) {
      if (peerPollRef.current) {
        clearInterval(peerPollRef.current);
        peerPollRef.current = null;
      }
      return;
    }

    peerPollRef.current = setInterval(async () => {
      const res = await undergroundApi.listPeers({}).catch(() => null);
      if (!res?.ok) return;

      const fresh = Array.isArray(res.data) ? res.data : [];
      setPeers(fresh);

      const peer = fresh.find((p) => p.server_id === requestingPeerId);
      if (!peer) {
        setRequestingPeerId(null);
        return;
      }

      // Success: pending_count dropped to zero.
      if (peer.pending_count === 0) {
        toast.success(`${requestingPeerId} finished pulling.`);
        setRequestingPeerId(null);
        setRequestStartedAt(null);
        // Refresh local pending too (some may have landed via shared-DB path).
        load({ silent: true });
        return;
      }

      // Timeout after 2 minutes.
      if (requestStartedAt && Date.now() - requestStartedAt > 120000) {
        toast.warning(`${requestingPeerId} did not respond within 2 minutes.`);
        setRequestingPeerId(null);
        setRequestStartedAt(null);
      }
    }, 3000);

    return () => {
      if (peerPollRef.current) {
        clearInterval(peerPollRef.current);
        peerPollRef.current = null;
      }
    };
  }, [requestingPeerId, requestStartedAt, load, toast]);

  /* ============================================================
     Request pull from a peer
     ============================================================ */
  const handleRequestPull = async (peer) => {
    if (!peer.pending_count || peer.pending_count === 0) {
      toast.info(`${peer.server_id} has no pending shifts.`);
      return;
    }
    if (peer.status !== 'online' && peer.status !== 'degraded') {
      toast.warning(`${peer.server_id} is offline. Try again when it reconnects.`);
      return;
    }

    const res = await undergroundApi.createPeerCommand(peer.server_id, {
      kind: 'pull_all_pending',
      payload: { limit: 200 },
    });

    if (res?.ok) {
      toast.success(
        `Requested pull from ${peer.server_id}. ` +
        `The peer will push within ~30s.`
      );
      setRequestingPeerId(peer.server_id);
      setRequestStartedAt(Date.now());
    } else {
      toast.error(res?.data?.message || 'Could not request pull.');
    }
  };

  /* ============================================================
     Local shift sync (existing behaviour)
     ============================================================ */
  const handleConfirmSync = (row) => setConfirming(row);

  const handleSync = async () => {
    if (!confirming) return;
    const row = confirming;
    setSyncingId(row.shift_id);
    try {
      const res = await undergroundApi.syncOnline(row.shift_id, {
        sync_token: row.sync_token || undefined,
        notes: `Online sync by surface handler (shift #${row.shift_id})`,
      });

      if (res.ok && res.data?.success !== false) {
        const d = res.data?.data || {};
        toast.success(
          res.data?.message ||
          `Synced shift #${row.shift_id} · ${d.reconciled_lines || 0} line(s)`
        );
        setConfirming(null);
        setRows((prev) => prev.filter((r) => r.shift_id !== row.shift_id));
        onSynced?.(row);
        return;
      }

      if (res.status === 409 || res.data?.code === 'ALREADY_SYNCED') {
        toast.info('This shift was already reconciled.');
        setConfirming(null);
        setRows((prev) => prev.filter((r) => r.shift_id !== row.shift_id));
        return;
      }

      toast.error(res.data?.message || 'Sync failed. Please try again.');
    } catch (err) {
      console.error('OnlineSyncModal sync:', err);
      toast.error('Could not reach the server. Please try again.');
    } finally {
      setSyncingId(null);
    }
  };

  /* ============================================================
     Derived
     ============================================================ */
  const totalQty = useMemo(
    () => rows.reduce((s, r) => s + (Number(r.released_qty) || 0), 0),
    [rows]
  );
  const totalValue = useMemo(
    () => rows.reduce((s, r) => s + (Number(r.released_value) || 0), 0),
    [rows]
  );
  const peersWithPending = useMemo(
    () => peers.filter((p) => (Number(p.pending_count) || 0) > 0),
    [peers]
  );

  const hasPeers = peers.length > 0;
  const hasLocalRows = rows.length > 0;

  return (
    <div className="ugmodal-overlay" onClick={syncingId ? undefined : onClose}>
      <div
        className="ugmodal-card ugmodal-card--wide"
        onClick={(e) => e.stopPropagation()}
      >
        <style>{onlineSyncCss}</style>

        {/* Header */}
        <div className="ugmodal-header">
          <div className="ugmodal-header-left">
            <div
              className="ugmodal-header-icon"
              style={{ background: 'linear-gradient(135deg, #0ea5a5 0%, #0f766e 100%)' }}
            >
              <FiZap />
            </div>
            <div style={{ minWidth: 0 }}>
              <h3 className="ugmodal-title">Online Sync</h3>
              <div className="ugmodal-sub">
                {warehouse
                  ? `Underground servers and pending shifts at ${warehouse.code}.`
                  : 'Loading warehouse…'}
              </div>
            </div>
          </div>
          <button
            type="button"
            className="ugmodal-close"
            onClick={onClose}
            disabled={!!syncingId}
            aria-label="Close"
          >
            <FiX />
          </button>
        </div>

        {/* Body */}
        <div className="ugmodal-body">
          {/* ---------- Peers section ---------- */}
          <section className="osync-peers">
            <header className="osync-peers-head">
              <div className="osync-peers-head-left">
                <FiServer />
                <span>Underground Servers</span>
                {!peersLoading && peers.length > 0 && (
                  <span className="osync-peers-count">{peers.length}</span>
                )}
              </div>
              <button
                type="button"
                className="osync-peers-refresh"
                onClick={() => load({ silent: true })}
                disabled={refreshing || peersLoading}
                title="Refresh peers"
              >
                <FiRefreshCw className={refreshing ? 'ug-spin' : ''} />
              </button>
            </header>

            {peersError && (
              <div className="osync-peers-empty osync-peers-empty--error">
                <FiAlertTriangle />
                <span>{peersError}</span>
              </div>
            )}

            {peersLoading && !peersError && (
              <div className="osync-peers-empty">
                <FiLoader className="ug-spin" />
                <span>Checking for peers…</span>
              </div>
            )}

            {!peersLoading && !peersError && peers.length === 0 && (
              <div className="osync-peers-empty">
                <FiWifiOff />
                <div className="osync-peers-empty-title">No peers registered</div>
                <div className="osync-peers-empty-sub">
                  No standalone underground server has heartbeated to this
                  surface yet. Once an underground device connects and
                  heartbeats, it will appear here.
                </div>
              </div>
            )}

            {!peersLoading && peers.length > 0 && (
              <div className="osync-peers-list">
                {peers.map((p) => {
                  const vis = statusVisual(p.status);
                  const pendingCount = Number(p.pending_count) || 0;
                  const isRequesting = requestingPeerId === p.server_id;
                  const canPull =
                    pendingCount > 0 &&
                    (p.status === 'online' || p.status === 'degraded') &&
                    !requestingPeerId;

                  return (
                    <article
                      key={p.server_id}
                      className={`osync-peer ${vis.cls} ${isRequesting ? 'is-requesting' : ''}`}
                    >
                      <div className="osync-peer-head">
                        <div className="osync-peer-identity">
                          <span
                            className="osync-peer-dot"
                            style={{ background: vis.dot }}
                            aria-hidden="true"
                          />
                          <span className="osync-peer-id">{p.server_id}</span>
                        </div>
                        <span className={`osync-peer-status osync-peer-status--${p.status}`}>
                          {vis.label}
                        </span>
                      </div>

                      {(p.display_name || p.device_hostname) && (
                        <div className="osync-peer-sub">
                          {p.display_name || p.device_hostname}
                          {p.device_hostname && p.display_name && (
                            <span className="osync-peer-sub-sep"> · </span>
                          )}
                          {p.device_hostname && p.display_name ? p.device_hostname : null}
                        </div>
                      )}

                      <div className="osync-peer-meta">
                        <span className="osync-peer-meta-chip">
                          <FiWifi />
                          <span>{p.warehouse_code}</span>
                        </span>
                        <span className="osync-peer-meta-chip">
                          <FiClock />
                          <span>{fmtRelative(p.last_heartbeat_at)}</span>
                        </span>
                        {pendingCount > 0 ? (
                          <span className="osync-peer-meta-chip osync-peer-meta-chip--pending">
                            <FiPackage />
                            <span>{fmtInt(pendingCount)} pending</span>
                          </span>
                        ) : (
                          <span className="osync-peer-meta-chip osync-peer-meta-chip--empty">
                            <FiCheckCircle />
                            <span>Nothing pending</span>
                          </span>
                        )}
                      </div>

                      {isRequesting ? (
                        <div className="osync-peer-requesting">
                          <FiLoader className="ug-spin" />
                          <span>Waiting for peer to push (≤30s)…</span>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="osync-peer-btn"
                          onClick={() => handleRequestPull(p)}
                          disabled={!canPull}
                          title={
                            pendingCount === 0
                              ? 'This peer has no pending shifts'
                              : p.status === 'offline'
                              ? 'Peer is offline'
                              : `Ask ${p.server_id} to push all ${pendingCount} pending shift(s)`
                          }
                        >
                          {pendingCount > 0 ? (
                            <>
                              <FiTruck />
                              <span>
                                Pull {pendingCount === 1 ? '1 Shift' : `${fmtInt(pendingCount)} Shifts`}
                              </span>
                            </>
                          ) : (
                            <>
                              <FiCheckCircle />
                              <span>Up to Date</span>
                            </>
                          )}
                        </button>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          {/* ---------- Local pending shifts ---------- */}
          {(hasLocalRows || loading || error) && (
            <section className="osync-local">
              <header className="osync-local-head">
                <FiInbox />
                <span>Local Pending Shifts</span>
                {hasLocalRows && (
                  <span className="osync-local-count">{rows.length}</span>
                )}
              </header>

              {/* Summary strip */}
              {!loading && !error && rows.length > 0 && (
                <div className="osync-summary">
                  <div className="osync-summary-cell">
                    <div className="osync-summary-label">Pending shifts</div>
                    <div className="osync-summary-value">{fmtInt(rows.length)}</div>
                  </div>
                  <div className="osync-summary-cell">
                    <div className="osync-summary-label">Total qty</div>
                    <div className="osync-summary-value">{fmtInt(totalQty)}</div>
                  </div>
                  <div className="osync-summary-cell">
                    <div className="osync-summary-label">Total value</div>
                    <div className="osync-summary-value osync-summary-value--cur">
                      {fmtCur(totalValue)}
                    </div>
                  </div>
                </div>
              )}

              {/* Error */}
              {error && (
                <div className="ugmodal-feedback ugmodal-feedback--error">
                  <FiAlertTriangle />
                  <span>{error}</span>
                </div>
              )}

              {/* Loading */}
              {loading && (
                <div className="osync-loading">
                  <FiLoader className="ug-spin" />
                  <span>Loading pending shifts…</span>
                </div>
              )}

              {/* Empty */}
              {!loading && !error && rows.length === 0 && (
                <div className="osync-empty">
                  <FiInbox />
                  <div className="osync-empty-title">No local pending shifts</div>
                  <div className="osync-empty-sub">
                    In isolated topology this list stays empty — the pending
                    shifts live on the peer's own database. Use the peer
                    panel above to pull them.
                  </div>
                </div>
              )}

              {/* List */}
              {!loading && !error && rows.length > 0 && (
                <div className="osync-list">
                  {rows.map((row) => {
                    const isSyncing = syncingId === row.shift_id;
                    const isConfirming = confirming?.shift_id === row.shift_id;
                    return (
                      <article
                        key={row.shift_id}
                        className={`osync-card ${isSyncing ? 'is-syncing' : ''} ${isConfirming ? 'is-confirming' : ''}`}
                      >
                        <header className="osync-card-head">
                          <div className="osync-card-id">
                            <span className="osync-card-id-label">Shift</span>
                            <span className="osync-card-id-value">#{row.shift_id}</span>
                          </div>
                          <div className="osync-card-when" title={fmtDateTime(row.ended_at)}>
                            <FiClock />
                            <span>closed {fmtRelative(row.ended_at)}</span>
                          </div>
                        </header>

                        <div className="osync-card-handler">
                          <FiUser />
                          <span className="osync-card-handler-name">
                            {row.handler_username || '—'}
                          </span>
                          {row.handler_position && (
                            <span className="osync-card-handler-pos">
                              · {row.handler_position}
                            </span>
                          )}
                        </div>

                        <div className="osync-card-metrics">
                          <div className="osync-metric">
                            <span className="osync-metric-label">Released lines</span>
                            <span className="osync-metric-value">
                              {fmtInt(row.release_line_count)}
                            </span>
                          </div>
                          <div className="osync-metric">
                            <span className="osync-metric-label">Released qty</span>
                            <span className="osync-metric-value">
                              {fmtInt(row.released_qty)}
                            </span>
                          </div>
                          <div className="osync-metric">
                            <span className="osync-metric-label">Released value</span>
                            <span className="osync-metric-value osync-metric-value--cur">
                              {fmtCur(row.released_value)}
                            </span>
                          </div>
                        </div>

                        <div className="osync-card-refs">
                          {row.closing_export_uid && (
                            <span className="osync-ref-chip">
                              <span className="osync-ref-chip-label">Closing file</span>
                              <span className="osync-ref-chip-value">{row.closing_export_uid}</span>
                            </span>
                          )}
                          {row.seed_export_uid && (
                            <span className="osync-ref-chip">
                              <span className="osync-ref-chip-label">Seed</span>
                              <span className="osync-ref-chip-value">{row.seed_export_uid}</span>
                            </span>
                          )}
                        </div>

                        {!isConfirming ? (
                          <button
                            type="button"
                            className="osync-btn osync-btn--primary"
                            onClick={() => handleConfirmSync(row)}
                            disabled={!!syncingId}
                          >
                            <FiTruck />
                            <span>Sync Now</span>
                          </button>
                        ) : (
                          <div className="osync-confirm">
                            <div className="osync-confirm-text">
                              Apply <strong>{fmtInt(row.released_qty)}</strong> units
                              across <strong>{fmtInt(row.release_line_count)}</strong> line(s)?
                            </div>
                            <div className="osync-confirm-actions">
                              <button
                                type="button"
                                className="osync-btn osync-btn--ghost"
                                onClick={() => setConfirming(null)}
                                disabled={isSyncing}
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                className="osync-btn osync-btn--primary"
                                onClick={handleSync}
                                disabled={isSyncing}
                              >
                                {isSyncing ? (
                                  <>
                                    <FiLoader className="ug-spin" />
                                    <span>Syncing…</span>
                                  </>
                                ) : (
                                  <>
                                    <FiCheckCircle />
                                    <span>Confirm Sync</span>
                                  </>
                                )}
                              </button>
                            </div>
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          {/* Info banner — only when there's real work in flight */}
          {(peersWithPending.length > 0 || hasLocalRows) && (
            <div className="ugmodal-warn">
              <FiAlertTriangle />
              <div>
                Each sync applies the underground shift's released lines to
                <strong> real surface stock</strong>. Both the aggregate warehouse
                inventory and the per-locator holdings are updated. A shift can
                only be synced once.
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="ugmodal-footer">
          <button
            type="button"
            className="ug-btn ug-btn--secondary"
            onClick={onClose}
            disabled={!!syncingId}
          >
            Close
          </button>
          <button
            type="button"
            className="ug-btn ug-btn--secondary"
            onClick={() => load({ silent: true })}
            disabled={loading || refreshing || !!syncingId}
          >
            <FiRefreshCw className={refreshing ? 'ug-spin' : ''} />
            <span>{refreshing ? 'Refreshing…' : 'Refresh'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default OnlineSyncModal;

/* ============================================================
   Component-scoped CSS — `osync-` prefix.
   Existing classes preserved. New peer-related classes appended.
   ============================================================ */
const onlineSyncCss = `
/* ============================================================ */
/* PEERS SECTION (Session 16b) — new                              */
/* ============================================================ */
.osync-peers {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  background: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%);
  border: 1px solid #7dd3fc;
  border-radius: 12px;
}

.osync-peers-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}
.osync-peers-head-left {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 800;
  color: #075985;
  letter-spacing: 0.01em;
}
.osync-peers-head-left > svg {
  width: 15px; height: 15px; stroke-width: 2.4;
}
.osync-peers-count {
  display: inline-block;
  padding: 2px 9px;
  border-radius: 999px;
  font-size: 10.5px;
  font-weight: 800;
  background: #bae6fd;
  color: #075985;
  border: 1px solid #7dd3fc;
}
.osync-peers-refresh {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: 1.5px solid #7dd3fc;
  border-radius: 8px;
  background: #ffffff;
  color: #075985;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;
}
.osync-peers-refresh:hover:not(:disabled) {
  background: #e0f2fe;
  border-color: #0ea5e9;
}
.osync-peers-refresh:disabled { opacity: 0.5; cursor: not-allowed; }
.osync-peers-refresh svg { width: 14px; height: 14px; stroke-width: 2.4; }

.osync-peers-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.osync-peers-empty {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 12px;
  border: 1px dashed #7dd3fc;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.6);
  color: #0369a1;
  font-size: 12.5px;
  line-height: 1.5;
}
.osync-peers-empty > svg {
  width: 16px; height: 16px; stroke-width: 2.2; flex-shrink: 0;
}
.osync-peers-empty--error {
  color: #991b1b;
  border-color: #fecaca;
  background: #fef2f2;
}
.osync-peers-empty-title {
  font-weight: 800;
  font-size: 13px;
  color: #075985;
  margin-bottom: 2px;
}
.osync-peers-empty-sub {
  font-size: 11.5px;
  color: #0369a1;
}

/* Peer card */
.osync-peer {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px;
  border: 1.5px solid #bae6fd;
  border-radius: 10px;
  background: #ffffff;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.osync-peer.is-online    { border-color: #86efac; }
.osync-peer.is-degraded  { border-color: #fcd34d; }
.osync-peer.is-offline   { border-color: #cbd5e1; opacity: 0.92; }
.osync-peer.is-requesting {
  border-color: #0ea5e9;
  box-shadow: 0 0 0 3px rgba(14, 165, 233, 0.12);
}

.osync-peer-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}
.osync-peer-identity {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.osync-peer-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
  box-shadow: 0 0 0 3px rgba(0, 0, 0, 0.06);
}
.osync-peer.is-online .osync-peer-dot { animation: osyncPulse 2.2s ease-in-out infinite; }
@keyframes osyncPulse { 0%,100% { opacity: 1; } 50% { opacity: 0.5; } }

.osync-peer-id {
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-weight: 800;
  font-size: 13.5px;
  color: #0f172a;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.osync-peer-status {
  display: inline-block;
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 10.5px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  white-space: nowrap;
}
.osync-peer-status--online   { background: #dcfce7; color: #166534; border: 1px solid #86efac; }
.osync-peer-status--degraded { background: #fef3c7; color: #92400e; border: 1px solid #fcd34d; }
.osync-peer-status--offline  { background: #f1f5f9; color: #475569; border: 1px solid #cbd5e1; }
.osync-peer-status--unknown  { background: #f8fafc; color: #94a3b8; border: 1px solid #e2e8f0; }

.osync-peer-sub {
  font-size: 11.5px;
  color: #475569;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.osync-peer-sub-sep { color: #94a3b8; margin: 0 2px; }

.osync-peer-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.osync-peer-meta-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 9px;
  border-radius: 999px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  font-size: 10.5px;
  font-weight: 700;
  color: #334155;
}
.osync-peer-meta-chip svg { width: 11px; height: 11px; stroke-width: 2.4; }
.osync-peer-meta-chip--pending {
  background: #fef3c7;
  border-color: #fcd34d;
  color: #92400e;
}
.osync-peer-meta-chip--empty {
  background: #ecfdf5;
  border-color: #a7f3d0;
  color: #065f46;
}

.osync-peer-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 40px;
  padding: 8px 16px;
  border: none;
  border-radius: 9px;
  background: linear-gradient(135deg, #0ea5e9 0%, #0369a1 100%);
  color: #ffffff;
  font-family: inherit;
  font-size: 13px;
  font-weight: 800;
  cursor: pointer;
  box-shadow: 0 3px 10px -3px rgba(14, 165, 233, 0.4);
  transition: transform 0.1s ease, box-shadow 0.12s ease, opacity 0.12s ease;
}
.osync-peer-btn svg { width: 15px; height: 15px; stroke-width: 2.4; }
.osync-peer-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 8px 18px -6px rgba(14, 165, 233, 0.5);
}
.osync-peer-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
  box-shadow: none;
}
.osync-peer.is-offline .osync-peer-btn {
  background: #e2e8f0;
  color: #64748b;
}

.osync-peer-requesting {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 40px;
  padding: 8px 14px;
  border-radius: 9px;
  background: #ecfeff;
  border: 1px solid #67e8f9;
  color: #0e7490;
  font-size: 12.5px;
  font-weight: 700;
}
.osync-peer-requesting svg { width: 15px; height: 15px; }

/* ============================================================ */
/* LOCAL PENDING SHIFTS SECTION — wraps the pre-existing content  */
/* ============================================================ */
.osync-local {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-top: 4px;
}
.osync-local-head {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 800;
  color: #334155;
  padding: 0 2px;
}
.osync-local-head > svg {
  width: 15px; height: 15px; stroke-width: 2.4; color: #0f766e;
}
.osync-local-count {
  display: inline-block;
  padding: 2px 9px;
  border-radius: 999px;
  font-size: 10.5px;
  font-weight: 800;
  background: #f0fdfa;
  color: #0f766e;
  border: 1px solid #99f6e4;
}

/* ---------- Summary strip ---------- */
.osync-summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  padding: 12px 14px;
  background: linear-gradient(135deg, #f0fdfa 0%, #ecfeff 100%);
  border: 1px solid #99f6e4;
  border-radius: 10px;
}
.osync-summary-cell { min-width: 0; }
.osync-summary-label {
  font-size: 10px; font-weight: 800; color: #0f766e;
  text-transform: uppercase; letter-spacing: 0.06em;
  margin-bottom: 2px;
}
.osync-summary-value {
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-size: 16px; font-weight: 800; color: #0f172a;
  font-variant-numeric: tabular-nums;
  word-break: break-word;
}
.osync-summary-value--cur { color: #047857; }

/* ---------- List ---------- */
.osync-list {
  display: flex; flex-direction: column; gap: 12px;
}

.osync-card {
  display: flex; flex-direction: column; gap: 10px;
  padding: 14px 16px;
  border: 1px solid #e2e8f0; border-radius: 12px;
  background: #ffffff;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.osync-card.is-syncing {
  opacity: 0.7;
  border-color: #0f766e;
}
.osync-card.is-confirming {
  border-color: #fcd34d;
  background: #fffbeb;
  box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.14);
}

.osync-card-head {
  display: flex; justify-content: space-between; align-items: center;
  gap: 10px; flex-wrap: wrap;
}
.osync-card-id {
  display: inline-flex; align-items: baseline; gap: 6px;
}
.osync-card-id-label {
  font-size: 10.5px; font-weight: 800; color: #64748b;
  text-transform: uppercase; letter-spacing: 0.06em;
}
.osync-card-id-value {
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-size: 15px; font-weight: 800; color: #0f172a;
}
.osync-card-when {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 11.5px; color: #64748b;
}
.osync-card-when svg { width: 12px; height: 12px; stroke-width: 2.4; }

.osync-card-handler {
  display: inline-flex; align-items: center; gap: 7px;
  font-size: 13px; color: #334155;
}
.osync-card-handler svg { width: 14px; height: 14px; stroke-width: 2.2; color: #0f766e; }
.osync-card-handler-name { font-weight: 700; color: #0f172a; }
.osync-card-handler-pos { font-size: 11.5px; color: #64748b; }

.osync-card-metrics {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  padding: 10px 12px;
  background: #f8fafc;
  border: 1px solid #f1f5f9;
  border-radius: 10px;
}
.osync-metric { min-width: 0; }
.osync-metric-label {
  display: block;
  font-size: 9.5px; font-weight: 800; color: #64748b;
  text-transform: uppercase; letter-spacing: 0.06em;
}
.osync-metric-value {
  display: block;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-size: 14px; font-weight: 800; color: #0f172a;
  margin-top: 2px; font-variant-numeric: tabular-nums;
  word-break: break-word;
}
.osync-metric-value--cur { color: #047857; }

.osync-card-refs {
  display: flex; flex-wrap: wrap; gap: 6px;
}
.osync-ref-chip {
  display: inline-flex; align-items: baseline; gap: 5px;
  padding: 3px 9px; border-radius: 999px;
  background: #f1f5f9; border: 1px solid #e2e8f0;
  font-size: 10.5px;
}
.osync-ref-chip-label {
  font-weight: 700; color: #64748b;
  text-transform: uppercase; letter-spacing: 0.05em;
}
.osync-ref-chip-value {
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-weight: 700; color: #334155;
}

/* ---------- Buttons ---------- */
.osync-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  min-height: 44px; padding: 10px 16px;
  border-radius: 10px; border: none;
  font-family: inherit; font-size: 14px; font-weight: 800;
  cursor: pointer;
  transition: transform 0.1s ease, box-shadow 0.12s ease, background 0.12s ease;
  -webkit-tap-highlight-color: transparent;
}
.osync-btn svg { width: 16px; height: 16px; stroke-width: 2.4; }
.osync-btn:disabled { opacity: 0.55; cursor: not-allowed; }

.osync-btn--primary {
  width: 100%;
  background: linear-gradient(135deg, #0ea5a5 0%, #0f766e 100%);
  color: #ffffff;
  box-shadow: 0 4px 12px -4px rgba(15, 118, 110, 0.4);
}
.osync-btn--primary:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 8px 18px -6px rgba(15, 118, 110, 0.5);
}
.osync-btn--ghost {
  background: #ffffff;
  color: #475569;
  border: 1px solid #cbd5e1;
}
.osync-btn--ghost:hover:not(:disabled) {
  background: #f8fafc;
  border-color: #94a3b8;
}

/* ---------- Confirm strip ---------- */
.osync-confirm {
  display: flex; flex-direction: column; gap: 10px;
  padding: 12px 14px;
  background: linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%);
  border: 1.5px solid #fcd34d; border-radius: 10px;
}
.osync-confirm-text {
  font-size: 13px; color: #78350f; line-height: 1.45;
}
.osync-confirm-text strong {
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  color: #7c2d12;
}
.osync-confirm-actions {
  display: flex; gap: 8px;
}
.osync-confirm-actions .osync-btn { flex: 1; }

/* ---------- Loading / empty ---------- */
.osync-loading {
  display: flex; align-items: center; justify-content: center;
  gap: 10px; padding: 40px 20px; color: #64748b; font-size: 14px;
}
.osync-empty {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 8px; padding: 32px 20px; text-align: center;
  border: 1px dashed #cbd5e1; border-radius: 12px;
  background: #f8fafc; color: #64748b;
}
.osync-empty > svg { width: 36px; height: 36px; color: #94a3b8; stroke-width: 1.6; }
.osync-empty-title {
  font-size: 15px; font-weight: 800; color: #334155;
}
.osync-empty-sub {
  font-size: 12.5px; max-width: 44ch; line-height: 1.5;
}

/* ---------- Responsive ---------- */
@media (max-width: 640px) {
  .osync-summary { grid-template-columns: 1fr 1fr; gap: 8px; padding: 10px; }
  .osync-summary-cell:last-child { grid-column: 1 / -1; }
  .osync-card { padding: 12px 14px; }
  .osync-card-metrics { gap: 6px; padding: 8px 10px; }
  .osync-metric-value { font-size: 13px; }
  .osync-peer { padding: 10px 12px; }
  .osync-peer-id { font-size: 12.5px; }
  .osync-peer-btn { width: 100%; }
}

@media (max-width: 380px) {
  .osync-summary { grid-template-columns: 1fr; }
  .osync-summary-cell:last-child { grid-column: auto; }
  .osync-card-metrics { grid-template-columns: 1fr 1fr; }
  .osync-metric:last-child { grid-column: 1 / -1; }
  .osync-peers { padding: 10px; }
  .osync-peer-meta-chip { font-size: 10px; }
}

@media (min-width: 1921px) {
  .osync-card { padding: 16px 18px; }
  .osync-card-id-value { font-size: 16px; }
  .osync-metric-value { font-size: 15.5px; }
  .osync-btn { min-height: 48px; font-size: 15px; }
  .osync-peer { padding: 14px 18px; }
  .osync-peer-id { font-size: 15px; }
  .osync-peer-btn { min-height: 46px; font-size: 14px; }
}

@media (prefers-reduced-motion: reduce) {
  .osync-card, .osync-btn, .osync-peer, .osync-peer-btn { transition: none !important; }
  .osync-btn--primary:hover:not(:disabled) { transform: none; }
  .osync-peer-btn:hover:not(:disabled) { transform: none; }
  .osync-peer.is-online .osync-peer-dot { animation: none !important; }
}
`;