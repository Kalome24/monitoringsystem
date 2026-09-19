// src/components/handler/TabReceivedPO.jsx
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
  'Partial With Handler',
  'With Handler',
  'Pending Transfer',
  'Transferred',
  'Stored',
];

// ============================================================
// Helpers
// ============================================================
const formatTotal = (v) => {
  if (v === '' || v === null || v === undefined) return '-';
  const n = Number(v);
  if (Number.isNaN(n)) return '-';
  return n.toFixed(2);
};

const formatPrice = (v, currency) => {
  if (v === '' || v === null || v === undefined) return '—';
  const n = Number(v);
  if (Number.isNaN(n)) return '—';
  return `${n.toFixed(2)}${currency ? ` ${currency}` : ''}`;
};

const formatDateTime = (v) => {
  if (!v) return '—';
  try {
    return new Date(v).toLocaleString();
  } catch {
    return v;
  }
};

const poStatusBadgeClass = (status) => {
  if (status === 'Partial With Handler') return 'status-badge partial';
  if (status === 'With Handler')         return 'status-badge partial';
  if (status === 'Pending Transfer')     return 'status-badge pending-transfer';
  if (status === 'Transferred')          return 'status-badge active';
  if (status === 'Stored')               return 'status-badge active';
  return 'status-badge';
};

const nextStepFor = (status) => {
  switch (status) {
    case 'Pending':                return 'Waiting for the Registrar to receive items from the vendor.';
    case 'Partial Received':       return 'Registrar needs to receive the remaining items.';
    case 'Complete':               return 'Ready to be sent to the Stock Handler.';
    case 'Complete (with damage)': return 'Ready to be sent to the Stock Handler (with damage logged).';
    case 'With Handler':           return 'Stock Handler can create a Stock Transfer Slip.';
    case 'Partial With Handler':   return 'Stock Handler can transfer the received qty; more may arrive later.';
    case 'Pending Transfer':       return 'Waiting for the Department Head to approve or reject the transfer. You can cancel it from the row actions.';
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
const TabReceivedPO = () => {
  const { can } = usePermissions();
  const currentUser = getUser();
  const userWarehouseId = currentUser?.warehouse_assigned;

  const [assignedWarehouse, setAssignedWarehouse] = useState(null);
  const [warehouseLoading, setWarehouseLoading] = useState(false);
  const [allWarehouses, setAllWarehouses] = useState([]);

  const [purchaseOrders, setPurchaseOrders] = useState([]);
  const [itemRows, setItemRows] = useState([]);
  const [itemImages, setItemImages] = useState({});
  const [poLoading, setPoLoading] = useState(false);

  const [searchTerm, setSearchTerm]     = useState('');
  const [startDate, setStartDate]       = useState('');
  const [endDate, setEndDate]           = useState('');
  const [statusFilter, setStatusFilter] = useState('All');

  const [rejectedSlipsByPO, setRejectedSlipsByPO] = useState({});
  const [pendingSlipsByPO,  setPendingSlipsByPO]  = useState({});

  const [cancellingPo, setCancellingPo] = useState(null);

  const [transferPO, setTransferPO]               = useState(null);
  const [transferLines, setTransferLines]         = useState([]);
  const [transferRejection, setTransferRejection] = useState(null);
  const [transferLoading, setTransferLoading]     = useState(false);

  const [poDetail, setPoDetail]               = useState(null);
  const [poDetailLines, setPoDetailLines]     = useState([]);
  const [poDetailLoading, setPoDetailLoading] = useState(false);
  const [poDetailImages, setPoDetailImages]   = useState({});
  const [poDetailActivity, setPoDetailActivity] = useState([]);
  const [poDetailActivityLoading, setPoDetailActivityLoading] = useState(false);

  // ============================================================
  // Load warehouses
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

  // ============================================================
  // Warehouse info
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

  // ============================================================
  // Load PO list, then fetch details and flatten to item rows.
  //
  // CHANGE: capture l.status as item_status on each flattened row.
  // ============================================================
  const loadReceivedItems = useCallback(async () => {
    setPoLoading(true);
    try {
      const [poRes, rejRes, penRes] = await Promise.all([
        importPoApi.listPOs({
          warehouse_id: userWarehouseId,
          start_date: startDate || undefined,
          end_date: endDate || undefined,
        }),
        stockTransferApi.listSTSs({ scope: 'mine', status: 'Rejected' }),
        stockTransferApi.listSTSs({ scope: 'mine', status: 'Pending' }),
      ]);

      const pos = poRes.ok ? (Array.isArray(poRes.data) ? poRes.data : []) : [];
      const handlerPOs = pos.filter((po) => HANDLER_STATUSES.includes(po.status));
      setPurchaseOrders(handlerPOs);

      if (rejRes.ok && Array.isArray(rejRes.data)) {
        const map = {};
        for (const s of rejRes.data) {
          if (s.po_no && !map[s.po_no]) map[s.po_no] = s;
        }
        setRejectedSlipsByPO(map);
      } else {
        setRejectedSlipsByPO({});
      }

      if (penRes.ok && Array.isArray(penRes.data)) {
        const map = {};
        for (const s of penRes.data) {
          if (s.po_no && !map[s.po_no]) map[s.po_no] = s;
        }
        setPendingSlipsByPO(map);
      } else {
        setPendingSlipsByPO({});
      }

      const detailResults = await Promise.all(
        handlerPOs.map(async (po) => {
          try {
            const r = await importPoApi.getPODetail(po.po_no);
            return { po, lines: r.ok && Array.isArray(r.data) ? r.data : [] };
          } catch {
            return { po, lines: [] };
          }
        })
      );

      const rows = [];
      for (const { po, lines } of detailResults) {
        for (const l of lines) {
          const received = Number(l.received_qty) || 0;
          const damaged  = Number(l.damaged_qty)  || 0;
          const rowKey = `${po.po_no}::${
            l.id != null
              ? `id_${l.id}`
              : `syn_${l.item_code ?? Math.random().toString(36).slice(2)}`
          }`;
          rows.push({
            rowKey,
            id:            l.id,
            item_code:     l.item_code,
            item_name:     l.item_name,
            uom:           l.uom,
            received_qty:  received,
            damaged_qty:   damaged,
            remaining_qty: Math.max(0, received - damaged),
            unit_price:    l.unit_price,
            currency:      l.currency,
            item_status:   l.status || '',   // ← NEW: the item's own status
            // Reference fields (used for actions + modal)
            po_no:         po.po_no,
            po_status:     po.status,        // kept for reference
            po_date:       po.po_date,
            pr_no:         po.pr_no,
            vendor_name:   po.vendor_name,
          });
        }
      }
      setItemRows(rows);

      const codes = [...new Set(rows.map((r) => r.item_code).filter(Boolean))];
      if (codes.length > 0) {
        try {
          const imgRes = await itemMasterApi.getImagesByCodes(codes);
          if (imgRes.ok && imgRes.data?.images) {
            setItemImages(imgRes.data.images);
          }
        } catch (e) {
          console.warn('Could not load item images:', e);
        }
      }
    } finally {
      setPoLoading(false);
    }
  }, [userWarehouseId, startDate, endDate]);

  useEffect(() => { loadReceivedItems(); }, [loadReceivedItems]);

  // ============================================================
  // Client-side filter — now based on ITEM status (was PO status)
  // ============================================================
  const filteredItemRows = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return itemRows.filter((r) => {
      if (statusFilter !== 'All' && r.item_status !== statusFilter) return false;
      if (!q) return true;
      return (
        (r.item_code   || '').toLowerCase().includes(q) ||
        (r.item_name   || '').toLowerCase().includes(q) ||
        (r.po_no       || '').toLowerCase().includes(q) ||
        (r.pr_no       || '').toLowerCase().includes(q) ||
        (r.vendor_name || '').toLowerCase().includes(q)
      );
    });
  }, [itemRows, statusFilter, searchTerm]);

  const poByNo = useMemo(() => {
    const m = {};
    for (const po of purchaseOrders) m[po.po_no] = po;
    return m;
  }, [purchaseOrders]);

  // ============================================================
  // Counts — now count ITEMS, not POs
  // ============================================================
  const pendingTransferCount = useMemo(
    () => itemRows.filter((r) => r.item_status === 'Pending Transfer').length,
    [itemRows]
  );

  const rejectedCount = useMemo(
    () =>
      itemRows.filter(
        (r) =>
          (r.item_status === 'With Handler' || r.item_status === 'Partial With Handler') &&
          !!rejectedSlipsByPO[r.po_no]
      ).length,
    [itemRows, rejectedSlipsByPO]
  );

  // ============================================================
  // Cancel the pending transfer for a PO
  // ============================================================
  const handleCancelPendingTransfer = async (poOrRow) => {
    const po_no = poOrRow?.po_no;
    if (!po_no) return;

    const pending = pendingSlipsByPO[po_no];
    if (!pending) {
      alert('⚠️ Could not find the pending transfer for this item. Try refreshing the list.');
      return;
    }

    const ok = window.confirm(
      `Cancel the pending transfer ${pending.sts_no} for PO ${po_no}?\n\n` +
      `From: ${pending.from_warehouse_code || '—'}\n` +
      `To:   ${pending.to_warehouse_code || '—'}\n\n` +
      `The slip will be cancelled and the item(s) will be unlocked.\n\n` +
      `Proceed?`
    );
    if (!ok) return;

    setCancellingPo(po_no);
    try {
      const res = await stockTransferApi.cancelSTS(pending.sts_id);
      if (!res.ok || !res.data?.success) {
        alert('❌ ' + (res.data?.message || 'Failed to cancel the transfer.'));
        return;
      }
      alert('✅ Pending transfer cancelled. The item is now open for a new transfer.');
      await loadReceivedItems();
    } catch (err) {
      console.error(err);
      alert('❌ Error cancelling the transfer.');
    } finally {
      setCancellingPo(null);
    }
  };

  // ============================================================
  // Transfer modal — ITEM-LEVEL
  // Passes just ONE line so each item is transferred independently
  // ============================================================
  const handleOpenTransferForItem = (row) => {
    setTransferPO({
      po_no: row.po_no,
      po_date: row.po_date,
      vendor_name: row.vendor_name,
    });
    setTransferLines([{
      id:           row.id,
      item_code:    row.item_code,
      item_name:    row.item_name,
      uom:          row.uom,
      received_qty: row.received_qty,
      damaged_qty:  row.damaged_qty,
      unit_price:   row.unit_price,
      currency:     row.currency,
      status:       row.item_status,
    }]);
    setTransferRejection(rejectedSlipsByPO[row.po_no] || null);
  };

  // Legacy: used by the PO detail modal footer
  const handleOpenTransfer = async (po) => {
    if (!po) return;
    setTransferLoading(true);
    try {
      const res = await importPoApi.getPODetail(po.po_no);
      if (!res.ok || !Array.isArray(res.data)) {
        alert('❌ Could not load PO details.');
        return;
      }
      setTransferPO({
        po_no: po.po_no,
        po_date: po.po_date,
        vendor_name: po.vendor_name,
      });
      setTransferLines(res.data);
      setTransferRejection(rejectedSlipsByPO[po.po_no] || null);
    } catch (err) {
      console.error(err);
      alert('❌ Error loading PO.');
    } finally {
      setTransferLoading(false);
    }
  };

  const handleCloseTransfer = () => {
    setTransferPO(null);
    setTransferLines([]);
    setTransferRejection(null);
  };

  const handleTransferSubmitted = async () => {
    await loadReceivedItems();
  };

  // ============================================================
  // PO detail modal (read-only)
  // ============================================================
  const handleOpenPoDetail = async (po) => {
    if (!po) return;
    setPoDetailLoading(true);
    setPoDetailActivityLoading(true);
    setPoDetailImages({});
    setPoDetailActivity([]);
    try {
      const [res, actRes] = await Promise.all([
        importPoApi.getPODetail(po.po_no),
        importPoApi.getPOActivity(po.po_no),
      ]);

      if (!res.ok || !Array.isArray(res.data)) {
        alert('❌ Could not load PO details.');
        return;
      }
      setPoDetail(po);
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

  const handleOpenItemRow = (row) => {
    const po = poByNo[row.po_no];
    if (po) handleOpenPoDetail(po);
  };

  const closePoDetail = () => {
    setPoDetail(null);
    setPoDetailLines([]);
    setPoDetailImages({});
    setPoDetailActivity([]);
  };

  const handleOpenStore = (poOrRow) => {
    if (!poOrRow) return;
    const label = poOrRow.item_code
      ? `${poOrRow.item_code} (PO ${poOrRow.po_no})`
      : poOrRow.po_no;
    alert(
      `🏬 Store — ${label}\n\n` +
      `The Store form has not been implemented yet.`
    );
  };

  const clearPoFilters = () => {
    setSearchTerm('');
    setStartDate('');
    setEndDate('');
    setStatusFilter('All');
  };

  const poDetailTotalQty = useMemo(() => {
    if (!poDetailLines.length) return 0;
    return poDetailLines.reduce((sum, l) => sum + (Number(l.qty) || 0), 0);
  }, [poDetailLines]);

  // ============================================================
  // ITEM-LEVEL actions — used in the table rows
  // ============================================================
  const renderItemActions = (row) => {
    const isPending     = row.item_status === 'Pending Transfer';
    const isTransferred = row.item_status === 'Transferred' || row.item_status === 'Stored';
    const actionable    =
      (row.item_status === 'With Handler' || row.item_status === 'Partial With Handler') &&
      can('stocktransfer.create');
    const hasRejection  = !!rejectedSlipsByPO[row.po_no];
    const isCancelling  = cancellingPo === row.po_no;

    if (isPending) {
      const pending = pendingSlipsByPO[row.po_no];
      return (
        <div className="action-buttons">
          <span className="pending-transfer-chip" title="Awaiting Department Head approval">
            ⏳ Awaiting approval
          </span>
          {pending && (
            <button
              type="button"
              className="action-btn deactivate-btn"
              onClick={(e) => { e.stopPropagation(); handleCancelPendingTransfer(row); }}
              disabled={isCancelling}
              title="Cancel this pending transfer and unlock the item"
            >
              {isCancelling ? 'Cancelling…' : 'Cancel Transfer'}
            </button>
          )}
          <button
            type="button"
            className="po-view-hint"
            onClick={(e) => { e.stopPropagation(); handleOpenItemRow(row); }}
            title="View full details"
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
          onClick={(e) => { e.stopPropagation(); handleOpenItemRow(row); }}
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
            title={`Last transfer was rejected: ${rejectedSlipsByPO[row.po_no]?.rejection_reason || 'see slip for details'}`}
          >
            ⚠️ Rejected
          </span>
        )}
        <button
          className="action-btn edit"
          onClick={(e) => { e.stopPropagation(); handleOpenTransferForItem(row); }}
          disabled={transferLoading}
          title={hasRejection ? 'Edit and resubmit' : 'Transfer this item'}
        >
          {transferLoading ? '…' : hasRejection ? 'Re-transfer' : 'Transfer'}
        </button>
        <button
          className="action-btn"
          onClick={(e) => { e.stopPropagation(); handleOpenStore(row); }}
          title="Store this item"
        >
          Store
        </button>
      </div>
    );
  };

  // ============================================================
  // PO-LEVEL actions — used only in the PO detail modal footer
  // ============================================================
  const renderPoActions = (po) => {
    if (!po) {
      return <span style={{ color: '#94a3b8', fontSize: 12 }}>—</span>;
    }

    const actionable =
      po.status === 'With Handler' || po.status === 'Partial With Handler';
    const hasRejection = !!rejectedSlipsByPO[po.po_no];
    const isCancelling = cancellingPo === po.po_no;

    if (po.status === 'Pending Transfer') {
      return (
        <div className="action-buttons">
          <span className="pending-transfer-chip" title="Awaiting Department Head approval">
            ⏳ Awaiting approval
          </span>
          <button
            type="button"
            className="action-btn deactivate-btn"
            onClick={(e) => { e.stopPropagation(); handleCancelPendingTransfer(po); }}
            disabled={isCancelling}
          >
            {isCancelling ? 'Cancelling…' : 'Cancel Transfer'}
          </button>
        </div>
      );
    }

    if (!actionable || !can('stocktransfer.create')) {
      return null;
    }

    return (
      <div className="action-buttons">
        {hasRejection && (
          <span className="rejected-chip">⚠️ Rejected</span>
        )}
        <button
          className="action-btn edit"
          onClick={(e) => { e.stopPropagation(); handleOpenTransfer(po); }}
          disabled={transferLoading}
        >
          {transferLoading ? '…' : hasRejection ? 'Re-transfer' : 'Transfer'}
        </button>
        <button
          className="action-btn"
          onClick={(e) => { e.stopPropagation(); handleOpenStore(po); }}
        >
          Store
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
        <h3>📥 Received Items</h3>
        <div className="header-actions">
          <span className="item-count">
            Total: {filteredItemRows.length} item{filteredItemRows.length === 1 ? '' : 's'}
          </span>
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
          Each row is a single <strong>item</strong>. Items sharing the same PO No.
          are listed separately and can be transferred independently. Click any row
          to see the parent PO, vendor, and full activity timeline.
        </span>
      </div>

      {pendingTransferCount > 0 && (
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
            <strong>{pendingTransferCount}</strong>{' '}
            item{pendingTransferCount === 1 ? ' is' : 's are'} locked pending Department
            Head approval. Other items remain transferable.
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
            item{rejectedCount === 1 ? ' has' : 's have'} a rejected transfer. Open the
            Transfer modal to review the Department Head's remarks before resubmitting.
          </span>
        </div>
      )}

      <div className="dashboard-search-section">
        <div className="dashboard-filters">
          <div className="filter-row">
            <div className="filter-group search-group">
              <label>Search</label>
              <input
                type="text"
                placeholder="Search item code, item name, PO No., PR No., or vendor..."
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
                <option value="All">All (forwarded)</option>
                <option value="Partial With Handler">Partial With Handler</option>
                <option value="With Handler">With Handler</option>
                <option value="Pending Transfer">Pending Transfer</option>
                <option value="Transferred">Transferred</option>
                <option value="Stored">Stored</option>
              </select>
            </div>
            <div className="filter-group action-group">
              <button className="cancel-btn" onClick={clearPoFilters} style={{ padding: '8px 16px' }}>Clear Filters</button>
              <button className="add-user-btn" onClick={loadReceivedItems} style={{ padding: '8px 16px' }}>Refresh</button>
            </div>
          </div>
        </div>
      </div>

      <div className="daily-items-section">
        <div className="daily-items-header">
          <h4>Received Item Lines</h4>
          <span className="daily-items-count">
            {filteredItemRows.length} item{filteredItemRows.length === 1 ? '' : 's'}
          </span>
        </div>

        {/* Desktop table */}
        <div className="table-wrapper po-desktop-only">
          {poLoading ? (
            <div className="loading-spinner" style={{ margin: '20px auto' }} />
          ) : filteredItemRows.length > 0 ? (
            <table className="data-table items-received-table">
              <thead>
                <tr>
                  <th className="col-item">Item</th>
                  <th className="col-qty">Qty</th>
                  <th className="col-price">Price</th>
                  <th className="col-status">Status</th>
                  <th className="col-actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredItemRows.map((row) => {
                  const hasRejection =
                    !!rejectedSlipsByPO[row.po_no] &&
                    (row.item_status === 'With Handler' || row.item_status === 'Partial With Handler');

                  return (
                    <tr
                      key={row.rowKey}
                      onClick={() => handleOpenItemRow(row)}
                      className="po-clickable-row"
                      title="Click to view the parent PO details"
                    >
                      <td className="col-item">
                        <div className="item-cell">
                          <ItemImageThumb
                            src={itemImages[row.item_code]}
                            alt={row.item_code}
                            size={44}
                          />
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div className="item-code-line">
                              <span className="item-code">{row.item_code}</span>
                              {hasRejection && (
                                <span
                                  className="po-rejected-dot"
                                  title={`Last transfer rejected: ${rejectedSlipsByPO[row.po_no]?.rejection_reason || 'no reason given'}`}
                                >
                                  ⚠️
                                </span>
                              )}
                            </div>
                            <div className="item-name" title={row.item_name}>
                              {row.item_name || '—'}
                            </div>
                            <div className="item-po-chip" title="Parent PO">
                              PO {row.po_no}
                              {row.uom ? <> · {row.uom}</> : null}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="col-qty">
                        <span className="qty-big">{row.received_qty}</span>
                      </td>
                      <td className="col-price">
                        {formatPrice(row.unit_price, row.currency)}
                      </td>
                      <td className="col-status">
                        {/* ⬅ CHANGED: uses the ITEM's own status, not the PO aggregate */}
                        <span className={poStatusBadgeClass(row.item_status)}>
                          {row.item_status}
                        </span>
                      </td>
                      <td className="col-actions" onClick={(e) => e.stopPropagation()}>
                        {renderItemActions(row)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <div className="no-items-message">
              <p>
                No received items yet. Once a Registrar receives a PO and clicks
                "Send to Handler", its items will appear here.
              </p>
            </div>
          )}
        </div>

        {/* Mobile cards */}
        <div className="po-mobile-only">
          {poLoading ? (
            <div className="loading-spinner" style={{ margin: '20px auto' }} />
          ) : filteredItemRows.length > 0 ? (
            filteredItemRows.map((row) => (
              <div
                key={row.rowKey}
                className="po-card"
                onClick={() => handleOpenItemRow(row)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && handleOpenItemRow(row)}
              >
                <div className="po-card-row-1">
                  <div className="item-cell" style={{ flex: 1, minWidth: 0 }}>
                    <ItemImageThumb
                      src={itemImages[row.item_code]}
                      alt={row.item_code}
                      size={44}
                    />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="item-code">{row.item_code}</div>
                      <div className="item-name" title={row.item_name}>
                        {row.item_name || '—'}
                      </div>
                      <div className="item-po-chip">PO {row.po_no}</div>
                    </div>
                  </div>
                  {/* ⬅ CHANGED: item-level status */}
                  <span className={poStatusBadgeClass(row.item_status)}>
                    {row.item_status}
                  </span>
                </div>
                <div className="po-card-row-2">
                  <span><strong>Qty:</strong> {row.received_qty}</span>
                  {row.uom ? <span><strong>UOM:</strong> {row.uom}</span> : null}
                  <span><strong>Price:</strong> {formatPrice(row.unit_price, row.currency)}</span>
                </div>
                <div className="po-card-actions" onClick={(e) => e.stopPropagation()}>
                  {renderItemActions(row)}
                </div>
              </div>
            ))
          ) : (
            <div className="no-items-message">
              <p>No received items yet.</p>
            </div>
          )}
        </div>
      </div>

      {/* ============================================================
          PO DETAIL MODAL — reached by clicking an item row
          ============================================================ */}
      {poDetail && (
        <div className="pod-overlay" style={mStyles.overlay} onClick={closePoDetail}>
          <div className="pod-card" style={mStyles.card} onClick={(e) => e.stopPropagation()}>
            <div style={mStyles.header}>
              <div style={mStyles.headerLeft}>
                <div style={{ ...mStyles.headerIcon, background: 'linear-gradient(135deg, #00e0d4 0%, #008a82 100%)', boxShadow: '0 4px 12px rgba(0, 210, 200, 0.32)' }}>📥</div>
                <div style={{ minWidth: 0 }}>
                  <h3 style={mStyles.headerTitle}>{poDetail.po_no}</h3>
                  <div style={mStyles.headerSub}>
                    <span className={poStatusBadgeClass(poDetail.status)}>{poDetail.status}</span>
                    {poDetail.vendor_name && (
                      <>
                        <span style={mStyles.headerDot}>·</span>
                        <span>{poDetail.vendor_name}</span>
                      </>
                    )}
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
                <div style={mStyles.metaBox}><div style={mStyles.metaLabel}>PO Date</div><div style={mStyles.metaValue}>{poDetail.po_date || '—'}</div></div>
                <div style={mStyles.metaBox}><div style={mStyles.metaLabel}>PR No.</div><div style={mStyles.metaValue}>{poDetail.pr_no || '—'}</div></div>
                <div style={mStyles.metaBox}><div style={mStyles.metaLabel}>Buyer</div><div style={mStyles.metaValue}>{poDetail.buyer || '—'}</div></div>
                <div style={mStyles.metaBox}><div style={mStyles.metaLabel}>Vendor</div><div style={mStyles.metaValue}>{poDetail.vendor_name || '—'}</div></div>
                <div style={mStyles.metaBox}><div style={mStyles.metaLabel}>Total Amount</div><div style={mStyles.metaValue}>{formatTotal(poDetail.total_amount)}</div></div>
                <div style={mStyles.metaBox}><div style={mStyles.metaLabel}>Forwarded By</div><div style={mStyles.metaValue}>{poDetail.forwarded_by || '—'}</div></div>
                <div style={mStyles.metaBox}><div style={mStyles.metaLabel}>Forwarded At</div><div style={mStyles.metaValue}>{formatDateTime(poDetail.forwarded_at)}</div></div>
              </div>

              <div style={mStyles.sectionHead}>
                <span style={mStyles.sectionTitle}>
                  📦 PO Lines <span style={mStyles.sectionCount}>({poDetailLines.length})</span>
                </span>
                <span style={mStyles.summaryChip}>Total qty: {poDetailTotalQty}</span>
              </div>

              <div className="pod-table-wrap" style={mStyles.tableWrap}>
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
                            <span className={poStatusBadgeClass(l.status)}>{l.status}</span>
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
              <button type="button" className="cancel-btn" onClick={closePoDetail}>Close</button>
              {renderPoActions(poDetail)}
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

  rejectBanner: {
    padding: '12px 16px',
    background: '#fef2f2', border: '1px solid #fecaca',
    borderRadius: 10, color: '#991b1b',
    flexShrink: 0,
  },

  metaGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: 12,
    flexShrink: 0,
  },
  metaBox: { padding: '10px 14px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8 },
  metaLabel: { fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 },
  metaValue: { fontSize: 13, fontWeight: 600, color: '#0f172a', wordBreak: 'break-word' },

  sectionHead: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    gap: 12, flexWrap: 'wrap', marginTop: 4,
    flexShrink: 0,
  },
  sectionTitle: { fontSize: 14, fontWeight: 700, color: '#0f172a' },
  sectionCount: { color: '#64748b', fontWeight: 500 },
  summaryChip: { fontSize: 12, fontWeight: 600, padding: '5px 12px', background: '#eef2ff', color: '#4338ca', borderRadius: 999 },

  tableWrap: {
    overflow: 'auto',
    flexShrink: 0,
    minHeight: 90,
    border: '1px solid #e2e8f0',
    borderRadius: 10,
    background: '#fff',
  },
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
  tdItem: { padding: '8px 12px', verticalAlign: 'middle', minWidth: 200 },
  itemCell: { display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 },
  itemCode: { fontWeight: 700, fontSize: 12, fontFamily: "'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace", color: '#4338ca', lineHeight: 1.2 },
  itemName: { fontSize: 11, color: '#475569', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.3 },
  uomTag: { display: 'inline-block', padding: '2px 8px', background: '#f1f5f9', color: '#334155', borderRadius: 6, fontSize: 10, fontWeight: 600, fontFamily: "'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace" },

  nextStepBox: {
    padding: '12px 16px',
    background: 'linear-gradient(135deg, #eef2ff 0%, #e0e7ff 100%)',
    border: '1px solid #c7d2fe', borderRadius: 10,
    flexShrink: 0,
  },
  nextStepLabel: { fontSize: 10, fontWeight: 700, color: '#4338ca', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 },
  nextStepValue: { fontSize: 13, fontWeight: 600, color: '#1e1b4b', lineHeight: 1.5 },

  timelineWrap: {
    display: 'flex', flexDirection: 'column', padding: '4px 0',
    flexShrink: 0,
  },
  timelineItem: { display: 'flex', gap: 14, alignItems: 'flex-start' },
  timelineRail: { display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0, width: 32 },
  timelineDot: { width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ffffff', fontSize: 13, fontWeight: 700 },
  timelineDotIcon: { fontSize: 13, lineHeight: 1 },
  timelineLine: { width: 2, flex: 1, minHeight: 24, background: '#e2e8f0', margin: '2px 0' },
  timelineBody: { flex: 1, paddingBottom: 14, minWidth: 0 },
  timelineSummary: { fontSize: 13, fontWeight: 600, color: '#0f172a', lineHeight: 1.4, wordBreak: 'break-word' },
  timelineMeta: { marginTop: 4, fontSize: 11, color: '#64748b', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  timelineActor: { fontFamily: "'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace", fontWeight: 600, color: '#475569' },
  timelineDotSep: { color: '#cbd5e1' },
  timelineTypeChip: { display: 'inline-block', padding: '1px 7px', border: '1px solid', borderRadius: 999, fontSize: 10, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase' },
};

// ============================================================
// Responsive CSS
// ============================================================
const tabCss = `
@keyframes tabFadeIn { from { opacity: 0 } to { opacity: 1 } }
@keyframes tabSlideUp { from { opacity: 0; transform: translateY(16px) scale(0.98) } to { opacity: 1; transform: translateY(0) scale(1) } }

.items-received-table {
  width: 100%;
  min-width: 780px;
  table-layout: fixed;
}

.items-received-table .col-item    { width: 40%; }
.items-received-table .col-qty     { width: 10%; text-align: center; }
.items-received-table .col-price   { width: 15%; }
.items-received-table .col-status  { width: 15%; }
.items-received-table .col-actions { width: 20%; text-align: right; }

.items-received-table thead th {
  padding: 14px 16px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: #475569;
  text-align: left;
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
  white-space: nowrap;
}
.items-received-table thead th.col-qty     { text-align: center; }
.items-received-table thead th.col-actions { text-align: right; }

.items-received-table tbody td {
  padding: 14px 16px;
  font-size: 14px;
  vertical-align: middle;
  border-bottom: 1px solid #f1f5f9;
}

.items-received-table tbody td.col-qty     { text-align: center; }
.items-received-table tbody td.col-actions { text-align: right; }

.items-received-table .item-cell {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}
.items-received-table .item-code-line {
  display: flex;
  align-items: center;
  gap: 6px;
}
.items-received-table .item-code {
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-weight: 700;
  font-size: 14px;
  color: #4338ca;
  letter-spacing: 0.01em;
  line-height: 1.2;
}
.items-received-table .item-name {
  font-size: 12px;
  color: #475569;
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 1.3;
}
.items-received-table .item-po-chip {
  display: inline-block;
  margin-top: 4px;
  padding: 2px 8px;
  font-size: 10px;
  font-weight: 600;
  color: #0f766e;
  background: #f0fdfa;
  border: 1px solid #99f6e4;
  border-radius: 999px;
  letter-spacing: 0.02em;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
}

.items-received-table .qty-big {
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-size: 18px;
  font-weight: 700;
  color: #0f172a;
}

.items-received-table .col-price {
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-size: 13px;
  color: #334155;
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

.pod-table-wrap {
  max-height: 50vh;
}

@media (max-height: 720px) {
  .pod-table-wrap {
    max-height: 55vh;
  }
}

.items-received-table .col-actions .action-buttons {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 6px;
  width: 100%;
}

.items-received-table .col-actions .action-buttons > * {
  width: 100%;
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  white-space: normal;
  word-break: break-word;
  line-height: 1.2;
  margin: 0;
  padding: 9px 12px;
  font-size: 13px;
  font-weight: 600;
}

.items-received-table .col-actions > .po-view-hint {
  width: 100%;
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  white-space: normal;
  word-break: break-word;
  padding: 9px 12px;
  font-size: 13px;
  font-weight: 600;
}

.items-received-table .col-actions .pending-transfer-chip,
.items-received-table .col-actions .rejected-chip {
  white-space: normal;
  word-break: break-word;
  padding: 9px 12px;
  font-size: 13px;
  font-weight: 700;
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

.pending-transfer-chip {
  display: inline-block;
  padding: 8px 14px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  background: #fef3c7;
  color: #92400e;
  border: 1px solid #fcd34d;
  white-space: normal;
  word-break: break-word;
}

.rejected-chip {
  display: inline-block;
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 700;
  background: #fee2e2;
  color: #991b1b;
  border: 1px solid #fca5a5;
  white-space: normal;
  word-break: break-word;
}

.po-rejected-dot {
  margin-left: 4px;
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
  align-items: flex-start;
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
  flex-direction: column;
  align-items: stretch;
  gap: 6px;
  padding-top: 10px;
  border-top: 1px dashed #e5e7eb;
}
.po-card-actions > .action-buttons {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
}
.po-card-actions > button,
.po-card-actions > .action-buttons > * {
  width: 100%;
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  white-space: normal;
  word-break: break-word;
  padding: 11px 14px;
  font-size: 14px;
  font-weight: 600;
}

.pod-close:hover { background: #f1f5f9; color: #0f172a; }
.pod-body::-webkit-scrollbar { width: 8px; }
.pod-body::-webkit-scrollbar-track { background: #f1f5f9; border-radius: 4px; }
.pod-body::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 4px; }
.pod-body::-webkit-scrollbar-thumb:hover { background: #94a3b8; }

@media (max-width: 900px) {
  .items-received-table thead th { padding: 12px 10px; font-size: 11px; }
  .items-received-table tbody td { padding: 12px 10px; font-size: 13px; }
  .items-received-table .item-code { font-size: 12px; }
  .items-received-table .qty-big   { font-size: 16px; }
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
}

@media (prefers-reduced-motion: reduce) {
  .pod-card, .pod-overlay { animation: none !important; }
  .po-card, .po-clickable-row { transition: none !important; }
  .po-view-hint { transition: none !important; }
}
`;

export default TabReceivedPO;