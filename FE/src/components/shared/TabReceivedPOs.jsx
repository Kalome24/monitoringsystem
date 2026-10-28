// src/components/shared/TabReceivedPOs.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  FiInbox,
  FiAlertTriangle,
  FiCheckCircle,
  FiRefreshCw,
  FiClipboard,
  FiPackage,
  FiDollarSign,
  FiHome,
  FiDownload,
  FiChevronDown,
  FiChevronRight,
  FiTarget,
  FiFolder,
  FiImage,
} from 'react-icons/fi';
import {
  importPoApi,
  warehouseApi,
  itemMasterApi,
} from '../../services/api';
import ItemImageThumb from './ItemImageThumb';

const PAGE_SIZE = 50;
const TREND_DAYS = 30;
const SEARCH_DEBOUNCE_MS = 300;

// ============================================================
// Helpers
// ============================================================
const fmtMoney = (n, cur = 'PHP') => {
  const v = Number(n) || 0;
  return `${cur} ${v.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

const fmtNum = (n, decimals = 2) => {
  const v = Number(n) || 0;
  return v.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
};

const fmtDateTime = (v) => {
  if (!v) return '—';
  try { return new Date(v).toLocaleString(); } catch { return v; }
};

const fmtDateOnly = (v) => {
  if (v === '' || v === null || v === undefined) return '—';
  const s = String(v);
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : s;
};

const fmtDate = (v) => {
  if (!v) return '—';
  try {
    const d = new Date(v);
    return d.toLocaleDateString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
    });
  } catch { return v; }
};

const lineTotalOf = (r) => {
  if (r.func_amount != null && Number(r.func_amount) > 0) return Number(r.func_amount);
  return (Number(r.received_qty) || 0) * (Number(r.unit_price) || 0);
};

const statusBadgeClass = (status) => {
  switch (status) {
    case 'Pending':                 return 'rpo-status rpo-status--pending';
    case 'Partial Received':        return 'rpo-status rpo-status--partial';
    case 'Complete':                return 'rpo-status rpo-status--complete';
    case 'Complete (with damage)':  return 'rpo-status rpo-status--damage';
    case 'With Handler':            return 'rpo-status rpo-status--handler';
    case 'Partial With Handler':    return 'rpo-status rpo-status--handler';
    case 'Pending Transfer':        return 'rpo-status rpo-status--pending-transfer';
    case 'Transferred':             return 'rpo-status rpo-status--done';
    case 'Stored':                  return 'rpo-status rpo-status--done';
    case 'Released':                return 'rpo-status rpo-status--done';
    default:                        return 'rpo-status';
  }
};

/* Delivery badge treats both 'Partial' (legacy auto-derived) and
   'Partial Received' (new user-supplied value) as equivalent. */
const isPartialDelivery = (s) => s === 'Partial' || s === 'Partial Received';

const deliveryBadgeClass = (s) =>
  isPartialDelivery(s)
    ? 'rpo-deliv rpo-deliv--partial'
    : 'rpo-deliv rpo-deliv--complete';

/* Row is "PR-based" when the backend flagged it as has_po = 0. */
const isPrBased = (r) => Number(r.has_po) === 0;

const todayIso = () => new Date().toISOString().split('T')[0];

const roundRect = (ctx, x, y, w, h, r) => {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y,     x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x,     y + h, r);
  ctx.arcTo(x,     y + h, x,     y,     r);
  ctx.arcTo(x,     y,     x + w, y,     r);
  ctx.closePath();
};

const startOfMonthIso = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split('T')[0];
};

const daysAgoIso = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];
};

/* Shared inline delivery badge (table + expanded panel) */
const DeliveryBadge = ({ status, className }) => {
  const isPartial = isPartialDelivery(status);
  return (
    <span className={className || deliveryBadgeClass(status)}>
      {isPartial
        ? <FiAlertTriangle className="rpo-badge-icon" aria-hidden="true" />
        : <FiCheckCircle className="rpo-badge-icon" aria-hidden="true" />}
      <span>{isPartial ? 'Partial' : 'Complete'}</span>
    </span>
  );
};

/* ============================================================
   TrendSparkline
   ============================================================ */
const TrendSparkline = ({ data, metric = 'total_value', height = 90 }) => {
  if (!Array.isArray(data) || data.length < 2) return null;

  const points = data
    .map((p) => ({ day: p.day, v: Number(p[metric]) || 0 }))
    .sort((a, b) => new Date(a.day) - new Date(b.day));

  const W = 1000;
  const H = height;
  const PAD_X = 4;
  const PAD_Y = 10;

  const values = points.map((p) => p.v);
  const max = Math.max(...values, 1);
  const min = 0;
  const stepX = (W - PAD_X * 2) / (points.length - 1);

  const yFor = (v) => {
    const norm = (v - min) / (max - min);
    return H - PAD_Y - norm * (H - PAD_Y * 2);
  };

  const linePath = points
    .map((p, i) => {
      const x = PAD_X + i * stepX;
      const y = yFor(p.v);
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');

  const areaPath = `${linePath} L ${W - PAD_X} ${H - PAD_Y} L ${PAD_X} ${H - PAD_Y} Z`;

  const firstDay = points[0].day;
  const lastDay = points[points.length - 1].day;
  const peak = points.reduce((a, b) => (b.v > a.v ? b : a), points[0]);

  return (
    <div className="rpo-trend-chart">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"
        style={{ width: '100%', height, display: 'block' }}>
        <defs>
          <linearGradient id="rpo-trend-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#00b8b0" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#00b8b0" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="rpo-trend-stroke" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#00e0d4" />
            <stop offset="100%" stopColor="#008a82" />
          </linearGradient>
        </defs>

        <path d={areaPath} fill="url(#rpo-trend-fill)" />
        <path d={linePath} fill="none" stroke="url(#rpo-trend-stroke)" strokeWidth="2.5"
          strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />

        <circle cx={PAD_X + points.indexOf(peak) * stepX} cy={yFor(peak.v)} r="4"
          fill="#008a82" stroke="#ffffff" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>

      <div className="rpo-trend-footer">
        <span className="rpo-trend-date">{fmtDate(firstDay)}</span>
        <span className="rpo-trend-peak">
          Peak: <strong>{fmtMoney(peak.v)}</strong> on {fmtDate(peak.day)}
        </span>
        <span className="rpo-trend-date">{fmtDate(lastDay)}</span>
      </div>
    </div>
  );
};

/* ============================================================
   ExpandedLinePanel — full detail for a single received line
   ============================================================ */
const ExpandedLinePanel = ({ row, imageSrc }) => {
  if (!row) return null;

  const qtyOrdered   = Number(row.qty) || 0;
  const qtyReceived  = Number(row.received_qty) || 0;
  const qtyDamaged   = Number(row.damaged_qty) || 0;
  const qtyStored    = Number(row.stored_qty) || 0;
  const qtyReleased  = Number(row.released_qty) || 0;
  const unitPrice    = Number(row.unit_price) || 0;
  const forex        = row.forex != null ? Number(row.forex) : 1;
  const lineTotal    = lineTotalOf(row);
  const damagedValue = Number(row.damaged_value) || 0;
  const currency     = row.currency || 'PHP';
  const isNonPhp     = currency !== 'PHP';
  const prBased      = isPrBased(row);

  return (
    <div className="rpo-xp">
      {/* ---------- HERO ---------- */}
      <div className="rpo-xp-hero">
        <div className="rpo-xp-hero-img">
          <ItemImageThumb src={imageSrc} alt={row.item_code} size={64} />
        </div>
        <div className="rpo-xp-hero-info">
          <div className="rpo-xp-hero-code">{row.item_code}</div>
          <div className="rpo-xp-hero-name" title={row.item_name}>
            {row.item_name || '—'}
          </div>
          {row.uom && (
            <div className="rpo-xp-hero-uom">UOM: <strong>{row.uom}</strong></div>
          )}
        </div>
      </div>

      {/* ---------- QUANTITIES ---------- */}
      <div className="rpo-xp-section">
        <div className="rpo-xp-section-title">Quantities</div>
        <div className="rpo-xp-qty-grid">
          <div className="rpo-xp-qty-box">
            <div className="rpo-xp-qty-label">Ordered</div>
            <div className="rpo-xp-qty-value">{fmtNum(qtyOrdered, 0)}</div>
          </div>
          <div className="rpo-xp-qty-box rpo-xp-qty-box--good">
            <div className="rpo-xp-qty-label">Received</div>
            <div className="rpo-xp-qty-value">{fmtNum(qtyReceived, 0)}</div>
          </div>
          <div className="rpo-xp-qty-box rpo-xp-qty-box--damage">
            <div className="rpo-xp-qty-label">Damaged</div>
            <div className="rpo-xp-qty-value">{fmtNum(qtyDamaged, 0)}</div>
          </div>
          <div className="rpo-xp-qty-box">
            <div className="rpo-xp-qty-label">Stored</div>
            <div className="rpo-xp-qty-value">{fmtNum(qtyStored, 0)}</div>
          </div>
          <div className="rpo-xp-qty-box">
            <div className="rpo-xp-qty-label">Released</div>
            <div className="rpo-xp-qty-value">{fmtNum(qtyReleased, 0)}</div>
          </div>
        </div>
      </div>

      {/* ---------- VALUE COMPOSITION ---------- */}
      <div className="rpo-xp-section">
        <div className="rpo-xp-section-title">Value composition</div>
        <div className="rpo-xp-eq-row">
          <div className="rpo-xp-eq-box">
            <div className="rpo-xp-eq-label">
              Unit Price{isNonPhp ? ` (${currency})` : ''}
            </div>
            <div className="rpo-xp-eq-value">{fmtNum(unitPrice, 2)}</div>
          </div>
          {isNonPhp && (
            <>
              <div className="rpo-xp-eq-op">×</div>
              <div className="rpo-xp-eq-box">
                <div className="rpo-xp-eq-label">Forex</div>
                <div className="rpo-xp-eq-value">{fmtNum(forex, 3)}</div>
              </div>
            </>
          )}
          <div className="rpo-xp-eq-op">×</div>
          <div className="rpo-xp-eq-box">
            <div className="rpo-xp-eq-label">Received</div>
            <div className="rpo-xp-eq-value">{fmtNum(qtyReceived, 0)}</div>
          </div>
          <div className="rpo-xp-eq-op">=</div>
          <div className="rpo-xp-eq-box rpo-xp-eq-box--total">
            <div className="rpo-xp-eq-label">Func Amount (PHP)</div>
            <div className="rpo-xp-eq-value">{fmtNum(lineTotal, 3)}</div>
          </div>
        </div>

        {isNonPhp && (
          <div className="rpo-xp-note">
            <FiRefreshCw className="rpo-inline-icon" aria-hidden="true" />
            <span>
              Line stored in <strong>{currency}</strong> at rate{' '}
              <code>{fmtNum(forex, 3)}</code>. The <em>Func (PHP)</em> figure
              is the PHP-equivalent value held on this line.
            </span>
          </div>
        )}
      </div>

      {/* ---------- META ---------- */}
      <div className="rpo-xp-section">
        <div className="rpo-xp-section-title">Details</div>
        <div className="rpo-xp-meta-grid">
          <div className="rpo-xp-meta-item">
            <div className="rpo-xp-meta-label">Type</div>
            <div className="rpo-xp-meta-value">
              {prBased
                ? <span className="rpo-pr-pill rpo-pr-pill--inline">PR-based</span>
                : <span className="rpo-type-pill rpo-type-pill--po">With PO</span>}
            </div>
          </div>
          <div className="rpo-xp-meta-item">
            <div className="rpo-xp-meta-label">PO Date</div>
            <div className="rpo-xp-meta-value">{fmtDateOnly(row.po_date)}</div>
          </div>
          <div className="rpo-xp-meta-item">
            <div className="rpo-xp-meta-label">PR No.</div>
            <div className="rpo-xp-meta-value rpo-xp-meta-value--mono">
              {row.pr_no || '—'}
            </div>
          </div>
          <div className="rpo-xp-meta-item">
            <div className="rpo-xp-meta-label">Vendor</div>
            <div className="rpo-xp-meta-value">{row.vendor_name || '—'}</div>
          </div>
          <div className="rpo-xp-meta-item">
            <div className="rpo-xp-meta-label">Buyer</div>
            <div className="rpo-xp-meta-value">{row.buyer || '—'}</div>
          </div>
          <div className="rpo-xp-meta-item">
            <div className="rpo-xp-meta-label">Warehouse</div>
            <div className="rpo-xp-meta-value">
              {row.warehouse_code
                ? `${row.warehouse_code}${row.warehouse_name ? ` — ${row.warehouse_name}` : ''}`
                : '—'}
            </div>
          </div>
          <div className="rpo-xp-meta-item">
            <div className="rpo-xp-meta-label">Currency</div>
            <div className="rpo-xp-meta-value rpo-xp-meta-value--mono">
              {currency}
            </div>
          </div>
          {isNonPhp && (
            <div className="rpo-xp-meta-item">
              <div className="rpo-xp-meta-label">Forex</div>
              <div className="rpo-xp-meta-value rpo-xp-meta-value--mono">
                {fmtNum(forex, 3)}
              </div>
            </div>
          )}
          <div className="rpo-xp-meta-item">
            <div className="rpo-xp-meta-label">Delivery</div>
            <div className="rpo-xp-meta-value">
              <DeliveryBadge status={row.delivery_status} />
            </div>
          </div>
          <div className="rpo-xp-meta-item">
            <div className="rpo-xp-meta-label">Line Status</div>
            <div className="rpo-xp-meta-value">
              <span className={statusBadgeClass(row.status)}>{row.status}</span>
            </div>
          </div>
          <div className="rpo-xp-meta-item">
            <div className="rpo-xp-meta-label">Imported By</div>
            <div className="rpo-xp-meta-value">{row.imported_by || '—'}</div>
          </div>
          <div className="rpo-xp-meta-item">
            <div className="rpo-xp-meta-label">Imported At</div>
            <div className="rpo-xp-meta-value">{fmtDateTime(row.imported_at)}</div>
          </div>
          {row.forwarded_by && (
            <div className="rpo-xp-meta-item">
              <div className="rpo-xp-meta-label">Forwarded By</div>
              <div className="rpo-xp-meta-value">{row.forwarded_by}</div>
            </div>
          )}
          {row.forwarded_at && (
            <div className="rpo-xp-meta-item">
              <div className="rpo-xp-meta-label">Forwarded At</div>
              <div className="rpo-xp-meta-value">{fmtDateTime(row.forwarded_at)}</div>
            </div>
          )}
          {damagedValue > 0 && (
            <div className="rpo-xp-meta-item">
              <div className="rpo-xp-meta-label">Damaged Value</div>
              <div className="rpo-xp-meta-value rpo-xp-meta-value--rose">
                {fmtMoney(damagedValue, currency)}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ---------- DAMAGE REASON ---------- */}
      {row.damage_reason && (
        <div className="rpo-xp-damage">
          <div className="rpo-xp-damage-title">Damage Reason</div>
          <div className="rpo-xp-damage-body">{row.damage_reason}</div>
        </div>
      )}
    </div>
  );
};

/* ============================================================
   Main component
   ============================================================ */
const TabReceivedPOs = () => {
  const [rows, setRows]                 = useState([]);
  const [warehouses, setWarehouses]     = useState([]);
  const [totals, setTotals]             = useState({ line_count: 0, total_qty: 0, total_value: 0 });
  const [total, setTotal]               = useState(0);
  const [totalPages, setTotalPages]     = useState(1);
  const [page, setPage]                 = useState(1);

  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState('');

  const [images, setImages]             = useState({});

  const [trendData, setTrendData]       = useState([]);
  const [trendLoading, setTrendLoading] = useState(false);

  /* Single-expand mode: id of the currently expanded line, or null. */
  const [expandedRowId, setExpandedRowId] = useState(null);

  const [startDate, setStartDate]             = useState('');
  const [endDate, setEndDate]                 = useState('');
  const [warehouseFilter, setWarehouseFilter] = useState('');
  const [itemSearch, setItemSearch]           = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter]       = useState('All');
  const [deliveryFilter, setDeliveryFilter]   = useState('All');
  /* PO Type filter: 'All' | '1' (with PO) | '0' (without PO / PR-based) */
  const [poTypeFilter, setPoTypeFilter]       = useState('All');

  const [allWarehouses, setAllWarehouses] = useState([]);
  const [showOnlyWithReceived, setShowOnlyWithReceived] = useState(true);

  const [exportOpen, setExportOpen] = useState(false);
  const exportMenuRef = useRef(null);

  const reqIdRef = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(itemSearch);
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [itemSearch]);

  useEffect(() => {
    (async () => {
      try {
        const res = await warehouseApi.getAllWarehouses();
        if (res.ok && Array.isArray(res.data)) {
          setAllWarehouses(
            res.data
              .filter((w) => w && w.warehouse_code)
              .map((w) => ({
                warehouse_id: w.warehouse_id,
                warehouse_code: w.warehouse_code,
                warehouse_name: w.warehouse_name,
              }))
          );
        }
      } catch (err) {
        console.warn('Could not load warehouses for filter:', err);
      }
    })();
  }, []);

  useEffect(() => {
    if (!exportOpen) return;
    const onClick = (e) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target)) {
        setExportOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [exportOpen]);

  /* Collapse the expanded row whenever the visible set changes. */
  useEffect(() => {
    setExpandedRowId(null);
  }, [rows]);

  const buildQuery = useCallback(({ forExport = false, pageOverride } = {}) => {
    return {
      start_date:      startDate || undefined,
      end_date:        endDate   || undefined,
      warehouse_id:    warehouseFilter || undefined,
      search:          debouncedSearch.trim() || undefined,
      status:          statusFilter !== 'All' ? statusFilter : undefined,
      delivery_status: deliveryFilter !== 'All' ? deliveryFilter : undefined,
      /* PO Type: '1' = with PO, '0' = without PO (PR-based). Omitted → all. */
      has_po:          poTypeFilter !== 'All' ? poTypeFilter : undefined,
      page:            pageOverride ?? page,
      limit:           forExport ? 10000 : PAGE_SIZE,
    };
  }, [warehouseFilter, startDate, endDate, debouncedSearch, statusFilter, deliveryFilter, poTypeFilter, page]);

  const load = useCallback(async () => {
    const myReqId = ++reqIdRef.current;
    setLoading(true);
    setError('');
    try {
      const res = await importPoApi.listReceivedLines(buildQuery());
      if (myReqId !== reqIdRef.current) return;
      if (!res.ok) {
        setError(res.data?.message || 'Could not load received PO records.');
        setRows([]);
        setWarehouses([]);
        setTotals({ line_count: 0, total_qty: 0, total_value: 0 });
        setTotal(0);
        setTotalPages(1);
        return;
      }
      setRows(Array.isArray(res.data) ? res.data : []);
      setWarehouses(Array.isArray(res.warehouses) ? res.warehouses : []);
      setTotals(res.totals || { line_count: 0, total_qty: 0, total_value: 0 });
      setTotal(Number(res.total) || 0);
      setTotalPages(Number(res.totalPages) || 1);
    } catch (err) {
      if (myReqId !== reqIdRef.current) return;
      console.error(err);
      setError('Unexpected error while loading received PO records.');
    } finally {
      if (myReqId === reqIdRef.current) setLoading(false);
    }
  }, [buildQuery]);

  useEffect(() => { load(); }, [load]);

  const loadTrend = useCallback(async () => {
    setTrendLoading(true);
    try {
      const q = buildQuery();
      const res = await importPoApi.receivedTrend({
        start_date:      q.start_date,
        end_date:        q.end_date,
        warehouse_id:    q.warehouse_id,
        search:          q.search,
        status:          q.status,
        delivery_status: q.delivery_status,
        has_po:          q.has_po,
        days:            TREND_DAYS,
      });
      setTrendData(res.ok && Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      console.warn('Trend load failed:', err);
      setTrendData([]);
    } finally {
      setTrendLoading(false);
    }
  }, [buildQuery]);

  useEffect(() => { loadTrend(); }, [loadTrend]);

  useEffect(() => {
    if (!rows || rows.length === 0) { setImages({}); return; }
    const codes = [...new Set(rows.map((r) => r.item_code).filter(Boolean))];
    if (codes.length === 0) { setImages({}); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await itemMasterApi.getImagesByCodes(codes);
        if (!cancelled && res.ok && res.data?.images) {
          setImages(res.data.images);
        }
      } catch (err) {
        console.warn('Could not load item images:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [rows]);

  const warehouseOptions = useMemo(() => {
    const map = new Map();
    for (const w of warehouses) {
      map.set(w.warehouse_code, {
        line_count:  Number(w.line_count)  || 0,
        total_qty:   Number(w.total_qty)   || 0,
        total_value: Number(w.total_value) || 0,
      });
    }

    const merged = allWarehouses.map((w) => ({
      warehouse_id:   w.warehouse_id,
      warehouse_code: w.warehouse_code,
      warehouse_name: w.warehouse_name,
      stats: map.get(w.warehouse_code) || { line_count: 0, total_qty: 0, total_value: 0 },
    }));

    const filtered = showOnlyWithReceived
      ? merged.filter((w) => w.stats.line_count > 0)
      : merged;

    return filtered.sort((a, b) => {
      const diff = b.stats.line_count - a.stats.line_count;
      if (diff !== 0) return diff;
      return String(a.warehouse_code).localeCompare(String(b.warehouse_code));
    });
  }, [allWarehouses, warehouses, showOnlyWithReceived]);

  const groupedRows = useMemo(() => {
    const map = new Map();
    for (const r of rows) {
      const key = r.warehouse_code || '—';
      if (!map.has(key)) {
        map.set(key, {
          warehouse_code: key,
          warehouse_id:   r.warehouse_id,
          warehouse_name: r.warehouse_name || null,
          rows: [],
        });
      }
      const g = map.get(key);
      if (!g.warehouse_name && r.warehouse_name) g.warehouse_name = r.warehouse_name;
      g.rows.push(r);
    }
    for (const group of map.values()) {
      const summary = warehouses.find((w) => w.warehouse_code === group.warehouse_code);
      if (summary?.warehouse_name) group.warehouse_name = summary.warehouse_name;
      group.summary = summary || {
        warehouse_name: group.warehouse_name,
        line_count: group.rows.length,
        total_qty: group.rows.reduce((s, r) => s + (Number(r.received_qty) || 0), 0),
        total_value: group.rows.reduce((s, r) => s + lineTotalOf(r), 0),
      };
    }
    return [...map.values()].sort((a, b) =>
      String(a.warehouse_code).localeCompare(String(b.warehouse_code))
    );
  }, [rows, warehouses]);

  const kpis = useMemo(() => ([
    { key: 'lines', label: 'Received PO/PR',    value: totals.line_count ?? 0,             Icon: FiClipboard,  tone: 'slate' },
    { key: 'qty',   label: 'Received Qty',      value: fmtNum(totals.total_qty ?? 0),       Icon: FiPackage,    tone: 'amber' },
    { key: 'value', label: 'Total Value (PHP)', value: fmtMoney(totals.total_value ?? 0),   Icon: FiDollarSign, tone: 'green' },
    { key: 'wh',    label: 'Warehouses',        value: warehouses.length,                   Icon: FiHome,       tone: 'cyan'  },
  ]), [totals, warehouses]);

  const gotoPage = (n) => {
    const clamped = Math.max(1, Math.min(totalPages, n));
    if (clamped !== page) setPage(clamped);
  };

  const firstItem = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const lastItem  = Math.min(total, page * PAGE_SIZE);

  const toggleRow = (id) => {
    setExpandedRowId((prev) => (prev === id ? null : id));
  };

  const handleRowKeyDown = (e, id) => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      toggleRow(id);
    }
  };

  const exportExcel = async (scope) => {
    setExportOpen(false);
    try {
      const query = scope === 'all'
        ? { page: 1, limit: 10000 }
        : buildQuery({ forExport: true, pageOverride: 1 });

      const res = await importPoApi.listReceivedLines(query);
      if (!res.ok) {
        alert(res.data?.message || 'Export failed.');
        return;
      }
      const data = (res.data || []).map((r) => ({
        'Type':              Number(r.has_po) === 0 ? 'PR-based' : 'With PO',
        'PO Date':           fmtDateOnly(r.po_date),
        'PO No.':            r.po_no,
        'PR No.':            r.pr_no || '',
        'Vendor':            r.vendor_name || '',
        'Buyer':             r.buyer || '',
        'Warehouse Code':    r.warehouse_code || '',
        'Warehouse Name':    r.warehouse_name || '',
        'Item Code':         r.item_code,
        'Item Name':         r.item_name || '',
        'UOM':               r.uom || '',
        'Qty Ordered':       Number(r.qty) || 0,
        'Qty Received':      Number(r.received_qty) || 0,
        'Qty Damaged':       Number(r.damaged_qty) || 0,
        'Qty Stored':        Number(r.stored_qty) || 0,
        'Qty Released':      Number(r.released_qty) || 0,
        'Unit Price':        Number(r.unit_price) || 0,
        'Currency':          r.currency || '',
        'Forex':             r.forex != null ? Number(r.forex) : 1,
        'Func Amount (PHP)': lineTotalOf(r),
        'Damaged Value':     Number(r.damaged_value) || 0,
        'Delivery':          r.delivery_status || '',
        'Status':            r.status,
        'Imported By':       r.imported_by || '',
        'Imported At':       r.imported_at ? new Date(r.imported_at).toLocaleString() : '',
      }));

      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Received POs');

      const suffix = scope === 'all' ? 'all' : 'filtered';
      const filename = `received-pos-${suffix}-${todayIso()}.xlsx`;
      XLSX.writeFile(wb, filename);
    } catch (err) {
      console.error(err);
      alert(err.message || 'Export failed.');
    }
  };

  const exportImage = (scope) => {
    setExportOpen(false);

    const W = 1220;
    const HEADER_H = 110;
    const KPI_H    = 140;
    const ROW_H    = 26;
    const GROUP_H  = 34;
    const FOOTER_H = 50;

    const groupCount = groupedRows.length;
    const totalRowCount = rows.length;
    const H = HEADER_H + KPI_H + groupCount * GROUP_H + totalRowCount * ROW_H + (groupCount * 20) + FOOTER_H + 20;

    const canvas = document.createElement('canvas');
    const scale = 2;
    canvas.width  = W * scale;
    canvas.height = H * scale;
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 24px Inter, -apple-system, Segoe UI, sans-serif';
    ctx.fillText("Received PO's — Central Registry", 40, 50);

    ctx.fillStyle = '#64748b';
    ctx.font = '13px Inter, -apple-system, Segoe UI, sans-serif';
    const rangeLabel = (startDate || endDate)
      ? `Range: ${startDate || '—'} → ${endDate || '—'}`
      : 'Range: all time';
    ctx.fillText(`Generated ${new Date().toLocaleString()}  ·  ${rangeLabel}`, 40, 74);

    const kpiY = 96;
    const kpiW = (W - 80 - 3 * 12) / 4;
    const kpisForImage = [
      { label: 'Received Lines',    value: String(totals.line_count ?? 0),    color: '#0f172a' },
      { label: 'Received Qty',      value: fmtNum(totals.total_qty ?? 0),     color: '#b45309' },
      { label: 'Total Value (PHP)', value: fmtMoney(totals.total_value ?? 0), color: '#047857' },
      { label: 'Warehouses',        value: String(warehouses.length),         color: '#0e7490' },
    ];
    kpisForImage.forEach((k, i) => {
      const x = 40 + i * (kpiW + 12);
      ctx.fillStyle = '#f8fafc';
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 1;
      roundRect(ctx, x, kpiY, kpiW, 70, 10);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#64748b';
      ctx.font = 'bold 10px Inter, -apple-system, Segoe UI, sans-serif';
      ctx.fillText(k.label.toUpperCase(), x + 14, kpiY + 22);

      ctx.fillStyle = k.color;
      ctx.font = 'bold 18px JetBrains Mono, Menlo, Consolas, monospace';
      ctx.fillText(k.value, x + 14, kpiY + 52);
    });

    let y = kpiY + 70 + 28;
    const colX = [40, 200, 340, 470, 580, 660, 740, 840, 920, 1000, 1080];

    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 14px Inter, -apple-system, Segoe UI, sans-serif';
    ctx.fillText('Received PO Lines', 40, y);
    y += 18;

    ctx.fillStyle = '#64748b';
    ctx.font = '11px Inter, -apple-system, Segoe UI, sans-serif';
    ctx.fillText('PO No.',    colX[0], y);
    ctx.fillText('Item',      colX[1], y);
    ctx.fillText('Warehouse', colX[2], y);
    ctx.fillText('UOM',       colX[3], y);
    ctx.fillText('Ordered',   colX[4], y);
    ctx.fillText('Received',  colX[5], y);
    ctx.fillText('Price',     colX[6], y);
    ctx.fillText('Forex',     colX[7], y);
    ctx.fillText('Func(PHP)', colX[8], y);
    ctx.fillText('Delivery',  colX[9], y);
    ctx.fillText('Status',    colX[10], y);
    y += 6;
    ctx.beginPath();
    ctx.strokeStyle = '#e2e8f0';
    ctx.moveTo(40, y);
    ctx.lineTo(W - 40, y);
    ctx.stroke();
    y += 14;

    for (const group of groupedRows) {
      ctx.fillStyle = '#eef2ff';
      roundRect(ctx, 40, y - 2, W - 80, GROUP_H - 6, 6);
      ctx.fill();

      ctx.fillStyle = '#4338ca';
      ctx.font = 'bold 13px Inter, -apple-system, Segoe UI, sans-serif';
      const groupLabel = group.warehouse_name
        ? `${group.warehouse_code} — ${group.warehouse_name}`
        : group.warehouse_code;
      ctx.fillText(groupLabel, 52, y + 18);

      const subtotal = group.summary || { line_count: 0, total_qty: 0, total_value: 0 };
      const subtotalText = `${subtotal.line_count} line${subtotal.line_count === 1 ? '' : 's'} · ${fmtNum(subtotal.total_qty)} qty · ${fmtMoney(subtotal.total_value)}`;

      ctx.fillStyle = '#475569';
      ctx.font = '11px Inter, -apple-system, Segoe UI, sans-serif';
      const tw = ctx.measureText(subtotalText).width;
      ctx.fillText(subtotalText, W - 40 - tw - 12, y + 18);

      y += GROUP_H;

      for (const r of group.rows) {
        ctx.fillStyle = '#0f172a';
        ctx.font = '12px Inter, -apple-system, Segoe UI, sans-serif';
        ctx.fillText(r.po_no || '—', colX[0], y);
        ctx.fillText(r.item_code || '—', colX[1], y);
        ctx.fillText(r.warehouse_code || '—', colX[2], y);
        ctx.fillText(r.uom || '—', colX[3], y);

        ctx.textAlign = 'right';
        ctx.fillText(String(r.qty), colX[4] + 30, y);
        ctx.fillStyle = '#047857';
        ctx.fillText(String(r.received_qty), colX[5] + 30, y);

        ctx.fillStyle = '#0f172a';
        ctx.fillText(fmtNum(r.unit_price, 2), colX[6] + 30, y);
        ctx.fillStyle = '#4338ca';
        ctx.fillText(
          r.currency && r.currency !== 'PHP' && r.forex != null
            ? Number(r.forex).toFixed(3)
            : '—',
          colX[7] + 30, y
        );
        ctx.fillStyle = '#0f766e';
        ctx.fillText(fmtNum(lineTotalOf(r), 3), colX[8] + 40, y);

        ctx.textAlign = 'left';
        ctx.fillStyle = isPartialDelivery(r.delivery_status) ? '#b45309' : '#047857';
        ctx.fillText(r.delivery_status || '—', colX[9], y);

        ctx.fillStyle = '#475569';
        ctx.fillText(r.status || '—', colX[10], y);

        y += ROW_H;
        if (y > H - FOOTER_H - 20) break;
      }

      y += 6;
    }

    if (rows.length === 0) {
      ctx.fillStyle = '#94a3b8';
      ctx.font = '13px Inter, -apple-system, Segoe UI, sans-serif';
      ctx.fillText('No received PO lines match the current filters.', 40, y + 24);
    }

    const footerY = H - FOOTER_H + 20;
    ctx.fillStyle = '#94a3b8';
    ctx.font = '11px Inter, -apple-system, Segoe UI, sans-serif';
    const scopeLabel = scope === 'all' ? 'All' : 'Filtered';
    ctx.fillText(
      `IMS · Received PO's · ${scopeLabel} view · Page ${page}/${totalPages} · ${firstItem}–${lastItem} of ${total} · Totals in PHP`,
      40, footerY
    );

    canvas.toBlob((blob) => {
      if (!blob) { alert('Could not generate image.'); return; }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `received-pos-${scope === 'all' ? 'all' : 'filtered'}-${todayIso()}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 'image/png');
  };

  const clearFilters = () => {
    setStartDate('');
    setEndDate('');
    setWarehouseFilter('');
    setItemSearch('');
    setDebouncedSearch('');
    setStatusFilter('All');
    setDeliveryFilter('All');
    setPoTypeFilter('All');
    setPage(1);
  };

  const hasActiveFilters =
    !!startDate || !!endDate || !!itemSearch ||
    statusFilter !== 'All' || deliveryFilter !== 'All' ||
    poTypeFilter !== 'All' ||
    !!warehouseFilter;

  const applyRange = (days) => {
    setStartDate(daysAgoIso(days));
    setEndDate(todayIso());
    setPage(1);
  };

  const applyThisMonth = () => {
    setStartDate(startOfMonthIso());
    setEndDate(todayIso());
    setPage(1);
  };

  const applyAllTime = () => {
    setStartDate('');
    setEndDate('');
    setPage(1);
  };

  return (
    <div className="items-section rpo-root">
      <style>{tabCss}</style>

      <div className="section-header rpo-header">
        <div className="rpo-header-left">
          <div className="rpo-header-title-row">
            <h3>
              <FiInbox className="rpo-heading-icon" aria-hidden="true" />
              <span>Received PO's — Central Registry</span>
            </h3>
          </div>
          <p className="rpo-header-sub">
            Every received purchase-order line across every warehouse.
            Quantities in unit; <strong>line totals in PHP</strong> (functional amount = unit price × delivered qty × forex).
            Click any row to expand its full details.
          </p>
        </div>

        <div className="rpo-header-actions">
          <div className="rpo-export-wrap" ref={exportMenuRef}>
            <button
              type="button"
              className="rpo-export-btn"
              onClick={() => setExportOpen((o) => !o)}
              disabled={loading}
            >
              <FiDownload className="rpo-btn-icon" aria-hidden="true" />
              <span>Export</span>
              <FiChevronDown className="rpo-export-caret-icon" aria-hidden="true" />
            </button>
            {exportOpen && (
              <div className="rpo-export-menu">
                <div className="rpo-export-menu-head">Excel (.xlsx)</div>
                <button
                  type="button"
                  className="rpo-export-item"
                  onClick={() => exportExcel('filtered')}
                  disabled={!hasActiveFilters}
                  title={hasActiveFilters ? '' : 'No filters applied — same as All'}
                >
                  <span className="rpo-export-item-title">
                    <FiTarget className="rpo-export-icon" aria-hidden="true" />
                    <span>Filtered result</span>
                  </span>
                  <span className="rpo-export-hint">
                    {hasActiveFilters ? 'Current filters applied' : 'No filters set'}
                  </span>
                </button>
                <button
                  type="button"
                  className="rpo-export-item"
                  onClick={() => exportExcel('all')}
                >
                  <span className="rpo-export-item-title">
                    <FiFolder className="rpo-export-icon" aria-hidden="true" />
                    <span>All records</span>
                  </span>
                  <span className="rpo-export-hint">Ignores filters</span>
                </button>

                <div className="rpo-export-menu-head rpo-export-menu-head--mt">Image (.png)</div>
                <button
                  type="button"
                  className="rpo-export-item"
                  onClick={() => exportImage('filtered')}
                >
                  <span className="rpo-export-item-title">
                    <FiImage className="rpo-export-icon" aria-hidden="true" />
                    <span>Current view snapshot</span>
                  </span>
                </button>
              </div>
            )}
          </div>

          <button
            type="button"
            className="rpo-refresh-btn"
            onClick={load}
            disabled={loading}
          >
            <FiRefreshCw className={`rpo-btn-icon${loading ? ' icon-spin' : ''}`} aria-hidden="true" />
            <span>{loading ? 'Loading…' : 'Refresh'}</span>
          </button>
        </div>
      </div>

      <div className="rpo-kpi-row">
        {kpis.map((k) => {
          const Icon = k.Icon;
          return (
            <div key={k.key} className={`rpo-kpi rpo-kpi--${k.tone}`}>
              <div className="rpo-kpi-icon"><Icon aria-hidden="true" /></div>
              <div className="rpo-kpi-body">
                <div className="rpo-kpi-label">{k.label}</div>
                <div className="rpo-kpi-value">{k.value}</div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="rpo-trend-card">
        <div className="rpo-trend-head">
          <div>
            <div className="rpo-trend-title">Received Trend</div>
            <div className="rpo-trend-sub">
              {startDate || endDate
                ? `Filtered · ${startDate || '—'} → ${endDate || '—'}`
                : `Last ${TREND_DAYS} days`}
            </div>
          </div>
          <div className="rpo-trend-total">
            <div className="rpo-trend-total-label">Period Total (PHP)</div>
            <div className="rpo-trend-total-value">
              {fmtMoney(totals.total_value ?? 0)}
            </div>
          </div>
        </div>
        {trendLoading ? (
          <div className="rpo-trend-loading">Loading trend…</div>
        ) : trendData.length < 2 ? (
          <div className="rpo-trend-empty">Not enough data yet to plot a trend.</div>
        ) : (
          <TrendSparkline data={trendData} metric="total_value" height={100} />
        )}
      </div>

      <div className="rpo-quick-ranges">
        <span className="rpo-quick-ranges-label">Quick range:</span>
        <button type="button" className="rpo-quick-chip" onClick={() => applyRange(0)}>Today</button>
        <button type="button" className="rpo-quick-chip" onClick={() => applyRange(7)}>Last 7 days</button>
        <button type="button" className="rpo-quick-chip" onClick={() => applyRange(30)}>Last 30 days</button>
        <button type="button" className="rpo-quick-chip" onClick={applyThisMonth}>This month</button>
        <button type="button" className="rpo-quick-chip" onClick={applyAllTime}>All time</button>
      </div>

      <div className="rpo-filters">
        <div className="rpo-filter-group">
          <label className="rpo-filter-label">Start Date</label>
          <input
            type="date"
            className="rpo-filter-input"
            value={startDate}
            onChange={(e) => { setStartDate(e.target.value); setPage(1); }}
          />
        </div>
        <div className="rpo-filter-group">
          <label className="rpo-filter-label">End Date</label>
          <input
            type="date"
            className="rpo-filter-input"
            value={endDate}
            onChange={(e) => { setEndDate(e.target.value); setPage(1); }}
          />
        </div>

        <div className="rpo-filter-group rpo-filter-group--wide">
          <label className="rpo-filter-label">Warehouse</label>
          <select
            className="rpo-filter-input"
            value={warehouseFilter}
            onChange={(e) => { setWarehouseFilter(e.target.value); setPage(1); }}
          >
            <option value="">All warehouses</option>
            {warehouseOptions.map((w) => (
              <option
                key={w.warehouse_id ?? w.warehouse_code}
                value={w.warehouse_id ?? ''}
              >
                {w.warehouse_code} — {w.warehouse_name || ''}
                {w.stats.line_count > 0 ? ` (${w.stats.line_count})` : ''}
              </option>
            ))}
          </select>
        </div>

        <div className="rpo-filter-group rpo-filter-group--grow">
          <label className="rpo-filter-label">Search</label>
          <input
            type="text"
            className="rpo-filter-input"
            placeholder="PO No., PR No., vendor, item code or name…"
            value={itemSearch}
            onChange={(e) => setItemSearch(e.target.value)}
          />
        </div>

        <div className="rpo-filter-group">
          <label className="rpo-filter-label">PO Type</label>
          <select
            className="rpo-filter-input"
            value={poTypeFilter}
            onChange={(e) => { setPoTypeFilter(e.target.value); setPage(1); }}
          >
            <option value="All">All types</option>
            <option value="1">With PO</option>
            <option value="0">Without PO (PR-based)</option>
          </select>
        </div>

        <div className="rpo-filter-group">
          <label className="rpo-filter-label">Status</label>
          <select
            className="rpo-filter-input"
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          >
            <option value="All">All Status</option>
            <option value="With Handler">With Handler</option>
            <option value="Pending Transfer">Pending Transfer</option>
            <option value="Transferred">Transferred</option>
            <option value="Stored">Stored</option>
            <option value="Released">Released</option>
          </select>
        </div>

        <div className="rpo-filter-group">
          <label className="rpo-filter-label">Delivery</label>
          <select
            className="rpo-filter-input"
            value={deliveryFilter}
            onChange={(e) => { setDeliveryFilter(e.target.value); setPage(1); }}
          >
            <option value="All">All deliveries</option>
            <option value="Complete">Complete</option>
            {/* The backend maps this value to IN ('Partial', 'Partial Received')
                so legacy auto-derived rows still match. */}
            <option value="Partial Received">Partial</option>
          </select>
        </div>

        <div className="rpo-filter-group rpo-filter-group--toggle">
          <label className="rpo-filter-label">&nbsp;</label>
          <label className="rpo-toggle" title="Hide warehouses with zero received lines">
            <input
              type="checkbox"
              checked={showOnlyWithReceived}
              onChange={(e) => setShowOnlyWithReceived(e.target.checked)}
            />
            <span className="rpo-toggle-track" aria-hidden="true">
              <span className="rpo-toggle-thumb" />
            </span>
            <span className="rpo-toggle-text">Only warehouses with received POs</span>
          </label>
        </div>

        <div className="rpo-filter-actions">
          <button
            type="button"
            className="cancel-btn rpo-filter-btn"
            onClick={clearFilters}
            disabled={!hasActiveFilters}
          >
            Clear Filters
          </button>
        </div>
      </div>

      {warehouses.length > 0 && (
        <div className="rpo-wh-chips">
          <span className="rpo-wh-chips-label">By warehouse:</span>
          {warehouses.map((w) => {
            const matchedWh = allWarehouses.find(
              (x) => x.warehouse_code === w.warehouse_code
            );
            const isActive =
              matchedWh &&
              String(warehouseFilter) === String(matchedWh.warehouse_id);

            return (
              <button
                key={w.warehouse_code}
                type="button"
                className={`rpo-wh-chip${isActive ? ' is-active' : ''}`}
                onClick={() => {
                  if (!matchedWh) return;
                  setWarehouseFilter(String(matchedWh.warehouse_id));
                  setPage(1);
                }}
                disabled={!matchedWh}
                title={w.warehouse_name || w.warehouse_code}
              >
                <span className="rpo-wh-chip-top">
                  <span className="rpo-wh-chip-code">{w.warehouse_code}</span>
                  {w.warehouse_name && (
                    <span className="rpo-wh-chip-name">{w.warehouse_name}</span>
                  )}
                </span>
                <span className="rpo-wh-chip-stats">
                  {w.line_count} · {fmtNum(w.total_qty)} qty · {fmtMoney(w.total_value)}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {error && (
        <div className="rpo-error">
          <FiAlertTriangle className="rpo-error-icon" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      <div className="daily-items-section rpo-table-section">
        <div className="daily-items-header">
          <h4>Received PO Lines</h4>
          <span className="daily-items-count">
            {total === 0
              ? '0 records'
              : `Showing ${firstItem}–${lastItem} of ${total}`}
          </span>
        </div>

        {loading ? (
          <div className="loading-spinner" style={{ margin: '32px auto' }} />
        ) : groupedRows.length === 0 ? (
          <div className="rpo-empty">
            <div className="rpo-empty-icon"><FiInbox aria-hidden="true" /></div>
            <div className="rpo-empty-title">No received PO lines</div>
            <div className="rpo-empty-sub">
              {hasActiveFilters
                ? 'No records match the current filters.'
                : 'No purchase orders have been received yet.'}
            </div>
          </div>
        ) : (
          <div className="rpo-groups">
            {groupedRows.map((group) => (
              <div key={group.warehouse_code} className="rpo-group">
                <div className="rpo-group-head">
                  <div className="rpo-group-head-left">
                    <span className="rpo-group-icon"><FiHome aria-hidden="true" /></span>
                    <span className="rpo-group-code">{group.warehouse_code}</span>
                    {group.warehouse_name && (
                      <span className="rpo-group-name">{group.warehouse_name}</span>
                    )}
                    <span className="rpo-group-count">
                      {group.rows.length} on this page
                    </span>
                  </div>
                  <div className="rpo-group-head-right">
                    <span className="rpo-group-stat">
                      <strong>{group.summary?.line_count ?? 0}</strong> lines
                    </span>
                    <span className="rpo-group-stat">
                      <strong>{fmtNum(group.summary?.total_qty ?? 0)}</strong> qty
                    </span>
                    <span className="rpo-group-stat rpo-group-stat--value">
                      <strong>{fmtMoney(group.summary?.total_value ?? 0)}</strong>
                    </span>
                  </div>
                </div>

                <div className="rpo-table-wrap">
                  <table className="rpo-table">
                    <thead>
                      <tr>
                        <th className="rpo-th rpo-th--caret" aria-label="Expand row"></th>
                        <th className="rpo-th rpo-th--type">Type</th>
                        <th className="rpo-th rpo-th--po">PO No.</th>
                        <th className="rpo-th rpo-th--vendor">Vendor</th>
                        <th className="rpo-th rpo-th--item">Item</th>
                        <th className="rpo-th rpo-th--received">Received</th>
                        <th className="rpo-th rpo-th--deliv">Delivery</th>
                        <th className="rpo-th rpo-th--status">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.rows.map((r) => {
                        const prBased = isPrBased(r);
                        const isExpanded = expandedRowId === r.id;

                        return (
                          <React.Fragment key={r.id}>
                            <tr
                              className={`rpo-row${isExpanded ? ' is-expanded' : ''}`}
                              onClick={() => toggleRow(r.id)}
                              onKeyDown={(e) => handleRowKeyDown(e, r.id)}
                              tabIndex={0}
                              role="button"
                              aria-expanded={isExpanded}
                              aria-controls={`rpo-xp-${r.id}`}
                              title={isExpanded ? 'Click to collapse' : 'Click for full details'}
                            >
                              <td className="rpo-td rpo-td--caret">
                                <span className="rpo-caret" aria-hidden="true">
                                  {isExpanded
                                    ? <FiChevronDown className="rpo-caret-icon" />
                                    : <FiChevronRight className="rpo-caret-icon" />}
                                </span>
                              </td>
                              <td className="rpo-td rpo-td--type">
                                {prBased
                                  ? <span className="rpo-pr-pill" title="No PO No. — grouped by PR No.">PR</span>
                                  : <span className="rpo-type-pill rpo-type-pill--po" title="Has a real PO No.">PO</span>}
                              </td>
                              <td className="rpo-td rpo-td--po">
                                <span className="rpo-po-no">{r.po_no}</span>
                                {r.pr_no && (
                                  <div className="rpo-pr-no" title={r.pr_no}>PR: {r.pr_no}</div>
                                )}
                              </td>
                              <td className="rpo-td rpo-td--vendor" title={r.vendor_name}>
                                {r.vendor_name || '—'}
                              </td>
                              <td className="rpo-td rpo-td--item">
                                <div className="rpo-item-cell">
                                  <ItemImageThumb
                                    src={images[r.item_code] || null}
                                    alt={r.item_code}
                                    size={32}
                                  />
                                  <div className="rpo-item-info">
                                    <div className="rpo-item-code">{r.item_code}</div>
                                    <div className="rpo-item-name" title={r.item_name}>
                                      {r.item_name || '—'}
                                    </div>
                                  </div>
                                </div>
                              </td>
                              <td className="rpo-td rpo-td--received">
                                <span className="rpo-received-qty">
                                  {fmtNum(r.received_qty, 0)}
                                </span>
                                <span className="rpo-received-sub">
                                  of {fmtNum(r.qty, 0)}
                                </span>
                              </td>
                              <td className="rpo-td rpo-td--deliv">
                                <DeliveryBadge status={r.delivery_status} />
                              </td>
                              <td className="rpo-td rpo-td--status">
                                <span className={statusBadgeClass(r.status)}>{r.status}</span>
                              </td>
                            </tr>

                            {isExpanded && (
                              <tr className="rpo-row-xp">
                                <td className="rpo-td-xp" colSpan={8}>
                                  <div id={`rpo-xp-${r.id}`}>
                                    <ExpandedLinePanel
                                      row={r}
                                      imageSrc={images[r.item_code] || null}
                                    />
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )}

        {totalPages > 1 && (
          <div className="rpo-pagination">
            <div className="rpo-pagination-info">
              Showing <strong>{firstItem}–{lastItem}</strong> of <strong>{total}</strong>
            </div>
            <div className="rpo-pagination-controls">
              <button type="button" className="rpo-page-btn" onClick={() => gotoPage(1)} disabled={page <= 1}>« First</button>
              <button type="button" className="rpo-page-btn" onClick={() => gotoPage(page - 1)} disabled={page <= 1}>‹ Prev</button>
              <span className="rpo-page-label">
                Page <strong>{page}</strong> of <strong>{totalPages}</strong>
              </span>
              <button type="button" className="rpo-page-btn" onClick={() => gotoPage(page + 1)} disabled={page >= totalPages}>Next ›</button>
              <button type="button" className="rpo-page-btn" onClick={() => gotoPage(totalPages)} disabled={page >= totalPages}>Last »</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

/* ============================================================
   CSS — complete and self-contained
   ============================================================ */
const tabCss = `
.rpo-root { font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }

/* ---- Feather icon helpers ---- */
.rpo-heading-icon {
  width: 1.05em;
  height: 1.05em;
  flex-shrink: 0;
  margin-right: 8px;
  color: #0f766e;
  stroke-width: 2.2;
  vertical-align: -0.15em;
}
.rpo-btn-icon {
  width: 1em;
  height: 1em;
  flex-shrink: 0;
  stroke-width: 2.4;
}
.rpo-export-caret-icon {
  width: 0.85em;
  height: 0.85em;
  flex-shrink: 0;
  stroke-width: 2.5;
  color: #94a3b8;
}
.rpo-export-icon {
  width: 1.05em;
  height: 1.05em;
  flex-shrink: 0;
  stroke-width: 2.3;
  color: #0f766e;
}
.rpo-error-icon {
  width: 1.15em;
  height: 1.15em;
  flex-shrink: 0;
  stroke-width: 2.2;
  color: #991b1b;
}
.rpo-inline-icon {
  width: 1.05em;
  height: 1.05em;
  flex-shrink: 0;
  stroke-width: 2.2;
  margin-top: 2px;
  color: #4338ca;
}
.rpo-badge-icon {
  width: 0.95em;
  height: 0.95em;
  flex-shrink: 0;
  stroke-width: 2.6;
}
.rpo-caret-icon {
  width: 1em;
  height: 1em;
  stroke-width: 2.8;
}
.rpo-kpi-icon svg,
.rpo-group-icon svg,
.rpo-empty-icon svg {
  width: 1em;
  height: 1em;
  stroke-width: 2.2;
}
.rpo-empty-icon svg { width: 1.15em; height: 1.15em; stroke-width: 1.5; }

.icon-spin { animation: rpo-spin 0.9s linear infinite; }
@keyframes rpo-spin { to { transform: rotate(360deg); } }

.rpo-header { align-items: flex-start !important; gap: 16px !important; flex-wrap: wrap; }
.rpo-header-left { min-width: 0; flex: 1 1 320px; }
.rpo-header-title-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 4px; }
.rpo-header-title-row h3 { margin: 0 !important; display: inline-flex; align-items: center; }
.rpo-header-sub { margin: 0; font-size: 13px; color: #64748b; line-height: 1.5; }
.rpo-header-actions { display: flex; gap: 10px; align-items: flex-start; flex-shrink: 0; }

/* ---- Export dropdown ---- */
.rpo-export-wrap { position: relative; }
.rpo-export-btn {
  padding: 10px 16px; border-radius: 8px; font-size: 13px; font-weight: 700;
  border: 1px solid #cbd5e1; background: #ffffff; color: #334155;
  cursor: pointer; display: inline-flex; align-items: center; gap: 6px;
  font-family: inherit;
  transition: background 0.15s ease, border-color 0.15s ease;
}
.rpo-export-btn:hover:not(:disabled) { background: #f8fafc; border-color: #94a3b8; }
.rpo-export-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.rpo-export-menu {
  position: absolute; right: 0; top: calc(100% + 6px);
  min-width: 240px;
  background: #ffffff; border: 1px solid #e2e8f0; border-radius: 10px;
  box-shadow: 0 12px 32px rgba(15, 23, 42, 0.16);
  padding: 6px; z-index: 100;
}
.rpo-export-menu-head {
  font-size: 10px; font-weight: 700; color: #94a3b8;
  text-transform: uppercase; letter-spacing: 0.08em;
  padding: 8px 10px 4px;
}
.rpo-export-menu-head--mt { border-top: 1px solid #f1f5f9; margin-top: 4px; }
.rpo-export-item {
  width: 100%; display: flex; flex-direction: column; gap: 2px;
  padding: 8px 10px; border: none; background: transparent;
  border-radius: 6px; cursor: pointer; text-align: left;
  font-size: 13px; font-weight: 600; color: #334155; font-family: inherit;
}
.rpo-export-item-title {
  display: inline-flex; align-items: center; gap: 6px;
}
.rpo-export-item:hover:not(:disabled) { background: #f0fdfa; color: #0f766e; }
.rpo-export-item:disabled { opacity: 0.5; cursor: not-allowed; }
.rpo-export-hint { font-size: 11px; font-weight: 500; color: #94a3b8; }

.rpo-refresh-btn {
  padding: 10px 18px; border-radius: 8px;
  font-size: 13px; font-weight: 700; cursor: pointer;
  border: none; color: #fff; font-family: inherit;
  background: linear-gradient(135deg, #00e0d4 0%, #00b8b0 45%, #008a82 100%);
  box-shadow: 0 4px 12px rgba(0, 200, 190, 0.32);
  transition: transform 0.1s ease, box-shadow 0.15s ease;
  display: inline-flex; align-items: center; justify-content: center; gap: 7px;
}
.rpo-refresh-btn:hover:not(:disabled) { box-shadow: 0 6px 16px rgba(0, 200, 190, 0.42); }
.rpo-refresh-btn:active:not(:disabled) { transform: scale(0.98); }
.rpo-refresh-btn:disabled { opacity: 0.55; cursor: not-allowed; box-shadow: none; }

/* ---- KPIs ---- */
.rpo-kpi-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 12px; margin: 16px 0;
}
.rpo-kpi {
  display: flex; align-items: center; gap: 12px;
  padding: 14px 16px; border-radius: 12px;
  background: #ffffff; border: 1px solid #e2e8f0;
}
.rpo-kpi-icon {
  width: 44px; height: 44px; border-radius: 12px;
  display: flex; align-items: center; justify-content: center;
  font-size: 22px; flex-shrink: 0;
}
.rpo-kpi-body { min-width: 0; flex: 1; }
.rpo-kpi-label {
  font-size: 10px; font-weight: 700; color: #64748b;
  text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 3px;
}
.rpo-kpi-value {
  font-size: 20px; font-weight: 800; color: #0f172a;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  letter-spacing: -0.02em; word-break: break-word;
}
.rpo-kpi--slate .rpo-kpi-icon { background: #f1f5f9; color: #334155; }
.rpo-kpi--amber .rpo-kpi-icon { background: #fef3c7; color: #b45309; }
.rpo-kpi--green .rpo-kpi-icon { background: #d1fae5; color: #047857; }
.rpo-kpi--cyan  .rpo-kpi-icon { background: #ecfeff; color: #0e7490; }

/* ---- Trend ---- */
.rpo-trend-card { background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px 18px; margin-bottom: 16px; }
.rpo-trend-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 6px; }
.rpo-trend-title { font-size: 13px; font-weight: 800; color: #0f172a; letter-spacing: -0.01em; text-transform: uppercase; }
.rpo-trend-sub { font-size: 11px; color: #64748b; margin-top: 2px; }
.rpo-trend-total { text-align: right; }
.rpo-trend-total-label { font-size: 10px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.06em; }
.rpo-trend-total-value { font-size: 18px; font-weight: 800; color: #047857; font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace; margin-top: 2px; }
.rpo-trend-chart { margin-top: 4px; }
.rpo-trend-footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 8px; font-size: 11px; color: #64748b; flex-wrap: wrap; }
.rpo-trend-date { font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace; }
.rpo-trend-peak strong { color: #0f172a; }
.rpo-trend-loading, .rpo-trend-empty { padding: 26px 12px; text-align: center; font-size: 12.5px; color: #94a3b8; background: #f8fafc; border-radius: 8px; }

/* ---- Quick range chips ---- */
.rpo-quick-ranges { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
.rpo-quick-ranges-label { font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.06em; margin-right: 4px; }
.rpo-quick-chip {
  padding: 5px 12px; font-size: 12px; font-weight: 600; border-radius: 999px;
  border: 1px solid #e2e8f0; background: #ffffff; color: #475569;
  cursor: pointer; font-family: inherit;
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
}
.rpo-quick-chip:hover { background: #f0fdfa; border-color: #5eead4; color: #0f766e; }
.rpo-quick-chip:active { transform: scale(0.97); }

/* ---- Filters ---- */
.rpo-filters {
  display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-end;
  padding: 14px 16px; margin-bottom: 16px;
  background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px;
}
.rpo-filter-group { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.rpo-filter-group--grow { flex: 1 1 220px; }
.rpo-filter-group--wide { flex: 0 1 260px; }
.rpo-filter-group--toggle { flex: 0 0 auto; min-width: 240px; }
.rpo-filter-label { font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.06em; }
.rpo-filter-input {
  padding: 9px 12px; border: 1px solid #cbd5e1; border-radius: 8px;
  font-size: 13px; font-family: inherit; color: #0f172a; outline: none;
  background: #ffffff; min-width: 0;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.rpo-filter-input:focus { border-color: #00b8b0; box-shadow: 0 0 0 3px rgba(0, 184, 176, 0.15); }
.rpo-filter-actions { display: flex; align-items: flex-end; margin-left: auto; }
.rpo-filter-btn { padding: 9px 16px !important; font-size: 13px !important; }

/* ---- Toggle ---- */
.rpo-toggle {
  display: inline-flex; align-items: center; gap: 10px;
  cursor: pointer; user-select: none;
  padding: 8px 12px; border-radius: 8px;
  border: 1px solid #cbd5e1; background: #ffffff;
  font-size: 12px; font-weight: 600; color: #334155;
  transition: border-color 0.15s ease, background 0.15s ease;
}
.rpo-toggle:hover { border-color: #94a3b8; background: #f8fafc; }
.rpo-toggle input { position: absolute; opacity: 0; pointer-events: none; }
.rpo-toggle-track {
  position: relative; width: 32px; height: 18px;
  background: #cbd5e1; border-radius: 999px;
  transition: background 0.2s ease; flex-shrink: 0;
}
.rpo-toggle-thumb {
  position: absolute; top: 2px; left: 2px;
  width: 14px; height: 14px; background: #ffffff;
  border-radius: 50%; box-shadow: 0 1px 3px rgba(15, 23, 42, 0.2);
  transition: transform 0.2s cubic-bezier(0.34, 1.4, 0.64, 1);
}
.rpo-toggle input:checked ~ .rpo-toggle-track { background: #00b8b0; }
.rpo-toggle input:checked ~ .rpo-toggle-track .rpo-toggle-thumb { transform: translateX(14px); }
.rpo-toggle input:focus-visible ~ .rpo-toggle-track { box-shadow: 0 0 0 3px rgba(0, 184, 176, 0.25); }
.rpo-toggle-text { white-space: nowrap; }

/* ---- Warehouse chips ---- */
.rpo-wh-chips {
  display: flex; flex-wrap: wrap; gap: 8px; align-items: center;
  margin-bottom: 16px; padding: 12px 14px;
  background: #f0fdfa; border: 1px solid #99f6e4; border-radius: 10px;
}
.rpo-wh-chips-label { font-size: 11px; font-weight: 700; color: #0f766e; text-transform: uppercase; letter-spacing: 0.06em; }
.rpo-wh-chip {
  display: inline-flex; flex-direction: column; align-items: flex-start; gap: 3px;
  padding: 8px 12px; border-radius: 10px;
  border: 1px solid #99f6e4; background: #ffffff;
  font-size: 12px; font-family: inherit; font-weight: 600;
  color: #0f766e; cursor: pointer; text-align: left;
  transition: background 0.15s ease, border-color 0.15s ease, transform 0.1s ease;
}
.rpo-wh-chip:hover:not(:disabled) { background: #ccfbf1; border-color: #5eead4; }
.rpo-wh-chip:active:not(:disabled) { transform: scale(0.97); }
.rpo-wh-chip:disabled { cursor: default; }
.rpo-wh-chip.is-active { background: #0f766e; color: #ffffff; border-color: #0f766e; }
.rpo-wh-chip.is-active .rpo-wh-chip-stats { color: rgba(255, 255, 255, 0.85); }
.rpo-wh-chip.is-active .rpo-wh-chip-name { color: rgba(255, 255, 255, 0.9); }
.rpo-wh-chip-top { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.rpo-wh-chip-code { font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace; font-weight: 700; }
.rpo-wh-chip-name { font-size: 11px; color: #475569; font-weight: 500; }
.rpo-wh-chip-stats { font-size: 11px; color: #64748b; font-weight: 600; }

.rpo-error {
  padding: 12px 16px; margin-bottom: 16px;
  background: #fef2f2; border: 1px solid #fecaca; border-radius: 10px;
  color: #991b1b; font-size: 13px;
  display: flex; align-items: center; gap: 8px;
}

/* ---- Groups + table ---- */
.rpo-groups { display: flex; flex-direction: column; gap: 18px; }
.rpo-group { border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; background: #ffffff; }
.rpo-group-head {
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px; flex-wrap: wrap;
  padding: 12px 16px;
  background: linear-gradient(135deg, #eef2ff 0%, #e0e7ff 100%);
  border-bottom: 1px solid #c7d2fe;
}
.rpo-group-head-left { display: flex; align-items: center; gap: 10px; min-width: 0; flex-wrap: wrap; }
.rpo-group-icon {
  font-size: 16px; flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center;
  color: #4338ca;
}
.rpo-group-code {
  font-size: 15px; font-weight: 800; color: #3730a3;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  letter-spacing: 0.02em;
}
.rpo-group-name {
  font-size: 14px; font-weight: 600; color: #4338ca;
  padding-left: 2px;
}
.rpo-group-name::before {
  content: '—'; color: #a5b4fc; margin-right: 8px; font-weight: 500;
}
.rpo-group-count {
  font-size: 11px; color: #6366f1; font-weight: 600;
  padding: 2px 8px; background: rgba(255, 255, 255, 0.7); border-radius: 999px;
}
.rpo-group-head-right { display: flex; gap: 16px; flex-wrap: wrap; align-items: center; }
.rpo-group-stat { font-size: 12px; color: #3730a3; font-weight: 600; }
.rpo-group-stat strong {
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-weight: 800; color: #1e1b4b;
}
.rpo-group-stat--value strong { color: #047857; }

.rpo-table-wrap { overflow: auto; max-height: 70vh; background: #ffffff; }
.rpo-table {
  width: 100%; border-collapse: collapse; font-size: 13px;
  min-width: 1020px;
}

/* ---- Table header ---- */
.rpo-th {
  padding: 10px 12px; text-align: left;
  font-size: 10px; font-weight: 700; color: #64748b;
  text-transform: uppercase; letter-spacing: 0.06em;
  background: #f8fafc; border-bottom: 1px solid #e2e8f0;
  position: sticky; top: 0; z-index: 2; white-space: nowrap;
}
.rpo-th--caret    { width: 40px; padding-left: 8px; padding-right: 4px; }
.rpo-th--type     { width: 60px; text-align: center; }
.rpo-th--po       { width: 140px; }
.rpo-th--vendor   { width: 160px; }
.rpo-th--item     { width: auto; min-width: 220px; }
.rpo-th--received { width: 110px; text-align: right; }
.rpo-th--deliv    { width: 110px; text-align: center; }
.rpo-th--status   { width: 140px; }

/* ---- Table body ---- */
.rpo-td {
  padding: 12px 12px; vertical-align: middle;
  color: #0f172a; border-bottom: 1px solid #f1f5f9;
  font-size: 13px;
}
.rpo-td--caret    { width: 40px; padding-left: 8px; padding-right: 4px; text-align: center; }
.rpo-td--type     { text-align: center; }
.rpo-td--po       { min-width: 120px; }
.rpo-td--vendor   {
  max-width: 180px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: #475569;
}
.rpo-td--received {
  text-align: right;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
}
.rpo-td--deliv    { text-align: center; }
.rpo-td--status   { white-space: nowrap; }

.rpo-caret {
  display: inline-flex; align-items: center; justify-content: center;
  width: 24px; height: 24px; border-radius: 6px;
  color: #94a3b8;
  transition: background 0.15s ease, color 0.15s ease;
}
.rpo-row:hover .rpo-caret { background: #e2e8f0; color: #334155; }
.rpo-row.is-expanded .rpo-caret { background: #ccfbf1; color: #0f766e; }

.rpo-row {
  cursor: pointer;
  transition: background 0.12s ease;
  outline: none;
}
.rpo-row:hover { background: #f0fdfa; }
.rpo-row:active { background: #e6fffb; }
.rpo-row:focus-visible {
  box-shadow: inset 0 0 0 2px #00b8b0;
}
.rpo-row.is-expanded {
  background: #f0fdfa;
}
.rpo-row.is-expanded .rpo-td {
  border-bottom-color: transparent;
}
.rpo-row.is-expanded .rpo-td--caret {
  box-shadow: inset 3px 0 0 #00b8b0;
}

.rpo-po-no {
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-weight: 700;
  font-size: 13px;
  color: #0f766e;
  line-height: 1.2;
  display: block;
}
.rpo-pr-no {
  font-size: 10px; color: #94a3b8; margin-top: 2px;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  max-width: 140px;
}

.rpo-item-cell { display: flex; align-items: center; gap: 10px; min-width: 0; }
.rpo-item-info { min-width: 0; flex: 1; }
.rpo-item-code {
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-weight: 700; font-size: 12.5px; color: #4338ca;
  line-height: 1.2;
}
.rpo-item-name {
  font-size: 11px; color: #475569; margin-top: 1px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  max-width: 260px;
}

.rpo-received-qty {
  display: block;
  font-size: 15px;
  font-weight: 800;
  color: #047857;
  letter-spacing: -0.01em;
  line-height: 1.15;
}
.rpo-received-sub {
  display: block;
  font-size: 10.5px;
  font-weight: 500;
  color: #94a3b8;
  margin-top: 1px;
}

/* ---- Type pills (PO / PR) ---- */
.rpo-type-pill {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.06em;
  white-space: nowrap;
}
.rpo-type-pill--po {
  background: #ecfeff;
  color: #0e7490;
  border: 1px solid #a5f3fc;
}
.rpo-pr-pill {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.06em;
  background: #fff7ed;
  color: #9a3412;
  border: 1px solid #fed7aa;
  white-space: nowrap;
}
.rpo-pr-pill--inline { margin-left: 0; }

/* ---- Delivery badge ---- */
.rpo-deliv {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 3px 10px;
  border-radius: 999px; font-size: 10.5px; font-weight: 700;
  letter-spacing: 0.02em; white-space: nowrap;
}
.rpo-deliv--complete { background: #dcfce7; color: #065f46; border: 1px solid #86efac; }
.rpo-deliv--partial  { background: #fef3c7; color: #92400e; border: 1px solid #fcd34d; }

/* ---- Status badge ---- */
.rpo-status {
  display: inline-flex; align-items: center; gap: 3px;
  padding: 3px 9px; border-radius: 999px;
  font-size: 10px; font-weight: 700; letter-spacing: 0.03em;
  text-transform: uppercase; white-space: nowrap;
}
.rpo-status--pending          { background: #f1f5f9; color: #475569; border: 1px solid #cbd5e1; }
.rpo-status--partial          { background: #fef3c7; color: #92400e; border: 1px solid #fcd34d; }
.rpo-status--complete         { background: #dcfce7; color: #166534; border: 1px solid #86efac; }
.rpo-status--damage           { background: #fee2e2; color: #991b1b; border: 1px solid #fca5a5; }
.rpo-status--handler          { background: #e0e7ff; color: #3730a3; border: 1px solid #a5b4fc; }
.rpo-status--pending-transfer { background: #fce7f3; color: #9d174d; border: 1px solid #f9a8d4; }
.rpo-status--done             { background: #f0fdf4; color: #15803d; border: 1px solid #bbf7d0; }

.rpo-empty { padding: 48px 24px; text-align: center; }
.rpo-empty-icon { font-size: 48px; margin-bottom: 12px; color: #cbd5e1; display: flex; justify-content: center; }
.rpo-empty-title { font-size: 16px; font-weight: 700; color: #0f172a; }
.rpo-empty-sub { font-size: 13px; color: #64748b; margin-top: 4px; }

/* ============================================================
   Expanded panel (inline row detail)
   ============================================================ */
.rpo-row-xp > .rpo-td-xp {
  padding: 0 !important;
  border-bottom: 1px solid #e2e8f0 !important;
  background: #f8fafc;
}

.rpo-xp {
  padding: 18px 22px 20px 52px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  border-left: 3px solid #00b8b0;
  animation: rpoXpFade 0.2s ease-out;
}
@keyframes rpoXpFade {
  from { opacity: 0; transform: translateY(-4px); }
  to   { opacity: 1; transform: translateY(0); }
}

/* --- Hero --- */
.rpo-xp-hero {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 14px;
  background: linear-gradient(135deg, #f0fdfa 0%, #ecfeff 100%);
  border: 1px solid #99f6e4;
  border-radius: 10px;
}
.rpo-xp-hero-img { flex-shrink: 0; }
.rpo-xp-hero-info { min-width: 0; flex: 1; }
.rpo-xp-hero-code {
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-weight: 800;
  font-size: 15px;
  color: #0f766e;
  letter-spacing: -0.01em;
  line-height: 1.2;
  word-break: break-word;
}
.rpo-xp-hero-name {
  font-size: 13px;
  color: #1e293b;
  font-weight: 600;
  margin-top: 3px;
  line-height: 1.4;
  word-break: break-word;
}
.rpo-xp-hero-uom {
  font-size: 11px;
  color: #64748b;
  margin-top: 4px;
}
.rpo-xp-hero-uom strong { color: #334155; font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace; }

/* --- Section shell --- */
.rpo-xp-section { display: flex; flex-direction: column; gap: 8px; }
.rpo-xp-section-title {
  font-size: 10.5px;
  font-weight: 800;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

/* --- Quantity grid --- */
.rpo-xp-qty-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 8px;
}
.rpo-xp-qty-box {
  padding: 10px 12px;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  text-align: center;
  display: flex; flex-direction: column; gap: 3px;
}
.rpo-xp-qty-box--good   { border-color: #86efac; background: #f0fdf4; }
.rpo-xp-qty-box--damage { border-color: #fca5a5; background: #fef2f2; }
.rpo-xp-qty-label {
  font-size: 10px; font-weight: 700; color: #64748b;
  text-transform: uppercase; letter-spacing: 0.06em;
}
.rpo-xp-qty-value {
  font-size: 16px; font-weight: 800; color: #0f172a;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  letter-spacing: -0.02em;
}
.rpo-xp-qty-box--good   .rpo-xp-qty-value { color: #047857; }
.rpo-xp-qty-box--damage .rpo-xp-qty-value { color: #be123c; }

/* --- Value composition (equation row) --- */
.rpo-xp-eq-row {
  display: flex; align-items: stretch; gap: 8px;
  flex-wrap: wrap;
}
.rpo-xp-eq-box {
  flex: 1 1 130px; min-width: 110px;
  padding: 10px 12px;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  display: flex; flex-direction: column; gap: 3px;
}
.rpo-xp-eq-box--total {
  background: linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%);
  border-color: #86efac;
}
.rpo-xp-eq-label {
  font-size: 10px; font-weight: 700; color: #64748b;
  text-transform: uppercase; letter-spacing: 0.06em;
}
.rpo-xp-eq-box--total .rpo-xp-eq-label { color: #065f46; }
.rpo-xp-eq-value {
  font-size: 14px; font-weight: 800; color: #0f172a;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  letter-spacing: -0.01em;
  word-break: break-word;
}
.rpo-xp-eq-box--total .rpo-xp-eq-value { color: #047857; font-size: 15px; }
.rpo-xp-eq-op {
  display: flex; align-items: center; justify-content: center;
  font-size: 18px; font-weight: 700; color: #94a3b8;
  flex: 0 0 auto; padding: 0 2px;
}

.rpo-xp-note {
  padding: 9px 12px;
  background: #eef2ff;
  border: 1px solid #c7d2fe;
  border-radius: 8px;
  font-size: 12px;
  color: #1e1b4b;
  line-height: 1.55;
  display: flex; align-items: flex-start; gap: 8px;
}
.rpo-xp-note code {
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  background: #ffffff;
  padding: 1px 6px;
  border-radius: 4px;
  border: 1px solid #c7d2fe;
  font-size: 11px;
  font-weight: 700;
  color: #4338ca;
}

/* --- Meta grid --- */
.rpo-xp-meta-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 8px;
}
.rpo-xp-meta-item {
  padding: 9px 12px;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  display: flex; flex-direction: column; gap: 3px;
  min-width: 0;
}
.rpo-xp-meta-label {
  font-size: 10px; font-weight: 700; color: #64748b;
  text-transform: uppercase; letter-spacing: 0.06em;
}
.rpo-xp-meta-value {
  font-size: 13px; font-weight: 600; color: #0f172a;
  word-break: break-word;
}
.rpo-xp-meta-value--mono {
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
}
.rpo-xp-meta-value--rose { color: #be123c; }

/* --- Damage reason --- */
.rpo-xp-damage {
  padding: 12px 14px;
  background: #fffbeb;
  border: 1px solid #fde68a;
  border-radius: 10px;
}
.rpo-xp-damage-title {
  font-size: 10.5px; font-weight: 800; color: #92400e;
  text-transform: uppercase; letter-spacing: 0.06em;
  margin-bottom: 6px;
}
.rpo-xp-damage-body {
  font-size: 13px; color: #78350f;
  line-height: 1.55;
  word-break: break-word;
  white-space: pre-wrap;
}

/* ---- Pagination ---- */
.rpo-pagination {
  display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between;
  gap: 12px; padding: 14px 16px; margin-top: 16px;
  background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px;
}
.rpo-pagination-info { font-size: 13px; color: #475569; }
.rpo-pagination-controls { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.rpo-page-btn {
  padding: 8px 14px; font-size: 13px; font-weight: 600;
  border-radius: 8px; cursor: pointer;
  border: 1px solid #cbd5e1; background: #ffffff; color: #334155;
  font-family: inherit;
  transition: background 0.15s ease, border-color 0.15s ease;
}
.rpo-page-btn:hover:not(:disabled) { background: #f1f5f9; border-color: #94a3b8; }
.rpo-page-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.rpo-page-label {
  font-size: 13px; color: #334155; padding: 0 8px;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
}

/* ============================================================
   Responsive
   ============================================================ */
@media (max-width: 900px) {
  .rpo-table { min-width: 900px; }
  .rpo-group-head-right { gap: 10px; }
  .rpo-xp { padding: 16px 18px 18px 40px; }
}

@media (max-width: 720px) {
  .rpo-header { flex-direction: column; align-items: stretch !important; }
  .rpo-header-actions { justify-content: stretch; }
  .rpo-header-actions > * { flex: 1 1 auto; }
  .rpo-export-btn, .rpo-refresh-btn { width: 100%; justify-content: center; }

  .rpo-filters { gap: 10px; }
  .rpo-filter-group { flex: 1 1 100%; }
  .rpo-filter-group--toggle { flex: 1 1 100%; min-width: 0; }
  .rpo-filter-actions { margin-left: 0; width: 100%; }
  .rpo-filter-btn { width: 100%; }

  .rpo-group-head { flex-direction: column; align-items: flex-start; gap: 8px; }
  .rpo-group-head-right { gap: 10px; flex-wrap: wrap; }

  .rpo-pagination { flex-direction: column; align-items: stretch; }
  .rpo-pagination-controls { justify-content: center; }

  .rpo-trend-head { flex-direction: column; align-items: stretch; }
  .rpo-trend-total { text-align: left; }

  .rpo-xp { padding: 14px 14px 16px 14px; gap: 14px; }
  .rpo-xp-eq-row { flex-direction: column; }
  .rpo-xp-eq-op { padding: 2px 0; }
  .rpo-xp-eq-box { flex: 1 1 auto; }
}

@media (max-width: 640px) {
  /* Hide the vendor column on very small screens to reduce scroll */
  .rpo-th--vendor,
  .rpo-td--vendor { display: none; }
  .rpo-table { min-width: 720px; }
}

@media (max-width: 480px) {
  .rpo-kpi { padding: 12px; gap: 10px; }
  .rpo-kpi-icon { width: 36px; height: 36px; font-size: 18px; }
  .rpo-kpi-value { font-size: 16px; }
  .rpo-kpi-label { font-size: 9px; }

  .rpo-wh-chip { font-size: 11px; }
  .rpo-wh-chip-stats { display: none; }

  .rpo-xp-hero { flex-direction: column; align-items: flex-start; text-align: left; }
  .rpo-xp-qty-grid { grid-template-columns: repeat(2, 1fr); }
}

@media (max-width: 380px) {
  .rpo-xp-qty-grid { grid-template-columns: 1fr; }
  .rpo-received-sub { font-size: 10px; }
  .rpo-item-name { max-width: 140px; }
}

@media (prefers-reduced-motion: reduce) {
  .rpo-refresh-btn, .rpo-wh-chip, .rpo-page-btn, .rpo-export-btn,
  .rpo-row, .rpo-toggle-track, .rpo-toggle-thumb, .rpo-quick-chip,
  .rpo-caret, .rpo-xp { transition: none !important; animation: none !important; }
  .icon-spin { animation: none !important; }
}
`;

export default TabReceivedPOs;