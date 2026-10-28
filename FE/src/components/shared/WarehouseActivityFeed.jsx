// src/components/shared/WarehouseActivityFeed.jsx
//
// Cross-source activity timeline for one warehouse. Merges:
//   • po_activity_log             → /api/import-po/activity-feed
//   • stock_transfer_activity_log → /api/stock-transfer/activity-feed
//
// Session 9 (F5) — proper server-side pagination.
//
// Session 10 (G1) — GROUP BY DOCUMENT.
//   The flat per-event feed was confusing; one event per row made it
//   hard to see "what happened to this PO" or "how far along is this
//   transfer". Now the feed renders ONE row per source document
//   (PO / PR / STS), with the full chronological event timeline shown
//   only when the row is expanded. Grouping is done client-side from
//   the `_ref_type` + `_ref_no` fields carried on every normalized
//   event, so the backend contract is unchanged.
//
// Session 10 (G5) — SILENT REFRESH ON FOCUS.
//   When the browser tab regains focus, the feed silently re-fetches
//   both sources so an admin returning to the tab sees fresh data
//   without pressing Refresh. Implemented via the shared
//   `useRefreshOnFocus` hook. No spinner, no toast — errors are
//   swallowed so a background refresh never disturbs the user.
//
// Session 12 (H1) — FIX: `docGroups` did not expose `stages` Set.
//   The aggregation only returned `stageCount` (a number), but
//   `DocumentRow` expects `doc.stages` to be a Set so it can render
//   one chip per stage. That mismatch produced:
//     TypeError: undefined is not iterable (cannot read property
//     Symbol(Symbol.iterator)) at Array.from.
//   Two fixes:
//     1) docGroups now returns `stages: d.stages` alongside the count.
//     2) DocumentRow guards with `doc.stages || []` so a future
//        regression degrades gracefully instead of crashing the tab.
//
// Session 13 (I1) — PO vs PR LABELLING.
//   po_activity_log rows now carry a `has_po` flag resolved by the
//   backend. `activityStyles.normalizePoEvent` turns that into
//   `_ref_type` = 'PO' or 'PR'. DocumentRow picks the label and the
//   icon off `doc.refType`, so a PR-based import shows a "PR" pill
//   with a tag icon instead of the old ambiguous "PO / PR" chip.
//
// Session 13 (I2) — DOC TYPE FILTER.
//   A new segmented control ("All | PO | PR") sits before the Stage
//   filter. It narrows the visible documents client-side using each
//   event's `_ref_type`. It is hidden on the Transfers-only source
//   tab because STS rows have no PO/PR distinction to filter on.
//   State persists across tab switches so returning to "All" keeps
//   the user's prior selection.
//
// Session 13 (I3) — STORE STAGE SPLIT.
//   The 'STORE' stage exists in BOTH flows: PO lines stored to a
//   locator (import flow) and STS lines stored at the destination
//   (transfer flow). The All-stages dropdown exposes:
//       Store (all sources)   →  server sends stage=STORE
//       Stored Import         →  server sends stage=STORE; client
//                                 keeps only events with _source='po'
//       Stored STS            →  server sends stage=STORE; client
//                                 keeps only events with _source='sts'
//   The `_source` stamp is set by normalizePoEvent / normalizeStsEvent,
//   so no backend change is required — pagination, load-more, and
//   total counts keep working exactly as before.
//
// Session 13 (I4) — ORGANIZED STAGE DROPDOWN.
//   ALL_STAGES now mirrors the real workflow order:
//     All Stages → Import → Stored Import → Approved Requests →
//     For Transfer → In-Transit → Received STS → Stored STS → Issued
//     → (group) Others → All Stored / Transfer / Request / Complete /
//     Cancel.
//   The renderer below supports BOTH shapes the options array can
//   take: a plain { value, label } entry renders as <option>, and a
//   { group, options } entry renders as <optgroup> with a bold,
//   non-selectable heading.
//
// Props:
//   warehouseCode  string  REQUIRED — the anchor for every query
//   title          string  optional header title
//   defaultSource  'all' | 'po' | 'sts'   — initial tab
//   initialLimit   number  optional per-source page size (default 200)
//   onSelectRef    fn(doc) optional — fired when a document row is expanded

import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import {
  FiActivity,
  FiSearch,
  FiX,
  FiFilter,
  FiChevronDown,
  FiChevronRight,
  FiRefreshCw,
  FiCalendar,
  FiPackage,
  FiTruck,
  FiLayers,
  FiDownload,
  FiInbox,
  FiArrowRight,
  FiCheckCircle,
  FiXCircle,
  FiAlertTriangle,
  FiTarget,
  FiHome,
  FiSend,
  FiSlash,
  FiAward,
  FiCircle,
  FiUser,
  FiMapPin,
  FiInfo,
  FiTag,
  FiChevronDown as FiChevronDownIcon,
} from 'react-icons/fi';

import { getToken } from '../../secure/auth';
import {
  PO_STAGES,
  STS_STAGES,
  ALL_STAGES,
  eventLabel,
  stageMeta,
  normalizePoEvent,
  normalizeStsEvent,
  sortByActedAtDesc,
  formatQtyChange,
} from './activityStyles';

import { useRefreshOnFocus } from '../../hooks/useRefreshOnFocus';

/* ============================================================
   CONSTANTS
   ============================================================ */
const API_URL   = 'http://localhost:5000/api';
const DEFAULT_LIMIT = 200;
const MAX_LIMIT     = 2000;
const SEARCH_DEBOUNCE_MS = 300;

/* Pseudo-stage values that resolve to `stage = 'STORE'` server-side
   but require a client-side source check (Session 13, I3). */
const STORE_PSEUDO = Object.freeze({
  STORE_IMPORT: 'po',
  STORE_STS:    'sts',
});

const isStorePseudo = (v) => v === 'STORE_IMPORT' || v === 'STORE_STS';

/* ============================================================
   TINY FETCH HELPER — independent of api.js
   ============================================================ */
const fetchFeed = async (path) => {
  const token = getToken();
  if (!token) return { ok: false, status: 401, data: null };
  try {
    const res = await fetch(`${API_URL}${path}`, {
      method: 'GET',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${token}`,
      },
    });
    const data = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, data };
  } catch (e) {
    return { ok: false, status: 0, data: null, error: e.message };
  }
};

/* ============================================================
   FORMAT HELPERS
   ============================================================ */
const formatTime = (v) => {
  if (!v) return '—';
  try {
    return new Date(v).toLocaleTimeString(undefined, {
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return '—';
  }
};

const formatDateTimeFull = (v) => {
  if (!v) return '—';
  try {
    return new Date(v).toLocaleString();
  } catch {
    return '—';
  }
};

/* ============================================================
   EVENT → FEATHER ICON
   ============================================================ */
const eventIcon = (type) => {
  switch (type) {
    case 'IMPORT_PO_LINE':
    case 'Imported':             return FiDownload;
    case 'RECEIVE_PO_LINE':
    case 'Received':
    case 'TransferReceived':
    case 'RECEIVED':
    case 'ARRIVED':              return FiInbox;
    case 'STORE_PO_LINE':
    case 'Stored':
    case 'STORE_LINE':           return FiHome;
    case 'DAMAGE_PO_LINE':
    case 'MARK_PO_LINE_DAMAGED': return FiAlertTriangle;
    case 'RELEASE_PO_LINE':
    case 'Released':             return FiSend;
    case 'Forwarded':
    case 'TRANSFER_PO_LINE_OUT':
    case 'TRANSFER_PO_LINE_IN':  return FiArrowRight;
    case 'TransferSubmitted':
    case 'TransferResubmitted':
    case 'REQUEST_SUBMITTED':    return FiPackage;
    case 'TransferApproved':
    case 'APPROVED':             return FiCheckCircle;
    case 'QTY_ADJUSTED':         return FiTarget;
    case 'TransferRejected':
    case 'REJECTED':             return FiXCircle;
    case 'TransferCancelled':
    case 'CANCELLED':            return FiSlash;
    case 'TransferInTransit':
    case 'SHIPPED':              return FiTruck;
    case 'TransferCompleted':
    case 'COMPLETED':            return FiAward;
    default:                     return FiCircle;
  }
};

/* ============================================================
   INITIAL PER-SOURCE STATE
   ============================================================ */
const emptySourceState = (limit) => ({
  rows: [],
  page: 1,
  limit,
  total: 0,
  loading: false,
});

/* Sort events within a document: oldest → newest (chronological). */
const sortByActedAtAsc = (a, b) => {
  const at = a._acted_at ? new Date(a._acted_at).getTime() : 0;
  const bt = b._acted_at ? new Date(b._acted_at).getTime() : 0;
  if (at !== bt) return at - bt;
  // tie-break: log_id ascending if present
  const ai = Number(a.log_id) || 0;
  const bi = Number(b.log_id) || 0;
  return ai - bi;
};

/* ============================================================
   DOC TYPE OPTIONS (Session 13, I2)
   ------------------------------------------------------------
   Three-way segmented control placed before the Stage filter.
   The values map directly onto `_ref_type`:
     'All'  → no filter
     'PO'   → only PO-sourced rows
     'PR'   → only PR-sourced rows
   ============================================================ */
const DOC_TYPE_OPTIONS = [
  { value: 'All', label: 'All' },
  { value: 'PO',  label: 'PO'  },
  { value: 'PR',  label: 'PR'  },
];

/* ============================================================
   MAIN COMPONENT
   ============================================================ */
const WarehouseActivityFeed = ({
  warehouseCode,
  title = 'Warehouse Activity',
  defaultSource = 'all',
  initialLimit = DEFAULT_LIMIT,
  onSelectRef = null,
}) => {
  /* ---------- safe numeric limit ---------- */
  const safeLimit = useMemo(() => {
    const n = Number(initialLimit);
    if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
    return Math.min(Math.max(Math.floor(n), 1), MAX_LIMIT);
  }, [initialLimit]);

  /* ---------- UI state ---------- */
  const [source, setSource]               = useState(defaultSource);
  const [docTypeFilter, setDocTypeFilter] = useState('All'); // 'All' | 'PO' | 'PR' — Session 13 (I2)
  const [stageFilter, setStageFilter]     = useState('All'); // may be a STORE pseudo (I3)
  const [startDate, setStartDate]         = useState('');
  const [endDate, setEndDate]             = useState('');
  const [search, setSearch]               = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  /* ---------- per-source data state ---------- */
  const [poState,  setPoState]  = useState(() => emptySourceState(safeLimit));
  const [stsState, setStsState] = useState(() => emptySourceState(safeLimit));

  /* ---------- transient state ---------- */
  const [error, setError]                 = useState('');
  const [expandedDocKey, setExpandedDocKey] = useState(null);
  const [reloadToken, setReloadToken]     = useState(0);

  /* ---------- request-id guard ---------- */
  const reqIdRef = useRef(0);

  /* ---------- search debounce ---------- */
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [search]);

  /* ============================================================
     Session 13 (I3) — map the pseudo-stage filter to the value the
     backend understands. Both STORE_IMPORT and STORE_STS collapse
     to 'STORE'; the flow split happens on the client.
     ============================================================ */
  const serverStage = useMemo(() => {
    if (isStorePseudo(stageFilter)) return 'STORE';
    return stageFilter;
  }, [stageFilter]);

  /* ============================================================
     BUILD QUERY STRING — shared across initial load + load-more

     Uses `serverStage` (never the pseudo value) so the backend
     receives only valid stage codes. Because `buildQuery` is
     memoised on `serverStage`, switching between STORE_IMPORT
     and STORE_STS does NOT trigger a re-fetch — the client-side
     filter in `merged` handles the difference from data already
     in memory.
     ============================================================ */
  const buildQuery = useCallback((pageNum, side) => {
    const qs = new URLSearchParams();
    qs.append('warehouse_code', warehouseCode);
    qs.append('limit', String(safeLimit));
    qs.append('page',  String(pageNum));
    if (serverStage && serverStage !== 'All') qs.append('stage', serverStage);
    if (startDate) qs.append('start_date', startDate);
    if (endDate)   qs.append('end_date', endDate);
    if (debouncedSearch) qs.append('q', debouncedSearch);
    if (side === 'sts') qs.append('side', 'both');
    return qs.toString();
  }, [warehouseCode, safeLimit, serverStage, startDate, endDate, debouncedSearch]);

  /* ============================================================
     INITIAL / RESET LOAD — fires whenever source or server-side
     filters change. (`stageFilter` is intentionally NOT in the
     dep list; `buildQuery` already tracks the resolved value.)
     ============================================================ */
  useEffect(() => {
    if (!warehouseCode) return;

    const myReqId = ++reqIdRef.current;
    setError('');
    setExpandedDocKey(null);

    const wantsPo  = source === 'all' || source === 'po';
    const wantsSts = source === 'all' || source === 'sts';

    setPoState(() => ({ ...emptySourceState(safeLimit), loading: wantsPo }));
    setStsState(() => ({ ...emptySourceState(safeLimit), loading: wantsSts }));

    const poPromise = wantsPo
      ? fetchFeed(`/import-po/activity-feed?${buildQuery(1, 'po')}`)
      : Promise.resolve(null);
    const stsPromise = wantsSts
      ? fetchFeed(`/stock-transfer/activity-feed?${buildQuery(1, 'sts')}`)
      : Promise.resolve(null);

    (async () => {
      const [poRes, stsRes] = await Promise.all([poPromise, stsPromise]);
      if (myReqId !== reqIdRef.current) return;

      if (poRes) {
        const rows = (poRes.ok && Array.isArray(poRes.data?.data))
          ? poRes.data.data.map(normalizePoEvent).filter(Boolean)
          : [];
        setPoState({
          rows,
          page:  poRes.data?.page  || 1,
          limit: poRes.data?.limit || safeLimit,
          total: poRes.data?.total || 0,
          loading: false,
        });
      }

      if (stsRes) {
        const rows = (stsRes.ok && Array.isArray(stsRes.data?.data))
          ? stsRes.data.data.map(normalizeStsEvent).filter(Boolean)
          : [];
        setStsState({
          rows,
          page:  stsRes.data?.page  || 1,
          limit: stsRes.data?.limit || safeLimit,
          total: stsRes.data?.total || 0,
          loading: false,
        });
      }
    })().catch((err) => {
      if (myReqId !== reqIdRef.current) return;
      console.error('WarehouseActivityFeed initial load error:', err);
      setError(err.message || 'Failed to load activity.');
    });
  }, [warehouseCode, source, startDate, endDate, debouncedSearch, safeLimit, buildQuery]);

  /* ============================================================
     LOAD MORE — advances each source independently.
     ============================================================ */
  const loadMore = useCallback(async () => {
    if (!warehouseCode) return;

    const wantsPo  = source === 'all' || source === 'po';
    const wantsSts = source === 'all' || source === 'sts';

    const poHasMore  = poState.page  * poState.limit  < poState.total;
    const stsHasMore = stsState.page * stsState.limit < stsState.total;

    const fetchPo  = wantsPo  && poHasMore;
    const fetchSts = wantsSts && stsHasMore;

    if (!fetchPo && !fetchSts) return;

    if (fetchPo)  setPoState((prev)  => ({ ...prev, loading: true }));
    if (fetchSts) setStsState((prev) => ({ ...prev, loading: true }));

    try {
      const jobs = [];
      if (fetchPo)  jobs.push(fetchFeed(`/import-po/activity-feed?${buildQuery(poState.page + 1, 'po')}`));
      else          jobs.push(Promise.resolve(null));
      if (fetchSts) jobs.push(fetchFeed(`/stock-transfer/activity-feed?${buildQuery(stsState.page + 1, 'sts')}`));
      else          jobs.push(Promise.resolve(null));

      const [poRes, stsRes] = await Promise.all(jobs);

      if (fetchPo && poRes && poRes.ok && Array.isArray(poRes.data?.data)) {
        const newRows = poRes.data.data.map(normalizePoEvent).filter(Boolean);
        setPoState((prev) => ({
          ...prev,
          rows: [...prev.rows, ...newRows],
          page:  poRes.data?.page  || (prev.page + 1),
          total: poRes.data?.total || prev.total,
          loading: false,
        }));
      } else if (fetchPo) {
        setPoState((prev) => ({ ...prev, loading: false }));
      }

      if (fetchSts && stsRes && stsRes.ok && Array.isArray(stsRes.data?.data)) {
        const newRows = stsRes.data.data.map(normalizeStsEvent).filter(Boolean);
        setStsState((prev) => ({
          ...prev,
          rows: [...prev.rows, ...newRows],
          page:  stsRes.data?.page  || (prev.page + 1),
          total: stsRes.data?.total || prev.total,
          loading: false,
        }));
      } else if (fetchSts) {
        setStsState((prev) => ({ ...prev, loading: false }));
      }
    } catch (err) {
      console.error('Load more failed:', err);
      setPoState((prev)  => ({ ...prev, loading: false }));
      setStsState((prev) => ({ ...prev, loading: false }));
      setError('Failed to load more activity.');
    }
  }, [warehouseCode, source, poState.page, poState.limit, poState.total, stsState.page, stsState.limit, stsState.total, buildQuery]);

  /* ============================================================
     MERGE (client-side) — flat list of events for the active tab

     Session 13 (I2): after merging PO + STS events, the doc type
     filter narrows the list to only 'PO' or only 'PR' rows. The
     filter is only meaningful for PO-sourced rows, so it is
     skipped entirely when the source tab is 'sts'.

     Session 13 (I3): the STORE pseudo-stages split the shared
     'STORE' events by origin. The `_source` stamp — set by the
     normalizers — tells us which flow wrote each event.
     ============================================================ */
  const merged = useMemo(() => {
    const poRows  = (source === 'sts') ? [] : poState.rows;
    const stsRows = (source === 'po')  ? [] : stsState.rows;

    let combined = [...poRows, ...stsRows];

    /* Session 13 (I3) — split STORE events by flow. The server
       already restricted them to stage='STORE'; we only need to
       keep the ones that came from the chosen source. */
    if (isStorePseudo(stageFilter)) {
      const wantedSource = STORE_PSEUDO[stageFilter];
      combined = combined.filter(
        (evt) => evt._source === wantedSource && evt._stage === 'STORE'
      );
    }

    if (source !== 'sts' && docTypeFilter !== 'All') {
      combined = combined.filter((evt) => evt._ref_type === docTypeFilter);
    }

    return combined.slice().sort(sortByActedAtDesc);
  }, [poState.rows, stsState.rows, source, docTypeFilter, stageFilter]);

  /* ============================================================
     GROUP BY DOCUMENT (Session 10 G1)
     ------------------------------------------------------------
     One entry per {_ref_type, _ref_no} pair. Events are ordered
     chronologically INSIDE the document; documents are ordered by
     their latest event, descending — so the most recently active
     document sits on top.

     Session 12 (H1) — FIX: the returned object now includes the
     raw `stages` Set (not just `stageCount`) so DocumentRow can
     render one chip per distinct stage. Without this, the feed
     crashed with "undefined is not iterable" at Array.from.

     Session 13 (I1) — because `_ref_type` can now be 'PO' or 'PR',
     a PO and its PR-based sibling sharing the same numeric id are
     correctly kept apart in the Map key (e.g. `PO::1234` vs
     `PR::1234`).
     ============================================================ */
  const docGroups = useMemo(() => {
    const map = new Map();

    for (const evt of merged) {
      const refType = evt._ref_type || 'PO';
      const refNo   = evt._ref_no || 'Unknown';
      const key     = `${refType}::${refNo}`;

      if (!map.has(key)) {
        map.set(key, {
          key,
          refType,
          refNo,
          events: [],
          itemCodes: new Set(),
          stages: new Set(),
        });
      }

      const doc = map.get(key);
      doc.events.push(evt);
      if (evt._item_code) doc.itemCodes.add(evt._item_code);
      if (evt._stage)     doc.stages.add(evt._stage);
    }

    const arr = Array.from(map.values()).map((d) => {
      const eventsAsc = d.events.slice().sort(sortByActedAtAsc);
      return {
        key:         d.key,
        refType:     d.refType,
        refNo:       d.refNo,
        events:      eventsAsc,
        itemCount:   d.itemCodes.size,
        stageCount:  d.stages.size,
        stages:      d.stages,
        latestEvent: eventsAsc[eventsAsc.length - 1] || null,
        firstEvent:  eventsAsc[0] || null,
      };
    });

    arr.sort((a, b) => {
      const aT = a.latestEvent?._acted_at ? new Date(a.latestEvent._acted_at).getTime() : 0;
      const bT = b.latestEvent?._acted_at ? new Date(b.latestEvent._acted_at).getTime() : 0;
      return bT - aT;
    });

    return arr;
  }, [merged]);

  /* ============================================================
     LOAD-MORE VISIBILITY
     ============================================================ */
  const poHasMore  = source !== 'sts' && (poState.page  * poState.limit  < poState.total);
  const stsHasMore = source !== 'po'  && (stsState.page * stsState.limit < stsState.total);
  const hasMore    = poHasMore || stsHasMore;
  const isFetching = poState.loading || stsState.loading;

  const initialLoading =
    (source === 'all' && ((poState.loading && poState.rows.length === 0)
                        || (stsState.loading && stsState.rows.length === 0))
     && merged.length === 0)
    || (source === 'po'  && poState.loading  && poState.rows.length  === 0)
    || (source === 'sts' && stsState.loading && stsState.rows.length === 0);

  const displayEventTotal =
    source === 'po'  ? poState.total  :
    source === 'sts' ? stsState.total :
    poState.total + stsState.total;

  /* ---------- filters ---------- */
  const hasActiveFilter =
    docTypeFilter !== 'All' ||
    stageFilter !== 'All' ||
    !!startDate ||
    !!endDate ||
    !!search.trim();

  /* Session 13 (I3) — a client-side narrowing is active whenever
     the doc-type filter isn't 'All' OR a STORE pseudo-stage is
     selected. When this is true, the raw server total no longer
     reflects the visible count, so we hide the "of N" suffix in
     the header and load-more hint to keep the numbers truthful. */
  const hasClientSideFilter =
    docTypeFilter !== 'All' || isStorePseudo(stageFilter);

  const clearFilters = () => {
    setDocTypeFilter('All');
    setStageFilter('All');
    setStartDate('');
    setEndDate('');
    setSearch('');
  };

  const stageOptions = source === 'po'
    ? PO_STAGES
    : source === 'sts'
      ? STS_STAGES
      : ALL_STAGES;

  const handleDocToggle = (doc) => {
    const key = doc.key;
    setExpandedDocKey((prev) => (prev === key ? null : key));
    if (typeof onSelectRef === 'function' && doc.latestEvent) {
      onSelectRef(doc.latestEvent);
    }
  };

  const handleRefresh = () => {
    setReloadToken((n) => n + 1);
  };

  // Session 10 (G5): silent refresh when the browser tab regains focus.
  useRefreshOnFocus(handleRefresh);

  /* Re-fetch when the user clicks Refresh */
  useEffect(() => {
    if (!warehouseCode) return;
    if (reloadToken === 0) return;

    const myReqId = ++reqIdRef.current;
    setError('');
    setExpandedDocKey(null);

    const wantsPo  = source === 'all' || source === 'po';
    const wantsSts = source === 'all' || source === 'sts';

    setPoState((prev)  => ({ ...prev, loading: wantsPo }));
    setStsState((prev) => ({ ...prev, loading: wantsSts }));

    const poPromise = wantsPo
      ? fetchFeed(`/import-po/activity-feed?${buildQuery(1, 'po')}`)
      : Promise.resolve(null);
    const stsPromise = wantsSts
      ? fetchFeed(`/stock-transfer/activity-feed?${buildQuery(1, 'sts')}`)
      : Promise.resolve(null);

    (async () => {
      const [poRes, stsRes] = await Promise.all([poPromise, stsPromise]);
      if (myReqId !== reqIdRef.current) return;

      if (poRes) {
        const rows = (poRes.ok && Array.isArray(poRes.data?.data))
          ? poRes.data.data.map(normalizePoEvent).filter(Boolean)
          : [];
        setPoState({
          rows,
          page:  poRes.data?.page  || 1,
          limit: poRes.data?.limit || safeLimit,
          total: poRes.data?.total || 0,
          loading: false,
        });
      }
      if (stsRes) {
        const rows = (stsRes.ok && Array.isArray(stsRes.data?.data))
          ? stsRes.data.data.map(normalizeStsEvent).filter(Boolean)
          : [];
        setStsState({
          rows,
          page:  stsRes.data?.page  || 1,
          limit: stsRes.data?.limit || safeLimit,
          total: stsRes.data?.total || 0,
          loading: false,
        });
      }
    })().catch((err) => {
      if (myReqId !== reqIdRef.current) return;
      console.error('WarehouseActivityFeed refresh error:', err);
      setError(err.message || 'Failed to refresh activity.');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadToken]);

  /* ---------- missing warehouse guard ---------- */
  if (!warehouseCode) {
    return (
      <div className="waf-root">
        <style>{wafCss}</style>
        <div className="waf-empty">
          <div className="waf-empty-icon"><FiActivity /></div>
          <div className="waf-empty-title">Warehouse code required</div>
          <div className="waf-empty-sub">
            Pass <code>warehouseCode</code> to mount this activity feed.
          </div>
        </div>
      </div>
    );
  }

  /* ---------- header sub-line ----------
     Session 13 (I3) — when a client-side filter narrows the list,
     the raw server total no longer matches what the user sees.
     We suppress the "of N" suffix in that case to avoid misleading
     "showing 3 of 900" numbers. */
  const headerSub = initialLoading
    ? 'Loading activity…'
    : docGroups.length === 0
      ? 'No activity yet'
      : (hasClientSideFilter || displayEventTotal <= merged.length)
        ? `${docGroups.length} document${docGroups.length === 1 ? '' : 's'} · ${merged.length} event${merged.length === 1 ? '' : 's'}`
        : `Showing ${docGroups.length} document${docGroups.length === 1 ? '' : 's'} · ${merged.length} of ${displayEventTotal} events`;

  /* ---------- render ---------- */
  return (
    <div className="waf-root">
      <style>{wafCss}</style>

      {/* ============ HEADER ============ */}
      <div className="waf-header">
        <div className="waf-header-left">
          <div className="waf-header-icon"><FiActivity /></div>
          <div className="waf-header-body">
            <h3 className="waf-header-title">{title}</h3>
            <div className="waf-header-sub">
              <span className="waf-header-code">{warehouseCode}</span>
              <span className="waf-header-dot">·</span>
              <span>{headerSub}</span>
            </div>
          </div>
        </div>
        <button
          type="button"
          className="waf-refresh"
          onClick={handleRefresh}
          disabled={initialLoading || isFetching}
          title="Refresh activity"
        >
          <FiRefreshCw className={`waf-refresh-icon${(initialLoading || isFetching) ? ' is-spinning' : ''}`} />
          <span>{(initialLoading || isFetching) ? 'Loading…' : 'Refresh'}</span>
        </button>
      </div>

      {/* ============ SOURCE TABS ============ */}
      <div className="waf-tabs" role="tablist" aria-label="Activity source">
        <button
          type="button"
          role="tab"
          aria-selected={source === 'all'}
          className={`waf-tab${source === 'all' ? ' is-active' : ''}`}
          onClick={() => setSource('all')}
        >
          <FiLayers className="waf-tab-icon" />
          <span>All</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={source === 'po'}
          className={`waf-tab${source === 'po' ? ' is-active' : ''}`}
          onClick={() => setSource('po')}
        >
          <FiInbox className="waf-tab-icon" />
          <span>POs / PRs</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={source === 'sts'}
          className={`waf-tab${source === 'sts' ? ' is-active' : ''}`}
          onClick={() => setSource('sts')}
        >
          <FiTruck className="waf-tab-icon" />
          <span>Transfers</span>
        </button>
      </div>

      {/* ============ FILTERS ============ */}
      <div className="waf-filters">
        {/* ---------- Session 13 (I2): Doc type segmented control ----------
            Hidden on the Transfers-only tab — STS rows have no
            PO/PR distinction to filter on. */}
        {source !== 'sts' && (
          <div className="waf-filter-group waf-filter-group--doctype">
            <label className="waf-filter-label">
              <FiTag className="waf-filter-icon" />
              <span>Type</span>
            </label>
            <div
              className="waf-doctype-toggle"
              role="group"
              aria-label="Filter by document type"
            >
              {DOC_TYPE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className={
                    `waf-doctype-btn${docTypeFilter === opt.value ? ' is-active' : ''}`
                  }
                  onClick={() => setDocTypeFilter(opt.value)}
                  aria-pressed={docTypeFilter === opt.value}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="waf-filter-group waf-filter-group--stage">
          <label className="waf-filter-label">
            <FiFilter className="waf-filter-icon" />
            <span>Stage</span>
          </label>
          {/* Session 13 (I4) — the options array may contain plain
              entries ({ value, label }) OR grouped entries
              ({ group, options }). Both shapes are rendered here
              so the same code path works for ALL_STAGES (grouped)
              and PO_STAGES / STS_STAGES (flat). */}
          <select
            className="waf-filter-input"
            value={stageFilter}
            onChange={(e) => setStageFilter(e.target.value)}
          >
            {stageOptions.map((s, i) => {
              if (s && Array.isArray(s.options)) {
                return (
                  <optgroup key={`grp-${i}-${s.group || 'group'}`} label={s.group}>
                    {s.options.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </optgroup>
                );
              }
              return (
                <option key={s.value || `opt-${i}`} value={s.value}>
                  {s.label}
                </option>
              );
            })}
          </select>
        </div>

        <div className="waf-filter-group waf-filter-group--date">
          <label className="waf-filter-label">
            <FiCalendar className="waf-filter-icon" />
            <span>From</span>
          </label>
          <input
            type="date"
            className="waf-filter-input"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </div>

        <div className="waf-filter-group waf-filter-group--date">
          <label className="waf-filter-label">
            <FiCalendar className="waf-filter-icon" />
            <span>To</span>
          </label>
          <input
            type="date"
            className="waf-filter-input"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </div>

        <div className="waf-filter-group waf-filter-group--search">
          <label className="waf-filter-label">
            <FiSearch className="waf-filter-icon" />
            <span>Search</span>
          </label>
          <input
            type="text"
            className="waf-filter-input"
            placeholder="Item code, actor, ref no…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {hasActiveFilter && (
          <button
            type="button"
            className="waf-clear-btn"
            onClick={clearFilters}
            title="Clear all filters"
          >
            <FiX className="waf-clear-icon" />
            <span>Clear</span>
          </button>
        )}
      </div>

      {/* ============ ERROR ============ */}
      {error && (
        <div className="waf-error">
          <FiAlertTriangle className="waf-error-icon" />
          <span>{error}</span>
        </div>
      )}

      {/* ============ FEED ============ */}
      {initialLoading ? (
        <div className="waf-loading">
          <div className="waf-loading-spinner" />
          <span>Loading activity…</span>
        </div>
      ) : docGroups.length === 0 ? (
        <div className="waf-empty">
          <div className="waf-empty-icon"><FiActivity /></div>
          <div className="waf-empty-title">
            {hasActiveFilter ? 'No matching documents' : 'No activity yet'}
          </div>
          <div className="waf-empty-sub">
            {hasActiveFilter
              ? 'Try adjusting the filters or date range.'
              : 'Documents (POs / PRs and transfer slips) will appear here once they have activity.'}
          </div>
          {hasActiveFilter && (
            <button
              type="button"
              className="waf-empty-clear"
              onClick={clearFilters}
            >
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="waf-feed">
            {docGroups.map((doc) => (
              <DocumentRow
                key={doc.key}
                doc={doc}
                expanded={expandedDocKey === doc.key}
                onToggle={() => handleDocToggle(doc)}
              />
            ))}
          </div>

          {/* ============ LOAD MORE ============ */}
          {hasMore && (
            <div className="waf-load-more-wrap">
              <button
                type="button"
                className="waf-load-more"
                onClick={loadMore}
                disabled={isFetching}
              >
                {isFetching ? (
                  <>
                    <FiRefreshCw className="waf-load-more-icon is-spinning" />
                    <span>Loading…</span>
                  </>
                ) : (
                  <>
                    <FiChevronDownIcon className="waf-load-more-icon" />
                    <span>Load more</span>
                  </>
                )}
              </button>
              <div className="waf-load-more-hint">
                {hasClientSideFilter
                  ? `Showing ${docGroups.length} document${docGroups.length === 1 ? '' : 's'} · ${merged.length} event${merged.length === 1 ? '' : 's'}`
                  : `Showing ${docGroups.length} document${docGroups.length === 1 ? '' : 's'} · ${merged.length} of ${displayEventTotal} event${displayEventTotal === 1 ? '' : 's'}`}
              </div>
            </div>
          )}

          {!hasMore && docGroups.length > 0 && (
            <div className="waf-end-of-feed">
              — end of activity —
            </div>
          )}
        </>
      )}
    </div>
  );
};

/* ============================================================
   DocumentRow — one PO/PR or STS, collapsed summary + expanded
   chronological event timeline.

   Session 13 (I1) — the `doc.refType` is 'PO', 'PR', or 'STS'.
   Each gets its own label, icon, and colour:

     'PO'  → label "PO",       icon FiInbox, teal identity
     'PR'  → label "PR",       icon FiTag,   orange identity
     'STS' → label "Transfer", icon FiTruck, indigo identity

   This puts the actual document type on-screen instead of the
   previous ambiguous "PO / PR" label that hid the distinction.
   ============================================================ */
const DocumentRow = ({ doc, expanded, onToggle }) => {
  const latest      = doc.latestEvent;
  const latestStage = latest ? stageMeta(latest._stage) : stageMeta(null);
  const LatestIcon  = latest ? eventIcon(latest._event_type) : FiCircle;

  const isPrBased   = doc.refType === 'PR';
  const isTransfer  = doc.refType === 'STS';

  const RefIcon  = isPrBased ? FiTag : isTransfer ? FiTruck : FiInbox;
  const refLabel = isPrBased ? 'PR' : isTransfer ? 'Transfer' : 'PO';

  // Session 12 (H1) — defensive: doc.stages should always be a Set,
  // but we fall back to an empty array so a data-shape regression
  // degrades gracefully instead of crashing the whole tab.
  const distinctStages = Array.from(doc.stages || [])
    .map((s) => stageMeta(s))
    .filter(Boolean)
    .slice(0, 4); // cap chips

  return (
    <div className={`waf-doc${expanded ? ' is-expanded' : ''}${isPrBased ? ' waf-doc--pr' : ''}`}>
      <div
        className="waf-doc-main"
        onClick={onToggle}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
            e.preventDefault();
            onToggle();
          }
        }}
        aria-expanded={expanded}
      >
        <div
          className="waf-doc-icon"
          style={{
            background: latestStage.dot,
            boxShadow:  `0 0 0 3px ${latestStage.bg}`,
          }}
        >
          <LatestIcon className="waf-doc-icon-svg" />
        </div>

        <div className="waf-doc-body">
          <div className="waf-doc-head">
            <span className="waf-doc-title">
              <RefIcon className="waf-doc-ref-icon" />
              <span className="waf-doc-ref-no">{doc.refNo}</span>
              <span className={`waf-doc-ref-type${isPrBased ? ' waf-doc-ref-type--pr' : ''}${isTransfer ? ' waf-doc-ref-type--sts' : ''}`}>
                {refLabel}
              </span>
            </span>
            <span
              className="waf-doc-time"
              title={latest?._acted_at ? formatDateTimeFull(latest._acted_at) : ''}
            >
              {latest ? formatTime(latest._acted_at) : '—'}
            </span>
          </div>

          <div className="waf-doc-chips">
            <span className="waf-chip waf-chip--count">
              {doc.events.length} event{doc.events.length === 1 ? '' : 's'}
            </span>
            <span className="waf-chip waf-chip--count">
              {doc.itemCount} item{doc.itemCount === 1 ? '' : 's'}
            </span>

            {distinctStages.map((stage) => (
              <span
                key={stage.key || stage.label}
                className="waf-chip waf-chip--stage"
                style={{
                  background:  stage.bg,
                  color:       stage.fg,
                  borderColor: stage.border,
                }}
              >
                {stage.label}
              </span>
            ))}
            {doc.stageCount > 4 && (
              <span className="waf-chip waf-chip--more">
                +{doc.stageCount - 4} more
              </span>
            )}
          </div>

          {latest && (
            <div className="waf-doc-latest">
              <span className="waf-doc-latest-label">Latest:</span>
              <span className="waf-doc-latest-text" title={latest._title}>
                {latest._title}
              </span>
              {latest._actor && (
                <>
                  <span className="waf-doc-latest-dot">·</span>
                  <span className="waf-doc-latest-actor">{latest._actor}</span>
                </>
              )}
            </div>
          )}
        </div>

        <div className="waf-doc-caret" aria-hidden="true">
          {expanded ? <FiChevronDown /> : <FiChevronRight />}
        </div>
      </div>

      {expanded && doc.events.length > 0 && (
        <div className="waf-doc-expanded">
          <div className="waf-doc-timeline">
            {doc.events.map((evt, idx) => (
              <EventRow
                key={evt._key}
                evt={evt}
                isLast={idx === doc.events.length - 1}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

/* ============================================================
   EventRow — one event INSIDE an expanded document. Chronological.
   ============================================================ */
const EventRow = ({ evt, isLast }) => {
  const Icon  = eventIcon(evt._event_type);
  const stage = stageMeta(evt._stage);
  const isNeg = evt._qty_change != null && evt._qty_change < 0;

  return (
    <div className="waf-event">
      <div className="waf-event-rail">
        <div
          className="waf-event-dot"
          style={{
            background: stage.dot,
            boxShadow:  `0 0 0 3px ${stage.bg}`,
          }}
        >
          <Icon className="waf-event-icon" />
        </div>
        {!isLast && <div className="waf-event-line" />}
      </div>

      <div className="waf-event-body">
        <div className="waf-event-head">
          <span className="waf-event-title">
            {eventLabel(evt._event_type) || evt._title}
          </span>
          <span
            className="waf-event-time"
            title={evt._acted_at ? formatDateTimeFull(evt._acted_at) : ''}
          >
            {formatTime(evt._acted_at)}
          </span>
        </div>

        <div className="waf-event-chips">
          {evt._stage && (
            <span
              className="waf-chip waf-chip--stage"
              style={{
                background:  stage.bg,
                color:       stage.fg,
                borderColor: stage.border,
              }}
            >
              {stage.label}
            </span>
          )}

          {evt._item_code && (
            <span
              className="waf-chip waf-chip--item"
              title={evt._item_name || evt._item_code}
            >
              <FiPackage />
              <span>{evt._item_code}</span>
            </span>
          )}

          {evt._locator && (
            <span className="waf-chip waf-chip--locator" title={evt._locator}>
              <FiMapPin />
              <span>{evt._locator}</span>
            </span>
          )}

          {evt._qty_change != null && evt._qty_change !== 0 && (
            <span className={`waf-qty ${isNeg ? 'is-neg' : 'is-pos'}`}>
              {formatQtyChange(evt._qty_change)}
            </span>
          )}

          {evt._actor && (
            <span
              className="waf-chip waf-chip--actor"
              title={evt._actor_role || ''}
            >
              <FiUser />
              <span>{evt._actor}</span>
            </span>
          )}
        </div>

        {(evt._detail || evt._qty_before != null || evt._qty_after != null) && (
          <div className="waf-event-detail">
            {(evt._qty_before != null || evt._qty_after != null) && (
              <span className="waf-event-qty-trace">
                {evt._qty_before != null && <span>before: <b>{evt._qty_before}</b></span>}
                {evt._qty_change != null && evt._qty_change !== 0 && (
                  <span className={isNeg ? 'is-neg' : 'is-pos'}>
                    change: <b>{formatQtyChange(evt._qty_change)}</b>
                  </span>
                )}
                {evt._qty_after != null && <span>after: <b>{evt._qty_after}</b></span>}
                {evt._uom && <span className="waf-event-uom">{evt._uom}</span>}
              </span>
            )}
            {evt._detail && (
              <span className="waf-event-detail-text">
                <FiInfo className="waf-event-detail-icon" />
                <span>{evt._detail}</span>
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

/* ============================================================
   CSS — component-scoped, responsive from 360px → 4K
   ============================================================ */
const wafCss = `
.waf-root {
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  display: flex;
  flex-direction: column;
  gap: 14px;
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
}

/* ---------- HEADER ---------- */
.waf-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.waf-header-left {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  flex: 1 1 260px;
}
.waf-header-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 10px;
  background: linear-gradient(135deg, #00e0d4 0%, #008a82 100%);
  color: #ffffff;
  flex-shrink: 0;
  box-shadow: 0 3px 10px rgba(0, 210, 200, 0.28);
}
.waf-header-icon svg { width: 20px; height: 20px; stroke-width: 2.2; }
.waf-header-body { min-width: 0; flex: 1; }
.waf-header-title {
  margin: 0;
  font-size: clamp(15px, 1.4vw, 17px);
  font-weight: 800;
  color: #0f172a;
  letter-spacing: -0.01em;
  line-height: 1.2;
}
.waf-header-sub {
  margin-top: 3px;
  font-size: 12px;
  color: #64748b;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.waf-header-code {
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-weight: 700;
  color: #0f766e;
}
.waf-header-dot { color: #cbd5e1; }

.waf-refresh {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 9px 14px;
  border-radius: 8px;
  border: 1px solid #cbd5e1;
  background: #ffffff;
  color: #334155;
  font-size: 12.5px;
  font-weight: 700;
  font-family: inherit;
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.15s ease, border-color 0.15s ease;
}
.waf-refresh:hover:not(:disabled) { background: #f8fafc; border-color: #94a3b8; }
.waf-refresh:disabled { opacity: 0.55; cursor: not-allowed; }
.waf-refresh-icon { width: 1em; height: 1em; stroke-width: 2.5; }
.waf-refresh-icon.is-spinning { animation: wafSpin 0.9s linear infinite; }
@keyframes wafSpin { to { transform: rotate(360deg); } }

/* ---------- SOURCE TABS ---------- */
.waf-tabs {
  display: flex;
  gap: 4px;
  padding: 4px;
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  max-width: 520px;
  width: 100%;
  box-sizing: border-box;
}
.waf-tab {
  flex: 1 1 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 9px 14px;
  min-height: 40px;
  background: transparent;
  border: none;
  border-radius: 8px;
  color: #475569;
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease, box-shadow 0.15s ease;
}
.waf-tab:hover:not(.is-active) {
  background: rgba(255, 255, 255, 0.6);
  color: #0f172a;
}
.waf-tab.is-active {
  background: #ffffff;
  color: #007a72;
  box-shadow:
    0 1px 3px rgba(15, 23, 42, 0.08),
    0 0 0 1px rgba(0, 184, 176, 0.35);
}
.waf-tab:focus-visible { outline: 2px solid #00b8b0; outline-offset: 2px; }
.waf-tab-icon { width: 15px; height: 15px; }

/* ---------- FILTERS ---------- */
.waf-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: flex-end;
  padding: 12px 14px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  box-sizing: border-box;
}
.waf-filter-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.waf-filter-group--doctype { flex: 0 1 auto; }
.waf-filter-group--stage   { flex: 0 1 220px; }
.waf-filter-group--date    { flex: 0 1 150px; }
.waf-filter-group--search  { flex: 1 1 220px; min-width: 180px; }

.waf-filter-label {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 10.5px;
  font-weight: 700;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.waf-filter-icon { width: 12px; height: 12px; stroke-width: 2.4; }

.waf-filter-input {
  width: 100%;
  padding: 9px 12px;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  background: #ffffff;
  color: #0f172a;
  font-family: inherit;
  font-size: 13px;
  outline: none;
  box-sizing: border-box;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.waf-filter-input:focus {
  border-color: #00b8b0;
  box-shadow: 0 0 0 3px rgba(0, 184, 176, 0.15);
}

/* Native <optgroup> styling — supported in Chrome/Edge/Firefox/Safari.
   The heading is bolded and slightly muted; options inside keep the
   inherited font. */
.waf-filter-input optgroup {
  font-weight: 700;
  font-style: normal;
  color: #334155;
}
.waf-filter-input optgroup > option {
  font-weight: 500;
  color: #0f172a;
}

/* ---------- Session 13 (I2): DOC TYPE SEGMENTED CONTROL ---------- */
.waf-doctype-toggle {
  display: inline-flex;
  align-items: stretch;
  gap: 3px;
  padding: 3px;
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  box-sizing: border-box;
  min-height: 38px;
}

.waf-doctype-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 6px 16px;
  min-height: 30px;
  font-size: 12.5px;
  font-weight: 700;
  letter-spacing: 0.02em;
  font-family: inherit;
  color: #475569;
  background: transparent;
  border: none;
  border-radius: 7px;
  cursor: pointer;
  white-space: nowrap;
  transition:
    background 0.15s ease,
    color 0.15s ease,
    box-shadow 0.15s ease,
    transform 0.1s ease;
}

.waf-doctype-btn:hover:not(.is-active) {
  background: rgba(255, 255, 255, 0.75);
  color: #0f172a;
}

.waf-doctype-btn:active:not(.is-active) {
  transform: scale(0.97);
}

.waf-doctype-btn.is-active {
  background: #ffffff;
  color: #007a72;
  box-shadow:
    0 1px 3px rgba(15, 23, 42, 0.08),
    0 0 0 1px rgba(0, 184, 176, 0.45);
}

.waf-doctype-btn:focus-visible {
  outline: 2px solid #00b8b0;
  outline-offset: 2px;
}

.waf-clear-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 9px 14px;
  border-radius: 8px;
  border: 1px solid #fecaca;
  background: #fef2f2;
  color: #991b1b;
  font-size: 12.5px;
  font-weight: 700;
  font-family: inherit;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;
}
.waf-clear-btn:hover { background: #fee2e2; border-color: #fca5a5; }
.waf-clear-icon { width: 12px; height: 12px; stroke-width: 2.5; }

/* ---------- ERROR ---------- */
.waf-error {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 10px;
  color: #991b1b;
  font-size: 13px;
}
.waf-error-icon { width: 16px; height: 16px; stroke-width: 2.4; flex-shrink: 0; }

/* ---------- LOADING ---------- */
.waf-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 48px 20px;
  color: #64748b;
  font-size: 13px;
}
.waf-loading-spinner {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 3px solid #e2e8f0;
  border-top-color: #00b8b0;
  animation: wafSpin 0.8s linear infinite;
}

/* ---------- EMPTY ---------- */
.waf-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 48px 20px;
  gap: 8px;
}
.waf-empty-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 60px;
  height: 60px;
  border-radius: 50%;
  background: linear-gradient(135deg, #f0fdfa 0%, #ecfeff 100%);
  border: 1px solid #99f6e4;
  color: #0f766e;
  margin-bottom: 4px;
}
.waf-empty-icon svg { width: 28px; height: 28px; stroke-width: 1.8; }
.waf-empty-title {
  font-size: 15px;
  font-weight: 800;
  color: #0f172a;
  letter-spacing: -0.01em;
}
.waf-empty-sub {
  font-size: 13px;
  color: #64748b;
  max-width: 380px;
  line-height: 1.55;
}
.waf-empty-sub code {
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  background: #f1f5f9;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 12px;
}
.waf-empty-clear {
  margin-top: 8px;
  padding: 9px 18px;
  border-radius: 8px;
  border: 1px solid #cbd5e1;
  background: #ffffff;
  color: #334155;
  font-size: 13px;
  font-weight: 700;
  font-family: inherit;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;
}
.waf-empty-clear:hover { background: #f8fafc; border-color: #94a3b8; }

/* ============================================================
   FEED — one block per document (PO / PR / STS)
   ============================================================ */
.waf-feed {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* ---------- DOCUMENT ROW ---------- */
.waf-doc {
  display: flex;
  flex-direction: column;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  transition: background 0.12s ease, border-color 0.12s ease, box-shadow 0.12s ease;
  overflow: hidden;
}
.waf-doc:hover { border-color: #cbd5e1; box-shadow: 0 1px 3px rgba(15, 23, 42, 0.05); }
.waf-doc.is-expanded {
  background: #f0fdfa;
  border-color: #5eead4;
  box-shadow:
    0 1px 3px rgba(15, 23, 42, 0.06),
    0 8px 20px -12px rgba(0, 184, 176, 0.35);
}
/* Session 13 (I1): PR-based rows get a warm orange border on hover
   so the user can spot them at a glance in a mixed feed. */
.waf-doc--pr { border-left: 3px solid #fdba74; }
.waf-doc--pr:hover { border-color: #fdba74; }

.waf-doc-main {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  cursor: pointer;
  outline: none;
  min-width: 0;
}
.waf-doc-main:focus-visible { box-shadow: inset 0 0 0 2px #00b8b0; }

.waf-doc-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  flex-shrink: 0;
  color: #ffffff;
}
.waf-doc-icon-svg { width: 16px; height: 16px; stroke-width: 2.4; }

.waf-doc-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.waf-doc-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}
.waf-doc-title {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex-wrap: wrap;
}
.waf-doc-ref-icon {
  width: 14px;
  height: 14px;
  stroke-width: 2.4;
  color: #0f766e;
  flex-shrink: 0;
}
.waf-doc-ref-no {
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-size: 14px;
  font-weight: 800;
  color: #0f172a;
  letter-spacing: 0.01em;
  line-height: 1.2;
  word-break: break-word;
}
.waf-doc-ref-type {
  font-size: 9.5px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #0f766e;
  background: #f0fdfa;
  border: 1px solid #99f6e4;
  border-radius: 4px;
  padding: 1px 6px;
  line-height: 1.4;
  white-space: nowrap;
}

/* Session 13 (I1): variant labels for the ref-type pill */
.waf-doc-ref-type--pr {
  color: #9a3412;
  background: #fff7ed;
  border-color: #fdba74;
}
.waf-doc-ref-type--sts {
  color: #4338ca;
  background: #eef2ff;
  border-color: #c7d2fe;
}

.waf-doc-time {
  font-size: 11px;
  color: #94a3b8;
  font-weight: 600;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  flex-shrink: 0;
}

.waf-doc-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  align-items: center;
}

.waf-doc-latest {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: #475569;
  min-width: 0;
  line-height: 1.4;
}
.waf-doc-latest-label {
  font-weight: 800;
  color: #0f766e;
  text-transform: uppercase;
  font-size: 10px;
  letter-spacing: 0.06em;
  flex-shrink: 0;
}
.waf-doc-latest-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.waf-doc-latest-dot { color: #cbd5e1; }
.waf-doc-latest-actor {
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-size: 11px;
  color: #64748b;
  flex-shrink: 0;
}

.waf-doc-caret {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  color: #94a3b8;
  flex-shrink: 0;
  transition: color 0.15s ease;
}
.waf-doc.is-expanded .waf-doc-caret { color: #0f766e; }
.waf-doc-caret svg { width: 16px; height: 16px; stroke-width: 2.4; }

/* ---------- EXPANDED DOCUMENT (event timeline) ---------- */
.waf-doc-expanded {
  padding: 4px 14px 14px 14px;
  border-top: 1px dashed #99f6e4;
  animation: wafDocExpand 0.18s ease;
}
@keyframes wafDocExpand {
  from { opacity: 0; transform: translateY(-3px); }
  to   { opacity: 1; transform: translateY(0); }
}
.waf-doc-timeline {
  display: flex;
  flex-direction: column;
  padding-top: 8px;
}

/* ---------- EVENT (nested) ---------- */
.waf-event {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}
.waf-event-rail {
  display: flex;
  flex-direction: column;
  align-items: center;
  flex-shrink: 0;
  width: 26px;
}
.waf-event-dot {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #ffffff;
  flex-shrink: 0;
}
.waf-event-icon { width: 12px; height: 12px; stroke-width: 2.4; }
.waf-event-line {
  width: 2px;
  flex: 1;
  min-height: 18px;
  background: #e2e8f0;
  margin: 2px 0;
}
.waf-event-body {
  flex: 1;
  min-width: 0;
  padding-bottom: 14px;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.waf-event:last-child .waf-event-body { padding-bottom: 0; }

.waf-event-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}
.waf-event-title {
  font-size: 13px;
  font-weight: 700;
  color: #0f172a;
  line-height: 1.3;
  word-break: break-word;
  min-width: 0;
}
.waf-event-time {
  font-size: 10.5px;
  color: #94a3b8;
  font-weight: 600;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  flex-shrink: 0;
}

.waf-event-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  align-items: center;
}

.waf-event-detail {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11.5px;
  color: #475569;
  line-height: 1.5;
  word-break: break-word;
}
.waf-event-qty-trace {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  padding: 5px 10px;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-size: 11px;
}
.waf-event-qty-trace b { font-weight: 800; }
.waf-event-qty-trace .is-pos { color: #047857; }
.waf-event-qty-trace .is-neg { color: #be123c; }
.waf-event-uom { color: #64748b; }
.waf-event-detail-text {
  display: inline-flex;
  align-items: flex-start;
  gap: 6px;
  font-style: italic;
  color: #64748b;
}
.waf-event-detail-icon {
  width: 13px;
  height: 13px;
  stroke-width: 2.4;
  flex-shrink: 0;
  margin-top: 2px;
  color: #94a3b8;
}

/* ---------- CHIPS (shared) ---------- */
.waf-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.02em;
  border: 1px solid transparent;
  white-space: nowrap;
  max-width: 100%;
}
.waf-chip svg { width: 11px; height: 11px; stroke-width: 2.4; flex-shrink: 0; }
.waf-chip span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 180px;
}
.waf-chip--count {
  background: #f1f5f9;
  color: #475569;
  border-color: #cbd5e1;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-weight: 700;
}
.waf-chip--more {
  background: #f8fafc;
  color: #94a3b8;
  border-color: #e2e8f0;
  font-style: italic;
}
.waf-chip--item {
  background: #eef2ff;
  color: #4338ca;
  border-color: #c7d2fe;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
}
.waf-chip--locator {
  background: #f0fdfa;
  color: #0f766e;
  border-color: #99f6e4;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
}
.waf-chip--actor {
  background: #ffffff;
  color: #475569;
  border-color: #e2e8f0;
}

.waf-qty {
  display: inline-flex;
  align-items: center;
  padding: 2px 9px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 800;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  letter-spacing: 0.02em;
  white-space: nowrap;
}
.waf-qty.is-pos { background: #dcfce7; color: #065f46; border: 1px solid #86efac; }
.waf-qty.is-neg { background: #fee2e2; color: #991b1b; border: 1px solid #fca5a5; }

/* ---------- LOAD MORE ---------- */
.waf-load-more-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 14px 12px 6px;
}
.waf-load-more {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 11px 28px;
  border-radius: 10px;
  border: 1.5px solid #cbd5e1;
  background: #ffffff;
  color: #334155;
  font-size: 13.5px;
  font-weight: 700;
  font-family: inherit;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease, transform 0.1s ease;
  min-height: 44px;
}
.waf-load-more:hover:not(:disabled) {
  background: #f0fdfa;
  border-color: #00b8b0;
  color: #0f766e;
}
.waf-load-more:active:not(:disabled) { transform: scale(0.98); }
.waf-load-more:disabled { opacity: 0.65; cursor: progress; }
.waf-load-more-icon { width: 1em; height: 1em; stroke-width: 2.5; }
.waf-load-more-icon.is-spinning { animation: wafSpin 0.9s linear infinite; }
.waf-load-more-hint {
  font-size: 11.5px;
  color: #94a3b8;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  letter-spacing: 0.02em;
}
.waf-end-of-feed {
  text-align: center;
  padding: 16px 12px 6px;
  font-size: 11.5px;
  color: #cbd5e1;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

/* ============================================================
   RESPONSIVE
   ============================================================ */

@media (max-width: 900px) {
  /* The doc-type toggle grows to full width so all three segments
     are comfortable tap targets, matching the mobile behaviour of
     the other filters. */
  .waf-filter-group--doctype { flex: 1 1 100%; }
  .waf-doctype-toggle { width: 100%; }
  .waf-doctype-btn    { flex: 1 1 0; }

  .waf-filter-group--stage  { flex: 1 1 100%; }
  .waf-filter-group--date   { flex: 1 1 calc(50% - 5px); }
  .waf-filter-group--search { flex: 1 1 100%; }
}

@media (max-width: 720px) {
  .waf-header { flex-direction: column; align-items: stretch; }
  .waf-refresh { width: 100%; justify-content: center; min-height: 44px; }

  .waf-doc-main { padding: 12px; gap: 10px; }
  .waf-doc-icon { width: 32px; height: 32px; }
  .waf-doc-icon-svg { width: 14px; height: 14px; }
  .waf-doc-ref-no { font-size: 13px; }
  .waf-chip span { max-width: 130px; }

  .waf-doc-expanded { padding: 4px 12px 12px 12px; }
  .waf-event { gap: 10px; }
  .waf-event-rail { width: 22px; }
  .waf-event-dot { width: 20px; height: 20px; }
  .waf-event-icon { width: 11px; height: 11px; }
}

@media (max-width: 480px) {
  .waf-tabs { max-width: 100%; }
  .waf-tab {
    padding: 8px 10px;
    font-size: 12px;
    min-height: 44px;
    gap: 5px;
  }
  .waf-tab-icon { width: 14px; height: 14px; }

  /* Larger tap targets for the doc-type segmented control. */
  .waf-doctype-btn {
    padding: 9px 12px;
    min-height: 38px;
    font-size: 13px;
  }

  .waf-filter-input {
    font-size: 16px;      /* prevents iOS zoom on focus */
    min-height: 44px;
    padding: 10px 12px;
  }
  .waf-clear-btn {
    width: 100%;
    justify-content: center;
    min-height: 44px;
  }

  .waf-doc-main { padding: 10px; gap: 8px; }
  .waf-doc-icon { width: 28px; height: 28px; }
  .waf-doc-icon-svg { width: 13px; height: 13px; }
  .waf-doc-ref-no { font-size: 12.5px; }
  .waf-doc-ref-type { font-size: 9px; padding: 1px 5px; }
  .waf-doc-time { font-size: 10px; }
  .waf-doc-latest { font-size: 11px; }
  .waf-doc-latest-actor { font-size: 10px; }
  .waf-chip span { max-width: 110px; }

  .waf-doc-expanded { padding: 4px 10px 10px 10px; }
  .waf-event-body { padding-bottom: 12px; }
  .waf-event-title { font-size: 12px; }
  .waf-event-time { font-size: 10px; }
  .waf-event-qty-trace { font-size: 10px; padding: 4px 8px; gap: 8px; }
  .waf-event-detail { font-size: 11px; }

  .waf-load-more { width: 100%; justify-content: center; }
}

@media (max-width: 380px) {
  .waf-tab span { font-size: 11.5px; }
  .waf-tab-icon { width: 13px; height: 13px; }

  /* Keep the segmented control legible on very small phones. */
  .waf-doctype-btn {
    padding: 8px 8px;
    font-size: 12px;
    min-height: 36px;
  }

  .waf-doc-head { flex-direction: column; align-items: flex-start; gap: 2px; }
  .waf-doc-time { font-size: 9.5px; }

  .waf-event-chips { gap: 4px; }
  .waf-chip { padding: 2px 6px; font-size: 10px; }
  .waf-chip svg { width: 10px; height: 10px; }
  .waf-chip span { max-width: 90px; }
  .waf-qty { font-size: 10px; padding: 2px 7px; }

  .waf-header-title { font-size: 14.5px; }
}

@media (min-width: 1921px) {
  .waf-header-icon { width: 46px; height: 46px; }
  .waf-header-icon svg { width: 22px; height: 22px; }
  .waf-header-title { font-size: 18px; }

  /* Segmented control gets slightly larger tap surfaces on 4K. */
  .waf-doctype-btn {
    padding: 8px 22px;
    font-size: 14px;
    min-height: 34px;
  }
  .waf-doctype-toggle { min-height: 42px; }

  .waf-doc-main { padding: 14px 18px; gap: 14px; }
  .waf-doc-icon { width: 40px; height: 40px; }
  .waf-doc-icon-svg { width: 18px; height: 18px; }
  .waf-doc-ref-no { font-size: 16px; }
  .waf-doc-ref-type { font-size: 10.5px; padding: 2px 8px; }
  .waf-doc-time { font-size: 12px; }
  .waf-doc-latest { font-size: 13px; }
  .waf-doc-latest-actor { font-size: 12px; }
  .waf-chip { padding: 3px 10px; font-size: 11.5px; }
  .waf-chip span { max-width: 220px; }

  .waf-event-title { font-size: 14px; }
  .waf-event-time { font-size: 11.5px; }
  .waf-event-dot { width: 28px; height: 28px; }
  .waf-event-icon { width: 14px; height: 14px; }
  .waf-event-body { padding-bottom: 16px; }

  .waf-tab { font-size: 14px; min-height: 44px; }
  .waf-filter-input { font-size: 14px; }
  .waf-load-more { padding: 12px 32px; font-size: 14.5px; }
}

@media (max-height: 500px) and (orientation: landscape) {
  .waf-loading,
  .waf-empty { padding: 20px 16px; }
}

@media (prefers-reduced-motion: reduce) {
  .waf-refresh-icon.is-spinning,
  .waf-loading-spinner,
  .waf-load-more-icon.is-spinning,
  .waf-doc-expanded { animation: none !important; }
  .waf-doc,
  .waf-doc-caret,
  .waf-tab,
  .waf-refresh,
  .waf-clear-btn,
  .waf-empty-clear,
  .waf-load-more,
  .waf-doctype-btn { transition: none !important; }
}
`;

export default WarehouseActivityFeed;