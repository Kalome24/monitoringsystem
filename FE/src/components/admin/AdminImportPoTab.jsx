// src/components/admin/AdminImportPoTab.jsx
import React, { useCallback, useEffect, useState } from 'react';
import { usePermissions } from '../../permissions/usePermissions';
import { importPoApi, itemMasterApi } from '../../services/api';
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
const AdminImportPoTab = () => {
  const { can } = usePermissions();

  const [showImport, setShowImport] = useState(false);
  const [recent, setRecent]         = useState([]);
  const [loading, setLoading]       = useState(false);

  // ---- Detail modal state ----
  const [detail, setDetail]               = useState(null);
  const [detailLines, setDetailLines]     = useState([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailImages, setDetailImages]   = useState({});
  const [detailActivity, setDetailActivity] = useState([]);
  const [detailActivityLoading, setDetailActivityLoading] = useState(false);

  // ============================================================
  // Load the most recent POs for the preview table
  // ============================================================
  const loadRecent = useCallback(async () => {
    setLoading(true);
    try {
      const res = await importPoApi.listPOs({ page: 1, limit: PO_PREVIEW_LIMIT });
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
  }, []);

  useEffect(() => { loadRecent(); }, [loadRecent]);

  const handleImported = async () => {
    await loadRecent();
  };

  // ============================================================
  // Open the detail modal — fetches lines + activity in parallel
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
  // RENDER
  // ============================================================
  return (
    <div className="items-section">
      <style>{modalCss}</style>

      {/* ============ SECTION HEADER ============ */}
      <div className="section-header">
        <h3>📥 Import Purchase Orders</h3>
        <div className="header-actions">
          {can('importpo.create') && (
            <button
              className="add-user-btn"
              onClick={() => setShowImport(true)}
            >
              <span className="btn-icon">📄</span>
              <span>Import PO</span>
            </button>
          )}
        </div>
      </div>

      {/* ============ INFO BANNER ============ */}
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
        <span style={{ fontSize: 22, lineHeight: 1 }}>🌐</span>
        <div>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>
            Global PO import
          </div>
          <div>
            Importing is centralized: you upload the file, and every Stock
            Registrar sees the resulting POs in their{' '}
            <strong>Receive PO/PR</strong> tab. When a Registrar receives a
            delivery, their warehouse becomes the designated warehouse for the
            lines they accept. There is no per-warehouse assignment at import
            time.
          </div>
        </div>
      </div>

      {/* ============ HOW IT WORKS ============ */}
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
          title="Upload the Excel file"
          body="One file, one import. Duplicate POs are blocked at the door — a PO number can only be imported once."
        />
        <StepCard
          n="2"
          title="Every Registrar sees it"
          body="The PO appears in every warehouse's Receive PO/PR list."
        />
        <StepCard
          n="3"
          title="Designated warehouse receives it"
          body="The warehouse whose Registrar receives the delivery is designated for those lines. Its Stock Handler can then transfer or store them."
        />
      </div>

      {/* ============ RECENT IMPORTS PREVIEW ============ */}
      <div className="daily-items-section">
        <div className="daily-items-header">
          <h4>Recently Imported POs</h4>
          <span className="daily-items-count">
            {recent.length === 0
              ? '0 PO(s)'
              : `Latest ${recent.length} — click any row for activity`}
          </span>
        </div>

        <div className="table-wrapper">
          {loading ? (
            <div className="loading-spinner" style={{ margin: '20px auto' }} />
          ) : recent.length > 0 ? (
            <table className="data-table aip-table">
              <thead>
                <tr>
                  <th className="col-po-no">PO No.</th>
                  <th className="col-po-date">PO Date</th>
                  <th className="col-pr-no">PR No.</th>
                  <th className="col-vendor">Vendor</th>
                  <th className="col-lines" style={{ textAlign: 'center' }}>Lines</th>
                  <th className="col-status">Status</th>
                  <th className="col-by">Imported By</th>
                  <th className="col-hint" style={{ textAlign: 'right' }}></th>
                </tr>
              </thead>
              <tbody>
                {recent.map((po) => (
                  <tr
                    key={po.po_no}
                    onClick={() => handleOpenDetail(po)}
                    className="aip-clickable-row"
                    title="Click to view activity timeline"
                  >
                    <td className="col-po-no">
                      <span className="po-no-big">{po.po_no}</span>
                    </td>
                    <td className="col-po-date">{po.po_date || '—'}</td>
                    <td className="col-pr-no">{po.pr_no || '—'}</td>
                    <td className="col-vendor">{po.vendor_name || '—'}</td>
                    <td className="col-lines" style={{ textAlign: 'center', fontWeight: 600 }}>
                      {po.line_count ?? '—'}
                    </td>
                    <td className="col-status">
                      <span className={statusBadgeClass(po.status)}>{po.status}</span>
                    </td>
                    <td className="col-by">{po.imported_by || '—'}</td>
                    <td className="col-hint" style={{ textAlign: 'right' }}>
                      <span className="aip-chevron">View ›</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="no-items-message">
              <p>No POs imported yet. Click "📄 Import PO" to get started.</p>
            </div>
          )}
        </div>
      </div>

      {/* ============ IMPORT MODAL ============ */}
      {showImport && (
        <ImportPoModal
          onClose={() => setShowImport(false)}
          onImported={handleImported}
        />
      )}

      {/* ============================================================
          DETAIL MODAL — activity timeline + PO lines
          ============================================================ */}
      {detail && (
        <div className="aipd-overlay" style={mStyles.overlay} onClick={closeDetail}>
          <div
            className="aipd-card"
            style={mStyles.card}
            onClick={(e) => e.stopPropagation()}
          >
            {/* ---------- HEADER ---------- */}
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
                className="aipd-close"
                onClick={closeDetail}
                style={mStyles.closeBtn}
              >
                ✕
              </button>
            </div>

            {/* ---------- BODY ---------- */}
            <div className="aipd-body" style={mStyles.body}>
              {/* Meta grid */}
              <div className="aipd-meta-grid" style={mStyles.metaGrid}>
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

              {/* PO Lines */}
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

              {/* Next step */}
              <div style={mStyles.nextStepBox}>
                <div style={mStyles.nextStepLabel}>🎯 What's next</div>
                <div style={mStyles.nextStepValue}>{nextStepFor(detail.status)}</div>
              </div>

              {/* Activity timeline */}
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

            {/* ---------- FOOTER ---------- */}
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

// ============================================================
// Small presentational helper for the 3-step explainer
// ============================================================
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
    width: '100%', maxWidth: 1080, maxHeight: '92vh',
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

  metaGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 },
  metaBox: { padding: '10px 14px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8 },
  metaLabel: { fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 },
  metaValue: { fontSize: 13, fontWeight: 600, color: '#0f172a', wordBreak: 'break-word' },

  sectionHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginTop: 4 },
  sectionTitle: { fontSize: 14, fontWeight: 700, color: '#0f172a' },
  sectionCount: { color: '#64748b', fontWeight: 500 },

  tableWrap: { overflow: 'auto', maxHeight: '40vh', border: '1px solid #e2e8f0', borderRadius: 10, background: '#fff' },
  table: { width: '100%', borderCollapse: 'collapse', minWidth: 620, fontSize: 13 },
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

  nextStepBox: {
    padding: '12px 16px',
    background: 'linear-gradient(135deg, #eef2ff 0%, #e0e7ff 100%)',
    border: '1px solid #c7d2fe', borderRadius: 10,
  },
  nextStepLabel: { fontSize: 10, fontWeight: 700, color: '#4338ca', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 },
  nextStepValue: { fontSize: 13, fontWeight: 600, color: '#1e1b4b', lineHeight: 1.5 },

  timelineWrap: { display: 'flex', flexDirection: 'column', padding: '4px 0' },
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
  timelineDetail: { marginTop: 4, fontSize: 11, color: '#64748b', fontStyle: 'italic', lineHeight: 1.5, wordBreak: 'break-word' },
};

// ============================================================
// CSS
// ============================================================
const modalCss = `
@keyframes aipFadeIn { from { opacity: 0 } to { opacity: 1 } }
@keyframes aipSlideUp { from { opacity: 0; transform: translateY(16px) scale(0.98) } to { opacity: 1; transform: translateY(0) scale(1) } }

/* ---- Recent imports table ---- */
.aip-table {
  width: 100%;
  min-width: 900px;
  table-layout: fixed;
}
.aip-table .col-po-no   { width: 16%; }
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

/* ---- Detail modal ---- */
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
}
`;

export default AdminImportPoTab;