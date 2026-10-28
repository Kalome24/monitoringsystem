// src/components/underground/UndergroundShiftsPanel.jsx
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FiRefreshCw,
  FiLoader,
  FiInbox,
  FiAlertTriangle,
  FiClock,
  FiUploadCloud,
  FiSearch,
  FiX,
  FiZap,
  FiServer,
  FiLayers,
  FiDownload,
} from 'react-icons/fi';
import * as XLSX from 'xlsx';
import { locatorLogApi, undergroundApi } from '../../services/api';
import { useToast } from '../shared/ToastProvider';
import { undergroundCss } from './undergroundStyles';
import UndergroundReconcileImportModal from './UndergroundReconcileImportModal';
import OnlineSyncModal from './OnlineSyncModal';
import useRefreshOnFocus from '../../hooks/useRefreshOnFocus';

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
  } catch { return '—'; }
};

const shortHash = (hash) => {
  if (!hash) return '—';
  return `${hash.slice(0, 8)}…${hash.slice(-6)}`;
};

const PAGE_SIZE = 50;
const PENDING_POLL_MS = 60000;

/* ============================================================
   Component
   ============================================================ */
const UndergroundShiftsPanel = () => {
  const toast = useToast();

  const [tab, setTab] = useState('syncs'); // 'syncs' | 'shifts'

  // Sync Log State
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // Shifts History State
  const [shiftRows, setShiftRows] = useState([]);
  const [shiftTotal, setShiftTotal] = useState(0);
  const [shiftTotalPages, setShiftTotalPages] = useState(1);
  const [shiftPage, setShiftPage] = useState(1);
  const [shiftsLoading, setShiftsLoading] = useState(false);
  const [shiftsError, setShiftsError] = useState(null);

  const [importOpen, setImportOpen] = useState(false);
  const [onlineSyncOpen, setOnlineSyncOpen] = useState(false);

  const [pendingLocal, setPendingLocal] = useState(0);
  const [pendingPeers, setPendingPeers] = useState(0);
  const [peersOnline, setPeersOnline]   = useState(0);
  const [peersTotal, setPeersTotal]     = useState(0);

  /* --------------------------------------------------------
     Debounce search
     -------------------------------------------------------- */
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  /* --------------------------------------------------------
     Load Sync Log
     -------------------------------------------------------- */
  const loadSyncs = useCallback(
    async ({ silent = false } = {}) => {
      if (silent) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const res = await locatorLogApi.list({
          page,
          limit: PAGE_SIZE,
          action_type: 'Underground Reconciliation',
          search: debouncedSearch || undefined,
        });
        if (res.ok) {
          setRows(Array.isArray(res.data) ? res.data : []);
          setTotal(Number(res.total) || 0);
          setTotalPages(Math.max(Number(res.totalPages) || 1, 1));
        } else {
          setError(res?.data?.message || 'Failed to load sync history.');
          setRows([]);
          setTotal(0);
          setTotalPages(1);
        }
      } catch (err) {
        console.error('Underground sync load error:', err);
        setError(err?.message || 'Failed to load sync history.');
        setRows([]);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [page, debouncedSearch]
  );

  /* --------------------------------------------------------
     Load ALL Underground Shifts
     -------------------------------------------------------- */
  const loadShifts = useCallback(
    async ({ silent = false } = {}) => {
      if (silent) setRefreshing(true);
      else setShiftsLoading(true);
      setShiftsError(null);
      try {
        const res = await undergroundApi.surfaceShifts({
          page: shiftPage,
          limit: PAGE_SIZE,
          status: 'All',
        });
        if (res.ok) {
          setShiftRows(Array.isArray(res.data) ? res.data : []);
          setShiftTotal(Number(res.total) || 0);
          setShiftTotalPages(Math.max(Number(res.totalPages) || 1, 1));
        } else {
          setShiftsError(res?.data?.message || 'Failed to load shift history.');
          setShiftRows([]);
          setShiftTotal(0);
          setShiftTotalPages(1);
        }
      } catch (err) {
        console.error('Underground shifts load error:', err);
        setShiftsError(err?.message || 'Failed to load shift history.');
        setShiftRows([]);
      } finally {
        setShiftsLoading(false);
        setRefreshing(false);
      }
    },
    [shiftPage]
  );

  useEffect(() => {
    if (tab === 'syncs') loadSyncs();
    else loadShifts();
  }, [tab, loadSyncs, loadShifts]);

  /* --------------------------------------------------------
     Pending count
     -------------------------------------------------------- */
  const refreshPendingCount = useCallback(async () => {
    const [localRes, peersRes] = await Promise.allSettled([
      undergroundApi.listPendingSyncs({ limit: 50 }),
      undergroundApi.listPeers({}),
    ]);

    if (localRes.status === 'fulfilled' && localRes.value?.ok) {
      const arr = Array.isArray(localRes.value.data) ? localRes.value.data : [];
      setPendingLocal(arr.length);
    } else { setPendingLocal(0); }

    if (peersRes.status === 'fulfilled' && peersRes.value?.ok) {
      const peers = Array.isArray(peersRes.value.data) ? peersRes.value.data : [];
      const sumPending = peers.reduce((s, p) => s + (Number(p.pending_count) || 0), 0);
      const online = peers.filter((p) => p.status === 'online' || p.status === 'degraded').length;

      setPendingPeers(sumPending);
      setPeersOnline(online);
      setPeersTotal(peers.length);
    } else {
      setPendingPeers(0); setPeersOnline(0); setPeersTotal(0);
    }
  }, []);

  useEffect(() => { refreshPendingCount(); }, [refreshPendingCount]);

  useEffect(() => {
    const id = setInterval(() => {
      if (typeof document !== 'undefined' && !document.hidden) {
        refreshPendingCount();
      }
    }, PENDING_POLL_MS);
    return () => clearInterval(id);
  }, [refreshPendingCount]);

  useRefreshOnFocus(() => {
    if (tab === 'syncs') loadSyncs({ silent: true });
    else loadShifts({ silent: true });
    refreshPendingCount();
  });

  /* --------------------------------------------------------
     Export Shift History
     -------------------------------------------------------- */
  const handleExportShifts = () => {
    if (shiftRows.length === 0) {
      toast.warning('No shifts to export.');
      return;
    }

    const data = shiftRows.map(r => {
      const deductedQty = (Number(r.issued_qty) || 0) + (Number(r.damaged_qty) || 0);
      const deductedValue = (Number(r.issued_value) || 0) + (Number(r.damaged_value) || 0);
      const transferredQty = Number(r.transfer_out_qty) || 0;
      const transferredValue = Number(r.transfer_out_value) || 0;

      return {
        'Shift ID': r.shift_id,
        'Warehouse': r.warehouse_code,
        'Handler': r.handler_username || '—',
        'Status': r.status,
        'Started At': fmtDateTime(r.started_at),
        'Ended At': fmtDateTime(r.ended_at),
        'Beginning Qty': r.beginning_qty,
        'Deducted Qty (Issued + Damage)': deductedQty,
        'Transferred Out Qty': transferredQty,
        'Ending Qty': r.ending_qty,
        'Beginning Value': r.beginning_value,
        'Deducted Value': deductedValue,
        'Transferred Value': transferredValue,
        'Ending Value': r.ending_value,
      };
    });

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Underground Shifts');
    
    // Auto-size columns
    ws['!cols'] = [
      { wch: 10 }, { wch: 12 }, { wch: 20 }, { wch: 15 }, 
      { wch: 20 }, { wch: 20 }, { wch: 15 }, { wch: 20 }, 
      { wch: 20 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, 
      { wch: 15 }, { wch: 15 }
    ];

    const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Underground_Shifts_History_${new Date().toISOString().split('T')[0]}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    toast.success('Shift history exported successfully.');
  };

  /* --------------------------------------------------------
     Pagination Controls
     -------------------------------------------------------- */
  const goToSyncPage = (p) => {
    const next = Math.max(1, Math.min(totalPages, p));
    if (next !== page) setPage(next);
  };

  const goToShiftPage = (p) => {
    const next = Math.max(1, Math.min(shiftTotalPages, p));
    if (next !== shiftPage) setShiftPage(next);
  };

  const pendingTotal = pendingLocal + pendingPeers;
  const hasPending   = pendingTotal > 0;

  /* ============================================================
     Render
     ============================================================ */
  return (
    <div className="ug-section">
      <style>{undergroundCss}</style>
      <style>{onlineSyncBtnCss}</style>

      <header className="ug-header">
        <div className="ug-header-left">
          <div className="ug-header-icon"><FiClock /></div>
          <div className="ug-header-info">
            <h2 className="ug-header-title">Underground Sync & History</h2>
            <div className="ug-header-sub">
              Manage syncs and view historical shift data from the underground.
            </div>
          </div>
        </div>
        <div className="ug-header-actions">
          <button
            type="button"
            className="ug-btn ug-btn--secondary ug-btn--sm"
            onClick={() => tab === 'syncs' ? loadSyncs({ silent: true }) : loadShifts({ silent: true })}
            disabled={loading || shiftsLoading || refreshing}
          >
            <FiRefreshCw className={refreshing ? 'ug-spin' : ''} />
            <span>{refreshing ? 'Refreshing…' : 'Refresh'}</span>
          </button>

          <button
            type="button"
            className={`ug-btn ug-btn--sm osync-btn ${hasPending ? 'osync-btn--hot' : ''}`}
            onClick={() => setOnlineSyncOpen(true)}
            disabled={loading || shiftsLoading}
          >
            <FiZap />
            <span>Online Sync</span>
            {hasPending && (
              <span className="osync-btn-badge" aria-label={`${pendingTotal} pending`}>
                {pendingTotal > 99 ? '99+' : pendingTotal}
              </span>
            )}
          </button>

          <button
            type="button"
            className="ug-btn ug-btn--primary ug-btn--sm"
            onClick={() => setImportOpen(true)}
            disabled={loading || shiftsLoading}
          >
            <FiUploadCloud />
            <span>Import Closing File</span>
          </button>
        </div>
      </header>

      {/* Sub-tabs */}
      <div className="ug-subtabs" role="tablist">
        <button
          role="tab"
          aria-selected={tab === 'syncs'}
          className={`ug-subtab ${tab === 'syncs' ? 'is-active' : ''}`}
          onClick={() => setTab('syncs')}
        >
          <FiLayers className="ug-subtab-icon" />
          <span>Sync History</span>
        </button>
        <button
          role="tab"
          aria-selected={tab === 'shifts'}
          className={`ug-subtab ${tab === 'shifts' ? 'is-active' : ''}`}
          onClick={() => setTab('shifts')}
        >
          <FiClock className="ug-subtab-icon" />
          <span>All Underground Shifts</span>
        </button>
      </div>

      {/* Peer Status Strip */}
      {peersTotal > 0 && (
        <div className={`ug-peers-strip ${peersOnline === 0 ? 'ug-peers-strip--offline' : ''}`}>
          <FiServer aria-hidden="true" />
          <span className="ug-peers-strip-text">
            <strong>Underground servers</strong>
            {' · '}
            {peersOnline === 0 ? (
              <>none online — no peer is reachable right now</>
            ) : peersOnline === peersTotal ? (
              <>all {peersTotal} online</>
            ) : (
              <>{peersOnline} of {peersTotal} online</>
            )}
          </span>
        </div>
      )}

      {/* ==================== TAB: SYNC HISTORY ==================== */}
      {tab === 'syncs' && (
        <>
          <div className="ugmodal-warn" style={{ marginTop: -4 }}>
            <FiAlertTriangle />
            <div>
              Three ways to apply an underground shift:{' '}
              <strong>Online Sync</strong> pulls from a local pending shift or
              asks an underground server to push its pending shifts, and{' '}
              <strong>Import Closing File</strong> applies a closing Excel file
              you received physically. All write through the same stock-deduction
              path.
            </div>
          </div>

          <div className="ughist-toolbar">
            <div className="ughist-search">
              <FiSearch />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by reference, filename, or hash…"
              />
              {search && (
                <button type="button" onClick={() => setSearch('')} className="ughist-search-clear">
                  <FiX />
                </button>
              )}
            </div>
          </div>

          {error && (
            <div className="ug-error" role="alert">
              <FiAlertTriangle />
              <span>{error}</span>
              <button type="button" onClick={() => loadSyncs()}>Try again</button>
            </div>
          )}

          {loading && (
            <div className="ug-loading"><FiLoader className="ug-spin" /><span>Loading sync history…</span></div>
          )}

          {!loading && !error && rows.length === 0 && (
            <div className="ug-card">
              <div className="ug-empty">
                <FiInbox />
                <div className="ug-empty-title">No syncs recorded yet</div>
                <div className="ug-empty-sub">When an underground shift is applied, it will appear here.</div>
              </div>
            </div>
          )}

          {!loading && !error && rows.length > 0 && (
            <>
              <div className="ughist-table-wrap">
                <table className="ughist-table">
                  <thead>
                    <tr>
                      <th>Reference</th>
                      <th>Received</th>
                      <th>Recorded by</th>
                      <th>File</th>
                      <th>Closing Ref</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.export_id}>
                        <td><span className="ughist-uid">{r.export_uid || '—'}</span></td>
                        <td>{fmtDateTime(r.performed_at)}</td>
                        <td>
                          <div style={{ fontWeight: 700, fontSize: 12.5 }}>{r.performed_by_username || '—'}</div>
                          {r.performed_by_position && <div style={{ fontSize: 11, color: '#64748b' }}>{r.performed_by_position}</div>}
                        </td>
                        <td><span className="ughist-uid" title={r.filename || ''}>{r.filename || '—'}</span></td>
                        <td><span className="ughist-uid">{r.linked_export_uid || '—'}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="ughist-cardlist">
                {rows.map((r) => (
                  <article key={`m-${r.export_id}`} className="ughist-card">
                    <header className="ughist-card-head">
                      <span className="ughist-uid">{r.export_uid || '—'}</span>
                      <span style={{ fontSize: 11.5, color: '#64748b', fontWeight: 600 }}>{fmtDateTime(r.performed_at)}</span>
                    </header>
                    <dl className="ughist-card-grid">
                      <div><dt>Recorded by</dt><dd>{r.performed_by_username || '—'}</dd></div>
                      <div><dt>Closing Ref</dt><dd>{r.linked_export_uid || '—'}</dd></div>
                      <div style={{ gridColumn: '1 / -1' }}><dt>File</dt><dd style={{ wordBreak: 'break-all' }}>{r.filename || '—'}</dd></div>
                    </dl>
                  </article>
                ))}
              </div>

              {totalPages > 1 && (
                <nav className="ughist-pagination">
                  <div className="ughist-pagination-info">Showing <strong>{(page - 1) * PAGE_SIZE + 1}</strong>–<strong>{Math.min(page * PAGE_SIZE, total)}</strong> of <strong>{fmtInt(total)}</strong> syncs</div>
                  <div className="ughist-pagination-controls">
                    <button type="button" className="ughist-page-btn" onClick={() => goToSyncPage(page - 1)} disabled={page <= 1}>‹</button>
                    <span style={{ minWidth: 60, textAlign: 'center', fontSize: 12, fontWeight: 700, color: '#334155' }}>{page} / {totalPages}</span>
                    <button type="button" className="ughist-page-btn" onClick={() => goToSyncPage(page + 1)} disabled={page >= totalPages}>›</button>
                  </div>
                </nav>
              )}
            </>
          )}
        </>
      )}

      {/* ==================== TAB: ALL SHIFTS ==================== */}
      {tab === 'shifts' && (
        <>
          <div className="ugmodal-warn" style={{ marginTop: -4, background: '#eff6ff', borderColor: '#bfdbfe', borderLeftColor: '#3b82f6', color: '#1e40af' }}>
            <FiAlertTriangle style={{ color: '#3b82f6' }} />
            <div>
              This table shows the complete history of all shifts recorded by the Underground Handler at this warehouse. You can download this data for your audit records.
            </div>
          </div>

          <div className="ughist-toolbar" style={{ justifyContent: 'flex-end' }}>
            <button
              type="button"
              className="ug-btn ug-btn--secondary"
              onClick={handleExportShifts}
              disabled={shiftsLoading || shiftRows.length === 0}
            >
              <FiDownload /> <span>Export Shift History</span>
            </button>
          </div>

          {shiftsError && (
            <div className="ug-error" role="alert">
              <FiAlertTriangle />
              <span>{shiftsError}</span>
              <button type="button" onClick={() => loadShifts()}>Try again</button>
            </div>
          )}

          {shiftsLoading && (
            <div className="ug-loading"><FiLoader className="ug-spin" /><span>Loading shifts…</span></div>
          )}

          {!shiftsLoading && !shiftsError && shiftRows.length === 0 && (
            <div className="ug-card">
              <div className="ug-empty">
                <FiInbox />
                <div className="ug-empty-title">No shifts recorded yet</div>
                <div className="ug-empty-sub">The underground handler hasn't opened any shifts at this warehouse.</div>
              </div>
            </div>
          )}

          {!shiftsLoading && !shiftsError && shiftRows.length > 0 && (
            <>
              <div className="ughist-table-wrap">
                <table className="ughist-table">
                  <thead>
                    <tr>
                      <th>Shift #</th>
                      <th>Status</th>
                      <th>Handler</th>
                      <th>Started At</th>
                      <th>Ended At</th>
                      <th className="ughist-num">Beg Qty</th>
                      <th className="ughist-num">Deducted Qty</th>
                      <th className="ughist-num">Transferred Qty</th>
                      <th className="ughist-num">End Qty</th>
                      <th className="ughist-num">Beg Value</th>
                      <th className="ughist-num">Deducted Value</th>
                      <th className="ughist-num">Transferred Value</th>
                      <th className="ughist-num">End Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shiftRows.map((r) => {
                      const deductedQty = (Number(r.issued_qty) || 0) + (Number(r.damaged_qty) || 0);
                      const deductedValue = (Number(r.issued_value) || 0) + (Number(r.damaged_value) || 0);
                      const transferredQty = Number(r.transfer_out_qty) || 0;
                      const transferredValue = Number(r.transfer_out_value) || 0;

                      return (
                        <tr key={r.shift_id}>
                          <td><span className="ughist-uid">#{r.shift_id}</span></td>
                          <td>
                            <span className={`lehist-action lehist-action--${r.status === 'Open' ? 'sync-online' : r.status === 'Closed' ? 'close' : 'sync-file'}`}>
                              {r.status}
                            </span>
                          </td>
                          <td>{r.handler_username || '—'}</td>
                          <td>{fmtDateTime(r.started_at)}</td>
                          <td>{fmtDateTime(r.ended_at)}</td>
                          <td className="ughist-num">{fmtInt(r.beginning_qty)}</td>
                          <td className="ughist-num text-issued">{fmtInt(deductedQty)}</td>
                          <td className="ughist-num text-transferred">{fmtInt(transferredQty)}</td>
                          <td className="ughist-num">{fmtInt(r.ending_qty)}</td>
                          <td className="ughist-num">{fmtCur(r.beginning_value)}</td>
                          <td className="ughist-num text-issued">{fmtCur(deductedValue)}</td>
                          <td className="ughist-num text-transferred">{fmtCur(transferredValue)}</td>
                          <td className="ughist-num ughist-num--cur">{fmtCur(r.ending_value)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="ughist-cardlist">
                {shiftRows.map((r) => {
                  const deductedQty = (Number(r.issued_qty) || 0) + (Number(r.damaged_qty) || 0);
                  const deductedValue = (Number(r.issued_value) || 0) + (Number(r.damaged_value) || 0);
                  const transferredQty = Number(r.transfer_out_qty) || 0;
                  const transferredValue = Number(r.transfer_out_value) || 0;

                  return (
                    <article key={`m-${r.shift_id}`} className="ughist-card">
                      <header className="ughist-card-head">
                        <span className="ughist-uid">Shift #{r.shift_id}</span>
                        <span className={`lehist-action lehist-action--${r.status === 'Open' ? 'sync-online' : r.status === 'Closed' ? 'close' : 'sync-file'}`}>{r.status}</span>
                      </header>
                      <dl className="ughist-card-grid">
                        <div><dt>Handler</dt><dd>{r.handler_username || '—'}</dd></div>
                        <div><dt>Started At</dt><dd>{fmtDateTime(r.started_at)}</dd></div>
                        <div><dt>Ended At</dt><dd>{fmtDateTime(r.ended_at)}</dd></div>
                        <div style={{ gridColumn: '1 / -1', borderTop: '1px solid #e2e8f0', margin: '4px 0' }}></div>
                        
                        <div><dt>Beg Qty</dt><dd>{fmtInt(r.beginning_qty)}</dd></div>
                        <div><dt>Deducted Qty</dt><dd className="text-issued">{fmtInt(deductedQty)}</dd></div>
                        <div><dt>Transferred Qty</dt><dd className="text-transferred">{fmtInt(transferredQty)}</dd></div>
                        <div><dt>End Qty</dt><dd>{fmtInt(r.ending_qty)}</dd></div>
                        
                        <div><dt>Beg Value</dt><dd>{fmtCur(r.beginning_value)}</dd></div>
                        <div><dt>Deducted Value</dt><dd className="text-issued">{fmtCur(deductedValue)}</dd></div>
                        <div><dt>Transferred Value</dt><dd className="text-transferred">{fmtCur(transferredValue)}</dd></div>
                        <div><dt>End Value</dt><dd className="ughist-num--cur">{fmtCur(r.ending_value)}</dd></div>
                      </dl>
                    </article>
                  );
                })}
              </div>

              {shiftTotalPages > 1 && (
                <nav className="ughist-pagination">
                  <div className="ughist-pagination-info">Showing <strong>{(shiftPage - 1) * PAGE_SIZE + 1}</strong>–<strong>{Math.min(shiftPage * PAGE_SIZE, shiftTotal)}</strong> of <strong>{fmtInt(shiftTotal)}</strong> shifts</div>
                  <div className="ughist-pagination-controls">
                    <button type="button" className="ughist-page-btn" onClick={() => goToShiftPage(shiftPage - 1)} disabled={shiftPage <= 1}>‹</button>
                    <span style={{ minWidth: 60, textAlign: 'center', fontSize: 12, fontWeight: 700, color: '#334155' }}>{shiftPage} / {shiftTotalPages}</span>
                    <button type="button" className="ughist-page-btn" onClick={() => goToShiftPage(shiftPage + 1)} disabled={shiftPage >= shiftTotalPages}>›</button>
                  </div>
                </nav>
              )}
            </>
          )}
        </>
      )}

      {/* Modals */}
      {importOpen && <UndergroundReconcileImportModal onClose={() => setImportOpen(false)} onSuccess={() => { setImportOpen(false); refreshPendingCount(); }} />}
      {onlineSyncOpen && <OnlineSyncModal onClose={() => { setOnlineSyncOpen(false); refreshPendingCount(); }} onSynced={() => { refreshPendingCount(); }} />}
      
      <style>{`
        .text-issued { color: #16a34a !important; font-weight: 700; }
        .text-transferred { color: #2563eb !important; font-weight: 700; }
      `}</style>
    </div>
  );
};

export default UndergroundShiftsPanel;

const onlineSyncBtnCss = `
.osync-btn {
  position: relative;
  background: #ffffff;
  color: #334155;
  border: 1.5px solid #cbd5e1;
}
.osync-btn:hover:not(:disabled) {
  border-color: #00b8b0;
  background: #f0fdfa;
  color: #007a72;
}
.osync-btn--hot {
  background: linear-gradient(135deg, #eef2ff 0%, #e0e7ff 100%);
  border-color: #a5b4fc;
  color: #3730a3;
  box-shadow: 0 1px 4px rgba(99, 102, 241, 0.18);
}
.osync-btn--hot:hover:not(:disabled) {
  background: linear-gradient(135deg, #e0e7ff 0%, #c7d2fe 100%);
  border-color: #818cf8;
  color: #312e81;
}

.osync-btn-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  margin-left: 2px;
  background: #4338ca;
  color: #ffffff;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-size: 10.5px;
  font-weight: 800;
  line-height: 1;
  border-radius: 999px;
  box-shadow: 0 1px 3px rgba(67, 56, 202, 0.35);
  letter-spacing: 0.02em;
}

.ug-peers-strip {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  border-radius: 10px;
  background: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%);
  border: 1px solid #7dd3fc;
  color: #075985;
  font-size: 12.5px;
  font-weight: 600;
  line-height: 1.4;
  max-width: 100%;
  min-width: 0;
}
.ug-peers-strip > svg {
  width: 15px;
  height: 15px;
  stroke-width: 2.4;
  flex-shrink: 0;
  color: #0ea5e9;
}
.ug-peers-strip-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ug-peers-strip-text strong {
  color: #075985;
  font-weight: 800;
}
.ug-peers-strip--offline {
  background: linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%);
  border-color: #fecaca;
  color: #991b1b;
}
.ug-peers-strip--offline > svg { color: #dc2626; }
.ug-peers-strip--offline strong { color: #991b1b; }

@media (max-width: 640px) {
  .ug-peers-strip {
    width: 100%;
    font-size: 12px;
    padding: 7px 12px;
  }
  .ug-peers-strip-text {
    white-space: normal;
  }
}

@media (max-width: 480px) {
  .osync-btn-badge {
    min-width: 16px;
    height: 16px;
    padding: 0 4px;
    font-size: 10px;
  }
  .ug-peers-strip { font-size: 11.5px; }
  .ug-peers-strip > svg { width: 14px; height: 14px; }
}

@media (min-width: 1921px) {
  .ug-peers-strip {
    padding: 10px 18px;
    font-size: 13.5px;
  }
  .ug-peers-strip > svg { width: 17px; height: 17px; }
}

@media (prefers-reduced-motion: reduce) {
  .osync-btn, .ug-peers-strip { transition: none !important; }
}
`;