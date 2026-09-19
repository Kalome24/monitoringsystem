// src/components/registrar/TabItemsReceived.jsx
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { usePermissions } from '../../permissions/usePermissions';
import { getUser } from '../../secure/auth';
import { warehouseApi, importPoApi, itemMasterApi } from '../../services/api';
import ReceivePoModal from './ReceivePoModal';
import ItemImageThumb from '../shared/ItemImageThumb';

// NOTE: ImportPoModal is no longer imported here — importing POs is
// admin-only. The modal lives at src/components/admin/ImportPoModal.jsx.

// ============================================================
// Constants
// ============================================================
const PO_PAGE_SIZE = 50;

// ============================================================
// Helpers
// ============================================================
const formatTotal = (v) => {
  if (v === '' || v === null || v === undefined) return '-';
  const n = Number(v);
  if (Number.isNaN(n)) return '-';
  return n.toFixed(2);
};

const formatDateTime = (v) => {
  if (!v) return '—';
  try {
    return new Date(v).toLocaleString();
  } catch {
    return v;
  }
};

const statusBadgeClass = (status) => {
  if (status === 'Complete')                return 'status-badge active';
  if (status === 'Complete (with damage)')  return 'status-badge damaged';
  if (status === 'Partial Received')        return 'status-badge partial';
  if (status === 'Partial With Handler')    return 'status-badge partial';
  if (status === 'With Handler')            return 'status-badge partial';
  if (status === 'Pending Transfer')        return 'status-badge pending-transfer';
  if (status === 'Transferred')             return 'status-badge active';
  if (status === 'Stored')                  return 'status-badge active';
  return 'status-badge';
};

const nextStepFor = (status) => {
  switch (status) {
    case 'Pending':                return 'Waiting for you to receive items from the vendor.';
    case 'Partial Received':       return 'Receive the remaining items, or send the received qty to the Stock Handler.';
    case 'Complete':               return 'Ready to be sent to the Stock Handler.';
    case 'Complete (with damage)': return 'Ready to be sent to the Stock Handler (with damage logged).';
    case 'With Handler':           return 'Stock Handler can create a Stock Transfer Slip.';
    case 'Partial With Handler':   return 'Stock Handler can transfer the received qty; more may arrive later.';
    case 'Pending Transfer':       return 'Waiting for the Department Head to approve or reject the transfer.';
    case 'Transferred':            return 'All received items have been transferred. No further action needed.';
    case 'Stored':                 return 'Items are stored. No further action needed.';
    default:                       return '—';
  }
};

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
const TabItemsReceived = () => {
  const { can } = usePermissions();
  const currentUser = getUser();
  const userWarehouseId = currentUser?.warehouse_assigned;

  // ---- Warehouse (display only) ----
  const [assignedWarehouse, setAssignedWarehouse] = useState(null);
  const [warehouseLoading, setWarehouseLoading] = useState(false);

  // ---- PO list ----
  const [purchaseOrders, setPurchaseOrders] = useState([]);
  const [poLoading, setPoLoading] = useState(false);
  const [totalPOs, setTotalPOs] = useState(0);
  const [page, setPage] = useState(1);

  // ---- Filters ----
  const [searchTerm, setSearchTerm]     = useState('');
  const [startDate, setStartDate]       = useState('');
  const [endDate, setEndDate]           = useState('');
  const [statusFilter, setStatusFilter] = useState('All');

  // ---- Receive modal ----
  const [receivePO, setReceivePO]           = useState(null);
  const [receiveLines, setReceiveLines]     = useState([]);
  const [receiveLoading, setReceiveLoading] = useState(false);

  // ---- Forward (Send to Handler) ----
  const [forwardingPo, setForwardingPo] = useState(null);

  // ---- Detail modal ----
  const [detail, setDetail]               = useState(null);
  const [detailLines, setDetailLines]     = useState([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailImages, setDetailImages]   = useState({});
  const [detailActivity, setDetailActivity] = useState([]);
  const [detailActivityLoading, setDetailActivityLoading] = useState(false);

  // ============================================================
  // Assigned warehouse (for the Receive modal header)
  // ============================================================
  useEffect(() => {
    if (currentUser?.warehouse_code || currentUser?.warehouse_name) {
      setAssignedWarehouse({
        warehouse_id: currentUser.warehouse_assigned || null,
        warehouse_code: currentUser.warehouse_code || '',
        warehouse_name: currentUser.warehouse_name || '',
        warehouse_location: currentUser.warehouse_location || '',
      });
    }
    if (!userWarehouseId) return;

    let cancelled = false;
    (async () => {
      try {
        setWarehouseLoading(true);
        const res = await warehouseApi.getWarehouseById(userWarehouseId);
        if (cancelled) return;
        if (res.ok && res.data) {
          const wh = res.data.data || res.data;
          if (wh && (wh.warehouse_code || wh.warehouse_name)) {
            setAssignedWarehouse({
              warehouse_id: wh.warehouse_id ?? userWarehouseId,
              warehouse_code: wh.warehouse_code || '',
              warehouse_name: wh.warehouse_name || '',
              warehouse_location: wh.warehouse_location || '',
            });
          }
        }
      } catch (err) {
        console.warn('Could not refresh warehouse info:', err);
      } finally {
        if (!cancelled) setWarehouseLoading(false);
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userWarehouseId]);

  const warehouseLabel = useMemo(() => {
    if (assignedWarehouse?.warehouse_code && assignedWarehouse?.warehouse_name) {
      return `${assignedWarehouse.warehouse_code} — ${assignedWarehouse.warehouse_name}`;
    }
    if (assignedWarehouse?.warehouse_code) return assignedWarehouse.warehouse_code;
    if (assignedWarehouse?.warehouse_name) return assignedWarehouse.warehouse_name;
    if (warehouseLoading) return 'Loading warehouse...';
    return 'Not assigned';
  }, [assignedWarehouse, warehouseLoading]);

  // ============================================================
  // Load PO list (paged, GLOBAL — no warehouse filter)
  // ============================================================
  const loadPurchaseOrders = useCallback(async () => {
    setPoLoading(true);
    try {
      const res = await importPoApi.listPOs({
        // Intentionally no warehouse_id — this is a global list.
        status:       statusFilter === 'All' ? undefined : statusFilter,
        search:       searchTerm || undefined,
        start_date:   startDate || undefined,
        end_date:     endDate   || undefined,
        page,
        limit:        PO_PAGE_SIZE,
      });
      if (res.ok) {
        setPurchaseOrders(Array.isArray(res.data) ? res.data : []);
        setTotalPOs(Number(res.total) || 0);
      } else {
        console.error('Failed to load POs:', res);
        setPurchaseOrders([]);
        setTotalPOs(0);
      }
    } finally {
      setPoLoading(false);
    }
  }, [statusFilter, searchTerm, startDate, endDate, page]);

  useEffect(() => {
    loadPurchaseOrders();
  }, [loadPurchaseOrders]);

  // ============================================================
  // Pagination derived
  // ============================================================
  const totalPages = Math.max(1, Math.ceil(totalPOs / PO_PAGE_SIZE));
  const firstItem  = totalPOs === 0 ? 0 : (page - 1) * PO_PAGE_SIZE + 1;
  const lastItem   = Math.min(totalPOs, page * PO_PAGE_SIZE);

  const goToPage = (n) => {
    const clamped = Math.max(1, Math.min(totalPages, n));
    if (clamped !== page) setPage(clamped);
  };

  // ============================================================
  // Open receive modal
  // ============================================================
  const handleOpenReceive = async (po) => {
    setReceiveLoading(true);
    try {
      const res = await importPoApi.getPODetail(po.po_no);
      if (!res.ok || !Array.isArray(res.data)) {
        alert('❌ Could not load PO details.');
        return;
      }
      setReceivePO({
        po_no:       po.po_no,
        po_date:     po.po_date,
        vendor_name: po.vendor_name,
      });
      setReceiveLines(res.data);
    } catch (err) {
      console.error(err);
      alert('❌ Error loading PO.');
    } finally {
      setReceiveLoading(false);
    }
  };

  const handleCloseReceive = () => {
    setReceivePO(null);
    setReceiveLines([]);
  };

  // ============================================================
  // Open detail modal
  // ============================================================
  const handleOpenDetail = async (po) => {
    setDetailLoading(true);
    setDetailActivityLoading(true);
    setDetailImages({});
    setDetailActivity([]);
    try {
      const [res, actRes] = await Promise.all([
        importPoApi.getPODetail(po.po_no),
        importPoApi.getPOActivity(po.po_no),
      ]);

      if (!res.ok || !Array.isArray(res.data)) {
        alert('❌ Could not load PO details.');
        return;
      }
      setDetail(po);
      setDetailLines(res.data);

      if (actRes.ok && Array.isArray(actRes.data)) {
        setDetailActivity(actRes.data);
      }

      const codes = [...new Set(res.data.map((l) => l.item_code).filter(Boolean))];
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
      setDetailActivityLoading(false);
    }
  };

  const closeDetail = () => {
    setDetail(null);
    setDetailLines([]);
    setDetailImages({});
    setDetailActivity([]);
  };

  // ============================================================
  // Send to Handler — only the caller's warehouse's lines go.
  // Backend scopes the update to req.warehouseId.
  // ============================================================
  const handleForward = async (po) => {
    const confirmMsg =
      `📤 Send your warehouse's lines to the Stock Handler?\n\n` +
      `PO No.:    ${po.po_no}\n` +
      `Vendor:    ${po.vendor_name || '—'}\n` +
      `Warehouse: ${warehouseLabel}\n\n` +
      `Only the lines received by ${warehouseLabel} will be sent.\n` +
      `Other warehouses' lines are not affected.\n\n` +
      `Proceed?`;
    if (!window.confirm(confirmMsg)) return;

    setForwardingPo(po.po_no);
    try {
      const res = await importPoApi.forwardPO(po.po_no);
      if (!res.ok || !res.data?.success) {
        alert('❌ ' + (res.data?.message || 'Failed to send to handler.'));
        return;
      }
      alert('✅ ' + (res.data.message || 'PO sent to Stock Handler.'));
      await loadPurchaseOrders();
      if (detail && detail.po_no === po.po_no) closeDetail();
    } catch (err) {
      console.error(err);
      alert('❌ Error sending PO to handler.');
    } finally {
      setForwardingPo(null);
    }
  };

  // ============================================================
  // Forward triggered from inside ReceivePoModal's post-save step.
  //
  // Returns true on success so the modal knows whether to close
  // itself. On failure, the modal stays open so the user can retry
  // or switch to Edit Receipt.
  // ============================================================
  const handleSendToHandlerFromModal = async (poNo) => {
    try {
      const res = await importPoApi.forwardPO(poNo);
      if (!res.ok || !res.data?.success) {
        alert('❌ ' + (res.data?.message || 'Failed to send to handler.'));
        return false;
      }
      alert('✅ ' + (res.data.message || 'PO sent to Stock Handler.'));
      await loadPurchaseOrders();
      return true;
    } catch (err) {
      console.error(err);
      alert('❌ Error sending PO to handler.');
      return false;
    }
  };

  // ============================================================
  // Filter helpers — every filter change resets to page 1
  // ============================================================
  const clearFilters = () => {
    setSearchTerm('');
    setStartDate('');
    setEndDate('');
    setStatusFilter('All');
    setPage(1);
  };

  const onChangeSearchTerm = (v) => { setSearchTerm(v); setPage(1); };
  const onChangeStartDate  = (v) => { setStartDate(v);  setPage(1); };
  const onChangeEndDate    = (v) => { setEndDate(v);    setPage(1); };
  const onChangeStatus     = (v) => { setStatusFilter(v); setPage(1); };

  // ============================================================
  // Row actions — gated by per-warehouse fields from the backend
  //   my_line_count  — lines this warehouse owns on the PO
  //   my_can_forward — backend says at least one line is ready
  //   my_has_forwarded — this warehouse already forwarded
  // ============================================================
  const renderRowActions = (po) => {
    const canReceive = can('importpo.receive');
    const isPending  = po.status === 'Pending';
    const isPartial  = po.status === 'Partial Received';
    const isPartialWithHandler = po.status === 'Partial With Handler';
    const isForwarding = forwardingPo === po.po_no;

    const myLineCount    = po.my_line_count ?? 0;
    const myCanForward   = po.my_can_forward === true;
    const myHasForwarded = po.my_has_forwarded === true;

    // Receive: shown when the PO is globally still receivable and this
    // warehouse hasn't already forwarded everything it owns.
    const canReceiveMore =
      canReceive &&
      (isPending || isPartial || isPartialWithHandler) &&
      !(myHasForwarded && !isPartialWithHandler);

    // Send: only when the backend says this warehouse has forwardable lines.
    const canSend = canReceive && myCanForward;

    const hasAnyAction = canReceiveMore || canSend;

    if (!hasAnyAction) {
      return (
        <button
          type="button"
          className="po-view-hint"
          onClick={(e) => { e.stopPropagation(); handleOpenDetail(po); }}
          title="View full details"
        >
          View ›
        </button>
      );
    }

    return (
      <div className="action-buttons">
        {canReceiveMore && (
          <button
            className="action-btn edit"
            onClick={(e) => { e.stopPropagation(); handleOpenReceive(po); }}
            disabled={receiveLoading}
            title={
              myLineCount === 0
                ? 'Receive lines from this PO for your warehouse'
                : 'Receive more items for this PO'
            }
          >
            {receiveLoading ? '…' : 'Receive'}
          </button>
        )}

        {canSend && (
          <button
            className="action-btn edit"
            onClick={(e) => { e.stopPropagation(); handleForward(po); }}
            disabled={isForwarding}
            title="Send only your warehouse's received lines to the handler"
          >
            {isForwarding ? 'Sending…' : 'Send to Handler'}
          </button>
        )}
      </div>
    );
  };

  // ============================================================
  // "Your Lines" cell helper
  // ============================================================
  const renderMyLines = (po) => {
    const count = po.my_line_count ?? 0;
    if (count === 0) {
      return <span className="my-lines-empty">—</span>;
    }
    let cls = 'my-lines-badge';
    let label = `${count} line${count === 1 ? '' : 's'}`;
    if (po.my_can_forward) {
      cls += ' ready';
      label += ' · ready';
    } else if (po.my_has_forwarded) {
      cls += ' forwarded';
      label += ' · sent';
    } else {
      cls += ' pending';
    }
    return <span className={cls}>{label}</span>;
  };

  // ============================================================
  // RENDER
  // ============================================================
  return (
    <div className="items-section">
      <style>{detailModalCss}</style>

      {/* ============ SECTION HEADER ============ */}
      <div className="section-header">
        <h3>📥 Purchase Orders — Global List</h3>
        <div className="header-actions">
          <span className="item-count">
            {totalPOs === 0
              ? 'No POs yet'
              : `Total: ${totalPOs} PO(s)`}
          </span>
        </div>
      </div>

      {/* Info banner */}
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
        <span style={{ fontSize: 18 }}>🌐</span>
        <span>
          These POs are <strong>imported by the Admin team</strong> and visible to
          every warehouse. When you save a receipt, your warehouse is recorded on
          the lines you receive. Only your warehouse can send its own lines to the
          handler.
        </span>
      </div>

      {/* ============ RECEIVE MODAL ============ */}
      {receivePO && receiveLines.length > 0 && (
        <ReceivePoModal
          po={receivePO}
          warehouseLabel={warehouseLabel}
          lines={receiveLines}
          onClose={handleCloseReceive}
          onSaved={loadPurchaseOrders}
          onSendToHandler={handleSendToHandlerFromModal}
        />
      )}

      {/* ============ FILTERS ============ */}
      <div className="dashboard-search-section">
        <div className="dashboard-filters">
          <div className="filter-row">
            <div className="filter-group search-group">
              <label>Search</label>
              <input
                type="text"
                placeholder="Search PO No., PR No., or vendor..."
                value={searchTerm}
                onChange={(e) => onChangeSearchTerm(e.target.value)}
                className="filter-input"
              />
            </div>
            <div className="filter-group">
              <label>Start Date</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => onChangeStartDate(e.target.value)}
                className="filter-input"
              />
            </div>
            <div className="filter-group">
              <label>End Date</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => onChangeEndDate(e.target.value)}
                className="filter-input"
              />
            </div>
            <div className="filter-group">
              <label>Status</label>
              <select
                value={statusFilter}
                onChange={(e) => onChangeStatus(e.target.value)}
                className="filter-input"
              >
                <option value="All">All Statuses</option>
                <option value="Pending">Pending</option>
                <option value="Partial Received">Partial Received</option>
                <option value="Partial With Handler">Partial With Handler</option>
                <option value="Complete">Complete</option>
                <option value="Complete (with damage)">Complete (with damage)</option>
                <option value="With Handler">With Handler</option>
                <option value="Pending Transfer">Pending Transfer</option>
                <option value="Transferred">Transferred</option>
                <option value="Stored">Stored</option>
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
                onClick={loadPurchaseOrders}
                style={{ padding: '8px 16px' }}
              >
                Refresh
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ============ PO LIST ============ */}
      <div className="daily-items-section">
        <div className="daily-items-header">
          <h4>Purchase Orders</h4>
          <span className="daily-items-count">
            {totalPOs === 0
              ? '0 PO(s)'
              : `Showing ${firstItem}–${lastItem} of ${totalPOs}`}
          </span>
        </div>

        {/* Desktop table */}
        <div className="table-wrapper po-desktop-only">
          {poLoading ? (
            <div className="loading-spinner" style={{ margin: '20px auto' }} />
          ) : purchaseOrders.length > 0 ? (
            <table className="data-table po-compact-table">
              <thead>
                <tr>
                  <th className="col-po-no">PO No.</th>
                  <th className="col-po-date">PO Date</th>
                  <th className="col-pr-no">PR No.</th>
                  <th className="col-my-lines">Your Lines</th>
                  <th className="col-status">Status</th>
                  <th className="col-actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {purchaseOrders.map((po) => (
                  <tr
                    key={po.po_no}
                    onClick={() => handleOpenDetail(po)}
                    className="po-clickable-row"
                    title="Click to view full details"
                  >
                    <td className="col-po-no">
                      <span className="po-no-big">{po.po_no}</span>
                    </td>
                    <td className="col-po-date">{po.po_date}</td>
                    <td className="col-pr-no">{po.pr_no || '—'}</td>
                    <td className="col-my-lines">
                      {renderMyLines(po)}
                    </td>
                    <td className="col-status">
                      <span className={statusBadgeClass(po.status)}>{po.status}</span>
                    </td>
                    <td className="col-actions" onClick={(e) => e.stopPropagation()}>
                      {renderRowActions(po)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="no-items-message">
              <p>No Purchase Orders yet. The Admin team will import them.</p>
            </div>
          )}
        </div>

        {/* Mobile card view */}
        <div className="po-mobile-only">
          {poLoading ? (
            <div className="loading-spinner" style={{ margin: '20px auto' }} />
          ) : purchaseOrders.length > 0 ? (
            purchaseOrders.map((po) => (
              <div
                key={po.po_no}
                className="po-card"
                onClick={() => handleOpenDetail(po)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && handleOpenDetail(po)}
              >
                <div className="po-card-row-1">
                  <span className="po-no-big">{po.po_no}</span>
                  <span className={statusBadgeClass(po.status)}>{po.status}</span>
                </div>
                <div className="po-card-row-2">
                  <span><strong>PO Date:</strong> {po.po_date || '—'}</span>
                  <span><strong>PR No.:</strong> {po.pr_no || '—'}</span>
                  <span><strong>Your Lines:</strong> {renderMyLines(po)}</span>
                </div>
                <div className="po-card-actions" onClick={(e) => e.stopPropagation()}>
                  {renderRowActions(po)}
                </div>
              </div>
            ))
          ) : (
            <div className="no-items-message">
              <p>No Purchase Orders yet. The Admin team will import them.</p>
            </div>
          )}
        </div>

        {/* PAGINATION */}
        {totalPOs > 0 && (
          <Pagination
            page={page}
            totalPages={totalPages}
            totalItems={totalPOs}
            firstItem={firstItem}
            lastItem={lastItem}
            onPrev={() => goToPage(page - 1)}
            onNext={() => goToPage(page + 1)}
            onFirst={() => goToPage(1)}
            onLast={() => goToPage(totalPages)}
            disabled={poLoading}
          />
        )}
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
            <div style={mStyles.header}>
              <div style={mStyles.headerLeft}>
                <div style={mStyles.headerIcon}>📥</div>
                <div style={{ minWidth: 0 }}>
                  <h3 style={mStyles.headerTitle}>{detail.po_no}</h3>
                  <div style={mStyles.headerSub}>
                    <span className={statusBadgeClass(detail.status)}>
                      {detail.status}
                    </span>
                    {detail.vendor_name && (
                      <>
                        <span style={mStyles.headerDot}>·</span>
                        <span>{detail.vendor_name}</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
              <button
                type="button"
                className="pod-close"
                onClick={closeDetail}
                style={mStyles.closeBtn}
              >
                ✕
              </button>
            </div>

            <div className="pod-body" style={mStyles.body}>
              <div className="pod-meta-grid" style={mStyles.metaGrid}>
                <div style={mStyles.metaBox}>
                  <div style={mStyles.metaLabel}>PO Date</div>
                  <div style={mStyles.metaValue}>{detail.po_date || '—'}</div>
                </div>
                <div style={mStyles.metaBox}>
                  <div style={mStyles.metaLabel}>PR No.</div>
                  <div style={mStyles.metaValue}>{detail.pr_no || '—'}</div>
                </div>
                <div style={mStyles.metaBox}>
                  <div style={mStyles.metaLabel}>Buyer</div>
                  <div style={mStyles.metaValue}>{detail.buyer || '—'}</div>
                </div>
                <div style={mStyles.metaBox}>
                  <div style={mStyles.metaLabel}>Vendor</div>
                  <div style={mStyles.metaValue}>{detail.vendor_name || '—'}</div>
                </div>
                <div style={mStyles.metaBox}>
                  <div style={mStyles.metaLabel}>Total Amount</div>
                  <div style={mStyles.metaValue}>{formatTotal(detail.total_amount)}</div>
                </div>
                <div style={mStyles.metaBox}>
                  <div style={mStyles.metaLabel}>Imported By</div>
                  <div style={mStyles.metaValue}>{detail.imported_by || '—'}</div>
                </div>
                <div style={mStyles.metaBox}>
                  <div style={mStyles.metaLabel}>Imported At</div>
                  <div style={mStyles.metaValue}>{formatDateTime(detail.imported_at)}</div>
                </div>
                {detail.forwarded_by && (
                  <div style={mStyles.metaBox}>
                    <div style={mStyles.metaLabel}>Forwarded By</div>
                    <div style={mStyles.metaValue}>{detail.forwarded_by}</div>
                  </div>
                )}
                {detail.forwarded_at && (
                  <div style={mStyles.metaBox}>
                    <div style={mStyles.metaLabel}>Forwarded At</div>
                    <div style={mStyles.metaValue}>{formatDateTime(detail.forwarded_at)}</div>
                  </div>
                )}
              </div>

              <div style={mStyles.sectionHead}>
                <span style={mStyles.sectionTitle}>
                  📦 PO Lines <span style={mStyles.sectionCount}>({detailLines.length})</span>
                </span>
              </div>

              <div style={mStyles.tableWrap}>
                <table style={mStyles.table}>
                  <thead>
                    <tr>
                      <th style={mStyles.th}>Item</th>
                      <th style={{ ...mStyles.th, textAlign: 'center' }}>UOM</th>
                      <th style={{ ...mStyles.th, textAlign: 'center' }}>Ordered</th>
                      <th style={{ ...mStyles.th, textAlign: 'center' }}>Received</th>
                      <th style={{ ...mStyles.th, textAlign: 'center' }}>Damaged</th>
                      <th style={mStyles.th}>Price</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detailLoading ? (
                      <tr>
                        <td colSpan={6} style={{ textAlign: 'center', padding: 24 }}>
                          Loading…
                        </td>
                      </tr>
                    ) : detailLines.length > 0 ? (
                      detailLines.map((l, idx) => (
                        <tr key={l.id ?? `${l.item_code}-${idx}`} style={mStyles.row}>
                          <td style={mStyles.tdItem}>
                            <div style={mStyles.itemCell}>
                              <ItemImageThumb
                                src={detailImages[l.item_code]}
                                alt={l.item_code}
                                size={44}
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
                          <td style={{ ...mStyles.td, textAlign: 'center', fontWeight: 600 }}>
                            {l.qty}
                          </td>
                          <td style={{ ...mStyles.td, textAlign: 'center', fontWeight: 600 }}>
                            {l.received_qty || 0}
                          </td>
                          <td style={{ ...mStyles.td, textAlign: 'center' }}>
                            {l.damaged_qty > 0 ? (
                              <span style={mStyles.dmgBadge}>{l.damaged_qty}</span>
                            ) : (
                              <span style={{ color: '#a0a8b0' }}>—</span>
                            )}
                          </td>
                          <td style={mStyles.td}>
                            {l.unit_price != null
                              ? `${Number(l.unit_price).toFixed(2)} ${l.currency || ''}`
                              : '—'}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={6} style={{ textAlign: 'center', padding: 24 }}>
                          No lines found.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div style={mStyles.nextStepBox}>
                <div style={mStyles.nextStepLabel}>🎯 What's next</div>
                <div style={mStyles.nextStepValue}>{nextStepFor(detail.status)}</div>
              </div>

              <div style={mStyles.sectionHead}>
                <span style={mStyles.sectionTitle}>
                  🕐 Activity Timeline{' '}
                  <span style={mStyles.sectionCount}>({detailActivity.length})</span>
                </span>
              </div>

              {detailActivityLoading ? (
                <div style={{ padding: 16, textAlign: 'center', color: '#64748b', fontSize: 13 }}>
                  Loading activity…
                </div>
              ) : detailActivity.length === 0 ? (
                <div style={{ padding: 16, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
                  No activity recorded yet for this PO.
                </div>
              ) : (
                <div style={mStyles.timelineWrap}>
                  {detailActivity.map((evt, idx) => {
                    const isLast = idx === detailActivity.length - 1;
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
            </div>

            <div className="pod-footer" style={mStyles.footer}>
              <button
                type="button"
                className="cancel-btn"
                onClick={closeDetail}
              >
                Close
              </button>
              {renderRowActions(detail)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ============================================================
// Pagination component
// ============================================================
const Pagination = ({
  page,
  totalPages,
  totalItems,
  firstItem,
  lastItem,
  onPrev,
  onNext,
  onFirst,
  onLast,
  disabled,
}) => {
  const prevDisabled = disabled || page <= 1;
  const nextDisabled = disabled || page >= totalPages;

  return (
    <div style={pgStyles.wrap}>
      <div style={pgStyles.info}>
        Showing <strong>{firstItem}–{lastItem}</strong> of{' '}
        <strong>{totalItems}</strong> PO{totalItems === 1 ? '' : 's'}
      </div>

      <div style={pgStyles.controls}>
        <button
          type="button"
          className="cancel-btn"
          onClick={onFirst}
          disabled={prevDisabled}
          style={{ ...pgStyles.btn, ...(prevDisabled ? pgStyles.btnDisabled : null) }}
          title="First page"
        >
          « First
        </button>
        <button
          type="button"
          className="cancel-btn"
          onClick={onPrev}
          disabled={prevDisabled}
          style={{ ...pgStyles.btn, ...(prevDisabled ? pgStyles.btnDisabled : null) }}
          title="Previous page"
        >
          ‹ Prev
        </button>

        <span style={pgStyles.pageLabel}>
          Page <strong>{page}</strong> of <strong>{totalPages}</strong>
        </span>

        <button
          type="button"
          className="add-user-btn"
          onClick={onNext}
          disabled={nextDisabled}
          style={{ ...pgStyles.btn, ...(nextDisabled ? pgStyles.btnDisabled : null) }}
          title="Next page"
        >
          Next ›
        </button>
        <button
          type="button"
          className="add-user-btn"
          onClick={onLast}
          disabled={nextDisabled}
          style={{ ...pgStyles.btn, ...(nextDisabled ? pgStyles.btnDisabled : null) }}
          title="Last page"
        >
          Last »
        </button>
      </div>
    </div>
  );
};

const pgStyles = {
  wrap: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    padding: '14px 16px',
    marginTop: 16,
    background: '#f8fafc',
    border: '1px solid #e2e8f0',
    borderRadius: 10,
  },
  info: {
    fontSize: 13,
    color: '#475569',
  },
  controls: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  btn: {
    padding: '8px 14px',
    fontSize: 13,
    fontWeight: 600,
    borderRadius: 8,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  btnDisabled: {
    opacity: 0.5,
    cursor: 'not-allowed',
  },
  pageLabel: {
    fontSize: 13,
    color: '#334155',
    padding: '0 8px',
    fontFamily: "'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace",
  },
};

// ============================================================
// MODAL STYLES
// ============================================================
const mStyles = {
  overlay: {
    position: 'fixed', inset: 0,
    background: 'rgba(15, 23, 42, 0.62)',
    backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 10000, padding: 'clamp(8px, 2vw, 24px)',
    animation: 'podFadeIn 0.18s ease',
  },
  card: {
    background: '#ffffff',
    borderRadius: 'clamp(12px, 1.5vw, 18px)',
    width: '100%', maxWidth: 1080, maxHeight: '92vh',
    display: 'flex', flexDirection: 'column', overflow: 'hidden',
    boxShadow: '0 24px 64px rgba(15, 23, 42, 0.28), 0 4px 14px rgba(15, 23, 42, 0.14)',
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    animation: 'podSlideUp 0.22s cubic-bezier(0.34, 1.3, 0.64, 1)',
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
    background: 'linear-gradient(135deg, #00e0d4 0%, #008a82 100%)',
    color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 22, boxShadow: '0 4px 12px rgba(0, 210, 200, 0.32)', flexShrink: 0,
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

  sectionHead: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    flexWrap: 'wrap',
    marginTop: 4,
  },
  sectionTitle: { fontSize: 14, fontWeight: 700, color: '#0f172a' },
  sectionCount: { color: '#64748b', fontWeight: 500 },

  tableWrap: {
    overflow: 'auto',
    maxHeight: '46vh',
    border: '1px solid #e2e8f0',
    borderRadius: 10,
    background: '#fff',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    minWidth: 620,
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
  tdItem: { padding: '8px 12px', verticalAlign: 'middle', minWidth: 220 },
  itemCell: { display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 },
  itemCode: {
    fontWeight: 700,
    fontSize: 12,
    fontFamily: "'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace",
    color: '#0f766e',
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
  dmgBadge: {
    display: 'inline-block',
    padding: '2px 8px',
    background: '#fee2e2',
    color: '#991b1b',
    border: '1px solid #fca5a5',
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 700,
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
};

// ============================================================
// RESPONSIVE CSS
// ============================================================
const detailModalCss = `
@keyframes podFadeIn { from { opacity: 0 } to { opacity: 1 } }
@keyframes podSlideUp { from { opacity: 0; transform: translateY(16px) scale(0.98) } to { opacity: 1; transform: translateY(0) scale(1) } }

.po-compact-table {
  width: 100%;
  min-width: 860px;
  table-layout: fixed;
}
.po-compact-table .col-po-no     { width: 18%; }
.po-compact-table .col-po-date   { width: 15%; }
.po-compact-table .col-pr-no     { width: 12%; }
.po-compact-table .col-my-lines  { width: 15%; }
.po-compact-table .col-status    { width: 18%; }
.po-compact-table .col-actions   { width: 22%; }

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
  color: #0f766e;
  letter-spacing: 0.02em;
  line-height: 1.2;
  word-break: break-word;
}

.po-clickable-row {
  cursor: pointer;
  transition: background 0.15s ease;
}
.po-clickable-row:hover {
  background: #f0fdfa !important;
}
.po-clickable-row:active {
  background: #e6fffb !important;
}

/* ---- "Your Lines" column ---- */
.my-lines-empty {
  color: #cbd5e1;
  font-size: 16px;
  font-weight: 600;
}
.my-lines-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.02em;
  white-space: nowrap;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
}
.my-lines-badge.pending {
  background: #fef3c7;
  color: #92400e;
  border: 1px solid #fcd34d;
}
.my-lines-badge.ready {
  background: #dcfce7;
  color: #065f46;
  border: 1px solid #86efac;
}
.my-lines-badge.forwarded {
  background: #e0e7ff;
  color: #3730a3;
  border: 1px solid #a5b4fc;
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
  color: #0f766e;
  padding: 8px 14px;
  border: 1px solid #99f6e4;
  background: #f0fdfa;
  border-radius: 8px;
  white-space: nowrap;
  cursor: pointer;
  font-family: inherit;
  transition: background 0.15s ease, border-color 0.15s ease, transform 0.1s ease;
}
.po-view-hint:hover {
  background: #ccfbf1;
  border-color: #5eead4;
}
.po-view-hint:active {
  transform: scale(0.97);
}
.po-view-hint:focus-visible {
  outline: 2px solid #00d2c8;
  outline-offset: 2px;
}

.status-badge.pending-transfer {
  display: inline-block;
  padding: 4px 12px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.03em;
  background: #fef3c7;
  color: #92400e;
  border: 1px solid #fcd34d;
  white-space: nowrap;
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
  border-color: #00d2c8;
  box-shadow: 0 2px 8px rgba(0, 210, 200, 0.15);
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
  align-items: center;
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

.pod-meta-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
}

@media (max-width: 720px) {
  .pod-footer button { flex: 1 1 auto; }
  .pod-footer { justify-content: stretch !important; }
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

export default TabItemsReceived;