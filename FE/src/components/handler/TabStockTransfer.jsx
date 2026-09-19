// src/components/handler/TabStockTransfer.jsx
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { usePermissions } from '../../permissions/usePermissions';
import { getUser } from '../../secure/auth';
import {
  warehouseApi,
  importPoApi,
  stockTransferApi,
  itemMasterApi,
} from '../../services/api';
import TransferPoModal from './TransferPoModal';
import ItemImageThumb from '../shared/ItemImageThumb';

// ============================================================
// Constants
// ============================================================
const HANDLER_STATUSES = [
  'With Handler',
  'Partial With Handler',
  'Pending Transfer',
  'Transferred',
  'Stored',
];

const STS_STATUS_FILTERS = [
  { value: 'All',       label: 'All statuses' },
  { value: 'Pending',   label: 'Pending' },
  { value: 'Approved',  label: 'Approved' },
  { value: 'Rejected',  label: 'Rejected' },
  { value: 'Completed', label: 'Completed' },
  { value: 'Cancelled', label: 'Cancelled' },
];

// ============================================================
// Helpers
// ============================================================
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

const itemStatusBadgeClass = (status) => {
  if (status === 'Partial With Handler') return 'status-badge partial';
  if (status === 'With Handler')         return 'status-badge partial';
  if (status === 'Pending Transfer')     return 'status-badge pending-transfer';
  if (status === 'Transferred')          return 'status-badge active';
  if (status === 'Stored')               return 'status-badge active';
  return 'status-badge';
};

const stsStatusBadgeStyle = (status) => {
  switch (status) {
    case 'Pending':   return { background: '#fef3c7', color: '#92400e', border: '1px solid #fcd34d' };
    case 'Approved':  return { background: '#dbeafe', color: '#1e40af', border: '1px solid #93c5fd' };
    case 'Rejected':  return { background: '#fee2e2', color: '#991b1b', border: '1px solid #fca5a5' };
    case 'Completed': return { background: '#dcfce7', color: '#065f46', border: '1px solid #86efac' };
    case 'Cancelled': return { background: '#f1f5f9', color: '#475569', border: '1px solid #cbd5e1' };
    default:          return { background: '#f1f5f9', color: '#475569', border: '1px solid #cbd5e1' };
  }
};

const nextStepFor = (status) => {
  switch (status) {
    case 'Pending':                return 'Waiting for the Registrar to receive items from the vendor.';
    case 'Partial Received':       return 'Registrar needs to receive the remaining items.';
    case 'Complete':               return 'Ready to be sent to the Stock Handler.';
    case 'Complete (with damage)': return 'Ready to be sent to the Stock Handler (with damage logged).';
    case 'With Handler':           return 'Stock Handler can create a Stock Transfer Slip.';
    case 'Partial With Handler':   return 'Stock Handler can transfer the received qty; more may arrive later.';
    case 'Pending Transfer':       return 'This item is awaiting Department Head approval. Other items on the same PO are independent and remain actionable.';
    case 'Transferred':            return 'This item has been transferred. No further action needed.';
    case 'Stored':                 return 'This item has been stored. No further action needed.';
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
const TabStockTransfer = () => {
  const { can } = usePermissions();
  const currentUser = getUser();
  const userWarehouseId = currentUser?.warehouse_assigned;

  const [assignedWarehouse, setAssignedWarehouse] = useState(null);
  const [warehouseLoading, setWarehouseLoading] = useState(false);
  const [allWarehouses, setAllWarehouses] = useState([]);

  // ---- Per-item rows ----
  const [items, setItems] = useState([]);
  const [itemsLoading, setItemsLoading] = useState(false);

  // ---- Filters ----
  const [searchTerm, setSearchTerm]     = useState('');
  const [startDate, setStartDate]       = useState('');
  const [endDate, setEndDate]           = useState('');
  const [statusFilter, setStatusFilter] = useState('All');

  // ---- Rejected slips map: po_no → most recent rejected STS ----
  const [rejectedSlipsByPO, setRejectedSlipsByPO] = useState({});

  // ---- Transfer modal ----
  const [transferPO, setTransferPO]               = useState(null);
  const [transferLines, setTransferLines]         = useState([]);
  const [transferRejection, setTransferRejection] = useState(null);
  const [transferLoading, setTransferLoading]     = useState(false);

  // ---- Submitted slips ----
  const [slips, setSlips]                       = useState([]);
  const [slipsLoading, setSlipsLoading]         = useState(false);
  const [slipStatusFilter, setSlipStatusFilter] = useState('All');
  const [slipSearchTerm, setSlipSearchTerm]     = useState('');

  // ---- PO detail modal ----
  const [poDetail, setPoDetail]               = useState(null);
  const [poDetailLines, setPoDetailLines]     = useState([]);
  const [poDetailLoading, setPoDetailLoading] = useState(false);
  const [poDetailImages, setPoDetailImages]   = useState({});
  const [poDetailActivity, setPoDetailActivity] = useState([]);
  const [poDetailActivityLoading, setPoDetailActivityLoading] = useState(false);

  // ---- STS detail modal ----
  const [detail, setDetail]               = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailImages, setDetailImages]   = useState({});
  const [cancelling, setCancelling]       = useState(false);

  // ============================================================
  // Load warehouses + assigned warehouse
  // ============================================================
  useEffect(() => {
    (async () => {
      try {
        const res = await warehouseApi.getAllWarehouses();
        if (res.ok && Array.isArray(res.data)) setAllWarehouses(res.data);
      } catch (err) {
        console.warn('Could not load warehouses:', err);
      }
    })();
  }, []);

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

  // ============================================================
  // Load per-item rows + rejected slips
  // ============================================================
  const loadItems = useCallback(async () => {
    setItemsLoading(true);
    try {
      const [itemsRes, rejRes] = await Promise.all([
        importPoApi.listHandlerItems({
          warehouse_id: userWarehouseId,
          status: statusFilter === 'All' ? undefined : statusFilter,
          search: searchTerm || undefined,
          start_date: startDate || undefined,
          end_date: endDate || undefined,
        }),
        stockTransferApi.listSTSs({ scope: 'mine', status: 'Rejected' }),
      ]);

      if (itemsRes.ok) {
        setItems(Array.isArray(itemsRes.data) ? itemsRes.data : []);
      } else {
        console.error('Failed to load handler items:', itemsRes);
        setItems([]);
      }

      if (rejRes.ok && Array.isArray(rejRes.data)) {
        const map = {};
        for (const s of rejRes.data) {
          if (s.po_no && !map[s.po_no]) map[s.po_no] = s;
        }
        setRejectedSlipsByPO(map);
      } else {
        setRejectedSlipsByPO({});
      }
    } finally {
      setItemsLoading(false);
    }
  }, [userWarehouseId, statusFilter, searchTerm, startDate, endDate]);

  useEffect(() => { loadItems(); }, [loadItems]);

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
  // Derived counts
  // ============================================================
  const pendingCount = useMemo(
    () => items.filter((i) => i.status === 'Pending Transfer').length,
    [items]
  );

  const rejectedCount = useMemo(
    () =>
      items.filter(
        (i) =>
          (i.status === 'With Handler' || i.status === 'Partial With Handler') &&
          !!rejectedSlipsByPO[i.po_no]
      ).length,
    [items, rejectedSlipsByPO]
  );

  // ============================================================
  // Open Transfer modal — for ONE item
  // ============================================================
  const handleOpenTransfer = (item) => {
    setTransferPO({
      po_no: item.po_no,
      po_date: item.po_date,
      vendor_name: item.vendor_name,
    });
    // Pass only this one line so the modal transfers a single item.
    setTransferLines([item]);
    setTransferRejection(rejectedSlipsByPO[item.po_no] || null);
  };

  const handleCloseTransfer = () => {
    setTransferPO(null);
    setTransferLines([]);
    setTransferRejection(null);
  };

  const handleTransferSubmitted = async () => {
    await Promise.all([loadItems(), loadSlips()]);
  };

  // ============================================================
  // PO detail modal — shows ALL items on the same PO
  // ============================================================
  const handleOpenPoDetail = async (item) => {
    setPoDetailLoading(true);
    setPoDetailActivityLoading(true);
    setPoDetailImages({});
    setPoDetailActivity([]);
    try {
      const [res, actRes] = await Promise.all([
        importPoApi.getPODetail(item.po_no, userWarehouseId),
        importPoApi.getPOActivity(item.po_no),
      ]);

      if (!res.ok || !Array.isArray(res.data)) {
        alert('❌ Could not load PO details.');
        return;
      }

      setPoDetail({
        po_no: item.po_no,
        po_date: item.po_date,
        pr_no: item.pr_no,
        vendor_name: item.vendor_name,
        buyer: item.buyer,
        status: item.status,
        forwarded_by: item.forwarded_by,
        forwarded_at: item.forwarded_at,
      });
      setPoDetailLines(res.data);

      if (actRes.ok && Array.isArray(actRes.data)) {
        setPoDetailActivity(actRes.data);
      }

      const codes = [...new Set(res.data.map((l) => l.item_code).filter(Boolean))];
      if (codes.length > 0) {
        try {
          const imgRes = await itemMasterApi.getImagesByCodes(codes);
          if (imgRes.ok && imgRes.data?.images) {
            setPoDetailImages(imgRes.data.images);
          }
        } catch (e) {
          console.warn('Could not load images:', e);
        }
      }
    } finally {
      setPoDetailLoading(false);
      setPoDetailActivityLoading(false);
    }
  };

  const closePoDetail = () => {
    setPoDetail(null);
    setPoDetailLines([]);
    setPoDetailImages({});
    setPoDetailActivity([]);
  };

  // ============================================================
  // STS detail modal
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
    if (cancelling) return;
    setDetail(null);
    setDetailImages({});
  };

  const handleCancelSlip = async (slip) => {
    if (!slip) return;
    if (!window.confirm(
      `Cancel ${slip.sts_no}?\n\nThis cannot be undone. The slip will no longer be reviewed by the Department Head.`
    )) return;

    setCancelling(true);
    try {
      const res = await stockTransferApi.cancelSTS(slip.sts_id);
      if (!res.ok || !res.data?.success) {
        alert('❌ ' + (res.data?.message || 'Failed to cancel slip.'));
        return;
      }
      alert('✅ Stock Transfer Slip cancelled.');
      closeSlipDetail();
      await Promise.all([loadSlips(), loadItems()]);
    } catch (err) {
      console.error(err);
      alert('❌ Error cancelling slip.');
    } finally {
      setCancelling(false);
    }
  };

  const handleOpenStore = (item) => {
    alert(
      `🏬 Store — ${item.item_code} (PO ${item.po_no})\n\n` +
      `The Store form has not been implemented yet.`
    );
  };

  const clearFilters = () => {
    setSearchTerm('');
    setStartDate('');
    setEndDate('');
    setStatusFilter('All');
  };

  const clearSlipFilters = () => {
    setSlipStatusFilter('All');
    setSlipSearchTerm('');
  };

  const poDetailTotalQty = useMemo(() => {
    if (!poDetailLines.length) return 0;
    return poDetailLines.reduce((sum, l) => sum + (Number(l.qty) || 0), 0);
  }, [poDetailLines]);

  const detailTotalQty = useMemo(() => {
    if (!detail?.lines) return 0;
    return detail.lines.reduce((sum, l) => sum + (Number(l.qty) || 0), 0);
  }, [detail]);

  // ============================================================
  // Per-item row actions
  // ============================================================
  const renderItemActions = (item) => {
    const isPending     = item.status === 'Pending Transfer';
    const isTransferred = item.status === 'Transferred' || item.status === 'Stored';
    const actionable    =
      (item.status === 'With Handler' || item.status === 'Partial With Handler') &&
      can('stocktransfer.create');
    const hasRejection  = !!rejectedSlipsByPO[item.po_no];

    if (isPending) {
      return (
        <div className="action-buttons" style={{ justifyContent: 'flex-end' }}>
          <span className="pending-transfer-chip" title="Awaiting Department Head approval">
            ⏳ Awaiting approval
          </span>
          <button
            type="button"
            className="po-view-hint"
            onClick={(e) => { e.stopPropagation(); handleOpenPoDetail(item); }}
            title="View all items on this PO"
          >
            View ›
          </button>
        </div>
      );
    }

    if (isTransferred || !actionable) {
      return (
        <button
          type="button"
          className="po-view-hint"
          onClick={(e) => { e.stopPropagation(); handleOpenPoDetail(item); }}
          title="View full details"
        >
          View ›
        </button>
      );
    }

    return (
      <div className="action-buttons">
        {hasRejection && (
          <span
            className="rejected-chip"
            title={`Last transfer was rejected: ${rejectedSlipsByPO[item.po_no]?.rejection_reason || 'see slip for details'}`}
          >
            ⚠️
          </span>
        )}
        <button
          className="action-btn edit"
          onClick={(e) => { e.stopPropagation(); handleOpenTransfer(item); }}
          disabled={transferLoading}
          title={hasRejection ? 'Edit and resubmit' : 'Transfer this item'}
        >
          {transferLoading ? '…' : hasRejection ? 'Re-transfer' : 'Transfer'}
        </button>
        <button
          className="action-btn"
          onClick={(e) => { e.stopPropagation(); handleOpenStore(item); }}
          title="Store this item"
        >
          Store
        </button>
      </div>
    );
  };

  const renderSlipActions = (s) => {
    if (s.status === 'Pending') {
      return (
        <div className="action-buttons">
          <button
            className="action-btn edit"
            onClick={(e) => { e.stopPropagation(); handleOpenSlipDetail(s); }}
            disabled={detailLoading}
            title="View details"
          >
            {detailLoading ? '…' : 'View'}
          </button>
          <button
            className="action-btn deactivate-btn"
            onClick={(e) => { e.stopPropagation(); handleCancelSlip(s); }}
            disabled={cancelling}
            title="Cancel this slip"
          >
            {cancelling ? '…' : 'Cancel'}
          </button>
        </div>
      );
    }

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
        <h3>🚚 Stock Transfer — Forwarded Items</h3>
        <div className="header-actions">
          <span className="item-count">Total: {items.length} item(s)</span>
        </div>
      </div>

      {transferPO && transferLines.length > 0 && (
        <TransferPoModal
          po={transferPO}
          lines={transferLines}
          warehouses={allWarehouses}
          currentWarehouse={assignedWarehouse}
          lastRejection={transferRejection}
          onClose={handleCloseTransfer}
          onSubmitted={handleTransferSubmitted}
        />
      )}

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
          Every <strong>item</strong> below has its own row and can be transferred
          independently — even if several items share the same PO No. Click any row
          to see the full PO.
        </span>
      </div>

      {pendingCount > 0 && (
        <div
          style={{
            background: '#fffbeb',
            border: '1px solid #fde68a',
            borderRadius: 8,
            padding: '10px 14px',
            marginBottom: 16,
            fontSize: 13,
            color: '#92400e',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <span style={{ fontSize: 18 }}>⏳</span>
          <span>
            <strong>{pendingCount}</strong>{' '}
            item{pendingCount === 1 ? ' is' : 's are'} locked pending Department Head
            approval. Other items remain transferable.
          </span>
        </div>
      )}

      {rejectedCount > 0 && (
        <div
          style={{
            background: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: 8,
            padding: '10px 14px',
            marginBottom: 16,
            fontSize: 13,
            color: '#991b1b',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <span style={{ fontSize: 18 }}>⚠️</span>
          <span>
            <strong>{rejectedCount}</strong>{' '}
            item{rejectedCount === 1 ? ' has' : 's have'} a rejected transfer. Open
            the Transfer modal to review the Department Head's remarks.
          </span>
        </div>
      )}

      {/* ============ FILTERS ============ */}
      <div className="dashboard-search-section">
        <div className="dashboard-filters">
          <div className="filter-row">
            <div className="filter-group search-group">
              <label>Search</label>
              <input
                type="text"
                placeholder="Search PO No., Item Code, Item Name, PR No., or vendor..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="filter-input"
              />
            </div>
            <div className="filter-group">
              <label>Start Date</label>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="filter-input" />
            </div>
            <div className="filter-group">
              <label>End Date</label>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="filter-input" />
            </div>
            <div className="filter-group">
              <label>Status</label>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="filter-input">
                <option value="All">All</option>
                <option value="With Handler">With Handler</option>
                <option value="Partial With Handler">Partial With Handler</option>
                <option value="Pending Transfer">Pending Transfer</option>
                <option value="Transferred">Transferred</option>
                <option value="Stored">Stored</option>
              </select>
            </div>
            <div className="filter-group action-group">
              <button className="cancel-btn" onClick={clearFilters} style={{ padding: '8px 16px' }}>Clear Filters</button>
              <button className="add-user-btn" onClick={loadItems} style={{ padding: '8px 16px' }}>Refresh</button>
            </div>
          </div>
        </div>
      </div>

      {/* ============ PER-ITEM LIST ============ */}
      <div className="daily-items-section" style={{ marginBottom: 24 }}>
        <div className="daily-items-header">
          <h4>Items Forwarded to You</h4>
          <span className="daily-items-count">{items.length} item(s)</span>
        </div>

        {/* Desktop table */}
        <div className="table-wrapper po-desktop-only">
          {itemsLoading ? (
            <div className="loading-spinner" style={{ margin: '20px auto' }} />
          ) : items.length > 0 ? (
            <table className="data-table po-compact-table po-table-item">
              <thead>
                <tr>
                  <th className="col-item">Item</th>
                  <th className="col-po-no">PO No.</th>
                  <th className="col-po-date">PO Date</th>
                  <th className="col-pr-no">PR No.</th>
                  <th className="col-qty">Qty</th>
                  <th className="col-status">Status</th>
                  <th className="col-actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const hasRejection =
                    !!rejectedSlipsByPO[item.po_no] &&
                    (item.status === 'With Handler' || item.status === 'Partial With Handler');
                  return (
                    <tr
                      key={item.id}
                      onClick={() => handleOpenPoDetail(item)}
                      className="po-clickable-row"
                      title="Click to view all items on this PO"
                    >
                      <td className="col-item">
                        <div style={mStyles.itemCell}>
                          <ItemImageThumb src={null} alt={item.item_code} size={44} />
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={mStyles.itemCode}>{item.item_code}</div>
                            <div style={mStyles.itemName} title={item.item_name}>
                              {item.item_name || '—'}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="col-po-no">
                        <span className="po-no-big" style={{ fontSize: 16 }}>{item.po_no}</span>
                        {hasRejection && (
                          <span
                            className="po-rejected-dot"
                            title={`Last transfer rejected: ${rejectedSlipsByPO[item.po_no]?.rejection_reason || 'no reason given'}`}
                          >
                            ⚠️
                          </span>
                        )}
                      </td>
                      <td className="col-po-date">{formatDate(item.po_date)}</td>
                      <td className="col-pr-no">{item.pr_no || '—'}</td>
                      <td className="col-qty">
                        <span style={mStyles.qtyText}>
                          {item.received_qty || 0} / {item.qty}
                        </span>
                        {item.damaged_qty > 0 && (
                          <span style={mStyles.dmgTag}>-{item.damaged_qty} dmg</span>
                        )}
                      </td>
                      <td className="col-status">
                        <span className={itemStatusBadgeClass(item.status)}>{item.status}</span>
                      </td>
                      <td className="col-actions" onClick={(e) => e.stopPropagation()}>
                        {renderItemActions(item)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <div className="no-items-message">
              <p>
                No forwarded items yet. Once a Registrar receives a PO and clicks
                "Send to Handler", items will appear here.
              </p>
            </div>
          )}
        </div>

        {/* Mobile cards — one per item */}
        <div className="po-mobile-only">
          {itemsLoading ? (
            <div className="loading-spinner" style={{ margin: '20px auto' }} />
          ) : items.length > 0 ? (
            items.map((item) => (
              <div
                key={item.id}
                className="po-card"
                onClick={() => handleOpenPoDetail(item)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && handleOpenPoDetail(item)}
              >
                <div className="po-card-row-1">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    <ItemImageThumb src={null} alt={item.item_code} size={40} />
                    <div style={{ minWidth: 0 }}>
                      <div style={mStyles.itemCode}>{item.item_code}</div>
                      <div style={mStyles.itemName} title={item.item_name}>{item.item_name || '—'}</div>
                    </div>
                  </div>
                  <span className={itemStatusBadgeClass(item.status)}>{item.status}</span>
                </div>
                <div className="po-card-row-2">
                  <span><strong>PO No.:</strong> {item.po_no}</span>
                  <span><strong>Date:</strong> {formatDate(item.po_date)}</span>
                  <span><strong>Qty:</strong> {item.received_qty || 0} / {item.qty}</span>
                </div>
                <div className="po-card-actions" onClick={(e) => e.stopPropagation()}>
                  {renderItemActions(item)}
                </div>
              </div>
            ))
          ) : (
            <div className="no-items-message">
              <p>No forwarded items yet.</p>
            </div>
          )}
        </div>
      </div>

      {/* ============ SUBMITTED SLIPS ============ */}
      <div className="daily-items-section">
        <div className="daily-items-header">
          <h4>📄 My Submitted Stock Transfer Slips</h4>
          <span className="daily-items-count">
            {slips.length} slip{slips.length === 1 ? '' : 's'}
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
                      <span className="po-no-big sts-color" style={{ fontSize: 16 }}>{s.sts_no}</span>
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
                {slipStatusFilter === 'All'
                  ? 'You have not submitted any Stock Transfer Slips yet.'
                  : 'No slips match the current filters.'}
              </p>
            </div>
          )}
        </div>

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
                  <span className="po-no-big sts-color" style={{ fontSize: 18 }}>{s.sts_no}</span>
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
                {slipStatusFilter === 'All'
                  ? 'You have not submitted any Stock Transfer Slips yet.'
                  : 'No slips match the current filters.'}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ============ PO DETAIL MODAL ============ */}
      {poDetail && (
        <div className="pod-overlay" style={mStyles.overlay} onClick={closePoDetail}>
          <div className="pod-card" style={mStyles.card} onClick={(e) => e.stopPropagation()}>
            <div style={mStyles.header}>
              <div style={mStyles.headerLeft}>
                <div style={{ ...mStyles.headerIcon, background: 'linear-gradient(135deg, #00e0d4 0%, #008a82 100%)', boxShadow: '0 4px 12px rgba(0, 210, 200, 0.32)' }}>📥</div>
                <div style={{ minWidth: 0 }}>
                  <h3 style={mStyles.headerTitle}>{poDetail.po_no}</h3>
                  <div style={mStyles.headerSub}>
                    {poDetail.vendor_name && (
                      <>
                        <span>{poDetail.vendor_name}</span>
                        <span style={mStyles.headerDot}>·</span>
                      </>
                    )}
                    <span>All items on this PO</span>
                  </div>
                </div>
              </div>
              <button type="button" className="pod-close" onClick={closePoDetail} style={mStyles.closeBtn}>✕</button>
            </div>

            <div className="pod-body" style={mStyles.body}>
              {rejectedSlipsByPO[poDetail.po_no] && (
                <div style={mStyles.rejectBanner}>
                  <div style={{ fontWeight: 700, marginBottom: 4 }}>
                    ⚠️ Last transfer ({rejectedSlipsByPO[poDetail.po_no].sts_no}) was rejected
                  </div>
                  <div style={{ fontSize: 13, lineHeight: 1.5 }}>
                    {rejectedSlipsByPO[poDetail.po_no].rejection_reason || 'No reason given.'}
                  </div>
                  <div style={{ fontSize: 11, marginTop: 6, fontStyle: 'italic', opacity: 0.85 }}>
                    by {rejectedSlipsByPO[poDetail.po_no].rejected_by || '—'} ·{' '}
                    {formatDateTime(rejectedSlipsByPO[poDetail.po_no].rejected_at)}
                  </div>
                </div>
              )}

              <div className="pod-meta-grid" style={mStyles.metaGrid}>
                <div style={mStyles.metaBox}><div style={mStyles.metaLabel}>PO Date</div><div style={mStyles.metaValue}>{formatDate(poDetail.po_date)}</div></div>
                <div style={mStyles.metaBox}><div style={mStyles.metaLabel}>PR No.</div><div style={mStyles.metaValue}>{poDetail.pr_no || '—'}</div></div>
                <div style={mStyles.metaBox}><div style={mStyles.metaLabel}>Vendor</div><div style={mStyles.metaValue}>{poDetail.vendor_name || '—'}</div></div>
                <div style={mStyles.metaBox}><div style={mStyles.metaLabel}>Forwarded By</div><div style={mStyles.metaValue}>{poDetail.forwarded_by || '—'}</div></div>
                <div style={mStyles.metaBox}><div style={mStyles.metaLabel}>Forwarded At</div><div style={mStyles.metaValue}>{formatDateTime(poDetail.forwarded_at)}</div></div>
              </div>

              <div style={mStyles.sectionHead}>
                <span style={mStyles.sectionTitle}>
                  📦 All Items on this PO <span style={mStyles.sectionCount}>({poDetailLines.length})</span>
                </span>
                <span style={mStyles.summaryChip}>Total qty: {poDetailTotalQty}</span>
              </div>

              <div style={mStyles.tableWrap}>
                <table style={mStyles.table}>
                  <thead>
                    <tr>
                      <th style={mStyles.th}>Item</th>
                      <th style={{ ...mStyles.th, textAlign: 'center' }}>UOM</th>
                      <th style={{ ...mStyles.th, textAlign: 'center' }}>Received</th>
                      <th style={{ ...mStyles.th, textAlign: 'center' }}>Status</th>
                      <th style={mStyles.th}>Price</th>
                    </tr>
                  </thead>
                  <tbody>
                    {poDetailLoading ? (
                      <tr><td colSpan={5} style={{ textAlign: 'center', padding: 24 }}>Loading…</td></tr>
                    ) : poDetailLines.length > 0 ? (
                      poDetailLines.map((l, idx) => (
                        <tr key={l.id ?? idx} style={mStyles.row}>
                          <td style={mStyles.tdItem}>
                            <div style={mStyles.itemCell}>
                              <ItemImageThumb src={poDetailImages[l.item_code]} alt={l.item_code} size={44} />
                              <div style={{ minWidth: 0, flex: 1 }}>
                                <div style={mStyles.itemCode}>{l.item_code}</div>
                                <div style={mStyles.itemName} title={l.item_name}>{l.item_name || '—'}</div>
                              </div>
                            </div>
                          </td>
                          <td style={{ ...mStyles.td, textAlign: 'center' }}><span style={mStyles.uomTag}>{l.uom || '—'}</span></td>
                          <td style={{ ...mStyles.td, textAlign: 'center', fontWeight: 600 }}>{Number(l.received_qty) || 0}</td>
                          <td style={{ ...mStyles.td, textAlign: 'center' }}>
                            <span className={itemStatusBadgeClass(l.status)}>{l.status}</span>
                          </td>
                          <td style={mStyles.td}>{l.unit_price != null ? `${Number(l.unit_price).toFixed(2)} ${l.currency || ''}` : '—'}</td>
                        </tr>
                      ))
                    ) : (
                      <tr><td colSpan={5} style={{ textAlign: 'center', padding: 24 }}>No lines found.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div style={mStyles.nextStepBox}>
                <div style={mStyles.nextStepLabel}>🎯 What's next</div>
                <div style={mStyles.nextStepValue}>{nextStepFor(poDetail.status)}</div>
              </div>

              <div style={mStyles.sectionHead}>
                <span style={mStyles.sectionTitle}>
                  🕐 Activity Timeline{' '}
                  <span style={mStyles.sectionCount}>({poDetailActivity.length})</span>
                </span>
              </div>

              {poDetailActivityLoading ? (
                <div style={{ padding: 16, textAlign: 'center', color: '#64748b', fontSize: 13 }}>
                  Loading activity…
                </div>
              ) : poDetailActivity.length === 0 ? (
                <div style={{ padding: 16, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
                  No activity recorded yet for this PO.
                </div>
              ) : (
                <div style={mStyles.timelineWrap}>
                  {poDetailActivity.map((evt, idx) => {
                    const isLast = idx === poDetailActivity.length - 1;
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
                            <span style={mStyles.timelineActor}>{evt.actor || 'System'}</span>
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
              <button type="button" className="cancel-btn" onClick={closePoDetail}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* ============ STS DETAIL MODAL ============ */}
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
              <button type="button" className="pod-close" onClick={closeSlipDetail} disabled={cancelling} style={mStyles.closeBtn}>✕</button>
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
              <button type="button" className="cancel-btn" onClick={closeSlipDetail} disabled={cancelling}>Close</button>
              {detail.status === 'Pending' && (
                <button
                  type="button"
                  onClick={() => handleCancelSlip(detail)}
                  disabled={cancelling}
                  style={mStyles.cancelBtn}
                >
                  {cancelling ? 'Cancelling…' : '🚫 Cancel Slip'}
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
// Modal + per-item inline styles
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
    color: '#fff',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 22, boxShadow: '0 4px 12px rgba(99, 102, 241, 0.32)',
    flexShrink: 0,
  },
  headerTitle: {
    margin: 0,
    fontSize: 'clamp(18px, 1.8vw, 22px)',
    fontWeight: 700, color: '#0f172a',
    fontFamily: "'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace",
    letterSpacing: '-0.01em', lineHeight: 1.2,
  },
  headerSub: {
    fontSize: 'clamp(11px, 1vw, 13px)',
    color: '#64748b', marginTop: 4,
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
    gap: 'clamp(12px, 1.4vw, 16px)',
    background: '#ffffff',
  },
  footer: {
    display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10,
    padding: 'clamp(12px, 1.5vw, 16px) clamp(18px, 2.4vw, 26px)',
    borderTop: '1px solid #e5e7eb',
    background: '#f8fafc',
    flexShrink: 0, flexWrap: 'wrap',
  },
  rejectBanner: {
    padding: '12px 16px',
    background: '#fef2f2',
    border: '1px solid #fecaca',
    borderRadius: 10,
    color: '#991b1b',
  },
  routeGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr auto 1fr',
    gap: 12, alignItems: 'center',
  },
  routeBox: {
    padding: '14px 16px',
    background: 'linear-gradient(135deg, #f0fdfa 0%, #ecfeff 100%)',
    border: '1px solid #99f6e4', borderRadius: 10, textAlign: 'center',
  },
  routeLabel: {
    fontSize: 10, fontWeight: 700, color: '#0f766e',
    textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4,
  },
  routeValue: {
    fontSize: 'clamp(15px, 1.5vw, 18px)', fontWeight: 700, color: '#0f172a',
    fontFamily: "'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace",
  },
  routeSub: { fontSize: 12, color: '#475569', marginTop: 2 },
  routeArrow: { fontSize: 24, color: '#0f766e', fontWeight: 700 },
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
    fontSize: 10, fontWeight: 700, color: '#64748b',
    textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3,
  },
  metaValue: { fontSize: 13, fontWeight: 600, color: '#0f172a', wordBreak: 'break-word' },
  remarksBox: {
    padding: '12px 14px',
    background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8,
  },
  remarksLabel: {
    fontSize: 10, fontWeight: 700, color: '#92400e',
    textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4,
  },
  remarksValue: { fontSize: 13, color: '#78350f', lineHeight: 1.5, whiteSpace: 'pre-wrap' },
  approvedBox: {
    padding: '12px 14px',
    background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8,
  },
  approvedLabel: {
    fontSize: 11, fontWeight: 700, color: '#1e40af',
    textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3,
  },
  approvedValue: { fontSize: 13, color: '#1e3a8a' },
  rejectInfo: {
    padding: '12px 14px',
    background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8,
  },
  rejectInfoLabel: {
    fontSize: 11, fontWeight: 700, color: '#991b1b',
    textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4,
  },
  rejectInfoValue: { fontSize: 13, color: '#7f1d1d', lineHeight: 1.5, whiteSpace: 'pre-wrap' },
  rejectInfoMeta: { fontSize: 11, color: '#b91c1c', marginTop: 6, fontStyle: 'italic' },
  completedBox: {
    padding: '12px 14px',
    background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 8,
  },
  completedLabel: {
    fontSize: 11, fontWeight: 700, color: '#065f46',
    textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3,
  },
  completedValue: { fontSize: 13, color: '#065f46' },
  cancelledBox: {
    padding: '12px 14px',
    background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: 8,
  },
  cancelledLabel: {
    fontSize: 11, fontWeight: 700, color: '#475569',
    textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3,
  },
  cancelledValue: { fontSize: 13, color: '#475569' },
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
  timelineWrap: { display: 'flex', flexDirection: 'column', padding: '4px 0' },
  timelineItem: { display: 'flex', gap: 14, alignItems: 'flex-start' },
  timelineRail: {
    display: 'flex', flexDirection: 'column',
    alignItems: 'center', flexShrink: 0, width: 32,
  },
  timelineDot: {
    width: 28, height: 28, borderRadius: '50%',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: '#ffffff', fontSize: 13, fontWeight: 700,
  },
  timelineDotIcon: { fontSize: 13, lineHeight: 1 },
  timelineLine: {
    width: 2, flex: 1, minHeight: 24,
    background: '#e2e8f0', margin: '2px 0',
  },
  timelineBody: { flex: 1, paddingBottom: 14, minWidth: 0 },
  timelineSummary: {
    fontSize: 13, fontWeight: 600, color: '#0f172a',
    lineHeight: 1.4, wordBreak: 'break-word',
  },
  timelineMeta: {
    marginTop: 4, fontSize: 11, color: '#64748b',
    display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6,
  },
  timelineActor: {
    fontFamily: "'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace",
    fontWeight: 600, color: '#475569',
  },
  timelineDotSep: { color: '#cbd5e1' },
  timelineTypeChip: {
    display: 'inline-block', padding: '1px 7px',
    border: '1px solid', borderRadius: 999,
    fontSize: 10, fontWeight: 700,
    letterSpacing: '0.04em', textTransform: 'uppercase',
  },
  sectionHead: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    gap: 12, flexWrap: 'wrap', marginTop: 4,
  },
  sectionTitle: { fontSize: 14, fontWeight: 700, color: '#0f172a' },
  sectionCount: { color: '#64748b', fontWeight: 500 },
  summaryChip: {
    fontSize: 12, fontWeight: 600, padding: '5px 12px',
    background: '#eef2ff', color: '#4338ca', borderRadius: 999,
  },
  tableWrap: {
    overflow: 'auto', maxHeight: '38vh',
    border: '1px solid #e2e8f0', borderRadius: 10, background: '#fff',
  },
  table: {
    width: '100%', borderCollapse: 'collapse', minWidth: 560, fontSize: 13,
  },
  th: {
    padding: '10px 12px', textAlign: 'left',
    fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
    letterSpacing: '0.06em', color: '#64748b', background: '#f8fafc',
    borderBottom: '1px solid #e2e8f0',
    position: 'sticky', top: 0, zIndex: 1, whiteSpace: 'nowrap',
  },
  row: { borderBottom: '1px solid #f1f5f9' },
  td: { padding: '8px 12px', color: '#0f172a', verticalAlign: 'middle' },
  tdNum: {
    padding: '8px 12px', color: '#64748b', fontWeight: 700,
    fontFamily: "'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace",
    fontSize: 12,
  },
  tdItem: { padding: '8px 12px', verticalAlign: 'middle', minWidth: 200 },
  itemCell: { display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 },
  itemCode: {
    fontWeight: 700, fontSize: 12,
    fontFamily: "'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace",
    color: '#4338ca', lineHeight: 1.2,
  },
  itemName: {
    fontSize: 11, color: '#475569', marginTop: 1,
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    lineHeight: 1.3,
  },
  qtyText: {
    fontWeight: 700, fontSize: 14,
    fontFamily: "'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace",
    color: '#0f172a',
  },
  dmgTag: {
    display: 'inline-block',
    marginLeft: 6, padding: '1px 6px',
    background: '#fee2e2', color: '#991b1b',
    border: '1px solid #fca5a5', borderRadius: 999,
    fontSize: 10, fontWeight: 700,
  },
  uomTag: {
    display: 'inline-block', padding: '2px 8px',
    background: '#f1f5f9', color: '#334155',
    borderRadius: 6, fontSize: 10, fontWeight: 600,
    fontFamily: "'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace",
  },
  cancelBtn: {
    padding: '10px 22px',
    background: 'linear-gradient(135deg, #ef4444 0%, #b91c1c 100%)',
    color: '#ffffff', border: 'none', borderRadius: 8,
    fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
    boxShadow: '0 4px 12px rgba(239, 68, 68, 0.32)',
    transition: 'transform 0.15s ease, box-shadow 0.2s ease',
  },
};

// ============================================================
// Tab CSS
// ============================================================
const tabCss = `
@keyframes tabFadeIn { from { opacity: 0 } to { opacity: 1 } }
@keyframes tabSlideUp {
  from { opacity: 0; transform: translateY(16px) scale(0.98) }
  to   { opacity: 1; transform: translateY(0) scale(1) }
}

.po-compact-table { width: 100%; min-width: 900px; table-layout: fixed; }

/* Per-item table columns */
.po-compact-table.po-table-item .col-item    { width: 26%; }
.po-compact-table.po-table-item .col-po-no   { width: 14%; }
.po-compact-table.po-table-item .col-po-date { width: 12%; }
.po-compact-table.po-table-item .col-pr-no   { width: 10%; }
.po-compact-table.po-table-item .col-qty     { width: 12%; }
.po-compact-table.po-table-item .col-status  { width: 14%; }
.po-compact-table.po-table-item .col-actions { width: 22%; }

/* Submitted slips table */
.po-compact-table.po-table-sts .col-sts-no  { width: 22%; }
.po-compact-table.po-table-sts .col-po-no   { width: 16%; }
.po-compact-table.po-table-sts .col-date    { width: 22%; }
.po-compact-table.po-table-sts .col-status  { width: 18%; }
.po-compact-table.po-table-sts .col-actions { width: 22%; }

.po-compact-table thead th,
.po-compact-table tbody td { text-align: left; }

.po-compact-table thead th.col-actions,
.po-compact-table tbody td.col-actions {
  text-align: right;
  padding-left: 4px;
  padding-right: 12px;
}

.po-compact-table thead th {
  padding: 14px 16px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: #475569;
  text-transform: uppercase;
}

.po-compact-table tbody td {
  padding: 14px 16px;
  font-size: 14px;
  vertical-align: middle;
}

.po-no-big {
  display: inline-block;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-weight: 700;
  color: #0f766e;
  letter-spacing: 0.02em;
  line-height: 1.2;
  word-break: break-word;
}
.po-no-big.sts-color { color: #4338ca; }

.po-clickable-row { cursor: pointer; transition: background 0.15s ease; }
.po-clickable-row:hover { background: #f0fdfa !important; }
.po-clickable-row:active { background: #e6fffb !important; }

.po-compact-table .col-actions .action-buttons {
  justify-content: flex-end;
  gap: 6px;
  flex-wrap: nowrap;
}
.po-compact-table .col-actions .action-btn {
  padding: 8px 14px;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
}

.po-view-hint {
  display: inline-block;
  font-size: 13px;
  font-weight: 600;
  color: #0f766e;
  padding: 7px 12px;
  border: 1px solid #99f6e4;
  background: #f0fdfa;
  border-radius: 8px;
  white-space: nowrap;
  cursor: pointer;
  font-family: inherit;
  transition: background 0.15s ease, border-color 0.15s ease, transform 0.1s ease;
}
.po-view-hint:hover { background: #ccfbf1; border-color: #5eead4; }
.po-view-hint:active { transform: scale(0.97); }
.po-view-hint:focus-visible { outline: 2px solid #00d2c8; outline-offset: 2px; }

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

.pending-transfer-chip {
  display: inline-block;
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 700;
  background: #fef3c7;
  color: #92400e;
  border: 1px solid #fcd34d;
  white-space: nowrap;
  cursor: help;
}

.rejected-chip {
  display: inline-block;
  padding: 8px 10px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 700;
  background: #fee2e2;
  color: #991b1b;
  border: 1px solid #fca5a5;
  white-space: nowrap;
}

.po-rejected-dot {
  margin-left: 6px;
  font-size: 14px;
  cursor: help;
  vertical-align: middle;
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
  flex-wrap: wrap;
}

.pod-close:hover { background: #f1f5f9; color: #0f172a; }
.pod-body::-webkit-scrollbar { width: 8px; }
.pod-body::-webkit-scrollbar-track { background: #f1f5f9; border-radius: 4px; }
.pod-body::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 4px; }
.pod-body::-webkit-scrollbar-thumb:hover { background: #94a3b8; }

@media (max-width: 900px) {
  .po-compact-table thead th,
  .po-compact-table tbody td { padding: 10px 12px; }
  .po-compact-table .col-actions .action-btn { font-size: 12px; padding: 6px 10px; }
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
  .po-no-big { font-size: 15px; }
  .po-compact-table .col-actions .action-btn { font-size: 12px; padding: 6px 10px; }
}

@media (prefers-reduced-motion: reduce) {
  .pod-card, .pod-overlay { animation: none !important; }
  .po-card, .po-clickable-row { transition: none !important; }
  .po-view-hint { transition: none !important; }
}
`;

export default TabStockTransfer;