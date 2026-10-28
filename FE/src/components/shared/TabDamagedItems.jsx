// src/components/shared/TabDamagedItems.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  FiAlertTriangle,
  FiCheckCircle,
  FiX,
  FiLock,
  FiRefreshCw,
  FiClipboard,
  FiPackage,
  FiTrendingDown,
  FiHome,
  FiDownload,
  FiChevronDown,
  FiTarget,
  FiFolder,
  FiImage,
  FiMapPin,
  FiUser,
} from 'react-icons/fi';
import {
  damagedItemsApi,
  warehouseApi,
  itemMasterApi,
} from '../../services/api';
import { usePermissions } from '../../permissions/usePermissions';
import { getUser } from '../../secure/auth';
import ItemImageThumb from './ItemImageThumb';

const PAGE_SIZE = 50;
const TREND_DAYS = 30;

const SOURCE_OPTIONS = [
  { value: 'All',    label: 'All Records',       hint: 'Every damage event — PO, STS, and adjustments.' },
  { value: 'PO',     label: 'Purchase Order',    hint: 'Recorded against a PO line at store.' },
  { value: 'STS',    label: 'Stock Transfer',    hint: 'Recorded against a Stock Transfer Slip at receive.' },
  { value: 'ADJUST', label: 'Manual Adjustment', hint: 'Logged outside the PO / STS flow.' },
];

const fmtMoney = (n, cur = 'PHP') => {
  const v = Number(n) || 0;
  return `${cur} ${v.toLocaleString(undefined, {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })}`;
};

const fmtNum = (n, decimals = 2) => {
  const v = Number(n) || 0;
  return v.toLocaleString(undefined, {
    minimumFractionDigits: decimals, maximumFractionDigits: decimals,
  });
};

const fmtDateTime = (v) => {
  if (!v) return '—';
  try { return new Date(v).toLocaleString(); } catch { return v; }
};

const fmtDate = (v) => {
  if (!v) return '—';
  const m = String(v).match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) {
    const [y, mo, d] = m[1].split('-').map(Number);
    try {
      return new Date(y, mo - 1, d).toLocaleDateString(undefined, {
        year: 'numeric', month: 'short', day: 'numeric',
      });
    } catch { return m[1]; }
  }
  try {
    return new Date(v).toLocaleDateString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
    });
  } catch { return v; }
};

const formatLocalDate = (d) => {
  const y   = d.getFullYear();
  const mo  = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${day}`;
};

const sourceBadgeClass = (t) => {
  if (t === 'PO')     return 'di-source di-source--po';
  if (t === 'STS')    return 'di-source di-source--sts';
  if (t === 'ADJUST') return 'di-source di-source--adjust';
  return 'di-source';
};

const todayIso = () => formatLocalDate(new Date());

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
  return formatLocalDate(new Date(d.getFullYear(), d.getMonth(), 1));
};

const daysAgoIso = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return formatLocalDate(d);
};

/* ============================================================
   Sub-component: DamageSourceSidebar
   ============================================================ */
const DamageSourceSidebar = ({ value, counts, onChange }) => (
  <aside className="di-sidebar" aria-label="Damage source">
    <div className="di-sidebar-head">
      <div className="di-sidebar-title">
        <span className="di-sidebar-dot" aria-hidden="true" />
        <span>Damage Source</span>
      </div>
      <p className="di-sidebar-subtitle">
        Filter by where the damage was recorded.
      </p>
    </div>

    <nav className="di-sidebar-nav">
      {SOURCE_OPTIONS.map((opt) => {
        const isActive = value === opt.value;
        const n        = counts[opt.value];
        const showN    = typeof n === 'number' && n > 0;

        return (
          <button
            key={opt.value}
            type="button"
            className={`di-side-btn${isActive ? ' is-active' : ''}`}
            onClick={() => onChange(opt.value)}
            aria-pressed={isActive}
          >
            <span className="di-side-rail" aria-hidden="true" />
            <span className="di-side-body">
              <span className="di-side-row">
                <span className="di-side-label">{opt.label}</span>
                {showN && <span className="di-side-count">{n}</span>}
              </span>
              <span className="di-side-hint">{opt.hint}</span>
            </span>
          </button>
        );
      })}
    </nav>
  </aside>
);

/* ============================================================
   Sub-component: TrendSparkline
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

  const areaPath =
    `${linePath} L ${W - PAD_X} ${H - PAD_Y} L ${PAD_X} ${H - PAD_Y} Z`;

  const firstDay = points[0].day;
  const lastDay = points[points.length - 1].day;
  const peak = points.reduce((a, b) => (b.v > a.v ? b : a), points[0]);

  return (
    <div className="di-trend-chart">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        style={{ width: '100%', height, display: 'block' }}
      >
        <defs>
          <linearGradient id="di-trend-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#00b8b0" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#00b8b0" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="di-trend-stroke" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#00e0d4" />
            <stop offset="100%" stopColor="#008a82" />
          </linearGradient>
        </defs>

        <path d={areaPath} fill="url(#di-trend-fill)" />
        <path
          d={linePath}
          fill="none"
          stroke="url(#di-trend-stroke)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />

        <circle
          cx={PAD_X + points.indexOf(peak) * stepX}
          cy={yFor(peak.v)}
          r="4"
          fill="#008a82"
          stroke="#ffffff"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
      </svg>

      <div className="di-trend-footer">
        <span className="di-trend-date">{fmtDate(firstDay)}</span>
        <span className="di-trend-peak">
          Peak: <strong>{fmtMoney(peak.v)}</strong> on {fmtDate(peak.day)}
        </span>
        <span className="di-trend-date">{fmtDate(lastDay)}</span>
      </div>
    </div>
  );
};

/* ============================================================
   Sub-component: DamageDetailModal
   ============================================================ */
const DamageDetailModal = ({ row, images, onClose }) => {
  if (!row) return null;

  const unitCost = Number(row.unit_cost) || 0;
  const qty = Number(row.qty) || 0;
  const totalValue = Number(row.total_value) || 0;
  const currency = row.currency || 'PHP';
  const imageSrc = images[row.item_code] || null;

  const sourceLabel =
    row.source_type === 'PO'
      ? 'Purchase Order'
      : row.source_type === 'STS'
        ? 'Stock Transfer Slip'
        : row.source_type === 'ADJUST'
          ? 'Manual Adjustment'
          : row.source_type;

  return (
    <div
      className="di-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="di-detail-title"
      onClick={onClose}
    >
      <div className="di-modal" onClick={(e) => e.stopPropagation()}>
        <div className="di-modal-head">
          <div className="di-modal-head-left">
            <div className="di-modal-icon"><FiAlertTriangle aria-hidden="true" /></div>
            <div>
              <h3 id="di-detail-title" className="di-modal-title">
                Damage Record #{row.writeoff_id}
              </h3>
              <div className="di-modal-sub">
                <span className={sourceBadgeClass(row.source_type)}>
                  {row.source_type}
                </span>
                <span className="di-modal-dot">·</span>
                <span>{sourceLabel}</span>
              </div>
            </div>
          </div>
          <button
            type="button"
            className="di-modal-close"
            onClick={onClose}
            aria-label="Close"
          >
            <FiX aria-hidden="true" />
          </button>
        </div>

        <div className="di-modal-body">
          <div className="di-modal-hero">
            <div className="di-modal-hero-img">
              <ItemImageThumb src={imageSrc} alt={row.item_code} size={96} />
            </div>
            <div className="di-modal-hero-info">
              <div className="di-modal-item-code">{row.item_code}</div>
              <div className="di-modal-item-name">{row.item_name || '—'}</div>
            </div>
          </div>

          <div className="di-modal-values">
            <div className="di-modal-value-box">
              <div className="di-modal-value-label">Quantity</div>
              <div className="di-modal-value-num">{fmtNum(qty, 0)}</div>
            </div>
            <div className="di-modal-value-op">×</div>
            <div className="di-modal-value-box">
              <div className="di-modal-value-label">Unit Cost</div>
              <div className="di-modal-value-num">
                {fmtMoney(unitCost, currency)}
              </div>
            </div>
            <div className="di-modal-value-op">=</div>
            <div className="di-modal-value-box di-modal-value-box--total">
              <div className="di-modal-value-label">Total Lost</div>
              <div className="di-modal-value-num">
                {fmtMoney(totalValue, currency)}
              </div>
            </div>
          </div>

          <div className="di-modal-meta">
            <div className="di-modal-meta-row">
              <span className="di-modal-meta-label">Source Reference</span>
              <span className="di-modal-meta-value di-modal-meta-value--mono">
                {row.source_ref || '—'}
              </span>
            </div>
            <div className="di-modal-meta-row">
              <span className="di-modal-meta-label">Warehouse</span>
              <span className="di-modal-meta-value">
                <span className="di-wh-inline-code">{row.warehouse_code || '—'}</span>
                {row.warehouse_name && (
                  <span className="di-wh-inline-name">{row.warehouse_name}</span>
                )}
              </span>
            </div>
            <div className="di-modal-meta-row">
              <span className="di-modal-meta-label">Locator</span>
              <span className="di-modal-meta-value di-modal-meta-value--mono">
                {row.locator_code || '—'}
              </span>
            </div>
            <div className="di-modal-meta-row">
              <span className="di-modal-meta-label">Recorded At</span>
              <span className="di-modal-meta-value">
                {fmtDateTime(row.acted_at)}
              </span>
            </div>
            <div className="di-modal-meta-row">
              <span className="di-modal-meta-label">Recorded By</span>
              <span className="di-modal-meta-value">
                {row.actor || '—'}
              </span>
            </div>
            <div className="di-modal-meta-row">
              <span className="di-modal-meta-label">Currency</span>
              <span className="di-modal-meta-value di-modal-meta-value--mono">
                {currency}
              </span>
            </div>
          </div>

          {row.reason && (
            <div className="di-modal-reason">
              <div className="di-modal-meta-label">Reason</div>
              <div className="di-modal-reason-body">{row.reason}</div>
            </div>
          )}
        </div>

        <div className="di-modal-foot">
          <button type="button" className="di-modal-foot-btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

/* ============================================================
   Sub-component: DamageMobileCard
   ============================================================ */
const DamageMobileCard = ({ row, imageSrc, onOpen }) => {
  const qty = Number(row.qty) || 0;
  const unitCost = Number(row.unit_cost) || 0;
  const total = Number(row.total_value) || 0;

  return (
    <button
      type="button"
      className="di-mob-card"
      onClick={onOpen}
      aria-label={`Damage record ${row.writeoff_id} for ${row.item_code}`}
    >
      <div className="di-mob-head">
        <span className={sourceBadgeClass(row.source_type)}>
          {row.source_type}
        </span>
        <span className="di-mob-date">{fmtDateTime(row.acted_at)}</span>
      </div>

      <div className="di-mob-item">
        <ItemImageThumb src={imageSrc} alt={row.item_code} size={44} />
        <div className="di-mob-item-info">
          <div className="di-mob-code">{row.item_code}</div>
          <div className="di-mob-name">{row.item_name || '—'}</div>
        </div>
      </div>

      <div className="di-mob-grid">
        <div className="di-mob-grid-cell">
          <span className="di-mob-grid-label">Qty</span>
          <span className="di-mob-grid-value">{fmtNum(qty, 0)}</span>
        </div>
        <div className="di-mob-grid-cell">
          <span className="di-mob-grid-label">Unit</span>
          <span className="di-mob-grid-value">{fmtNum(unitCost)}</span>
        </div>
        <div className="di-mob-grid-cell di-mob-grid-cell--total">
          <span className="di-mob-grid-label">Total</span>
          <span className="di-mob-grid-value">{fmtNum(total)}</span>
        </div>
      </div>

      <div className="di-mob-foot">
        {row.locator_code && (
          <span className="di-mob-loc" title="Locator">
            <FiMapPin className="di-inline-icon" aria-hidden="true" />
            <span>{row.locator_code}</span>
          </span>
        )}
        {row.actor && (
          <span className="di-mob-actor" title="Recorded by">
            <FiUser className="di-inline-icon" aria-hidden="true" />
            <span>{row.actor}</span>
          </span>
        )}
      </div>

      {row.reason && (
        <div className="di-mob-reason" title={row.reason}>
          {row.reason}
        </div>
      )}
    </button>
  );
};

/* ============================================================
   Main component
   ============================================================ */
const TabDamagedItems = () => {
  const { role } = usePermissions();
  const currentUser = getUser();
  const isGlobalViewer = role === 'Super Admin' || role === 'Admin';
  const userWarehouseId = currentUser?.warehouse_assigned || null;
  const userWarehouseCode = currentUser?.warehouse_code || null;

  const [rows, setRows]                 = useState([]);
  const [warehouses, setWarehouses]     = useState([]);
  const [totals, setTotals]             = useState({ writeoff_count: 0, total_qty: 0, total_value: 0 });
  const [sourceCounts, setSourceCounts] = useState([]);
  const [total, setTotal]               = useState(0);
  const [totalPages, setTotalPages]     = useState(1);
  const [page, setPage]                 = useState(1);

  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState('');

  const [images, setImages]             = useState({});

  const [trendData, setTrendData]       = useState([]);
  const [trendLoading, setTrendLoading] = useState(false);

  const [detailRow, setDetailRow]       = useState(null);

  const [startDate, setStartDate]       = useState('');
  const [endDate, setEndDate]           = useState('');
  const [warehouseFilter, setWarehouseFilter] = useState(
    isGlobalViewer ? '' : (userWarehouseId || '')
  );
  const [itemSearch, setItemSearch]     = useState('');
  const [sourceType, setSourceType]     = useState('All');

  const [allWarehouses, setAllWarehouses] = useState([]);
  const [showOnlyWithDamage, setShowOnlyWithDamage] = useState(true);

  const [exportOpen, setExportOpen] = useState(false);
  const exportMenuRef = useRef(null);

  useEffect(() => {
    if (!isGlobalViewer) return;
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
  }, [isGlobalViewer]);

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

  useEffect(() => {
    if (!detailRow) return;
    const onKey = (e) => { if (e.key === 'Escape') setDetailRow(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [detailRow]);

  const buildQuery = useCallback(({ forExport = false, pageOverride } = {}) => {
    const scopeWarehouse = isGlobalViewer ? (warehouseFilter || null) : null;
    return {
      start_date:   startDate || undefined,
      end_date:     endDate   || undefined,
      warehouse_id: scopeWarehouse || undefined,
      item_code:    itemSearch.trim() || undefined,
      source_type:  sourceType !== 'All' ? sourceType : undefined,
      page:         pageOverride ?? page,
      limit:        forExport ? 10000 : PAGE_SIZE,
    };
  }, [isGlobalViewer, warehouseFilter, startDate, endDate, itemSearch, sourceType, page]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await damagedItemsApi.list(buildQuery());
      if (!res.ok) {
        setError(res.data?.message || 'Could not load damage report.');
        setRows([]);
        setWarehouses([]);
        setSourceCounts([]);
        setTotals({ writeoff_count: 0, total_qty: 0, total_value: 0 });
        setTotal(0);
        setTotalPages(1);
        return;
      }
      setRows(Array.isArray(res.data) ? res.data : []);
      setWarehouses(Array.isArray(res.warehouses) ? res.warehouses : []);
      setSourceCounts(Array.isArray(res.source_counts) ? res.source_counts : []);
      setTotals(res.totals || { writeoff_count: 0, total_qty: 0, total_value: 0 });
      setTotal(Number(res.total) || 0);
      setTotalPages(Number(res.totalPages) || 1);
    } catch (err) {
      console.error(err);
      setError('Unexpected error while loading damage report.');
    } finally {
      setLoading(false);
    }
  }, [buildQuery]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    setPage(1);
  }, [startDate, endDate, warehouseFilter, itemSearch, sourceType]);

  const loadTrend = useCallback(async () => {
    setTrendLoading(true);
    try {
      const q = buildQuery();
      const res = await damagedItemsApi.trend({
        start_date:   q.start_date,
        end_date:     q.end_date,
        warehouse_id: q.warehouse_id,
        item_code:    q.item_code,
        source_type:  q.source_type,
        days:         TREND_DAYS,
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
        console.warn('Could not load damaged-item images:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [rows]);

  const warehouseOptions = useMemo(() => {
    const damageMap = new Map();
    for (const w of warehouses) {
      damageMap.set(w.warehouse_code, {
        writeoff_count: Number(w.writeoff_count) || 0,
        total_qty:      Number(w.total_qty)      || 0,
        total_value:    Number(w.total_value)    || 0,
      });
    }

    const merged = allWarehouses.map((w) => ({
      warehouse_id:   w.warehouse_id,
      warehouse_code: w.warehouse_code,
      warehouse_name: w.warehouse_name,
      damage: damageMap.get(w.warehouse_code) || {
        writeoff_count: 0, total_qty: 0, total_value: 0,
      },
    }));

    const filtered = showOnlyWithDamage
      ? merged.filter((w) => w.damage.writeoff_count > 0)
      : merged;

    return filtered.sort((a, b) => {
      const diff = b.damage.writeoff_count - a.damage.writeoff_count;
      if (diff !== 0) return diff;
      return String(a.warehouse_code).localeCompare(String(b.warehouse_code));
    });
  }, [allWarehouses, warehouses, showOnlyWithDamage]);

  const sourceCountMap = useMemo(() => {
    const m = { All: 0, PO: 0, STS: 0, ADJUST: 0 };
    for (const r of sourceCounts) {
      const key = String(r.source_type || '').toUpperCase();
      const n = Number(r.event_count) || 0;
      if (key in m) m[key] = n;
      m.All += n;
    }
    return m;
  }, [sourceCounts]);

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
      const summary = warehouses.find(
        (w) => w.warehouse_code === group.warehouse_code
      );
      if (summary?.warehouse_name) group.warehouse_name = summary.warehouse_name;
      group.summary = summary || {
        warehouse_name: group.warehouse_name,
        writeoff_count: group.rows.length,
        total_qty: group.rows.reduce((s, r) => s + (Number(r.qty) || 0), 0),
        total_value: group.rows.reduce((s, r) => s + (Number(r.total_value) || 0), 0),
      };
    }
    return [...map.values()].sort((a, b) =>
      String(a.warehouse_code).localeCompare(String(b.warehouse_code))
    );
  }, [rows, warehouses]);

  const kpis = useMemo(() => ([
    { key: 'count', label: 'Damage Records', value: totals.writeoff_count ?? 0, Icon: FiClipboard, tone: 'slate' },
    { key: 'qty',   label: 'Damaged Qty',    value: fmtNum(totals.total_qty ?? 0), Icon: FiPackage, tone: 'amber' },
    { key: 'value', label: 'Value Lost',     value: fmtMoney(totals.total_value ?? 0), Icon: FiTrendingDown, tone: 'rose' },
    isGlobalViewer
      ? { key: 'wh', label: 'Warehouses Affected', value: warehouses.length,        Icon: FiHome, tone: 'cyan' }
      : { key: 'wh', label: 'Your Warehouse',      value: userWarehouseCode || '—', Icon: FiHome, tone: 'cyan' },
  ]), [totals, warehouses, isGlobalViewer, userWarehouseCode]);

  const gotoPage = (n) => {
    const clamped = Math.max(1, Math.min(totalPages, n));
    if (clamped !== page) setPage(clamped);
  };

  const firstItem = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const lastItem  = Math.min(total, page * PAGE_SIZE);

  const exportExcel = async (scope) => {
    setExportOpen(false);
    try {
      const query = scope === 'all'
        ? { page: 1, limit: 10000 }
        : buildQuery({ forExport: true, pageOverride: 1 });

      const res = await damagedItemsApi.list(query);
      if (!res.ok) {
        alert(res.data?.message || 'Export failed.');
        return;
      }
      const data = (res.data || []).map((r) => ({
        'Date':          fmtDateTime(r.acted_at),
        'Source Type':   r.source_type,
        'Source Ref':    r.source_ref || '',
        'Warehouse Code': r.warehouse_code,
        'Warehouse Name': r.warehouse_name || '',
        'Locator':       r.locator_code || '',
        'Item Code':     r.item_code,
        'Item Name':     r.item_name || '',
        'Qty':           Number(r.qty) || 0,
        'Unit Cost':     Number(r.unit_cost) || 0,
        'Total Value':   Number(r.total_value) || 0,
        'Currency':      r.currency || '',
        'Reason':        r.reason || '',
        'Recorded By':   r.actor,
      }));

      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Damage Records');

      const suffix = scope === 'all' ? 'all' : 'filtered';
      const filename = `damage-report-${suffix}-${todayIso()}.xlsx`;
      XLSX.writeFile(wb, filename);
    } catch (err) {
      console.error(err);
      alert(err.message || 'Export failed.');
    }
  };

  const exportImage = (scope) => {
    setExportOpen(false);

    const W = 1000;
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
    ctx.fillText('Damaged Items — Central Registry', 40, 50);

    ctx.fillStyle = '#64748b';
    ctx.font = '13px Inter, -apple-system, Segoe UI, sans-serif';
    const rangeLabel = (startDate || endDate)
      ? `Range: ${startDate || '—'} → ${endDate || '—'}`
      : 'Range: all time';
    const srcLabel = sourceType === 'All' ? 'All sources' : `Source: ${sourceType}`;
    ctx.fillText(`Generated ${new Date().toLocaleString()}  ·  ${rangeLabel}  ·  ${srcLabel}`, 40, 74);

    const kpiY = 96;
    const kpiW = (W - 80 - 3 * 12) / 4;
    const kpisForImage = [
      { label: 'Damage Records', value: String(totals.writeoff_count ?? 0), color: '#0f172a' },
      { label: 'Damaged Qty',    value: fmtNum(totals.total_qty ?? 0),       color: '#b45309' },
      { label: 'Value Lost',     value: fmtMoney(totals.total_value ?? 0),   color: '#be123c' },
      { label: 'Warehouses',     value: String(warehouses.length),           color: '#0e7490' },
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
    const colX = [40, 300, 420, 560, 660, 780, 900];

    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 14px Inter, -apple-system, Segoe UI, sans-serif';
    ctx.fillText('Damage Records', 40, y);
    y += 18;

    ctx.fillStyle = '#64748b';
    ctx.font = '11px Inter, -apple-system, Segoe UI, sans-serif';
    ctx.fillText('Date',       colX[0], y);
    ctx.fillText('Item',       colX[1], y);
    ctx.fillText('Warehouse',  colX[2], y);
    ctx.fillText('Locator',    colX[3], y);
    ctx.fillText('Qty',        colX[4], y);
    ctx.fillText('Unit Cost',  colX[5], y);
    ctx.fillText('Value',      colX[6], y);
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

      const subtotal = group.summary || { writeoff_count: 0, total_qty: 0, total_value: 0 };
      const subtotalText = `${subtotal.writeoff_count} record${subtotal.writeoff_count === 1 ? '' : 's'} · ${fmtNum(subtotal.total_qty)} qty · ${fmtMoney(subtotal.total_value)}`;

      ctx.fillStyle = '#475569';
      ctx.font = '11px Inter, -apple-system, Segoe UI, sans-serif';
      const tw = ctx.measureText(subtotalText).width;
      ctx.fillText(subtotalText, W - 40 - tw - 12, y + 18);

      y += GROUP_H;

      for (const r of group.rows) {
        ctx.fillStyle = '#0f172a';
        ctx.font = '12px Inter, -apple-system, Segoe UI, sans-serif';
        ctx.fillText(fmtDateTime(r.acted_at).split(',')[0], colX[0], y);
        ctx.fillText(r.item_code || '—', colX[1], y);
        ctx.fillText(r.warehouse_code || '—', colX[2], y);
        ctx.fillText(r.locator_code || '—', colX[3], y);

        ctx.textAlign = 'right';
        ctx.fillText(String(r.qty), colX[4] + 30, y);
        ctx.fillText(fmtNum(r.unit_cost, 2), colX[5] + 70, y);
        ctx.fillStyle = '#0f766e';
        ctx.fillText(fmtNum(r.total_value, 2), colX[6] + 70, y);
        ctx.textAlign = 'left';

        y += ROW_H;
        if (y > H - FOOTER_H - 20) break;
      }

      y += 6;
    }

    if (rows.length === 0) {
      ctx.fillStyle = '#94a3b8';
      ctx.font = '13px Inter, -apple-system, Segoe UI, sans-serif';
      ctx.fillText('No damaged items match the current filters.', 40, y + 24);
    }

    const footerY = H - FOOTER_H + 20;
    ctx.fillStyle = '#94a3b8';
    ctx.font = '11px Inter, -apple-system, Segoe UI, sans-serif';
    const scopeLabel = scope === 'all' ? 'All' : 'Filtered';
    ctx.fillText(
      `IMS · Damage Report · ${scopeLabel} view · Page ${page}/${totalPages} · ${firstItem}–${lastItem} of ${total}`,
      40, footerY
    );

    canvas.toBlob((blob) => {
      if (!blob) { alert('Could not generate image.'); return; }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `damage-report-${scope === 'all' ? 'all' : 'filtered'}-${todayIso()}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 'image/png');
  };

  const clearFilters = () => {
    setStartDate('');
    setEndDate('');
    if (isGlobalViewer) setWarehouseFilter('');
    setItemSearch('');
    setSourceType('All');
    setPage(1);
  };

  const hasActiveFilters =
    !!startDate || !!endDate || !!itemSearch || sourceType !== 'All' ||
    (isGlobalViewer && !!warehouseFilter);

  const applyRange = (days) => {
    setStartDate(daysAgoIso(days));
    setEndDate(todayIso());
  };

  const applyThisMonth = () => {
    setStartDate(startOfMonthIso());
    setEndDate(todayIso());
  };

  const applyAllTime = () => {
    setStartDate('');
    setEndDate('');
  };

  const handleSourceChange = (next) => {
    setSourceType(next);
    setPage(1);
  };

  return (
    <div className="items-section di-root">
      <style>{tabCss}</style>

      <div className="section-header di-header">
        <div className="di-header-left">
          <div className="di-header-title-row">
            <h3>
              <FiAlertTriangle className="di-heading-icon" aria-hidden="true" />
              <span>Damaged Items — Central Registry</span>
            </h3>
            {!isGlobalViewer && userWarehouseCode && (
              <span
                className="di-scope-pill"
                title="You are viewing only your assigned warehouse"
              >
                <FiLock className="di-scope-icon" aria-hidden="true" />
                <span>{userWarehouseCode}</span>
              </span>
            )}
          </div>
          <p className="di-header-sub">
            {isGlobalViewer
              ? 'Every damaged unit recorded anywhere in the pipeline — Purchase Orders, Stock Transfers, and manual adjustments. Grouped by warehouse.'
              : `Damaged units recorded at ${userWarehouseCode || 'your warehouse'}. Every damage record carries its cost basis so the money is never lost.`}
          </p>
        </div>

        <div className="di-header-actions">
          <div className="di-export-wrap" ref={exportMenuRef}>
            <button
              type="button"
              className="di-export-btn"
              onClick={() => setExportOpen((o) => !o)}
              disabled={loading}
            >
              <FiDownload className="di-btn-icon" aria-hidden="true" />
              <span>Export</span>
              <FiChevronDown className="di-export-caret-icon" aria-hidden="true" />
            </button>
            {exportOpen && (
              <div className="di-export-menu">
                <div className="di-export-menu-head">Excel (.xlsx)</div>
                <button
                  type="button"
                  className="di-export-item"
                  onClick={() => exportExcel('filtered')}
                  disabled={!hasActiveFilters}
                  title={hasActiveFilters ? '' : 'No filters applied — same as All'}
                >
                  <span className="di-export-item-title">
                    <FiTarget className="di-export-icon" aria-hidden="true" />
                    <span>Filtered result</span>
                  </span>
                  <span className="di-export-hint">
                    {hasActiveFilters ? 'Current filters applied' : 'No filters set'}
                  </span>
                </button>
                <button
                  type="button"
                  className="di-export-item"
                  onClick={() => exportExcel('all')}
                >
                  <span className="di-export-item-title">
                    <FiFolder className="di-export-icon" aria-hidden="true" />
                    <span>{isGlobalViewer ? 'All records' : 'All my warehouse records'}</span>
                  </span>
                  <span className="di-export-hint">
                    {isGlobalViewer ? 'Ignores filters' : 'Your warehouse only'}
                  </span>
                </button>

                <div className="di-export-menu-head di-export-menu-head--mt">Image (.png)</div>
                <button
                  type="button"
                  className="di-export-item"
                  onClick={() => exportImage('filtered')}
                >
                  <span className="di-export-item-title">
                    <FiImage className="di-export-icon" aria-hidden="true" />
                    <span>Current view snapshot</span>
                  </span>
                </button>
              </div>
            )}
          </div>

          <button
            type="button"
            className="di-refresh-btn"
            onClick={load}
            disabled={loading}
          >
            <FiRefreshCw className={`di-btn-icon${loading ? ' icon-spin' : ''}`} aria-hidden="true" />
            <span>{loading ? 'Loading…' : 'Refresh'}</span>
          </button>
        </div>
      </div>

      <div className="di-layout">
        <DamageSourceSidebar
          value={sourceType}
          counts={sourceCountMap}
          onChange={handleSourceChange}
        />

        <div className="di-main">
          <div className="di-kpi-row">
            {kpis.map((k) => {
              const Icon = k.Icon;
              return (
                <div key={k.key} className={`di-kpi di-kpi--${k.tone}`}>
                  <div className="di-kpi-icon"><Icon aria-hidden="true" /></div>
                  <div className="di-kpi-body">
                    <div className="di-kpi-label">{k.label}</div>
                    <div className="di-kpi-value">{k.value}</div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="di-trend-card">
            <div className="di-trend-head">
              <div>
                <div className="di-trend-title">Damage Trend</div>
                <div className="di-trend-sub">
                  {startDate || endDate
                    ? `Filtered · ${startDate || '—'} → ${endDate || '—'}`
                    : `Last ${TREND_DAYS} days`}
                  {sourceType !== 'All' && <> · Source: {sourceType}</>}
                </div>
              </div>
              <div className="di-trend-total">
                <div className="di-trend-total-label">Period Total</div>
                <div className="di-trend-total-value">
                  {fmtMoney(totals.total_value ?? 0)}
                </div>
              </div>
            </div>
            {trendLoading ? (
              <div className="di-trend-loading">Loading trend…</div>
            ) : trendData.length < 2 ? (
              <div className="di-trend-empty">
                Not enough data yet to plot a trend.
              </div>
            ) : (
              <TrendSparkline data={trendData} metric="total_value" height={100} />
            )}
          </div>

          <div className="di-quick-ranges">
            <span className="di-quick-ranges-label">Quick range:</span>
            <button type="button" className="di-quick-chip" onClick={() => applyRange(0)}>Today</button>
            <button type="button" className="di-quick-chip" onClick={() => applyRange(7)}>Last 7 days</button>
            <button type="button" className="di-quick-chip" onClick={() => applyRange(30)}>Last 30 days</button>
            <button type="button" className="di-quick-chip" onClick={applyThisMonth}>This month</button>
            <button type="button" className="di-quick-chip" onClick={applyAllTime}>All time</button>
          </div>

          <div className="di-filters">
            <div className="di-filter-group">
              <label className="di-filter-label">Start Date</label>
              <input
                type="date"
                className="di-filter-input"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="di-filter-group">
              <label className="di-filter-label">End Date</label>
              <input
                type="date"
                className="di-filter-input"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>

            {isGlobalViewer && (
              <div className="di-filter-group di-filter-group--wide">
                <label className="di-filter-label">Warehouse</label>
                <select
                  className="di-filter-input"
                  value={warehouseFilter}
                  onChange={(e) => setWarehouseFilter(e.target.value)}
                >
                  <option value="">All warehouses</option>
                  {warehouseOptions.map((w) => (
                    <option
                      key={w.warehouse_id ?? w.warehouse_code}
                      value={w.warehouse_id ?? ''}
                    >
                      {w.warehouse_code} — {w.warehouse_name || ''}
                      {w.damage.writeoff_count > 0
                        ? ` (${w.damage.writeoff_count})`
                        : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="di-filter-group di-filter-group--grow">
              <label className="di-filter-label">Search Item</label>
              <input
                type="text"
                className="di-filter-input"
                placeholder="Item code or description…"
                value={itemSearch}
                onChange={(e) => setItemSearch(e.target.value)}
              />
            </div>

            {isGlobalViewer && (
              <div className="di-filter-group di-filter-group--toggle">
                <label className="di-filter-label">&nbsp;</label>
                <label
                  className="di-toggle"
                  title="Hide warehouses with zero damage records"
                >
                  <input
                    type="checkbox"
                    checked={showOnlyWithDamage}
                    onChange={(e) => setShowOnlyWithDamage(e.target.checked)}
                  />
                  <span className="di-toggle-track" aria-hidden="true">
                    <span className="di-toggle-thumb" />
                  </span>
                  <span className="di-toggle-text">
                    Only warehouses with damage
                  </span>
                </label>
              </div>
            )}

            <div className="di-filter-actions">
              <button
                type="button"
                className="cancel-btn di-filter-btn"
                onClick={clearFilters}
                disabled={!hasActiveFilters}
              >
                Clear Filters
              </button>
            </div>
          </div>

          {warehouses.length > 0 && (
            <div className="di-wh-chips">
              <span className="di-wh-chips-label">By warehouse:</span>
              {warehouses.map((w) => {
                const matchedWh = allWarehouses.find(
                  (x) => x.warehouse_code === w.warehouse_code
                );
                const isActive =
                  isGlobalViewer &&
                  matchedWh &&
                  String(warehouseFilter) === String(matchedWh.warehouse_id);

                return (
                  <button
                    key={w.warehouse_code}
                    type="button"
                    className={`di-wh-chip${isActive ? ' is-active' : ''}`}
                    onClick={() => {
                      if (!isGlobalViewer) return;
                      if (!matchedWh) return;
                      setWarehouseFilter(String(matchedWh.warehouse_id));
                    }}
                    disabled={!isGlobalViewer || !matchedWh}
                    title={w.warehouse_name || w.warehouse_code}
                  >
                    <span className="di-wh-chip-top">
                      <span className="di-wh-chip-code">{w.warehouse_code}</span>
                      {w.warehouse_name && (
                        <span className="di-wh-chip-name">{w.warehouse_name}</span>
                      )}
                    </span>
                    <span className="di-wh-chip-stats">
                      {w.writeoff_count} · {fmtNum(w.total_qty)} qty · {fmtMoney(w.total_value)}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {error && (
            <div className="di-error">
              <FiAlertTriangle className="di-error-icon" aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}

          <div className="daily-items-section di-table-section">
            <div className="daily-items-header">
              <h4>Damage Records</h4>
              <span className="daily-items-count">
                {total === 0
                  ? '0 records'
                  : `Showing ${firstItem}–${lastItem} of ${total}`}
              </span>
            </div>

            {loading ? (
              <div className="loading-spinner" style={{ margin: '32px auto' }} />
            ) : groupedRows.length === 0 ? (
              <div className="di-empty">
                <div className="di-empty-icon"><FiCheckCircle aria-hidden="true" /></div>
                <div className="di-empty-title">No damaged items</div>
                <div className="di-empty-sub">
                  {hasActiveFilters
                    ? 'No damage records match the current filters.'
                    : isGlobalViewer
                      ? 'Nothing has been damaged yet — clean record.'
                      : `Nothing has been damaged at ${userWarehouseCode || 'your warehouse'} — clean record.`}
                </div>
              </div>
            ) : (
              <div className="di-groups">
                {groupedRows.map((group) => (
                  <div key={group.warehouse_code} className="di-group">
                    <div className="di-group-head">
                      <div className="di-group-head-left">
                        <span className="di-group-icon"><FiHome aria-hidden="true" /></span>
                        <span className="di-group-code">{group.warehouse_code}</span>
                        {group.warehouse_name && (
                          <span className="di-group-name">{group.warehouse_name}</span>
                        )}
                        <span className="di-group-count">
                          {group.rows.length} on this page
                        </span>
                      </div>
                      <div className="di-group-head-right">
                        <span className="di-group-stat">
                          <strong>{group.summary?.writeoff_count ?? 0}</strong> records
                        </span>
                        <span className="di-group-stat">
                          <strong>{fmtNum(group.summary?.total_qty ?? 0)}</strong> qty
                        </span>
                        <span className="di-group-stat di-group-stat--value">
                          <strong>{fmtMoney(group.summary?.total_value ?? 0)}</strong>
                        </span>
                      </div>
                    </div>

                    <div className="di-table-wrap di-desktop-only">
                      <table className="di-table">
                        <thead>
                          <tr>
                            <th className="di-th di-th--date">Date</th>
                            <th className="di-th di-th--source">Source</th>
                            <th className="di-th di-th--item">Item</th>
                            <th className="di-th di-th--locator">Locator</th>
                            <th className="di-th di-th--num">Qty</th>
                            <th className="di-th di-th--num">Unit Cost</th>
                            <th className="di-th di-th--num">Total</th>
                            <th className="di-th di-th--reason">Reason</th>
                            <th className="di-th di-th--actor">Recorded By</th>
                          </tr>
                        </thead>
                        <tbody>
                          {group.rows.map((r) => (
                            <tr
                              key={r.writeoff_id}
                              className="di-row"
                              onClick={() => setDetailRow(r)}
                              title="Click for full details"
                            >
                              <td className="di-td di-td--date">{fmtDateTime(r.acted_at)}</td>
                              <td className="di-td">
                                <span className={sourceBadgeClass(r.source_type)}>
                                  {r.source_type}
                                </span>
                                {r.source_ref && (
                                  <div className="di-source-ref" title={r.source_ref}>
                                    {r.source_ref}
                                  </div>
                                )}
                              </td>
                              <td className="di-td di-td--item">
                                <div className="di-item-cell">
                                  <ItemImageThumb
                                    src={images[r.item_code] || null}
                                    alt={r.item_code}
                                    size={32}
                                  />
                                  <div className="di-item-info">
                                    <div className="di-item-code">{r.item_code}</div>
                                    <div className="di-item-name" title={r.item_name}>
                                      {r.item_name || '—'}
                                    </div>
                                  </div>
                                </div>
                              </td>
                              <td className="di-td di-td--mono">{r.locator_code || '—'}</td>
                              <td className="di-td di-td--num">{fmtNum(r.qty, 0)}</td>
                              <td className="di-td di-td--num">{fmtNum(r.unit_cost)}</td>
                              <td className="di-td di-td--num di-td--value">
                                {fmtNum(r.total_value)}
                              </td>
                              <td className="di-td di-td--reason" title={r.reason || ''}>
                                {r.reason || '—'}
                              </td>
                              <td className="di-td di-td--actor">{r.actor || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="di-mobile-cards di-mobile-only">
                      {group.rows.map((r) => (
                        <DamageMobileCard
                          key={r.writeoff_id}
                          row={r}
                          imageSrc={images[r.item_code] || null}
                          onOpen={() => setDetailRow(r)}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {totalPages > 1 && (
              <div className="di-pagination">
                <div className="di-pagination-info">
                  Showing <strong>{firstItem}–{lastItem}</strong> of <strong>{total}</strong>
                </div>
                <div className="di-pagination-controls">
                  <button type="button" className="di-page-btn" onClick={() => gotoPage(1)} disabled={page <= 1}>« First</button>
                  <button type="button" className="di-page-btn" onClick={() => gotoPage(page - 1)} disabled={page <= 1}>‹ Prev</button>
                  <span className="di-page-label">
                    Page <strong>{page}</strong> of <strong>{totalPages}</strong>
                  </span>
                  <button type="button" className="di-page-btn" onClick={() => gotoPage(page + 1)} disabled={page >= totalPages}>Next ›</button>
                  <button type="button" className="di-page-btn" onClick={() => gotoPage(totalPages)} disabled={page >= totalPages}>Last »</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {detailRow && (
        <DamageDetailModal
          row={detailRow}
          images={images}
          onClose={() => setDetailRow(null)}
        />
      )}
    </div>
  );
};

/* ============================================================
   CSS
   ============================================================ */
const tabCss = `
.di-root { font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }

/* ---- Feather helpers ---- */
.di-heading-icon { width: 1.05em; height: 1.05em; flex-shrink: 0; margin-right: 8px; color: #b45309; stroke-width: 2.2; vertical-align: -0.15em; }
.di-btn-icon { width: 1em; height: 1em; flex-shrink: 0; stroke-width: 2.4; }
.di-export-caret-icon { width: 0.85em; height: 0.85em; flex-shrink: 0; stroke-width: 2.5; color: #94a3b8; }
.di-export-icon { width: 1.05em; height: 1.05em; flex-shrink: 0; stroke-width: 2.3; color: #0f766e; }
.di-scope-icon { width: 1em; height: 1em; flex-shrink: 0; stroke-width: 2.4; }
.di-error-icon { width: 1.15em; height: 1.15em; flex-shrink: 0; stroke-width: 2.2; color: #991b1b; }
.di-inline-icon { width: 1em; height: 1em; flex-shrink: 0; stroke-width: 2.3; }
.di-kpi-icon svg,
.di-modal-icon svg,
.di-modal-close svg,
.di-group-icon svg,
.di-empty-icon svg {
  width: 1em;
  height: 1em;
  stroke-width: 2.2;
}
.di-empty-icon svg { width: 1.15em; height: 1.15em; stroke-width: 1.6; }

.icon-spin { animation: di-spin 0.9s linear infinite; }
@keyframes di-spin { to { transform: rotate(360deg); } }

.di-desktop-only { display: block; }
.di-mobile-only  { display: none; }

.di-layout {
  display: grid;
  grid-template-columns: 240px minmax(0, 1fr);
  gap: 20px;
  align-items: start;
  margin-top: 16px;
}
.di-main { min-width: 0; }

.di-sidebar {
  position: sticky;
  top: 16px;
  align-self: start;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 18px 14px 16px 22px;
  background: linear-gradient(180deg, #ffffff 0%, #f6fefd 100%);
  border: 1px solid #b8f1ea;
  border-radius: 14px;
  box-shadow:
    0 1px 2px rgba(15, 23, 42, 0.04),
    0 14px 32px -16px rgba(0, 184, 176, 0.35);
  overflow: hidden;
}
.di-sidebar::before {
  content: '';
  position: absolute;
  left: 0;
  top: 16px;
  bottom: 16px;
  width: 4px;
  background: linear-gradient(180deg, #00e0d4 0%, #008a82 100%);
  border-radius: 0 4px 4px 0;
  box-shadow: 0 0 14px rgba(0, 184, 176, 0.45);
  pointer-events: none;
}
.di-sidebar-head {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-bottom: 12px;
  border-bottom: 1px solid #ccfbf1;
  margin-bottom: 2px;
}
.di-sidebar-title {
  display: flex;
  align-items: center;
  gap: 9px;
  font-size: 11px;
  font-weight: 800;
  color: #0f766e;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  line-height: 1.2;
  margin: 0;
}
.di-sidebar-dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #00b8b0;
  flex-shrink: 0;
  animation: di-sidebar-pulse 2.4s ease-in-out infinite;
}
@keyframes di-sidebar-pulse {
  0%, 100% { box-shadow: 0 0 0 3px rgba(0, 184, 176, 0.22); }
  50%      { box-shadow: 0 0 0 8px rgba(0, 184, 176, 0.05); }
}
.di-sidebar-subtitle {
  margin: 0;
  font-size: 11px;
  color: #64748b;
  line-height: 1.4;
  font-weight: 500;
}
.di-sidebar-nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.di-side-btn {
  position: relative;
  display: block;
  width: 100%;
  padding: 10px 12px 10px 16px;
  background: transparent;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  text-align: left;
  font-family: inherit;
  color: #475569;
  transition: background 0.15s ease, color 0.15s ease;
  outline: none;
  -webkit-tap-highlight-color: transparent;
}
.di-side-btn:hover { background: rgba(0, 184, 176, 0.07); color: #0f172a; }
.di-side-btn:focus-visible { box-shadow: 0 0 0 2px #00b8b0; outline: none; }
.di-side-btn.is-active { background: rgba(0, 184, 176, 0.12); color: #0f766e; }
.di-side-rail {
  position: absolute;
  left: 4px;
  top: 50%;
  transform: translateY(-50%);
  width: 2px;
  height: 0;
  border-radius: 2px;
  background: #cbd5e1;
  transition:
    height 0.22s cubic-bezier(0.34, 1.4, 0.64, 1),
    background 0.15s ease;
}
.di-side-btn:hover .di-side-rail { height: 55%; background: #00b8b0; }
.di-side-btn.is-active .di-side-rail { height: 68%; background: #0f766e; }
.di-side-body { display: flex; flex-direction: column; gap: 0; min-width: 0; }
.di-side-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
}
.di-side-label {
  font-size: 13px;
  font-weight: 600;
  color: inherit;
  line-height: 1.3;
  letter-spacing: -0.005em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
  transition: font-weight 0.15s ease;
}
.di-side-btn.is-active .di-side-label { font-weight: 700; }
.di-side-count {
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-size: 11px;
  font-weight: 700;
  color: #94a3b8;
  background: #f1f5f9;
  padding: 1px 7px;
  border-radius: 999px;
  min-width: 22px;
  text-align: center;
  line-height: 1.4;
  flex-shrink: 0;
  transition: background 0.15s ease, color 0.15s ease;
}
.di-side-btn:hover .di-side-count { background: #d7ecf3; color: #334155; }
.di-side-btn.is-active .di-side-count { background: #0f766e; color: #ffffff; }
.di-side-hint {
  display: block;
  font-size: 11px;
  font-weight: 500;
  color: #94a3b8;
  line-height: 1.4;
  margin-top: 0;
  max-height: 0;
  opacity: 0;
  overflow: hidden;
  transform: translateY(-3px);
  transition:
    max-height 0.24s ease,
    opacity 0.18s ease,
    transform 0.22s ease,
    margin-top 0.22s ease;
}
.di-side-btn:hover .di-side-hint,
.di-side-btn.is-active .di-side-hint {
  max-height: 48px;
  opacity: 1;
  transform: translateY(0);
  margin-top: 3px;
}
.di-side-btn.is-active .di-side-hint { color: #0f766e; opacity: 0.75; }

.di-header { align-items: flex-start !important; gap: 16px !important; flex-wrap: wrap; }
.di-header-left { min-width: 0; flex: 1 1 320px; }
.di-header-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 4px;
}
.di-header-title-row h3 { margin: 0 !important; display: inline-flex; align-items: center; }
.di-scope-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
  background: #fef3c7;
  color: #92400e;
  border: 1px solid #fcd34d;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  letter-spacing: 0.04em;
  white-space: nowrap;
}
.di-header-sub { margin: 0; font-size: 13px; color: #64748b; line-height: 1.5; }
.di-header-actions { display: flex; gap: 10px; align-items: flex-start; flex-shrink: 0; flex-wrap: wrap; }

.di-export-wrap { position: relative; }
.di-export-btn {
  padding: 10px 16px; border-radius: 8px; font-size: 13px; font-weight: 700;
  border: 1px solid #cbd5e1; background: #ffffff; color: #334155;
  cursor: pointer; display: inline-flex; align-items: center; gap: 6px;
  transition: background 0.15s ease, border-color 0.15s ease;
  font-family: inherit;
}
.di-export-btn:hover:not(:disabled) { background: #f8fafc; border-color: #94a3b8; }
.di-export-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.di-export-menu {
  position: absolute; right: 0; top: calc(100% + 6px);
  min-width: 240px; max-width: calc(100vw - 32px);
  background: #ffffff; border: 1px solid #e2e8f0; border-radius: 10px;
  box-shadow: 0 12px 32px rgba(15, 23, 42, 0.16);
  padding: 6px; z-index: 100;
}
.di-export-menu-head {
  font-size: 10px; font-weight: 700; color: #94a3b8;
  text-transform: uppercase; letter-spacing: 0.08em;
  padding: 8px 10px 4px;
}
.di-export-menu-head--mt { border-top: 1px solid #f1f5f9; margin-top: 4px; }
.di-export-item {
  width: 100%; display: flex; flex-direction: column; gap: 2px;
  padding: 8px 10px; border: none; background: transparent;
  border-radius: 6px; cursor: pointer; text-align: left;
  font-size: 13px; font-weight: 600; color: #334155; font-family: inherit;
}
.di-export-item-title { display: inline-flex; align-items: center; gap: 6px; }
.di-export-item:hover:not(:disabled) { background: #f0fdfa; color: #0f766e; }
.di-export-item:disabled { opacity: 0.5; cursor: not-allowed; }
.di-export-hint { font-size: 11px; font-weight: 500; color: #94a3b8; }

.di-refresh-btn {
  padding: 10px 18px; border-radius: 8px;
  font-size: 13px; font-weight: 700; cursor: pointer;
  border: none; color: #fff; font-family: inherit;
  background: linear-gradient(135deg, #00e0d4 0%, #00b8b0 45%, #008a82 100%);
  box-shadow: 0 4px 12px rgba(0, 200, 190, 0.32);
  transition: transform 0.1s ease, box-shadow 0.15s ease;
  display: inline-flex; align-items: center; justify-content: center; gap: 7px;
}
.di-refresh-btn:hover:not(:disabled) { box-shadow: 0 6px 16px rgba(0, 200, 190, 0.42); }
.di-refresh-btn:active:not(:disabled) { transform: scale(0.98); }
.di-refresh-btn:disabled { opacity: 0.55; cursor: not-allowed; box-shadow: none; }

.di-kpi-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 12px; margin: 0 0 16px;
}
.di-kpi {
  display: flex; align-items: center; gap: 12px;
  padding: 14px 16px; border-radius: 12px;
  background: #ffffff; border: 1px solid #e2e8f0;
  min-width: 0;
}
.di-kpi-icon {
  width: 44px; height: 44px; border-radius: 12px;
  display: flex; align-items: center; justify-content: center;
  font-size: 22px; flex-shrink: 0;
}
.di-kpi-body { min-width: 0; flex: 1; }
.di-kpi-label {
  font-size: 10px; font-weight: 700; color: #64748b;
  text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 3px;
}
.di-kpi-value {
  font-size: 20px; font-weight: 800; color: #0f172a;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  letter-spacing: -0.02em; word-break: break-word;
}
.di-kpi--slate .di-kpi-icon { background: #f1f5f9; color: #334155; }
.di-kpi--amber .di-kpi-icon { background: #fef3c7; color: #b45309; }
.di-kpi--rose  .di-kpi-icon { background: #fee2e2; color: #be123c; }
.di-kpi--cyan  .di-kpi-icon { background: #ecfeff; color: #0e7490; }

.di-trend-card {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 16px 18px;
  margin-bottom: 16px;
}
.di-trend-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 6px;
}
.di-trend-title {
  font-size: 13px;
  font-weight: 800;
  color: #0f172a;
  letter-spacing: -0.01em;
  text-transform: uppercase;
}
.di-trend-sub { font-size: 11px; color: #64748b; margin-top: 2px; }
.di-trend-total { text-align: right; }
.di-trend-total-label {
  font-size: 10px; font-weight: 700; color: #64748b;
  text-transform: uppercase; letter-spacing: 0.06em;
}
.di-trend-total-value {
  font-size: 18px; font-weight: 800; color: #be123c;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  margin-top: 2px;
}
.di-trend-chart { margin-top: 4px; }
.di-trend-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 8px;
  font-size: 11px;
  color: #64748b;
  flex-wrap: wrap;
}
.di-trend-date { font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace; }
.di-trend-peak strong { color: #0f172a; }
.di-trend-loading,
.di-trend-empty {
  padding: 26px 12px;
  text-align: center;
  font-size: 12.5px;
  color: #94a3b8;
  background: #f8fafc;
  border-radius: 8px;
}

.di-quick-ranges {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 12px;
}
.di-quick-ranges-label {
  font-size: 11px; font-weight: 700; color: #64748b;
  text-transform: uppercase; letter-spacing: 0.06em;
  margin-right: 4px;
}
.di-quick-chip {
  padding: 5px 12px;
  font-size: 12px;
  font-weight: 600;
  border-radius: 999px;
  border: 1px solid #e2e8f0;
  background: #ffffff;
  color: #475569;
  cursor: pointer;
  font-family: inherit;
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
}
.di-quick-chip:hover { background: #f0fdfa; border-color: #5eead4; color: #0f766e; }
.di-quick-chip:active { transform: scale(0.97); }

.di-filters {
  display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-end;
  padding: 14px 16px; margin-bottom: 16px;
  background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px;
}
.di-filter-group { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.di-filter-group--grow { flex: 1 1 220px; }
.di-filter-group--wide { flex: 0 1 260px; }
.di-filter-group--toggle { flex: 0 0 auto; min-width: 210px; }
.di-filter-label {
  font-size: 11px; font-weight: 700; color: #64748b;
  text-transform: uppercase; letter-spacing: 0.06em;
}
.di-filter-input {
  padding: 9px 12px; border: 1px solid #cbd5e1; border-radius: 8px;
  font-size: 13px; font-family: inherit; color: #0f172a; outline: none;
  background: #ffffff; min-width: 0; width: 100%;
  box-sizing: border-box;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.di-filter-input:focus {
  border-color: #00b8b0; box-shadow: 0 0 0 3px rgba(0, 184, 176, 0.15);
}
.di-filter-actions { display: flex; align-items: flex-end; margin-left: auto; }
.di-filter-btn { padding: 9px 16px !important; font-size: 13px !important; }

.di-toggle {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  user-select: none;
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px solid #cbd5e1;
  background: #ffffff;
  font-size: 12px;
  font-weight: 600;
  color: #334155;
  transition: border-color 0.15s ease, background 0.15s ease;
}
.di-toggle:hover { border-color: #94a3b8; background: #f8fafc; }
.di-toggle input { position: absolute; opacity: 0; pointer-events: none; }
.di-toggle-track {
  position: relative;
  width: 32px;
  height: 18px;
  background: #cbd5e1;
  border-radius: 999px;
  transition: background 0.2s ease;
  flex-shrink: 0;
}
.di-toggle-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  background: #ffffff;
  border-radius: 50%;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.2);
  transition: transform 0.2s cubic-bezier(0.34, 1.4, 0.64, 1);
}
.di-toggle input:checked ~ .di-toggle-track { background: #00b8b0; }
.di-toggle input:checked ~ .di-toggle-track .di-toggle-thumb { transform: translateX(14px); }
.di-toggle input:focus-visible ~ .di-toggle-track { box-shadow: 0 0 0 3px rgba(0, 184, 176, 0.25); }
.di-toggle-text { white-space: nowrap; }

.di-wh-chips {
  display: flex; flex-wrap: wrap; gap: 8px; align-items: center;
  margin-bottom: 16px; padding: 12px 14px;
  background: #f0fdfa; border: 1px solid #99f6e4; border-radius: 10px;
}
.di-wh-chips-label {
  font-size: 11px; font-weight: 700; color: #0f766e;
  text-transform: uppercase; letter-spacing: 0.06em;
}
.di-wh-chip {
  display: inline-flex; flex-direction: column; align-items: flex-start; gap: 3px;
  padding: 8px 12px; border-radius: 10px;
  border: 1px solid #99f6e4; background: #ffffff;
  font-size: 12px; font-family: inherit; font-weight: 600;
  color: #0f766e; cursor: pointer; text-align: left;
  transition: background 0.15s ease, border-color 0.15s ease, transform 0.1s ease;
  min-width: 0;
}
.di-wh-chip:hover:not(:disabled) { background: #ccfbf1; border-color: #5eead4; }
.di-wh-chip:active:not(:disabled) { transform: scale(0.97); }
.di-wh-chip:disabled { cursor: default; }
.di-wh-chip.is-active { background: #0f766e; color: #ffffff; border-color: #0f766e; }
.di-wh-chip.is-active .di-wh-chip-stats { color: rgba(255, 255, 255, 0.85); }
.di-wh-chip.is-active .di-wh-chip-name { color: rgba(255, 255, 255, 0.9); }
.di-wh-chip-top { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.di-wh-chip-code {
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-weight: 700;
}
.di-wh-chip-name { font-size: 11px; color: #475569; font-weight: 500; }
.di-wh-chip-stats { font-size: 11px; color: #64748b; font-weight: 600; }

.di-error {
  padding: 12px 16px; margin-bottom: 16px;
  background: #fef2f2; border: 1px solid #fecaca; border-radius: 10px;
  color: #991b1b; font-size: 13px;
  display: flex; align-items: center; gap: 8px;
}
.di-empty { padding: 48px 24px; text-align: center; }
.di-empty-icon { font-size: 48px; margin-bottom: 12px; color: #86efac; display: flex; justify-content: center; }
.di-empty-title { font-size: 16px; font-weight: 700; color: #0f172a; }
.di-empty-sub { font-size: 13px; color: #64748b; margin-top: 4px; }

.di-groups { display: flex; flex-direction: column; gap: 18px; }
.di-group {
  border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;
  background: #ffffff;
}
.di-group-head {
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px; flex-wrap: wrap;
  padding: 12px 16px;
  background: linear-gradient(135deg, #eef2ff 0%, #e0e7ff 100%);
  border-bottom: 1px solid #c7d2fe;
}
.di-group-head-left { display: flex; align-items: center; gap: 10px; min-width: 0; flex-wrap: wrap; }
.di-group-icon {
  font-size: 16px; flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center;
  color: #4338ca;
}
.di-group-code {
  font-size: 15px; font-weight: 800; color: #3730a3;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  letter-spacing: 0.02em;
}
.di-group-name {
  font-size: 14px;
  font-weight: 600;
  color: #4338ca;
  padding-left: 2px;
}
.di-group-name::before {
  content: '—';
  color: #a5b4fc;
  margin-right: 8px;
  font-weight: 500;
}
.di-group-count {
  font-size: 11px; color: #6366f1; font-weight: 600;
  padding: 2px 8px; background: rgba(255, 255, 255, 0.7); border-radius: 999px;
}
.di-group-head-right { display: flex; gap: 16px; flex-wrap: wrap; align-items: center; }
.di-group-stat { font-size: 12px; color: #3730a3; font-weight: 600; }
.di-group-stat strong {
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-weight: 800; color: #1e1b4b;
}
.di-group-stat--value strong { color: #be123c; }

.di-table-wrap { overflow: auto; max-height: 60vh; background: #ffffff; }
.di-table {
  width: 100%; border-collapse: collapse; font-size: 13px;
  min-width: 1000px;
}
.di-th {
  padding: 10px 12px; text-align: left;
  font-size: 10px; font-weight: 700; color: #64748b;
  text-transform: uppercase; letter-spacing: 0.06em;
  background: #f8fafc; border-bottom: 1px solid #e2e8f0;
  position: sticky; top: 0; z-index: 1; white-space: nowrap;
}
.di-th--num  { text-align: right; }
.di-th--date { width: 145px; }
.di-th--source { width: 130px; }
.di-th--item   { width: 240px; }
.di-th--locator { width: 120px; }
.di-th--reason  { min-width: 180px; }
.di-th--actor   { width: 140px; }

.di-td {
  padding: 10px 12px; vertical-align: middle;
  color: #0f172a; border-bottom: 1px solid #f1f5f9;
  font-size: 13px;
}
.di-td--date  { white-space: nowrap; color: #475569; font-size: 12px; }
.di-td--mono  {
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-size: 12px; font-weight: 600; color: #334155;
}
.di-td--num   {
  text-align: right;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-weight: 700; color: #0f172a;
}
.di-td--value { color: #be123c; }
.di-td--reason {
  color: #475569; font-size: 12px;
  max-width: 260px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.di-td--actor  { font-size: 12px; color: #475569; }

.di-row {
  cursor: pointer;
  transition: background 0.12s ease;
}
.di-row:hover { background: #f0fdfa; }
.di-row:active { background: #e6fffb; }
.di-row:focus-visible { outline: 2px solid #00b8b0; outline-offset: -2px; }

.di-mobile-cards {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  background: #f8fafc;
}
.di-mob-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 14px;
  border-radius: 10px;
  border: 1px solid #e2e8f0;
  background: #ffffff;
  cursor: pointer;
  font-family: inherit;
  text-align: left;
  transition: border-color 0.15s ease, box-shadow 0.15s ease, transform 0.1s ease;
  -webkit-tap-highlight-color: transparent;
}
.di-mob-card:hover { border-color: #5eead4; box-shadow: 0 2px 8px rgba(0, 210, 200, 0.12); }
.di-mob-card:active { transform: scale(0.99); }
.di-mob-card:focus-visible { outline: 2px solid #00b8b0; outline-offset: 2px; }

.di-mob-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.di-mob-date {
  font-size: 11px;
  color: #64748b;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  white-space: nowrap;
}
.di-mob-item { display: flex; align-items: center; gap: 10px; min-width: 0; }
.di-mob-item-info { min-width: 0; flex: 1; }
.di-mob-code {
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-weight: 700;
  font-size: 13px;
  color: #4338ca;
  line-height: 1.2;
  word-break: break-word;
}
.di-mob-name {
  font-size: 12px;
  color: #475569;
  margin-top: 2px;
  line-height: 1.35;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
.di-mob-grid {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 8px;
  padding: 8px 10px;
  background: #f8fafc;
  border-radius: 8px;
  border: 1px solid #e2e8f0;
}
.di-mob-grid-cell { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.di-mob-grid-label {
  font-size: 9px;
  font-weight: 700;
  color: #94a3b8;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.di-mob-grid-value {
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-size: 13px;
  font-weight: 700;
  color: #0f172a;
  word-break: break-word;
}
.di-mob-grid-cell--total .di-mob-grid-value { color: #be123c; }

.di-mob-foot {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  font-size: 11px;
  color: #64748b;
}
.di-mob-loc,
.di-mob-actor {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}

.di-mob-reason {
  font-size: 12px;
  color: #475569;
  font-style: italic;
  padding: 6px 8px;
  background: #fffbeb;
  border: 1px solid #fde68a;
  border-radius: 6px;
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.di-source {
  display: inline-flex; align-items: center; gap: 3px;
  padding: 3px 9px; border-radius: 999px;
  font-size: 10px; font-weight: 700; letter-spacing: 0.04em;
  text-transform: uppercase; white-space: nowrap;
}
.di-source--po     { background: #ecfeff; color: #0e7490; border: 1px solid #a5f3fc; }
.di-source--sts    { background: #eef2ff; color: #4338ca; border: 1px solid #c7d2fe; }
.di-source--adjust { background: #f1f5f9; color: #475569; border: 1px solid #cbd5e1; }

.di-source-ref {
  font-size: 10px; color: #94a3b8; margin-top: 3px;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  max-width: 120px;
}

.di-item-cell { display: flex; align-items: center; gap: 10px; min-width: 0; }
.di-item-info { min-width: 0; flex: 1; }
.di-item-code {
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-weight: 700; font-size: 12px; color: #4338ca;
  line-height: 1.2;
}
.di-item-name {
  font-size: 11px; color: #475569; margin-top: 1px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  max-width: 200px;
}

.di-pagination {
  display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between;
  gap: 12px; padding: 14px 16px; margin-top: 16px;
  background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px;
}
.di-pagination-info { font-size: 13px; color: #475569; }
.di-pagination-controls { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.di-page-btn {
  padding: 8px 14px; font-size: 13px; font-weight: 600;
  border-radius: 8px; cursor: pointer;
  border: 1px solid #cbd5e1; background: #ffffff; color: #334155;
  font-family: inherit;
  transition: background 0.15s ease, border-color 0.15s ease;
  min-height: 36px;
}
.di-page-btn:hover:not(:disabled) { background: #f1f5f9; border-color: #94a3b8; }
.di-page-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.di-page-label {
  font-size: 13px; color: #334155; padding: 0 8px;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
}

/* ============================================================
   Detail modal
   ============================================================ */
.di-modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.62);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
  padding: clamp(8px, 2vw, 24px);
  animation: diFadeIn 0.18s ease;
}
@keyframes diFadeIn { from { opacity: 0 } to { opacity: 1 } }

.di-modal {
  background: #ffffff;
  border-radius: 18px;
  width: 100%;
  max-width: 620px;
  max-height: 92vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow:
    0 24px 64px rgba(15, 23, 42, 0.32),
    0 4px 14px rgba(15, 23, 42, 0.14);
  animation: diSlideUp 0.22s cubic-bezier(0.34, 1.3, 0.64, 1);
}
@keyframes diSlideUp {
  from { opacity: 0; transform: translateY(16px) scale(0.98); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}

.di-modal-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 18px 22px;
  border-bottom: 1px solid #e5e7eb;
  background: linear-gradient(135deg, #ffffff 0%, #f8fafc 100%);
  flex-shrink: 0;
}
.di-modal-head-left { display: flex; align-items: center; gap: 14px; min-width: 0; }
.di-modal-icon {
  width: 44px; height: 44px; border-radius: 12px;
  background: linear-gradient(135deg, #fbbf24 0%, #d97706 100%);
  color: #fff;
  display: flex; align-items: center; justify-content: center;
  font-size: 22px;
  box-shadow: 0 4px 12px rgba(217, 119, 6, 0.32);
  flex-shrink: 0;
}
.di-modal-title {
  margin: 0;
  font-size: 18px;
  font-weight: 800;
  color: #0f172a;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  letter-spacing: -0.01em;
  line-height: 1.2;
  word-break: break-word;
}
.di-modal-sub {
  margin-top: 4px;
  font-size: 12px;
  color: #64748b;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.di-modal-dot { color: #cbd5e1; }
.di-modal-close {
  background: transparent;
  border: none;
  width: 40px;
  height: 40px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 18px;
  color: #64748b;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s ease, color 0.15s ease;
}
.di-modal-close:hover { background: #f1f5f9; color: #0f172a; }

.di-modal-body {
  flex: 1;
  overflow-y: auto;
  padding: 22px;
  display: flex;
  flex-direction: column;
  gap: 18px;
  background: #ffffff;
}
.di-modal-body::-webkit-scrollbar { width: 8px; }
.di-modal-body::-webkit-scrollbar-track { background: #f1f5f9; border-radius: 4px; }
.di-modal-body::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 4px; }

.di-modal-hero {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 14px 16px;
  background: linear-gradient(135deg, #f0fdfa 0%, #ecfeff 100%);
  border: 1px solid #99f6e4;
  border-radius: 12px;
}
.di-modal-hero-img { flex-shrink: 0; }
.di-modal-hero-info { min-width: 0; flex: 1; }
.di-modal-item-code {
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-weight: 800;
  font-size: 16px;
  color: #0f766e;
  letter-spacing: -0.01em;
  line-height: 1.2;
  word-break: break-word;
}
.di-modal-item-name {
  font-size: 13px;
  color: #475569;
  margin-top: 4px;
  line-height: 1.4;
  word-break: break-word;
}

.di-modal-values {
  display: flex;
  align-items: stretch;
  gap: 10px;
  flex-wrap: wrap;
}
.di-modal-value-box {
  flex: 1 1 130px;
  padding: 12px 14px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.di-modal-value-box--total {
  background: linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%);
  border-color: #fecaca;
}
.di-modal-value-label {
  font-size: 10px;
  font-weight: 700;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.di-modal-value-box--total .di-modal-value-label { color: #991b1b; }
.di-modal-value-num {
  font-size: 15px;
  font-weight: 800;
  color: #0f172a;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  letter-spacing: -0.02em;
  word-break: break-word;
}
.di-modal-value-box--total .di-modal-value-num { color: #be123c; }
.di-modal-value-op {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  font-weight: 700;
  color: #94a3b8;
  flex: 0 0 auto;
  padding: 0 2px;
}

.di-modal-meta {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 10px;
}
.di-modal-meta-row {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 10px 12px;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  min-width: 0;
}
.di-modal-meta-label {
  font-size: 10px;
  font-weight: 700;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.di-modal-meta-value {
  font-size: 13px;
  font-weight: 600;
  color: #0f172a;
  word-break: break-word;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.di-modal-meta-value--mono {
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
}
.di-wh-inline-code {
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-weight: 700;
  color: #0f766e;
}
.di-wh-inline-name {
  font-size: 12px;
  font-weight: 500;
  color: #475569;
}

.di-modal-reason {
  padding: 12px 14px;
  background: #fffbeb;
  border: 1px solid #fde68a;
  border-radius: 10px;
}
.di-modal-reason .di-modal-meta-label { color: #92400e; margin-bottom: 6px; }
.di-modal-reason-body {
  font-size: 13px;
  color: #78350f;
  line-height: 1.55;
  word-break: break-word;
  white-space: pre-wrap;
}

.di-modal-foot {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 10px;
  padding: 14px 22px;
  border-top: 1px solid #e5e7eb;
  background: #f8fafc;
  flex-shrink: 0;
}
.di-modal-foot-btn {
  padding: 10px 22px;
  border-radius: 8px;
  border: 1px solid #cbd5e1;
  background: #ffffff;
  color: #334155;
  font-size: 13px;
  font-weight: 700;
  font-family: inherit;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;
  min-height: 44px;
}
.di-modal-foot-btn:hover { background: #f1f5f9; border-color: #94a3b8; }

/* ============================================================
   RESPONSIVE
   ============================================================ */
@media (max-width: 1024px) {
  .di-layout { grid-template-columns: 1fr; gap: 14px; }
  .di-sidebar { position: relative; padding: 14px 16px 12px 20px; gap: 10px; }
  .di-sidebar::before { top: 12px; bottom: 12px; }
  .di-sidebar-head {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    padding-bottom: 10px;
    margin-bottom: 0;
  }
  .di-sidebar-subtitle { font-size: 11px; color: #94a3b8; text-align: right; }
  .di-sidebar-nav {
    flex-direction: row;
    gap: 8px;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    padding-bottom: 4px;
    scrollbar-width: thin;
    margin: 0 -4px;
    padding-left: 4px;
    padding-right: 4px;
  }
  .di-side-btn {
    flex: 0 0 auto;
    min-width: 160px;
    padding: 9px 12px;
    border: 1px solid #b8f1ea;
    border-radius: 10px;
    background: #ffffff;
  }
  .di-side-btn:hover { background: #f0fdfa; border-color: #5eead4; }
  .di-side-btn.is-active { background: #f0fdfa; border-color: #0f766e; }
  .di-side-rail { display: none; }
  .di-side-hint { display: none; }
  .di-side-label { font-size: 12.5px; }
}

@media (max-width: 900px) {
  .di-table { min-width: 920px; }
  .di-kpi-row { grid-template-columns: repeat(2, 1fr); }
  .di-filter-group--wide { flex: 1 1 220px; }
  .di-filter-group--toggle { min-width: 0; }
}

@media (max-width: 768px) {
  .di-desktop-only { display: none !important; }
  .di-mobile-only  { display: block !important; }

  .di-header { flex-direction: column; align-items: stretch !important; }
  .di-header-actions { justify-content: stretch; width: 100%; }
  .di-header-actions > * { flex: 1 1 auto; }
  .di-export-wrap { flex: 1 1 auto; }
  .di-export-btn, .di-refresh-btn { width: 100%; justify-content: center; min-height: 44px; }
  .di-export-menu { right: auto; left: 0; }

  .di-kpi-row { grid-template-columns: repeat(2, 1fr); gap: 10px; }
  .di-kpi { padding: 12px; gap: 10px; }
  .di-kpi-icon { width: 40px; height: 40px; font-size: 20px; }
  .di-kpi-value { font-size: 17px; }

  .di-trend-card { padding: 14px; }
  .di-trend-total { text-align: left; }
  .di-trend-head { flex-direction: column; align-items: stretch; gap: 8px; }
  .di-trend-footer { flex-direction: column; align-items: flex-start; gap: 4px; }

  .di-quick-ranges { gap: 5px; }
  .di-quick-chip {
    padding: 8px 14px;
    min-height: 40px;
    display: inline-flex;
    align-items: center;
  }

  .di-filters {
    flex-direction: column;
    align-items: stretch;
    gap: 10px;
    padding: 12px;
  }
  .di-filter-group,
  .di-filter-group--grow,
  .di-filter-group--wide,
  .di-filter-group--toggle { flex: 1 1 auto; width: 100%; min-width: 0; }
  .di-filter-input { min-height: 44px; font-size: 15px; }
  .di-filter-actions { margin-left: 0; width: 100%; }
  .di-filter-btn { width: 100%; min-height: 44px; }

  .di-toggle { width: 100%; justify-content: flex-start; min-height: 44px; }
  .di-toggle-text { white-space: normal; }

  .di-wh-chips { padding: 10px 12px; gap: 6px; }
  .di-wh-chip { padding: 8px 12px; min-height: 44px; }
  .di-wh-chip-name { display: none; }

  .di-group-head { flex-direction: column; align-items: flex-start; gap: 8px; padding: 12px 14px; }
  .di-group-head-right { gap: 10px; flex-wrap: wrap; }
  .di-group-name::before { content: '·'; }

  .di-mobile-cards { padding: 10px; gap: 8px; }

  .di-pagination { flex-direction: column; align-items: stretch; padding: 12px; }
  .di-pagination-controls { justify-content: center; flex-wrap: wrap; }
  .di-page-btn { min-height: 40px; padding: 10px 14px; }

  .di-modal-overlay { padding: 12px; align-items: flex-end; }
  .di-modal { max-width: 100%; max-height: 92vh; border-radius: 16px 16px 0 0; }
  .di-modal-values { flex-direction: column; }
  .di-modal-value-op { transform: rotate(90deg); padding: 2px 0; height: 20px; }
  .di-modal-value-box { flex: 1 1 auto; }
  .di-modal-foot-btn { width: 100%; }
}

@media (max-width: 480px) {
  .di-header-title-row h3 { font-size: 18px; }
  .di-header-sub { font-size: 12px; }

  .di-kpi-row { grid-template-columns: 1fr; }
  .di-kpi { padding: 10px 12px; gap: 10px; }
  .di-kpi-icon { width: 36px; height: 36px; font-size: 18px; }
  .di-kpi-value { font-size: 15px; }
  .di-kpi-label { font-size: 9px; }

  .di-quick-ranges-label { width: 100%; margin-bottom: 2px; }

  .di-filter-input { font-size: 16px; }

  .di-group-code { font-size: 14px; }
  .di-group-stat { font-size: 11px; }
  .di-group-count { font-size: 10px; }

  .di-mob-card { padding: 10px 12px; }
  .di-mob-grid { padding: 8px; gap: 6px; }
  .di-mob-grid-value { font-size: 12px; }

  .di-modal-overlay { padding: 0; align-items: stretch; }
  .di-modal {
    border-radius: 0;
    max-height: 100vh;
    height: 100dvh;
    max-width: 100vw;
  }
  .di-modal-head { padding: 14px 16px; }
  .di-modal-title { font-size: 16px; }
  .di-modal-body { padding: 16px; gap: 14px; }
  .di-modal-hero { padding: 12px; gap: 12px; }
  .di-modal-foot { padding: 12px 16px; }

  .di-pagination-info { text-align: center; font-size: 12px; }
  .di-page-label { padding: 0 4px; font-size: 12px; }

  .di-sidebar { padding: 10px 12px 10px 16px; }
  .di-sidebar-head { padding-bottom: 8px; gap: 8px; }
  .di-sidebar-title { font-size: 10px; }
  .di-sidebar-subtitle { display: none; }
  .di-side-btn { min-width: 140px; padding: 8px 10px; }
  .di-side-label { font-size: 12px; }
  .di-side-count { font-size: 10px; min-width: 20px; padding: 1px 6px; }
}

@media (max-width: 360px) {
  .di-header-sub { display: none; }
  .di-kpi-icon { width: 32px; height: 32px; font-size: 16px; }
  .di-kpi-value { font-size: 14px; }
  .di-mob-grid { grid-template-columns: 1fr 1fr; }
  .di-mob-grid-cell--total { grid-column: 1 / -1; }
  .di-quick-chip { padding: 6px 10px; font-size: 11px; }
  .di-wh-chip-stats { display: none; }

  .di-side-btn { min-width: 124px; padding: 6px 10px; }
  .di-side-label { font-size: 11.5px; }
}

@media (max-height: 500px) and (orientation: landscape) {
  .di-kpi-row { grid-template-columns: repeat(4, 1fr); gap: 8px; }
  .di-kpi { padding: 8px 10px; }
  .di-kpi-icon { width: 32px; height: 32px; font-size: 16px; }
  .di-kpi-value { font-size: 14px; }
  .di-modal { max-height: 100vh; }
  .di-modal-head { padding: 10px 14px; }
  .di-modal-body { padding: 12px 14px; gap: 10px; }
  .di-modal-foot { padding: 10px 14px; }
}

@media (prefers-reduced-motion: reduce) {
  .di-refresh-btn, .di-wh-chip, .di-page-btn, .di-export-btn,
  .di-row, .di-toggle-track, .di-toggle-thumb, .di-quick-chip,
  .di-modal, .di-modal-overlay, .di-modal-close, .di-modal-foot-btn,
  .di-mob-card, .di-side-btn, .di-side-rail, .di-side-hint, .di-side-count {
    transition: none !important;
    animation: none !important;
  }
  .di-modal-value-op { transform: none; }
  .di-sidebar-dot { animation: none !important; box-shadow: 0 0 0 3px rgba(0, 184, 176, 0.22); }
  .di-side-btn:hover .di-side-hint,
  .di-side-btn.is-active .di-side-hint { transform: none; }
  .icon-spin { animation: none !important; }
}
`;

export default TabDamagedItems;