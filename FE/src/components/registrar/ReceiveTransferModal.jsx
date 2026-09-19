// src/components/registrar/ReceiveTransferModal.jsx
import React, { useEffect, useState } from 'react';
import { stockTransferApi, itemMasterApi } from '../../services/api';
import ItemImageThumb from '../shared/ItemImageThumb';

// ============================================================
// Helpers
// ============================================================
const formatDateTime = (v) => {
  if (!v) return '—';
  try {
    return new Date(v).toLocaleString();
  } catch {
    return v;
  }
};

const ReceiveTransferModal = ({ sts, onClose, onReceived }) => {
  const [detail, setDetail]       = useState(null);
  const [loading, setLoading]     = useState(true);
  const [saving, setSaving]       = useState(false);
  const [images, setImages]       = useState({});
  const [remarks, setRemarks]     = useState('');
  const [error, setError]         = useState('');

  // ---- Load full detail on mount ----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await stockTransferApi.getSTSDetail(sts.sts_id);
        if (cancelled) return;
        if (!res.ok || !res.data) {
          setError('Could not load transfer details.');
          return;
        }
        setDetail(res.data);

        // Load item images
        const codes = [...new Set((res.data.lines || []).map((l) => l.item_code).filter(Boolean))];
        if (codes.length > 0) {
          try {
            const imgRes = await itemMasterApi.getImagesByCodes(codes);
            if (!cancelled && imgRes.ok && imgRes.data?.images) {
              setImages(imgRes.data.images);
            }
          } catch (e) {
            console.warn('Could not load item images:', e);
          }
        }
      } catch (err) {
        console.error(err);
        if (!cancelled) setError('Error loading transfer details.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [sts.sts_id]);

  // ============================================================
  // Confirm receipt
  // ============================================================
  const handleConfirm = async () => {
    if (!detail) return;

    const linesCount = detail.lines?.length || 0;
    const totalQty = (detail.lines || []).reduce((s, l) => s + (Number(l.qty) || 0), 0);

    const confirmMsg =
      `📥 Confirm receipt of ${detail.sts_no}?\n\n` +
      `From:  ${detail.from_warehouse_code || `WH ${detail.from_warehouse_id}`} — ${detail.from_warehouse_name || ''}\n` +
      `Lines: ${linesCount}\n` +
      `Qty:   ${totalQty}\n\n` +
      `Once confirmed, the slip is marked as Received. Proceed?`;
    if (!window.confirm(confirmMsg)) return;

    setSaving(true);
    setError('');
    try {
      const res = await stockTransferApi.receiveSTS(detail.sts_id, remarks);
      if (!res.ok || !res.data?.success) {
        setError(res.data?.message || 'Failed to confirm receipt.');
        return;
      }
      onReceived?.();
      onClose?.();
    } catch (err) {
      console.error(err);
      setError('Error confirming receipt.');
    } finally {
      setSaving(false);
    }
  };

  const isAlreadyReceived = detail?.status === 'Received';
  const canReceive        = detail?.status === 'Approved';

  // ============================================================
  // Render
  // ============================================================
  return (
    <>
      <style>{modalCss}</style>

      <div
        className="rtm-overlay"
        style={styles.overlay}
        onClick={saving ? undefined : onClose}
      >
        <div
          className="rtm-card"
          style={styles.card}
          onClick={(e) => e.stopPropagation()}
        >
          {/* ---------- HEADER ---------- */}
          <div style={styles.header}>
            <div style={styles.headerLeft}>
              <div style={styles.headerIcon}>📥</div>
              <div style={{ minWidth: 0 }}>
                <h3 style={styles.headerTitle}>
                  {isAlreadyReceived ? 'Received Transfer' : 'Receive Stock Transfer'}
                </h3>
                <div style={styles.headerSub}>
                  <span style={styles.headerStsNo}>{sts.sts_no}</span>
                  <span style={styles.headerDot}>·</span>
                  <span>
                    {sts.from_warehouse_code || `WH ${sts.from_warehouse_id}`}
                    {' '}→{' '}
                    {sts.to_warehouse_code   || `WH ${sts.to_warehouse_id}`}
                  </span>
                </div>
              </div>
            </div>
            <button
              type="button"
              className="rtm-close"
              onClick={onClose}
              disabled={saving}
              style={styles.closeBtn}
              title="Close"
            >
              ✕
            </button>
          </div>

          {/* ---------- BODY ---------- */}
          <div className="rtm-body" style={styles.body}>
            {loading ? (
              <div style={styles.loadingBox}>Loading transfer details…</div>
            ) : !detail ? (
              <div style={styles.errorBox}>
                {error || 'Could not load transfer details.'}
              </div>
            ) : (
              <>
                {/* Meta grid */}
                <div style={styles.metaGrid}>
                  <Meta label="STS No."     value={detail.sts_no} mono />
                  <Meta label="Status"      value={detail.status} />
                  <Meta label="Transfer Date" value={detail.transfer_date} />
                  <Meta label="PO No."      value={detail.po_no || '—'} mono />
                  <Meta label="From"        value={`${detail.from_warehouse_code || ''} ${detail.from_warehouse_name || ''}`.trim() || `WH ${detail.from_warehouse_id}`} />
                  <Meta label="To"          value={`${detail.to_warehouse_code || ''} ${detail.to_warehouse_name || ''}`.trim() || `WH ${detail.to_warehouse_id}`} />
                  <Meta label="Submitted By" value={detail.submitted_by || '—'} />
                  <Meta label="Submitted At" value={formatDateTime(detail.submitted_at)} />
                  <Meta label="Approved By"  value={detail.approved_by || '—'} />
                  <Meta label="Approved At"  value={formatDateTime(detail.approved_at)} />
                  {isAlreadyReceived && (
                    <>
                      <Meta label="Received By" value={detail.received_by || '—'} />
                      <Meta label="Received At" value={formatDateTime(detail.received_at)} />
                    </>
                  )}
                </div>

                {detail.remarks && (
                  <div style={styles.noteBox}>
                    <span style={styles.noteIcon}>📝</span>
                    <div>
                      <div style={styles.noteLabel}>Transfer Remarks</div>
                      <div style={styles.noteText}>{detail.remarks}</div>
                    </div>
                  </div>
                )}

                {/* Lines table */}
                <div style={styles.sectionHead}>
                  <span style={styles.sectionTitle}>
                    📦 Items <span style={styles.sectionCount}>({detail.lines?.length || 0})</span>
                  </span>
                </div>

                <div style={styles.tableWrap}>
                  <table style={styles.table}>
                    <thead>
                      <tr>
                        <th style={styles.th}>Item</th>
                        <th style={{ ...styles.th, textAlign: 'center' }}>UOM</th>
                        <th style={{ ...styles.th, textAlign: 'center' }}>Qty</th>
                        <th style={styles.th}>Price</th>
                        <th style={styles.th}>Remarks</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(detail.lines || []).length === 0 ? (
                        <tr>
                          <td colSpan={5} style={{ textAlign: 'center', padding: 24, color: '#94a3b8' }}>
                            No lines found.
                          </td>
                        </tr>
                      ) : (
                        detail.lines.map((l, idx) => (
                          <tr key={l.sts_line_id ?? `${l.item_code}-${idx}`} style={styles.row}>
                            <td style={styles.tdItem}>
                              <div style={styles.itemCell}>
                                <ItemImageThumb
                                  src={images[l.item_code]}
                                  alt={l.item_code}
                                  size={44}
                                />
                                <div style={{ minWidth: 0, flex: 1 }}>
                                  <div style={styles.itemCode}>{l.item_code}</div>
                                  <div style={styles.itemName} title={l.item_name}>
                                    {l.item_name || '—'}
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td style={{ ...styles.td, textAlign: 'center' }}>
                              <span style={styles.uomTag}>{l.uom || '—'}</span>
                            </td>
                            <td style={{ ...styles.td, textAlign: 'center', fontWeight: 700 }}>
                              {l.qty}
                            </td>
                            <td style={styles.td}>
                              {l.unit_price != null
                                ? `${Number(l.unit_price).toFixed(2)} ${l.currency || ''}`
                                : '—'}
                            </td>
                            <td style={{ ...styles.td, color: '#64748b', fontSize: 12 }}>
                              {l.remarks || '—'}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Remarks input — only when action is available */}
                {canReceive && (
                  <div style={styles.remarksBlock}>
                    <label style={styles.remarksLabel}>
                      Receipt Remarks (optional)
                    </label>
                    <textarea
                      value={remarks}
                      onChange={(e) => setRemarks(e.target.value)}
                      disabled={saving}
                      placeholder="e.g. All items arrived in good condition."
                      rows={2}
                      style={styles.remarksInput}
                    />
                  </div>
                )}

                {isAlreadyReceived && detail.receive_remarks && (
                  <div style={styles.noteBox}>
                    <span style={styles.noteIcon}>✅</span>
                    <div>
                      <div style={styles.noteLabel}>Receipt Remarks</div>
                      <div style={styles.noteText}>{detail.receive_remarks}</div>
                    </div>
                  </div>
                )}

                {error && (
                  <div style={styles.errorBox}>
                    <span style={{ marginRight: 6 }}>⚠️</span>
                    {error}
                  </div>
                )}
              </>
            )}
          </div>

          {/* ---------- FOOTER ---------- */}
          <div style={styles.footer}>
            <button
              type="button"
              className="cancel-btn"
              onClick={onClose}
              disabled={saving}
            >
              {canReceive ? 'Cancel' : 'Close'}
            </button>

            {canReceive && (
              <button
                type="button"
                className="save-btn"
                onClick={handleConfirm}
                disabled={saving || loading || !detail}
              >
                {saving ? 'Confirming…' : '✅ Confirm Receipt'}
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

// ============================================================
// Small helper
// ============================================================
const Meta = ({ label, value, mono }) => (
  <div style={styles.metaBox}>
    <div style={styles.metaLabel}>{label}</div>
    <div
      style={{
        ...styles.metaValue,
        ...(mono ? styles.metaValueMono : null),
      }}
    >
      {value}
    </div>
  </div>
);

// ============================================================
// Inline styles
// ============================================================
const styles = {
  overlay: {
    position: 'fixed', inset: 0,
    background: 'rgba(15, 23, 42, 0.62)',
    backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 10000, padding: 'clamp(8px, 2vw, 24px)',
    animation: 'rtmFadeIn 0.18s ease',
  },
  card: {
    background: '#ffffff',
    borderRadius: 'clamp(12px, 1.5vw, 18px)',
    width: '100%', maxWidth: 980, maxHeight: '92vh',
    display: 'flex', flexDirection: 'column', overflow: 'hidden',
    boxShadow: '0 24px 64px rgba(15, 23, 42, 0.28), 0 4px 14px rgba(15, 23, 42, 0.14)',
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    animation: 'rtmSlideUp 0.22s cubic-bezier(0.34, 1.3, 0.64, 1)',
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
    margin: 0, fontSize: 'clamp(16px, 1.6vw, 20px)',
    fontWeight: 700, color: '#0f172a',
    letterSpacing: '-0.01em', lineHeight: 1.2,
  },
  headerSub: {
    fontSize: 'clamp(11px, 1vw, 13px)', color: '#64748b', marginTop: 4,
    display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6,
  },
  headerStsNo: {
    fontFamily: "'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace",
    fontWeight: 700,
    color: '#0f766e',
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

  loadingBox: {
    padding: 24,
    textAlign: 'center',
    color: '#64748b',
    fontSize: 14,
  },
  errorBox: {
    display: 'flex', alignItems: 'flex-start', gap: 8,
    padding: '10px 14px',
    background: '#fef2f2',
    border: '1px solid #fecaca',
    borderRadius: 8,
    fontSize: 13, color: '#991b1b',
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
  metaValueMono: {
    fontFamily: "'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace",
  },

  noteBox: {
    display: 'flex', alignItems: 'flex-start', gap: 10,
    padding: '10px 14px',
    background: '#eff6ff',
    border: '1px solid #bfdbfe',
    borderRadius: 8,
  },
  noteIcon: { fontSize: 16, lineHeight: 1.2, flexShrink: 0 },
  noteLabel: {
    fontSize: 10,
    fontWeight: 700,
    color: '#1e40af',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    marginBottom: 3,
  },
  noteText: {
    fontSize: 13,
    color: '#1e3a8a',
    lineHeight: 1.5,
    whiteSpace: 'pre-wrap',
  },

  sectionHead: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    gap: 12, flexWrap: 'wrap', marginTop: 4,
  },
  sectionTitle: { fontSize: 14, fontWeight: 700, color: '#0f172a' },
  sectionCount: { color: '#64748b', fontWeight: 500 },

  tableWrap: {
    overflow: 'auto',
    maxHeight: '42vh',
    border: '1px solid #e2e8f0',
    borderRadius: 10,
    background: '#fff',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    minWidth: 640,
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

  remarksBlock: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  remarksLabel: {
    fontSize: 11,
    fontWeight: 700,
    color: '#475569',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
  },
  remarksInput: {
    width: '100%',
    padding: '10px 12px',
    fontSize: 13,
    border: '1.5px solid #cbd5e1',
    borderRadius: 8,
    background: '#fff',
    color: '#0f172a',
    fontFamily: 'inherit',
    resize: 'vertical',
    outline: 'none',
  },
};

// ============================================================
// CSS
// ============================================================
const modalCss = `
@keyframes rtmFadeIn { from { opacity: 0 } to { opacity: 1 } }
@keyframes rtmSlideUp {
  from { opacity: 0; transform: translateY(16px) scale(0.98) }
  to   { opacity: 1; transform: translateY(0) scale(1) }
}
.rtm-close:hover:not(:disabled) { background: #f1f5f9; color: #0f172a; }
.rtm-close:disabled { opacity: 0.4; cursor: not-allowed; }

.rtm-body::-webkit-scrollbar { width: 8px; }
.rtm-body::-webkit-scrollbar-track { background: #f1f5f9; border-radius: 4px; }
.rtm-body::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 4px; }
.rtm-body::-webkit-scrollbar-thumb:hover { background: #94a3b8; }

@media (max-width: 480px) {
  .rtm-overlay { padding: 0; }
  .rtm-card {
    max-height: 100vh;
    border-radius: 0;
    width: 100vw;
    height: 100vh;
  }
}

@media (prefers-reduced-motion: reduce) {
  .rtm-card, .rtm-overlay { animation: none !important; }
}
`;

export default ReceiveTransferModal;