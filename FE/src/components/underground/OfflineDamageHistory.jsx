// src/components/underground/OfflineDamageHistory.jsx
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FiAlertTriangle,
  FiSearch,
  FiRefreshCw,
  FiCalendar,
  FiInbox,
  FiLoader,
  FiChevronLeft,
  FiChevronRight,
  FiChevronsLeft,
  FiChevronsRight,
} from 'react-icons/fi';
import { offlineFeaturesApi } from '../../services/api';
import { useToast } from '../shared/ToastProvider';
import { undergroundCss } from './undergroundStyles';

const intFmt = new Intl.NumberFormat('en-PH');
const fmtInt = (n) => intFmt.format(Number(n) || 0);

const fmtDateTime = (v) => {
  if (!v) return '—';
  try {
    const d = new Date(v);
    return d.toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' });
  } catch { return '—'; }
};

// Format the quantity to show the breakdown
const fmtQtyBreakdown = (row) => {
  const q = Number(row.qty) || 0;
  const b = Number(row.qty_boxes) || 0;
  const l = Number(row.qty_loose_pieces) || 0;
  
  if (b > 0 || l > 0) {
    const parts = [];
    if (b > 0) parts.push(`${fmtInt(b)} Box${b === 1 ? '' : 'es'}`);
    if (l > 0) parts.push(`${fmtInt(l)} Pc${l === 1 ? '' : 's'}`);
    return `-${parts.join(', ')}`;
  }
  return `-${fmtInt(q)}`;
};

const PAGE_SIZE = 30;

const OfflineDamageHistory = () => {
  const toast = useToast();

  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const [search, setSearch] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const load = useCallback(async ({ silent = false } = {}) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const res = await offlineFeaturesApi.getDamageHistory({
        search: search.trim() || undefined,
        start_date: startDate || undefined,
        end_date: endDate || undefined,
        page,
      });

      if (res.ok) {
        setRows(Array.isArray(res.data) ? res.data : []);
        setTotal(Number(res.total) || 0);
        setTotalPages(Math.max(Number(res.totalPages) || 1, 1));
      } else {
        setError(res?.data?.message || 'Failed to load damage history.');
        setRows([]);
      }
    } catch (err) {
      console.error('Damage history load error:', err);
      setError('Network error while loading history.');
      setRows([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [page, search, startDate, endDate]);

  useEffect(() => {
    load();
  }, [load]);

  // Reset to page 1 when filters change
  useEffect(() => {
    setPage(1);
  }, [search, startDate, endDate]);

  const goToPage = (p) => {
    const next = Math.max(1, Math.min(totalPages, p));
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

  const pageList = useMemo(() => buildPageList(page, totalPages), [page, totalPages]);
  const showingStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const showingEnd = Math.min(page * PAGE_SIZE, total);

  return (
    <div className="ug-section">
      <style>{undergroundCss}</style>
      <style>{historyCss}</style>

      {/* Header */}
      <header className="ug-header">
        <div className="ug-header-left">
          <div className="ug-header-icon" style={{ background: 'linear-gradient(135deg, #f97316 0%, #dc2626 100%)' }}>
            <FiAlertTriangle />
          </div>
          <div className="ug-header-info">
            <h2 className="ug-header-title">Damage History</h2>
            <div className="ug-header-sub">
              Record of all items manually written off as damaged.
            </div>
          </div>
        </div>
      </header>

      {/* Toolbar */}
      <div className="ughist-toolbar">
        <div className="ughist-search">
          <FiSearch />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by item code, locator, or reason…"
          />
        </div>

        <div className="odh-date-group">
          <div className="odh-date-input">
            <FiCalendar />
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} title="Start Date" />
          </div>
          <span className="odh-date-sep">to</span>
          <div className="odh-date-input">
            <FiCalendar />
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} title="End Date" />
          </div>
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

      {error && (
        <div className="ug-error" role="alert">
          <FiAlertTriangle />
          <span>{error}</span>
          <button type="button" onClick={() => load()}>Try again</button>
        </div>
      )}

      {loading && (
        <div className="ug-loading">
          <FiLoader className="ug-spin" />
          <span>Loading history…</span>
        </div>
      )}

      {!loading && !error && rows.length === 0 && (
        <div className="ug-card">
          <div className="ug-empty">
            <FiInbox />
            <div className="ug-empty-title">No damage records found</div>
            <div className="ug-empty-sub">
              {search || startDate || endDate
                ? 'Try adjusting your search or date filters.'
                : 'No items have been written off yet.'}
            </div>
          </div>
        </div>
      )}

      {!loading && !error && rows.length > 0 && (
        <>
          {/* Desktop Table */}
          <div className="ughist-table-wrap">
            <table className="ughist-table">
              <thead>
                <tr>
                  <th>Date & Time</th>
                  <th>Item</th>
                  <th>Locator</th>
                  <th className="ughist-num">Qty Written Off</th>
                  <th>Reason</th>
                  <th>Actor</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.writeoff_id} className="ughist-row">
                    <td>{fmtDateTime(r.acted_at)}</td>
                    <td>
                      <div className="ughist-uid">{r.item_code}</div>
                      {r.item_name && <div style={{ fontSize: 11, color: '#64748b' }}>{r.item_name}</div>}
                    </td>
                    <td>{r.locator_code || '—'}</td>
                    <td className="ughist-num" style={{ color: '#dc2626', fontWeight: 800 }}>
                      {fmtQtyBreakdown(r)}
                    </td>
                    <td style={{ maxWidth: 300, whiteSpace: 'normal', fontSize: 12.5 }}>
                      {r.reason || '—'}
                    </td>
                    <td>{r.actor}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile Cards */}
          <div className="ughist-cardlist">
            {rows.map((r) => (
              <article key={`m-${r.writeoff_id}`} className="ughist-card">
                <header className="ughist-card-head">
                  <span className="ughist-uid">{r.item_code}</span>
                  <span style={{ fontWeight: 800, color: '#dc2626' }}>{fmtQtyBreakdown(r)}</span>
                </header>
                <div style={{ fontSize: 12, color: '#475569', marginBottom: 8 }}>{r.item_name || '—'}</div>
                <dl className="ughist-card-grid">
                  <div><dt>Locator</dt><dd>{r.locator_code || '—'}</dd></div>
                  <div><dt>Date</dt><dd>{fmtDateTime(r.acted_at)}</dd></div>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <dt>Reason</dt>
                    <dd style={{ fontWeight: 500, fontSize: 11.5 }}>{r.reason || '—'}</dd>
                  </div>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <dt>Recorded By</dt>
                    <dd>{r.actor}</dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <nav className="ughist-pagination">
              <div className="ughist-pagination-info">
                Showing <strong>{showingStart}</strong>–<strong>{showingEnd}</strong> of <strong>{fmtInt(total)}</strong> records
              </div>
              <div className="ughist-pagination-controls">
                <button type="button" className="ughist-page-btn" onClick={() => goToPage(1)} disabled={page <= 1}><FiChevronsLeft /></button>
                <button type="button" className="ughist-page-btn" onClick={() => goToPage(page - 1)} disabled={page <= 1}><FiChevronLeft /></button>
                {pageList.map((p, i) => p === '…' ? (
                  <span key={`e${i}`} className="ughist-page-ellipsis">…</span>
                ) : (
                  <button key={p} type="button" className={`ughist-page-btn ${p === page ? 'is-active' : ''}`} onClick={() => goToPage(p)}>{p}</button>
                ))}
                <button type="button" className="ughist-page-btn" onClick={() => goToPage(page + 1)} disabled={page >= totalPages}><FiChevronRight /></button>
                <button type="button" className="ughist-page-btn" onClick={() => goToPage(totalPages)} disabled={page >= totalPages}><FiChevronsRight /></button>
              </div>
            </nav>
          )}
        </>
      )}
    </div>
  );
};

const historyCss = `
.odh-date-group {
  display: flex;
  align-items: center;
  gap: 8px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 4px 10px;
  flex: 1 1 auto;
  max-width: max-content;
}

.odh-date-input {
  display: flex;
  align-items: center;
  gap: 6px;
}

.odh-date-input svg {
  width: 14px;
  height: 14px;
  color: #64748b;
}

.odh-date-input input {
  border: none;
  background: transparent;
  font-family: inherit;
  font-size: 13px;
  color: #0f172a;
  outline: none;
  width: 110px;
}

.odh-date-sep {
  font-size: 12px;
  color: #94a3b8;
  font-weight: 700;
}

@media (max-width: 900px) {
  .odh-date-group {
    flex: 1 1 100%;
    max-width: 100%;
    justify-content: space-between;
  }
  .odh-date-input {
    flex: 1;
  }
  .odh-date-input input {
    width: 100%;
  }
}

@media (max-width: 480px) {
  .odh-date-group {
    flex-direction: column;
    align-items: stretch;
    gap: 6px;
    background: transparent;
    border: none;
    padding: 0;
  }
  .odh-date-input {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 8px 10px;
  }
  .odh-date-sep { display: none; }
}
`;

export default OfflineDamageHistory;