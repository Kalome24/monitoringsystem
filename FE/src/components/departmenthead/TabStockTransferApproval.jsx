// src/components/departmenthead/TabStockTransferApproval.jsx
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { stockTransferApi, itemMasterApi, importPoApi } from '../../services/api';
import ItemImageThumb from '../shared/ItemImageThumb';

// ============================================================
// Constants
// ============================================================
const STS_STATUS_FILTERS = [
  { value: 'Pending',   label: 'Pending' },
  { value: 'Approved',  label: 'Approved' },
  { value: 'Rejected',  label: 'Rejected' },
  { value: 'Completed', label: 'Completed' },
  { value: 'Cancelled', label: 'Cancelled' },
  { value: 'All',       label: 'All statuses' },
];

const statusBadgeStyle = (status) => {
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

// ------------------------------------------------------------
// "What's next" hint based on the current STS status
// ------------------------------------------------------------
const nextStepForSTS = (status) => {
  switch (status) {
    case 'Pending':   return 'Your decision is required — review the slip and Approve or Reject it.';
    case 'Approved':  return 'Approved. Waiting for the Handler to physically complete the transfer.';
    case 'Rejected':  return 'Rejected. The Handler can edit and resubmit based on your remarks.';
    case 'Completed': return 'Transfer is complete. No further action needed.';
    case 'Cancelled': return 'This slip was cancelled by the submitter before approval.';
    default:          return '—';
  }
};

// ------------------------------------------------------------
// Activity timeline presentation
// ------------------------------------------------------------
const activityIcon = (eventType) => {
  switch (eventType) {
    case 'Imported':           return '📥';
    case 'Received':           return '📦';
    case 'Forwarded':          return '➡️';
    case 'TransferSubmitted':  return '🚚';
    case 'TransferApproved':   return '✅';
    case 'TransferRejected':   return '❌';
    case 'TransferCancelled':  return '🚫';
    case 'TransferCompleted':  return '🎉';
    default:                   return '•';
  }
};

const activityColor = (eventType) => {
  switch (eventType) {
    case 'Imported':           return '#0369a1';
    case 'Received':           return '#0f766e';
    case 'Forwarded':          return '#7c3aed';
    case 'TransferSubmitted':  return '#4338ca';
    case 'TransferApproved':   return '#15803d';
    case 'TransferRejected':   return '#b91c1c';
    case 'TransferCancelled':  return '#64748b';
    case 'TransferCompleted':  return '#065f46';
    default:                   return '#475569';
  }
};

// ============================================================
// Component
// ============================================================
const TabStockTransferApproval = () => {
  // ---- List state ----
  const [slips, setSlips]                     = useState([]);
  const [loading, setLoading]                 = useState(false);
  const [statusFilter, setStatusFilter]       = useState('Pending');
  const [searchTerm, setSearchTerm]           = useState('');
  const [startDate, setStartDate]             = useState('');
  const [endDate, setEndDate]                 = useState('');

  // ---- Detail modal ----
  const [detail, setDetail]                   = useState(null);
  const [detailLoading, setDetailLoading]     = useState(false);
  const [images, setImages]                   = useState({});
  const [rejectMode, setRejectMode]           = useState(false);
  const [rejectReason, setRejectReason]       = useState('');
  const [acting, setActing]                   = useState(false);

  // ---- PO activity (for the linked PO) ----
  const [poActivity, setPoActivity]           = useState([]);
  const [poActivityLoading, setPoActivityLoading] = useState(false);

  // ============================================================
  // Load list
  // ============================================================
  const loadSlips = useCallback(async () => {
    setLoading(true);
    try {
      const res = await stockTransferApi.listSTSs({
        status: statusFilter === 'All' ? undefined : statusFilter,
        search: searchTerm || undefined,
        start_date: startDate || undefined,
        end_date: endDate || undefined,
        scope: 'all',
      });

      if (res.ok && Array.isArray(res.data)) {
        setSlips(res.data);
      } else {
        console.error('Failed to load STS list:', res);
        setSlips([]);
      }
    } finally {
      setLoading(false);
    }
  }, [statusFilter, searchTerm, startDate, endDate]);

  useEffect(() => {
    loadSlips();
  }, [loadSlips]);

  // ============================================================
  // Open detail (fetch STS + PO activity in parallel)
  // ============================================================
  const handleOpenDetail = async (slip) => {
    setDetailLoading(true);
    setRejectMode(false);
    setRejectReason('');
    setImages({});
    setPoActivity([]);
    setPoActivityLoading(false);
    try {
      const res = await stockTransferApi.getSTSDetail(slip.sts_id);
      if (!res.ok || !res.data) {
        alert('❌ Could not load the slip details.');
        return;
      }

      const data = res.data;

      // Debug: log the raw detail so you can confirm lines are in the payload
      console.log('📋 STS Detail loaded:', {
        sts_no: data.sts_no,
        lineCount: Array.isArray(data.lines) ? data.lines.length : 'no lines key',
        lines: data.lines,
      });

      setDetail(data);

      const codes = [...new Set((data.lines || []).map(l => l.item_code).filter(Boolean))];
      if (codes.length > 0) {
        try {
          const imgRes = await itemMasterApi.getImagesByCodes(codes);
          if (imgRes.ok && imgRes.data?.images) {
            setImages(imgRes.data.images);
          }
        } catch (e) {
          console.warn('Could not load images:', e);
        }
      }

      // ---- Fetch the linked PO's activity history (if any) ----
      if (data.po_no) {
        setPoActivityLoading(true);
        try {
          const actRes = await importPoApi.getPOActivity(data.po_no);
          if (actRes.ok && Array.isArray(actRes.data)) {
            setPoActivity(actRes.data);
          }
        } catch (e) {
          console.warn('Could not load PO activity:', e);
        } finally {
          setPoActivityLoading(false);
        }
      }
    } finally {
      setDetailLoading(false);
    }
  };

  const closeDetail = () => {
    if (acting) return;
    setDetail(null);
    setRejectMode(false);
    setRejectReason('');
    setImages({});
    setPoActivity([]);
  };

  // ============================================================
  // Actions
  // ============================================================
  const handleApprove = async () => {
    if (!detail) return;
    if (!window.confirm(
      `✅ Approve ${detail.sts_no}?\n\n` +
      `From: ${detail.from_warehouse_code || '—'} — ${detail.from_warehouse_name || ''}\n` +
      `To:   ${detail.to_warehouse_code || '—'} — ${detail.to_warehouse_name || ''}\n\n` +
      `Proceed?`
    )) return;

    setActing(true);
    try {
      const res = await stockTransferApi.approveSTS(detail.sts_id);
      if (!res.ok || !res.data?.success) {
        alert('❌ ' + (res.data?.message || 'Failed to approve.'));
        return;
      }
      alert('✅ Stock Transfer Slip approved.');
      closeDetail();
      await loadSlips();
    } catch (err) {
      console.error(err);
      alert('❌ Error approving slip.');
    } finally {
      setActing(false);
    }
  };

  const handleReject = async () => {
    if (!detail) return;
    const reason = rejectReason.trim();
    if (!reason) {
      alert('Please enter a rejection reason.');
      return;
    }
    if (!window.confirm(`❌ Reject ${detail.sts_no}?\n\nReason: ${reason}\n\nProceed?`)) return;

    setActing(true);
    try {
      const res = await stockTransferApi.rejectSTS(detail.sts_id, reason);
      if (!res.ok || !res.data?.success) {
        alert('❌ ' + (res.data?.message || 'Failed to reject.'));
        return;
      }
      alert('✅ Stock Transfer Slip rejected.');
      closeDetail();
      await loadSlips();
    } catch (err) {
      console.error(err);
      alert('❌ Error rejecting slip.');
    } finally {
      setActing(false);
    }
  };

  const clearFilters = () => {
    setStatusFilter('Pending');
    setSearchTerm('');
    setStartDate('');
    setEndDate('');
  };

  // ============================================================
  // Derived
  // ============================================================
  const linesTotalQty = useMemo(() => {
    if (!detail?.lines) return 0;
    return detail.lines.reduce((sum, l) => sum + (Number(l.qty) || 0), 0);
  }, [detail]);

  const lineCount = Array.isArray(detail?.lines) ? detail.lines.length : 0;

  // ============================================================
  // Row actions
  // ============================================================
  const renderRowActions = (slip) => {
    const isPending = slip.status === 'Pending';

    if (isPending) {
      return (
        <button
          className="action-btn edit"
          onClick={(e) => { e.stopPropagation(); handleOpenDetail(slip); }}
          disabled={detailLoading}
          title="Review this slip"
        >
          {detailLoading ? '…' : 'Review'}
        </button>
      );
    }

    return (
      <button
        type="button"
        className="po-view-hint"
        onClick={(e) => { e.stopPropagation(); handleOpenDetail(slip); }}
        title="View full details"
      >
        View ›
      </button>
    );
  };

  // ============================================================
  // Render
  // ============================================================
  return (
    <div className="items-section">
      <style>{approvalCss}</style>

      <div className="section-header">
        <h3>✅ Stock Transfer Slip Approval</h3>
        <div className="header-actions">
          <span className="item-count">
            Showing: {slips.length} slip{slips.length === 1 ? '' : 's'}
            {statusFilter !== 'All' && ` · ${statusFilter}`}
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
          Stock Transfer Slips submitted by Stock Handlers appear here.
          Click any row to review the details, then Approve or Reject.
        </span>
      </div>

      <div className="dashboard-search-section">
        <div className="dashboard-filters">
          <div className="filter-row">
            <div className="filter-group search-group">
              <label>Search</label>
              <input
                type="text"
                placeholder="Search STS No. or PO No..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="filter-input"
              />
            </div>
            <div className="filter-group">
              <label>Start Date</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="filter-input"
              />
            </div>
            <div className="filter-group">
              <label>End Date</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="filter-input"
              />
            </div>
            <div className="filter-group">
              <label>Status</label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="filter-input"
              >
                {STS_STATUS_FILTERS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <div className="filter-group action-group">
              <button
                className="cancel-btn"
                onClick={clearFilters}
                style={{ padding: '8px 16px' }}
              >
                Clear Filters
              </button>
              <button
                className="add-user-btn"
                onClick={loadSlips}
                style={{ padding: '8px 16px' }}
              >
                Refresh
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="daily-items-section">
        <div className="daily-items-header">
          <h4>Stock Transfer Slips</h4>
          <span className="daily-items-count">{slips.length} total</span>
        </div>

        {/* Desktop table */}
        <div className="table-wrapper po-desktop-only">
          {loading ? (
            <div className="loading-spinner" style={{ margin: '20px auto' }} />
          ) : slips.length > 0 ? (
            <table className="data-table po-compact-table">
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
                {slips.map(s => (
                  <tr
                    key={s.sts_id}
                    onClick={() => handleOpenDetail(s)}
                    className="po-clickable-row"
                    title="Click to view full details"
                  >
                    <td className="col-sts-no">
                      <span className="po-no-big">{s.sts_no}</span>
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
                          ...statusBadgeStyle(s.status),
                        }}
                      >
                        {s.status}
                      </span>
                    </td>
                    <td
                      className="col-actions"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {renderRowActions(s)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="no-items-message">
              <p>
                {statusFilter === 'Pending'
                  ? 'No pending Stock Transfer Slips right now.'
                  : 'No slips match the current filters.'}
              </p>
            </div>
          )}
        </div>

        {/* Mobile cards */}
        <div className="po-mobile-only">
          {loading ? (
            <div className="loading-spinner" style={{ margin: '20px auto' }} />
          ) : slips.length > 0 ? (
            slips.map(s => (
              <div
                key={s.sts_id}
                className="po-card"
                onClick={() => handleOpenDetail(s)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && handleOpenDetail(s)}
              >
                <div className="po-card-row-1">
                  <span className="po-no-big">{s.sts_no}</span>
                  <span
                    style={{
                      display: 'inline-block',
                      padding: '4px 12px',
                      borderRadius: 999,
                      fontSize: 12,
                      fontWeight: 700,
                      letterSpacing: '0.03em',
                      ...statusBadgeStyle(s.status),
                    }}
                  >
                    {s.status}
                  </span>
                </div>
                <div className="po-card-row-2">
                  <span><strong>PO No.:</strong> {s.po_no || '—'}</span>
                  <span><strong>Date:</strong> {formatDate(s.transfer_date)}</span>
                </div>
                <div
                  className="po-card-actions"
                  onClick={(e) => e.stopPropagation()}
                >
                  {renderRowActions(s)}
                </div>
              </div>
            ))
          ) : (
            <div className="no-items-message">
              <p>
                {statusFilter === 'Pending'
                  ? 'No pending Stock Transfer Slips right now.'
                  : 'No slips match the current filters.'}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ============================================================
          DETAIL MODAL
          ============================================================ */}
      {detail && (
        <div className="pod-overlay" style={mStyles.overlay} onClick={closeDetail}>
          <div
            className="pod-card"
            style={mStyles.card}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div style={mStyles.header}>
              <div style={mStyles.headerLeft}>
                <div style={mStyles.headerIcon}>🚚</div>
                <div style={{ minWidth: 0 }}>
                  <h3 style={mStyles.headerTitle}>{detail.sts_no}</h3>
                  <div style={mStyles.headerSub}>
                    <span
                      style={{
                        ...statusBadgeStyle(detail.status),
                        padding: '2px 10px',
                        borderRadius: 999,
                        fontSize: 11,
                        fontWeight: 700,
                      }}
                    >
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
              <button
                type="button"
                className="pod-close"
                onClick={closeDetail}
                disabled={acting}
                style={mStyles.closeBtn}
              >
                ✕
              </button>
            </div>

            {/* Body */}
            <div className="pod-body" style={mStyles.body}>
              {/* Route card */}
              <div className="pod-route-grid" style={mStyles.routeGrid}>
                <div style={mStyles.routeBox}>
                  <div style={mStyles.routeLabel}>FROM</div>
                  <div style={mStyles.routeValue}>
                    {detail.from_warehouse_code || '—'}
                  </div>
                  <div style={mStyles.routeSub}>{detail.from_warehouse_name || ''}</div>
                </div>
                <div style={mStyles.routeArrow}>→</div>
                <div style={mStyles.routeBox}>
                  <div style={mStyles.routeLabel}>TO</div>
                  <div style={mStyles.routeValue}>
                    {detail.to_warehouse_code || '—'}
                  </div>
                  <div style={mStyles.routeSub}>{detail.to_warehouse_name || ''}</div>
                </div>
              </div>

              {/* ---------- LINES (moved up so it's the first thing you see) ---------- */}
              <div style={mStyles.linesSection}>
                <div style={mStyles.sectionHead}>
                  <span style={mStyles.sectionTitle}>
                    📦 Items to Transfer{' '}
                    <span style={mStyles.sectionCount}>({lineCount})</span>
                  </span>
                  {lineCount > 0 && (
                    <span style={mStyles.summaryChip}>
                      Total qty: {linesTotalQty}
                    </span>
                  )}
                </div>

                {detailLoading ? (
                  <div style={{ padding: 20, textAlign: 'center', color: '#64748b', fontSize: 13 }}>
                    Loading lines…
                  </div>
                ) : lineCount === 0 ? (
                  <div style={mStyles.emptyLines}>
                    ⚠️ No line items found for this slip. The transfer may have been created without items, or the API didn't return them.
                  </div>
                ) : (
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
                        {detail.lines.map((l) => (
                          <tr key={l.sts_line_id} style={mStyles.row}>
                            <td style={mStyles.tdNum}>{l.line_no}</td>
                            <td style={mStyles.tdItem}>
                              <div style={mStyles.itemCell}>
                                <ItemImageThumb
                                  src={images[l.item_code]}
                                  alt={l.item_code}
                                  size={40}
                                />
                                <div style={{ minWidth: 0, flex: 1 }}>
                                  <div style={mStyles.itemCode}>{l.item_code}</div>
                                  <div style={mStyles.itemName} title={l.item_name}>
                                    {l.item_name || '—'}
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td style={{ ...mStyles.td, textAlign: 'center' }}>
                              <span style={mStyles.uomTag}>{l.uom || '—'}</span>
                            </td>
                            <td style={{ ...mStyles.td, textAlign: 'center', fontWeight: 700 }}>
                              {l.qty}
                            </td>
                            <td style={mStyles.td}>
                              {l.unit_price != null
                                ? `${Number(l.unit_price).toFixed(2)} ${l.currency || ''}`
                                : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Meta grid */}
              <div className="pod-meta-grid" style={mStyles.metaGrid}>
                <div style={mStyles.metaBox}>
                  <div style={mStyles.metaLabel}>Transfer Date</div>
                  <div style={mStyles.metaValue}>{formatDate(detail.transfer_date)}</div>
                </div>
                <div style={mStyles.metaBox}>
                  <div style={mStyles.metaLabel}>Submitted By</div>
                  <div style={mStyles.metaValue}>{detail.submitted_by || '—'}</div>
                </div>
                <div style={mStyles.metaBox}>
                  <div style={mStyles.metaLabel}>Submitted At</div>
                  <div style={mStyles.metaValue}>{formatDateTime(detail.submitted_at)}</div>
                </div>
              </div>

              {/* Remarks */}
              {detail.remarks && (
                <div style={mStyles.remarksBox}>
                  <div style={mStyles.remarksLabel}>Remarks from submitter</div>
                  <div style={mStyles.remarksValue}>{detail.remarks}</div>
                </div>
              )}

              {/* Rejection info */}
              {detail.status === 'Rejected' && detail.rejection_reason && (
                <div style={mStyles.rejectInfo}>
                  <div style={mStyles.rejectInfoLabel}>Rejection reason</div>
                  <div style={mStyles.rejectInfoValue}>{detail.rejection_reason}</div>
                  <div style={mStyles.rejectInfoMeta}>
                    by {detail.rejected_by || '—'} · {formatDateTime(detail.rejected_at)}
                  </div>
                </div>
              )}

              {/* ---------- WHAT'S NEXT ---------- */}
              <div style={mStyles.nextStepBox}>
                <div style={mStyles.nextStepLabel}>🎯 What's next</div>
                <div style={mStyles.nextStepValue}>{nextStepForSTS(detail.status)}</div>
              </div>

              {/* ---------- PO ACTIVITY TIMELINE ---------- */}
              {detail.po_no && (
                <>
                  <div style={mStyles.sectionHead}>
                    <span style={mStyles.sectionTitle}>
                      🕐 PO History — {detail.po_no}{' '}
                      <span style={mStyles.sectionCount}>({poActivity.length})</span>
                    </span>
                  </div>

                  {poActivityLoading ? (
                    <div style={{ padding: 16, textAlign: 'center', color: '#64748b', fontSize: 13 }}>
                      Loading PO activity…
                    </div>
                  ) : poActivity.length === 0 ? (
                    <div style={{ padding: 16, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
                      No activity recorded yet for this PO.
                    </div>
                  ) : (
                    <div style={mStyles.timelineWrap}>
                      {poActivity.map((evt, idx) => {
                        const isLast = idx === poActivity.length - 1;
                        const color  = activityColor(evt.event_type);
                        return (
                          <div key={evt.log_id} style={mStyles.timelineItem}>
                            <div style={mStyles.timelineRail}>
                              <div
                                style={{
                                  ...mStyles.timelineDot,
                                  background: color,
                                  boxShadow: `0 0 0 3px ${color}22`,
                                }}
                              >
                                <span style={mStyles.timelineDotIcon}>
                                  {activityIcon(evt.event_type)}
                                </span>
                              </div>
                              {!isLast && <div style={mStyles.timelineLine} />}
                            </div>
                            <div style={mStyles.timelineBody}>
                              <div style={mStyles.timelineSummary}>
                                {evt.event_summary || evt.event_type}
                              </div>
                              <div style={mStyles.timelineMeta}>
                                <span style={mStyles.timelineActor}>
                                  {evt.actor || 'System'}
                                </span>
                                <span style={mStyles.timelineDotSep}>·</span>
                                <span>{formatDateTime(evt.acted_at)}</span>
                                <span style={mStyles.timelineDotSep}>·</span>
                                <span style={{ ...mStyles.timelineTypeChip, color, borderColor: color }}>
                                  {evt.event_type}
                                </span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}

              {/* Reject reason input */}
              {rejectMode && (
                <div style={mStyles.rejectInputBox}>
                  <label style={mStyles.rejectInputLabel} htmlFor="sta-reason">
                    Rejection reason *
                  </label>
                  <textarea
                    id="sta-reason"
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    disabled={acting}
                    rows={3}
                    placeholder="Explain why this slip is being rejected…"
                    style={mStyles.rejectTextarea}
                    autoFocus
                  />
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="pod-footer" style={mStyles.footer}>
              {detail.status === 'Pending' && !rejectMode && (
                <>
                  <button
                    type="button"
                    className="cancel-btn"
                    onClick={closeDetail}
                    disabled={acting}
                  >
                    Close
                  </button>
                  <button
                    type="button"
                    onClick={() => setRejectMode(true)}
                    disabled={acting}
                    style={mStyles.rejectBtn}
                  >
                    ❌ Reject
                  </button>
                  <button
                    type="button"
                    onClick={handleApprove}
                    disabled={acting}
                    style={mStyles.approveBtn}
                  >
                    {acting ? 'Approving…' : '✅ Approve'}
                  </button>
                </>
              )}

              {detail.status === 'Pending' && rejectMode && (
                <>
                  <button
                    type="button"
                    className="cancel-btn"
                    onClick={() => {
                      setRejectMode(false);
                      setRejectReason('');
                    }}
                    disabled={acting}
                  >
                    ← Back
                  </button>
                  <button
                    type="button"
                    onClick={handleReject}
                    disabled={acting || !rejectReason.trim()}
                    style={mStyles.rejectBtn}
                  >
                    {acting ? 'Rejecting…' : '❌ Confirm Reject'}
                  </button>
                </>
              )}

              {detail.status !== 'Pending' && (
                <button
                  type="button"
                  className="cancel-btn"
                  onClick={closeDetail}
                  disabled={acting}
                >
                  Close
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
// MODAL INLINE STYLES
// ============================================================
const mStyles = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(15, 23, 42, 0.62)',
    backdropFilter: 'blur(6px)',
    WebkitBackdropFilter: 'blur(6px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10000,
    padding: 'clamp(8px, 2vw, 24px)',
    animation: 'podFadeIn 0.18s ease',
  },
  card: {
    background: '#ffffff',
    borderRadius: 'clamp(12px, 1.5vw, 18px)',
    width: '100%',
    maxWidth: 1080,
    maxHeight: '92vh',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    boxShadow:
      '0 24px 64px rgba(15, 23, 42, 0.28), 0 4px 14px rgba(15, 23, 42, 0.14)',
    fontFamily:
      "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    animation: 'podSlideUp 0.22s cubic-bezier(0.34, 1.3, 0.64, 1)',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    padding: 'clamp(14px, 1.8vw, 20px) clamp(18px, 2.4vw, 26px)',
    borderBottom: '1px solid #e5e7eb',
    background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)',
    flexShrink: 0,
  },
  headerLeft: { display: 'flex', alignItems: 'center', gap: 14, flex: 1, minWidth: 0 },
  headerIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    background: 'linear-gradient(135deg, #6366f1 0%, #4338ca 100%)',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 22,
    boxShadow: '0 4px 12px rgba(99, 102, 241, 0.32)',
    flexShrink: 0,
  },
  headerTitle: {
    margin: 0,
    fontSize: 'clamp(18px, 1.8vw, 22px)',
    fontWeight: 700,
    color: '#0f172a',
    fontFamily: "'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace",
    letterSpacing: '-0.01em',
    lineHeight: 1.2,
  },
  headerSub: {
    fontSize: 'clamp(11px, 1vw, 13px)',
    color: '#64748b',
    marginTop: 4,
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
  },
  headerDot: { color: '#cbd5e1' },
  closeBtn: {
    background: 'transparent',
    border: 'none',
    width: 36,
    height: 36,
    borderRadius: 8,
    cursor: 'pointer',
    fontSize: 18,
    color: '#64748b',
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
    overflowY: 'auto',
    padding: 'clamp(16px, 2vw, 24px)',
    display: 'flex',
    flexDirection: 'column',
    gap: 'clamp(12px, 1.4vw, 16px)',
    background: '#ffffff',
  },
  footer: {
    display: 'flex',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 10,
    padding: 'clamp(12px, 1.5vw, 16px) clamp(18px, 2.4vw, 26px)',
    borderTop: '1px solid #e5e7eb',
    background: '#f8fafc',
    flexShrink: 0,
    flexWrap: 'wrap',
  },

  routeGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr auto 1fr',
    gap: 12,
    alignItems: 'center',
  },
  routeBox: {
    padding: '14px 16px',
    background: 'linear-gradient(135deg, #f0fdfa 0%, #ecfeff 100%)',
    border: '1px solid #99f6e4',
    borderRadius: 10,
    textAlign: 'center',
  },
  routeLabel: {
    fontSize: 10,
    fontWeight: 700,
    color: '#0f766e',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    marginBottom: 4,
  },
  routeValue: {
    fontSize: 'clamp(15px, 1.5vw, 18px)',
    fontWeight: 700,
    color: '#0f172a',
    fontFamily: "'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace",
  },
  routeSub: {
    fontSize: 12,
    color: '#475569',
    marginTop: 2,
  },
  routeArrow: {
    fontSize: 24,
    color: '#0f766e',
    fontWeight: 700,
  },

  // Prominent lines section
  linesSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    padding: 14,
    background: 'linear-gradient(135deg, #fefce8 0%, #fef9c3 100%)',
    border: '2px solid #fde68a',
    borderRadius: 12,
  },
  emptyLines: {
    padding: '16px 18px',
    background: '#fff',
    borderRadius: 8,
    fontSize: 13,
    color: '#92400e',
    textAlign: 'center',
    lineHeight: 1.5,
    border: '1px dashed #fcd34d',
  },

  metaGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: 12,
  },
  metaBox: {
    padding: '10px 14px',
    background: '#f8fafc',
    border: '1px solid #e2e8f0',
    borderRadius: 8,
  },
  metaLabel: {
    fontSize: 10,
    fontWeight: 700,
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    marginBottom: 3,
  },
  metaValue: {
    fontSize: 13,
    fontWeight: 600,
    color: '#0f172a',
    wordBreak: 'break-word',
  },

  remarksBox: {
    padding: '12px 14px',
    background: '#fffbeb',
    border: '1px solid #fde68a',
    borderRadius: 8,
  },
  remarksLabel: {
    fontSize: 10,
    fontWeight: 700,
    color: '#92400e',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    marginBottom: 4,
  },
  remarksValue: {
    fontSize: 13,
    color: '#78350f',
    lineHeight: 1.5,
    whiteSpace: 'pre-wrap',
  },

  rejectInfo: {
    padding: '12px 14px',
    background: '#fef2f2',
    border: '1px solid #fecaca',
    borderRadius: 8,
  },
  rejectInfoLabel: {
    fontSize: 10,
    fontWeight: 700,
    color: '#991b1b',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    marginBottom: 4,
  },
  rejectInfoValue: {
    fontSize: 13,
    color: '#7f1d1d',
    lineHeight: 1.5,
    whiteSpace: 'pre-wrap',
  },
  rejectInfoMeta: {
    fontSize: 11,
    color: '#b91c1c',
    marginTop: 6,
    fontStyle: 'italic',
  },

  sectionHead: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    flexWrap: 'wrap',
  },
  sectionTitle: { fontSize: 14, fontWeight: 700, color: '#0f172a' },
  sectionCount: { color: '#64748b', fontWeight: 500 },
  summaryChip: {
    fontSize: 12,
    fontWeight: 600,
    padding: '5px 12px',
    background: '#eef2ff',
    color: '#4338ca',
    borderRadius: 999,
  },

  tableWrap: {
    overflow: 'auto',
    maxHeight: '44vh',
    border: '1px solid #e2e8f0',
    borderRadius: 10,
    background: '#fff',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    minWidth: 560,
    fontSize: 13,
  },
  th: {
    padding: '10px 12px',
    textAlign: 'left',
    fontSize: 10,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    color: '#64748b',
    background: '#f8fafc',
    borderBottom: '1px solid #e2e8f0',
    position: 'sticky',
    top: 0,
    zIndex: 1,
    whiteSpace: 'nowrap',
  },
  row: { borderBottom: '1px solid #f1f5f9' },
  td: { padding: '8px 12px', color: '#0f172a', verticalAlign: 'middle' },
  tdNum: {
    padding: '8px 12px',
    color: '#64748b',
    fontWeight: 700,
    fontFamily: "'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace",
    fontSize: 12,
  },
  tdItem: { padding: '8px 12px', verticalAlign: 'middle', minWidth: 200 },
  itemCell: { display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 },
  itemCode: {
    fontWeight: 700,
    fontSize: 12,
    fontFamily: "'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace",
    color: '#4338ca',
    lineHeight: 1.2,
  },
  itemName: {
    fontSize: 11,
    color: '#475569',
    marginTop: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    lineHeight: 1.3,
  },
  uomTag: {
    display: 'inline-block',
    padding: '2px 8px',
    background: '#f1f5f9',
    color: '#334155',
    borderRadius: 6,
    fontSize: 10,
    fontWeight: 600,
    fontFamily: "'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace",
  },

  nextStepBox: {
    padding: '12px 16px',
    background: 'linear-gradient(135deg, #eef2ff 0%, #e0e7ff 100%)',
    border: '1px solid #c7d2fe',
    borderRadius: 10,
  },
  nextStepLabel: {
    fontSize: 10,
    fontWeight: 700,
    color: '#4338ca',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    marginBottom: 4,
  },
  nextStepValue: {
    fontSize: 13,
    fontWeight: 600,
    color: '#1e1b4b',
    lineHeight: 1.5,
  },

  timelineWrap: {
    display: 'flex',
    flexDirection: 'column',
    padding: '4px 0',
  },
  timelineItem: {
    display: 'flex',
    gap: 14,
    alignItems: 'flex-start',
  },
  timelineRail: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    flexShrink: 0,
    width: 32,
  },
  timelineDot: {
    width: 28,
    height: 28,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#ffffff',
    fontSize: 13,
    fontWeight: 700,
  },
  timelineDotIcon: {
    fontSize: 13,
    lineHeight: 1,
  },
  timelineLine: {
    width: 2,
    flex: 1,
    minHeight: 24,
    background: '#e2e8f0',
    margin: '2px 0',
  },
  timelineBody: {
    flex: 1,
    paddingBottom: 14,
    minWidth: 0,
  },
  timelineSummary: {
    fontSize: 13,
    fontWeight: 600,
    color: '#0f172a',
    lineHeight: 1.4,
    wordBreak: 'break-word',
  },
  timelineMeta: {
    marginTop: 4,
    fontSize: 11,
    color: '#64748b',
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
  },
  timelineActor: {
    fontFamily: "'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace",
    fontWeight: 600,
    color: '#475569',
  },
  timelineDotSep: { color: '#cbd5e1' },
  timelineTypeChip: {
    display: 'inline-block',
    padding: '1px 7px',
    border: '1px solid',
    borderRadius: 999,
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
  },

  rejectInputBox: {
    marginTop: 4,
    padding: '12px 14px',
    background: '#fef2f2',
    border: '1px solid #fecaca',
    borderRadius: 8,
  },
  rejectInputLabel: {
    display: 'block',
    fontSize: 12,
    fontWeight: 700,
    color: '#991b1b',
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  rejectTextarea: {
    width: '100%',
    padding: '10px 12px',
    fontSize: 14,
    border: '1.5px solid #ef4444',
    borderRadius: 7,
    background: '#fff',
    color: '#0f172a',
    fontFamily: 'inherit',
    outline: 'none',
    resize: 'vertical',
    minHeight: 70,
    boxSizing: 'border-box',
  },

  approveBtn: {
    padding: '10px 22px',
    background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
    color: '#ffffff',
    border: 'none',
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 700,
    cursor: 'pointer',
    fontFamily: 'inherit',
    boxShadow: '0 4px 12px rgba(16, 185, 129, 0.32)',
    transition: 'transform 0.15s ease, box-shadow 0.2s ease',
  },
  rejectBtn: {
    padding: '10px 22px',
    background: 'linear-gradient(135deg, #ef4444 0%, #b91c1c 100%)',
    color: '#ffffff',
    border: 'none',
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 700,
    cursor: 'pointer',
    fontFamily: 'inherit',
    boxShadow: '0 4px 12px rgba(239, 68, 68, 0.32)',
    transition: 'transform 0.15s ease, box-shadow 0.2s ease',
  },
};

// ============================================================
// RESPONSIVE CSS
// ============================================================
const approvalCss = `
@keyframes podFadeIn { from { opacity: 0 } to { opacity: 1 } }
@keyframes podSlideUp { from { opacity: 0; transform: translateY(16px) scale(0.98) } to { opacity: 1; transform: translateY(0) scale(1) } }

.po-compact-table {
  width: 100%;
  min-width: 780px;
  table-layout: fixed;
}
.po-compact-table .col-sts-no  { width: 22%; }
.po-compact-table .col-po-no   { width: 16%; }
.po-compact-table .col-date    { width: 22%; }
.po-compact-table .col-status  { width: 18%; }
.po-compact-table .col-actions { width: 22%; }

.po-compact-table thead th,
.po-compact-table tbody td {
  text-align: left;
}

.po-compact-table thead th.col-actions,
.po-compact-table tbody td.col-actions {
  text-align: right;
  padding-left: 4px;
  padding-right: 12px;
}

.po-compact-table thead th {
  padding: 16px 18px;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: #475569;
}

.po-compact-table tbody td {
  padding: 18px;
  font-size: 16px;
  vertical-align: middle;
}

.po-no-big {
  display: inline-block;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-size: 22px;
  font-weight: 700;
  color: #4338ca;
  letter-spacing: 0.02em;
  line-height: 1.2;
  word-break: break-word;
}

.po-clickable-row {
  cursor: pointer;
  transition: background 0.15s ease;
}
.po-clickable-row:hover {
  background: #eef2ff !important;
}
.po-clickable-row:active {
  background: #e0e7ff !important;
}

.po-compact-table .col-actions .action-buttons {
  justify-content: flex-end;
  gap: 4px;
  flex-wrap: nowrap;
}
.po-compact-table .col-actions .action-btn {
  padding: 9px 18px;
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
}

.po-view-hint {
  display: inline-block;
  font-size: 14px;
  font-weight: 600;
  color: #4338ca;
  padding: 8px 14px;
  border: 1px solid #c7d2fe;
  background: #eef2ff;
  border-radius: 8px;
  white-space: nowrap;
  cursor: pointer;
  font-family: inherit;
  transition: background 0.15s ease, border-color 0.15s ease, transform 0.1s ease;
}
.po-view-hint:hover {
  background: #e0e7ff;
  border-color: #a5b4fc;
}
.po-view-hint:active {
  transform: scale(0.97);
}
.po-view-hint:focus-visible {
  outline: 2px solid #6366f1;
  outline-offset: 2px;
}

.po-desktop-only { display: block; }
.po-mobile-only  { display: none; }

.po-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 16px;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  background: #ffffff;
  margin-bottom: 10px;
  cursor: pointer;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.po-card:active {
  border-color: #6366f1;
  box-shadow: 0 2px 8px rgba(99, 102, 241, 0.15);
}
.po-card-row-1 {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}
.po-card-row-2 {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 18px;
  font-size: 13px;
  color: #475569;
}
.po-card-row-2 strong {
  color: #64748b;
  font-weight: 600;
  margin-right: 4px;
}
.po-card-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 8px;
  border-top: 1px dashed #e5e7eb;
  min-height: 30px;
}

.pod-close:hover { background: #f1f5f9; color: #0f172a; }
.pod-body::-webkit-scrollbar { width: 8px; }
.pod-body::-webkit-scrollbar-track { background: #f1f5f9; border-radius: 4px; }
.pod-body::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 4px; }
.pod-body::-webkit-scrollbar-thumb:hover { background: #94a3b8; }

.pod-route-grid {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  gap: 12px;
  align-items: center;
}

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
  .pod-card {
    max-height: 100vh;
    border-radius: 0;
    width: 100vw;
    height: 100vh;
  }
  .po-no-big { font-size: 20px; }
}

@media (prefers-reduced-motion: reduce) {
  .pod-card, .pod-overlay { animation: none !important; }
  .po-card, .po-clickable-row { transition: none !important; }
  .po-view-hint { transition: none !important; }
}
`;

export default TabStockTransferApproval;