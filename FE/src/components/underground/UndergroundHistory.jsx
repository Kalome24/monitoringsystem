// src/components/underground/UndergroundHistory.jsx
//
// Shift History tab. Two grouped sections:
//   • Open Shifts   — always visible; each row opens the detail modal.
//   • Ended Shifts  — a collapsible group. Each ended shift is itself
//                     a collapsible row: collapsed shows a compact
//                     summary, expanded reveals the full detail grid
//                     plus a "View line items" action.
//
// Session 15 (S1++++) — the expanded grid and the detail modal now
// surface the timestamps of each underlying process (seed imported
// at, closing exported at, synced at) along with a Sync method badge
// (Online / Excel), so handlers and auditors can trace exactly when
// every step ran and how the reconcile was applied.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FiRefreshCw,
  FiLoader,
  FiInbox,
  FiAlertTriangle,
  FiChevronLeft,
  FiChevronRight,
  FiChevronsLeft,
  FiChevronsRight,
  FiChevronDown,
  FiChevronUp,
  FiSearch,
  FiX,
  FiClock,
  FiUser,
  FiPackage,
  FiDollarSign,
  FiFileText,
  FiLock,
  FiPlayCircle,
  FiLayers,
  FiZap,
  FiUploadCloud,
  FiCheckCircle,
} from 'react-icons/fi';
import { undergroundApi } from '../../services/api';
import { useToast } from '../shared/ToastProvider';

const PAGE_SIZE       = 50;
const LINES_PAGE_SIZE = 50;
const DEBOUNCE_MS     = 300;

/* ---------- Formatters ---------- */
const intFmt = new Intl.NumberFormat('en-PH');
const curFmt = new Intl.NumberFormat('en-PH', {
  style: 'currency', currency: 'PHP',
  minimumFractionDigits: 2, maximumFractionDigits: 4,
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

// Two-line timestamp for table / card cells.
const fmtTimestamp = (value) => {
  if (!value) return { date: '—', time: '' };
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return { date: '—', time: '' };
    return {
      date: d.toLocaleDateString('en-PH', {
        year: 'numeric', month: 'short', day: '2-digit',
      }),
      time: d.toLocaleTimeString('en-PH', {
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
      }),
    };
  } catch { return { date: '—', time: '' }; }
};

const statusPillClass = (status) => {
  const s = String(status || '').toLowerCase();
  if (s === 'open')       return 'ug-pill ug-pill--open';
  if (s === 'closed')     return 'ug-pill ug-pill--closed';
  if (s === 'reconciled') return 'ug-pill ug-pill--reconciled';
  if (s === 'rejected')   return 'ug-pill ug-pill--rejected';
  return 'ug-pill ug-pill--none';
};

const isOpenStatus = (status) => String(status || '').toLowerCase() === 'open';

const buildPageList = (current, total) => {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = [1];
  if (current > 3) pages.push('…');
  const start = Math.max(2, current - 1);
  const end   = Math.min(total - 1, current + 1);
  for (let i = start; i <= end; i++) pages.push(i);
  if (current < total - 2) pages.push('…');
  pages.push(total);
  return pages;
};

/* ============================================================
   SyncMethodPill — Session 15 (S1++++)
   ------------------------------------------------------------
   Renders the reconcile method ('Online' or 'Excel') as a
   compact pill so the reader can see at a glance how the shift
   was applied to surface stock.
   ============================================================ */
const SyncMethodPill = ({ format }) => {
  const f = String(format || '').trim().toLowerCase();
  if (f === 'online') {
    return (
      <span className="ughist-syncbadge ughist-syncbadge--online">
        <FiZap aria-hidden="true" />
        <span>Online Sync</span>
      </span>
    );
  }
  if (f === 'excel') {
    return (
      <span className="ughist-syncbadge ughist-syncbadge--excel">
        <FiUploadCloud aria-hidden="true" />
        <span>Excel file</span>
      </span>
    );
  }
  return <span className="ughist-muted">—</span>;
};

/* ============================================================
   Main component
   ============================================================ */
const UndergroundHistory = () => {
  const toast = useToast();

  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  const [detailId, setDetailId] = useState(null);

  /* -------- Ended-group collapse state -------- */
  const [endedGroupOpen, setEndedGroupOpen] = useState(false);
  const [expandedEndedIds, setExpandedEndedIds] = useState(() => new Set());

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(
    async ({ silent = false } = {}) => {
      if (silent) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const res = await undergroundApi.listShifts({
          page,
          limit: PAGE_SIZE,
        });
        if (res.ok) {
          const all = Array.isArray(res.data) ? res.data : [];
          const filtered = debouncedSearch
            ? all.filter((r) => {
                const q = debouncedSearch.toLowerCase();
                return (
                  String(r.shift_id).includes(q) ||
                  String(r.warehouse_code || '').toLowerCase().includes(q) ||
                  String(r.handler_username || '').toLowerCase().includes(q) ||
                  String(r.status || '').toLowerCase().includes(q) ||
                  String(r.seed_export_uid || '').toLowerCase().includes(q) ||
                  String(r.closing_export_uid || '').toLowerCase().includes(q)
                );
              })
            : all;

          setRows(filtered);
          setTotal(Number(res.total) || filtered.length);
          setTotalPages(Math.max(Number(res.totalPages) || 1, 1));
        } else {
          setError(res?.data?.message || 'Failed to fetch shift history.');
          setRows([]);
          setTotal(0);
          setTotalPages(1);
        }
      } catch (err) {
        console.error('Shift history load error:', err);
        setError(err?.message || 'Failed to fetch shift history.');
        setRows([]);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [page, debouncedSearch]
  );

  useEffect(() => {
    load();
  }, [load]);

  /* ---------- Split rows into Open and Ended groups ---------- */
  const { openShifts, endedShifts } = useMemo(() => {
    const open = [];
    const ended = [];
    for (const r of rows) {
      if (isOpenStatus(r.status)) open.push(r);
      else ended.push(r);
    }
    return { openShifts: open, endedShifts: ended };
  }, [rows]);

  useEffect(() => {
    if (debouncedSearch) setEndedGroupOpen(true);
  }, [debouncedSearch]);

  const toggleEndedRow = useCallback((id) => {
    setExpandedEndedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const allEndedExpanded =
    endedShifts.length > 0 &&
    endedShifts.every((r) => expandedEndedIds.has(r.shift_id));

  const toggleAllEnded = useCallback(() => {
    if (allEndedExpanded) {
      setExpandedEndedIds(new Set());
    } else {
      setExpandedEndedIds(new Set(endedShifts.map((r) => r.shift_id)));
    }
  }, [allEndedExpanded, endedShifts]);

  /* ---------- Pagination ---------- */
  const goToPage = (p) => {
    const next = Math.max(1, Math.min(totalPages, p));
    if (next !== page) setPage(next);
  };

  const pageList = useMemo(() => buildPageList(page, totalPages), [page, totalPages]);
  const showingStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const showingEnd   = Math.min(page * PAGE_SIZE, total);

  /* ============================================================
     Shared: expanded ended-shift detail grid
     ------------------------------------------------------------
     Cell order is grouped by topic:
       Row group 1 — Beginning (locators, items, qty, value)
       Row group 2 — Released (lines, qty, value)
       Row group 3 — Ending (qty, value)
       Row group 4 — References (handler, seed, closing)
       Row group 5 — Process timestamps (started, seed imported,
                     closed, closing exported, synced)
       Row group 6 — Sync method
     ============================================================ */
  const renderEndedDetails = (r) => {
    const seedTs  = fmtTimestamp(r.seed_imported_at);
    const closeTs = fmtTimestamp(r.closing_exported_at);
    const syncTs  = fmtTimestamp(r.reconciled_at || r.reconciliation_log_at);
    const startTs = fmtTimestamp(r.started_at);
    const endTs   = fmtTimestamp(r.ended_at);

    return (
      <div className="ughist-ended-grid">

        {/* ============ BEGINNING ============ */}
        <div className="ughist-ended-cell">
          <span className="ughist-ended-lbl">
            <FiPackage aria-hidden="true" /> Beginning locators
          </span>
          <span className="ughist-ended-val">
            {fmtInt(r.beginning_locator_count)}
          </span>
        </div>
        <div className="ughist-ended-cell">
          <span className="ughist-ended-lbl">
            <FiPackage aria-hidden="true" /> Beginning items
          </span>
          <span className="ughist-ended-val">
            {fmtInt(r.beginning_item_count)}
          </span>
        </div>
        <div className="ughist-ended-cell">
          <span className="ughist-ended-lbl">
            <FiPackage aria-hidden="true" /> Beginning qty
          </span>
          <span className="ughist-ended-val">
            {fmtInt(r.beginning_qty)}
          </span>
        </div>
        <div className="ughist-ended-cell">
          <span className="ughist-ended-lbl">
            <FiDollarSign aria-hidden="true" /> Beginning value
          </span>
          <span className="ughist-ended-val ughist-ended-val--cur">
            {fmtCur(r.beginning_value)}
          </span>
        </div>

        {/* ============ RELEASED ============ */}
        <div className="ughist-ended-cell">
          <span className="ughist-ended-lbl">
            <FiPackage aria-hidden="true" /> Release lines
          </span>
          <span className="ughist-ended-val">
            {fmtInt(r.release_line_count)}
          </span>
        </div>
        <div className="ughist-ended-cell">
          <span className="ughist-ended-lbl">
            <FiPackage aria-hidden="true" /> Released qty
          </span>
          <span className="ughist-ended-val">
            {fmtInt(r.released_qty)}
          </span>
        </div>
        <div className="ughist-ended-cell">
          <span className="ughist-ended-lbl">
            <FiDollarSign aria-hidden="true" /> Released value
          </span>
          <span className="ughist-ended-val ughist-ended-val--cur">
            {fmtCur(r.released_value)}
          </span>
        </div>

        {/* ============ ENDING ============ */}
        <div className="ughist-ended-cell">
          <span className="ughist-ended-lbl">
            <FiCheckCircle aria-hidden="true" /> Ending qty
          </span>
          <span className="ughist-ended-val">
            {fmtInt(r.ending_qty)}
          </span>
        </div>
        <div className="ughist-ended-cell">
          <span className="ughist-ended-lbl">
            <FiDollarSign aria-hidden="true" /> Ending value
          </span>
          <span className="ughist-ended-val ughist-ended-val--cur">
            {fmtCur(r.ending_value)}
          </span>
        </div>

        {/* ============ REFERENCES ============ */}
        <div className="ughist-ended-cell">
          <span className="ughist-ended-lbl">
            <FiUser aria-hidden="true" /> Handler
          </span>
          <span className="ughist-ended-val">
            {r.handler_username || '—'}
            {r.handler_position ? ` · ${r.handler_position}` : ''}
          </span>
        </div>
        <div className="ughist-ended-cell">
          <span className="ughist-ended-lbl">
            <FiFileText aria-hidden="true" /> Seed
          </span>
          <span className="ughist-ended-val ughist-ended-val--mono">
            {r.seed_export_uid || '—'}
          </span>
        </div>
        <div className="ughist-ended-cell">
          <span className="ughist-ended-lbl">
            <FiLock aria-hidden="true" /> Closing
          </span>
          <span className="ughist-ended-val ughist-ended-val--mono">
            {r.closing_export_uid || '—'}
          </span>
        </div>

        {/* ============ TIMESTAMPS (row 1) ============ */}
        <div className="ughist-ended-cell">
          <span className="ughist-ended-lbl">
            <FiPlayCircle aria-hidden="true" /> Shift opened
          </span>
          <span className="ughist-ended-val ughist-ended-ts">
            <span className="ughist-ts-date">{startTs.date}</span>
            {startTs.time && <span className="ughist-ts-time">{startTs.time}</span>}
          </span>
        </div>
        <div className="ughist-ended-cell">
          <span className="ughist-ended-lbl">
            <FiUploadCloud aria-hidden="true" /> Seed imported at
          </span>
          <span className="ughist-ended-val ughist-ended-ts">
            <span className="ughist-ts-date">{seedTs.date}</span>
            {seedTs.time && <span className="ughist-ts-time">{seedTs.time}</span>}
          </span>
        </div>
        <div className="ughist-ended-cell">
          <span className="ughist-ended-lbl">
            <FiLock aria-hidden="true" /> Shift closed at
          </span>
          <span className="ughist-ended-val ughist-ended-ts">
            <span className="ughist-ts-date">{endTs.date}</span>
            {endTs.time && <span className="ughist-ts-time">{endTs.time}</span>}
          </span>
        </div>

        {/* ============ TIMESTAMPS (row 2) ============ */}
        <div className="ughist-ended-cell">
          <span className="ughist-ended-lbl">
            <FiFileText aria-hidden="true" /> Closing exported at
          </span>
          <span className="ughist-ended-val ughist-ended-ts">
            <span className="ughist-ts-date">{closeTs.date}</span>
            {closeTs.time && <span className="ughist-ts-time">{closeTs.time}</span>}
          </span>
        </div>
        <div className="ughist-ended-cell">
          <span className="ughist-ended-lbl">
            <FiCheckCircle aria-hidden="true" /> Synced at
          </span>
          <span className="ughist-ended-val ughist-ended-ts">
            <span className="ughist-ts-date">{syncTs.date}</span>
            {syncTs.time && <span className="ughist-ts-time">{syncTs.time}</span>}
          </span>
        </div>
        <div className="ughist-ended-cell">
          <span className="ughist-ended-lbl">
            <FiZap aria-hidden="true" /> Sync method
          </span>
          <span className="ughist-ended-val">
            {r.reconciliation_format
              ? <SyncMethodPill format={r.reconciliation_format} />
              : <span className="ughist-muted">Not yet synced</span>}
          </span>
        </div>
      </div>
    );
  };

  /* ============================================================
     Render
     ============================================================ */
  return (
    <div className="ug-section">
      {/* ---------- Header ---------- */}
      <header className="ug-header">
        <div className="ug-header-left">
          <div className="ug-header-icon"><FiClock /></div>
          <div className="ug-header-info">
            <h2 className="ug-header-title">Shift History</h2>
            <div className="ug-header-sub">
              Every shift that has been opened, closed, or reconciled — with timestamps for each step.
            </div>
          </div>
        </div>
      </header>

      {/* ---------- Toolbar ---------- */}
      <div className="ughist-toolbar">
        <div className="ughist-search">
          <FiSearch />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by shift #, warehouse, handler, UID, status…"
            aria-label="Search shift history"
          />
          {search && (
            <button
              type="button"
              className="ug-btn ug-btn--ghost ug-btn--sm"
              onClick={() => setSearch('')}
              style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', minHeight: 28, padding: '2px 8px' }}
              aria-label="Clear search"
            >
              <FiX />
            </button>
          )}
        </div>

        <button
          type="button"
          className="ug-btn ug-btn--secondary ug-btn--sm"
          onClick={() => load({ silent: true })}
          disabled={loading || refreshing}
        >
          <FiRefreshCw className={refreshing ? 'ug-spin' : ''} />
          <span>{refreshing ? 'Refreshing…' : 'Refresh'}</span>
        </button>
      </div>

      {/* ---------- Error ---------- */}
      {error && (
        <div className="ug-error" role="alert">
          <FiAlertTriangle />
          <span>{error}</span>
          <button type="button" onClick={() => load()}>Try again</button>
        </div>
      )}

      {/* ---------- Loading ---------- */}
      {loading && (
        <div className="ug-loading">
          <FiLoader className="ug-spin" />
          <span>Loading shift history…</span>
        </div>
      )}

      {/* ---------- Empty ---------- */}
      {!loading && !error && rows.length === 0 && (
        <div className="ug-card">
          <div className="ug-empty">
            <FiInbox />
            <div className="ug-empty-title">
              {debouncedSearch ? 'No shifts match your search' : 'No shifts yet'}
            </div>
            <div className="ug-empty-sub">
              {debouncedSearch
                ? 'Try a different search term.'
                : 'Once you open your first shift, it will appear here.'}
            </div>
          </div>
        </div>
      )}

      {/* ---------- Open shifts group ---------- */}
      {!loading && !error && openShifts.length > 0 && (
        <section className="ughist-group">
          <div className="ughist-group-head ughist-group-head--static">
            <div className="ughist-group-head-left">
              <span className="ughist-group-icon ughist-group-icon--open" aria-hidden="true">
                <FiPlayCircle />
              </span>
              <h3 className="ughist-group-title">Open Shifts</h3>
              <span className="ughist-group-count">{openShifts.length}</span>
            </div>
          </div>

          <div className="ughist-group-body">
            {/* Desktop / tablet table */}
            <div className="ughist-table-wrap">
              <table className="ughist-table">
                <thead>
                  <tr>
                    <th scope="col">Shift</th>
                    <th scope="col">Warehouse</th>
                    <th scope="col">Status</th>
                    <th scope="col">Started</th>
                    <th scope="col">Ended</th>
                    <th scope="col" className="ughist-num">Beginning</th>
                    <th scope="col" className="ughist-num">Released</th>
                    <th scope="col" className="ughist-num">Ending</th>
                    <th scope="col" className="ughist-num">Value</th>
                    <th scope="col">Seed</th>
                    <th scope="col">Closing</th>
                  </tr>
                </thead>
                <tbody>
                  {openShifts.map((r) => (
                    <tr
                      key={r.shift_id}
                      onClick={() => setDetailId(r.shift_id)}
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setDetailId(r.shift_id);
                        }
                      }}
                      className="ughist-row"
                      title="Click for line-item detail"
                    >
                      <td><span className="ughist-uid">#{r.shift_id}</span></td>
                      <td>{r.warehouse_code}</td>
                      <td>
                        <span className={statusPillClass(r.status)}>
                          <span className="ug-pill-dot" />
                          {r.status}
                        </span>
                      </td>
                      <td>{fmtDateTime(r.started_at)}</td>
                      <td>{r.ended_at ? fmtDateTime(r.ended_at) : '—'}</td>
                      <td className="ughist-num">{fmtInt(r.beginning_qty)}</td>
                      <td className="ughist-num">{fmtInt(r.released_qty)}</td>
                      <td className="ughist-num">{fmtInt(r.ending_qty)}</td>
                      <td className="ughist-num ughist-num--cur">{fmtCur(r.released_value)}</td>
                      <td><span className="ughist-uid">{r.seed_export_uid || '—'}</span></td>
                      <td><span className="ughist-uid">{r.closing_export_uid || '—'}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile card list */}
            <div className="ughist-cardlist">
              {openShifts.map((r) => (
                <article
                  key={`open-${r.shift_id}`}
                  className="ughist-card"
                  onClick={() => setDetailId(r.shift_id)}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setDetailId(r.shift_id);
                    }
                  }}
                >
                  <header className="ughist-card-head">
                    <span className="ughist-uid">Shift #{r.shift_id}</span>
                    <span className={statusPillClass(r.status)}>
                      <span className="ug-pill-dot" />
                      {r.status}
                    </span>
                  </header>
                  <dl className="ughist-card-grid">
                    <div><dt>Warehouse</dt><dd>{r.warehouse_code}</dd></div>
                    <div><dt>Started</dt><dd>{fmtDateTime(r.started_at)}</dd></div>
                    <div><dt>Released</dt><dd>{fmtInt(r.released_qty)}</dd></div>
                    <div><dt>Value</dt><dd className="ughist-num--cur">{fmtCur(r.released_value)}</dd></div>
                    <div><dt>Seed</dt><dd>{r.seed_export_uid || '—'}</dd></div>
                    <div><dt>Closing</dt><dd>{r.closing_export_uid || '—'}</dd></div>
                  </dl>
                </article>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ---------- Ended shifts group (collapsible, collapsed by default) ---------- */}
      {!loading && !error && endedShifts.length > 0 && (
        <section className={`ughist-group ${endedGroupOpen ? 'is-open' : 'is-closed'}`}>
          <div className="ughist-group-head">
            <button
              type="button"
              className="ughist-group-head-btn"
              onClick={() => setEndedGroupOpen((v) => !v)}
              aria-expanded={endedGroupOpen}
              aria-controls="ughist-ended-body"
            >
              <span className="ughist-group-icon ughist-group-icon--ended" aria-hidden="true">
                <FiLayers />
              </span>
              <h3 className="ughist-group-title">Ended Shifts</h3>
              <span className="ughist-group-count">{endedShifts.length}</span>
              <FiChevronDown
                className={`ughist-group-chev ${endedGroupOpen ? 'is-open' : ''}`}
                aria-hidden="true"
              />
            </button>

            {endedGroupOpen && (
              <div className="ughist-group-actions">
                <button
                  type="button"
                  className="ughist-group-toggle-btn"
                  onClick={toggleAllEnded}
                  disabled={endedShifts.length === 0}
                >
                  {allEndedExpanded ? (
                    <>
                      <FiChevronUp aria-hidden="true" />
                      <span>Collapse all</span>
                    </>
                  ) : (
                    <>
                      <FiChevronDown aria-hidden="true" />
                      <span>Expand all</span>
                    </>
                  )}
                </button>
              </div>
            )}
          </div>

          {endedGroupOpen && (
            <div className="ughist-group-body" id="ughist-ended-body">
              {/* Desktop / tablet table */}
              <div className="ughist-table-wrap">
                <table className="ughist-table ughist-table--ended">
                  <thead>
                    <tr>
                      <th scope="col" className="ughist-col-chev" aria-label="Expand" />
                      <th scope="col">Shift</th>
                      <th scope="col">Warehouse</th>
                      <th scope="col">Status</th>
                      <th scope="col">Started</th>
                      <th scope="col">Ended</th>
                      <th scope="col" className="ughist-num">Released</th>
                      <th scope="col" className="ughist-num">Value</th>
                      <th scope="col">Sync</th>
                    </tr>
                  </thead>
                  <tbody>
                    {endedShifts.map((r) => {
                      const expanded = expandedEndedIds.has(r.shift_id);
                      return (
                        <React.Fragment key={r.shift_id}>
                          <tr
                            className={`ughist-row ughist-row--ended ${expanded ? 'is-expanded' : ''}`}
                            onClick={() => toggleEndedRow(r.shift_id)}
                            tabIndex={0}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                toggleEndedRow(r.shift_id);
                              }
                            }}
                            aria-expanded={expanded}
                            title={expanded ? 'Click to collapse' : 'Click to expand'}
                          >
                            <td className="ughist-col-chev">
                              <FiChevronDown
                                className={`ughist-row-chev ${expanded ? 'is-open' : ''}`}
                                aria-hidden="true"
                              />
                            </td>
                            <td><span className="ughist-uid">#{r.shift_id}</span></td>
                            <td>{r.warehouse_code}</td>
                            <td>
                              <span className={statusPillClass(r.status)}>
                                <span className="ug-pill-dot" />
                                {r.status}
                              </span>
                            </td>
                            <td>{fmtDateTime(r.started_at)}</td>
                            <td>{r.ended_at ? fmtDateTime(r.ended_at) : '—'}</td>
                            <td className="ughist-num">{fmtInt(r.released_qty)}</td>
                            <td className="ughist-num ughist-num--cur">{fmtCur(r.released_value)}</td>
                            <td>
                              {r.reconciliation_format
                                ? <SyncMethodPill format={r.reconciliation_format} />
                                : <span className="ughist-muted">—</span>}
                            </td>
                          </tr>

                          {expanded && (
                            <tr className="ughist-ended-details-row">
                              <td colSpan={9}>
                                {renderEndedDetails(r)}
                                <div className="ughist-ended-actions">
                                  <button
                                    type="button"
                                    className="ug-btn ug-btn--secondary ug-btn--sm"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setDetailId(r.shift_id);
                                    }}
                                  >
                                    <FiFileText />
                                    <span>View line items</span>
                                  </button>
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile card list — collapsible cards */}
              <div className="ughist-cardlist">
                {endedShifts.map((r) => {
                  const expanded = expandedEndedIds.has(r.shift_id);
                  return (
                    <article
                      key={`ended-${r.shift_id}`}
                      className={`ughist-card ughist-card--ended ${expanded ? 'is-expanded' : ''}`}
                    >
                      <button
                        type="button"
                        className="ughist-card-head ughist-card-head--btn"
                        onClick={() => toggleEndedRow(r.shift_id)}
                        aria-expanded={expanded}
                      >
                        <span className="ughist-card-head-main">
                          <span className="ughist-uid">Shift #{r.shift_id}</span>
                          <span className={statusPillClass(r.status)}>
                            <span className="ug-pill-dot" />
                            {r.status}
                          </span>
                        </span>
                        <FiChevronDown
                          className={`ughist-row-chev ${expanded ? 'is-open' : ''}`}
                          aria-hidden="true"
                        />
                      </button>

                      <dl className="ughist-card-grid ughist-card-grid--compact">
                        <div><dt>Warehouse</dt><dd>{r.warehouse_code}</dd></div>
                        <div><dt>Ended</dt><dd>{fmtDateTime(r.ended_at)}</dd></div>
                        <div><dt>Released</dt><dd>{fmtInt(r.released_qty)}</dd></div>
                        <div><dt>Value</dt><dd className="ughist-num--cur">{fmtCur(r.released_value)}</dd></div>
                        {r.reconciliation_format && (
                          <div className="ughist-card-grid-full">
                            <dt>Sync method</dt>
                            <dd><SyncMethodPill format={r.reconciliation_format} /></dd>
                          </div>
                        )}
                      </dl>

                      {expanded && (
                        <div className="ughist-card-expanded">
                          {renderEndedDetails(r)}
                          <div className="ughist-ended-actions">
                            <button
                              type="button"
                              className="ug-btn ug-btn--secondary ug-btn--sm"
                              onClick={() => setDetailId(r.shift_id)}
                            >
                              <FiFileText />
                              <span>View line items</span>
                            </button>
                          </div>
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            </div>
          )}
        </section>
      )}

      {/* ---------- Pagination ---------- */}
      {!loading && !error && totalPages > 1 && (
        <nav className="ughist-pagination" aria-label="Shift history pagination">
          <div className="ughist-pagination-info">
            Showing <strong>{showingStart}</strong>–<strong>{showingEnd}</strong> of{' '}
            <strong>{fmtInt(total)}</strong> shift{total === 1 ? '' : 's'}
          </div>
          <div className="ughist-pagination-controls">
            <button
              type="button" className="ughist-page-btn"
              onClick={() => goToPage(1)}
              disabled={page <= 1}
              aria-label="First page"
            ><FiChevronsLeft /></button>
            <button
              type="button" className="ughist-page-btn"
              onClick={() => goToPage(page - 1)}
              disabled={page <= 1}
              aria-label="Previous page"
            ><FiChevronLeft /></button>
            {pageList.map((p, i) =>
              p === '…' ? (
                <span key={`e${i}`} className="ughist-page-ellipsis">…</span>
              ) : (
                <button
                  key={p}
                  type="button"
                  className={`ughist-page-btn ${p === page ? 'is-active' : ''}`}
                  onClick={() => goToPage(p)}
                >{p}</button>
              )
            )}
            <button
              type="button" className="ughist-page-btn"
              onClick={() => goToPage(page + 1)}
              disabled={page >= totalPages}
              aria-label="Next page"
            ><FiChevronRight /></button>
            <button
              type="button" className="ughist-page-btn"
              onClick={() => goToPage(totalPages)}
              disabled={page >= totalPages}
              aria-label="Last page"
            ><FiChevronsRight /></button>
          </div>
        </nav>
      )}

      {/* ---------- Detail modal ---------- */}
      {detailId && (
        <ShiftDetailModal
          shiftId={detailId}
          onClose={() => setDetailId(null)}
        />
      )}

      <style>{historyExtrasCss}</style>
    </div>
  );
};

/* ============================================================
   Detail modal — header facts + paginated line items
   ============================================================ */
const ShiftDetailModal = ({ shiftId, onClose }) => {
  const toast = useToast();
  const [header, setHeader] = useState(null);
  const [lines, setLines] = useState([]);
  const [linesTotal, setLinesTotal] = useState(0);
  const [linesTotalPages, setLinesTotalPages] = useState(1);
  const [linesPage, setLinesPage] = useState(1);
  const [lineKind, setLineKind] = useState('Release');
  const [loading, setLoading] = useState(true);
  const [loadingLines, setLoadingLines] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await undergroundApi.getShift(shiftId);
        if (cancelled) return;
        if (res.ok && res.data) setHeader(res.data);
        else setError(res?.data?.message || 'Failed to load shift.');
      } catch (e) {
        if (!cancelled) setError(e?.message || 'Failed to load shift.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [shiftId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingLines(true);
      try {
        const res = await undergroundApi.getShiftLines(shiftId, {
          kind: lineKind,
          page: linesPage,
          limit: LINES_PAGE_SIZE,
        });
        if (cancelled) return;
        if (res.ok) {
          setLines(Array.isArray(res.data) ? res.data : []);
          setLinesTotal(Number(res.total) || 0);
          setLinesTotalPages(Math.max(Number(res.totalPages) || 1, 1));
        } else {
          setLines([]);
          setLinesTotal(0);
          setLinesTotalPages(1);
        }
      } catch (e) {
        if (!cancelled) {
          toast.error('Failed to load line items.');
          setLines([]);
        }
      } finally {
        if (!cancelled) setLoadingLines(false);
      }
    })();
    return () => { cancelled = true; };
  }, [shiftId, linesPage, lineKind, toast]);

  const goLinesPage = (p) => {
    const next = Math.max(1, Math.min(linesTotalPages, p));
    if (next !== linesPage) setLinesPage(next);
  };

  const seedTs  = header ? fmtTimestamp(header.seed_imported_at)   : { date: '—', time: '' };
  const closeTs = header ? fmtTimestamp(header.closing_exported_at) : { date: '—', time: '' };
  const syncTs  = header
    ? fmtTimestamp(header.reconciled_at || header.reconciliation_log_at)
    : { date: '—', time: '' };

  return (
    <div className="ugmodal-overlay" onClick={onClose}>
      <div
        className="ugmodal-card ugmodal-card--wide"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ugmodal-header">
          <div className="ugmodal-header-left">
            <div className="ugmodal-header-icon"><FiClock /></div>
            <div style={{ minWidth: 0 }}>
              <h3 className="ugmodal-title">
                Shift #{header?.shift_id || shiftId}
              </h3>
              {header && (
                <div className="ugmodal-sub">
                  {header.warehouse_code} · {header.status} · started {fmtDateTime(header.started_at)}
                </div>
              )}
            </div>
          </div>
          <button
            type="button"
            className="ugmodal-close"
            onClick={onClose}
            aria-label="Close"
          ><FiX /></button>
        </div>

        <div className="ugmodal-body">
          {loading && (
            <div className="ug-loading">
              <FiLoader className="ug-spin" />
              <span>Loading shift…</span>
            </div>
          )}

          {error && (
            <div className="ugmodal-feedback ugmodal-feedback--error">
              <FiAlertTriangle />
              <span>{error}</span>
            </div>
          )}

          {!loading && header && (
            <>
              {/* ============ BEGINNING / RELEASED / ENDING summary ============ */}
              <div
                className="ugmodal-summary"
                style={{ gridTemplateColumns: 'auto 1fr' }}
              >
                <dt><FiUser style={{ verticalAlign: 'middle', marginRight: 6 }} /> Handler</dt>
                <dd>{header.handler_username}{header.handler_position ? ` · ${header.handler_position}` : ''}</dd>

                <dt><FiFileText style={{ verticalAlign: 'middle', marginRight: 6 }} /> Seed</dt>
                <dd>{header.seed_export_uid || '—'}</dd>

                <dt><FiFileText style={{ verticalAlign: 'middle', marginRight: 6 }} /> Closing</dt>
                <dd>{header.closing_export_uid || '—'}</dd>

                <dt><FiPackage style={{ verticalAlign: 'middle', marginRight: 6 }} /> Beginning locators</dt>
                <dd>{fmtInt(header.beginning_locator_count)}</dd>

                <dt><FiPackage style={{ verticalAlign: 'middle', marginRight: 6 }} /> Beginning items</dt>
                <dd>{fmtInt(header.beginning_item_count)}</dd>

                <dt><FiPackage style={{ verticalAlign: 'middle', marginRight: 6 }} /> Beginning qty</dt>
                <dd>{fmtInt(header.beginning_qty)}</dd>

                <dt><FiDollarSign style={{ verticalAlign: 'middle', marginRight: 6 }} /> Beginning value</dt>
                <dd className="ugmodal-summary--cur">{fmtCur(header.beginning_value)}</dd>

                <dt><FiPackage style={{ verticalAlign: 'middle', marginRight: 6 }} /> Release lines</dt>
                <dd>{fmtInt(header.release_line_count)}</dd>

                <dt><FiPackage style={{ verticalAlign: 'middle', marginRight: 6 }} /> Released qty</dt>
                <dd>{fmtInt(header.released_qty)}</dd>

                <dt><FiDollarSign style={{ verticalAlign: 'middle', marginRight: 6 }} /> Released value</dt>
                <dd className="ugmodal-summary--cur">{fmtCur(header.released_value)}</dd>

                <dt><FiPackage style={{ verticalAlign: 'middle', marginRight: 6 }} /> Ending qty</dt>
                <dd>{fmtInt(header.ending_qty)}</dd>

                <dt><FiDollarSign style={{ verticalAlign: 'middle', marginRight: 6 }} /> Ending value</dt>
                <dd className="ugmodal-summary--cur">{fmtCur(header.ending_value)}</dd>
              </div>

              {/* ============ PROCESS TIMESTAMPS + SYNC METHOD ============ */}
              <div className="ugmodal-timeline">
                <div className="ugmodal-timeline-row">
                  <span className="ugmodal-timeline-label">
                    <FiPlayCircle aria-hidden="true" /> Shift opened
                  </span>
                  <span className="ugmodal-timeline-value">
                    {fmtDateTime(header.started_at)}
                  </span>
                </div>
                <div className="ugmodal-timeline-row">
                  <span className="ugmodal-timeline-label">
                    <FiUploadCloud aria-hidden="true" /> Seed imported at
                  </span>
                  <span className="ugmodal-timeline-value">
                    <span className="ughist-ts-date">{seedTs.date}</span>
                    {seedTs.time && <span className="ughist-ts-time">{seedTs.time}</span>}
                  </span>
                </div>
                <div className="ugmodal-timeline-row">
                  <span className="ugmodal-timeline-label">
                    <FiLock aria-hidden="true" /> Shift closed at
                  </span>
                  <span className="ugmodal-timeline-value">
                    {header.ended_at ? fmtDateTime(header.ended_at) : '—'}
                  </span>
                </div>
                <div className="ugmodal-timeline-row">
                  <span className="ugmodal-timeline-label">
                    <FiFileText aria-hidden="true" /> Closing exported at
                  </span>
                  <span className="ugmodal-timeline-value">
                    <span className="ughist-ts-date">{closeTs.date}</span>
                    {closeTs.time && <span className="ughist-ts-time">{closeTs.time}</span>}
                  </span>
                </div>
                <div className="ugmodal-timeline-row">
                  <span className="ugmodal-timeline-label">
                    <FiCheckCircle aria-hidden="true" /> Synced at
                  </span>
                  <span className="ugmodal-timeline-value">
                    <span className="ughist-ts-date">{syncTs.date}</span>
                    {syncTs.time && <span className="ughist-ts-time">{syncTs.time}</span>}
                  </span>
                </div>
                <div className="ugmodal-timeline-row">
                  <span className="ugmodal-timeline-label">
                    <FiZap aria-hidden="true" /> Sync method
                  </span>
                  <span className="ugmodal-timeline-value">
                    {header.reconciliation_format
                      ? <SyncMethodPill format={header.reconciliation_format} />
                      : <span className="ughist-muted">Not yet synced</span>}
                  </span>
                </div>
              </div>

              {/* ============ LINE ITEM TABS ============ */}
              <div style={{ display: 'flex', gap: 6, padding: 4, background: '#f1f5f9', borderRadius: 10, alignSelf: 'flex-start' }}>
                <button
                  type="button"
                  className={`ug-subtab ${lineKind === 'Release' ? 'is-active' : ''}`}
                  onClick={() => { setLineKind('Release'); setLinesPage(1); }}
                  style={{ flex: '0 0 auto', minHeight: 34, padding: '6px 14px' }}
                >
                  Releases
                </button>
                <button
                  type="button"
                  className={`ug-subtab ${lineKind === 'Beginning' ? 'is-active' : ''}`}
                  onClick={() => { setLineKind('Beginning'); setLinesPage(1); }}
                  style={{ flex: '0 0 auto', minHeight: 34, padding: '6px 14px' }}
                >
                  Beginning Balance
                </button>
              </div>

              <div>
                <div style={{ fontSize: 13, color: '#475569', marginBottom: 8 }}>
                  <strong>{fmtInt(linesTotal)}</strong> line{linesTotal === 1 ? '' : 's'}
                </div>

                {loadingLines ? (
                  <div className="ug-loading">
                    <FiLoader className="ug-spin" />
                    <span>Loading lines…</span>
                  </div>
                ) : lines.length === 0 ? (
                  <div className="ug-empty">
                    <FiInbox />
                    <div className="ug-empty-title">No lines</div>
                    <div className="ug-empty-sub">Nothing recorded in this category yet.</div>
                  </div>
                ) : (
                  <div className="uginv-table-wrap" style={{ maxHeight: '48vh', overflow: 'auto' }}>
                    <table className="uginv-table">
                      <thead>
                        <tr>
                          <th>Locator</th>
                          <th>Item</th>
                          <th>UOM</th>
                          <th className="uginv-num">Qty</th>
                          <th className="uginv-num">Unit cost</th>
                          <th className="uginv-num">Line total</th>
                          {lineKind === 'Release' && <th>Released by</th>}
                          {lineKind === 'Release' && <th>Destination</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {lines.map((ln) => (
                          <tr key={ln.line_id}>
                            <td>
                              <div className="uginv-code">{ln.locator_code}</div>
                              {ln.locator_name && (
                                <div className="uginv-name">{ln.locator_name}</div>
                              )}
                            </td>
                            <td>
                              <div className="uginv-code">{ln.item_code}</div>
                              {ln.item_name && (
                                <div className="uginv-name">{ln.item_name}</div>
                              )}
                            </td>
                            <td>{ln.uom || '—'}</td>
                            <td className="uginv-num">{fmtInt(ln.qty)}</td>
                            <td className="uginv-num">{fmtCur(ln.unit_cost)}</td>
                            <td className="uginv-num uginv-num--cur">{fmtCur(ln.line_total)}</td>
                            {lineKind === 'Release' && (
                              <td>{ln.released_by || '—'}</td>
                            )}
                            {lineKind === 'Release' && (
                              <td>{ln.destination || '—'}</td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {linesTotalPages > 1 && (
                  <nav className="ughist-pagination" style={{ marginTop: 12 }}>
                    <div className="ughist-pagination-info">
                      Page <strong>{linesPage}</strong> of <strong>{linesTotalPages}</strong>
                      <span> · {fmtInt(linesTotal)} line(s)</span>
                    </div>
                    <div className="ughist-pagination-controls">
                      <button
                        type="button" className="ughist-page-btn"
                        onClick={() => goLinesPage(1)}
                        disabled={linesPage <= 1 || loadingLines}
                      ><FiChevronsLeft /></button>
                      <button
                        type="button" className="ughist-page-btn"
                        onClick={() => goLinesPage(linesPage - 1)}
                        disabled={linesPage <= 1 || loadingLines}
                      ><FiChevronLeft /></button>
                      <span style={{ minWidth: 60, textAlign: 'center', fontSize: 12, fontWeight: 700, color: '#334155' }}>
                        {linesPage} / {linesTotalPages}
                      </span>
                      <button
                        type="button" className="ughist-page-btn"
                        onClick={() => goLinesPage(linesPage + 1)}
                        disabled={linesPage >= linesTotalPages || loadingLines}
                      ><FiChevronRight /></button>
                      <button
                        type="button" className="ughist-page-btn"
                        onClick={() => goLinesPage(linesTotalPages)}
                        disabled={linesPage >= linesTotalPages || loadingLines}
                      ><FiChevronsRight /></button>
                    </div>
                  </nav>
                )}
              </div>
            </>
          )}
        </div>

        <div className="ugmodal-footer">
          <button
            type="button"
            className="ug-btn ug-btn--secondary"
            onClick={onClose}
          >Close</button>
        </div>
      </div>
    </div>
  );
};

export default UndergroundHistory;

/* ============================================================
   Component-scoped CSS — ughist- / ugmodal- extended classes.
   No backticks inside this template literal.

   Everything is grouped by feature and includes explicit
   media queries so the expanded grid, timeline block, and sync
   badges all remain readable on 320px phones up to 1921px+.
   ============================================================ */
const historyExtrasCss = `
/* ============================================================
   GROUP SECTIONS (Open / Ended)
   ============================================================ */
.ughist-group {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.ughist-group-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 14px;
  background: linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%);
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  flex-wrap: wrap;
}

.ughist-group-head--static {
  background: linear-gradient(180deg, #ecfdf5 0%, #f0fdfa 100%);
  border-color: #99f6e4;
}

.ughist-group-head-btn {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 4px 6px 4px 4px;
  margin: 0;
  border: none;
  background: transparent;
  font: inherit;
  cursor: pointer;
  color: #0f172a;
  border-radius: 8px;
  transition: background 140ms ease;
}
.ughist-group-head-btn:hover { background: rgba(255, 255, 255, 0.7); }
.ughist-group-head-btn:focus-visible { outline: 2px solid #00b8b0; outline-offset: 2px; }

.ughist-group-head-left { display: inline-flex; align-items: center; gap: 10px; }

.ughist-group-icon {
  width: 30px;
  height: 30px;
  border-radius: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #ffffff;
  flex-shrink: 0;
}
.ughist-group-icon svg { width: 15px; height: 15px; stroke-width: 2.4; }
.ughist-group-icon--open {
  background: linear-gradient(135deg, #34d399 0%, #047857 100%);
  box-shadow: 0 3px 10px rgba(16, 185, 129, 0.28);
}
.ughist-group-icon--ended {
  background: linear-gradient(135deg, #94a3b8 0%, #475569 100%);
  box-shadow: 0 3px 10px rgba(71, 85, 105, 0.24);
}

.ughist-group-title {
  margin: 0;
  font-size: 13.5px;
  font-weight: 800;
  letter-spacing: 0.02em;
  color: #0f172a;
}

.ughist-group-count {
  display: inline-block;
  padding: 2px 9px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.04em;
  background: #ffffff;
  color: #0f766e;
  border: 1px solid #cbd5e1;
}
.ughist-group-head--static .ughist-group-count {
  color: #047857;
  border-color: #86efac;
}

.ughist-group-chev {
  width: 16px;
  height: 16px;
  color: #64748b;
  stroke-width: 2.6;
  transition: transform 200ms ease;
}
.ughist-group-chev.is-open { transform: rotate(180deg); }

.ughist-group-actions { display: inline-flex; gap: 8px; }

.ughist-group-toggle-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 32px;
  padding: 6px 12px;
  border: 1.5px solid #cbd5e1;
  border-radius: 8px;
  background: #ffffff;
  font-family: inherit;
  font-size: 12px;
  font-weight: 700;
  color: #334155;
  cursor: pointer;
  transition: background 140ms ease, border-color 140ms ease, color 140ms ease;
}
.ughist-group-toggle-btn:hover:not(:disabled) {
  background: #f0fdfa;
  border-color: #00b8b0;
  color: #007a72;
}
.ughist-group-toggle-btn:focus-visible { outline: 2px solid #00b8b0; outline-offset: 2px; }
.ughist-group-toggle-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.ughist-group-toggle-btn svg { width: 13px; height: 13px; stroke-width: 2.4; }

.ughist-group-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  animation: ughistGroupFade 200ms ease-out;
}
@keyframes ughistGroupFade {
  from { opacity: 0; transform: translateY(-4px); }
  to   { opacity: 1; transform: translateY(0); }
}

/* ============================================================
   ENDED-SHIFT TABLE (collapsible rows)
   ============================================================ */
.ughist-table--ended .ughist-col-chev {
  width: 36px;
  padding-right: 0;
  padding-left: 12px;
}

.ughist-row--ended { cursor: pointer; }
.ughist-row--ended:hover { background: #f8fafc; }
.ughist-row--ended.is-expanded {
  background: #f0fdfa;
  border-bottom-color: transparent;
}
.ughist-row--ended.is-expanded td {
  border-bottom: 1px solid #e2e8f0;
}

.ughist-row-chev {
  width: 14px;
  height: 14px;
  color: #64748b;
  stroke-width: 2.6;
  transition: transform 200ms ease;
  display: block;
}
.ughist-row-chev.is-open {
  transform: rotate(180deg);
  color: #0f766e;
}

.ughist-ended-details-row > td {
  padding: 0 !important;
  background: #f0fdfa;
  border-bottom: 1px solid #99f6e4 !important;
}

/* ============================================================
   EXPANDED DETAIL GRID — grouped cells + timestamps + badge
   ============================================================ */
.ughist-ended-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px 16px;
  padding: 14px 16px 10px;
}
.ughist-ended-cell {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
.ughist-ended-lbl {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #0f766e;
}
.ughist-ended-lbl svg {
  width: 11px;
  height: 11px;
  stroke-width: 2.4;
  flex-shrink: 0;
}
.ughist-ended-val {
  font-size: 13px;
  font-weight: 600;
  color: #0f172a;
  word-break: break-word;
}
.ughist-ended-val--cur { color: #047857; font-weight: 800; }
.ughist-ended-val--mono {
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-size: 12px;
}

/* Two-line timestamp used inside expanded cells + modal */
.ughist-ended-ts,
.ughist-ts {
  display: flex;
  flex-direction: column;
  gap: 1px;
  line-height: 1.25;
  min-width: 0;
}
.ughist-ts-date {
  font-size: 12.5px;
  font-weight: 700;
  color: #0f172a;
  white-space: nowrap;
}
.ughist-ts-time {
  font-size: 11px;
  font-weight: 600;
  color: #64748b;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.ughist-muted {
  color: #94a3b8;
  font-size: 12px;
}

/* ============================================================
   SYNC METHOD BADGE
   ============================================================ */
.ughist-syncbadge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 9px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 800;
  white-space: nowrap;
}
.ughist-syncbadge svg { width: 12px; height: 12px; }

.ughist-syncbadge--online {
  background: linear-gradient(135deg, #eef2ff 0%, #e0e7ff 100%);
  color: #3730a3;
  border: 1px solid #a5b4fc;
  box-shadow: 0 1px 3px rgba(99, 102, 241, 0.14);
}
.ughist-syncbadge--online svg { color: #4338ca; }

.ughist-syncbadge--excel {
  background: #ecfdf5;
  color: #047857;
  border: 1px solid #86efac;
}

.ughist-ended-actions {
  display: flex;
  justify-content: flex-end;
  padding: 0 16px 14px;
}

/* ============================================================
   MODAL: timeline block (Seed imported at, Synced at, …)
   ============================================================ */
.ugmodal-timeline {
  display: flex;
  flex-direction: column;
  gap: 0;
  padding: 4px 0;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  background: #ffffff;
  overflow: hidden;
}
.ugmodal-timeline-row {
  display: grid;
  grid-template-columns: minmax(180px, auto) 1fr;
  gap: 12px;
  align-items: center;
  padding: 10px 14px;
  border-bottom: 1px solid #f1f5f9;
}
.ugmodal-timeline-row:last-child { border-bottom: none; }

.ugmodal-timeline-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 10.5px;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #0f766e;
}
.ugmodal-timeline-label svg {
  width: 12px;
  height: 12px;
  stroke-width: 2.4;
  flex-shrink: 0;
}
.ugmodal-timeline-value {
  font-size: 13px;
  font-weight: 600;
  color: #1e293b;
  word-break: break-word;
  min-width: 0;
}

/* ============================================================
   ENDED-SHIFT CARDS (mobile)
   ============================================================ */
.ughist-card--ended {
  padding: 0;
  overflow: hidden;
}
.ughist-card--ended.is-expanded {
  border-color: #99f6e4;
  box-shadow: 0 0 0 2px rgba(0, 210, 200, 0.14);
}

.ughist-card-head--btn {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 14px;
  border: none;
  background: transparent;
  font: inherit;
  text-align: left;
  cursor: pointer;
  color: #0f172a;
  transition: background 140ms ease;
}
.ughist-card-head--btn:hover { background: #f8fafc; }
.ughist-card-head--btn:focus-visible {
  outline: 2px solid #00b8b0;
  outline-offset: -2px;
}

.ughist-card-head-main {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.ughist-card-grid--compact { padding: 0 14px 12px; }

.ughist-card-expanded {
  border-top: 1px dashed #99f6e4;
  background: #f0fdfa;
}
.ughist-card-expanded .ughist-ended-grid {
  padding: 12px 14px 8px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px 12px;
}
.ughist-card-expanded .ughist-ended-actions {
  padding: 0 14px 12px;
}

/* ============================================================
   RESPONSIVE
   ============================================================ */

/* Ultra-wide --------------------------------------------------- */
@media (min-width: 1921px) {
  .ughist-group-title { font-size: 15px; }
  .ughist-group-icon { width: 34px; height: 34px; }
  .ughist-group-icon svg { width: 17px; height: 17px; }
  .ughist-ended-grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 14px 20px;
    padding: 18px 20px 12px;
  }
  .ughist-ended-val { font-size: 14px; }
  .ughist-ended-lbl { font-size: 11px; }
  .ughist-ts-date { font-size: 13px; }
  .ughist-ts-time { font-size: 11.5px; }
  .ughist-syncbadge { font-size: 11.5px; padding: 4px 10px; }
  .ughist-syncbadge svg { width: 13px; height: 13px; }
  .ugmodal-timeline-label { font-size: 11px; }
  .ugmodal-timeline-value { font-size: 14px; }
}

/* Tablet portrait / small laptop ------------------------------ */
@media (max-width: 900px) {
  .ughist-ended-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .ugmodal-timeline-row {
    grid-template-columns: 1fr;
    gap: 4px;
    padding: 10px 12px;
  }
}

/* Large phones ------------------------------------------------ */
@media (max-width: 640px) {
  .ughist-group-head { padding: 10px; gap: 8px; }
  .ughist-group-title { font-size: 13px; }
  .ughist-group-actions { width: 100%; justify-content: flex-end; }
  .ughist-group-toggle-btn { min-height: 36px; font-size: 12.5px; }

  .ughist-ended-grid {
    grid-template-columns: 1fr;
    padding: 12px 12px 6px;
    gap: 10px;
  }
  .ughist-ended-actions { padding: 0 12px 12px; }
  .ughist-ended-actions .ug-btn { width: 100%; }

  .ugmodal-timeline-row { padding: 9px 10px; }
}

/* Phones ------------------------------------------------------ */
@media (max-width: 480px) {
  .ughist-group-count { font-size: 10.5px; padding: 2px 8px; }
  .ughist-group-icon { width: 26px; height: 26px; border-radius: 7px; }
  .ughist-group-icon svg { width: 13px; height: 13px; }

  .ughist-ended-lbl { font-size: 9.5px; }
  .ughist-ended-val { font-size: 12.5px; }
  .ughist-ts-date { font-size: 12px; }
  .ughist-ts-time { font-size: 10.5px; }
  .ughist-syncbadge { font-size: 10px; padding: 2px 7px; gap: 4px; }
  .ughist-syncbadge svg { width: 10px; height: 10px; }

  .ughist-card-expanded .ughist-ended-grid { grid-template-columns: 1fr; }

  .ugmodal-timeline-label { font-size: 10px; }
  .ugmodal-timeline-value { font-size: 12.5px; }
}

/* Small phones ------------------------------------------------ */
@media (max-width: 400px) {
  .ughist-ended-val { font-size: 12px; }
  .ughist-ts-date { font-size: 11.5px; }
  .ughist-ts-time { font-size: 10px; }
}

/* Very small phones ------------------------------------------ */
@media (max-width: 360px) {
  .ughist-group-title { font-size: 12.5px; }
  .ughist-ended-lbl { font-size: 9px; }
  .ughist-syncbadge span { display: none; }
  .ughist-syncbadge { padding: 3px 6px; }
  .ugmodal-timeline-row { padding: 8px 10px; }
}

/* Short landscape --------------------------------------------- */
@media (max-height: 520px) and (orientation: landscape) {
  .ughist-ended-grid { padding: 10px 12px 6px; gap: 8px 12px; }
  .ughist-group-body { animation: none !important; }
  .ugmodal-timeline-row { padding: 8px 12px; }
}

/* Motion preferences ------------------------------------------ */
@media (prefers-reduced-motion: reduce) {
  .ughist-group-chev,
  .ughist-row-chev,
  .ughist-group-toggle-btn,
  .ughist-card-head--btn { transition: none !important; }
  .ughist-group-body { animation: none !important; }
}
`;