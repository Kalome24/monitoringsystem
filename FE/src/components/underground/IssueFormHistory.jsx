// src/components/underground/IssueFormHistory.jsx
//
// Issue-form history tab. Every MER / MSR / MSF / MSB form saved by
// this warehouse, grouped by shift.
//
// Filters:
//   • Form type chips (All / MER / MSR / MSF / MSB)
//   • Date+time range — From / To via native datetime-local inputs,
//     plus one-tap shortcuts (Today / Last 24h / Last 7d / This month)
//   • Free-text search over form no., type, warehouse, handler
//
// Grouping:
//   Rows are grouped by their parent shift. Each group is a
//   collapsible section.
//     • Open shifts start EXPANDED.
//     • Ended shifts (Closed / Reconciled / Rejected) start COLLAPSED.
//   A "Collapse all" / "Expand all" button in the toolbar toggles
//   every ended group at once.
//
// Global Totals (accuracy fix):
//   The three stat cards (Forms / Lines / Amount) now use the
//   `totals` object returned by the backend. This ensures the numbers
//   represent the ENTIRE filtered database, not just the current
//   paginated page. This solves the issue where page-specific
//   calculations could hide data.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FiFileText,
  FiRefreshCw,
  FiLoader,
  FiInbox,
  FiAlertTriangle,
  FiSearch,
  FiX,
  FiDollarSign,
  FiHash,
  FiCalendar,
  FiChevronDown,
  FiChevronUp,
  FiLayers,
  FiFolder,
  FiChevronLeft,
  FiChevronRight,
  FiChevronsLeft,
  FiChevronsRight,
} from 'react-icons/fi';
import { issueFormApi } from '../../services/api';
import { useToast } from '../shared/ToastProvider';
import IssueFormDetailModal from './issueForms/IssueFormDetailModal';

/* ============================================================
   Formatters
   ============================================================ */
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

const fmtTime = (value) => {
  if (!value) return '';
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString('en-PH', { timeStyle: 'short' });
  } catch { return ''; }
};

/* ---------- Local-date helpers for datetime-local inputs ---------- */
const pad2 = (n) => String(n).padStart(2, '0');

const toLocalInput = (date) => {
  if (!date) return '';
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  return (
    d.getFullYear() +
    '-' + pad2(d.getMonth() + 1) +
    '-' + pad2(d.getDate()) +
    'T' + pad2(d.getHours()) +
    ':' + pad2(d.getMinutes())
  );
};

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

const endOfToday = () => {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
};

/* ============================================================
   Filter chips + tones
   ============================================================ */
const FILTERS = [
  { value: 'All', label: 'All' },
  { value: 'MER', label: 'MER' },
  { value: 'MSR', label: 'MSR' },
  { value: 'MSF', label: 'MSF' },
  { value: 'MSB', label: 'MSB' },
];

const TYPE_TONE = {
  MER: 'amber',
  MSR: 'teal',
  MSF: 'blue',
  MSB: 'slate',
};

/* ============================================================
   Shift-group helpers
   ============================================================ */
const isEndedStatus = (status) => {
  const s = String(status || '').toLowerCase();
  return s === 'closed' || s === 'reconciled' || s === 'rejected';
};

const shiftPillClass = (status) => {
  const s = String(status || '').toLowerCase();
  if (s === 'open')       return 'ug-pill ug-pill--open';
  if (s === 'closed')     return 'ug-pill ug-pill--closed';
  if (s === 'reconciled') return 'ug-pill ug-pill--reconciled';
  if (s === 'rejected')   return 'ug-pill ug-pill--rejected';
  return 'ug-pill ug-pill--none';
};

const SHIFTS_PER_PAGE = 10;

/* ============================================================
   Component
   ============================================================ */
const IssueFormHistory = () => {
  const toast = useToast();

  const [rows, setRows] = useState([]);
  const [globalTotals, setGlobalTotals] = useState({ forms: 0, lines: 0, amount: 0 });
  
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const [formTypeFilter, setFormTypeFilter] = useState('All');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');

  /* ---- datetime-local inputs (string form: YYYY-MM-DDTHH:MM) ---- */
  const [startInput, setStartInput] = useState('');
  const [endInput, setEndInput]     = useState('');

  /* ---- Collapse state ---- */
  const [expandedShifts, setExpandedShifts] = useState(() => new Map());
  const [page, setPage] = useState(1);

  const [detailId, setDetailId] = useState(null);

  /* ---------- Debounce search ---------- */
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  /* ---------- Load ---------- */
  const load = useCallback(
    async ({ silent = false } = {}) => {
      if (silent) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const res = await issueFormApi.list({
          form_type:  formTypeFilter === 'All' ? undefined : formTypeFilter,
          start_date: startInput || undefined,
          end_date:   endInput   || undefined,
          page:  1,
          // Fetch all grouped data. The backend returns the global totals
          // so the stat cards remain 100% accurate regardless of pagination.
          limit: 5000,
        });

        if (res.ok) {
          setRows(Array.isArray(res.data) ? res.data : []);
          
          // IMPORTANT: Use the backend's global totals for the stat cards.
          // This ensures the numbers reflect the ENTIRE filtered database,
          // not just the current page.
          if (res.totals) {
            setGlobalTotals({
              forms: res.totals.forms || 0,
              lines: res.totals.lines || 0,
              amount: res.totals.amount || 0
            });
          }
        } else {
          setError(res?.data?.message || 'Failed to load issue forms.');
          setRows([]);
        }
      } catch (err) {
        console.error('Issue form history load error:', err);
        setError(err?.message || 'Failed to load issue forms.');
        setRows([]);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [formTypeFilter, startInput, endInput]
  );

  useEffect(() => { load(); }, [load]);

  /* ============================================================
     Client-side search over the loaded set
     ============================================================ */
  const searched = useMemo(() => {
    if (!debounced) return rows;
    const q = debounced.toLowerCase();
    return rows.filter((r) =>
      String(r.form_series_no      || '').toLowerCase().includes(q) ||
      String(r.form_document_code  || '').toLowerCase().includes(q) ||
      String(r.form_type           || '').toLowerCase().includes(q) ||
      String(r.warehouse_code      || '').toLowerCase().includes(q) ||
      String(r.issued_by_username  || '').toLowerCase().includes(q)
    );
  }, [rows, debounced]);

  /* ============================================================
     Group by shift
     ============================================================ */
  const groups = useMemo(() => {
    const byShift = new Map();

    for (const r of searched) {
      const sid = Number(r.shift_id);
      if (!byShift.has(sid)) {
        byShift.set(sid, {
          shift_id: sid,
          shift_status: r.shift_status || 'Unknown',
          warehouse_code: r.warehouse_code || null,
          forms: [],
        });
      }
      byShift.get(sid).forms.push(r);
    }

    const arr = Array.from(byShift.values());

    for (const g of arr) {
      g.forms.sort((a, b) => new Date(a.issued_at) - new Date(b.issued_at));
      g.total_forms  = g.forms.length;
      g.total_lines  = g.forms.reduce((s, f) => s + (Number(f.line_count)   || 0), 0);
      g.total_amount = g.forms.reduce((s, f) => s + (Number(f.total_amount) || 0), 0);
      g.newest_at = g.forms[g.forms.length - 1].issued_at;
      g.oldest_at = g.forms[0].issued_at;
    }

    // Newest group first
    arr.sort((a, b) => new Date(b.newest_at) - new Date(a.newest_at));

    // Open groups first, then ended groups
    arr.sort((a, b) => {
      const aOpen = !isEndedStatus(a.shift_status);
      const bOpen = !isEndedStatus(b.shift_status);
      if (aOpen !== bOpen) return aOpen ? -1 : 1;
      return 0;
    });

    return arr;
  }, [searched]);

  /* ============================================================
     Pagination logic
     ============================================================ */
  const totalGroupPages = Math.max(1, Math.ceil(groups.length / SHIFTS_PER_PAGE));
  const paginatedGroups = useMemo(() => {
    const start = (page - 1) * SHIFTS_PER_PAGE;
    return groups.slice(start, start + SHIFTS_PER_PAGE);
  }, [groups, page]);

  useEffect(() => {
    if (page > totalGroupPages) setPage(totalGroupPages);
  }, [page, totalGroupPages]);

  const goToPage = (p) => {
    const next = Math.max(1, Math.min(totalGroupPages, p));
    if (next !== page) setPage(next);
  };

  const buildPageList = (current, total) => {
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
    const pages = [1];
    if (current > 3) pages.push('…');
    const start = Math.max(2, current - 1);
    const end = Math.min(total - 1, current + 1);
    for (let i = start; i <= end; i++) pages.push(i);
    if (current < total - 2) pages.push('…');
    pages.push(total);
    return pages;
  };

  const pageList = useMemo(() => buildPageList(page, totalGroupPages), [page, totalGroupPages]);
  const showingStart = groups.length === 0 ? 0 : (page - 1) * SHIFTS_PER_PAGE + 1;
  const showingEnd = Math.min(page * SHIFTS_PER_PAGE, groups.length);

  /* ============================================================
     Initial expand state — open shifts expanded, ended collapsed
     ============================================================ */
  useEffect(() => {
    setExpandedShifts((prev) => {
      const next = new Map(prev);
      for (const g of paginatedGroups) {
        if (!next.has(g.shift_id)) {
          next.set(g.shift_id, !isEndedStatus(g.shift_status));
        }
      }
      return next;
    });
  }, [paginatedGroups]);

  const isGroupExpanded = (sid) => expandedShifts.get(sid) === true;

  const toggleGroup = useCallback((sid) => {
    setExpandedShifts((prev) => {
      const next = new Map(prev);
      next.set(sid, !(next.get(sid) === true));
      return next;
    });
  }, []);

  /* ============================================================
     Collapse all / Expand all — affects ENDED groups on current page
     ============================================================ */
  const endedGroups = useMemo(
    () => paginatedGroups.filter((g) => isEndedStatus(g.shift_status)),
    [paginatedGroups]
  );

  const allEndedCollapsed =
    endedGroups.length > 0 &&
    endedGroups.every((g) => !isGroupExpanded(g.shift_id));

  const anyEndedExpanded =
    endedGroups.some((g) => isGroupExpanded(g.shift_id));

  const toggleAllEnded = useCallback(() => {
    setExpandedShifts((prev) => {
      const next = new Map(prev);
      const targetExpanded = allEndedCollapsed;
      for (const g of endedGroups) {
        next.set(g.shift_id, targetExpanded);
      }
      return next;
    });
  }, [allEndedCollapsed, endedGroups]);

  /* ============================================================
     Quick range shortcuts
     ============================================================ */
  const applyQuickRange = useCallback((preset) => {
    const now = new Date();
    if (preset === 'today') {
      setStartInput(toLocalInput(startOfToday()));
      setEndInput(toLocalInput(endOfToday()));
    } else if (preset === '24h') {
      const d = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      setStartInput(toLocalInput(d));
      setEndInput(toLocalInput(now));
    } else if (preset === '7d') {
      const d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      setStartInput(toLocalInput(d));
      setEndInput(toLocalInput(now));
    } else if (preset === 'month') {
      const first = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0);
      setStartInput(toLocalInput(first));
      setEndInput(toLocalInput(now));
    } else if (preset === 'clear') {
      setStartInput('');
      setEndInput('');
    }
  }, []);

  const hasActiveFilters =
    formTypeFilter !== 'All' ||
    Boolean(startInput) ||
    Boolean(endInput) ||
    Boolean(debounced);

  const clearAllFilters = () => {
    setFormTypeFilter('All');
    setStartInput('');
    setEndInput('');
    setSearch('');
  };

  /* ============================================================
     Render
     ============================================================ */
  return (
    <div className="ug-section">
      {/* ---------- Header ---------- */}
      <header className="ug-header">
        <div className="ug-header-left">
          <div className="ug-header-icon"><FiFileText /></div>
          <div className="ug-header-info">
            <h2 className="ug-header-title">Issue Form History</h2>
            <div className="ug-header-sub">
              Every MER / MSR / MSF / MSB form saved by this warehouse, grouped by shift.
            </div>
          </div>
        </div>
        <div className="ug-header-actions">
          {endedGroups.length > 0 && (
            <button
              type="button"
              className="ug-btn ug-btn--secondary ug-btn--sm"
              onClick={toggleAllEnded}
              title={allEndedCollapsed ? 'Expand every ended shift' : 'Collapse every ended shift'}
            >
              {allEndedCollapsed ? <FiChevronDown /> : <FiChevronUp />}
              <span>{allEndedCollapsed ? 'Expand all' : 'Collapse all'}</span>
            </button>
          )}
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
      </header>

      {/* ---------- Filter chips ---------- */}
      <div className="ugifh-chips" role="tablist" aria-label="Filter by form type">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            role="tab"
            aria-selected={formTypeFilter === f.value}
            className={`ugifh-chip ${formTypeFilter === f.value ? 'is-active' : ''}`}
            onClick={() => setFormTypeFilter(f.value)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* ---------- Date + time range filter ---------- */}
      <div className="ugifh-daterow">
        <div className="ugifh-date-field">
          <label className="ugifh-date-label" htmlFor="ugifh-start">
            <FiCalendar aria-hidden="true" />
            <span>From</span>
          </label>
          <input
            id="ugifh-start"
            type="datetime-local"
            className="ugifh-date-input"
            value={startInput}
            max={endInput || undefined}
            onChange={(e) => setStartInput(e.target.value)}
          />
        </div>

        <div className="ugifh-date-field">
          <label className="ugifh-date-label" htmlFor="ugifh-end">
            <FiCalendar aria-hidden="true" />
            <span>To</span>
          </label>
          <input
            id="ugifh-end"
            type="datetime-local"
            className="ugifh-date-input"
            value={endInput}
            min={startInput || undefined}
            onChange={(e) => setEndInput(e.target.value)}
          />
        </div>

        {hasActiveFilters && (
          <button
            type="button"
            className="ugifh-clear"
            onClick={clearAllFilters}
            title="Clear all filters"
          >
            <FiX /> <span>Clear filters</span>
          </button>
        )}
      </div>

      {/* ---------- Quick range shortcuts ---------- */}
      <div className="ugifh-quick">
        <span className="ugifh-quick-lbl">Quick range:</span>
        <button type="button" className="ugifh-quick-btn" onClick={() => applyQuickRange('today')}>Today</button>
        <button type="button" className="ugifh-quick-btn" onClick={() => applyQuickRange('24h')}>Last 24h</button>
        <button type="button" className="ugifh-quick-btn" onClick={() => applyQuickRange('7d')}>Last 7 days</button>
        <button type="button" className="ugifh-quick-btn" onClick={() => applyQuickRange('month')}>This month</button>
        <button type="button" className="ugifh-quick-btn ugifh-quick-btn--ghost" onClick={() => applyQuickRange('clear')}>Reset</button>
      </div>

      {/* ---------- Stats strip (Global Totals from Backend) ---------- */}
      {!loading && !error && groups.length > 0 && (
        <div className="ugifh-stats">
          <div className="ugifh-stat">
            <div className="ugifh-stat-icon ugifh-stat-icon--count"><FiHash /></div>
            <div className="ugifh-stat-info">
              <span className="ugifh-stat-value">{fmtInt(globalTotals.forms)}</span>
              <span className="ugifh-stat-label">Total Forms</span>
            </div>
          </div>
          <div className="ugifh-stat">
            <div className="ugifh-stat-icon ugifh-stat-icon--lines"><FiFileText /></div>
            <div className="ugifh-stat-info">
              <span className="ugifh-stat-value">{fmtInt(globalTotals.lines)}</span>
              <span className="ugifh-stat-label">Total Lines</span>
            </div>
          </div>
          <div className="ugifh-stat">
            <div className="ugifh-stat-icon ugifh-stat-icon--amount"><FiDollarSign /></div>
            <div className="ugifh-stat-info">
              <span className="ugifh-stat-value">{fmtCur(globalTotals.amount)}</span>
              <span className="ugifh-stat-label">Total Amount</span>
            </div>
          </div>
        </div>
      )}

      {/* ---------- Search toolbar ---------- */}
      <div className="ughist-toolbar">
        <div className="ughist-search">
          <FiSearch />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by form no., type, warehouse, or handler…"
            aria-label="Search issue form history"
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
          <span>Loading issue forms…</span>
        </div>
      )}

      {/* ---------- Empty ---------- */}
      {!loading && !error && groups.length === 0 && (
        <div className="ug-card">
          <div className="ug-empty">
            <FiInbox />
            <div className="ug-empty-title">
              {hasActiveFilters ? 'No forms match your filters' : 'No issue forms yet'}
            </div>
            <div className="ug-empty-sub">
              {hasActiveFilters
                ? 'Try a different search term, type, or time range.'
                : 'Saved issue forms will appear here.'}
            </div>
          </div>
        </div>
      )}

      {/* ---------- Shift groups (Paginated) ---------- */}
      {!loading && !error && paginatedGroups.map((g) => {
        const expanded = isGroupExpanded(g.shift_id);
        const ended = isEndedStatus(g.shift_status);

        return (
          <section
            key={g.shift_id}
            className={`ugifh-group ${expanded ? 'is-open' : 'is-closed'} ${ended ? 'is-ended' : 'is-open-shift'}`}
          >
            <button
              type="button"
              className="ugifh-group-head"
              onClick={() => toggleGroup(g.shift_id)}
              aria-expanded={expanded}
            >
              <span className="ugifh-group-icon" aria-hidden="true">
                {expanded ? <FiFolder /> : <FiLayers />}
              </span>

              <span className="ugifh-group-main">
                <span className="ugifh-group-title">
                  Shift #{g.shift_id}
                  {g.warehouse_code ? <span className="ugifh-group-wh"> · {g.warehouse_code}</span> : null}
                </span>
                <span className="ugifh-group-sub">
                  {fmtDateTime(g.oldest_at)}
                  {g.oldest_at && g.newest_at && g.oldest_at !== g.newest_at
                    ? ` → ${fmtTime(g.newest_at)}`
                    : ''}
                </span>
              </span>

              <span className={`ugifh-group-pill ${shiftPillClass(g.shift_status)}`}>
                <span className="ug-pill-dot" />
                {g.shift_status}
              </span>

              <span className="ugifh-group-metric" title="Forms in this shift">
                <FiFileText aria-hidden="true" />
                {fmtInt(g.total_forms)}
              </span>
              <span className="ugifh-group-metric" title="Total lines">
                <FiHash aria-hidden="true" />
                {fmtInt(g.total_lines)}
              </span>
              <span className="ugifh-group-metric ugifh-group-metric--cur" title="Total amount">
                {fmtCur(g.total_amount)}
              </span>

              <FiChevronDown
                className={`ugifh-group-chev ${expanded ? 'is-open' : ''}`}
                aria-hidden="true"
              />
            </button>

            {expanded && (
              <div className="ugifh-group-body">
                <div className="ughist-table-wrap">
                  <table className="ughist-table">
                    <thead>
                      <tr>
                        <th scope="col">Form No.</th>
                        <th scope="col">Type</th>
                        <th scope="col">Document</th>
                        <th scope="col">Issued at</th>
                        <th scope="col">Handler</th>
                        <th scope="col" className="ughist-num">Lines</th>
                        <th scope="col" className="ughist-num">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.forms.map((r) => (
                        <tr
                          key={r.form_id}
                          onClick={() => setDetailId(r.form_id)}
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              setDetailId(r.form_id);
                            }
                          }}
                          className="ughist-row"
                          title="Click to view form"
                        >
                          <td><span className="ughist-uid">{r.form_series_no || '—'}</span></td>
                          <td>
                            <span className={`ugifh-type ugifh-type--${TYPE_TONE[r.form_type] || 'slate'}`}>
                              {r.form_type}
                            </span>
                          </td>
                          <td>
                            <span className="ugifh-doc">{r.form_document_code || '—'}</span>
                            {r.form_revision && (
                              <span className="ugifh-rev">rev {r.form_revision}</span>
                            )}
                          </td>
                          <td>{fmtDateTime(r.issued_at)}</td>
                          <td>
                            <div className="ugifh-user">
                              <span className="ugifh-user-name">{r.issued_by_username || '—'}</span>
                              {r.issued_by_position && (
                                <span className="ugifh-user-pos">{r.issued_by_position}</span>
                              )}
                            </div>
                          </td>
                          <td className="ughist-num">{fmtInt(r.line_count)}</td>
                          <td className="ughist-num ughist-num--cur">{fmtCur(r.total_amount || 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="ughist-cardlist">
                  {g.forms.map((r) => (
                    <article
                      key={`m-${r.form_id}`}
                      className="ughist-card"
                      onClick={() => setDetailId(r.form_id)}
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setDetailId(r.form_id);
                        }
                      }}
                    >
                      <header className="ughist-card-head">
                        <span className="ughist-uid">{r.form_series_no || '—'}</span>
                        <span className={`ugifh-type ugifh-type--${TYPE_TONE[r.form_type] || 'slate'}`}>
                          {r.form_type}
                        </span>
                      </header>
                      <dl className="ughist-card-grid">
                        <div><dt>Issued at</dt><dd>{fmtDateTime(r.issued_at)}</dd></div>
                        <div><dt>Handler</dt><dd>{r.issued_by_username || '—'}</dd></div>
                        <div><dt>Document</dt><dd>{r.form_document_code || '—'}</dd></div>
                        <div><dt>Lines</dt><dd>{fmtInt(r.line_count)}</dd></div>
                        <div style={{ gridColumn: '1 / -1' }}>
                          <dt>Amount</dt>
                          <dd className="ughist-num--cur">{fmtCur(r.total_amount || 0)}</dd>
                        </div>
                      </dl>
                    </article>
                  ))}
                </div>
              </div>
            )}
          </section>
        );
      })}

      {/* ---------- Pagination ---------- */}
      {!loading && !error && totalGroupPages > 1 && (
        <nav className="ughist-pagination" aria-label="Shift history pagination">
          <div className="ughist-pagination-info">
            Showing <strong>{showingStart}</strong>–<strong>{showingEnd}</strong> of{' '}
            <strong>{fmtInt(groups.length)}</strong> shift{groups.length === 1 ? '' : 's'}
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
              disabled={page >= totalGroupPages}
              aria-label="Next page"
            ><FiChevronRight /></button>
            <button
              type="button" className="ughist-page-btn"
              onClick={() => goToPage(totalGroupPages)}
              disabled={page >= totalGroupPages}
              aria-label="Last page"
            ><FiChevronsRight /></button>
          </div>
        </nav>
      )}

      {/* ---------- Detail modal ---------- */}
      {detailId && (
        <IssueFormDetailModal
          formId={detailId}
          onClose={() => setDetailId(null)}
        />
      )}

      <style>{historyCss}</style>
    </div>
  );
};

export default IssueFormHistory;

/* ============================================================
   Scoped CSS — `ugifh-` prefix. No backticks inside this string.
   ============================================================ */
const historyCss = `
.ugifh-chips {
  display: inline-flex;
  gap: 4px;
  padding: 4px;
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  flex-wrap: wrap;
}
.ugifh-chip {
  min-height: 34px;
  padding: 6px 16px;
  border: none;
  border-radius: 7px;
  background: transparent;
  font-family: inherit;
  font-size: 12.5px;
  font-weight: 800;
  letter-spacing: 0.04em;
  color: #475569;
  cursor: pointer;
  transition: background 140ms ease, color 140ms ease, box-shadow 140ms ease;
}
.ugifh-chip:hover:not(.is-active) {
  color: #0f172a;
  background: rgba(255, 255, 255, 0.6);
}
.ugifh-chip.is-active {
  background: #ffffff;
  color: #007a72;
  box-shadow:
    0 1px 3px rgba(15, 23, 42, 0.08),
    0 0 0 1px rgba(0, 184, 176, 0.35);
}
.ugifh-chip:focus-visible {
  outline: 2px solid #00b8b0;
  outline-offset: 2px;
}

.ugifh-daterow {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 10px;
  padding: 10px 12px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
}
.ugifh-date-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  flex: 1 1 200px;
  max-width: 280px;
}
.ugifh-date-label {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #475569;
}
.ugifh-date-label svg {
  width: 12px;
  height: 12px;
  stroke-width: 2.4;
  color: #0f766e;
}
.ugifh-date-input {
  width: 100%;
  min-height: 36px;
  padding: 7px 10px;
  border: 1.5px solid #cbd5e1;
  border-radius: 8px;
  background: #ffffff;
  font-family: inherit;
  font-size: 13px;
  color: #0f172a;
  outline: none;
  box-sizing: border-box;
  transition: border-color 140ms ease, box-shadow 140ms ease, background 140ms ease;
}
.ugifh-date-input:hover:not(:disabled):not(:focus) {
  border-color: #94a3b8;
  background: #f8fafc;
}
.ugifh-date-input:focus {
  border-color: #00b8b0;
  background: #ffffff;
  box-shadow: 0 0 0 3px rgba(0, 210, 200, 0.18);
}
.ugifh-clear {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 36px;
  padding: 7px 14px;
  border: 1.5px solid #fecaca;
  border-radius: 8px;
  background: #ffffff;
  color: #b91c1c;
  font-family: inherit;
  font-size: 12.5px;
  font-weight: 700;
  cursor: pointer;
  transition: background 140ms ease, border-color 140ms ease, color 140ms ease;
}
.ugifh-clear:hover {
  background: #fef2f2;
  border-color: #dc2626;
}
.ugifh-clear:focus-visible {
  outline: 2px solid #dc2626;
  outline-offset: 2px;
}
.ugifh-clear svg {
  width: 13px;
  height: 13px;
  stroke-width: 2.4;
}

.ugifh-quick {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.ugifh-quick-lbl {
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #64748b;
  margin-right: 2px;
}
.ugifh-quick-btn {
  min-height: 30px;
  padding: 5px 12px;
  border: 1px solid #cbd5e1;
  border-radius: 999px;
  background: #ffffff;
  font-family: inherit;
  font-size: 12px;
  font-weight: 700;
  color: #334155;
  cursor: pointer;
  transition: background 140ms ease, border-color 140ms ease, color 140ms ease;
}
.ugifh-quick-btn:hover {
  background: #f0fdfa;
  border-color: #00b8b0;
  color: #007a72;
}
.ugifh-quick-btn:focus-visible {
  outline: 2px solid #00b8b0;
  outline-offset: 2px;
}
.ugifh-quick-btn--ghost {
  border-style: dashed;
  color: #64748b;
}
.ugifh-quick-btn--ghost:hover {
  border-color: #dc2626;
  background: #fef2f2;
  color: #b91c1c;
}

.ugifh-stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}
.ugifh-stat {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  background: #ffffff;
  border: 1px solid rgba(15, 23, 42, 0.06);
  border-radius: 12px;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
}
.ugifh-stat-icon {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #ffffff;
  flex-shrink: 0;
}
.ugifh-stat-icon svg { width: 18px; height: 18px; stroke-width: 2.2; }
.ugifh-stat-icon--count {
  background: linear-gradient(135deg, #818cf8 0%, #4338ca 100%);
  box-shadow: 0 4px 12px rgba(99, 102, 241, 0.28);
}
.ugifh-stat-icon--lines {
  background: linear-gradient(135deg, #00e0d4 0%, #008a82 100%);
  box-shadow: 0 4px 12px rgba(0, 210, 200, 0.28);
}
.ugifh-stat-icon--amount {
  background: linear-gradient(135deg, #34d399 0%, #047857 100%);
  box-shadow: 0 4px 12px rgba(16, 185, 129, 0.28);
}
.ugifh-stat-info { min-width: 0; flex: 1; }
.ugifh-stat-value {
  display: block;
  font-size: 18px;
  font-weight: 800;
  color: #0f172a;
  line-height: 1.1;
  letter-spacing: -0.01em;
  font-variant-numeric: tabular-nums;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ugifh-stat-label {
  display: block;
  font-size: 10.5px;
  font-weight: 700;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-top: 3px;
}

.ugifh-group {
  display: flex;
  flex-direction: column;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  overflow: hidden;
  background: #ffffff;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
  transition: border-color 140ms ease, box-shadow 140ms ease;
}
.ugifh-group.is-open-shift {
  border-color: #99f6e4;
}
.ugifh-group.is-ended {
  border-color: #e2e8f0;
}
.ugifh-group.is-open {
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.06);
}

.ugifh-group-head {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 12px 14px;
  border: none;
  background: linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%);
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  color: #0f172a;
  transition: background 140ms ease;
  flex-wrap: wrap;
  row-gap: 8px;
}
.ugifh-group.is-open-shift .ugifh-group-head {
  background: linear-gradient(180deg, #ecfdf5 0%, #f0fdfa 100%);
}
.ugifh-group-head:hover {
  background: #f0fdfa;
}
.ugifh-group.is-open-shift .ugifh-group-head:hover {
  background: #ecfdf5;
}
.ugifh-group-head:focus-visible {
  outline: 2px solid #00b8b0;
  outline-offset: -2px;
}

.ugifh-group-icon {
  width: 30px;
  height: 30px;
  border-radius: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #ffffff;
  flex-shrink: 0;
  background: linear-gradient(135deg, #94a3b8 0%, #475569 100%);
  box-shadow: 0 3px 10px rgba(71, 85, 105, 0.24);
}
.ugifh-group.is-open-shift .ugifh-group-icon {
  background: linear-gradient(135deg, #34d399 0%, #047857 100%);
  box-shadow: 0 3px 10px rgba(16, 185, 129, 0.28);
}
.ugifh-group-icon svg { width: 15px; height: 15px; stroke-width: 2.4; }

.ugifh-group-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1 1 180px;
}
.ugifh-group-title {
  font-size: 13.5px;
  font-weight: 800;
  letter-spacing: 0.01em;
  color: #0f172a;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ugifh-group-wh {
  font-weight: 700;
  color: #0f766e;
}
.ugifh-group-sub {
  font-size: 11px;
  color: #64748b;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ugifh-group-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 10.5px;
  font-weight: 800;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  border: 1px solid transparent;
  white-space: nowrap;
  flex-shrink: 0;
}

.ugifh-group-metric {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.75);
  border: 1px solid #cbd5e1;
  font-size: 11.5px;
  font-weight: 700;
  color: #334155;
  white-space: nowrap;
  flex-shrink: 0;
}
.ugifh-group-metric svg {
  width: 11px;
  height: 11px;
  stroke-width: 2.4;
  color: #0f766e;
}
.ugifh-group-metric--cur {
  color: #047857;
  border-color: #86efac;
  background: #ecfdf5;
  font-variant-numeric: tabular-nums;
}

.ugifh-group-chev {
  width: 16px;
  height: 16px;
  color: #64748b;
  stroke-width: 2.6;
  transition: transform 200ms ease;
  flex-shrink: 0;
  margin-left: 4px;
}
.ugifh-group-chev.is-open {
  transform: rotate(180deg);
  color: #0f766e;
}

.ugifh-group-body {
  display: flex;
  flex-direction: column;
  border-top: 1px solid #e2e8f0;
  background: #ffffff;
  animation: ugifhGroupFade 200ms ease-out;
}
@keyframes ugifhGroupFade {
  from { opacity: 0; transform: translateY(-4px); }
  to   { opacity: 1; transform: translateY(0); }
}

.ugifh-type {
  display: inline-block;
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 10.5px;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  white-space: nowrap;
}
.ugifh-type--amber {
  background: #fef3c7;
  color: #92400e;
  border: 1px solid #fcd34d;
}
.ugifh-type--teal {
  background: #f0fdfa;
  color: #0f766e;
  border: 1px solid #99f6e4;
}
.ugifh-type--blue {
  background: #eff6ff;
  color: #1e40af;
  border: 1px solid #bfdbfe;
}
.ugifh-type--slate {
  background: #f1f5f9;
  color: #475569;
  border: 1px solid #cbd5e1;
}

.ugifh-doc {
  display: inline-block;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-size: 11.5px;
  font-weight: 700;
  color: #334155;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 5px;
  padding: 1px 7px;
}
.ugifh-rev {
  display: inline-block;
  font-size: 10.5px;
  font-weight: 700;
  color: #64748b;
  margin-left: 6px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.ugifh-user { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.ugifh-user-name { font-weight: 700; font-size: 12.5px; color: #0f172a; }
.ugifh-user-pos  { font-size: 11px; color: #64748b; }

@media (max-width: 900px) {
  .ugifh-daterow {
    gap: 8px;
    padding: 10px;
  }
  .ugifh-date-field {
    flex: 1 1 160px;
    max-width: none;
  }
  .ugifh-clear {
    flex: 0 0 auto;
    margin-left: auto;
  }
}

@media (max-width: 720px) {
  .ugifh-stats { grid-template-columns: 1fr; gap: 8px; }
  .ugifh-stat  { padding: 10px 12px; }
  .ugifh-stat-icon { width: 36px; height: 36px; border-radius: 9px; }
  .ugifh-stat-icon svg { width: 16px; height: 16px; }
  .ugifh-stat-value { font-size: 16px; }

  .ugifh-group-head {
    padding: 10px 12px;
    row-gap: 6px;
  }
  .ugifh-group-main { flex: 1 1 100%; order: -1; }
  .ugifh-group-icon { order: -2; }
  .ugifh-group-chev { order: 99; }
}

@media (max-width: 480px) {
  .ugifh-chip {
    flex: 1 1 auto;
    padding: 6px 12px;
    font-size: 11.5px;
  }
  .ugifh-daterow {
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
  }
  .ugifh-date-field {
    flex: 1 1 auto;
    max-width: none;
  }
  .ugifh-date-input {
    min-height: 42px;
    font-size: 16px;
  }
  .ugifh-clear {
    width: 100%;
    min-height: 42px;
    margin-left: 0;
  }
  .ugifh-quick { gap: 4px; }
  .ugifh-quick-lbl { flex: 1 1 100%; }
  .ugifh-quick-btn {
    flex: 1 1 auto;
    min-height: 32px;
    font-size: 11.5px;
    padding: 5px 10px;
  }
  .ugifh-group-pill { font-size: 10px; padding: 2px 8px; }
  .ugifh-group-metric { font-size: 11px; padding: 3px 8px; }
  .ugifh-group-metric--cur { font-size: 11px; }
}

@media (max-width: 360px) {
  .ugifh-date-input { min-height: 40px; font-size: 15px; }
  .ugifh-clear span { display: none; }
  .ugifh-clear { padding: 8px 10px; }
  .ugifh-group-title { font-size: 12.5px; }
  .ugifh-group-metric svg { display: none; }
}

@media (min-width: 1921px) {
  .ugifh-chip { font-size: 13.5px; min-height: 38px; padding: 8px 20px; }
  .ugifh-stat { padding: 14px 18px; }
  .ugifh-stat-icon { width: 46px; height: 46px; }
  .ugifh-stat-value { font-size: 20px; }
  .ugifh-stat-label { font-size: 11.5px; }
  .ugifh-date-field { max-width: 320px; }
  .ugifh-date-input { min-height: 40px; font-size: 14px; }
  .ugifh-date-label { font-size: 12px; }
  .ugifh-clear { min-height: 40px; font-size: 13.5px; }
  .ugifh-quick-btn { font-size: 13px; min-height: 34px; padding: 7px 16px; }
  .ugifh-group-title { font-size: 15px; }
  .ugifh-group-icon { width: 34px; height: 34px; }
  .ugifh-group-icon svg { width: 17px; height: 17px; }
}

@media (prefers-reduced-motion: reduce) {
  .ugifh-chip,
  .ugifh-stat,
  .ugifh-date-input,
  .ugifh-clear,
  .ugifh-quick-btn,
  .ugifh-group,
  .ugifh-group-head,
  .ugifh-group-chev { transition: none !important; }
  .ugifh-group-body { animation: none !important; }
}
`;