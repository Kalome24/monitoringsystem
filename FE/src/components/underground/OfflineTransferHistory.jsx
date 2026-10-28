// src/components/underground/OfflineTransferHistory.jsx
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FiTruck,
  FiSearch,
  FiRefreshCw,
  FiCalendar,
  FiInbox,
  FiLoader,
  FiArrowRight,
  FiChevronLeft,
  FiChevronRight,
  FiChevronsLeft,
  FiChevronsRight,
} from 'react-icons/fi';
import { offlineFeaturesApi } from '../../services/api';
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
    return parts.join(', ');
  }
  return `${fmtInt(q)} Pcs`;
};

const PAGE_SIZE = 30;

const OfflineTransferHistory = () => {
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
      const res = await offlineFeaturesApi.getTransferHistory({
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
        setError(res?.data?.message || 'Failed to load transfer history.');
        setRows([]);
      }
    } catch (err) {
      console.error('Transfer history load error:', err);
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
          <div className="ug-header-icon" style={{ background: 'linear-gradient(135deg, #0ea5e9 0%, #0369a1 100%)' }}>
            <FiTruck />
          </div>
          <div className="ug-header-info">
            <h2 className="ug-header-title">Stock Transfer History</h2>
            <div className="ug-header-sub">
              Record of all locator-to-locator transfers within the underground warehouse.
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
            placeholder="Search by STS No., item code, or locator…"
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
            <div className="ug-empty-title">No transfer records found</div>
            <div className="ug-empty-sub">
              {search || startDate || endDate
                ? 'Try adjusting your search or date filters.'
                : 'No stock transfers have been completed yet.'}
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
                  <th>STS No.</th>
                  <th>Item</th>
                  <th>From → To</th>
                  <th className="ughist-num">Qty</th>
                  <th>Initiated By</th>
                  <th>Released By</th>
                  <th>Received By</th>
                  <th>Approved By</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.sts_id} className="ughist-row">
                    <td>{fmtDateTime(r.created_at)}</td>
                    <td><span className="ug-pill ug-pill--closed">{r.sts_no}</span></td>
                    <td>
                      <div className="ughist-uid">{r.item_code}</div>
                      {r.item_name && <div style={{ fontSize: 11, color: '#64748b' }}>{r.item_name}</div>}
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                        <span style={{ fontWeight: 700, color: '#0f766e' }}>{r.from_bodega}</span>
                        <FiArrowRight style={{ color: '#94a3b8' }} />
                        <span style={{ fontWeight: 700, color: '#0f766e' }}>{r.to_bodega}</span>
                      </div>
                    </td>
                    <td className="ughist-num" style={{ fontWeight: 800 }}>{fmtQtyBreakdown(r)}</td>
                    <td>{r.submitted_by || '—'}</td>
                    <td>{r.shipped_by || '—'}</td>
                    <td>{r.received_by || '—'}</td>
                    <td>{r.approved_by || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile Cards */}
          <div className="ughist-cardlist">
            {rows.map((r) => (
              <article key={`m-${r.sts_id}`} className="ughist-card">
                <header className="ughist-card-head">
                  <span className="ug-pill ug-pill--closed">{r.sts_no}</span>
                  <span className="ughist-uid">{r.item_code}</span>
                </header>
                <div style={{ fontSize: 12, color: '#475569', marginBottom: 8 }}>{r.item_name || '—'}</div>
                
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#f8fafc', padding: '8px 10px', borderRadius: '6px', marginBottom: 10 }}>
                  <span style={{ fontWeight: 700, fontSize: 12, color: '#0f766e' }}>{r.from_bodega}</span>
                  <FiArrowRight style={{ color: '#94a3b8', fontSize: 12 }} />
                  <span style={{ fontWeight: 700, fontSize: 12, color: '#0f766e' }}>{r.to_bodega}</span>
                </div>

                <dl className="ughist-card-grid">
                  <div><dt>Qty</dt><dd style={{ fontWeight: 800 }}>{fmtQtyBreakdown(r)}</dd></div>
                  <div><dt>Date</dt><dd>{fmtDateTime(r.created_at)}</dd></div>
                  <div><dt>Initiated By</dt><dd>{r.submitted_by || '—'}</dd></div>
                  <div><dt>Released By</dt><dd>{r.shipped_by || '—'}</dd></div>
                  <div><dt>Received By</dt><dd>{r.received_by || '—'}</dd></div>
                  <div><dt>Approved By</dt><dd>{r.approved_by || '—'}</dd></div>
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

export default OfflineTransferHistory;