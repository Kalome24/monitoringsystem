// src/components/handler/TabTransitStocks.jsx
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { stockTransferApi, itemMasterApi } from '../../services/api';
import ItemImageThumb from '../shared/ItemImageThumb';

// ============================================================
// Constants
// ============================================================
const STS_STATUS_FILTERS = [
  { value: 'Approved',  label: 'In Transit (Approved)' },
  { value: 'Pending',   label: 'Pending approval' },
  { value: 'Completed', label: 'Completed' },
  { value: 'Rejected',  label: 'Rejected' },
  { value: 'Cancelled', label: 'Cancelled' },
  { value: 'All',       label: 'All statuses' },
];

const stsStatusBadgeStyle = (status) => {
  switch (status) {
    case 'Pending':
      return { background: '#fef3c7', color: '#92400e', border: '1px solid #fcd34d' };
    case 'Approved':
      return { background: '#dbeafe', color: '#1e40af', border: '1px solid #93c5fd' };
    case 'Rejected':
      return { background: '#fee2e2', color: '#991b1b', border: '1px solid #fca5a5' };
    case 'Completed':
      return { background: '#dcfce7', color: '#065f46', border: '1px solid #86efac' };
    case 'Cancelled':
      return { background: '#f1f5f9', color: '#475569', border: '1px solid #cbd5e1' };
    default:
      return { background: '#f1f5f9', color: '#475569', border: '1px solid #cbd5e1' };
  }
};

const formatDate = (v) => {
  if (!v) return '—';
  try {
    const d = new Date(v);
    if (isNaN(d.getTime())) return v;
    return d.toLocaleDateString();
  } catch {
    return v;
  }
};

const formatDateTime = (v) => {
  if (!v) return '—';
  try {
    return new Date(v).toLocaleString();
  } catch {
    return v;
  }
};

const nextStepForSTS = (status) => {
  switch (status) {
    case 'Pending':   return 'Waiting for the Department Head to approve or reject this transfer.';
    case 'Approved':  return 'Items are in transit. Mark as completed once they physically arrive at the destination.';
    case 'Rejected':  return 'Rejected. You can re-create this transfer from the Received PO tab.';
    case 'Completed': return 'Transfer complete — items have arrived at the destination warehouse.';
    case 'Cancelled': return 'This slip was cancelled before approval.';
    default:          return '—';
  }
};

// ============================================================
// Component
// ============================================================
const TabTransitStocks = () => {
  const [slips, setSlips]                       = useState([]);
  const [slipsLoading, setSlipsLoading]         = useState(false);
  const [slipStatusFilter, setSlipStatusFilter] = useState('Approved');
  const [slipSearchTerm, setSlipSearchTerm]     = useState('');

  const [detail, setDetail]               = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailImages, setDetailImages]   = useState({});

  // ============================================================
  // Load slips
  // ============================================================
  const loadSlips = useCallback(async () => {
    setSlipsLoading(true);
    try {
      const res = await stockTransferApi.listSTSs({
        scope: 'mine',
        status: slipStatusFilter === 'All' ? undefined : slipStatusFilter,
        search: slipSearchTerm || undefined,
      });
      if (res.ok) {
        setSlips(Array.isArray(res.data) ? res.data : []);
      } else {
        console.error('Failed to load slips:', res);
        setSlips([]);
      }
    } finally {
      setSlipsLoading(false);
    }
  }, [slipStatusFilter, slipSearchTerm]);

  useEffect(() => { loadSlips(); }, [loadSlips]);

  // ============================================================
  // Open STS detail modal (read-only)
  // ============================================================
  const handleOpenSlipDetail = async (slip) => {
    setDetailLoading(true);
    setDetailImages({});
    try {
      const res = await stockTransferApi.getSTSDetail(slip.sts_id);
      if (!res.ok || !res.data) {
        alert('❌ Could not load slip details.');
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
  // Filters
  // ============================================================
  const clearSlipFilters = () => {
    setSlipStatusFilter('Approved');
    setSlipSearchTerm('');
  };

  // ============================================================
  // Derived
  // ============================================================
  const detailTotalQty = useMemo(() => {
    if (!detail?.lines) return 0;
    return detail.lines.reduce((sum, l) => sum + (Number(l.qty) || 0), 0);
  }, [detail]);

  // ============================================================
  // Row actions — always View (read-only tab)
  // ============================================================
  const renderSlipActions = (s) => {
    return (
      <button
        type="button"
        className="po-view-hint"
        onClick={(e) => { e.stopPropagation(); handleOpenSlipDetail(s); }}
        title="View full details"
      >
        View ›
      </button>
    );
  };

  // ============================================================
  // RENDER
  // ============================================================
  return (
    <div className="items-section">
      <style>{tabCss}</style>

      <div className="section-header">
        <h3>🚚 In-Transit Stocks</h3>
        <div className="header-actions">
          <span className="item-count">
            Showing: {slips.length} slip{slips.length === 1 ? '' : 's'}
            {slipStatusFilter !== 'All' && ` · ${slipStatusFilter}`}
          </span>
        </div>
      </div>

      <div
        style={{
          background: '#eff6ff',
          border: '1px solid #bfdbfe',
          borderRadius: 8,
          padding: '10px 14px',
          marginBottom: 16,
          fontSize: 13,
          color: '#1e3a8a',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <span style={{ fontSize: 18 }}>ℹ️</span>
        <span>
          Items currently on the move between warehouses. The default view shows
          <strong> Approved </strong> transfers waiting to physically arrive at their
          destination. Use the filter to inspect other statuses.
        </span>
      </div>

      <div style={slipFiltersStyle.wrap}>
        <div style={slipFiltersStyle.group}>
          <label style={slipFiltersStyle.label}>Search</label>
          <input
            type="text"
            placeholder="STS No. or PO No..."
            value={slipSearchTerm}
            onChange={(e) => setSlipSearchTerm(e.target.value)}
            className="filter-input"
          />
        </div>
        <div style={slipFiltersStyle.group}>
          <label style={slipFiltersStyle.label}>Status</label>
          <select
            value={slipStatusFilter}
            onChange={(e) => setSlipStatusFilter(e.target.value)}
            className="filter-input"
          >
            {STS_STATUS_FILTERS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        <div style={{ ...slipFiltersStyle.group, ...slipFiltersStyle.actionGroup }}>
          <button className="cancel-btn" onClick={clearSlipFilters} style={{ padding: '8px 16px' }}>Clear</button>
          <button className="add-user-btn" onClick={loadSlips} style={{ padding: '8px 16px' }}>Refresh</button>
        </div>
      </div>

      <div className="daily-items-section">
        <div className="daily-items-header">
          <h4>In-Transit Slips</h4>
          <span className="daily-items-count">
            {slips.length} slip{slips.length === 1 ? '' : 's'}
          </span>
        </div>

        {/* Desktop table */}
        <div className="table-wrapper po-desktop-only">
          {slipsLoading ? (
            <div className="loading-spinner" style={{ margin: '20px auto' }} />
          ) : slips.length > 0 ? (
            <table className="data-table po-compact-table po-table-sts">
              <thead>
                <tr>
                  <th className="col-sts-no">STS No.</th>
                  <th className="col-po-no">PO No.</th>
                  <th className="col-date">Transfer Date</th>
                  <th className="col-status">Status</th>
                  <th className="col-actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {slips.map((s) => (
                  <tr
                    key={s.sts_id}
                    onClick={() => handleOpenSlipDetail(s)}
                    className="po-clickable-row"
                    title="Click to view full details"
                  >
                    <td className="col-sts-no">
                      <span className="po-no-big sts-color">{s.sts_no}</span>
                    </td>
                    <td className="col-po-no">{s.po_no || '—'}</td>
                    <td className="col-date">{formatDate(s.transfer_date)}</td>
                    <td className="col-status">
                      <span
                        style={{
                          display: 'inline-block',
                          padding: '4px 12px',
                          borderRadius: 999,
                          fontSize: 12,
                          fontWeight: 700,
                          letterSpacing: '0.03em',
                          ...stsStatusBadgeStyle(s.status),
                        }}
                      >
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
              <p>
                {slipStatusFilter === 'Approved'
                  ? 'No items currently in transit. Once the Department Head approves a transfer, it will appear here.'
                  : 'No slips match the current filters.'}
              </p>
            </div>
          )}
        </div>

        {/* Mobile cards */}
        <div className="po-mobile-only">
          {slipsLoading ? (
            <div className="loading-spinner" style={{ margin: '20px auto' }} />
          ) : slips.length > 0 ? (
            slips.map((s) => (
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
                  <span
                    style={{
                      display: 'inline-block',
                      padding: '4px 12px',
                      borderRadius: 999,
                      fontSize: 12,
                      fontWeight: 700,
                      letterSpacing: '0.03em',
                      ...stsStatusBadgeStyle(s.status),
                    }}
                  >
                    {s.status}
                  </span>
                </div>
                <div className="po-card-row-2">
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
              <p>
                {slipStatusFilter === 'Approved'
                  ? 'No items currently in transit.'
                  : 'No slips match the current filters.'}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ============================================================
          STS DETAIL MODAL — read-only
          ============================================================ */}
      {detail && (
        <div className="pod-overlay" style={mStyles.overlay} onClick={closeSlipDetail}>
          <div className="pod-card" style={mStyles.card} onClick={(e) => e.stopPropagation()}>
            <div style={mStyles.header}>
              <div style={mStyles.headerLeft}>
                <div style={mStyles.headerIcon}>🚚</div>
                <div style={{ minWidth: 0 }}>
                  <h3 style={mStyles.headerTitle}>{detail.sts_no}</h3>
                  <div style={mStyles.headerSub}>
                    <span style={{ ...stsStatusBadgeStyle(detail.status), padding: '2px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700 }}>
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
              <button type="button" className="pod-close" onClick={closeSlipDetail} style={mStyles.closeBtn}>✕</button>
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
                <div style={mStyles.metaBox}><div style={mStyles.metaLabel}>Submitted At</div><div style={mStyles.metaValue}>{formatDateTime(detail.submitted_at)}</div></div>
                <div style={mStyles.metaBox}><div style={mStyles.metaLabel}>Total Qty</div><div style={mStyles.metaValue}>{detailTotalQty}</div></div>
              </div>

              {detail.remarks && (
                <div style={mStyles.remarksBox}>
                  <div style={mStyles.remarksLabel}>Remarks</div>
                  <div style={mStyles.remarksValue}>{detail.remarks}</div>
                </div>
              )}

              {detail.status === 'Approved' && (
                <div style={mStyles.approvedBox}>
                  <div style={mStyles.approvedLabel}>✅ Approved</div>
                  <div style={mStyles.approvedValue}>by {detail.approved_by || '—'} · {formatDateTime(detail.approved_at)}</div>
                </div>
              )}

              {detail.status === 'Rejected' && (
                <div style={mStyles.rejectInfo}>
                  <div style={mStyles.rejectInfoLabel}>❌ Rejected</div>
                  <div style={mStyles.rejectInfoValue}>{detail.rejection_reason || 'No reason given.'}</div>
                  <div style={mStyles.rejectInfoMeta}>by {detail.rejected_by || '—'} · {formatDateTime(detail.rejected_at)}</div>
                </div>
              )}

              {detail.status === 'Completed' && (
                <div style={mStyles.completedBox}>
                  <div style={mStyles.completedLabel}>🎉 Completed</div>
                  <div style={mStyles.completedValue}>by {detail.completed_by || '—'} · {formatDateTime(detail.completed_at)}</div>
                </div>
              )}

              {detail.status === 'Cancelled' && (
                <div style={mStyles.cancelledBox}>
                  <div style={mStyles.cancelledLabel}>🚫 Cancelled</div>
                  <div style={mStyles.cancelledValue}>This slip was cancelled before approval.</div>
                </div>
              )}

              <div style={mStyles.nextStepBox}>
                <div style={mStyles.nextStepLabel}>🎯 What's next</div>
                <div style={mStyles.nextStepValue}>{nextStepForSTS(detail.status)}</div>
              </div>

              <div style={mStyles.sectionHead}>
                <span style={mStyles.sectionTitle}>
                  📦 Lines <span style={mStyles.sectionCount}>({detail.lines?.length || 0})</span>
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
                      <th style={{ ...mStyles.th, textAlign: 'center' }}>Qty</th>
                      <th style={mStyles.th}>Price</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(detail.lines || []).map((l) => (
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
                        <td style={mStyles.td}>{l.unit_price != null ? `${Number(l.unit_price).toFixed(2)} ${l.currency || ''}` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="pod-footer" style={mStyles.footer}>
              <button type="button" className="cancel-btn" onClick={closeSlipDetail}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ============================================================
// Slip filter bar styles
// ============================================================
const slipFiltersStyle = {
  wrap: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 12,
    alignItems: 'flex-end',
    marginBottom: 16,
    padding: 12,
    background: '#f8fafc',
    border: '1px solid #e2e8f0',
    borderRadius: 10,
  },
  group: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    flex: '1 1 160px',
    minWidth: 140,
  },
  actionGroup: {
    flex: '0 1 auto',
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  label: {
    fontSize: 12,
    fontWeight: 600,
    color: '#334155',
  },
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
    background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)',
    flexShrink: 0,
  },
  headerLeft: { display: 'flex', alignItems: 'center', gap: 14, flex: 1, minWidth: 0 },
  headerIcon: {
    width: 44, height: 44, borderRadius: 12,
    background: 'linear-gradient(135deg, #6366f1 0%, #4338ca 100%)',
    color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 22, boxShadow: '0 4px 12px rgba(99, 102, 241, 0.32)', flexShrink: 0,
  },
  headerTitle: {
    margin: 0, fontSize: 'clamp(18px, 1.8vw, 22px)',
    fontWeight: 700, color: '#0f172a',
    fontFamily: "'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace",
    letterSpacing: '-0.01em', lineHeight: 1.2,
  },
  headerSub: {
    fontSize: 'clamp(11px, 1vw, 13px)', color: '#64748b', marginTop: 4,
    display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6,
  },
  headerDot: { color: '#cbd5e1' },
  closeBtn: {
    background: 'transparent', border: 'none',
    width: 36, height: 36, borderRadius: 8, cursor: 'pointer',
    fontSize: 18, color: '#64748b', flexShrink: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  body: {
    flex: 1, overflowY: 'auto',
    padding: 'clamp(16px, 2vw, 24px)',
    display: 'flex', flexDirection: 'column',
    gap: 'clamp(12px, 1.4vw, 16px)', background: '#ffffff',
  },
  footer: {
    display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10,
    padding: 'clamp(12px, 1.5vw, 16px) clamp(18px, 2.4vw, 26px)',
    borderTop: '1px solid #e5e7eb', background: '#f8fafc',
    flexShrink: 0, flexWrap: 'wrap',
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

  approvedBox: { padding: '12px 14px', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8 },
  approvedLabel: { fontSize: 11, fontWeight: 700, color: '#1e40af', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 },
  approvedValue: { fontSize: 13, color: '#1e3a8a' },

  rejectInfo: { padding: '12px 14px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8 },
  rejectInfoLabel: { fontSize: 11, fontWeight: 700, color: '#991b1b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 },
  rejectInfoValue: { fontSize: 13, color: '#7f1d1d', lineHeight: 1.5, whiteSpace: 'pre-wrap' },
  rejectInfoMeta: { fontSize: 11, color: '#b91c1c', marginTop: 6, fontStyle: 'italic' },

  completedBox: { padding: '12px 14px', background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 8 },
  completedLabel: { fontSize: 11, fontWeight: 700, color: '#065f46', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 },
  completedValue: { fontSize: 13, color: '#065f46' },

  cancelledBox: { padding: '12px 14px', background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: 8 },
  cancelledLabel: { fontSize: 11, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 },
  cancelledValue: { fontSize: 13, color: '#475569' },

  nextStepBox: {
    padding: '12px 16px',
    background: 'linear-gradient(135deg, #eef2ff 0%, #e0e7ff 100%)',
    border: '1px solid #c7d2fe', borderRadius: 10,
  },
  nextStepLabel: { fontSize: 10, fontWeight: 700, color: '#4338ca', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 },
  nextStepValue: { fontSize: 13, fontWeight: 600, color: '#1e1b4b', lineHeight: 1.5 },

  sectionHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginTop: 4 },
  sectionTitle: { fontSize: 14, fontWeight: 700, color: '#0f172a' },
  sectionCount: { color: '#64748b', fontWeight: 500 },
  summaryChip: { fontSize: 12, fontWeight: 600, padding: '5px 12px', background: '#eef2ff', color: '#4338ca', borderRadius: 999 },

  tableWrap: { overflow: 'auto', maxHeight: '38vh', border: '1px solid #e2e8f0', borderRadius: 10, background: '#fff' },
  table: { width: '100%', borderCollapse: 'collapse', minWidth: 560, fontSize: 13 },
  th: {
    padding: '10px 12px', textAlign: 'left',
    fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
    letterSpacing: '0.06em', color: '#64748b', background: '#f8fafc',
    borderBottom: '1px solid #e2e8f0',
    position: 'sticky', top: 0, zIndex: 1, whiteSpace: 'nowrap',
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

.po-compact-table { width: 100%; min-width: 780px; table-layout: fixed; }
.po-compact-table.po-table-sts .col-sts-no  { width: 22%; }
.po-compact-table.po-table-sts .col-po-no   { width: 16%; }
.po-compact-table.po-table-sts .col-date    { width: 22%; }
.po-compact-table.po-table-sts .col-status  { width: 18%; }
.po-compact-table.po-table-sts .col-actions { width: 22%; }

.po-compact-table thead th, .po-compact-table tbody td { text-align: left; }
.po-compact-table thead th.col-actions, .po-compact-table tbody td.col-actions {
  text-align: right; padding-left: 4px; padding-right: 12px;
}
.po-compact-table thead th {
  padding: 16px 18px; font-size: 13px; font-weight: 700;
  letter-spacing: 0.06em; color: #475569;
}
.po-compact-table tbody td { padding: 18px; font-size: 16px; vertical-align: middle; }

.po-no-big {
  display: inline-block;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-size: 22px; font-weight: 700; color: #0f766e;
  letter-spacing: 0.02em; line-height: 1.2; word-break: break-word;
}
.po-no-big.sts-color { color: #4338ca; }

.po-clickable-row { cursor: pointer; transition: background 0.15s ease; }
.po-clickable-row:hover { background: #f0fdfa !important; }
.po-clickable-row:active { background: #e6fffb !important; }

.po-compact-table .col-actions .action-buttons { justify-content: flex-end; gap: 4px; flex-wrap: nowrap; }
.po-compact-table .col-actions .action-btn { padding: 9px 18px; font-size: 14px; font-weight: 600; white-space: nowrap; }

.po-view-hint {
  display: inline-block; font-size: 14px; font-weight: 600;
  color: #0f766e; padding: 8px 14px;
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
.po-card-actions { display: flex; justify-content: flex-end; gap: 8px; padding-top: 8px; border-top: 1px dashed #e5e7eb; min-height: 30px; }

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
  .po-no-big { font-size: 20px; }
}
@media (prefers-reduced-motion: reduce) {
  .pod-card, .pod-overlay { animation: none !important; }
  .po-card, .po-clickable-row { transition: none !important; }
  .po-view-hint { transition: none !important; }
}
`;

export default TabTransitStocks;