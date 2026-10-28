// src/components/handler/TabReceivedPO.jsx
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FiInbox,
  FiInfo,
  FiHome,
  FiSend,
  FiClock,
  FiAlertTriangle,
  FiCheckCircle,
  FiTruck,
  FiPackage,
  FiTarget,
  FiDownload,
  FiArrowRight,
  FiXCircle,
  FiSlash,
  FiAward,
  FiRefreshCw,
  FiCircle,
} from 'react-icons/fi';
import { usePermissions } from '../../permissions/usePermissions';
import { getUser } from '../../secure/auth';
import {
  warehouseApi,
  importPoApi,
  stockTransferApi,
  itemMasterApi,
} from '../../services/api';
import { useToast } from '../shared/ToastProvider';
import StoreItemModal from './StoreItemModal';
import ReleaseItemModal from './ReleaseItemModal';
import ItemImageThumb from '../shared/ItemImageThumb';

/**
 * The backend's /handler-items endpoint already filters by these five
 * statuses (see ImportPoModel.listHandlerItems). The frontend renders
 * whatever it receives. This map is kept for two purposes only:
 *   1. Documentation of the statuses the handler queue owns.
 *   2. Computing the *least-progressed* line status per PO when building
 *      the PO-detail-modal header (so a PO with mixed handler-line
 *      statuses shows the status with the most remaining work).
 */
const HANDLER_STATUS_RANK = {
  'With Handler':     4,
  'Pending Transfer': 5,
  'Transferred':      6,
  'Stored':           7,
  'Released':         8,
};

// One-shot fetch cap for the handler-lines call. The backend clamps to
// Math.min(5000, max(1, limit)), so this is the true ceiling — beyond it,
// the user must narrow with filters (the truncation banner says so).
const HANDLER_LINES_FETCH_CAP = 5000;

// STS-side one-shot cap — matches what /stock-transfer/received-for-store
// tolerates on the backend today. Kept as-is, independent of the PO cap.
const STS_LINES_FETCH_CAP = 500;

// Client-side pagination on the merged (PO + STS) view. Fully responsive —
// the pager in tabCss stacks at 720px, hides "First/Last" labels at 640px,
// and drops to compact buttons at 380px.
const PAGE_SIZE = 50;

const formatTotal = (v) => {
  if (v === '' || v === null || v === undefined) return '-';
  const n = Number(v);
  if (Number.isNaN(n)) return '-';
  return n.toFixed(2);
};

/**
 * FUNC AMOUNT is stored at 3dp — line items render at 3dp per project
 * policy. (PHP aggregates — KPI cards, PO-level totals — stay at 2dp
 * via formatTotal above.)
 */
const formatFuncAmount = (v) => {
  if (v === '' || v === null || v === undefined) return '—';
  const n = Number(v);
  if (Number.isNaN(n)) return '—';
  return n.toFixed(3);
};

const formatForex = (v) => {
  if (v === '' || v === null || v === undefined) return '—';
  const n = Number(v);
  if (Number.isNaN(n)) return '—';
  return n.toFixed(3);
};

const formatPrice = (v, currency) => {
  if (v === '' || v === null || v === undefined) return '—';
  const n = Number(v);
  if (Number.isNaN(n)) return '—';
  return `${n.toFixed(2)}${currency ? ` ${currency}` : ''}`;
};

/**
 * Compute a line's PHP-equivalent value.
 * Prefers `func_amount` (authoritative, computed server-side at import).
 * Falls back to received_qty × unit_price × forex for legacy rows that
 * predate the multi-currency import.
 */
const lineTotalOf = (r) => {
  const fa = Number(r.func_amount);
  if (Number.isFinite(fa) && r.func_amount != null) return fa;

  const q  = Number(r.received_qty) || 0;
  const up = Number(r.unit_price) || 0;
  const cur = String(r.currency || 'PHP').toUpperCase();
  const fx = cur === 'PHP' || cur === '' ? 1 : (Number(r.forex) || 1);
  return q * up * fx;
};

/* Delivery status overhaul: the Excel STATUS column now drives this
   value. New imports store 'Partial Received'; older rows may still
   hold 'Partial' from the previous auto-derived logic. Treat both as
   equivalent everywhere on the UI. */
const isPartialDelivery = (s) => s === 'Partial' || s === 'Partial Received';

const deliveryBadgeClass = (status) => {
  if (status === 'Complete') return 'delivery-badge delivery-badge--complete';
  if (isPartialDelivery(status)) return 'delivery-badge delivery-badge--partial';
  return 'delivery-badge delivery-badge--unknown';
};

const formatDateTime = (v) => {
  if (!v) return '—';
  try { return new Date(v).toLocaleString(); } catch { return v; }
};

/**
 * Render a DATE-only value as YYYY-MM-DD.
 *
 * The backend returns po_date as a SQL DATE, which mssql serializes
 * to a JS Date → JSON.stringify emits an ISO string like
 * "2026-09-01T00:00:00.000Z". The leading 10 chars are always the
 * intended calendar date (the DATE column has no time component).
 * Extracting them avoids the local-timezone shift we fixed on the
 * parser side — the raw string is already correct.
 */
const formatDate = (v) => {
  if (v === '' || v === null || v === undefined) return '—';
  const s = String(v);
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : s;
};

const poStatusBadgeClass = (status) => {
  // `Partial With Handler` and `Complete (with damage)` are retired from
  // the lifecycle but kept as defensive branches in case legacy rows
  // surface from a database that predates the migration.
  if (status === 'Partial With Handler') return 'status-badge partial';
  if (status === 'With Handler')         return 'status-badge partial';
  if (status === 'Pending Transfer')     return 'status-badge pending-transfer';
  if (status === 'Transferred')          return 'status-badge active';
  if (status === 'Stored')               return 'status-badge active';
  if (status === 'Released')             return 'status-badge active';
  if (status === 'Ready to Store')       return 'status-badge partial';
  return 'status-badge';
};

const nextStepFor = (status) => {
  switch (status) {
    case 'Pending':                return 'Waiting for the Registrar to receive items from the vendor.';
    case 'Partial Received':       return 'Registrar needs to receive the remaining items.';
    case 'Complete':               return 'Ready to be sent to the Stock Handler.';
    case 'Complete (with damage)': return 'Ready to be sent to the Stock Handler.';
    case 'With Handler':           return 'Store the received qty into a locator, or release it directly out of the warehouse.';
    case 'Partial With Handler':   return 'Store or release the received qty; more may arrive later.';
    case 'Pending Transfer':       return 'Waiting for the Department Head to approve or reject the transfer.';
    case 'Transferred':            return 'All received items have been transferred.';
    case 'Stored':                 return 'Items are stored. Use the Transfer Stocks tab to move them.';
    case 'Released':               return 'Items have been released out of the warehouse.';
    default:                       return '—';
  }
};

// ============================================================
// Activity icon — Feather component lookup
// Returns a React component (not an instance). Callers render
// <ActivityIcon size={14} /> inside the tinted dot.
// ============================================================
const activityIcon = (eventType) => {
  switch (eventType) {
    case 'Imported':           return FiDownload;
    case 'Received':           return FiInbox;
    case 'Forwarded':          return FiArrowRight;
    case 'Stored':             return FiHome;
    case 'Released':           return FiSend;
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
    case 'Stored':             return '#008a82';
    case 'Released':           return '#c2410c';
    case 'TransferSubmitted':  return '#4338ca';
    case 'TransferApproved':   return '#15803d';
    case 'TransferRejected':   return '#b91c1c';
    case 'TransferCancelled':  return '#64748b';
    case 'TransferCompleted':  return '#065f46';
    default:                   return '#475569';
  }
};

const TabReceivedPO = () => {
  const { can } = usePermissions();
  const currentUser = getUser();
  const userWarehouseId = currentUser?.warehouse_assigned;
  const toast = useToast();

  const [assignedWarehouse, setAssignedWarehouse] = useState(null);
  const [warehouseLoading, setWarehouseLoading] = useState(false);

  const [itemRows, setItemRows] = useState([]);
  const [itemImages, setItemImages] = useState({});
  const [poLoading, setPoLoading] = useState(false);

  // Client-side pagination + truncation warning
  const [page, setPage] = useState(1);
  const [truncationInfo, setTruncationInfo] = useState({
    hasTruncation: false,
    pos: false,
    posLoaded: 0,
    posTotal: 0,
    sts: false,
  });

  const [searchTerm, setSearchTerm]         = useState('');
  const [startDate, setStartDate]           = useState('');
  const [endDate, setEndDate]               = useState('');
  const [statusFilter, setStatusFilter]     = useState('All');
  const [deliveryFilter, setDeliveryFilter] = useState('All');
  /* PO Type filter: 'All' | '1' (with PO) | '0' (without PO / PR-based) */
  const [poTypeFilter, setPoTypeFilter]     = useState('All');

  const [pendingSlipsByPO, setPendingSlipsByPO] = useState({});
  const [cancellingPo, setCancellingPo] = useState(null);

  // ---- Store modal state ----
  const [storeRow, setStoreRow] = useState(null);
  // ---- Release modal state ----
  const [releaseRow, setReleaseRow] = useState(null);

  const [poDetail, setPoDetail]               = useState(null);
  const [poDetailLines, setPoDetailLines]     = useState([]);
  const [poDetailLoading, setPoDetailLoading] = useState(false);
  const [poDetailImages, setPoDetailImages]   = useState({});
  const [poDetailActivity, setPoDetailActivity] = useState([]);
  const [poDetailActivityLoading, setPoDetailActivityLoading] = useState(false);

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

  /**
   * loadReceivedItems — single-shot fetch, no N+1.
   *
   * PRIOR: listPOs() returned handler PO *headers*, then a per-PO
   * getPODetail() loop fetched each PO's lines. For a warehouse with
   * 500 handler POs, that was 501 network round-trips per refresh.
   *
   * NOW:   listHandlerItems() returns the flat handler-line list
   * directly (already filtered by status IN With Handler / Pending
   * Transfer / Transferred / Stored / Released on the backend). One
   * round-trip. STS lines still come from listReceivedForStore — also
   * one round-trip. Total: 3 requests instead of 503.
   */
  const loadReceivedItems = useCallback(async () => {
    setPoLoading(true);
    try {
      const [handlerRes, penRes, stsRes] = await Promise.all([
        importPoApi.listHandlerItems({
          warehouse_id: userWarehouseId,
          start_date: startDate || undefined,
          end_date:   endDate   || undefined,
          /* Send has_po only when a specific type is selected. Omitted → all. */
          has_po: poTypeFilter !== 'All' ? poTypeFilter : undefined,
          page: 1,
          limit: HANDLER_LINES_FETCH_CAP,
        }),
        stockTransferApi.listSTSs({ scope: 'mine', status: 'Pending' }),
        stockTransferApi.listReceivedForStore({
          warehouse_id: userWarehouseId,
          limit: STS_LINES_FETCH_CAP,
        }),
      ]);

      // ---------- PO side ----------
      const handlerLines = handlerRes.ok && Array.isArray(handlerRes.data)
        ? handlerRes.data
        : [];

      if (penRes.ok && Array.isArray(penRes.data)) {
        const map = {};
        for (const s of penRes.data) {
          if (s.po_no && !map[s.po_no]) map[s.po_no] = s;
        }
        setPendingSlipsByPO(map);
      } else {
        setPendingSlipsByPO({});
      }

      const poRows = handlerLines.map((l) => {
        const ordered  = Number(l.qty)          || 0;
        const received = Number(l.received_qty) || 0;
        const damaged  = Number(l.damaged_qty)  || 0;
        const stored   = Number(l.stored_qty)   || 0;
        const released = Number(l.released_qty) || 0;
        const rowKey = `PO::${l.po_no}::${
          l.id != null
            ? `id_${l.id}`
            : `syn_${l.item_code ?? Math.random().toString(36).slice(2)}`
        }`;
        return {
          source:           'PO',
          rowKey,
          id:               l.id,
          item_code:        l.item_code,
          item_name:        l.item_name,
          uom:              l.uom,
          uom_description:  l.uom_description,
          barcode:          l.barcode,
          gl_class_code:    l.gl_class_code,
          gl_description:   l.gl_description,
          purchase_class:   l.purchase_class,
          category:         l.category,
          qty:              ordered,
          received_qty:     received,
          damaged_qty:      damaged,
          stored_qty:       stored,
          released_qty:     released,
          available_to_store:   Math.max(0, received - damaged - stored - released),
          available_to_release: Math.max(0, received - damaged - stored - released),
          unit_price:       l.unit_price,
          currency:         l.currency || 'PHP',
          forex:            l.forex,
          func_amount:      l.func_amount,
          delivery_status:  l.delivery_status,
          item_status:      l.status || '',
          po_no:            l.po_no,
          /* For handler lines, the per-line status *is* the actionable
             status shown in the badge column — no separate PO-level
             aggregate exists on this response. */
          po_status:        l.status || '',
          po_date:          l.po_date,
          pr_no:            l.pr_no,
          vendor_name:      l.vendor_name,
          warehouse_id:     l.warehouse_id,
          warehouse_code:   l.warehouse_code,
          locator_code:     l.locator_code,
          forwarded_by:     l.forwarded_by || null,
          forwarded_at:     l.forwarded_at || null,
          /* PO Type flag — 1 = real PO, 0 = PR-based. */
          has_po:           Number(l.has_po) === 0 ? 0 : 1,
        };
      });

      // ---------- STS side ----------
      const stsRows = [];
      if (stsRes.ok && Array.isArray(stsRes.data)) {
        for (const l of stsRes.data) {
          const ordered  = Number(l.qty)          || 0;
          const received = Number(l.received_qty) || 0;
          const damaged  = Number(l.damaged_qty)  || 0;
          const stored   = Number(l.stored_qty)   || 0;
          const available = Math.max(0, received - damaged - stored);
          if (available <= 0) continue;

          stsRows.push({
            source:          'STS',
            rowKey:          `STS::${l.sts_line_id}`,
            id:              l.sts_line_id,
            sts_line_id:     l.sts_line_id,
            sts_id:          l.sts_id,
            sts_no:          l.sts_no,
            sts_status:      l.sts_status,
            item_code:       l.item_code,
            item_name:       l.item_name,
            uom:             l.uom,
            uom_description: l.uom_description,
            barcode:         l.barcode,
            gl_class_code:   l.gl_class_code,
            gl_description:  l.gl_description,
            purchase_class:  l.purchase_class,
            category:        l.category,
            qty:             ordered,
            received_qty:    received,
            damaged_qty:     damaged,
            stored_qty:      stored,
            released_qty:    0,
            available_to_store:   available,
            available_to_release: 0,
            unit_price:      l.unit_price,
            currency:        l.currency || 'PHP',
            forex:           null,
            func_amount:     null,
            delivery_status: null,
            item_status:     'Ready to Store',
            po_no:           l.po_no || '',
            from_warehouse_code: l.from_warehouse_code,
            from_warehouse_name: l.from_warehouse_name,
            to_warehouse_code:   l.to_warehouse_code,
            to_warehouse_name:   l.to_warehouse_name,
            received_by:     l.received_by,
            received_at:     l.received_at,
            /* STS rows are not PO/PR-based — they're inter-warehouse transfers. */
            has_po:          null,
          });
        }
      }

      setItemRows([...poRows, ...stsRows]);

      // ---------- Truncation detection ----------
      // PO side has an authoritative total from the backend — compare the
      // loaded-line count against it directly. STS side has no reported
      // total, so infer truncation from the returned count hitting the cap.
      const posTotal     = Number(handlerRes.total) || 0;
      const posLoaded    = handlerLines.length;
      const posTruncated = handlerRes.ok && posTotal > posLoaded;

      const stsRawLen    = stsRes.ok && Array.isArray(stsRes.data) ? stsRes.data.length : 0;
      const stsTruncated = stsRes.ok && stsRawLen >= STS_LINES_FETCH_CAP;

      setTruncationInfo({
        hasTruncation: posTruncated || stsTruncated,
        pos:        posTruncated,
        posLoaded,
        posTotal,
        sts:        stsTruncated,
      });

      // Fresh load → reset to page 1. Any previous page is no longer
      // meaningful against the new itemRows snapshot.
      setPage(1);

      const codes = [...new Set([...poRows, ...stsRows].map((r) => r.item_code).filter(Boolean))];
      if (codes.length > 0) {
        try {
          const imgRes = await itemMasterApi.getImagesByCodes(codes);
          if (imgRes.ok && imgRes.data?.images) setItemImages(imgRes.data.images);
        } catch (e) {
          console.warn('Could not load item images:', e);
        }
      }
    } finally {
      setPoLoading(false);
    }
  }, [userWarehouseId, startDate, endDate, poTypeFilter]);

  useEffect(() => { loadReceivedItems(); }, [loadReceivedItems]);

  // Reset to page 1 whenever a filter changes.
  useEffect(() => {
    setPage(1);
  }, [searchTerm, statusFilter, deliveryFilter, poTypeFilter]);

  const filteredItemRows = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return itemRows.filter((r) => {
      if (statusFilter !== 'All' && r.item_status !== statusFilter) return false;
      if (deliveryFilter !== 'All') {
        // STS rows carry delivery_status = null. Excluding them when a
        // specific delivery filter is selected is intentional — the filter
        // is about how the source PO line was delivered.
        //
        // New imports store 'Partial Received'; older rows may still hold
        // 'Partial'. Both spellings match the "Partial" filter.
        const ds = String(r.delivery_status || '');
        if (deliveryFilter === 'Partial') {
          if (ds !== 'Partial' && ds !== 'Partial Received') return false;
        } else if (ds !== deliveryFilter) {
          return false;
        }
      }
      /* PO Type filter: STS rows are not PO/PR-based, so they're excluded
         entirely when either specific type is selected. */
      if (poTypeFilter !== 'All') {
        if (r.source === 'STS') return false;
        const isPrBased = Number(r.has_po) === 0;
        if (poTypeFilter === '0' && !isPrBased) return false;
        if (poTypeFilter === '1' && isPrBased)  return false;
      }
      if (!q) return true;
      return (
        (r.item_code      || '').toLowerCase().includes(q) ||
        (r.item_name      || '').toLowerCase().includes(q) ||
        (r.barcode        || '').toLowerCase().includes(q) ||
        (r.category       || '').toLowerCase().includes(q) ||
        (r.purchase_class || '').toLowerCase().includes(q) ||
        (r.po_no          || '').toLowerCase().includes(q) ||
        (r.pr_no          || '').toLowerCase().includes(q) ||
        (r.sts_no         || '').toLowerCase().includes(q) ||
        (r.vendor_name    || '').toLowerCase().includes(q)
      );
    });
  }, [itemRows, statusFilter, deliveryFilter, poTypeFilter, searchTerm]);

  // Page clamp — when the filtered set shrinks below the current page's
  // window, pull back to the last valid page.
  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(filteredItemRows.length / PAGE_SIZE)),
    [filteredItemRows.length]
  );

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  // Derived page slice.
  const pagedItemRows = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filteredItemRows.slice(start, start + PAGE_SIZE);
  }, [filteredItemRows, page]);

  const showingStart = filteredItemRows.length === 0
    ? 0
    : (page - 1) * PAGE_SIZE + 1;
  const showingEnd = Math.min(page * PAGE_SIZE, filteredItemRows.length);

  const goToPage = (target) => {
    const next = Math.max(1, Math.min(totalPages, target));
    if (next !== page) setPage(next);
  };

  /**
   * poByNo — per-PO header synthesized from itemRows.
   *
   * No longer backed by a PO-aggregate list. We derive the *least-
   * progressed* handler line status per PO (via HANDLER_STATUS_RANK)
   * so a PO with mixed states (e.g. one line Stored, one still
   * With Handler) surfaces the status with the most remaining work.
   */
  const poByNo = useMemo(() => {
    const groups = new Map();
    for (const r of itemRows) {
      if (r.source !== 'PO') continue;
      if (!groups.has(r.po_no)) {
        groups.set(r.po_no, {
          po_no: r.po_no,
          vendor_name: r.vendor_name,
          po_date: r.po_date,
          pr_no: r.pr_no,
          has_po: r.has_po,
          forwarded_by: r.forwarded_by || null,
          forwarded_at: r.forwarded_at || null,
          _minRank: Infinity,
          _minStatus: null,
        });
      }
      const g = groups.get(r.po_no);
      const rank = HANDLER_STATUS_RANK[r.item_status];
      if (rank != null && rank < g._minRank) {
        g._minRank = rank;
        g._minStatus = r.item_status;
      }
    }

    const m = {};
    for (const [po_no, g] of groups.entries()) {
      m[po_no] = {
        po_no: g.po_no,
        status: g._minStatus || 'With Handler',
        vendor_name: g.vendor_name,
        po_date: g.po_date,
        pr_no: g.pr_no,
        has_po: g.has_po,
        forwarded_by: g.forwarded_by,
        forwarded_at: g.forwarded_at,
      };
    }
    return m;
  }, [itemRows]);

  const pendingTransferCount = useMemo(
    () => itemRows.filter((r) => r.item_status === 'Pending Transfer').length,
    [itemRows]
  );

  const storableCount = useMemo(
    () => itemRows.filter((r) =>
      r.available_to_store > 0 &&
      r.item_status !== 'Pending Transfer' &&
      r.item_status !== 'Stored' &&
      r.item_status !== 'Released'
    ).length,
    [itemRows]
  );

  const releaseableCount = useMemo(
    () => itemRows.filter((r) =>
      r.source === 'PO' &&
      r.available_to_release > 0 &&
      r.item_status !== 'Pending Transfer' &&
      r.item_status !== 'Stored' &&
      r.item_status !== 'Released'
    ).length,
    [itemRows]
  );

  const handleCancelPendingTransfer = async (poOrRow) => {
    const po_no = poOrRow?.po_no;
    if (!po_no) return;

    const pending = pendingSlipsByPO[po_no];
    if (!pending) {
      toast.warning('Could not find the pending transfer for this item. Try refreshing the list.');
      return;
    }

    const ok = window.confirm(
      `Cancel the pending transfer ${pending.sts_no} for PO ${po_no}?\n\n` +
      `From: ${pending.from_warehouse_code || '—'}\n` +
      `To:   ${pending.to_warehouse_code || '—'}\n\n` +
      `The slip will be cancelled and the item(s) will be unlocked.\n\nProceed?`
    );
    if (!ok) return;

    setCancellingPo(po_no);
    try {
      const res = await stockTransferApi.cancelSTS(pending.sts_id);
      if (!res.ok || !res.data?.success) {
        toast.error(res.data?.message || 'Failed to cancel the transfer.');
        return;
      }
      toast.success('Pending transfer cancelled. The item is now open.');
      await loadReceivedItems();
    } catch (err) {
      console.error(err);
      toast.error('Error cancelling the transfer.');
    } finally {
      setCancellingPo(null);
    }
  };

  // ---- Store modal handlers ----
  const handleOpenStore = (row) => {
    const img = itemImages[row.item_code] || null;
    setStoreRow({ ...row, image_url: img });
  };
  const handleCloseStore = () => setStoreRow(null);
  const handleStored = async () => { await loadReceivedItems(); };

  // ---- Release modal handlers ----
  const handleOpenRelease = (row) => {
    const img = itemImages[row.item_code] || null;
    setReleaseRow({ ...row, image_url: img });
  };
  const handleCloseRelease = () => setReleaseRow(null);
  const handleReleased = async () => { await loadReceivedItems(); };

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
        toast.error('Could not load PO details.');
        return;
      }

      // The modal displays a PO-level total in its meta grid. That field
      // is no longer on the handler-lines response, so compute it here
      // from the freshly-fetched full line list (sum of PHP-equivalent
      // per-line values, formatted at 2dp downstream).
      const total_amount = res.data.reduce(
        (sum, l) => sum + lineTotalOf(l),
        0
      );

      setPoDetail({ ...po, total_amount });
      setPoDetailLines(res.data);

      if (actRes.ok && Array.isArray(actRes.data)) setPoDetailActivity(actRes.data);

      const codes = [...new Set(res.data.map((l) => l.item_code).filter(Boolean))];
      if (codes.length > 0) {
        try {
          const imgRes = await itemMasterApi.getImagesByCodes(codes);
          if (imgRes.ok && imgRes.data?.images) setPoDetailImages(imgRes.data.images);
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
    // STS rows are not clickable through the PO detail modal.
    if (row.source === 'STS') return;
    const po = poByNo[row.po_no];
    if (po) handleOpenPoDetail(po);
  };

  const closePoDetail = () => {
    setPoDetail(null);
    setPoDetailLines([]);
    setPoDetailImages({});
    setPoDetailActivity([]);
  };

  const clearPoFilters = () => {
    setSearchTerm('');
    setStartDate('');
    setEndDate('');
    setStatusFilter('All');
    setDeliveryFilter('All');
    setPoTypeFilter('All');
    // setPage(1) is handled by the filter-change effect.
  };

  const poDetailTotalQty = useMemo(() => {
    if (!poDetailLines.length) return 0;
    return poDetailLines.reduce((sum, l) => sum + (Number(l.qty) || 0), 0);
  }, [poDetailLines]);

  const poDetailTotalFunc = useMemo(() => {
    if (!poDetailLines.length) return 0;
    return poDetailLines.reduce((sum, l) => sum + lineTotalOf(l), 0);
  }, [poDetailLines]);

  const poDetailHasNonPhp = useMemo(
    () => poDetailLines.some((l) => {
      const c = String(l.currency || 'PHP').toUpperCase();
      return c && c !== 'PHP';
    }),
    [poDetailLines]
  );

  const poDetailHasPartial = useMemo(
    () => poDetailLines.some((l) => isPartialDelivery(l.delivery_status)),
    [poDetailLines]
  );

  const poDetailIsPrBased = useMemo(
    () => Number(poDetail?.has_po) === 0,
    [poDetail]
  );

  const renderItemActions = (row) => {
    const isPending = row.item_status === 'Pending Transfer';
    const isDone    = row.item_status === 'Transferred' ||
                      row.item_status === 'Stored' ||
                      row.item_status === 'Released';

    const actionablePO = row.source === 'PO' &&
      row.item_status === 'With Handler' &&
      can('stocktransfer.create');

    const actionableSTS = row.source === 'STS' &&
      row.item_status === 'Ready to Store' &&
      can('stocktransfer.create');

    const isCancelling = cancellingPo === row.po_no;

    const canStore =
      ((actionablePO && row.available_to_store > 0) ||
       (actionableSTS && row.available_to_store > 0)) &&
      !isDone && !isPending;

    const canRelease =
      actionablePO &&
      row.available_to_release > 0 &&
      !isDone && !isPending;

    if (isPending) {
      const pending = pendingSlipsByPO[row.po_no];
      return (
        <div className="action-buttons">
          <span className="pending-transfer-chip" title="Awaiting Department Head approval">
            <FiClock className="inline-chip-icon" />
            <span>Awaiting approval</span>
          </span>
          {pending && (
            <button
              type="button"
              className="action-btn deactivate-btn"
              onClick={(e) => { e.stopPropagation(); handleCancelPendingTransfer(row); }}
              disabled={isCancelling}
            >
              {isCancelling ? 'Cancelling…' : 'Cancel Transfer'}
            </button>
          )}
          <button
            type="button"
            className="po-view-hint"
            onClick={(e) => { e.stopPropagation(); handleOpenItemRow(row); }}
          >
            View ›
          </button>
        </div>
      );
    }

    if (isDone || (!actionablePO && !actionableSTS)) {
      if (row.source === 'STS') {
        return <span style={{ color: '#94a3b8', fontSize: 12 }}>—</span>;
      }
      return (
        <button
          type="button"
          className="po-view-hint"
          onClick={(e) => { e.stopPropagation(); handleOpenItemRow(row); }}
        >
          View ›
        </button>
      );
    }

    return (
      <div className="action-buttons">
        {canStore && (
          <button
            className="action-btn"
            onClick={(e) => { e.stopPropagation(); handleOpenStore(row); }}
            style={{
              background: 'linear-gradient(135deg, #00e0d4 0%, #00b8b0 45%, #008a82 100%)',
              color: '#fff',
              border: 'none',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}
            title={`Store up to ${row.available_to_store} units`}
          >
            <FiHome className="inline-btn-icon" />
            <span>Store</span>
          </button>
        )}
        {canRelease && (
          <button
            className="action-btn"
            onClick={(e) => { e.stopPropagation(); handleOpenRelease(row); }}
            style={{
              background: 'linear-gradient(135deg, #fb923c 0%, #ea580c 45%, #c2410c 100%)',
              color: '#fff',
              border: 'none',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}
            title={`Release up to ${row.available_to_release} units`}
          >
            <FiSend className="inline-btn-icon" />
            <span>Release</span>
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="items-section">
      <style>{tabCss}</style>

      <div className="section-header">
        <h3>
          <FiInbox className="section-heading-icon" />
          <span>Received Items</span>
        </h3>
        <div className="header-actions">
          <span className="item-count">
            Total: {filteredItemRows.length} item{filteredItemRows.length === 1 ? '' : 's'}
          </span>
        </div>
      </div>

      {storeRow && (
        <StoreItemModal
          row={storeRow}
          onClose={handleCloseStore}
          onStored={handleStored}
        />
      )}

      {releaseRow && (
        <ReleaseItemModal
          row={releaseRow}
          onClose={handleCloseRelease}
          onReleased={handleReleased}
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
          lineHeight: 1.5,
        }}
      >
        <FiInfo className="banner-icon banner-icon--info" />
        <span>
          Each row is a single <strong>item</strong>. Use <strong>Store</strong> to place
          the received quantity into a locator first, or <strong>Release</strong> to send it
          out directly (to another department, a person, or back to the vendor). Items received
          from a stock transfer also appear here — store them into a locator to complete the
          transfer at the destination. Rows imported without a PO No. are shown as{' '}
          <strong>PR-based</strong>.
        </span>
      </div>

      {storableCount > 0 && (
        <div
          style={{
            background: '#ecfeff', border: '1px solid #a5f3fc',
            borderRadius: 8, padding: '10px 14px', marginBottom: 16,
            fontSize: 13, color: '#0e7490',
            display: 'flex', alignItems: 'center', gap: 10,
          }}
        >
          <FiHome className="banner-icon banner-icon--store" />
          <span>
            <strong>{storableCount}</strong> item{storableCount === 1 ? ' is' : 's are'} ready to
            be stored into warehouse inventory.
          </span>
        </div>
      )}

      {releaseableCount > 0 && (
        <div
          style={{
            background: '#fff7ed', border: '1px solid #fed7aa',
            borderRadius: 8, padding: '10px 14px', marginBottom: 16,
            fontSize: 13, color: '#9a3412',
            display: 'flex', alignItems: 'center', gap: 10,
          }}
        >
          <FiSend className="banner-icon banner-icon--release" />
          <span>
            <strong>{releaseableCount}</strong> item{releaseableCount === 1 ? ' is' : 's are'} ready to
            be released out of the warehouse.
          </span>
        </div>
      )}

      {pendingTransferCount > 0 && (
        <div
          style={{
            background: '#fffbeb', border: '1px solid #fde68a',
            borderRadius: 8, padding: '10px 14px', marginBottom: 16,
            fontSize: 13, color: '#92400e',
            display: 'flex', alignItems: 'center', gap: 10,
          }}
        >
          <FiClock className="banner-icon banner-icon--pending" />
          <span>
            <strong>{pendingTransferCount}</strong> item{pendingTransferCount === 1 ? ' is' : 's are'} locked
            pending Department Head approval. You can cancel it from the row actions.
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
                placeholder="Search item, barcode, category, PO No., STS No., or vendor..."
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
                <option value="All">All Status</option>
                <option value="With Handler">With Handler</option>
                <option value="Pending Transfer">Pending Transfer</option>
                <option value="Transferred">Transferred</option>
                <option value="Stored">Stored</option>
                <option value="Released">Released</option>
                <option value="Ready to Store">Ready to Store (from transfer)</option>
              </select>
            </div>
            <div className="filter-group">
              <label>Delivery</label>
              <select value={deliveryFilter} onChange={(e) => setDeliveryFilter(e.target.value)} className="filter-input">
                <option value="All">All deliveries</option>
                <option value="Complete">Complete</option>
                <option value="Partial">Partial</option>
              </select>
            </div>
            <div className="filter-group">
              <label>PO Type</label>
              <select value={poTypeFilter} onChange={(e) => setPoTypeFilter(e.target.value)} className="filter-input">
                <option value="All">All types</option>
                <option value="1">With PO</option>
                <option value="0">Without PO (PR-based)</option>
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
            {filteredItemRows.length === 0
              ? '0 items'
              : filteredItemRows.length <= PAGE_SIZE
                ? `${filteredItemRows.length} item${filteredItemRows.length === 1 ? '' : 's'}`
                : `Showing ${showingStart}–${showingEnd} of ${filteredItemRows.length} items`}
          </span>
        </div>

        {/* ---------- Truncation warning ---------- */}
        {truncationInfo.hasTruncation && !poLoading && (
          <div className="received-truncation-warning" role="status">
            <FiAlertTriangle />
            <div>
              <strong>
                Showing only the first {HANDLER_LINES_FETCH_CAP.toLocaleString()} handler item
                lines{truncationInfo.sts ? ` and the first ${STS_LINES_FETCH_CAP.toLocaleString()} stock transfer lines` : ''}.
              </strong>{' '}
              {truncationInfo.pos && (
                <>
                  Handler items: {truncationInfo.posLoaded.toLocaleString()}
                  {truncationInfo.posTotal > 0
                    ? ` of ${truncationInfo.posTotal.toLocaleString()}`
                    : ''} loaded.{' '}
                </>
              )}
              {truncationInfo.sts && (
                <>Stock transfer lines: first {STS_LINES_FETCH_CAP.toLocaleString()} loaded.{' '}</>
              )}
              Narrow your date range, add a search term, or set a PO Type filter to see more.
            </div>
          </div>
        )}

        <div className="table-wrapper">
          {poLoading ? (
            <div className="loading-spinner" style={{ margin: '20px auto' }} />
          ) : filteredItemRows.length > 0 ? (
            <table className="data-table items-received-table">
              <thead>
                <tr>
                  <th className="col-item">Item</th>
                  <th className="col-qty">Ordered / Received</th>
                  <th className="col-price">Price</th>
                  <th className="col-delivery">Delivery</th>
                  <th className="col-status">Status</th>
                  <th className="col-actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pagedItemRows.map((row) => {
                  const rowPrBased = row.source === 'PO' && Number(row.has_po) === 0;
                  return (
                    <tr
                      key={row.rowKey}
                      onClick={() => handleOpenItemRow(row)}
                      className={`po-clickable-row${row.source === 'STS' ? ' is-sts-row' : ''}`}
                    >
                      <td className="col-item">
                        <div className="item-cell">
                          <ItemImageThumb src={itemImages[row.item_code]} alt={row.item_code} size={44} />
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div className="item-code-line">
                              <span className="item-code">{row.item_code}</span>
                              {row.barcode && (
                                <span className="item-barcode-chip" title={`Barcode: ${row.barcode}`}>
                                  ▥ {row.barcode}
                                </span>
                              )}
                              {row.source === 'STS' && (
                                <span className="item-source-chip" title="From a stock transfer">
                                  <FiTruck className="inline-chip-icon" />
                                  <span>STS</span>
                                </span>
                              )}
                              {rowPrBased && (
                                <span className="hrp-pr-pill" title="No PO No. — grouped by PR No.">
                                  PR
                                </span>
                              )}
                            </div>
                            <div className="item-name" title={row.item_name}>{row.item_name || '—'}</div>
                            <div className="item-po-chip" title={row.source === 'STS' ? 'Parent Stock Transfer Slip' : 'Parent PO'}>
                              {row.source === 'STS'
                                ? `STS ${row.sts_no}`
                                : rowPrBased
                                  ? `PR ${row.po_no}`
                                  : `PO ${row.po_no}`}
                              {row.uom ? <> · {row.uom}</> : null}
                              {row.uom_description ? <> · {row.uom_description}</> : null}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="col-qty">
                        <span className="qty-big">{row.qty ?? 0}</span>
                        <span className="qty-received-sub">received: {row.received_qty || 0}</span>
                        {row.stored_qty > 0 && (
                          <span className="qty-received-sub" style={{ color: '#008a82' }}>
                            stored: {row.stored_qty}
                          </span>
                        )}
                        {row.released_qty > 0 && (
                          <span className="qty-received-sub" style={{ color: '#c2410c' }}>
                            released: {row.released_qty}
                          </span>
                        )}
                      </td>
                      <td className="col-price">
                        <div className="price-main">
                          {formatPrice(row.unit_price, row.currency)}
                        </div>
                        {row.source === 'PO' && row.currency && String(row.currency).toUpperCase() !== 'PHP' && (
                          <div className="price-fx" title={`Forex ${formatForex(row.forex)} · Func PHP ${formatFuncAmount(lineTotalOf(row))}`}>
                            FX {formatForex(row.forex)} · <span className="price-fx-php">{formatFuncAmount(lineTotalOf(row))}</span>
                          </div>
                        )}
                      </td>
                      <td className="col-delivery">
                        {row.delivery_status ? (
                          <span className={deliveryBadgeClass(row.delivery_status)}>
                            {isPartialDelivery(row.delivery_status) ? (
                              <><FiAlertTriangle className="inline-chip-icon" /><span>Partial</span></>
                            ) : (
                              <><FiCheckCircle className="inline-chip-icon" /><span>Complete</span></>
                            )}
                          </span>
                        ) : (
                          <span className="delivery-badge delivery-badge--none">—</span>
                        )}
                      </td>
                      <td className="col-status">
                        <span className={poStatusBadgeClass(row.item_status)}>{row.item_status}</span>
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
                {poTypeFilter === 'All'
                  ? 'No received items yet.'
                  : poTypeFilter === '1'
                    ? 'No items from POs with a PO No.'
                    : 'No PR-based items received.'}
              </p>
            </div>
          )}
        </div>

        {/* ---------- Pager ---------- */}
        {!poLoading && filteredItemRows.length > PAGE_SIZE && (
          <nav className="received-pager" aria-label="Received items pagination">
            <div className="received-pager-info">
              Showing <strong>{showingStart}</strong>–<strong>{showingEnd}</strong> of{' '}
              <strong>{filteredItemRows.length}</strong> item
              {filteredItemRows.length === 1 ? '' : 's'}
            </div>
            <div className="received-pager-controls">
              <button
                type="button"
                className="received-page-btn"
                onClick={() => goToPage(1)}
                disabled={page <= 1}
                aria-label="First page"
                title="First page"
              >
                « First
              </button>
              <button
                type="button"
                className="received-page-btn"
                onClick={() => goToPage(page - 1)}
                disabled={page <= 1}
                aria-label="Previous page"
                title="Previous page"
              >
                ‹ Prev
              </button>
              <span className="received-page-indicator">
                {page} / {totalPages}
              </span>
              <button
                type="button"
                className="received-page-btn"
                onClick={() => goToPage(page + 1)}
                disabled={page >= totalPages}
                aria-label="Next page"
                title="Next page"
              >
                Next ›
              </button>
              <button
                type="button"
                className="received-page-btn"
                onClick={() => goToPage(totalPages)}
                disabled={page >= totalPages}
                aria-label="Last page"
                title="Last page"
              >
                Last »
              </button>
            </div>
          </nav>
        )}
      </div>

      {poDetail && (
        <div className="pod-overlay" style={mStyles.overlay} onClick={closePoDetail}>
          <div className="pod-card" style={mStyles.card} onClick={(e) => e.stopPropagation()}>
            <div style={mStyles.header}>
              <div style={mStyles.headerLeft}>
                <div style={mStyles.headerIcon}><FiInbox /></div>
                <div style={{ minWidth: 0 }}>
                  <h3 style={mStyles.headerTitle}>
                    {poDetail.po_no}
                    {poDetailIsPrBased && (
                      <span
                        className="hrp-pr-pill hrp-pr-pill--modal"
                        title="No PO No. — grouped by PR No."
                      >
                        PR
                      </span>
                    )}
                  </h3>
                  <div style={mStyles.headerSub}>
                    <span className={poStatusBadgeClass(poDetail.status)}>{poDetail.status}</span>
                    {poDetailHasPartial && (
                      <span className="delivery-badge delivery-badge--partial">
                        <FiAlertTriangle className="inline-chip-icon" />
                        <span>Partial delivery</span>
                      </span>
                    )}
                    {poDetail.vendor_name && (
                      <>
                        <span style={mStyles.headerDot}>·</span>
                        <span>{poDetail.vendor_name}</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
              <button type="button" className="pod-close" onClick={closePoDetail} style={mStyles.closeBtn} aria-label="Close">
                <FiXCircle />
              </button>
            </div>

            <div className="pod-body" style={mStyles.body}>
              <div className="pod-meta-grid" style={mStyles.metaGrid}>
                <div style={mStyles.metaBox}>
                  <div style={mStyles.metaLabel}>Type</div>
                  <div style={mStyles.metaValue}>
                    {poDetailIsPrBased
                      ? <span className="hrp-pr-pill hrp-pr-pill--inline">PR-based</span>
                      : <span className="hrp-type-pill hrp-type-pill--po">With PO</span>}
                  </div>
                </div>
                <div style={mStyles.metaBox}><div style={mStyles.metaLabel}>PO Date</div><div style={mStyles.metaValue}>{formatDate(poDetail.po_date)}</div></div>
                <div style={mStyles.metaBox}><div style={mStyles.metaLabel}>PR No.</div><div style={mStyles.metaValue}>{poDetail.pr_no || '—'}</div></div>
                <div style={mStyles.metaBox}><div style={mStyles.metaLabel}>Vendor</div><div style={mStyles.metaValue}>{poDetail.vendor_name || '—'}</div></div>
                <div style={mStyles.metaBox}><div style={mStyles.metaLabel}>Total (PHP)</div><div style={mStyles.metaValue}>{formatTotal(poDetail.total_amount)}</div></div>
                <div style={mStyles.metaBox}><div style={mStyles.metaLabel}>Forwarded By</div><div style={mStyles.metaValue}>{poDetail.forwarded_by || '—'}</div></div>
                <div style={mStyles.metaBox}><div style={mStyles.metaLabel}>Forwarded At</div><div style={mStyles.metaValue}>{formatDateTime(poDetail.forwarded_at)}</div></div>
              </div>

              {poDetailHasNonPhp && (
                <div style={mStyles.fxStrip}>
                  <span style={mStyles.fxStripIcon}><FiRefreshCw /></span>
                  <span>
                    <strong>Foreign-currency PO.</strong> FUNC PHP shown per line is{' '}
                    <em>unit_price × received_qty × forex</em>, rounded to 3 decimals.
                    PO-level total above is the sum in PHP, shown at 2 decimals.
                  </span>
                </div>
              )}

              <div style={mStyles.sectionHead}>
                <span style={mStyles.sectionTitle}>
                  <FiPackage className="pod-section-icon" />
                  <span>PO Lines <span style={mStyles.sectionCount}>({poDetailLines.length})</span></span>
                </span>
                <span style={mStyles.summaryChip}>Total qty: {poDetailTotalQty}</span>
              </div>

              <div style={mStyles.tableWrap}>
                <table style={{ ...mStyles.table, minWidth: 1480 }}>
                  <thead>
                    <tr>
                      <th style={mStyles.th}>Item</th>
                      <th style={{ ...mStyles.th, textAlign: 'center' }}>Barcode</th>
                      <th style={{ ...mStyles.th, textAlign: 'center' }}>UOM</th>
                      <th style={{ ...mStyles.th, textAlign: 'center' }}>Category</th>
                      <th style={{ ...mStyles.th, textAlign: 'center' }}>Purchase Class</th>
                      <th style={{ ...mStyles.th, textAlign: 'center' }}>GL Class</th>
                      <th style={{ ...mStyles.th, textAlign: 'center' }}>Ordered</th>
                      <th style={{ ...mStyles.th, textAlign: 'center' }}>Received</th>
                      <th style={{ ...mStyles.th, textAlign: 'center' }}>Stored</th>
                      <th style={{ ...mStyles.th, textAlign: 'center' }}>Released</th>
                      <th style={{ ...mStyles.th, textAlign: 'center' }}>Delivery</th>
                      <th style={{ ...mStyles.th, textAlign: 'center' }}>Status</th>
                      <th style={{ ...mStyles.th, textAlign: 'center' }}>Curr</th>
                      <th style={{ ...mStyles.th, textAlign: 'right' }}>Forex</th>
                      <th style={{ ...mStyles.th, textAlign: 'right' }}>Func PHP</th>
                      <th style={mStyles.th}>Unit Price</th>
                    </tr>
                  </thead>
                  <tbody>
                    {poDetailLoading ? (
                      <tr><td colSpan={16} style={{ textAlign: 'center', padding: 24 }}>Loading…</td></tr>
                    ) : poDetailLines.length > 0 ? (
                      poDetailLines.map((l, idx) => {
                        const cur = String(l.currency || 'PHP').toUpperCase();
                        const isNonPhp = cur && cur !== 'PHP';
                        return (
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
                            <td style={{ ...mStyles.td, textAlign: 'center' }}>
                              {l.barcode
                                ? <span style={mStyles.barcodeTag}>{l.barcode}</span>
                                : <span style={mStyles.emptyCell}>—</span>}
                            </td>
                            <td style={{ ...mStyles.td, textAlign: 'center' }}>
                              <span style={mStyles.uomTag}>{l.uom || '—'}</span>
                              {l.uom_description && l.uom_description !== l.uom && (
                                <div style={mStyles.subText}>{l.uom_description}</div>
                              )}
                            </td>
                            <td style={{ ...mStyles.td, textAlign: 'center' }}>
                              {l.category
                                ? <span style={mStyles.catTag}>{l.category}</span>
                                : <span style={mStyles.emptyCell}>—</span>}
                            </td>
                            <td style={{ ...mStyles.td, textAlign: 'center' }}>
                              {l.purchase_class
                                ? <span style={mStyles.pcTag}>{l.purchase_class}</span>
                                : <span style={mStyles.emptyCell}>—</span>}
                            </td>
                            <td style={{ ...mStyles.td, textAlign: 'center' }}>
                              {l.gl_class_code
                                ? <>
                                    <span style={mStyles.glTag}>{l.gl_class_code}</span>
                                    {l.gl_description && (
                                      <div style={mStyles.subText} title={l.gl_description}>{l.gl_description}</div>
                                    )}
                                  </>
                                : <span style={mStyles.emptyCell}>—</span>}
                            </td>
                            <td style={{ ...mStyles.td, textAlign: 'center', fontWeight: 600 }}>{Number(l.qty) || 0}</td>
                            <td style={{ ...mStyles.td, textAlign: 'center', fontWeight: 600 }}>{Number(l.received_qty) || 0}</td>
                            <td style={{ ...mStyles.td, textAlign: 'center', fontWeight: 600, color: '#008a82' }}>{Number(l.stored_qty) || 0}</td>
                            <td style={{ ...mStyles.td, textAlign: 'center', fontWeight: 600, color: '#c2410c' }}>{Number(l.released_qty) || 0}</td>
                            <td style={{ ...mStyles.td, textAlign: 'center' }}>
                              {l.delivery_status ? (
                                <span className={deliveryBadgeClass(l.delivery_status)}>
                                  {isPartialDelivery(l.delivery_status) ? (
                                    <><FiAlertTriangle className="inline-chip-icon" /><span>Partial</span></>
                                  ) : (
                                    <><FiCheckCircle className="inline-chip-icon" /><span>Complete</span></>
                                  )}
                                </span>
                              ) : (
                                <span style={mStyles.emptyCell}>—</span>
                              )}
                            </td>
                            <td style={{ ...mStyles.td, textAlign: 'center' }}>
                              <span className={poStatusBadgeClass(l.status)}>{l.status}</span>
                            </td>
                            <td style={{ ...mStyles.td, textAlign: 'center' }}>
                              <span style={mStyles.currencyTag}>{cur || 'PHP'}</span>
                            </td>
                            <td style={{ ...mStyles.td, textAlign: 'right', fontFamily: "'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace", fontSize: 12 }}>
                              {isNonPhp ? formatForex(l.forex) : '1.000'}
                            </td>
                            <td style={{ ...mStyles.td, textAlign: 'right', fontWeight: 700, fontFamily: "'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace", fontSize: 12, color: '#065f46' }}>
                              {formatFuncAmount(lineTotalOf(l))}
                            </td>
                            <td style={mStyles.td}>
                              {l.unit_price != null
                                ? `${Number(l.unit_price).toFixed(2)} ${cur || ''}`.trim()
                                : '—'}
                            </td>
                          </tr>
                        );
                      })
                    ) : (
                      <tr><td colSpan={16} style={{ textAlign: 'center', padding: 24 }}>No lines found.</td></tr>
                    )}
                  </tbody>
                  {poDetailLines.length > 0 && (
                    <tfoot>
                      <tr style={mStyles.tfootRow}>
                        <td colSpan={14} style={{ ...mStyles.td, textAlign: 'right', fontWeight: 700, color: '#475569', background: '#f8fafc' }}>
                          Total Func PHP ({poDetailLines.length} line{poDetailLines.length === 1 ? '' : 's'}) —
                        </td>
                        <td style={{ ...mStyles.td, textAlign: 'right', fontWeight: 800, fontFamily: "'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace", fontSize: 13, color: '#065f46', background: '#f8fafc' }}>
                          {formatFuncAmount(poDetailTotalFunc)}
                        </td>
                        <td style={{ ...mStyles.td, background: '#f8fafc' }} />
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>

              <div style={mStyles.nextStepBox}>
                <div style={mStyles.nextStepLabel}>
                  <FiTarget className="pod-next-step-icon" />
                  <span>What's next</span>
                </div>
                <div style={mStyles.nextStepValue}>{nextStepFor(poDetail.status)}</div>
              </div>

              <div style={mStyles.sectionHead}>
                <span style={mStyles.sectionTitle}>
                  <FiClock className="pod-section-icon" />
                  <span>Activity Timeline <span style={mStyles.sectionCount}>({poDetailActivity.length})</span></span>
                </span>
              </div>

              {poDetailActivityLoading ? (
                <div style={{ padding: 16, textAlign: 'center', color: '#64748b', fontSize: 13 }}>Loading activity…</div>
              ) : poDetailActivity.length === 0 ? (
                <div style={{ padding: 16, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>No activity recorded yet.</div>
              ) : (
                <div style={mStyles.timelineWrap}>
                  {poDetailActivity.map((evt, idx) => {
                    const isLast = idx === poDetailActivity.length - 1;
                    const color  = activityColor(evt.event_type);
                    const ActivityIcon = activityIcon(evt.event_type);
                    return (
                      <div key={evt.log_id} style={mStyles.timelineItem}>
                        <div style={mStyles.timelineRail}>
                          <div style={{ ...mStyles.timelineDot, background: color, boxShadow: `0 0 0 3px ${color}22` }}>
                            <ActivityIcon className="timeline-dot-svg" />
                          </div>
                          {!isLast && <div style={mStyles.timelineLine} />}
                        </div>
                        <div style={mStyles.timelineBody}>
                          <div style={mStyles.timelineSummary}>{evt.event_summary || evt.event_type}</div>
                          <div style={mStyles.timelineMeta}>
                            <span style={mStyles.timelineActor}>{evt.actor || 'System'}</span>
                            <span style={mStyles.timelineDotSep}>·</span>
                            <span>{formatDateTime(evt.acted_at)}</span>
                            <span style={mStyles.timelineDotSep}>·</span>
                            <span style={{ ...mStyles.timelineTypeChip, color, borderColor: color }}>{evt.event_type}</span>
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
    </div>
  );
};

const mStyles = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.62)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000, padding: 'clamp(8px, 2vw, 24px)', animation: 'tabFadeIn 0.18s ease' },
  card: { background: '#ffffff', borderRadius: 'clamp(12px, 1.5vw, 18px)', width: '100%', maxWidth: 1440, maxHeight: '92vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 24px 64px rgba(15, 23, 42, 0.28), 0 4px 14px rgba(15, 23, 42, 0.14)', animation: 'tabSlideUp 0.22s cubic-bezier(0.34, 1.3, 0.64, 1)' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: 'clamp(14px, 1.8vw, 20px) clamp(18px, 2.4vw, 26px)', borderBottom: '1px solid #e5e7eb', background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', flexShrink: 0 },
  headerLeft: { display: 'flex', alignItems: 'center', gap: 14, flex: 1, minWidth: 0 },
  headerIcon: { width: 44, height: 44, borderRadius: 12, background: 'linear-gradient(135deg, #00e0d4 0%, #008a82 100%)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, boxShadow: '0 4px 12px rgba(0, 210, 200, 0.32)', flexShrink: 0 },
  headerTitle: { margin: 0, fontSize: 'clamp(18px, 1.8vw, 22px)', fontWeight: 700, color: '#0f172a', fontFamily: "'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace", lineHeight: 1.2 },
  headerSub: { fontSize: 12, color: '#64748b', marginTop: 4, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  headerDot: { color: '#cbd5e1' },
  closeBtn: { background: 'transparent', border: 'none', width: 36, height: 36, borderRadius: 8, cursor: 'pointer', fontSize: 18, color: '#64748b', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, overflowY: 'auto', padding: 'clamp(16px, 2vw, 24px)', display: 'flex', flexDirection: 'column', gap: 14 },
  footer: { display: 'flex', justifyContent: 'flex-end', gap: 10, padding: 'clamp(12px, 1.5vw, 16px) clamp(18px, 2.4vw, 26px)', borderTop: '1px solid #e5e7eb', background: '#f8fafc', flexShrink: 0, flexWrap: 'wrap' },
  metaGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 },
  metaBox: { padding: '10px 14px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8 },
  metaLabel: { fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 },
  metaValue: { fontSize: 13, fontWeight: 600, color: '#0f172a', wordBreak: 'break-word' },
  fxStrip: { display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 14px', background: 'linear-gradient(135deg, #f5f3ff 0%, #eef2ff 100%)', border: '1px solid #c7d2fe', borderRadius: 10, fontSize: 12.5, color: '#1e1b4b', lineHeight: 1.55 },
  fxStripIcon: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, width: 18, height: 18, color: '#4338ca', marginTop: 1 },
  sectionHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginTop: 4 },
  sectionTitle: { fontSize: 14, fontWeight: 700, color: '#0f172a', display: 'inline-flex', alignItems: 'center', gap: 8 },
  sectionCount: { color: '#64748b', fontWeight: 500 },
  summaryChip: { fontSize: 12, fontWeight: 600, padding: '5px 12px', background: '#eef2ff', color: '#4338ca', borderRadius: 999 },
  tableWrap: { overflow: 'auto', maxHeight: '52vh', border: '1px solid #e2e8f0', borderRadius: 10, background: '#fff' },
  table: { width: '100%', borderCollapse: 'collapse', minWidth: 1480, fontSize: 13 },
  th: { padding: '10px 12px', textAlign: 'left', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#64748b', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', position: 'sticky', top: 0, zIndex: 1, whiteSpace: 'nowrap' },
  row: { borderBottom: '1px solid #f1f5f9' },
  tfootRow: { borderTop: '2px solid #e2e8f0' },
  td: { padding: '8px 12px', color: '#0f172a', verticalAlign: 'middle' },
  tdItem: { padding: '8px 12px', verticalAlign: 'middle', minWidth: 220 },
  itemCell: { display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 },
  itemCode: { fontWeight: 700, fontSize: 12, fontFamily: "'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace", color: '#4338ca', lineHeight: 1.2 },
  itemName: { fontSize: 11, color: '#475569', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  uomTag: { display: 'inline-block', padding: '2px 8px', background: '#f1f5f9', color: '#334155', borderRadius: 6, fontSize: 10, fontWeight: 600, fontFamily: "'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace" },
  barcodeTag: { display: 'inline-block', padding: '2px 8px', background: '#f5f3ff', color: '#7c3aed', border: '1px solid #ddd6fe', borderRadius: 999, fontSize: 10, fontWeight: 700, fontFamily: "'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace", letterSpacing: '0.02em' },
  catTag: { display: 'inline-block', padding: '2px 8px', background: '#f0fdfa', color: '#0f766e', border: '1px solid #99f6e4', borderRadius: 999, fontSize: 10, fontWeight: 700 },
  pcTag: { display: 'inline-block', padding: '2px 8px', background: '#eef2ff', color: '#4338ca', border: '1px solid #c7d2fe', borderRadius: 999, fontSize: 10, fontWeight: 700 },
  glTag: { display: 'inline-block', padding: '2px 8px', background: '#fef3c7', color: '#92400e', border: '1px solid #fcd34d', borderRadius: 999, fontSize: 10, fontWeight: 700, fontFamily: "'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace" },
  currencyTag: { display: 'inline-block', padding: '2px 8px', background: '#ecfeff', color: '#0e7490', border: '1px solid #a5f3fc', borderRadius: 999, fontSize: 10, fontWeight: 700, fontFamily: "'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace", letterSpacing: '0.04em' },
  subText: { fontSize: 10, color: '#64748b', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  emptyCell: { color: '#cbd5e1' },
  nextStepBox: { padding: '12px 16px', background: 'linear-gradient(135deg, #eef2ff 0%, #e0e7ff 100%)', border: '1px solid #c7d2fe', borderRadius: 10 },
  nextStepLabel: { fontSize: 10, fontWeight: 700, color: '#4338ca', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4, display: 'inline-flex', alignItems: 'center', gap: 6 },
  nextStepValue: { fontSize: 13, fontWeight: 600, color: '#1e1b4b', lineHeight: 1.5 },
  timelineWrap: { display: 'flex', flexDirection: 'column', padding: '4px 0' },
  timelineItem: { display: 'flex', gap: 14, alignItems: 'flex-start' },
  timelineRail: { display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0, width: 32 },
  timelineDot: { width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' },
  timelineLine: { width: 2, flex: 1, minHeight: 24, background: '#e2e8f0', margin: '2px 0' },
  timelineBody: { flex: 1, paddingBottom: 14, minWidth: 0 },
  timelineSummary: { fontSize: 13, fontWeight: 600, color: '#0f172a', lineHeight: 1.4, wordBreak: 'break-word' },
  timelineMeta: { marginTop: 4, fontSize: 11, color: '#64748b', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  timelineActor: { fontFamily: "'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace", fontWeight: 600, color: '#475569' },
  timelineDotSep: { color: '#cbd5e1' },
  timelineTypeChip: { display: 'inline-block', padding: '1px 7px', border: '1px solid', borderRadius: 999, fontSize: 10, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase' },
};

const tabCss = `
@keyframes tabFadeIn { from { opacity: 0 } to { opacity: 1 } }
@keyframes tabSlideUp { from { opacity: 0; transform: translateY(16px) scale(0.98) } to { opacity: 1; transform: translateY(0) scale(1) } }

/* ---------- Global icon helpers used across this tab ---------- */
.section-heading-icon {
  display: inline-flex; align-items: center; justify-content: center;
  width: 1em; height: 1em; margin-right: 8px; vertical-align: -0.15em;
  color: #1a1f26;
}
.section-heading-icon svg { width: 100%; height: 100%; stroke-width: 2.2; }

.banner-icon {
  display: inline-flex; align-items: center; justify-content: center;
  flex-shrink: 0; width: 18px; height: 18px;
}
.banner-icon svg { width: 100%; height: 100%; stroke-width: 2.2; }
.banner-icon--info    { color: #1e3a8a; }
.banner-icon--store   { color: #0e7490; }
.banner-icon--release { color: #9a3412; }
.banner-icon--pending { color: #92400e; }

.inline-btn-icon {
  width: 1em; height: 1em; flex-shrink: 0;
  stroke-width: 2.4;
}

.inline-chip-icon {
  width: 1em; height: 1em; flex-shrink: 0;
  stroke-width: 2.4;
  vertical-align: -0.1em;
}

.pod-section-icon {
  width: 16px; height: 16px; stroke-width: 2.2;
  color: #334155; flex-shrink: 0;
}

.pod-next-step-icon {
  width: 12px; height: 12px; stroke-width: 2.6;
  color: #4338ca; flex-shrink: 0;
}

.timeline-dot-svg {
  width: 14px; height: 14px; stroke-width: 2.4;
  color: #ffffff;
}

/* ---------- PR / PO pills ---------- */
.hrp-pr-pill {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 7px;
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.06em;
  color: #9a3412;
  background: #fff7ed;
  border: 1px solid #fed7aa;
  border-radius: 4px;
  vertical-align: middle;
}
.hrp-pr-pill--inline { margin-left: 0; }
.hrp-pr-pill--modal  { margin-left: 8px; }
.hrp-type-pill {
  display: inline-block;
  padding: 1px 7px;
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.06em;
  border-radius: 4px;
}
.hrp-type-pill--po {
  background: #ecfeff;
  color: #0e7490;
  border: 1px solid #a5f3fc;
}

/* ---------- Items received table ---------- */
.items-received-table { width: 100%; min-width: 900px; table-layout: fixed; }
.items-received-table .col-item     { width: 34%; }
.items-received-table .col-qty      { width: 14%; text-align: center; }
.items-received-table .col-price    { width: 16%; }
.items-received-table .col-delivery { width: 12%; text-align: center; }
.items-received-table .col-status   { width: 12%; }
.items-received-table .col-actions  { width: 12%; text-align: right; }

.items-received-table thead th {
  padding: 14px 16px; font-size: 12px; font-weight: 700;
  letter-spacing: 0.06em; color: #475569; text-align: left;
  background: #f8fafc; border-bottom: 1px solid #e2e8f0; white-space: nowrap;
}
.items-received-table thead th.col-qty      { text-align: center; }
.items-received-table thead th.col-delivery { text-align: center; }
.items-received-table thead th.col-actions  { text-align: right; }

.items-received-table tbody td {
  padding: 14px 16px; font-size: 14px;
  vertical-align: middle; border-bottom: 1px solid #f1f5f9;
}
.items-received-table tbody td.col-qty      { text-align: center; }
.items-received-table tbody td.col-delivery { text-align: center; }
.items-received-table tbody td.col-actions  { text-align: right; }

.items-received-table .item-cell { display: flex; align-items: center; gap: 12px; min-width: 0; }
.items-received-table .item-code-line { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.items-received-table .item-code {
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-weight: 700; font-size: 14px; color: #4338ca; line-height: 1.2;
}
.items-received-table .item-barcode-chip {
  display: inline-block; padding: 2px 8px;
  font-size: 10px; font-weight: 700; color: #7c3aed; background: #f5f3ff;
  border: 1px solid #ddd6fe; border-radius: 999px;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  letter-spacing: 0.02em; white-space: nowrap;
}
.items-received-table .item-source-chip {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 2px 8px;
  font-size: 10px; font-weight: 700; color: #4338ca; background: #eef2ff;
  border: 1px solid #c7d2fe; border-radius: 999px;
  letter-spacing: 0.02em; white-space: nowrap;
}
.items-received-table .item-name {
  font-size: 12px; color: #475569; margin-top: 2px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.items-received-table .item-po-chip {
  display: inline-block; margin-top: 4px; padding: 2px 8px;
  font-size: 10px; font-weight: 600; color: #0f766e; background: #f0fdfa;
  border: 1px solid #99f6e4; border-radius: 999px; letter-spacing: 0.02em;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
}
.items-received-table .qty-big {
  display: block;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-size: 18px; font-weight: 700; color: #0f172a; line-height: 1.1;
}
.items-received-table .qty-received-sub {
  display: block; margin-top: 2px;
  font-size: 11px; color: #64748b; font-weight: 600; letter-spacing: 0.02em;
}
.items-received-table .col-price {
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-size: 13px; color: #334155;
}
.items-received-table .col-price .price-main {
  font-weight: 600; color: #0f172a; white-space: nowrap;
}
.items-received-table .col-price .price-fx {
  margin-top: 3px; font-size: 10.5px; color: #4338ca; font-weight: 600;
  letter-spacing: 0.02em; white-space: nowrap;
}
.items-received-table .col-price .price-fx-php {
  color: #065f46; font-weight: 800;
}

/* ---------- Delivery badge ---------- */
.delivery-badge {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 3px 10px; border-radius: 999px;
  font-size: 11px; font-weight: 700; letter-spacing: 0.02em;
  white-space: nowrap;
}
.delivery-badge--complete {
  background: #dcfce7; color: #065f46; border: 1px solid #86efac;
}
.delivery-badge--partial {
  background: #fef3c7; color: #92400e; border: 1px solid #fcd34d;
}
.delivery-badge--unknown,
.delivery-badge--none {
  background: #f1f5f9; color: #94a3b8; border: 1px solid #e2e8f0;
  font-weight: 500;
}

.po-clickable-row { cursor: pointer; transition: background 0.15s ease; }
.po-clickable-row:hover { background: #f0fdfa !important; }
.po-clickable-row:active { background: #e6fffb !important; }
.po-clickable-row.is-sts-row { cursor: default; }
.po-clickable-row.is-sts-row:hover { background: #f8fafc !important; }

.items-received-table .col-actions .action-buttons {
  display: flex; flex-direction: column; align-items: stretch; gap: 6px; width: 100%;
}
.items-received-table .col-actions .action-buttons > * {
  width: 100%; box-sizing: border-box;
  display: inline-flex; align-items: center; justify-content: center;
  text-align: center; white-space: normal; word-break: break-word;
  line-height: 1.2; margin: 0; padding: 9px 12px; font-size: 13px; font-weight: 600;
}
.items-received-table .col-actions > .po-view-hint {
  width: 100%; box-sizing: border-box;
  display: inline-flex; align-items: center; justify-content: center;
  text-align: center; white-space: normal; word-break: break-word;
  padding: 9px 12px; font-size: 13px; font-weight: 600;
}
.items-received-table .col-actions .pending-transfer-chip {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  white-space: normal; word-break: break-word; padding: 9px 12px; font-size: 13px; font-weight: 700;
}

.po-view-hint {
  display: inline-block; font-size: 14px; font-weight: 600;
  color: #0f766e; padding: 8px 14px;
  border: 1px solid #99f6e4; background: #f0fdfa;
  border-radius: 8px; white-space: nowrap; cursor: pointer; font-family: inherit;
  transition: background 0.15s ease, border-color 0.15s ease, transform 0.1s ease;
}
.po-view-hint:hover { background: #ccfbf1; border-color: #5eead4; }
.po-view-hint:active { transform: scale(0.97); }

.status-badge.pending-transfer {
  display: inline-block; padding: 4px 12px; border-radius: 999px;
  font-size: 12px; font-weight: 700; letter-spacing: 0.03em;
  background: #fef3c7; color: #92400e; border: 1px solid #fcd34d; white-space: nowrap;
}
.pending-transfer-chip {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  padding: 8px 14px; border-radius: 8px;
  font-size: 13px; font-weight: 600; background: #fef3c7; color: #92400e;
  border: 1px solid #fcd34d; white-space: normal; word-break: break-word;
}

.pod-close:hover { background: #f1f5f9; color: #0f172a; }
.pod-body::-webkit-scrollbar { width: 8px; }
.pod-body::-webkit-scrollbar-track { background: #f1f5f9; border-radius: 4px; }
.pod-body::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 4px; }
.pod-body::-webkit-scrollbar-thumb:hover { background: #94a3b8; }

/* ============================================================
   Pagination
   ============================================================ */
.received-pager {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  margin-top: 16px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  box-sizing: border-box;
}
.received-pager-info {
  font-size: 13px;
  color: #475569;
  line-height: 1.45;
}
.received-pager-info strong {
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-weight: 800;
  color: #0f172a;
}
.received-pager-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.received-page-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 36px;
  padding: 8px 14px;
  font-size: 13px;
  font-weight: 600;
  border-radius: 8px;
  border: 1px solid #cbd5e1;
  background: #ffffff;
  color: #334155;
  font-family: inherit;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
  white-space: nowrap;
}
.received-page-btn:hover:not(:disabled) {
  background: #f1f5f9;
  border-color: #94a3b8;
}
.received-page-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.received-page-indicator {
  font-size: 12.5px;
  font-weight: 700;
  color: #334155;
  padding: 0 10px;
  min-width: 70px;
  text-align: center;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-variant-numeric: tabular-nums;
}

/* ============================================================
   Truncation warning
   ============================================================ */
.received-truncation-warning {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 14px;
  margin-bottom: 12px;
  background: #fffbeb;
  border: 1px solid #fde68a;
  border-left: 4px solid #f59e0b;
  border-radius: 8px;
  color: #92400e;
  font-size: 13px;
  line-height: 1.55;
  box-sizing: border-box;
}
.received-truncation-warning > svg {
  width: 16px;
  height: 16px;
  stroke-width: 2.4;
  flex-shrink: 0;
  margin-top: 1px;
  color: #d97706;
}
.received-truncation-warning strong {
  color: #78350f;
  font-weight: 800;
}

@media (max-width: 900px) {
  .items-received-table { min-width: 860px; }
  .items-received-table thead th { padding: 12px 10px; font-size: 11px; }
  .items-received-table tbody td { padding: 12px 10px; font-size: 13px; }
  .items-received-table .item-code { font-size: 12px; }
  .items-received-table .qty-big   { font-size: 16px; }
  .items-received-table .col-price .price-fx { font-size: 10px; }
}

@media (max-width: 900px) {
  .pod-body { padding: 14px !important; }
}

@media (max-width: 720px) {
  .pod-footer button { flex: 1 1 auto; }
  .pod-footer { justify-content: stretch !important; }
  .pod-card { max-width: 100vw !important; }

  /* Pager stacks on tablet / phone */
  .received-pager {
    flex-direction: column;
    align-items: stretch;
  }
  .received-pager-controls {
    justify-content: center;
  }
}

@media (max-width: 640px) {
  .received-page-btn {
    flex: 1 1 auto;
    min-width: 80px;
    padding: 8px 10px;
    font-size: 12.5px;
  }
  .received-pager-info {
    font-size: 12.5px;
    text-align: center;
  }
  .received-truncation-warning {
    font-size: 12.5px;
    padding: 9px 12px;
  }
}

@media (max-width: 480px) {
  .pod-overlay { padding: 0 !important; align-items: stretch !important; }
  .pod-card {
    max-height: 100vh !important;
    max-height: 100dvh !important;
    width: 100vw !important;
    max-width: 100vw !important;
    height: 100vh !important;
    height: 100dvh !important;
    border-radius: 0 !important;
    animation: none !important;
  }
  .pod-header,
  .pod-footer { padding-left: 14px !important; padding-right: 14px !important; }
  .pod-body   { padding: 14px !important; }

  .items-received-table { min-width: 820px; }
  .items-received-table thead th { padding: 10px 8px; font-size: 10px; }
  .items-received-table tbody td { padding: 10px 8px; font-size: 12px; }
  .items-received-table .item-code { font-size: 11px; }
  .items-received-table .qty-big   { font-size: 15px; }
  .items-received-table .qty-received-sub { font-size: 10px; }

  .received-page-btn {
    min-width: 0;
    flex: 0 0 auto;
    padding: 8px 10px;
    font-size: 12px;
  }
  .received-page-indicator {
    padding: 0 6px;
    min-width: 56px;
    font-size: 12px;
  }
  .received-truncation-warning {
    font-size: 12px;
    padding: 8px 10px;
    gap: 8px;
  }
  .received-truncation-warning > svg { width: 14px; height: 14px; }
}

@media (max-width: 380px) {
  .pod-header h3 { font-size: 15px !important; }
  .pod-footer { flex-direction: column-reverse !important; }
  .pod-footer > button { width: 100%; }

  .received-page-btn {
    padding: 6px 8px;
    font-size: 11.5px;
  }
  .received-page-indicator {
    font-size: 11.5px;
    min-width: 48px;
    padding: 0 4px;
  }
  .received-truncation-warning { font-size: 11.5px; }
}

@media (min-width: 1921px) {
  .received-pager { padding: 16px 20px; }
  .received-pager-info { font-size: 14px; }
  .received-page-btn { min-height: 40px; padding: 10px 18px; font-size: 14px; }
  .received-page-indicator { font-size: 14px; min-width: 84px; }
  .received-truncation-warning { font-size: 14px; padding: 12px 18px; }
}

@media (max-height: 500px) and (orientation: landscape) {
  .pod-overlay { padding: 8px !important; align-items: center !important; }
  .pod-card {
    height: auto !important; max-height: 96vh !important;
    border-radius: 12px !important; max-width: 96vw !important;
  }
  .pod-header { padding: 8px 14px !important; }
  .pod-body   { padding: 10px 14px !important; gap: 10px !important; }
  .pod-footer { padding: 8px 14px !important; }
}

@media (prefers-reduced-motion: reduce) {
  .pod-card, .pod-overlay { animation: none !important; }
  .po-card, .po-clickable-row { transition: none !important; }
  .po-view-hint { transition: none !important; }
  .received-page-btn { transition: none !important; }
}
`;

export default TabReceivedPO;