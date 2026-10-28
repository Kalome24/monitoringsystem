// src/components/registrar/TabItemsReceived.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FiInbox,
  FiGlobe,
  FiX,
  FiAlertTriangle,
  FiCheckCircle,
  FiRefreshCw,
  FiPackage,
  FiTarget,
  FiClock,
  FiDownload,
  FiArrowRight,
  FiTruck,
  FiXCircle,
  FiSlash,
  FiAward,
  FiCircle,
  FiFilter,
  FiLoader,
} from 'react-icons/fi';
import { usePermissions } from '../../permissions/usePermissions';
import { getUser } from '../../secure/auth';
import { warehouseApi, importPoApi, itemMasterApi } from '../../services/api';
import { useToast } from '../shared/ToastProvider';
import ReceivePoModal from './ReceivePoModal';
import ItemImageThumb from '../shared/ItemImageThumb';

const PO_PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 300;

// ============================================================
// Helpers
// ============================================================
const formatTotal = (v) => {
  if (v === '' || v === null || v === undefined) return '-';
  const n = Number(v);
  if (Number.isNaN(n)) return '-';
  return n.toFixed(3);
};

const fmtNum = (v, dp = 2) => {
  if (v === '' || v === null || v === undefined) return '—';
  const n = Number(v);
  if (Number.isNaN(n)) return '—';
  return n.toFixed(dp);
};

const formatDateTime = (v) => {
  if (!v) return '—';
  try {
    return new Date(v).toLocaleString();
  } catch {
    return v;
  }
};

const formatDate = (v) => {
  if (v === '' || v === null || v === undefined) return '—';
  const s = String(v);
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : s;
};

const relativeTime = (v) => {
  if (!v) return '—';
  const then = new Date(v).getTime();
  if (!Number.isFinite(then)) return '—';
  const diff = Date.now() - then;
  if (diff < 0) return 'just now';
  const s = Math.floor(diff / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  try {
    return new Date(v).toLocaleDateString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
    });
  } catch {
    return String(v);
  }
};

const initialsOf = (name) => {
  const s = String(name || '').trim();
  if (!s) return '—';
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

const avatarTone = (name) => {
  const s = String(name || '');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
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

const isPartialDelivery = (s) => s === 'Partial' || s === 'Partial Received';

const deliveryBadgeClass = (s) =>
  isPartialDelivery(s)
    ? 'deliv-badge deliv-badge--partial'
    : 'deliv-badge deliv-badge--complete';

const isPrBased = (r) => Number(r.has_po) === 0;

const nextStepFor = (status) => {
  switch (status) {
    case 'Pending':                return 'Waiting for you to receive items from the vendor.';
    case 'Partial Received':       return 'Receive the remaining items, or send the received qty to the Stock Handler.';
    case 'Complete':               return 'Ready to be sent to the Stock Handler.';
    case 'Complete (with damage)': return 'Ready to be sent to the Stock Handler.';
    case 'With Handler':           return 'Ready to store received items in the target storage locator.';
    case 'Partial With Handler':   return 'Stock Handler can transfer the received qty; more may arrive later.';
    case 'Pending Transfer':       return 'Waiting for the Department Head to approve or reject the transfer.';
    case 'Transferred':            return 'All received items have been transferred. No further action needed.';
    case 'Stored':                 return 'Items stored. Ready for transfer request or withdrawal.';
    default:                       return '—';
  }
};

const activityIcon = (eventType) => {
  switch (eventType) {
    case 'Imported':           return FiDownload;
    case 'Received':           return FiPackage;
    case 'Forwarded':          return FiArrowRight;
    case 'TransferSubmitted':  return FiTruck;
    case 'TransferApproved':   return FiCheckCircle;
    case 'TransferRejected':   return FiXCircle;
    case 'TransferCancelled':  return FiSlash;
    case 'TransferCompleted':  return FiAward;
    default:                   return FiCircle;
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
  const toast = useToast();

  const [assignedWarehouse, setAssignedWarehouse] = useState(null);
  const [warehouseLoading, setWarehouseLoading] = useState(false);

  const [purchaseOrders, setPurchaseOrders] = useState([]);
  const [poLoading, setPoLoading] = useState(false);
  const [totalPOs, setTotalPOs] = useState(0);
  const [page, setPage] = useState(1);

  /* Raw search state (as typed) + debounced search state (what we send). */
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  const [startDate, setStartDate]           = useState('');
  const [endDate, setEndDate]               = useState('');
  const [statusFilter, setStatusFilter]     = useState('All');
  const [deliveryFilter, setDeliveryFilter] = useState('All');
  /* PO Type filter: 'All' | '1' (with PO) | '0' (without PO / PR-based) */
  const [poTypeFilter, setPoTypeFilter]     = useState('All');

  const [receivePO, setReceivePO]           = useState(null);
  const [receiveLines, setReceiveLines]     = useState([]);
  const [receiveLoading, setReceiveLoading] = useState(false);

  const [forwardingPo, setForwardingPo] = useState(null);

  const [detail, setDetail]               = useState(null);
  const [detailLines, setDetailLines]     = useState([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailImages, setDetailImages]   = useState({});
  const [detailActivity, setDetailActivity] = useState([]);
  const [detailActivityLoading, setDetailActivityLoading] = useState(false);

  /* Request-id guard so a slow response can't overwrite a newer one. */
  const reqIdRef = useRef(0);

  /* Debounce the search box so typing doesn't fire one request per keystroke. */
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(searchTerm);
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [searchTerm]);

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

  /**
   * Fetch the list. All filters are ANDed together server-side via
   * the /import-po GET route:
   *   status          → import_po.status = @status
   *   search          → po_no / vendor_name / pr_no LIKE @search
   *   delivery_status → HAVING on delivery_status IN (…)
   *   has_po          → import_po.has_po = @has_po
   *   start_date      → po_date >= @start_date
   *   end_date        → po_date <= @end_date
   */
  const loadPurchaseOrders = useCallback(async () => {
    const myReqId = ++reqIdRef.current;
    setPoLoading(true);
    try {
      const res = await importPoApi.listPOs({
        status:          statusFilter === 'All' ? undefined : statusFilter,
        /* Send the debounced + trimmed search, not the raw keystroke value. */
        search:          debouncedSearch.trim() || undefined,
        delivery_status: deliveryFilter === 'All' ? undefined : deliveryFilter,
        has_po:          poTypeFilter !== 'All' ? poTypeFilter : undefined,
        start_date:      startDate || undefined,
        end_date:        endDate   || undefined,
        page,
        limit:           PO_PAGE_SIZE,
      });

      /* Ignore stale responses. */
      if (myReqId !== reqIdRef.current) return;

      if (res.ok) {
        setPurchaseOrders(Array.isArray(res.data) ? res.data : []);
        setTotalPOs(Number(res.total) || 0);
      } else {
        console.error('Failed to load POs:', res);
        setPurchaseOrders([]);
        setTotalPOs(0);
      }
    } finally {
      if (myReqId === reqIdRef.current) setPoLoading(false);
    }
  }, [statusFilter, debouncedSearch, deliveryFilter, poTypeFilter, startDate, endDate, page]);

  useEffect(() => {
    loadPurchaseOrders();
  }, [loadPurchaseOrders]);

  const totalPages = Math.max(1, Math.ceil(totalPOs / PO_PAGE_SIZE));
  const firstItem  = totalPOs === 0 ? 0 : (page - 1) * PO_PAGE_SIZE + 1;
  const lastItem   = Math.min(totalPOs, page * PO_PAGE_SIZE);

  const goToPage = (n) => {
    const clamped = Math.max(1, Math.min(totalPages, n));
    if (clamped !== page) setPage(clamped);
  };

  const handleOpenReceive = async (po) => {
    setReceiveLoading(true);
    try {
      const res = await importPoApi.getPODetail(po.po_no);
      if (!res.ok || !Array.isArray(res.data)) {
        toast.error('Could not load PO details.');
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
      toast.error('Error loading PO.');
    } finally {
      setReceiveLoading(false);
    }
  };

  const handleCloseReceive = () => {
    setReceivePO(null);
    setReceiveLines([]);
  };

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
        toast.error('Could not load PO details.');
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

  const handleForward = async (po) => {
    const confirmMsg =
      `Send your warehouse's lines to the Stock Handler?\n\n` +
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
        toast.error(res.data?.message || 'Failed to send to handler.');
        return;
      }
      toast.success(res.data.message || 'PO sent to Stock Handler.');
      await loadPurchaseOrders();
      if (detail && detail.po_no === po.po_no) closeDetail();
    } catch (err) {
      console.error(err);
      toast.error('Error sending PO to handler.');
    } finally {
      setForwardingPo(null);
    }
  };

  const handleSendToHandlerFromModal = async (poNo) => {
    try {
      const res = await importPoApi.forwardPO(poNo);
      if (!res.ok || !res.data?.success) {
        toast.error(res.data?.message || 'Failed to send to handler.');
        return false;
      }
      toast.success(res.data.message || 'PO sent to Stock Handler.');
      await loadPurchaseOrders();
      return true;
    } catch (err) {
      console.error(err);
      toast.error('Error sending PO to handler.');
      return false;
    }
  };

  const clearFilters = () => {
    setSearchTerm('');
    setDebouncedSearch('');
    setStartDate('');
    setEndDate('');
    setStatusFilter('All');
    setDeliveryFilter('All');
    setPoTypeFilter('All');
    setPage(1);
  };

  /* Note: no explicit setPage(1) in these handlers.
     React 18 batches state updates within one event handler, so a filter
     change + page reset still produce a single re-render and a single
     fetch. The debounced search effect already resets the page. */
  const onChangeSearchTerm = (v) => setSearchTerm(v);
  const onChangeStartDate  = (v) => { setStartDate(v);  setPage(1); };
  const onChangeEndDate    = (v) => { setEndDate(v);    setPage(1); };
  const onChangeStatus     = (v) => { setStatusFilter(v); setPage(1); };
  const onChangeDelivery   = (v) => { setDeliveryFilter(v); setPage(1); };
  const onChangePoType     = (v) => { setPoTypeFilter(v); setPage(1); };

  const renderRowActions = (po) => {
    const canReceive = can('importpo.receive');
    const isPending  = po.status === 'Pending';
    const isPartial  = po.status === 'Partial Received';
    const isPartialWithHandler = po.status === 'Partial With Handler';
    const isForwarding = forwardingPo === po.po_no;

    const myLineCount    = po.my_line_count ?? 0;
    const myCanForward   = po.my_can_forward === true;
    const myHasForwarded = po.my_has_forwarded === true;

    const canReceiveMore =
      canReceive &&
      (isPending || isPartial || isPartialWithHandler) &&
      !(myHasForwarded && !isPartialWithHandler);

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

  const anyNonPhpInDetail = detailLines.some((l) => l.currency && l.currency !== 'PHP');

  const hasActiveFilters =
    !!searchTerm || !!startDate || !!endDate ||
    statusFilter !== 'All' || deliveryFilter !== 'All' ||
    poTypeFilter !== 'All';

  return (
    <div className="items-section">
      <style>{detailModalCss}</style>

      {/* ============================================================
          SECTION HEADER — title + subtitle + refresh
         ============================================================ */}
      <div className="section-header air-head">
        <div className="air-head-left">
          <h3>
            <FiInbox className="air-heading-icon" />
            <span>Purchase Orders / Purchase Requests</span>
          </h3>
        </div>
        <div className="air-head-actions">
          <span className="air-head-pill">
            {totalPOs === 0
              ? 'No records yet'
              : `${totalPOs} record${totalPOs === 1 ? '' : 's'}`}
          </span>
          <button
            type="button"
            className="air-head-refresh"
            onClick={loadPurchaseOrders}
            disabled={poLoading}
            title="Refresh list"
          >
            <FiRefreshCw className={`air-head-refresh-icon${poLoading ? ' icon-spin' : ''}`} aria-hidden="true" />
            <span>{poLoading ? 'Loading…' : 'Refresh'}</span>
          </button>
        </div>
      </div>

      {/* Info banner about cross-warehouse visibility */}
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
        <span className="air-banner-icon air-banner-icon--info"><FiGlobe /></span>
        <span>
          These records are <strong>imported by the Registrar team</strong> and visible to
          every warehouse. Only your warehouse can send its own lines to the
          handler. Rows without a PO No. are shown as <strong>PR-based</strong> and
          grouped by their PR No.
        </span>
      </div>

      {/* ============================================================
          PO TYPE FILTER — prominent segment control
         ============================================================ */}
      <div className="air-type-filter-bar">
        <span className="air-type-filter-label">
          <FiFilter className="air-type-filter-label-icon" aria-hidden="true" />
          <span>Filter by type</span>
        </span>
        <div className="air-type-filter" role="group" aria-label="Filter by PO type">
          <button
            type="button"
            className={`air-type-filter-btn${poTypeFilter === 'All' ? ' is-active' : ''}`}
            onClick={() => onChangePoType('All')}
            aria-pressed={poTypeFilter === 'All'}
          >
            All
          </button>
          <button
            type="button"
            className={`air-type-filter-btn${poTypeFilter === '1' ? ' is-active' : ''}`}
            onClick={() => onChangePoType('1')}
            aria-pressed={poTypeFilter === '1'}
          >
            With PO
          </button>
          <button
            type="button"
            className={`air-type-filter-btn${poTypeFilter === '0' ? ' is-active' : ''}`}
            onClick={() => onChangePoType('0')}
            aria-pressed={poTypeFilter === '0'}
          >
            Without PO (PR-based)
          </button>
        </div>
      </div>

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

      <div className="dashboard-search-section air-filters-section">
        <div className="dashboard-filters air-filters">
          <div className="filter-row air-filter-row">
            <div className="filter-group search-group air-filter-group air-filter-group--search">
              <label htmlFor="air-search">Search</label>
              <input
                id="air-search"
                type="text"
                placeholder="Search PO No., PR No., or vendor..."
                value={searchTerm}
                onChange={(e) => onChangeSearchTerm(e.target.value)}
                className="filter-input air-filter-input"
              />
            </div>
            <div className="filter-group air-filter-group">
              <label htmlFor="air-start-date">Start Date</label>
              <input
                id="air-start-date"
                type="date"
                value={startDate}
                onChange={(e) => onChangeStartDate(e.target.value)}
                className="filter-input air-filter-input"
              />
            </div>
            <div className="filter-group air-filter-group">
              <label htmlFor="air-end-date">End Date</label>
              <input
                id="air-end-date"
                type="date"
                value={endDate}
                onChange={(e) => onChangeEndDate(e.target.value)}
                className="filter-input air-filter-input"
              />
            </div>
            <div className="filter-group air-filter-group">
              <label htmlFor="air-status">Status</label>
              <select
                id="air-status"
                value={statusFilter}
                onChange={(e) => onChangeStatus(e.target.value)}
                className="filter-input air-filter-input"
              >
                <option value="All">All Status</option>
                <option value="With Handler">With Handler</option>
                <option value="Pending Transfer">Pending Transfer</option>
                <option value="Transferred">Transferred</option>
                <option value="Stored">Stored</option>
              </select>
            </div>
            <div className="filter-group air-filter-group">
              <label htmlFor="air-delivery">Delivery</label>
              <select
                id="air-delivery"
                value={deliveryFilter}
                onChange={(e) => onChangeDelivery(e.target.value)}
                className="filter-input air-filter-input"
              >
                <option value="All">All deliveries</option>
                <option value="Complete">Complete</option>
                <option value="Partial">Partial</option>
              </select>
            </div>
            <div className="filter-group action-group air-filter-group air-filter-group--actions">
              <button
                className="cancel-btn air-filter-btn"
                onClick={clearFilters}
                disabled={!hasActiveFilters}
              >
                Clear Filters
              </button>
              <button className="add-user-btn air-filter-btn" onClick={loadPurchaseOrders}>
                Refresh
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="daily-items-section">
        {/* ---------- Rich section header with count pill ---------- */}
        <div className="air-list-header">
          <div className="air-list-header-left">
            <h4>Purchase Order &amp; PR Records</h4>
            <p className="air-list-sub">
              {totalPOs === 0
                ? 'Records will appear here as soon as the Registrar team imports them.'
                : `Showing ${firstItem}–${lastItem} of ${totalPOs} record${totalPOs === 1 ? '' : 's'}. Click any row for full details, its activity timeline, and available actions.`}
            </p>
          </div>
          <div className="air-list-header-right">
            {poLoading && (
              <span className="air-list-loading" aria-live="polite">
                <FiLoader className="air-list-loading-icon icon-spin" aria-hidden="true" />
                <span>Updating…</span>
              </span>
            )}
            <span className="air-list-count" aria-live="polite">
              {totalPOs === 0
                ? '0 PO/PR(s)'
                : `${totalPOs} PO/PR${totalPOs === 1 ? '' : 's'}`}
            </span>
          </div>
        </div>

        <div className="table-wrapper po-desktop-only">
          {poLoading && purchaseOrders.length === 0 ? (
            <div className="loading-spinner" style={{ margin: '20px auto' }} />
          ) : purchaseOrders.length > 0 ? (
            <table className="data-table po-compact-table">
              <thead>
                <tr>
                  <th className="col-po-no">PO / PR No.</th>
                  <th className="col-po-date">PO Date</th>
                  <th className="col-pr-no">PR No.</th>
                  <th className="col-my-lines">Your Lines</th>
                  <th className="col-status">Status</th>
                  <th className="col-actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {purchaseOrders.map((po) => {
                  const prBased = isPrBased(po);
                  const tone = avatarTone(po.vendor_name);
                  return (
                    <tr
                      key={po.po_no}
                      onClick={() => handleOpenDetail(po)}
                      className={`po-clickable-row${prBased ? ' is-pr-based' : ''}`}
                      title="Click to view full details"
                    >
                      <td className="col-po-no">
                        <div className="air-po-cell">
                          <span
                            className={`air-type-dot${prBased ? ' air-type-dot--pr' : ' air-type-dot--po'}`}
                            title={prBased ? 'PR-based (no PO No.)' : 'Has a real PO No.'}
                            aria-hidden="true"
                          />
                          <span className="po-no-big">{po.po_no}</span>
                          {prBased && (
                            <span
                              className="air-pr-pill"
                              title="No PO No. — grouped by PR No."
                            >
                              PR
                            </span>
                          )}
                        </div>
                        {po.vendor_name && (
                          <div className="air-po-vendor">
                            <span
                              className="air-vendor-avatar air-vendor-avatar--sm"
                              style={{
                                background: `hsl(${tone} 65% 92%)`,
                                color: `hsl(${tone} 55% 32%)`,
                                borderColor: `hsl(${tone} 55% 80%)`,
                              }}
                              aria-hidden="true"
                            >
                              {initialsOf(po.vendor_name)}
                            </span>
                            <span className="air-po-vendor-name" title={po.vendor_name}>
                              {po.vendor_name}
                            </span>
                          </div>
                        )}
                      </td>
                      <td className="col-po-date">
                        <div className="air-date-cell">
                          <span className="air-date-main">{formatDate(po.po_date)}</span>
                          {po.imported_at && (
                            <span className="air-date-rel" title={String(po.imported_at)}>
                              imported {relativeTime(po.imported_at)}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="col-pr-no">{po.pr_no || '—'}</td>
                      <td className="col-my-lines">{renderMyLines(po)}</td>
                      <td className="col-status">
                        <span className={statusBadgeClass(po.status)}>{po.status}</span>
                        {Number(po.partial_line_count) > 0 && (
                          <span
                            className="deliv-badge deliv-badge--partial aip-partial-inline"
                            title={`${po.partial_line_count} line(s) delivered partially`}
                          >
                            <FiAlertTriangle className="deliv-icon" />
                            <span>{po.partial_line_count}</span>
                          </span>
                        )}
                      </td>
                      <td className="col-actions" onClick={(e) => e.stopPropagation()}>
                        {renderRowActions(po)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            /* ---------- Enhanced empty state ---------- */
            <div className="air-empty">
              <div className="air-empty-icon-circle">
                <FiInbox className="air-empty-icon-svg" aria-hidden="true" />
              </div>
              <div className="air-empty-title">
                {poTypeFilter === 'All'
                  ? 'No purchase orders yet'
                  : poTypeFilter === '1'
                    ? 'No POs with a PO No. yet'
                    : 'No PR-based records yet'}
              </div>
              <div className="air-empty-sub">
                {poTypeFilter === 'All'
                  ? 'The Registrar team imports POs from the vendor files. As soon as they land, every warehouse can start receiving.'
                  : poTypeFilter === '1'
                    ? 'Once the Registrar team imports POs with a PO No., they’ll appear here.'
                    : 'PR-based records (rows without a PO No.) will appear here when they land.'}
              </div>
              <button
                type="button"
                className="air-empty-cta"
                onClick={loadPurchaseOrders}
                disabled={poLoading}
              >
                <FiRefreshCw className={`air-head-refresh-icon${poLoading ? ' icon-spin' : ''}`} aria-hidden="true" />
                <span>Refresh</span>
              </button>
            </div>
          )}
        </div>

        <div className="po-mobile-only">
          {poLoading && purchaseOrders.length === 0 ? (
            <div className="loading-spinner" style={{ margin: '20px auto' }} />
          ) : purchaseOrders.length > 0 ? (
            purchaseOrders.map((po) => {
              const prBased = isPrBased(po);
              const tone = avatarTone(po.vendor_name);
              return (
                <div
                  key={po.po_no}
                  className={`po-card${prBased ? ' is-pr-based' : ''}`}
                  onClick={() => handleOpenDetail(po)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && handleOpenDetail(po)}
                >
                  <div className="po-card-row-1">
                    <span className="po-no-big air-mobile-po">
                      <span
                        className={`air-type-dot${prBased ? ' air-type-dot--pr' : ' air-type-dot--po'}`}
                        aria-hidden="true"
                      />
                      {po.po_no}
                      {prBased && (
                        <span className="air-pr-pill" title="No PO No. — grouped by PR No.">PR</span>
                      )}
                    </span>
                    <span className={statusBadgeClass(po.status)}>{po.status}</span>
                  </div>
                  {po.vendor_name && (
                    <div className="air-po-vendor air-po-vendor--mobile">
                      <span
                        className="air-vendor-avatar air-vendor-avatar--sm"
                        style={{
                          background: `hsl(${tone} 65% 92%)`,
                          color: `hsl(${tone} 55% 32%)`,
                          borderColor: `hsl(${tone} 55% 80%)`,
                        }}
                        aria-hidden="true"
                      >
                        {initialsOf(po.vendor_name)}
                      </span>
                      <span className="air-po-vendor-name" title={po.vendor_name}>
                        {po.vendor_name}
                      </span>
                    </div>
                  )}
                  <div className="po-card-row-2">
                    <span><strong>PO Date:</strong> {formatDate(po.po_date)}</span>
                    <span><strong>PR No.:</strong> {po.pr_no || '—'}</span>
                    <span><strong>Your Lines:</strong> {renderMyLines(po)}</span>
                  </div>
                  <div className="po-card-actions" onClick={(e) => e.stopPropagation()}>
                    {renderRowActions(po)}
                  </div>
                </div>
              );
            })
          ) : (
            <div className="air-empty">
              <div className="air-empty-icon-circle">
                <FiInbox className="air-empty-icon-svg" aria-hidden="true" />
              </div>
              <div className="air-empty-title">
                {poTypeFilter === 'All'
                  ? 'No purchase orders yet'
                  : poTypeFilter === '1'
                    ? 'No POs with a PO No. yet'
                    : 'No PR-based records yet'}
              </div>
              <div className="air-empty-sub">
                {poTypeFilter === 'All'
                  ? 'The Registrar team imports POs from the vendor files. As soon as they land, every warehouse can start receiving.'
                  : poTypeFilter === '1'
                    ? 'Once the Registrar team imports POs with a PO No., they’ll appear here.'
                    : 'PR-based records (rows without a PO No.) will appear here when they land.'}
              </div>
              <button
                type="button"
                className="air-empty-cta"
                onClick={loadPurchaseOrders}
                disabled={poLoading}
              >
                <FiRefreshCw className={`air-head-refresh-icon${poLoading ? ' icon-spin' : ''}`} aria-hidden="true" />
                <span>Refresh</span>
              </button>
            </div>
          )}
        </div>

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
          DETAIL MODAL — multi-currency aware
          ============================================================ */}
      {detail && (
        <div className="pod-overlay" style={mStyles.overlay} onClick={closeDetail}>
          <div className="pod-card" style={mStyles.card} onClick={(e) => e.stopPropagation()}>
            <div style={mStyles.header}>
              <div style={mStyles.headerLeft}>
                <div style={mStyles.headerIcon}><FiInbox size={22} /></div>
                <div style={{ minWidth: 0 }}>
                  <h3 style={mStyles.headerTitle}>
                    {detail.po_no}
                    {isPrBased(detail) && (
                      <span
                        className="air-pr-pill air-pr-pill--modal"
                        title="No PO No. — grouped by PR No."
                      >
                        PR
                      </span>
                    )}
                  </h3>
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
              <button type="button" className="pod-close" onClick={closeDetail} style={mStyles.closeBtn} aria-label="Close">
                <FiX size={18} />
              </button>
            </div>

            <div className="pod-body" style={mStyles.body}>
              <div className="pod-meta-grid" style={mStyles.metaGrid}>
                <div style={mStyles.metaBox}>
                  <div style={mStyles.metaLabel}>Type</div>
                  <div style={mStyles.metaValue}>
                    {isPrBased(detail)
                      ? <span className="air-pr-pill air-pr-pill--inline">PR-based</span>
                      : <span className="air-type-pill air-type-pill--po">With PO</span>}
                  </div>
                </div>
                <div style={mStyles.metaBox}>
                  <div style={mStyles.metaLabel}>PO Date</div>
                  <div style={mStyles.metaValue}>{formatDate(detail.po_date)}</div>
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
                  <div style={mStyles.metaLabel}>Total (PHP)</div>
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
                  <FiPackage className="air-section-icon" />
                  <span>PO Lines <span style={mStyles.sectionCount}>({detailLines.length})</span></span>
                </span>
              </div>

              <div style={mStyles.tableWrap}>
                <table style={{ ...mStyles.table, minWidth: 1080 }}>
                  <thead>
                    <tr>
                      <th style={mStyles.th}>Item</th>
                      <th style={{ ...mStyles.th, textAlign: 'center' }}>UOM</th>
                      <th style={{ ...mStyles.th, textAlign: 'center' }}>Ordered</th>
                      <th style={{ ...mStyles.th, textAlign: 'center' }}>Delivered</th>
                      <th style={{ ...mStyles.th, textAlign: 'center' }}>Damaged</th>
                      <th style={{ ...mStyles.th, textAlign: 'center' }}>Curr</th>
                      <th style={mStyles.th}>Price</th>
                      <th style={{ ...mStyles.th, textAlign: 'right' }}>Forex</th>
                      <th style={{ ...mStyles.th, textAlign: 'right' }}>Func (PHP)</th>
                      <th style={{ ...mStyles.th, textAlign: 'center' }}>Delivery</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detailLoading ? (
                      <tr>
                        <td colSpan={10} style={{ textAlign: 'center', padding: 24 }}>
                          Loading…
                        </td>
                      </tr>
                    ) : detailLines.length > 0 ? (
                      detailLines.map((l, idx) => (
                        <tr key={l.id ?? `${l.item_code}-${idx}`} style={mStyles.row}>
                          <td style={mStyles.tdItem}>
                            <div style={mStyles.itemCell}>
                              <ItemImageThumb src={detailImages[l.item_code]} alt={l.item_code} size={44} />
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
                            {fmtNum(l.qty, 0)}
                          </td>
                          <td style={{ ...mStyles.td, textAlign: 'center', fontWeight: 600 }}>
                            {fmtNum(l.received_qty, 0)}
                          </td>
                          <td style={{ ...mStyles.td, textAlign: 'center' }}>
                            {l.damaged_qty > 0 ? (
                              <span style={mStyles.dmgBadge}>{l.damaged_qty}</span>
                            ) : (
                              <span style={{ color: '#a0a8b0' }}>—</span>
                            )}
                          </td>
                          <td style={{ ...mStyles.td, textAlign: 'center' }}>
                            <span style={mStyles.currTag}>{l.currency || 'PHP'}</span>
                          </td>
                          <td style={mStyles.td}>
                            {l.unit_price != null ? Number(l.unit_price).toFixed(2) : '—'}
                          </td>
                          <td style={{ ...mStyles.td, textAlign: 'right', fontFamily: "'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace", fontSize: 12 }}>
                            {l.forex != null ? Number(l.forex).toFixed(3) : '—'}
                          </td>
                          <td style={{ ...mStyles.td, textAlign: 'right', fontWeight: 700, fontFamily: "'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace", fontSize: 12 }}>
                            {fmtNum(l.func_amount, 3)}
                          </td>
                          <td style={{ ...mStyles.td, textAlign: 'center' }}>
                            <span className={deliveryBadgeClass(l.delivery_status)}>
                              {isPartialDelivery(l.delivery_status) ? (
                                <>
                                  <FiAlertTriangle className="deliv-icon" />
                                  <span>Partial</span>
                                </>
                              ) : (
                                <>
                                  <FiCheckCircle className="deliv-icon" />
                                  <span>Complete</span>
                                </>
                              )}
                            </span>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={10} style={{ textAlign: 'center', padding: 24 }}>
                          No lines found.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {anyNonPhpInDetail && (
                <div style={mStyles.fxNote}>
                  <FiRefreshCw className="air-fx-note-icon" />
                  <span>
                    Some lines use non-PHP currencies. <strong>Forex</strong> is the
                    rate applied at import. <strong>Func (PHP)</strong> ={' '}
                    <em>unit_price × delivered_qty × forex</em>.
                  </span>
                </div>
              )}

              <div style={mStyles.nextStepBox}>
                <div style={mStyles.nextStepLabel}>
                  <FiTarget className="air-next-step-icon" />
                  <span>What's next</span>
                </div>
                <div style={mStyles.nextStepValue}>{nextStepFor(detail.status)}</div>
              </div>

              <div style={mStyles.sectionHead}>
                <span style={mStyles.sectionTitle}>
                  <FiClock className="air-section-icon" />
                  <span>Activity Timeline{' '}
                    <span style={mStyles.sectionCount}>({detailActivity.length})</span>
                  </span>
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
                    const ActivityIcon = activityIcon(evt.event_type);
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
                            <ActivityIcon className="timeline-dot-icon" />
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
              <button type="button" className="cancel-btn" onClick={closeDetail}>
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
// Pagination component (unchanged)
// ============================================================
const Pagination = ({
  page, totalPages, totalItems, firstItem, lastItem,
  onPrev, onNext, onFirst, onLast, disabled,
}) => {
  const prevDisabled = disabled || page <= 1;
  const nextDisabled = disabled || page >= totalPages;

  return (
    <div style={pgStyles.wrap}>
      <div style={pgStyles.info}>
        Showing <strong>{firstItem}–{lastItem}</strong> of{' '}
        <strong>{totalItems}</strong> PO/PR{totalItems === 1 ? '' : 's'}
      </div>

      <div style={pgStyles.controls}>
        <button type="button" className="cancel-btn" onClick={onFirst} disabled={prevDisabled}
          style={{ ...pgStyles.btn, ...(prevDisabled ? pgStyles.btnDisabled : null) }} title="First page">« First</button>
        <button type="button" className="cancel-btn" onClick={onPrev} disabled={prevDisabled}
          style={{ ...pgStyles.btn, ...(prevDisabled ? pgStyles.btnDisabled : null) }} title="Previous page">‹ Prev</button>

        <span style={pgStyles.pageLabel}>
          Page <strong>{page}</strong> of <strong>{totalPages}</strong>
        </span>

        <button type="button" className="add-user-btn" onClick={onNext} disabled={nextDisabled}
          style={{ ...pgStyles.btn, ...(nextDisabled ? pgStyles.btnDisabled : null) }} title="Next page">Next ›</button>
        <button type="button" className="add-user-btn" onClick={onLast} disabled={nextDisabled}
          style={{ ...pgStyles.btn, ...(nextDisabled ? pgStyles.btnDisabled : null) }} title="Last page">Last »</button>
      </div>
    </div>
  );
};

const pgStyles = {
  wrap: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '14px 16px', marginTop: 16, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10 },
  info: { fontSize: 13, color: '#475569' },
  controls: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  btn: { padding: '8px 14px', fontSize: 13, fontWeight: 600, borderRadius: 8, cursor: 'pointer', whiteSpace: 'nowrap' },
  btnDisabled: { opacity: 0.5, cursor: 'not-allowed' },
  pageLabel: { fontSize: 13, color: '#334155', padding: '0 8px', fontFamily: "'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace" },
};

// ============================================================
// Modal styles
// ============================================================
const mStyles = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.62)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000, padding: 'clamp(8px, 2vw, 24px)', animation: 'podFadeIn 0.18s ease' },
  card: { background: '#ffffff', borderRadius: 'clamp(12px, 1.5vw, 18px)', width: '100%', maxWidth: 1180, maxHeight: '92vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 24px 64px rgba(15, 23, 42, 0.28), 0 4px 14px rgba(15, 23, 42, 0.14)', fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif", animation: 'podSlideUp 0.22s cubic-bezier(0.34, 1.3, 0.64, 1)' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: 'clamp(14px, 1.8vw, 20px) clamp(18px, 2.4vw, 26px)', borderBottom: '1px solid #e5e7eb', background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', flexShrink: 0 },
  headerLeft: { display: 'flex', alignItems: 'center', gap: 14, flex: 1, minWidth: 0 },
  headerIcon: { width: 44, height: 44, borderRadius: 12, background: 'linear-gradient(135deg, #00e0d4 0%, #008a82 100%)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 12px rgba(0, 210, 200, 0.32)', flexShrink: 0 },
  headerTitle: { margin: 0, fontSize: 'clamp(18px, 1.8vw, 22px)', fontWeight: 700, color: '#0f172a', fontFamily: "'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace", letterSpacing: '-0.01em', lineHeight: 1.2 },
  headerSub: { fontSize: 'clamp(11px, 1vw, 13px)', color: '#64748b', marginTop: 4, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  headerDot: { color: '#cbd5e1' },
  closeBtn: { background: 'transparent', border: 'none', width: 36, height: 36, borderRadius: 8, cursor: 'pointer', color: '#64748b', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, overflowY: 'auto', padding: 'clamp(16px, 2vw, 24px)', display: 'flex', flexDirection: 'column', gap: 'clamp(12px, 1.4vw, 16px)', background: '#ffffff' },
  footer: { display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10, padding: 'clamp(12px, 1.5vw, 16px) clamp(18px, 2.4vw, 26px)', borderTop: '1px solid #e5e7eb', background: '#f8fafc', flexShrink: 0, flexWrap: 'wrap' },
  metaGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 },
  metaBox: { padding: '10px 14px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8 },
  metaLabel: { fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 },
  metaValue: { fontSize: 13, fontWeight: 600, color: '#0f172a', wordBreak: 'break-word' },
  sectionHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginTop: 4 },
  sectionTitle: { fontSize: 14, fontWeight: 700, color: '#0f172a', display: 'inline-flex', alignItems: 'center', gap: 8 },
  sectionCount: { color: '#64748b', fontWeight: 500 },
  tableWrap: { overflow: 'auto', maxHeight: '46vh', border: '1px solid #e2e8f0', borderRadius: 10, background: '#fff' },
  table: { width: '100%', borderCollapse: 'collapse', minWidth: 1080, fontSize: 13 },
  th: { padding: '10px 12px', textAlign: 'left', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#64748b', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', position: 'sticky', top: 0, zIndex: 1, whiteSpace: 'nowrap' },
  row: { borderBottom: '1px solid #f1f5f9' },
  td: { padding: '8px 12px', color: '#0f172a', verticalAlign: 'middle' },
  tdItem: { padding: '8px 12px', verticalAlign: 'middle', minWidth: 220 },
  itemCell: { display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 },
  itemCode: { fontWeight: 700, fontSize: 12, fontFamily: "'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace", color: '#0f766e', lineHeight: 1.2 },
  itemName: { fontSize: 11, color: '#475569', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.3 },
  uomTag: { display: 'inline-block', padding: '2px 8px', background: '#f1f5f9', color: '#334155', borderRadius: 6, fontSize: 10, fontWeight: 600, fontFamily: "'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace" },
  dmgBadge: { display: 'inline-block', padding: '2px 8px', background: '#fee2e2', color: '#991b1b', border: '1px solid #fca5a5', borderRadius: 999, fontSize: 11, fontWeight: 700 },
  currTag: { display: 'inline-block', padding: '2px 8px', background: '#eef2ff', color: '#4338ca', border: '1px solid #c7d2fe', borderRadius: 6, fontSize: 10, fontWeight: 700, fontFamily: "'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace" },
  fxNote: {
    padding: '10px 14px', background: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: 8,
    fontSize: 12, color: '#1e1b4b', lineHeight: 1.5,
    display: 'flex', alignItems: 'flex-start', gap: 8,
  },
  nextStepBox: { padding: '12px 16px', background: 'linear-gradient(135deg, #eef2ff 0%, #e0e7ff 100%)', border: '1px solid #c7d2fe', borderRadius: 10 },
  nextStepLabel: { fontSize: 10, fontWeight: 700, color: '#4338ca', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4, display: 'inline-flex', alignItems: 'center', gap: 6 },
  nextStepValue: { fontSize: 13, fontWeight: 600, color: '#1e1b4b', lineHeight: 1.5 },
  timelineWrap: { display: 'flex', flexDirection: 'column', padding: '4px 0' },
  timelineItem: { display: 'flex', gap: 14, alignItems: 'flex-start' },
  timelineRail: { display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0, width: 32 },
  timelineDot: { width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ffffff' },
  timelineLine: { width: 2, flex: 1, minHeight: 24, background: '#e2e8f0', margin: '2px 0' },
  timelineBody: { flex: 1, paddingBottom: 14, minWidth: 0 },
  timelineSummary: { fontSize: 13, fontWeight: 600, color: '#0f172a', lineHeight: 1.4, wordBreak: 'break-word' },
  timelineMeta: { marginTop: 4, fontSize: 11, color: '#64748b', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  timelineActor: { fontFamily: "'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace", fontWeight: 600, color: '#475569' },
  timelineDotSep: { color: '#cbd5e1' },
  timelineTypeChip: { display: 'inline-block', padding: '1px 7px', border: '1px solid', borderRadius: 999, fontSize: 10, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase' },
};

// ============================================================
// Responsive CSS — enlarged for accessibility
// ============================================================
const detailModalCss = `
@keyframes podFadeIn { from { opacity: 0 } to { opacity: 1 } }
@keyframes podSlideUp { from { opacity: 0; transform: translateY(16px) scale(0.98) } to { opacity: 1; transform: translateY(0) scale(1) } }

/* ---------- Icon helpers ---------- */
.air-heading-icon {
  display: inline-flex; align-items: center; justify-content: center;
  width: 1em; height: 1em; margin-right: 8px; vertical-align: -0.15em;
  color: #1a1f26;
}
.air-heading-icon svg { width: 100%; height: 100%; stroke-width: 2.2; }

.air-banner-icon {
  display: inline-flex; align-items: center; justify-content: center;
  flex-shrink: 0; width: 18px; height: 18px;
}
.air-banner-icon svg { width: 100%; height: 100%; stroke-width: 2.2; }
.air-banner-icon--info { color: #1e3a8a; }

.air-section-icon { width: 16px; height: 16px; stroke-width: 2.2; color: #334155; flex-shrink: 0; }
.air-next-step-icon { width: 12px; height: 12px; stroke-width: 2.6; color: #4338ca; flex-shrink: 0; }
.air-fx-note-icon { width: 16px; height: 16px; stroke-width: 2.4; flex-shrink: 0; color: #4338ca; margin-top: 1px; }
.timeline-dot-icon { width: 14px; height: 14px; stroke-width: 2.4; color: #ffffff; }

/* ============================================================
   Section header
   ============================================================ */
.air-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: 16px;
}
.air-head-left { min-width: 0; flex: 1 1 320px; }
.air-head-left h3 {
  margin: 0 0 6px;
  display: inline-flex;
  align-items: center;
  font-size: clamp(18px, 1.7vw, 22px);
  font-weight: 800;
  color: #0f172a;
  letter-spacing: -0.01em;
}
.air-head-sub {
  margin: 0;
  font-size: 13.5px;
  color: #64748b;
  line-height: 1.55;
  max-width: 720px;
}
.air-head-sub strong { color: #334155; font-weight: 700; }
.air-head-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  flex-shrink: 0;
}
.air-head-pill {
  display: inline-flex;
  align-items: center;
  padding: 8px 16px;
  border-radius: 999px;
  background: #f1f5f9;
  color: #334155;
  border: 1px solid #e2e8f0;
  font-size: 13.5px;
  font-weight: 800;
  letter-spacing: 0.03em;
  white-space: nowrap;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
}
.air-head-refresh {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 10px 18px;
  border-radius: 8px;
  border: 1px solid #cbd5e1;
  background: #ffffff;
  color: #334155;
  font-size: 14px;
  font-weight: 700;
  font-family: inherit;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;
}
.air-head-refresh:hover:not(:disabled) {
  background: #f8fafc;
  border-color: #94a3b8;
}
.air-head-refresh:disabled { opacity: 0.55; cursor: not-allowed; }
.air-head-refresh-icon { width: 1em; height: 1em; stroke-width: 2.5; }

/* ============================================================
   PO TYPE segment control
   ============================================================ */
.air-type-filter-bar {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
  padding: 14px 18px;
  margin-bottom: 16px;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.04);
}
.air-type-filter-label {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
  font-weight: 800;
  color: #0f766e;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  flex-shrink: 0;
  white-space: nowrap;
}
.air-type-filter-label-icon {
  width: 1.15em; height: 1.15em; stroke-width: 2.6;
  color: #0f766e; flex-shrink: 0;
}
.air-type-filter {
  display: inline-flex;
  align-items: stretch;
  gap: 4px;
  padding: 4px;
  background: #1a1f26;
  border: 1px solid #0a0c0f;
  border-radius: 12px;
  flex: 1 1 auto;
  min-width: 0;
}
.air-type-filter-btn {
  flex: 1 1 0;
  padding: 11px 22px;
  min-height: 46px;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0.01em;
  color: #475569;
  background: #f8fafc;
  border: none;
  border-radius: 9px;
  cursor: pointer;
  font-family: inherit;
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s ease, color 0.15s ease, box-shadow 0.15s ease, transform 0.1s ease;
}
.air-type-filter-btn:hover:not(.is-active) { background: #ffffff; color: #0f172a; }
.air-type-filter-btn:active:not(.is-active) { transform: scale(0.98); }
.air-type-filter-btn.is-active {
  background: linear-gradient(135deg, #00e0d4 0%, #00b8b0 45%, #008a82 100%);
  color: #ffffff;
  box-shadow: 0 2px 8px rgba(0, 138, 130, 0.45), 0 0 0 1px rgba(0, 138, 130, 0.2) inset;
}
.air-type-filter-btn.is-active:hover { color: #ffffff; }
.air-type-filter-btn:focus-visible { outline: 2px solid #00b8b0; outline-offset: 2px; }

/* ============================================================
   List header with the enlarged count pill
   ============================================================ */
.air-list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  flex-wrap: wrap;
  margin-bottom: 20px;
  padding: 0 0 14px 0;
  border-bottom: 1px solid #e2e8f0;
  position: relative;
}
.air-list-header-left {
  min-width: 0;
  flex: 1 1 300px;
  padding-left: 16px;
  position: relative;
}
.air-list-header-left::before {
  content: '';
  position: absolute;
  left: 0; top: 4px; bottom: 4px;
  width: 4px;
  border-radius: 999px;
  background: linear-gradient(180deg, #00e0d4 0%, #008a82 100%);
}
.air-list-header-left h4 {
  margin: 0 0 6px;
  font-size: clamp(20px, 2vw, 24px);
  font-weight: 800;
  color: #0f172a;
  letter-spacing: -0.015em;
  line-height: 1.2;
}
.air-list-sub {
  margin: 0;
  font-size: clamp(14px, 1.2vw, 15px);
  color: #64748b;
  line-height: 1.55;
  max-width: 720px;
}

/* Right-side cluster: optional "Updating…" + the big count pill */
.air-list-header-right {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
  flex-wrap: wrap;
}
.air-list-loading {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 999px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  color: #64748b;
  font-size: 12.5px;
  font-weight: 700;
  letter-spacing: 0.02em;
  white-space: nowrap;
}
.air-list-loading-icon { width: 1em; height: 1em; stroke-width: 2.4; }

/* The count pill — ENLARGED for accessibility */
.air-list-count {
  display: inline-flex;
  align-items: center;
  padding: 12px 24px;
  border-radius: 999px;
  background: linear-gradient(135deg, #ecfeff 0%, #cffafe 100%);
  color: #0e7490;
  border: 1.5px solid #67e8f9;
  font-size: clamp(16px, 1.4vw, 18px);
  font-weight: 800;
  letter-spacing: 0.04em;
  white-space: nowrap;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  flex-shrink: 0;
  box-shadow: 0 2px 10px rgba(14, 116, 144, 0.12);
}

/* ============================================================
   Row polish
   ============================================================ */
.air-po-cell { display: inline-flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.air-type-dot {
  width: 8px; height: 8px; border-radius: 50%;
  flex-shrink: 0;
  box-shadow: 0 0 0 3px rgba(15, 23, 42, 0.06);
}
.air-type-dot--po { background: #0f766e; }
.air-type-dot--pr { background: #ea580c; }

.air-po-vendor {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
  min-width: 0;
  max-width: 220px;
}
.air-po-vendor--mobile { margin-top: 2px; max-width: 100%; }
.air-po-vendor-name {
  min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: 12.5px;
  font-weight: 600;
  color: #64748b;
}
.air-vendor-avatar {
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: 50%;
  font-weight: 800;
  letter-spacing: 0.02em;
  flex-shrink: 0;
  border: 1px solid;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
}
.air-vendor-avatar--sm { width: 24px; height: 24px; font-size: 10px; }

.air-date-cell { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.air-date-main { font-weight: 600; color: #0f172a; font-size: 15px; }
.air-date-rel {
  font-size: 11.5px;
  color: #94a3b8;
  font-weight: 500;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
}

.po-clickable-row.is-pr-based:hover { background: #fffbf5 !important; }
.air-mobile-po { display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; }

/* ============================================================
   Enhanced empty state
   ============================================================ */
.air-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 44px 20px 40px;
  gap: 10px;
}
.air-empty-icon-circle {
  width: 68px; height: 68px;
  border-radius: 50%;
  background: linear-gradient(135deg, #f0fdfa 0%, #ecfeff 100%);
  border: 1px solid #99f6e4;
  display: flex; align-items: center; justify-content: center;
  color: #0f766e;
  margin-bottom: 4px;
}
.air-empty-icon-svg { width: 32px; height: 32px; stroke-width: 1.8; }
.air-empty-title { font-size: 18px; font-weight: 800; color: #0f172a; letter-spacing: -0.01em; }
.air-empty-sub {
  font-size: 14px; color: #64748b;
  max-width: 460px; line-height: 1.55;
}
.air-empty-cta {
  margin-top: 8px;
  display: inline-flex; align-items: center; gap: 8px;
  padding: 11px 22px;
  border-radius: 10px;
  border: 1px solid #cbd5e1;
  background: #ffffff;
  color: #334155;
  font-size: 14px;
  font-weight: 700;
  font-family: inherit;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;
}
.air-empty-cta:hover:not(:disabled) { background: #f8fafc; border-color: #94a3b8; }
.air-empty-cta:disabled { opacity: 0.55; cursor: not-allowed; }
.air-empty-cta:focus-visible { outline: 2px solid #00b8b0; outline-offset: 2px; }

/* ============================================================
   Standard filter bar — ENLARGED for accessibility
   ============================================================ */
.air-filters .air-filter-row {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  align-items: flex-end;
  padding: 16px 18px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
}
.air-filters .air-filter-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  flex: 0 1 auto;
}
.air-filters .air-filter-group label {
  font-size: 13.5px;
  font-weight: 700;
  color: #334155;
  line-height: 1.3;
  letter-spacing: 0.01em;
}
.air-filters .air-filter-group .air-filter-input {
  width: 100%;
  height: 48px;
  padding: 10px 14px;
  font-size: 15px;
  box-sizing: border-box;
}
.air-filters .air-filter-group--search {
  flex: 1 1 300px;
  max-width: 460px;
}
.air-filters .air-filter-group.air-filter-group--actions {
  flex: 0 0 auto;
  flex-direction: row;
  align-items: flex-end;
  gap: 10px;
  margin-left: auto;
}
.air-filters .air-filter-group.air-filter-group--actions .air-filter-btn {
  height: 48px;
  padding: 0 20px;
  font-size: 14.5px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  white-space: nowrap;
}
.air-filters .air-filter-group.air-filter-group--actions .air-filter-btn:focus-visible {
  outline: 2px solid #00b8b0;
  outline-offset: 2px;
}
.air-filters .air-filter-group.air-filter-group--actions .air-filter-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

@media (max-width: 900px) {
  .air-filters .air-filter-group--search {
    flex: 1 1 100%;
    max-width: 100%;
  }
  .air-filters .air-filter-group.air-filter-group--actions {
    margin-left: 0;
  }
  .air-type-filter-bar { gap: 12px; padding: 12px 14px; }
  .air-type-filter-btn { padding: 10px 16px; font-size: 14px; }
  .air-list-count { font-size: 16px; padding: 10px 20px; }
}

@media (max-width: 640px) {
  .air-filters .air-filter-row {
    gap: 12px;
    padding: 12px 14px;
  }
  .air-filters .air-filter-group,
  .air-filters .air-filter-group--search {
    flex: 1 1 100%;
    max-width: 100%;
  }
  .air-filters .air-filter-group.air-filter-group--actions {
    flex: 1 1 100%;
    margin-left: 0;
  }
  .air-filters .air-filter-group.air-filter-group--actions .air-filter-btn {
    flex: 1 1 0;
  }
  .air-type-filter-bar {
    flex-direction: column;
    align-items: stretch;
    gap: 10px;
    padding: 12px 14px;
  }
  .air-type-filter-label { justify-content: flex-start; }
  .air-type-filter {
    flex-direction: column;
    align-items: stretch;
    gap: 6px;
  }
  .air-type-filter-btn {
    width: 100%;
    flex: 1 1 auto;
    padding: 14px 16px;
    min-height: 52px;
    font-size: 15px;
  }
  .air-head {
    flex-direction: column;
    align-items: stretch;
  }
  .air-head-actions { justify-content: flex-start; }
  .air-head-refresh { width: 100%; justify-content: center; min-height: 46px; }
  .air-list-header {
    flex-direction: column;
    align-items: stretch;
    gap: 12px;
  }
  .air-list-header-left { padding-left: 14px; }
  .air-list-header-left h4 { font-size: 20px; }
  .air-list-sub { font-size: 14px; }
  .air-list-header-right {
    justify-content: space-between;
    width: 100%;
  }
  .air-list-count { font-size: 16px; padding: 10px 20px; }
  .air-po-vendor { max-width: 100%; }
  .air-empty { padding: 36px 16px 32px; }
}

@media (max-width: 380px) {
  .air-filters .air-filter-group.air-filter-group--actions {
    flex-direction: column;
    gap: 6px;
  }
  .air-filters .air-filter-group.air-filter-group--actions .air-filter-btn {
    width: 100%;
  }
  .air-type-filter-btn { padding: 13px 14px; font-size: 14px; min-height: 48px; }
  .air-type-filter-label { font-size: 11.5px; }
  .air-list-header-left h4 { font-size: 18px; }
  .air-list-sub { font-size: 13px; }
  .air-list-count { font-size: 15px; padding: 9px 16px; }
  .air-head-pill { font-size: 12.5px; padding: 7px 14px; }
}

/* ---------- PR / PO pills ---------- */
.air-pr-pill {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 7px;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.06em;
  color: #9a3412;
  background: #fff7ed;
  border: 1px solid #fed7aa;
  border-radius: 4px;
  vertical-align: middle;
}
.air-pr-pill--inline { margin-left: 0; }
.air-pr-pill--modal  { margin-left: 8px; }
.air-type-pill {
  display: inline-block;
  padding: 1px 7px;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.06em;
  border-radius: 4px;
}
.air-type-pill--po {
  background: #ecfeff;
  color: #0e7490;
  border: 1px solid #a5f3fc;
}

/* ---------- Table ---------- */
.po-compact-table { width: 100%; min-width: 860px; table-layout: fixed; }
.po-compact-table .col-po-no     { width: 22%; }
.po-compact-table .col-po-date   { width: 15%; }
.po-compact-table .col-pr-no     { width: 12%; }
.po-compact-table .col-my-lines  { width: 14%; }
.po-compact-table .col-status    { width: 16%; }
.po-compact-table .col-actions   { width: 21%; }

.po-compact-table thead th,
.po-compact-table tbody td { text-align: left; }

.po-compact-table thead th.col-actions,
.po-compact-table tbody td.col-actions {
  text-align: right;
  padding-left: 4px;
  padding-right: 12px;
}

.po-compact-table thead th {
  padding: 16px 18px;
  font-size: 13.5px;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: #475569;
}

.po-compact-table tbody td {
  padding: 14px 18px;
  font-size: 15px;
  vertical-align: middle;
}

.po-no-big {
  display: inline-block;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-size: 20px;
  font-weight: 700;
  color: #0f766e;
  letter-spacing: 0.02em;
  line-height: 1.2;
  word-break: break-word;
}

.po-clickable-row { cursor: pointer; transition: background 0.15s ease; }
.po-clickable-row:hover { background: #f0fdfa !important; }
.po-clickable-row:active { background: #e6fffb !important; }

.my-lines-empty { color: #cbd5e1; font-size: 16px; font-weight: 600; }
.my-lines-badge {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 5px 13px; border-radius: 8px;
  font-size: 13.5px; font-weight: 700;
  letter-spacing: 0.02em; white-space: nowrap;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
}
.my-lines-badge.pending   { background: #fef3c7; color: #92400e; border: 1px solid #fcd34d; }
.my-lines-badge.ready     { background: #dcfce7; color: #065f46; border: 1px solid #86efac; }
.my-lines-badge.forwarded { background: #e0e7ff; color: #3730a3; border: 1px solid #a5b4fc; }

.deliv-badge {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 3px 10px;
  border-radius: 999px; font-size: 11px; font-weight: 700;
  letter-spacing: 0.02em; white-space: nowrap;
}
.deliv-badge svg.deliv-icon { width: 1em; height: 1em; stroke-width: 2.4; flex-shrink: 0; }
.deliv-badge--complete { background: #dcfce7; color: #065f46; border: 1px solid #86efac; }
.deliv-badge--partial  { background: #fef3c7; color: #92400e; border: 1px solid #fcd34d; }
.aip-partial-inline { margin-left: 6px; font-size: 10px; padding: 2px 7px; }

.po-compact-table .col-actions .action-buttons {
  justify-content: flex-end;
  gap: 4px;
  flex-wrap: nowrap;
}
.po-compact-table .col-actions .action-btn {
  padding: 10px 18px;
  font-size: 14.5px;
  font-weight: 600;
  white-space: nowrap;
}

.po-view-hint {
  display: inline-block; font-size: 14.5px; font-weight: 600;
  color: #0f766e; padding: 9px 15px;
  border: 1px solid #99f6e4; background: #f0fdfa;
  border-radius: 8px; white-space: nowrap; cursor: pointer; font-family: inherit;
  transition: background 0.15s ease, border-color 0.15s ease, transform 0.1s ease;
}
.po-view-hint:hover { background: #ccfbf1; border-color: #5eead4; }
.po-view-hint:active { transform: scale(0.97); }
.po-view-hint:focus-visible { outline: 2px solid #00d2c8; outline-offset: 2px; }

.status-badge.pending-transfer {
  display: inline-block; padding: 5px 13px; border-radius: 999px;
  font-size: 12.5px; font-weight: 700; letter-spacing: 0.03em;
  background: #fef3c7; color: #92400e; border: 1px solid #fcd34d; white-space: nowrap;
}

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
.po-card.is-pr-based { border-left: 3px solid #fed7aa; }
.po-card-row-1 { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.po-card-row-2 { display: flex; flex-wrap: wrap; gap: 6px 18px; font-size: 13.5px; color: #475569; align-items: center; }
.po-card-row-2 strong { color: #64748b; font-weight: 600; margin-right: 4px; }
.po-card-actions { display: flex; justify-content: flex-end; gap: 8px; padding-top: 8px; border-top: 1px dashed #e5e7eb; min-height: 30px; }

.pod-close:hover { background: #f1f5f9; color: #0f172a; }
.pod-body::-webkit-scrollbar { width: 8px; }
.pod-body::-webkit-scrollbar-track { background: #f1f5f9; border-radius: 4px; }
.pod-body::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 4px; }
.pod-body::-webkit-scrollbar-thumb:hover { background: #94a3b8; }

.pod-meta-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }

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
  .pod-card { max-height: 100vh; border-radius: 0; width: 100vw; height: 100vh; }
  .po-no-big { font-size: 18px; }
}

@media (prefers-reduced-motion: reduce) {
  .pod-card, .pod-overlay { animation: none !important; }
  .po-card, .po-clickable-row { transition: none !important; }
  .po-view-hint { transition: none !important; }
  .air-type-filter-btn { transition: none !important; }
  .air-head-refresh { transition: none !important; }
  .air-empty-cta { transition: none !important; }
  .icon-spin { animation: none !important; }
}
`;

export default TabItemsReceived;