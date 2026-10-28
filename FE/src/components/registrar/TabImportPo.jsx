// src/components/registrar/TabImportPo.jsx
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FiInbox,
  FiUpload,
  FiHome,
  FiX,
  FiAlertTriangle,
  FiCheckCircle,
  FiRefreshCw,
  FiTarget,
  FiClock,
  FiPackage,
  FiArrowRight,
  FiTruck,
  FiAward,
  FiXCircle,
  FiSlash,
  FiCircle,
  FiFilter,
  FiLayers,
  FiTag,
  FiInfo,
  FiChevronDown,
  FiChevronUp,
  FiDownload,
} from 'react-icons/fi';
import { usePermissions } from '../../permissions/usePermissions';
import { importPoApi, itemMasterApi } from '../../services/api';
import { useToast } from '../shared/ToastProvider';
import ImportPoModal from './ImportPoModal';
import ItemImageThumb from '../shared/ItemImageThumb';

const PO_PREVIEW_LIMIT = 8;

// ============================================================
// Helpers
// ============================================================
const formatTotal = (v) => {
  if (v === '' || v === null || v === undefined) return '-';
  const n = Number(v);
  if (Number.isNaN(n)) return '-';
  return n.toFixed(4);
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

const fmtNum = (v, dp = 4) => {
  if (v === '' || v === null || v === undefined) return '—';
  const n = Number(v);
  if (Number.isNaN(n)) return '—';
  return n.toFixed(dp);
};

/* Relative time — "just now", "5m ago", "3h ago", "2d ago", or the raw date. */
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

/* Is the row "new"? True if imported within the last 24 hours. */
const isNewImport = (v) => {
  if (!v) return false;
  const then = new Date(v).getTime();
  if (!Number.isFinite(then)) return false;
  return Date.now() - then < 24 * 60 * 60 * 1000;
};

/* Two-letter initials from a vendor name for the avatar. */
const initialsOf = (name) => {
  const s = String(name || '').trim();
  if (!s) return '—';
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

/* Deterministic soft color for a vendor avatar, based on the name. */
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
    case 'Pending':                return 'Waiting for a Registrar to receive items from the vendor.';
    case 'Partial Received':       return 'A Registrar has partially received this PO. Waiting for the rest.';
    case 'Complete':               return 'Fully received. Ready to be sent to the Stock Handler.';
    case 'Complete (with damage)': return 'Fully received (with damage logged). Ready to be sent to the Stock Handler.';
    case 'With Handler':           return 'With the Stock Handler. A Stock Transfer Slip can be created.';
    case 'Partial With Handler':   return 'Partially with the Handler. The rest can be transferred once received.';
    case 'Pending Transfer':       return 'A transfer is awaiting Department Head approval.';
    case 'Transferred':            return 'All received items have been transferred to their destination.';
    case 'Stored':                 return 'Items are stored. No further action needed.';
    default:                       return '—';
  }
};

// ============================================================
// Activity icon — Feather component lookup.
// ============================================================
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
const TabImportPo = () => {
  const { can } = usePermissions();
  const toast = useToast();

  const [showImport, setShowImport] = useState(false);
  const [recent, setRecent]         = useState([]);
  const [loading, setLoading]       = useState(false);

  /* PO Type filter: 'All' | '1' (with PO) | '0' (without PO / PR-based) */
  const [poTypeFilter, setPoTypeFilter] = useState('All');

  /* Collapsible help section — hidden by default so the page is clean. */
  const [showInfo, setShowInfo] = useState(false);

  const [detail, setDetail]               = useState(null);
  const [detailLines, setDetailLines]     = useState([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailImages, setDetailImages]   = useState({});
  const [detailActivity, setDetailActivity] = useState([]);
  const [detailActivityLoading, setDetailActivityLoading] = useState(false);

  const loadRecent = useCallback(async () => {
    setLoading(true);
    try {
      const res = await importPoApi.listPOs({
        page: 1,
        limit: PO_PREVIEW_LIMIT,
        has_po: poTypeFilter !== 'All' ? poTypeFilter : undefined,
      });
      if (res.ok) {
        setRecent(Array.isArray(res.data) ? res.data : []);
      } else {
        setRecent([]);
      }
    } catch (err) {
      console.warn('Could not load recent imports:', err);
      setRecent([]);
    } finally {
      setLoading(false);
    }
  }, [poTypeFilter]);

  useEffect(() => { loadRecent(); }, [loadRecent]);

  /* KPI values — derived client-side from the loaded recent list. */
  const kpis = useMemo(() => {
    const total = recent.length;
    let withPo = 0;
    let prBased = 0;
    let totalLines = 0;
    for (const r of recent) {
      if (isPrBased(r)) prBased += 1;
      else withPo += 1;
      totalLines += Number(r.line_count) || 0;
    }
    return { total, withPo, prBased, totalLines };
  }, [recent]);

  const handleImported = async () => {
    await loadRecent();
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

  const anyNonPhp = detailLines.some((l) => l.currency && l.currency !== 'PHP');

  return (
    <div className="items-section">
      <style>{modalCss}</style>

      <div className="section-header">
        <h3>
          <FiInbox className="aip-heading-icon" />
          <span>Import Purchase Orders</span>
        </h3>
        <div className="header-actions">
          {can('importpo.create') && (
            <button
              className="add-user-btn"
              onClick={() => setShowImport(true)}
            >
              <FiUpload className="aip-btn-icon" />
              <span>Import PO</span>
            </button>
          )}
        </div>
      </div>

      {/* ============================================================
          Collapsible help section.
         ============================================================ */}
      <button
        type="button"
        className={`aip-info-toggle${showInfo ? ' is-open' : ''}`}
        onClick={() => setShowInfo((s) => !s)}
        aria-expanded={showInfo}
        aria-controls="aip-info-panel"
      >
        <FiInfo className="aip-info-toggle-icon" aria-hidden="true" />
        <span>
          {showInfo
            ? 'Hide details about this section'
            : 'Know more about this section'}
        </span>
        {showInfo
          ? <FiChevronUp className="aip-info-toggle-caret" aria-hidden="true" />
          : <FiChevronDown className="aip-info-toggle-caret" aria-hidden="true" />}
      </button>

      {showInfo && (
        <div id="aip-info-panel" className="aip-info-panel">
          <div
            style={{
              background: '#eff6ff',
              border: '1px solid #bfdbfe',
              borderRadius: 8,
              padding: '14px 16px',
              marginBottom: 20,
              fontSize: 13,
              color: '#1e3a8a',
              display: 'flex',
              alignItems: 'flex-start',
              gap: 12,
              lineHeight: 1.6,
            }}
          >
            <span className="aip-banner-icon aip-banner-icon--info"><FiHome /></span>
            <div>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>
                One warehouse per PO/PR · Multi-currency supported · User-set delivery status
              </div>
              <div>
                Every row needs a <strong>WAREHOUSE CODE</strong>. Each PO number (or PR number,
                when PO No. is blank) must share one code — mixed values abort the import. Non-PHP rows need a
                <strong> FOREX</strong> rate (max 4 decimals); totals are shown in <strong>PHP</strong> (functional
                amount, rounded to 4 decimals). <strong>Locked items</strong> ignore the warehouse column and route to
                their own warehouse + locator. The <strong>STATUS</strong> column (Complete / Partial Received)
                is required and authoritative.
                Rows without a PO No. are imported as <strong>PR-based</strong> and grouped by their PR No.
              </div>
            </div>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: 12,
              marginBottom: 24,
            }}
          >
            <StepCard
              n="1"
              title="One warehouse per PO / PR"
              body="Every row must contain a WAREHOUSE CODE. Mixed values within the same PO/PR group are rejected before anything hits the server."
            />
            <StepCard
              n="2"
              title="PHP is forex = 1"
              body="When CURR is PHP, FOREX is forced to 1. Non-PHP rows must supply a FOREX rate with at most 4 decimals."
            />
            <StepCard
              n="3"
              title="Delivery status is user-set"
              body="The Excel file must include a STATUS column: use Complete or Partial Received. The old QTY vs DELIVERED QTY comparison no longer drives the status."
            />
          </div>
        </div>
      )}

      {/* ============================================================
          PO Type filter
         ============================================================ */}
      <div className="aip-type-filter-bar">
        <span className="aip-type-filter-label">
          <FiFilter className="aip-type-filter-label-icon" aria-hidden="true" />
          <span>Filter by type</span>
        </span>
        <div className="aip-type-filter" role="group" aria-label="Filter by PO type">
          <button
            type="button"
            className={`aip-type-filter-btn${poTypeFilter === 'All' ? ' is-active' : ''}`}
            onClick={() => setPoTypeFilter('All')}
            aria-pressed={poTypeFilter === 'All'}
          >
            All
          </button>
          <button
            type="button"
            className={`aip-type-filter-btn${poTypeFilter === '1' ? ' is-active' : ''}`}
            onClick={() => setPoTypeFilter('1')}
            aria-pressed={poTypeFilter === '1'}
          >
            With PO
          </button>
          <button
            type="button"
            className={`aip-type-filter-btn${poTypeFilter === '0' ? ' is-active' : ''}`}
            onClick={() => setPoTypeFilter('0')}
            aria-pressed={poTypeFilter === '0'}
          >
            Without PO (PR-based)
          </button>
        </div>
      </div>

      <div className="daily-items-section">
        {/* ---------- Enhanced header ---------- */}
        <div className="aip-recent-header">
          <div className="aip-recent-header-left">
            <h4>Recently Imported POs</h4>
            <p className="aip-recent-sub">
              {loading
                ? 'Refreshing the latest imports…'
                : recent.length === 0
                  ? 'New imports will show up here as soon as they land.'
                  : `A quick look at the latest ${recent.length} PO/PR group${recent.length === 1 ? '' : 's'}. Click any row to open its activity timeline.`}
            </p>
          </div>
          <button
            type="button"
            className="aip-recent-refresh"
            onClick={loadRecent}
            disabled={loading}
            title="Refresh recent imports"
          >
            <FiRefreshCw className={`aip-recent-refresh-icon${loading ? ' icon-spin' : ''}`} aria-hidden="true" />
            <span>{loading ? 'Loading…' : 'Refresh'}</span>
          </button>
        </div>

        {/* ---------- KPI strip ---------- */}
        <div className="aip-recent-kpis">
          <div className="aip-recent-kpi aip-recent-kpi--total">
            <div className="aip-recent-kpi-icon"><FiInbox aria-hidden="true" /></div>
            <div className="aip-recent-kpi-body">
              <div className="aip-recent-kpi-label">Recent imports</div>
              <div className="aip-recent-kpi-value">{kpis.total}</div>
            </div>
          </div>
          <div className="aip-recent-kpi aip-recent-kpi--po">
            <div className="aip-recent-kpi-icon"><FiCheckCircle aria-hidden="true" /></div>
            <div className="aip-recent-kpi-body">
              <div className="aip-recent-kpi-label">With PO</div>
              <div className="aip-recent-kpi-value">{kpis.withPo}</div>
            </div>
          </div>
          <div className="aip-recent-kpi aip-recent-kpi--pr">
            <div className="aip-recent-kpi-icon"><FiTag aria-hidden="true" /></div>
            <div className="aip-recent-kpi-body">
              <div className="aip-recent-kpi-label">PR-based</div>
              <div className="aip-recent-kpi-value">{kpis.prBased}</div>
            </div>
          </div>
          <div className="aip-recent-kpi aip-recent-kpi--lines">
            <div className="aip-recent-kpi-icon"><FiLayers aria-hidden="true" /></div>
            <div className="aip-recent-kpi-body">
              <div className="aip-recent-kpi-label">Lines in view</div>
              <div className="aip-recent-kpi-value">{kpis.totalLines}</div>
            </div>
          </div>
        </div>

        {/* ---------- Table ---------- */}
        <div className="table-wrapper">
          {loading ? (
            <div className="loading-spinner" style={{ margin: '20px auto' }} />
          ) : recent.length > 0 ? (
            <table className="data-table aip-table">
              <thead>
                <tr>
                  <th className="col-po-no">PO / PR No.</th>
                  <th className="col-po-date">PO Date</th>
                  <th className="col-pr-no">PR No.</th>
                  <th className="col-vendor">Vendor</th>
                  <th className="col-lines" style={{ textAlign: 'center' }}>Lines</th>
                  <th className="col-status">Status</th>
                  <th className="col-by">Imported</th>
                  <th className="col-hint" style={{ textAlign: 'right' }}></th>
                </tr>
              </thead>
              <tbody>
                {recent.map((po) => {
                  const prBased = isPrBased(po);
                  const isNew = isNewImport(po.imported_at);
                  const tone = avatarTone(po.vendor_name);
                  return (
                    <tr
                      key={po.po_no}
                      onClick={() => handleOpenDetail(po)}
                      className={`aip-clickable-row${prBased ? ' is-pr-based' : ' is-po'}`}
                      title="Click to view activity timeline"
                    >
                      <td className="col-po-no">
                        <div className="aip-po-cell">
                          <span
                            className={`aip-type-dot${prBased ? ' aip-type-dot--pr' : ' aip-type-dot--po'}`}
                            title={prBased ? 'PR-based (no PO No.)' : 'Has a real PO No.'}
                            aria-hidden="true"
                          />
                          <span className="po-no-big">{po.po_no}</span>
                          {prBased && (
                            <span
                              className="aip-pr-pill"
                              title="No PO No. — grouped by PR No."
                            >
                              PR
                            </span>
                          )}
                          {isNew && (
                            <span className="aip-new-pill" title="Imported in the last 24 hours">
                              NEW
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="col-po-date">{formatDate(po.po_date)}</td>
                      <td className="col-pr-no">{po.pr_no || '—'}</td>
                      <td className="col-vendor">
                        <div className="aip-vendor-cell">
                          <span
                            className="aip-vendor-avatar"
                            style={{
                              background: `hsl(${tone} 65% 92%)`,
                              color: `hsl(${tone} 55% 32%)`,
                              borderColor: `hsl(${tone} 55% 80%)`,
                            }}
                            aria-hidden="true"
                          >
                            {initialsOf(po.vendor_name)}
                          </span>
                          <span className="aip-vendor-name" title={po.vendor_name}>
                            {po.vendor_name || '—'}
                          </span>
                        </div>
                      </td>
                      <td className="col-lines" style={{ textAlign: 'center', fontWeight: 600 }}>
                        {po.line_count ?? '—'}
                      </td>
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
                      <td className="col-by">
                        <div className="aip-imported-cell">
                          <span className="aip-imported-by" title={po.imported_by || ''}>
                            {po.imported_by || '—'}
                          </span>
                          <span className="aip-imported-at" title={po.imported_at || ''}>
                            {relativeTime(po.imported_at)}
                          </span>
                        </div>
                      </td>
                      <td className="col-hint" style={{ textAlign: 'right' }}>
                        <span className="aip-chevron">View ›</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            /* ---------- Enhanced empty state ---------- */
            <div className="aip-empty">
              <div className="aip-empty-icon-circle">
                <FiInbox className="aip-empty-icon-svg" aria-hidden="true" />
              </div>
              <div className="aip-empty-title">
                {poTypeFilter === 'All'
                  ? 'No imports yet'
                  : poTypeFilter === '1'
                    ? 'No POs with a PO No. yet'
                    : 'No PR-based imports yet'}
              </div>
              <div className="aip-empty-sub">
                {poTypeFilter === 'All'
                  ? 'Upload your first PO export file to get started. Imports show up here instantly.'
                  : poTypeFilter === '1'
                    ? 'Once the Admin team imports POs with a PO No., they’ll appear here.'
                    : 'PR-based imports (rows without a PO No.) will appear here when they land.'}
              </div>
              {can('importpo.create') && poTypeFilter === 'All' && (
                <button
                  type="button"
                  className="aip-empty-cta"
                  onClick={() => setShowImport(true)}
                >
                  <FiUpload className="aip-btn-icon" />
                  <span>Import your first PO</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {showImport && (
        <ImportPoModal
          onClose={() => setShowImport(false)}
          onImported={handleImported}
        />
      )}

      {detail && (
        <div className="aipd-overlay" style={mStyles.overlay} onClick={closeDetail}>
          <div
            className="aipd-card"
            style={mStyles.card}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={mStyles.header}>
              <div style={mStyles.headerLeft}>
                <div style={mStyles.headerIcon}><FiInbox size={22} /></div>
                <div style={{ minWidth: 0 }}>
                  <h3 style={mStyles.headerTitle}>
                    {detail.po_no}
                    {isPrBased(detail) && (
                      <span className="aip-pr-pill aip-pr-pill--modal" title="No PO No. — grouped by PR No.">PR</span>
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
              <button
                type="button"
                className="aipd-close"
                onClick={closeDetail}
                style={mStyles.closeBtn}
                aria-label="Close"
              >
                <FiX size={18} />
              </button>
            </div>

            <div className="aipd-body" style={mStyles.body}>
              <div className="aipd-meta-grid" style={mStyles.metaGrid}>
                <div style={mStyles.metaBox}>
                  <div style={mStyles.metaLabel}>Type</div>
                  <div style={mStyles.metaValue}>
                    {isPrBased(detail)
                      ? <span className="aip-pr-pill aip-pr-pill--inline">PR-based</span>
                      : <span className="aip-type-pill aip-type-pill--po">With PO</span>}
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
                  <FiPackage className="aip-section-icon" />
                  <span>PO Lines <span style={mStyles.sectionCount}>({detailLines.length})</span></span>
                </span>
              </div>

              <div style={mStyles.tableWrap}>
                <table style={mStyles.table}>
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
                            {l.unit_price != null
                              ? `${Number(l.unit_price).toFixed(4)}`
                              : '—'}
                          </td>
                          <td style={{ ...mStyles.td, textAlign: 'right', fontFamily: 'JetBrains Mono, SF Mono, Monaco, Menlo, monospace', fontSize: 12 }}>
                            {l.forex != null ? Number(l.forex).toFixed(4) : '—'}
                          </td>
                          <td style={{ ...mStyles.td, textAlign: 'right', fontWeight: 700, fontFamily: 'JetBrains Mono, SF Mono, Monaco, Menlo, monospace', fontSize: 12 }}>
                            {fmtNum(l.func_amount, 4)}
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

              {anyNonPhp && (
                <div style={mStyles.fxNote}>
                  <FiRefreshCw className="aip-fx-note-icon" />
                  <span>
                    Some lines use non-PHP currencies. <strong>Forex</strong> shows the FX
                    rate applied at import (4 decimals max). <strong>Func (PHP)</strong> is the
                    PHP-equivalent value (<em>unit_price × delivered_qty × forex</em>), rounded to 4 decimals.
                  </span>
                </div>
              )}

              <div style={mStyles.nextStepBox}>
                <div style={mStyles.nextStepLabel}>
                  <FiTarget className="aip-next-step-icon" />
                  <span>What's next</span>
                </div>
                <div style={mStyles.nextStepValue}>{nextStepFor(detail.status)}</div>
              </div>

              <div style={mStyles.sectionHead}>
                <span style={mStyles.sectionTitle}>
                  <FiClock className="aip-section-icon" />
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
                            <span
                              style={{
                                ...mStyles.timelineTypeChip,
                                color,
                                borderColor: color,
                              }}
                            >
                              {evt.event_type}
                            </span>
                          </div>
                          {evt.event_detail && (
                            <div style={mStyles.timelineDetail}>{evt.event_detail}</div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="aipd-footer" style={mStyles.footer}>
              <button
                type="button"
                className="cancel-btn"
                onClick={closeDetail}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const StepCard = ({ n, title, body }) => (
  <div
    style={{
      padding: '14px 16px',
      background: '#ffffff',
      border: '1px solid #e2e8f0',
      borderRadius: 10,
      display: 'flex',
      gap: 12,
      alignItems: 'flex-start',
    }}
  >
    <div
      style={{
        width: 28,
        height: 28,
        borderRadius: 999,
        background: 'linear-gradient(135deg, #00e0d4 0%, #008a82 100%)',
        color: '#ffffff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 700,
        fontSize: 13,
        flexShrink: 0,
        boxShadow: '0 2px 6px rgba(0, 210, 200, 0.3)',
      }}
    >
      {n}
    </div>
    <div style={{ minWidth: 0 }}>
      <div
        style={{
          fontSize: 13,
          fontWeight: 700,
          color: '#0f172a',
          marginBottom: 3,
        }}
      >
        {title}
      </div>
      <div
        style={{
          fontSize: 12,
          color: '#475569',
          lineHeight: 1.5,
        }}
      >
        {body}
      </div>
    </div>
  </div>
);

// ============================================================
// Modal styles
// ============================================================
const mStyles = {
  overlay: {
    position: 'fixed', inset: 0,
    background: 'rgba(15, 23, 42, 0.62)',
    backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 10000, padding: 'clamp(8px, 2vw, 24px)',
    animation: 'aipFadeIn 0.18s ease',
  },
  card: {
    background: '#ffffff',
    borderRadius: 'clamp(12px, 1.5vw, 18px)',
    width: '100%', maxWidth: 1180, maxHeight: '92vh',
    display: 'flex', flexDirection: 'column', overflow: 'hidden',
    boxShadow: '0 24px 64px rgba(15, 23, 42, 0.28), 0 4px 14px rgba(15, 23, 42, 0.14)',
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    animation: 'aipSlideUp 0.22s cubic-bezier(0.34, 1.3, 0.64, 1)',
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
    boxShadow: '0 4px 12px rgba(0, 210, 200, 0.32)', flexShrink: 0,
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
    color: '#64748b', flexShrink: 0,
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

  metaGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 },
  metaBox: { padding: '10px 14px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8 },
  metaLabel: { fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 },
  metaValue: { fontSize: 13, fontWeight: 600, color: '#0f172a', wordBreak: 'break-word' },

  sectionHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginTop: 4 },
  sectionTitle: { fontSize: 14, fontWeight: 700, color: '#0f172a', display: 'inline-flex', alignItems: 'center', gap: 8 },
  sectionCount: { color: '#64748b', fontWeight: 500 },

  tableWrap: { overflow: 'auto', maxHeight: '40vh', border: '1px solid #e2e8f0', borderRadius: 10, background: '#fff' },
  table: { width: '100%', borderCollapse: 'collapse', minWidth: 1000, fontSize: 13 },
  th: {
    padding: '10px 12px', textAlign: 'left',
    fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
    letterSpacing: '0.06em', color: '#64748b', background: '#f8fafc',
    borderBottom: '1px solid #e2e8f0',
    position: 'sticky', top: 0, zIndex: 1, whiteSpace: 'nowrap',
  },
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
    padding: '10px 14px',
    background: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: 8,
    fontSize: 12, color: '#1e1b4b', lineHeight: 1.5,
    display: 'flex', alignItems: 'flex-start', gap: 8,
  },

  nextStepBox: {
    padding: '12px 16px',
    background: 'linear-gradient(135deg, #eef2ff 0%, #e0e7ff 100%)',
    border: '1px solid #c7d2fe', borderRadius: 10,
  },
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
  timelineDetail: { marginTop: 4, fontSize: 11, color: '#64748b', fontStyle: 'italic', lineHeight: 1.5, wordBreak: 'break-word' },
};

const modalCss = `
@keyframes aipFadeIn { from { opacity: 0 } to { opacity: 1 } }
@keyframes aipSlideUp { from { opacity: 0; transform: translateY(16px) scale(0.98) } to { opacity: 1; transform: translateY(0) scale(1) } }

/* ---------- Icon helpers used throughout this tab ---------- */
.aip-heading-icon {
  display: inline-flex; align-items: center; justify-content: center;
  width: 1em; height: 1em; margin-right: 8px; vertical-align: -0.15em;
  color: #1a1f26;
}
.aip-heading-icon svg { width: 100%; height: 100%; stroke-width: 2.2; }

.aip-btn-icon {
  width: 1em; height: 1em; flex-shrink: 0;
  stroke-width: 2.4;
}

.aip-banner-icon {
  display: inline-flex; align-items: center; justify-content: center;
  flex-shrink: 0; width: 22px; height: 22px;
  line-height: 1;
}
.aip-banner-icon svg { width: 100%; height: 100%; stroke-width: 2.2; }
.aip-banner-icon--info { color: #1e3a8a; }

.aip-section-icon {
  width: 16px; height: 16px; stroke-width: 2.2;
  color: #334155; flex-shrink: 0;
}

.aip-fx-note-icon {
  width: 16px; height: 16px; stroke-width: 2.4; flex-shrink: 0;
  color: #4338ca; margin-top: 1px;
}

.aip-next-step-icon {
  width: 12px; height: 12px; stroke-width: 2.6;
  color: #4338ca; flex-shrink: 0;
}

.timeline-dot-icon {
  width: 14px; height: 14px; stroke-width: 2.4;
  color: #ffffff;
}

/* ============================================================
   COLLAPSIBLE HELP — "Know more about this section" toggle
   ============================================================ */
.aip-info-toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  margin-bottom: 16px;
  border-radius: 999px;
  border: 1px solid #99f6e4;
  background: #f0fdfa;
  color: #0f766e;
  font-size: 13px;
  font-weight: 700;
  font-family: inherit;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
}
.aip-info-toggle:hover {
  background: #ccfbf1;
  border-color: #5eead4;
}
.aip-info-toggle.is-open {
  background: #ffffff;
  border-color: #cbd5e1;
  color: #334155;
}
.aip-info-toggle.is-open:hover {
  background: #f8fafc;
  border-color: #94a3b8;
}
.aip-info-toggle:focus-visible {
  outline: 2px solid #00b8b0;
  outline-offset: 2px;
}
.aip-info-toggle-icon {
  width: 1.1em;
  height: 1.1em;
  stroke-width: 2.4;
  flex-shrink: 0;
}
.aip-info-toggle-caret {
  width: 1em;
  height: 1em;
  stroke-width: 2.6;
  flex-shrink: 0;
  opacity: 0.75;
}

.aip-info-panel {
  animation: aipInfoIn 0.22s ease;
}
@keyframes aipInfoIn {
  from { opacity: 0; transform: translateY(-4px); }
  to   { opacity: 1; transform: translateY(0); }
}

/* ============================================================
   PO TYPE FILTER
   ============================================================ */
.aip-type-filter-bar {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
  padding: 14px 18px;
  margin-bottom: 20px;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.04);
}

.aip-type-filter-label {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  font-weight: 800;
  color: #0f766e;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  flex-shrink: 0;
  white-space: nowrap;
}
.aip-type-filter-label-icon {
  width: 1.15em;
  height: 1.15em;
  stroke-width: 2.6;
  color: #0f766e;
  flex-shrink: 0;
}

.aip-type-filter {
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

.aip-type-filter-btn {
  flex: 1 1 0;
  padding: 11px 22px;
  min-height: 44px;
  font-size: 14px;
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
  transition:
    background 0.15s ease,
    color 0.15s ease,
    box-shadow 0.15s ease,
    transform 0.1s ease;
}

.aip-type-filter-btn:hover:not(.is-active) {
  background: #ffffff;
  color: #0f172a;
}

.aip-type-filter-btn:active:not(.is-active) {
  transform: scale(0.98);
}

.aip-type-filter-btn.is-active {
  background: linear-gradient(135deg, #00e0d4 0%, #00b8b0 45%, #008a82 100%);
  color: #ffffff;
  box-shadow:
    0 2px 8px rgba(0, 138, 130, 0.45),
    0 0 0 1px rgba(0, 138, 130, 0.2) inset;
}

.aip-type-filter-btn.is-active:hover {
  color: #ffffff;
}

.aip-type-filter-btn:focus-visible {
  outline: 2px solid #00b8b0;
  outline-offset: 2px;
}

/* ============================================================
   RECENT IMPORTS
   ============================================================ */

.aip-recent-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: 14px;
}
.aip-recent-header-left { min-width: 0; flex: 1 1 260px; }
.aip-recent-header-left h4 {
  margin: 0 0 4px;
  font-size: clamp(15px, 1.4vw, 17px);
  font-weight: 800;
  color: #0f172a;
  letter-spacing: -0.01em;
}
.aip-recent-sub {
  margin: 0;
  font-size: 12.5px;
  color: #64748b;
  line-height: 1.5;
  max-width: 640px;
}
.aip-recent-refresh {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
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
.aip-recent-refresh:hover:not(:disabled) {
  background: #f8fafc;
  border-color: #94a3b8;
}
.aip-recent-refresh:disabled { opacity: 0.55; cursor: not-allowed; }
.aip-recent-refresh-icon { width: 1em; height: 1em; stroke-width: 2.5; }

.aip-recent-kpis {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 10px;
  margin-bottom: 16px;
}
.aip-recent-kpi {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  min-width: 0;
}
.aip-recent-kpi-icon {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  flex-shrink: 0;
}
.aip-recent-kpi-icon svg { width: 1em; height: 1em; stroke-width: 2.2; }
.aip-recent-kpi-body { min-width: 0; flex: 1; }
.aip-recent-kpi-label {
  font-size: 10px;
  font-weight: 700;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 2px;
}
.aip-recent-kpi-value {
  font-size: 20px;
  font-weight: 800;
  color: #0f172a;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  letter-spacing: -0.02em;
  line-height: 1.1;
}
.aip-recent-kpi--total .aip-recent-kpi-icon { background: #ecfeff; color: #0e7490; }
.aip-recent-kpi--po    .aip-recent-kpi-icon { background: #dcfce7; color: #047857; }
.aip-recent-kpi--pr    .aip-recent-kpi-icon { background: #fff7ed; color: #c2410c; }
.aip-recent-kpi--lines .aip-recent-kpi-icon { background: #eef2ff; color: #4338ca; }

.aip-po-cell {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex-wrap: wrap;
}
.aip-type-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  box-shadow: 0 0 0 3px rgba(15, 23, 42, 0.06);
}
.aip-type-dot--po { background: #0f766e; }
.aip-type-dot--pr { background: #ea580c; }

.aip-new-pill {
  display: inline-block;
  padding: 1px 7px;
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.06em;
  color: #065f46;
  background: #d1fae5;
  border: 1px solid #6ee7b7;
  border-radius: 4px;
  vertical-align: middle;
}

.aip-vendor-cell {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.aip-vendor-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.02em;
  flex-shrink: 0;
  border: 1px solid;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
}
.aip-vendor-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
  color: #0f172a;
}

.aip-imported-cell {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}
.aip-imported-by {
  font-size: 12.5px;
  font-weight: 600;
  color: #334155;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.aip-imported-at {
  font-size: 11px;
  color: #94a3b8;
  font-weight: 500;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
}

.aip-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 44px 20px 40px;
  gap: 10px;
}
.aip-empty-icon-circle {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: linear-gradient(135deg, #f0fdfa 0%, #ecfeff 100%);
  border: 1px solid #99f6e4;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #0f766e;
  margin-bottom: 4px;
}
.aip-empty-icon-svg { width: 30px; height: 30px; stroke-width: 1.8; }
.aip-empty-title {
  font-size: 16px;
  font-weight: 800;
  color: #0f172a;
  letter-spacing: -0.01em;
}
.aip-empty-sub {
  font-size: 13px;
  color: #64748b;
  max-width: 420px;
  line-height: 1.55;
}
.aip-empty-cta {
  margin-top: 8px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 11px 22px;
  border-radius: 10px;
  border: none;
  background: linear-gradient(135deg, #00e0d4 0%, #00b8b0 45%, #008a82 100%);
  color: #ffffff;
  font-size: 14px;
  font-weight: 700;
  font-family: inherit;
  cursor: pointer;
  box-shadow:
    0 2px 8px rgba(0, 138, 130, 0.32),
    0 0 0 1px rgba(0, 138, 130, 0.15) inset;
  transition: transform 0.1s ease, box-shadow 0.15s ease;
}
.aip-empty-cta:hover {
  box-shadow:
    0 4px 14px rgba(0, 138, 130, 0.42),
    0 0 0 1px rgba(0, 138, 130, 0.2) inset;
}
.aip-empty-cta:active { transform: scale(0.98); }
.aip-empty-cta:focus-visible {
  outline: 2px solid #00b8b0;
  outline-offset: 2px;
}

.aip-clickable-row.is-pr-based:hover { background: #fffbf5 !important; }

@media (max-width: 900px) {
  .aip-type-filter-bar { gap: 12px; padding: 12px 14px; }
  .aip-type-filter-btn { padding: 10px 16px; font-size: 13.5px; }
  .aip-recent-kpis { grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); }
  .aip-recent-kpi-value { font-size: 18px; }
}

@media (max-width: 640px) {
  .aip-type-filter-bar { flex-direction: column; align-items: stretch; gap: 10px; padding: 12px 14px; }
  .aip-type-filter-label { justify-content: flex-start; }
  .aip-type-filter { flex-direction: column; align-items: stretch; gap: 6px; }
  .aip-type-filter-btn { width: 100%; flex: 1 1 auto; padding: 13px 16px; min-height: 48px; font-size: 14px; }
  .aip-recent-header { flex-direction: column; align-items: stretch; }
  .aip-recent-refresh { align-self: flex-start; }
  .aip-recent-kpis { grid-template-columns: repeat(2, 1fr); }
  .aip-vendor-avatar { width: 24px; height: 24px; font-size: 10px; }
  .aip-new-pill { font-size: 8px; padding: 1px 5px; }
  .aip-empty { padding: 36px 16px 32px; }
}

@media (max-width: 380px) {
  .aip-type-filter-btn { padding: 12px 14px; font-size: 13px; min-height: 46px; }
  .aip-type-filter-label { font-size: 11px; }
  .aip-recent-kpis { grid-template-columns: 1fr; }
  .aip-recent-kpi-value { font-size: 18px; }
  .aip-recent-kpi-icon { width: 36px; height: 36px; font-size: 18px; }
  .aip-info-toggle { font-size: 12px; padding: 7px 12px; }
}

.aip-table {
  width: 100%;
  min-width: 900px;
  table-layout: fixed;
}
.aip-table .col-po-no   { width: 20%; }
.aip-table .col-po-date { width: 13%; }
.aip-table .col-pr-no   { width: 11%; }
.aip-table .col-vendor  { width: 22%; }
.aip-table .col-lines   { width: 8%; }
.aip-table .col-status  { width: 14%; }
.aip-table .col-by      { width: 10%; }
.aip-table .col-hint    { width: 6%; }

.aip-table thead th {
  padding: 14px 16px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: #475569;
  background: #f8fafc;
  text-align: left;
  border-bottom: 1px solid #e2e8f0;
  white-space: nowrap;
}
.aip-table tbody td {
  padding: 14px 16px;
  font-size: 14px;
  vertical-align: middle;
  border-bottom: 1px solid #f1f5f9;
  color: #0f172a;
}
.aip-table .col-vendor {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.aip-table .po-no-big {
  display: inline-block;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-size: 16px;
  font-weight: 700;
  color: #0f766e;
  letter-spacing: 0.02em;
  line-height: 1.2;
  word-break: break-word;
}

.aip-clickable-row {
  cursor: pointer;
  transition: background 0.15s ease;
}
.aip-clickable-row:hover {
  background: #f0fdfa !important;
}
.aip-clickable-row:active {
  background: #e6fffb !important;
}
.aip-clickable-row:hover .aip-chevron {
  color: #0f766e;
  transform: translateX(2px);
}

.aip-chevron {
  display: inline-block;
  font-size: 13px;
  font-weight: 600;
  color: #94a3b8;
  transition: color 0.15s ease, transform 0.15s ease;
  white-space: nowrap;
}

.deliv-badge {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 2px 9px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.02em;
  white-space: nowrap;
}
.deliv-badge svg.deliv-icon {
  width: 1em; height: 1em; stroke-width: 2.4; flex-shrink: 0;
}
.deliv-badge--complete {
  background: #dcfce7; color: #065f46; border: 1px solid #86efac;
}
.deliv-badge--partial {
  background: #fef3c7; color: #92400e; border: 1px solid #fcd34d;
}
.aip-partial-inline {
  margin-left: 6px;
  font-size: 9px;
  padding: 1px 6px;
}

.aip-pr-pill {
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
.aip-pr-pill--inline { margin-left: 0; }
.aip-pr-pill--modal  { margin-left: 8px; }
.aip-type-pill {
  display: inline-block;
  padding: 1px 7px;
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.06em;
  border-radius: 4px;
}
.aip-type-pill--po {
  background: #ecfeff;
  color: #0e7490;
  border: 1px solid #a5f3fc;
}

.aipd-close:hover { background: #f1f5f9; color: #0f172a; }
.aipd-body::-webkit-scrollbar { width: 8px; }
.aipd-body::-webkit-scrollbar-track { background: #f1f5f9; border-radius: 4px; }
.aipd-body::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 4px; }
.aipd-body::-webkit-scrollbar-thumb:hover { background: #94a3b8; }

@media (max-width: 720px) {
  .aipd-footer button { flex: 1 1 auto; }
  .aipd-footer { justify-content: stretch !important; }
}

@media (max-width: 480px) {
  .aipd-overlay { padding: 0; }
  .aipd-card {
    max-height: 100vh;
    border-radius: 0;
    width: 100vw;
    height: 100vh;
  }
}

@media (prefers-reduced-motion: reduce) {
  .aipd-card, .aipd-overlay { animation: none !important; }
  .aip-clickable-row { transition: none !important; }
  .aip-chevron { transition: none !important; }
  .aip-type-filter-btn { transition: none !important; }
  .aip-recent-refresh { transition: none !important; }
  .aip-empty-cta { transition: none !important; }
  .aip-info-toggle { transition: none !important; }
  .aip-info-panel { animation: none !important; }
}
`;

export default TabImportPo;