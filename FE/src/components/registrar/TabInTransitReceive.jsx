// src/components/registrar/TabInTransitReceive.jsx
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FiTruck,
  FiDownload,
  FiInfo,
  FiInbox,
  FiX,
  FiPackage,
  FiTarget,
  FiSearch,
  FiRefreshCw,
} from 'react-icons/fi';
import { stockTransferApi, itemMasterApi } from '../../services/api';
import { useToast } from '../shared/ToastProvider';
import ItemImageThumb from '../shared/ItemImageThumb';
import ReceiveTransferModal from './ReceiveTransferModal';
import { usePaginatedList } from '../../hooks/usePaginatedList';
import {
  SkeletonTable,
  SkeletonCards,
  exportSTSCsv,
} from '../shared/stockTransfer';

// ============================================================
// Constants
// ============================================================
const STS_STATUS_FILTERS = [
  { value: 'In-Transit', label: 'In-Transit (pending receipt)' },
  { value: 'Received',   label: 'Received (partial)' },
  { value: 'All',        label: 'All incoming' },
];

const PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 300;
const STORAGE_KEY = 'sts:registrar:incoming';

const INCOMING_INITIAL_FILTERS = Object.freeze({
  status: 'In-Transit',
});

/* Status badge class — pure CSS, no inline hex */
const statusBadgeClass = (status) => {
  switch (status) {
    case 'In-Transit': return 'aitr-badge aitr-badge--in-transit';
    case 'Received':   return 'aitr-badge aitr-badge--received';
    case 'Completed':  return 'aitr-badge aitr-badge--completed';
    case 'Rejected':   return 'aitr-badge aitr-badge--rejected';
    case 'Cancelled':  return 'aitr-badge aitr-badge--cancelled';
    default:           return 'aitr-badge';
  }
};

const formatDate = (v) => {
  if (!v) return '—';
  const m = String(v).match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) {
    const [y, mo, d] = m[1].split('-').map(Number);
    try {
      return new Date(y, mo - 1, d).toLocaleDateString();
    } catch { return m[1]; }
  }
  try {
    const d = new Date(v);
    if (isNaN(d.getTime())) return v;
    return d.toLocaleDateString();
  } catch { return v; }
};

const formatDateTime = (v) => {
  if (!v) return '—';
  try { return new Date(v).toLocaleString(); } catch { return v; }
};

const nextStepForSTS = (status) => {
  switch (status) {
    case 'In-Transit': return 'Items are on the way. Confirm receipt when the shipment arrives.';
    case 'Received':   return 'Partially received. Some lines are still pending — contact the sender if this is unexpected.';
    case 'Completed':  return 'Transfer complete. The received quantity is in your warehouse inventory.';
    default:           return '—';
  }
};

// ============================================================
// Component
// ============================================================
const TabInTransitReceive = () => {
  const toast = useToast();

  // ---- Detail modal (read-only) ----
  const [detail, setDetail]               = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailImages, setDetailImages]   = useState({});

  // ---- Receive modal ----
  const [receiving, setReceiving] = useState(null);

  // ---- Export ----
  const [exporting, setExporting] = useState(false);

  // ============================================================
  // Load incoming slips (paginated, server-filtered)
  // ============================================================
  const incomingLoader = useCallback(async ({ page, limit, search, status }) => {
    return stockTransferApi.listIncoming({
      page,
      limit,
      search: search || undefined,
      status: status || 'In-Transit',
    });
  }, []);

  const incoming = usePaginatedList({
    loader: incomingLoader,
    initialFilters: INCOMING_INITIAL_FILTERS,
    pageSize: PAGE_SIZE,
    debounceMs: SEARCH_DEBOUNCE_MS,
    storageKey: STORAGE_KEY,
  });

  const rows    = incoming.rows;
  const loading = incoming.loading;

  // ============================================================
  // Open STS detail modal (read-only)
  // ============================================================
  const handleOpenSlipDetail = async (slip) => {
    setDetailLoading(true);
    setDetailImages({});
    try {
      const res = await stockTransferApi.getSTSDetail(slip.sts_id);
      if (!res.ok || !res.data) {
        toast.error('Could not load slip details.');
        return;
      }
      const data = res.data;
      setDetail(data);

      const codes = [...new Set((data.lines || []).map((l) => l.item_code).filter(Boolean))];
      if (codes.length > 0) {
        try {
          const imgRes = await itemMasterApi.getImagesByCodes(codes);
          if (imgRes.ok && imgRes.data?.images) {
            setDetailImages(imgRes.data.images);
          }
        } catch (e) {
          console.warn('Could not load images:', e);
        }
      }
    } finally {
      setDetailLoading(false);
    }
  };

  const closeSlipDetail = () => {
    setDetail(null);
    setDetailImages({});
  };

  // ============================================================
  // Receive flow
  // ============================================================
  const handleOpenReceive = (slip) => {
    setReceiving(slip);
  };

  const handleCloseReceive = () => {
    setReceiving(null);
  };

  const handleReceived = async () => {
    await incoming.reload();
  };

  // ============================================================
  // Filters
  // ============================================================
  const clearSlipFilters = () => {
    incoming.clearAll();
  };

  // ============================================================
  // Export — CSV of the full filtered incoming set
  // ============================================================
  const handleExport = async () => {
    if (exporting) return;

    setExporting(true);
    try {
      const EXPORT_LIMIT = 500;
      const csvRows = await incoming.fetchAll(EXPORT_LIMIT);

      if (!csvRows || csvRows.length === 0) {
        toast.info('Nothing to export — the current filters match no slips.');
        return;
      }

      const truncated = incoming.total > csvRows.length;
      const filename = exportSTSCsv(csvRows, 'incoming');

      if (truncated) {
        toast.warning(
          `Exported the first ${csvRows.length} of ${incoming.total} rows to ${filename}. ` +
          `Narrow the filters to export the rest.`,
          { duration: 7000 }
        );
      } else {
        toast.success(`Exported ${csvRows.length} row${csvRows.length === 1 ? '' : 's'} to ${filename}.`);
      }
    } catch (err) {
      console.error('Export error:', err);
      toast.error('Export failed. Please try again.');
    } finally {
      setExporting(false);
    }
  };

  // ============================================================
  // Derived
  // ============================================================
  const detailTotalQty = useMemo(() => {
    if (!detail?.lines) return 0;
    return detail.lines.reduce((sum, l) => sum + (Number(l.qty) || 0), 0);
  }, [detail]);

  const canReceiveSlip = (s) => s.status === 'In-Transit';

  const hasActiveFilter =
    !!incoming.search.trim() ||
    incoming.filters.status !== 'In-Transit';

  const isDefaultState =
    incoming.filters.status === 'In-Transit' && !incoming.search.trim();

  const emptyCopy = isDefaultState
    ? 'No transfers are currently in transit to your warehouse.'
    : 'No slips match the current filters.';

  // ============================================================
  // Row actions
  // ============================================================
  const renderSlipActions = (s) => {
    const receivable = canReceiveSlip(s);

    return (
      <div className="action-buttons">
        {receivable && (
          <button
            type="button"
            className="action-btn aitr-receive-btn"
            style={{
              background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
              color: '#fff',
              border: 'none',
            }}
            onClick={(e) => { e.stopPropagation(); handleOpenReceive(s); }}
            title="Confirm receipt of this transfer"
          >
            <FiInbox className="aitr-btn-icon" />
            <span>Receive</span>
          </button>
        )}
        <button
          type="button"
          className="po-view-hint"
          onClick={(e) => { e.stopPropagation(); handleOpenSlipDetail(s); }}
          title="View full details"
        >
          View ›
        </button>
      </div>
    );
  };

  // ============================================================
  // RENDER
  // ============================================================
  return (
    <div className="items-section">
      <style>{tabCss}</style>

      <div className="section-header">
        <h3>
          <FiTruck className="aitr-heading-icon" />
          <span>In-Transit for Receiving</span>
        </h3>
        <div className="header-actions">
          <span className="item-count">
            {incoming.total} slip{incoming.total === 1 ? '' : 's'}
            {incoming.filters.status !== 'All' && incoming.filters.status !== 'In-Transit'
              && ` · ${incoming.filters.status}`}
          </span>
          <button
            type="button"
            className="aitr-export-btn"
            onClick={handleExport}
            disabled={exporting || incoming.total === 0}
            title="Download the currently-filtered slips as CSV"
          >
            {exporting ? (
              'Exporting…'
            ) : (
              <>
                <FiDownload className="aitr-btn-icon" />
                <span>Export CSV</span>
              </>
            )}
          </button>
        </div>
      </div>

      <div className="aitr-banner" role="note">
        <span className="aitr-banner-icon aitr-banner-icon--info"><FiInfo /></span>
        <span className="aitr-banner-text">
          Transfers addressed to <strong>your warehouse</strong>. Click
          <strong> Receive </strong> to confirm the shipment arrived — record
          received and damaged quantities per line. Partial receipts are allowed.
        </span>
      </div>

      {/* Receive modal */}
      {receiving && (
        <ReceiveTransferModal
          sts={receiving}
          onClose={handleCloseReceive}
          onReceived={handleReceived}
        />
      )}

      {/* Filter bar */}
      <div className="aitr-filter-bar">
        <div className="aitr-search-wrap">
          <FiSearch className="aitr-search-icon" aria-hidden="true" />
          <label htmlFor="aitr-search" className="aitr-sr-only">Search</label>
          <input
            id="aitr-search"
            type="text"
            placeholder="Search STS No. or PO No…"
            value={incoming.search}
            onChange={(e) => incoming.setSearch(e.target.value)}
            className="aitr-search-input"
          />
        </div>

        <div className="aitr-select-wrap">
          <label htmlFor="aitr-status" className="aitr-sr-only">Status</label>
          <select
            id="aitr-status"
            value={incoming.filters.status}
            onChange={(e) => incoming.setFilter('status', e.target.value)}
            className="aitr-select"
          >
            {STS_STATUS_FILTERS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        <div className="aitr-filter-actions">
          <button
            type="button"
            className="aitr-btn aitr-btn--secondary"
            onClick={clearSlipFilters}
          >
            Clear
          </button>
          <button
            type="button"
            className="aitr-btn aitr-btn--primary"
            onClick={incoming.reload}
          >
            <FiRefreshCw className="aitr-btn-icon" />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      <div className="daily-items-section">
        <div className="daily-items-header">
          <h4>Incoming Transfers</h4>
          <span className="daily-items-count">
            {rows.length} row{rows.length === 1 ? '' : 's'}
          </span>
        </div>

        {/* Desktop table */}
        <div className="table-wrapper po-desktop-only">
          {loading ? (
            <SkeletonTable rows={6} />
          ) : rows.length > 0 ? (
            <table className="data-table po-compact-table po-table-sts">
              <thead>
                <tr>
                  <th className="col-sts-no">STS No.</th>
                  <th className="col-from-wh">From Warehouse</th>
                  <th className="col-po-no">PO No.</th>
                  <th className="col-date">Transfer Date</th>
                  <th className="col-status">Status</th>
                  <th className="col-actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr
                    key={s.sts_id}
                    onClick={() => handleOpenSlipDetail(s)}
                    className="po-clickable-row"
                    title="Click to view full details"
                  >
                    <td className="col-sts-no">
                      <span className="po-no-big sts-color">{s.sts_no}</span>
                    </td>
                    <td className="col-from-wh">
                      <div className="aitr-wh-code">
                        {s.from_warehouse_code || `WH ${s.from_warehouse_id}`}
                      </div>
                      {s.from_warehouse_name && (
                        <div className="aitr-wh-name">{s.from_warehouse_name}</div>
                      )}
                    </td>
                    <td className="col-po-no">{s.po_no || '—'}</td>
                    <td className="col-date">{formatDate(s.transfer_date)}</td>
                    <td className="col-status">
                      <span className={statusBadgeClass(s.status)}>
                        {s.status}
                      </span>
                    </td>
                    <td className="col-actions" onClick={(e) => e.stopPropagation()}>
                      {renderSlipActions(s)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="no-items-message">
              <p>{emptyCopy}</p>
              {hasActiveFilter && (
                <button
                  type="button"
                  className="aitr-empty-clear"
                  onClick={clearSlipFilters}
                >
                  <FiX className="aitr-btn-icon" />
                  <span>Clear filters</span>
                </button>
              )}
            </div>
          )}
        </div>

        {/* Mobile cards */}
        <div className="po-mobile-only">
          {loading ? (
            <SkeletonCards rows={4} />
          ) : rows.length > 0 ? (
            rows.map((s) => (
              <div
                key={s.sts_id}
                className="po-card"
                onClick={() => handleOpenSlipDetail(s)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && handleOpenSlipDetail(s)}
              >
                <div className="po-card-row-1">
                  <span className="po-no-big sts-color">{s.sts_no}</span>
                  <span className={statusBadgeClass(s.status)}>
                    {s.status}
                  </span>
                </div>
                <div className="po-card-row-2">
                  <span><strong>From:</strong> {s.from_warehouse_code || `WH ${s.from_warehouse_id}`}</span>
                  <span><strong>PO No.:</strong> {s.po_no || '—'}</span>
                  <span><strong>Date:</strong> {formatDate(s.transfer_date)}</span>
                </div>
                <div className="po-card-actions" onClick={(e) => e.stopPropagation()}>
                  {renderSlipActions(s)}
                </div>
              </div>
            ))
          ) : (
            <div className="no-items-message">
              <p>{emptyCopy}</p>
              {hasActiveFilter && (
                <button
                  type="button"
                  className="aitr-empty-clear"
                  onClick={clearSlipFilters}
                >
                  <FiX className="aitr-btn-icon" />
                  <span>Clear filters</span>
                </button>
              )}
            </div>
          )}
        </div>

        {incoming.total > 0 && (
          <nav className="aitr-pagination" aria-label="Pagination">
            <div className="aitr-pagination-info">
              Showing <strong>{incoming.showingStart}–{incoming.showingEnd}</strong> of{' '}
              <strong>{incoming.total}</strong>
            </div>
            <div className="aitr-pagination-controls">
              <button
                type="button"
                className="aitr-page-btn"
                onClick={incoming.prevPage}
                disabled={loading || incoming.page <= 1}
              >
                ‹ Prev
              </button>
              <span className="aitr-page-indicator">
                Page {incoming.page} of {incoming.totalPages}
              </span>
              <button
                type="button"
                className="aitr-page-btn"
                onClick={incoming.nextPage}
                disabled={loading || incoming.page >= incoming.totalPages}
              >
                Next ›
              </button>
            </div>
          </nav>
        )}
      </div>

      {/* ============================================================
          DETAIL MODAL — read-only
          ============================================================ */}
      {detail && (
        <div className="pod-overlay" style={mStyles.overlay} onClick={closeSlipDetail}>
          <div className="pod-card" style={mStyles.card} onClick={(e) => e.stopPropagation()}>
            <div style={mStyles.header}>
              <div style={mStyles.headerLeft}>
                <div style={mStyles.headerIcon}><FiTruck size={22} /></div>
                <div style={{ minWidth: 0 }}>
                  <h3 style={mStyles.headerTitle}>{detail.sts_no}</h3>
                  <div style={mStyles.headerSub}>
                    <span className={statusBadgeClass(detail.status)}>
                      {detail.status}
                    </span>
                    {detail.po_no && (
                      <>
                        <span style={mStyles.headerDot}>·</span>
                        <span>PO: <strong>{detail.po_no}</strong></span>
                      </>
                    )}
                  </div>
                </div>
              </div>
              <button type="button" className="pod-close" onClick={closeSlipDetail} style={mStyles.closeBtn} aria-label="Close">
                <FiX size={18} />
              </button>
            </div>

            <div className="pod-body" style={mStyles.body}>
              <div className="pod-route-grid" style={mStyles.routeGrid}>
                <div style={mStyles.routeBox}>
                  <div style={mStyles.routeLabel}>FROM</div>
                  <div style={mStyles.routeValue}>{detail.from_warehouse_code || '—'}</div>
                  <div style={mStyles.routeSub}>{detail.from_warehouse_name || ''}</div>
                </div>
                <div style={mStyles.routeArrow}>→</div>
                <div style={mStyles.routeBox}>
                  <div style={mStyles.routeLabel}>TO</div>
                  <div style={mStyles.routeValue}>{detail.to_warehouse_code || '—'}</div>
                  <div style={mStyles.routeSub}>{detail.to_warehouse_name || ''}</div>
                </div>
              </div>

              <div className="pod-meta-grid" style={mStyles.metaGrid}>
                <div style={mStyles.metaBox}><div style={mStyles.metaLabel}>Transfer Date</div><div style={mStyles.metaValue}>{formatDate(detail.transfer_date)}</div></div>
                <div style={mStyles.metaBox}><div style={mStyles.metaLabel}>Submitted By</div><div style={mStyles.metaValue}>{detail.submitted_by || '—'}</div></div>
                <div style={mStyles.metaBox}><div style={mStyles.metaLabel}>Submitted At</div><div style={mStyles.metaValue}>{formatDateTime(detail.submitted_at)}</div></div>
                <div style={mStyles.metaBox}><div style={mStyles.metaLabel}>Approved By</div><div style={mStyles.metaValue}>{detail.approved_by || '—'}</div></div>
                <div style={mStyles.metaBox}><div style={mStyles.metaLabel}>Approved At</div><div style={mStyles.metaValue}>{formatDateTime(detail.approved_at)}</div></div>
                <div style={mStyles.metaBox}><div style={mStyles.metaLabel}>Total Qty</div><div style={mStyles.metaValue}>{detailTotalQty}</div></div>
              </div>

              {detail.remarks && (
                <div style={mStyles.remarksBox}>
                  <div style={mStyles.remarksLabel}>Remarks</div>
                  <div style={mStyles.remarksValue}>{detail.remarks}</div>
                </div>
              )}

              {detail.status === 'Received' && detail.receive_remarks && (
                <div style={mStyles.completedBox}>
                  <div style={mStyles.completedLabel}>
                    <FiPackage className="aitr-completed-icon" />
                    <span>Receipt Remarks</span>
                  </div>
                  <div style={mStyles.completedValue}>{detail.receive_remarks}</div>
                </div>
              )}

              <div style={mStyles.nextStepBox}>
                <div style={mStyles.nextStepLabel}>
                  <FiTarget className="aitr-next-step-icon" />
                  <span>What's next</span>
                </div>
                <div style={mStyles.nextStepValue}>{nextStepForSTS(detail.status)}</div>
              </div>

              <div style={mStyles.sectionHead}>
                <span style={mStyles.sectionTitle}>
                  <FiPackage className="aitr-section-icon" />
                  <span>Lines <span style={mStyles.sectionCount}>({detail.lines?.length || 0})</span></span>
                </span>
                <span style={mStyles.summaryChip}>Total qty: {detailTotalQty}</span>
              </div>

              <div style={mStyles.tableWrap}>
                <table style={mStyles.table}>
                  <thead>
                    <tr>
                      <th style={mStyles.th}>#</th>
                      <th style={mStyles.th}>Item</th>
                      <th style={{ ...mStyles.th, textAlign: 'center' }}>UOM</th>
                      <th style={{ ...mStyles.th, textAlign: 'center' }}>Sent</th>
                      <th style={{ ...mStyles.th, textAlign: 'center' }}>Received</th>
                      <th style={{ ...mStyles.th, textAlign: 'center' }}>Damaged</th>
                      <th style={mStyles.th}>Price</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detailLoading ? (
                      <tr><td colSpan={7} style={{ textAlign: 'center', padding: 24 }}>Loading…</td></tr>
                    ) : (detail.lines || []).length > 0 ? (
                      detail.lines.map((l) => (
                        <tr key={l.sts_line_id} style={mStyles.row}>
                          <td style={mStyles.tdNum}>{l.line_no}</td>
                          <td style={mStyles.tdItem}>
                            <div style={mStyles.itemCell}>
                              <ItemImageThumb src={detailImages[l.item_code]} alt={l.item_code} size={40} />
                              <div style={{ minWidth: 0, flex: 1 }}>
                                <div style={mStyles.itemCode}>{l.item_code}</div>
                                <div style={mStyles.itemName} title={l.item_name}>{l.item_name || '—'}</div>
                              </div>
                            </div>
                          </td>
                          <td style={{ ...mStyles.td, textAlign: 'center' }}><span style={mStyles.uomTag}>{l.uom || '—'}</span></td>
                          <td style={{ ...mStyles.td, textAlign: 'center', fontWeight: 700 }}>{l.qty}</td>
                          <td style={{ ...mStyles.td, textAlign: 'center', fontWeight: 700, color: '#065f46' }}>
                            {Number(l.received_qty) || 0}
                          </td>
                          <td style={{ ...mStyles.td, textAlign: 'center', fontWeight: 700, color: Number(l.damaged_qty) > 0 ? '#991b1b' : '#94a3b8' }}>
                            {Number(l.damaged_qty) || 0}
                          </td>
                          <td style={mStyles.td}>
                            {l.unit_price != null ? `${Number(l.unit_price).toFixed(2)} ${l.currency || ''}` : '—'}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr><td colSpan={7} style={{ textAlign: 'center', padding: 24 }}>No lines.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="pod-footer" style={mStyles.footer}>
              <button type="button" className="cancel-btn" onClick={closeSlipDetail}>Close</button>
              {canReceiveSlip(detail) && (
                <button
                  type="button"
                  onClick={() => { closeSlipDetail(); handleOpenReceive(detail); }}
                  style={mStyles.receiveBtn}
                >
                  <FiInbox className="aitr-btn-icon" />
                  <span>Receive</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ============================================================
// Modal inline styles
// ============================================================
const mStyles = {
  overlay: {
    position: 'fixed', inset: 0,
    background: 'rgba(15, 23, 42, 0.62)',
    backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 10000, padding: 'clamp(8px, 2vw, 24px)',
    animation: 'tabFadeIn 0.18s ease',
  },
  card: {
    background: '#ffffff',
    borderRadius: 'clamp(12px, 1.5vw, 18px)',
    width: '100%', maxWidth: 1080, maxHeight: '92vh',
    display: 'flex', flexDirection: 'column', overflow: 'hidden',
    boxShadow: '0 24px 64px rgba(15, 23, 42, 0.28), 0 4px 14px rgba(15, 23, 42, 0.14)',
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    animation: 'tabSlideUp 0.22s cubic-bezier(0.34, 1.3, 0.64, 1)',
  },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    gap: 12, padding: 'clamp(14px, 1.8vw, 20px) clamp(18px, 2.4vw, 26px)',
    borderBottom: '1px solid #e5e7eb',
    background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', flexShrink: 0,
  },
  headerLeft: { display: 'flex', alignItems: 'center', gap: 14, flex: 1, minWidth: 0 },
  /* FIX: was indigo — now teal to match the tab's accent language */
  headerIcon: {
    width: 44, height: 44, borderRadius: 12,
    background: 'linear-gradient(135deg, #00e0d4 0%, #008a82 100%)',
    color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
    boxShadow: '0 4px 12px rgba(0, 210, 200, 0.32)', flexShrink: 0,
  },
  headerTitle: {
    margin: 0, fontSize: 'clamp(18px, 1.8vw, 22px)', fontWeight: 700, color: '#0f172a',
    fontFamily: "'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace", lineHeight: 1.2,
  },
  headerSub: {
    fontSize: 'clamp(11px, 1vw, 13px)', color: '#64748b', marginTop: 4,
    display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6,
  },
  headerDot: { color: '#cbd5e1' },
  closeBtn: {
    background: 'transparent', border: 'none',
    width: 36, height: 36, borderRadius: 8, cursor: 'pointer',
    color: '#64748b', flexShrink: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  body: {
    flex: 1, overflowY: 'auto', padding: 'clamp(16px, 2vw, 24px)',
    display: 'flex', flexDirection: 'column', gap: 'clamp(12px, 1.4vw, 16px)',
    background: '#ffffff',
  },
  footer: {
    display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10,
    padding: 'clamp(12px, 1.5vw, 16px) clamp(18px, 2.4vw, 26px)',
    borderTop: '1px solid #e5e7eb', background: '#f8fafc', flexShrink: 0, flexWrap: 'wrap',
  },
  receiveBtn: {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
    padding: '10px 22px',
    background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
    color: '#ffffff', border: 'none', borderRadius: 8,
    fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
    boxShadow: '0 4px 12px rgba(16, 185, 129, 0.32)',
  },
  routeGrid: { display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 12, alignItems: 'center' },
  routeBox: {
    padding: '14px 16px',
    background: 'linear-gradient(135deg, #f0fdfa 0%, #ecfeff 100%)',
    border: '1px solid #99f6e4', borderRadius: 10, textAlign: 'center',
  },
  routeLabel: { fontSize: 10, fontWeight: 700, color: '#0f766e', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 },
  routeValue: { fontSize: 'clamp(15px, 1.5vw, 18px)', fontWeight: 700, color: '#0f172a', fontFamily: "'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace" },
  routeSub: { fontSize: 12, color: '#475569', marginTop: 2 },
  routeArrow: { fontSize: 24, color: '#0f766e', fontWeight: 700 },
  metaGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 },
  metaBox: { padding: '10px 14px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8 },
  metaLabel: { fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 },
  metaValue: { fontSize: 13, fontWeight: 600, color: '#0f172a', wordBreak: 'break-word' },
  remarksBox: { padding: '12px 14px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8 },
  remarksLabel: { fontSize: 10, fontWeight: 700, color: '#92400e', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 },
  remarksValue: { fontSize: 13, color: '#78350f', lineHeight: 1.5, whiteSpace: 'pre-wrap' },
  completedBox: { padding: '12px 14px', background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 8 },
  completedLabel: {
    fontSize: 11, fontWeight: 700, color: '#065f46',
    textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3,
    display: 'inline-flex', alignItems: 'center', gap: 6,
  },
  completedValue: { fontSize: 13, color: '#065f46', lineHeight: 1.5 },
  nextStepBox: {
    padding: '12px 16px',
    background: 'linear-gradient(135deg, #eef2ff 0%, #e0e7ff 100%)',
    border: '1px solid #c7d2fe', borderRadius: 10,
  },
  nextStepLabel: {
    fontSize: 10, fontWeight: 700, color: '#4338ca',
    textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4,
    display: 'inline-flex', alignItems: 'center', gap: 6,
  },
  nextStepValue: { fontSize: 13, fontWeight: 600, color: '#1e1b4b', lineHeight: 1.5 },
  sectionHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginTop: 4 },
  sectionTitle: {
    fontSize: 14, fontWeight: 700, color: '#0f172a',
    display: 'inline-flex', alignItems: 'center', gap: 8,
  },
  sectionCount: { color: '#64748b', fontWeight: 500 },
  summaryChip: { fontSize: 12, fontWeight: 600, padding: '5px 12px', background: '#eef2ff', color: '#4338ca', borderRadius: 999 },
  tableWrap: { overflow: 'auto', maxHeight: '38vh', border: '1px solid #e2e8f0', borderRadius: 10, background: '#fff' },
  table: { width: '100%', borderCollapse: 'collapse', minWidth: 620, fontSize: 13 },
  th: {
    padding: '10px 12px', textAlign: 'left',
    fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
    letterSpacing: '0.06em', color: '#64748b', background: '#f8fafc',
    borderBottom: '1px solid #e2e8f0', position: 'sticky', top: 0, zIndex: 1, whiteSpace: 'nowrap',
  },
  row: { borderBottom: '1px solid #f1f5f9' },
  td: { padding: '8px 12px', color: '#0f172a', verticalAlign: 'middle' },
  tdNum: { padding: '8px 12px', color: '#64748b', fontWeight: 700, fontFamily: "'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace", fontSize: 12 },
  tdItem: { padding: '8px 12px', verticalAlign: 'middle', minWidth: 200 },
  itemCell: { display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 },
  itemCode: { fontWeight: 700, fontSize: 12, fontFamily: "'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace", color: '#4338ca', lineHeight: 1.2 },
  itemName: { fontSize: 11, color: '#475569', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.3 },
  uomTag: { display: 'inline-block', padding: '2px 8px', background: '#f1f5f9', color: '#334155', borderRadius: 6, fontSize: 10, fontWeight: 600, fontFamily: "'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace" },
};

// ============================================================
// Responsive CSS
// ============================================================
const tabCss = `
@keyframes tabFadeIn { from { opacity: 0 } to { opacity: 1 } }
@keyframes tabSlideUp { from { opacity: 0; transform: translateY(16px) scale(0.98) } to { opacity: 1; transform: translateY(0) scale(1) } }

/* ---------- Icon helpers ---------- */
.aitr-heading-icon {
  display: inline-flex; align-items: center; justify-content: center;
  width: 1em; height: 1em; margin-right: 8px; vertical-align: -0.15em;
  color: #1a1f26;
}
.aitr-heading-icon svg { width: 100%; height: 100%; stroke-width: 2.2; }

.aitr-btn-icon {
  width: 1em; height: 1em; flex-shrink: 0;
  stroke-width: 2.4;
}

.aitr-banner-icon {
  display: inline-flex; align-items: center; justify-content: center;
  flex-shrink: 0; width: 18px; height: 18px;
  margin-top: 1px;
}
.aitr-banner-icon svg { width: 100%; height: 100%; stroke-width: 2.2; }
.aitr-banner-icon--info { color: #1e3a8a; }

.aitr-section-icon {
  width: 16px; height: 16px; stroke-width: 2.2;
  color: #334155; flex-shrink: 0;
}

.aitr-next-step-icon {
  width: 12px; height: 12px; stroke-width: 2.6;
  color: #4338ca; flex-shrink: 0;
}

.aitr-completed-icon {
  width: 14px; height: 14px; stroke-width: 2.4;
  color: #065f46; flex-shrink: 0;
}

/* Screen-reader-only label */
.aitr-sr-only {
  position: absolute;
  width: 1px; height: 1px;
  padding: 0; margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

/* Receive action button — flex layout with icon + label */
.aitr-receive-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
}

/* ============================================================
   Info banner — responsive, class-based (was inline styles)
   ============================================================ */
.aitr-banner {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 16px;
  margin-bottom: 16px;
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  border-radius: 10px;
  color: #1e3a8a;
  font-size: clamp(12px, 0.75rem + 0.15vw, 13.5px);
  line-height: 1.55;
}
.aitr-banner-text {
  min-width: 0;
  word-break: break-word;
}
.aitr-banner-text strong { color: #1e40af; }

/* ============================================================
   Export CSV button — full local definition (was partial,
   relied on global .export-btn chrome)
   ============================================================ */
.aitr-export-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 10px 18px;
  border-radius: 10px;
  border: 1px solid #00b8b0;
  background: linear-gradient(135deg, #00e0d4 0%, #00b8b0 100%);
  color: #ffffff;
  font-family: inherit;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.01em;
  cursor: pointer;
  white-space: nowrap;
  box-shadow:
    0 1px 2px rgba(0, 184, 176, 0.28),
    0 4px 12px rgba(0, 184, 176, 0.22);
  transition:
    background 0.15s ease,
    box-shadow 0.15s ease,
    transform 0.1s ease,
    opacity 0.15s ease;
}
.aitr-export-btn svg {
  width: 1em; height: 1em; stroke-width: 2.4; flex-shrink: 0;
}
.aitr-export-btn:hover:not(:disabled) {
  background: linear-gradient(135deg, #00e8dc 0%, #00c8bf 100%);
  box-shadow:
    0 2px 4px rgba(0, 184, 176, 0.32),
    0 8px 20px rgba(0, 184, 176, 0.32);
  transform: translateY(-1px);
}
.aitr-export-btn:active:not(:disabled) {
  transform: translateY(0);
}
.aitr-export-btn:focus-visible {
  outline: 2px solid #00b8b0;
  outline-offset: 2px;
}
.aitr-export-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
  transform: none;
  box-shadow: 0 1px 2px rgba(0, 184, 176, 0.18);
}

/* ============================================================
   Warehouse cell — was inline hex, now class-based
   ============================================================ */
.aitr-wh-code {
  font-weight: 700;
  color: #0f172a;
  line-height: 1.25;
  word-break: break-word;
}
.aitr-wh-name {
  font-size: 11px;
  color: #64748b;
  margin-top: 2px;
  line-height: 1.3;
  word-break: break-word;
}

/* ============================================================
   Status badge — was JS inline hex, now CSS variants
   ============================================================ */
.aitr-badge {
  display: inline-block;
  padding: 4px 12px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.03em;
  line-height: 1.4;
  white-space: nowrap;
  background: #f1f5f9;
  color: #475569;
  border: 1px solid #cbd5e1;
}
.aitr-badge--in-transit { background: #dbeafe; color: #1e40af; border-color: #93c5fd; }
.aitr-badge--received   { background: #dcfce7; color: #065f46; border-color: #86efac; }
.aitr-badge--completed  { background: #dcfce7; color: #065f46; border-color: #86efac; }
.aitr-badge--rejected   { background: #fee2e2; color: #991b1b; border-color: #fca5a5; }
.aitr-badge--cancelled  { background: #f1f5f9; color: #475569; border-color: #cbd5e1; }

/* ============================================================
   Filter bar — refined "toolbar" look
   ============================================================ */
.aitr-filter-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-bottom: 18px;
  padding: 10px 12px;
  background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
  border: 1px solid #e8eef5;
  border-radius: 14px;
  box-shadow:
    0 1px 2px rgba(15, 23, 42, 0.03),
    0 4px 14px rgba(15, 23, 42, 0.04);
}

.aitr-search-wrap {
  position: relative;
  display: flex;
  align-items: center;
  flex: 1 1 280px;
  max-width: 520px;
  min-width: 0;
}

.aitr-search-icon {
  position: absolute;
  left: 14px;
  width: 1em;
  height: 1em;
  font-size: 15px;
  color: #94a3b8;
  pointer-events: none;
  stroke-width: 2.4;
  transition: color 0.15s ease;
}

.aitr-search-input {
  width: 100%;
  height: 42px;
  padding: 0 14px 0 40px;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  background: #ffffff;
  color: #0f172a;
  font-size: 14px;
  font-family: inherit;
  outline: none;
  box-sizing: border-box;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.aitr-search-input::placeholder { color: #94a3b8; }
.aitr-search-input:hover { border-color: #cbd5e1; }
.aitr-search-input:focus {
  border-color: #00b8b0;
  box-shadow: 0 0 0 3px rgba(0, 184, 176, 0.14);
}
.aitr-search-wrap:focus-within .aitr-search-icon { color: #00b8b0; }

.aitr-select-wrap {
  display: flex;
  flex: 0 1 260px;
  min-width: 180px;
  max-width: 300px;
}

.aitr-select {
  width: 100%;
  height: 42px;
  padding: 0 36px 0 14px;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  background-color: #ffffff;
  color: #0f172a;
  font-size: 14px;
  font-family: inherit;
  font-weight: 500;
  cursor: pointer;
  outline: none;
  box-sizing: border-box;
  appearance: none;
  -webkit-appearance: none;
  background-image: url("data:image/svg+xml;charset=UTF-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 12px center;
  background-size: 16px;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.aitr-select:hover { border-color: #cbd5e1; }
.aitr-select:focus {
  border-color: #00b8b0;
  box-shadow: 0 0 0 3px rgba(0, 184, 176, 0.14);
}

.aitr-filter-actions {
  display: flex;
  gap: 8px;
  flex: 0 0 auto;
  align-items: center;
  margin-left: auto;
}

.aitr-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 42px;
  padding: 0 18px;
  border-radius: 10px;
  font-family: inherit;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  border: 1px solid transparent;
  box-sizing: border-box;
  transition:
    background 0.15s ease,
    border-color 0.15s ease,
    color 0.15s ease,
    box-shadow 0.15s ease,
    transform 0.1s ease;
}
.aitr-btn svg {
  width: 1em;
  height: 1em;
  stroke-width: 2.4;
  flex-shrink: 0;
}
.aitr-btn:focus-visible {
  outline: 2px solid #00b8b0;
  outline-offset: 2px;
}

.aitr-btn--secondary {
  background: #ffffff;
  border-color: #e2e8f0;
  color: #475569;
}
.aitr-btn--secondary:hover {
  background: #f8fafc;
  border-color: #cbd5e1;
  color: #0f172a;
}
.aitr-btn--secondary:active {
  background: #f1f5f9;
}

.aitr-btn--primary {
  background: linear-gradient(135deg, #00e0d4 0%, #00b8b0 100%);
  color: #ffffff;
  border-color: #00b8b0;
  box-shadow:
    0 1px 2px rgba(0, 184, 176, 0.28),
    0 4px 12px rgba(0, 184, 176, 0.24);
}
.aitr-btn--primary:hover {
  background: linear-gradient(135deg, #00e8dc 0%, #00c8bf 100%);
  box-shadow:
    0 2px 4px rgba(0, 184, 176, 0.32),
    0 8px 20px rgba(0, 184, 176, 0.32);
  transform: translateY(-1px);
}
.aitr-btn--primary:active {
  transform: translateY(0);
  box-shadow:
    0 1px 2px rgba(0, 184, 176, 0.3),
    0 2px 6px rgba(0, 184, 176, 0.24);
}

@media (max-width: 900px) {
  .aitr-search-wrap {
    flex: 1 1 100%;
    max-width: 100%;
  }
  .aitr-select-wrap {
    flex: 1 1 200px;
    max-width: none;
  }
  .aitr-filter-actions {
    margin-left: 0;
  }
}

@media (max-width: 640px) {
  .aitr-filter-bar {
    gap: 8px;
    padding: 10px;
    border-radius: 12px;
  }
  .aitr-search-wrap,
  .aitr-select-wrap {
    flex: 1 1 100%;
    max-width: 100%;
  }
  .aitr-filter-actions {
    flex: 1 1 100%;
    margin-left: 0;
  }
  .aitr-filter-actions .aitr-btn {
    flex: 1 1 0;
  }
}

@media (max-width: 380px) {
  .aitr-filter-actions {
    flex-direction: column;
    gap: 6px;
  }
  .aitr-filter-actions .aitr-btn {
    width: 100%;
  }
}

/* ============================================================
   Empty-state clear-filters button — was unstyled (only
   layout rules), now full chrome.
   ============================================================ */
.aitr-empty-clear {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin-top: 14px;
  padding: 9px 18px;
  background: #ffffff;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  color: #334155;
  font-family: inherit;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.01em;
  cursor: pointer;
  white-space: nowrap;
  transition:
    background 0.15s ease,
    border-color 0.15s ease,
    color 0.15s ease,
    transform 0.1s ease;
}
.aitr-empty-clear svg {
  width: 1em;
  height: 1em;
  stroke-width: 2.3;
  flex-shrink: 0;
}
.aitr-empty-clear:hover {
  background: #f1f5f9;
  border-color: #94a3b8;
  color: #0f172a;
}
.aitr-empty-clear:active { transform: scale(0.98); }
.aitr-empty-clear:focus-visible {
  outline: 2px solid #00b8b0;
  outline-offset: 2px;
}

/* ============================================================
   Pagination — was using .tsa-* (defined in a builder this
   file doesn't import). Now fully local.
   ============================================================ */
.aitr-pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 16px;
  padding: 14px 16px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  flex-wrap: wrap;
}
.aitr-pagination-info {
  font-size: 13px;
  font-weight: 500;
  color: #475569;
}
.aitr-pagination-info strong {
  color: #0f172a;
  font-weight: 700;
}
.aitr-pagination-controls {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.aitr-page-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 8px 14px;
  border: 1px solid #cbd5e1;
  background: #ffffff;
  border-radius: 8px;
  font-family: inherit;
  font-size: 13px;
  font-weight: 600;
  color: #334155;
  cursor: pointer;
  white-space: nowrap;
  transition:
    background 0.15s ease,
    border-color 0.15s ease,
    color 0.15s ease;
}
.aitr-page-btn:hover:not(:disabled) {
  background: #f0fdfa;
  border-color: #00b8b0;
  color: #0f766e;
}
.aitr-page-btn:focus-visible {
  outline: 2px solid #00b8b0;
  outline-offset: 2px;
}
.aitr-page-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.aitr-page-indicator {
  padding: 0 10px;
  font-size: 13px;
  font-weight: 700;
  color: #0f172a;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  white-space: nowrap;
}

@media (max-width: 640px) {
  .aitr-pagination {
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
  }
  .aitr-pagination-controls {
    justify-content: center;
  }
}

/* ---------- Table ---------- */
.po-compact-table { width: 100%; min-width: 860px; table-layout: fixed; }
.po-compact-table.po-table-sts .col-sts-no  { width: 18%; }
.po-compact-table.po-table-sts .col-from-wh { width: 18%; }
.po-compact-table.po-table-sts .col-po-no   { width: 14%; }
.po-compact-table.po-table-sts .col-date    { width: 16%; }
.po-compact-table.po-table-sts .col-status  { width: 14%; }
.po-compact-table.po-table-sts .col-actions { width: 20%; }

.po-compact-table thead th, .po-compact-table tbody td { text-align: left; }
.po-compact-table thead th.col-actions, .po-compact-table tbody td.col-actions {
  text-align: right; padding-left: 4px; padding-right: 12px;
}
.po-compact-table thead th {
  padding: 16px 18px; font-size: 13px; font-weight: 700;
  letter-spacing: 0.06em; color: #475569;
}
.po-compact-table tbody td { padding: 16px 18px; font-size: 15px; vertical-align: middle; }

.po-no-big {
  display: inline-block;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-size: 20px; font-weight: 700; color: #0f766e;
  letter-spacing: 0.02em; line-height: 1.2; word-break: break-word;
}
.po-no-big.sts-color { color: #4338ca; }

.po-clickable-row { cursor: pointer; transition: background 0.15s ease; }
.po-clickable-row:hover { background: #eef2ff !important; }
.po-clickable-row:active { background: #e0e7ff !important; }

.po-compact-table .col-actions .action-buttons {
  justify-content: flex-end; gap: 6px; flex-wrap: wrap;
}
.po-compact-table .col-actions .action-btn {
  padding: 8px 14px; font-size: 13px; font-weight: 600; white-space: nowrap;
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
}

.po-view-hint {
  display: inline-block; font-size: 13px; font-weight: 600;
  color: #0f766e; padding: 7px 12px;
  border: 1px solid #99f6e4; background: #f0fdfa;
  border-radius: 8px; white-space: nowrap; cursor: pointer;
  font-family: inherit;
  transition: background 0.15s ease, border-color 0.15s ease, transform 0.1s ease;
}
.po-view-hint:hover { background: #ccfbf1; border-color: #5eead4; }
.po-view-hint:active { transform: scale(0.97); }
.po-view-hint:focus-visible { outline: 2px solid #00d2c8; outline-offset: 2px; }

.po-desktop-only { display: block; }
.po-mobile-only  { display: none; }

.po-card {
  display: flex; flex-direction: column; gap: 10px;
  padding: 14px 16px;
  border: 1px solid #e2e8f0; border-radius: 12px;
  background: #ffffff; margin-bottom: 10px; cursor: pointer;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.po-card:active { border-color: #00d2c8; box-shadow: 0 2px 8px rgba(0, 210, 200, 0.15); }
.po-card-row-1 { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.po-card-row-2 { display: flex; flex-wrap: wrap; gap: 6px 18px; font-size: 13px; color: #475569; }
.po-card-row-2 strong { color: #64748b; font-weight: 600; margin-right: 4px; }
.po-card-actions { display: flex; justify-content: flex-end; gap: 8px; padding-top: 8px; border-top: 1px dashed #e5e7eb; }

.pod-close:hover { background: #f1f5f9; color: #0f172a; }
.pod-body::-webkit-scrollbar { width: 8px; }
.pod-body::-webkit-scrollbar-track { background: #f1f5f9; border-radius: 4px; }
.pod-body::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 4px; }
.pod-body::-webkit-scrollbar-thumb:hover { background: #94a3b8; }

@media (max-width: 720px) {
  .pod-footer button { flex: 1 1 auto; }
  .pod-footer { justify-content: stretch !important; }
  .pod-route-grid { grid-template-columns: 1fr !important; }
}
@media (max-width: 640px) {
  .po-desktop-only { display: none !important; }
  .po-mobile-only  { display: block !important; }
}
@media (max-width: 480px) {
  .pod-overlay { padding: 0; }
  .pod-card { max-height: 100vh; border-radius: 0; width: 100vw; height: 100vh; }
  .po-no-big { font-size: 18px; }
}
@media (prefers-reduced-motion: reduce) {
  .pod-card, .pod-overlay { animation: none !important; }
  .po-card, .po-clickable-row { transition: none !important; }
  .po-view-hint { transition: none !important; }
  .aitr-btn, .aitr-export-btn, .aitr-search-input, .aitr-select,
  .aitr-search-icon, .aitr-page-btn, .aitr-empty-clear {
    transition: none !important;
  }
  .aitr-btn--primary:hover,
  .aitr-export-btn:hover:not(:disabled) { transform: none !important; }
}
`;

export default TabInTransitReceive;