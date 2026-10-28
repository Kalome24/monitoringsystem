// src/components/registrar/ReceiveTransferModal.jsx
import React, { useEffect, useMemo, useState } from 'react';
import {
  FiInbox,
  FiX,
  FiEdit3,
  FiInfo,
  FiPackage,
  FiCheckCircle,
  FiAlertTriangle,
} from 'react-icons/fi';
import { stockTransferApi, itemMasterApi } from '../../services/api';
import ModalBanner from '../shared/ModalBanner';
import ItemImageThumb from '../shared/ItemImageThumb';

const formatDateTime = (v) => {
  if (!v) return '—';
  try { return new Date(v).toLocaleString(); } catch { return v; }
};

const ReceiveTransferModal = ({ sts, onClose, onReceived }) => {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [images, setImages] = useState({});
  const [remarks, setRemarks] = useState('');

  // Unified inline feedback banner
  // { type: 'success'|'error'|'warning'|'info', title?: string, message: string } | null
  const [feedback, setFeedback] = useState(null);

  // Design A semantics:
  //   received_qty = TOTAL units that arrived (good + damaged)
  //   damaged_qty  = SUBSET of received_qty that is damaged
  const [lineInputs, setLineInputs] = useState({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await stockTransferApi.getSTSDetail(sts.sts_id);
        if (cancelled) return;
        if (!res.ok || !res.data) {
          setFeedback({
            type: 'error',
            title: 'Load failed',
            message: 'Could not load transfer details.',
          });
          return;
        }
        setDetail(res.data);

        const seed = {};
        for (const line of res.data.lines || []) {
          const sent = Number(line.qty) || 0;
          seed[line.sts_line_id] = {
            received_qty: sent,
            damaged_qty:  0,
            damage_reason: '',
          };
        }
        setLineInputs(seed);

        const codes = [...new Set((res.data.lines || []).map((l) => l.item_code).filter(Boolean))];
        if (codes.length > 0) {
          try {
            const imgRes = await itemMasterApi.getImagesByCodes(codes);
            if (!cancelled && imgRes.ok && imgRes.data?.images) setImages(imgRes.data.images);
          } catch { /* ignore */ }
        }
      } catch (err) {
        console.error(err);
        if (!cancelled) {
          setFeedback({
            type: 'error',
            title: 'Load failed',
            message: 'Error loading transfer details.',
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [sts.sts_id]);

  const canReceive = detail?.status === 'In-Transit' || detail?.status === 'Arrived';
  const isAlreadyReceived = ['Received', 'Completed'].includes(detail?.status);

  const handleChange = (lineId, field, value) => {
    setLineInputs((prev) => ({
      ...prev,
      [lineId]: { ...(prev[lineId] || {}), [field]: value },
    }));
  };

  const validationErrors = useMemo(() => {
    if (!detail?.lines) return [];
    const errs = [];
    for (const line of detail.lines) {
      const input = lineInputs[line.sts_line_id] || {};
      const recv = Number(input.received_qty) || 0;
      const dmg  = Number(input.damaged_qty) || 0;
      const sent = Number(line.qty) || 0;

      if (recv < 0 || dmg < 0) {
        errs.push(`Line ${line.line_no}: negative quantities not allowed.`);
        continue;
      }
      if (recv > sent) {
        errs.push(`Line ${line.line_no}: received (${recv}) cannot exceed sent (${sent}).`);
      }
      if (dmg > recv) {
        errs.push(`Line ${line.line_no}: damaged (${dmg}) cannot exceed received (${recv}).`);
      }
      if (dmg > 0 && !String(input.damage_reason || '').trim()) {
        errs.push(`Line ${line.line_no}: damage reason is required when damaged > 0.`);
      }
    }
    return errs;
  }, [detail, lineInputs]);

  const totals = useMemo(() => {
    if (!detail?.lines) return { sent: 0, received: 0, damaged: 0, good: 0 };
    let sent = 0, received = 0, damaged = 0;
    for (const line of detail.lines) {
      const input = lineInputs[line.sts_line_id] || {};
      sent     += Number(line.qty) || 0;
      received += Number(input.received_qty) || 0;
      damaged  += Number(input.damaged_qty)  || 0;
    }
    return { sent, received, damaged, good: Math.max(0, received - damaged) };
  }, [detail, lineInputs]);

  const handleConfirm = async () => {
    if (!detail) return;
    setFeedback(null);

    if (validationErrors.length > 0) {
      setFeedback({
        type: 'warning',
        title: 'Validation',
        message: validationErrors[0],
      });
      return;
    }

    const confirmMsg =
      `Confirm receipt of ${detail.sts_no}?\n\n` +
      `Lines: ${detail.lines?.length || 0}\n` +
      `Total arrived (incl. damaged): ${totals.received}\n` +
      `Damaged: ${totals.damaged}\n` +
      `Good units to inventory: ${totals.good}\n\n` +
      `Once confirmed, the good quantity (arrived − damaged) will be added to ` +
      `your warehouse inventory. Damaged units are recorded against the line but ` +
      `are not added to inventory. Proceed?`;
    if (!window.confirm(confirmMsg)) return;

    setSaving(true);
    try {
      const linesPayload = (detail.lines || []).map((l) => {
        const input = lineInputs[l.sts_line_id] || {};
        return {
          sts_line_id:   l.sts_line_id,
          received_qty:  Number(input.received_qty) || 0,
          damaged_qty:   Number(input.damaged_qty)  || 0,
          damage_reason: String(input.damage_reason || '').trim() || null,
        };
      });

      const res = await stockTransferApi.receiveSTS(detail.sts_id, {
        remarks: remarks.trim() || null,
        lines:   linesPayload,
      });

      if (!res.ok || !res.data?.success) {
        setFeedback({
          type: 'error',
          title: 'Confirm failed',
          message: res.data?.message || 'Failed to confirm receipt.',
        });
        return;
      }
      onReceived?.();
      onClose?.();
    } catch (err) {
      console.error(err);
      setFeedback({
        type: 'error',
        title: 'Confirm failed',
        message: 'Error confirming receipt.',
      });
    } finally {
      setSaving(false);
    }
  };

  // Per-line derived values (shared by desktop table + mobile card)
  const deriveLine = (l) => {
    const input = lineInputs[l.sts_line_id] || {};
    const recv  = Number(input.received_qty) || 0;
    const dmg   = Number(input.damaged_qty)  || 0;
    const sent  = Number(l.qty) || 0;
    const good  = Math.max(0, recv - dmg);

    const lineErr = [];
    if (recv > sent) lineErr.push('received exceeds sent');
    if (dmg > recv)  lineErr.push('damaged exceeds received');
    if (dmg > 0 && !String(input.damage_reason || '').trim()) lineErr.push('reason required');

    return { input, recv, dmg, sent, good, lineErr };
  };

  return (
    <>
      <style>{modalCss}</style>
      <div className="rtm-overlay" onClick={saving ? undefined : onClose}>
        <div className="rtm-card" onClick={(e) => e.stopPropagation()}>

          {/* ============ HEADER ============ */}
          <div className="rtm-header">
            <div className="rtm-header-left">
              <div className="rtm-header-icon"><FiInbox /></div>
              <div className="rtm-header-info">
                <h3 className="rtm-header-title">
                  {isAlreadyReceived ? 'Received Transfer' : 'Receive Stock Transfer'}
                </h3>
                <div className="rtm-header-sub">
                  <span className="rtm-header-stsno">{sts.sts_no}</span>
                  <span className="rtm-header-dot">·</span>
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
              aria-label="Close"
            ><FiX /></button>
          </div>

          {/* ============ BODY ============ */}
          <div className="rtm-body">
            {loading ? (
              <div className="rtm-loading">Loading transfer details…</div>
            ) : !detail ? (
              <ModalBanner
                type={feedback?.type || 'error'}
                title={feedback?.title || 'Load failed'}
                message={feedback?.message || 'Could not load transfer details.'}
              />
            ) : (
              <>
                {feedback && (
                  <ModalBanner
                    type={feedback.type}
                    title={feedback.title}
                    message={feedback.message}
                    onClose={() => setFeedback(null)}
                  />
                )}

                <div className="rtm-meta-grid">
                  <Meta label="STS No."       value={detail.sts_no} mono />
                  <Meta label="Status"        value={detail.status} />
                  <Meta label="Transfer Date" value={detail.transfer_date} />
                  <Meta label="PO No."        value={detail.po_no || '—'} mono />
                  <Meta label="From"          value={`${detail.from_warehouse_code || ''} ${detail.from_warehouse_name || ''}`.trim() || `WH ${detail.from_warehouse_id}`} />
                  <Meta label="To"            value={`${detail.to_warehouse_code || ''} ${detail.to_warehouse_name || ''}`.trim() || `WH ${detail.to_warehouse_id}`} />
                  <Meta label="Submitted By"  value={detail.submitted_by || '—'} />
                  <Meta label="Submitted At"  value={formatDateTime(detail.submitted_at)} />
                  <Meta label="Approved By"   value={detail.approved_by || '—'} />
                  <Meta label="Approved At"   value={formatDateTime(detail.approved_at)} />
                  {detail.arrived_by && <Meta label="Arrived By" value={detail.arrived_by} />}
                  {detail.arrived_at && <Meta label="Arrived At" value={formatDateTime(detail.arrived_at)} />}
                </div>

                {detail.remarks && (
                  <div className="rtm-note-box">
                    <span className="rtm-note-icon"><FiEdit3 /></span>
                    <div className="rtm-note-body">
                      <div className="rtm-note-label">Transfer Remarks</div>
                      <div className="rtm-note-text">{detail.remarks}</div>
                    </div>
                  </div>
                )}

                {canReceive && (
                  <div className="rtm-info-box">
                    <span className="rtm-info-icon"><FiInfo /></span>
                    <div className="rtm-info-body">
                      <div className="rtm-info-label">How to fill this in</div>
                      <div className="rtm-info-text">
                        <strong>Received</strong> = <em>every</em> unit that
                        arrived at your warehouse (including damaged ones).
                        <strong> Damaged</strong> is a subset of the received
                        quantity. Example: 5 sent, 5 arrived, 1 of them damaged →
                        Received&nbsp;=&nbsp;5, Damaged&nbsp;=&nbsp;1, Good&nbsp;=&nbsp;4.
                        Only the good units go into warehouse inventory.
                      </div>
                    </div>
                  </div>
                )}

                <div className="rtm-section-head">
                  <span className="rtm-section-title">
                    <FiPackage className="rtm-section-icon" />
                    <span>Items <span className="rtm-section-count">({detail.lines?.length || 0})</span></span>
                  </span>
                  {canReceive && (
                    <span className="rtm-summary-chip">
                      Arrived: {totals.received}
                      {totals.damaged > 0 ? ` · Damaged: ${totals.damaged}` : ''}
                      {' · '}Good: {totals.good}
                    </span>
                  )}
                </div>

                {/* ============ DESKTOP TABLE ============ */}
                <div className="rtm-table-wrap">
                  <table className="rtm-table">
                    <thead>
                      <tr>
                        <th>Item</th>
                        <th className="rtm-th-center">Sent</th>
                        <th className="rtm-th-center">Received</th>
                        <th className="rtm-th-center">Damaged</th>
                        <th className="rtm-th-center">Good</th>
                        <th>Damage Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.lines.map((l, idx) => {
                        const { input, recv, good, lineErr } = deriveLine(l);
                        const editableRow = canReceive;
                        return (
                          <tr key={l.sts_line_id ?? idx}>
                            <td className="rtm-td-item">
                              <div className="rtm-item-cell">
                                <ItemImageThumb src={images[l.item_code]} alt={l.item_code} size={44} />
                                <div className="rtm-item-info">
                                  <div className="rtm-item-code">{l.item_code}</div>
                                  <div className="rtm-item-name" title={l.item_name}>{l.item_name || '—'}</div>
                                  <div className="rtm-item-uom">UOM: {l.uom || '—'}</div>
                                </div>
                              </div>
                            </td>
                            <td className="rtm-td rtm-td-center rtm-td-bold">{l.qty}</td>
                            <td className="rtm-td rtm-td-center">
                              {editableRow ? (
                                <input
                                  type="number" min="0" max={l.qty}
                                  inputMode="numeric"
                                  value={input.received_qty ?? ''}
                                  onChange={(e) => handleChange(l.sts_line_id, 'received_qty', e.target.value)}
                                  disabled={saving}
                                  className="rtm-num-input"
                                />
                              ) : (
                                <span className="rtm-td-bold">{Number(l.received_qty) || 0}</span>
                              )}
                            </td>
                            <td className="rtm-td rtm-td-center">
                              {editableRow ? (
                                <input
                                  type="number" min="0" max={recv || undefined}
                                  inputMode="numeric"
                                  value={input.damaged_qty ?? ''}
                                  onChange={(e) => handleChange(l.sts_line_id, 'damaged_qty', e.target.value)}
                                  disabled={saving}
                                  className="rtm-num-input"
                                />
                              ) : (
                                <span className="rtm-td-bold">{Number(l.damaged_qty) || 0}</span>
                              )}
                            </td>
                            <td className="rtm-td rtm-td-center">
                              <span
                                className="rtm-good-value"
                                data-empty={
                                  !(editableRow
                                    ? good
                                    : Math.max(0, (Number(l.received_qty) || 0) - (Number(l.damaged_qty) || 0))) > 0
                                }
                              >
                                {editableRow
                                  ? good
                                  : Math.max(0, (Number(l.received_qty) || 0) - (Number(l.damaged_qty) || 0))}
                              </span>
                            </td>
                            <td className="rtm-td">
                              {editableRow ? (
                                <input
                                  type="text"
                                  value={input.damage_reason || ''}
                                  onChange={(e) => handleChange(l.sts_line_id, 'damage_reason', e.target.value)}
                                  disabled={saving || !(Number(input.damaged_qty) > 0)}
                                  placeholder={Number(input.damaged_qty) > 0 ? 'Describe the damage…' : '—'}
                                  className="rtm-text-input"
                                />
                              ) : (
                                <span className="rtm-readonly-text">{l.damage_reason || '—'}</span>
                              )}
                              {lineErr.length > 0 && (
                                <div className="rtm-line-err">
                                  <FiAlertTriangle className="rtm-line-err-icon" />
                                  <span>{lineErr.join(' · ')}</span>
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* ============ MOBILE CARDS ============ */}
                <div className="rtm-cards">
                  {detail.lines.map((l, idx) => {
                    const { input, recv, dmg, good, lineErr } = deriveLine(l);
                    const editableRow = canReceive;
                    const displayRecv = editableRow ? recv : (Number(l.received_qty) || 0);
                    const displayDmg  = editableRow ? dmg  : (Number(l.damaged_qty)  || 0);
                    const displayGood = editableRow
                      ? good
                      : Math.max(0, (Number(l.received_qty) || 0) - (Number(l.damaged_qty) || 0));

                    return (
                      <div key={`m-${l.sts_line_id ?? idx}`} className="rtm-line-card">
                        <div className="rtm-line-head">
                          <ItemImageThumb src={images[l.item_code]} alt={l.item_code} size={44} />
                          <div className="rtm-line-head-info">
                            <div className="rtm-line-code">{l.item_code}</div>
                            <div className="rtm-line-name" title={l.item_name}>{l.item_name || '—'}</div>
                            <div className="rtm-line-uom">UOM: {l.uom || '—'}</div>
                          </div>
                          <div className="rtm-line-badge">#{l.line_no}</div>
                        </div>

                        <div className="rtm-line-stats">
                          <div className="rtm-line-stat">
                            <span className="rtm-line-stat-label">Sent</span>
                            <span className="rtm-line-stat-value">{l.qty}</span>
                          </div>
                          <div className="rtm-line-stat">
                            <span className="rtm-line-stat-label">Received</span>
                            <span className="rtm-line-stat-value">{displayRecv}</span>
                          </div>
                          <div className="rtm-line-stat">
                            <span className="rtm-line-stat-label">Damaged</span>
                            <span
                              className="rtm-line-stat-value"
                              data-danger={displayDmg > 0 || undefined}
                            >
                              {displayDmg}
                            </span>
                          </div>
                          <div className="rtm-line-stat">
                            <span className="rtm-line-stat-label">Good</span>
                            <span
                              className="rtm-line-stat-value"
                              data-good={displayGood > 0 || undefined}
                              data-empty={!(displayGood > 0) || undefined}
                            >
                              {displayGood}
                            </span>
                          </div>
                        </div>

                        {editableRow && (
                          <>
                            <div className="rtm-line-inputs">
                              <div className="rtm-line-field">
                                <label className="rtm-line-label">Received</label>
                                <input
                                  type="number" min="0" max={l.qty}
                                  inputMode="numeric"
                                  value={input.received_qty ?? ''}
                                  onChange={(e) => handleChange(l.sts_line_id, 'received_qty', e.target.value)}
                                  disabled={saving}
                                  className="rtm-line-input"
                                />
                              </div>
                              <div className="rtm-line-field">
                                <label className="rtm-line-label">Damaged</label>
                                <input
                                  type="number" min="0" max={recv || undefined}
                                  inputMode="numeric"
                                  value={input.damaged_qty ?? ''}
                                  onChange={(e) => handleChange(l.sts_line_id, 'damaged_qty', e.target.value)}
                                  disabled={saving}
                                  className="rtm-line-input"
                                />
                              </div>
                            </div>

                            <div className="rtm-line-field rtm-line-field--full">
                              <label className="rtm-line-label">Damage Reason</label>
                              <input
                                type="text"
                                value={input.damage_reason || ''}
                                onChange={(e) => handleChange(l.sts_line_id, 'damage_reason', e.target.value)}
                                disabled={saving || !(Number(input.damaged_qty) > 0)}
                                placeholder={Number(input.damaged_qty) > 0 ? 'Describe the damage…' : '—'}
                                className="rtm-line-input rtm-line-input--text"
                              />
                            </div>
                          </>
                        )}

                        {!editableRow && l.damage_reason && (
                          <div className="rtm-line-reason-readonly">
                            <span className="rtm-line-label">Reason: </span>
                            {l.damage_reason}
                          </div>
                        )}

                        {lineErr.length > 0 && (
                          <div className="rtm-line-errors">
                            <FiAlertTriangle className="rtm-line-errors-icon" />
                            <span>{lineErr.join(' · ')}</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {canReceive && (
                  <div className="rtm-remarks-block">
                    <label className="rtm-remarks-label">Receipt Remarks (optional)</label>
                    <textarea
                      value={remarks}
                      onChange={(e) => setRemarks(e.target.value)}
                      disabled={saving}
                      placeholder="e.g. All items arrived in good condition."
                      rows={2}
                      className="rtm-remarks-input"
                    />
                  </div>
                )}

                {isAlreadyReceived && detail.receive_remarks && (
                  <div className="rtm-note-box rtm-note-box--success">
                    <span className="rtm-note-icon rtm-note-icon--success"><FiCheckCircle /></span>
                    <div className="rtm-note-body">
                      <div className="rtm-note-label rtm-note-label--success">Receipt Remarks</div>
                      <div className="rtm-note-text rtm-note-text--success">{detail.receive_remarks}</div>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* ============ FOOTER ============ */}
          <div className="rtm-footer">
            <button type="button" className="cancel-btn" onClick={onClose} disabled={saving}>
              {canReceive ? 'Cancel' : 'Close'}
            </button>
            {canReceive && (
              <button
                type="button"
                className="save-btn rtm-confirm-btn"
                onClick={handleConfirm}
                disabled={saving || loading || !detail || validationErrors.length > 0}
              >
                {saving ? (
                  'Confirming…'
                ) : (
                  <>
                    <FiCheckCircle className="rtm-btn-icon" />
                    <span>Confirm Receipt</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

const Meta = ({ label, value, mono }) => (
  <div className="rtm-meta-box">
    <div className="rtm-meta-label">{label}</div>
    <div className={`rtm-meta-value${mono ? ' rtm-meta-value--mono' : ''}`}>{value}</div>
  </div>
);

export default ReceiveTransferModal;

/* ============================================================ */
const modalCss = `
@keyframes rtmFadeIn { from { opacity: 0 } to { opacity: 1 } }
@keyframes rtmSlideUp { from { opacity: 0; transform: translateY(16px) scale(0.98) } to { opacity: 1; transform: translateY(0) scale(1) } }

/* ---------- Overlay / Card ---------- */
.rtm-overlay {
  position: fixed; inset: 0;
  background: rgba(15, 23, 42, 0.62);
  backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
  display: flex; align-items: center; justify-content: center;
  z-index: 10000;
  padding: clamp(8px, 2vw, 24px);
  animation: rtmFadeIn 0.18s ease;
}
.rtm-card {
  background: #ffffff;
  border-radius: clamp(12px, 1.5vw, 18px);
  width: 100%;
  max-width: 1080px;
  max-height: 92vh;
  max-height: 92dvh;
  display: flex; flex-direction: column;
  overflow: hidden;
  box-shadow: 0 24px 64px rgba(15, 23, 42, 0.28), 0 4px 14px rgba(15, 23, 42, 0.14);
  animation: rtmSlideUp 0.22s cubic-bezier(0.34, 1.3, 0.64, 1);
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}

/* ---------- Header ---------- */
.rtm-header {
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px;
  padding: clamp(14px, 1.8vw, 20px) clamp(18px, 2.4vw, 26px);
  border-bottom: 1px solid #e5e7eb;
  background: linear-gradient(135deg, #ffffff 0%, #f8fafc 100%);
  flex-shrink: 0;
}
.rtm-header-left { display: flex; align-items: center; gap: 14px; flex: 1; min-width: 0; }
.rtm-header-info { min-width: 0; flex: 1; }
.rtm-header-icon {
  width: 44px; height: 44px; border-radius: 12px;
  background: linear-gradient(135deg, #00e0d4 0%, #008a82 100%);
  color: #fff; display: flex; align-items: center; justify-content: center;
  box-shadow: 0 4px 12px rgba(0, 210, 200, 0.32);
  flex-shrink: 0;
}
.rtm-header-icon svg { width: 22px; height: 22px; stroke-width: 2.2; color: #ffffff; }
.rtm-header-title {
  margin: 0; font-size: clamp(16px, 1.6vw, 20px); font-weight: 700;
  color: #0f172a; line-height: 1.2;
}
.rtm-header-sub {
  font-size: 12px; color: #64748b; margin-top: 4px;
  display: flex; flex-wrap: wrap; align-items: center; gap: 6px;
}
.rtm-header-stsno {
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-weight: 700; color: #0f766e;
}
.rtm-header-dot { color: #cbd5e1; }
.rtm-close {
  background: transparent; border: none;
  width: 36px; height: 36px; border-radius: 8px; cursor: pointer;
  color: #64748b; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
}
.rtm-close svg { width: 18px; height: 18px; stroke-width: 2.4; }
.rtm-close:hover:not(:disabled) { background: #f1f5f9; color: #0f172a; }
.rtm-close:disabled { opacity: 0.4; cursor: not-allowed; }

/* ---------- Body — critical fix ---------- */
.rtm-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: clamp(16px, 2vw, 24px);
  display: flex; flex-direction: column;
  gap: 14px;
  background: #ffffff;
  -webkit-overflow-scrolling: touch;
}
.rtm-body > * { flex-shrink: 0; }

.rtm-body::-webkit-scrollbar { width: 8px; }
.rtm-body::-webkit-scrollbar-track { background: #f1f5f9; border-radius: 4px; }
.rtm-body::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 4px; }
.rtm-body::-webkit-scrollbar-thumb:hover { background: #94a3b8; }

/* ---------- Footer ---------- */
.rtm-footer {
  display: flex; justify-content: flex-end; align-items: center;
  gap: 10px;
  padding: clamp(12px, 1.5vw, 16px) clamp(18px, 2.4vw, 26px);
  border-top: 1px solid #e5e7eb; background: #f8fafc;
  flex-shrink: 0; flex-wrap: wrap;
}
.rtm-confirm-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
}
.rtm-btn-icon {
  width: 1em; height: 1em; flex-shrink: 0;
  stroke-width: 2.4;
}

/* ---------- Meta grid ---------- */
.rtm-meta-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
}
.rtm-meta-box {
  padding: 10px 14px; background: #f8fafc;
  border: 1px solid #e2e8f0; border-radius: 8px;
}
.rtm-meta-label {
  font-size: 10px; font-weight: 700; color: #64748b;
  text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 3px;
}
.rtm-meta-value {
  font-size: 13px; font-weight: 600; color: #0f172a;
  word-break: break-word;
}
.rtm-meta-value--mono {
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
}

/* ---------- Banners (info / note) ---------- */
.rtm-note-box,
.rtm-info-box {
  display: flex; align-items: flex-start; gap: 10px;
  padding: 10px 14px; border-radius: 8px;
}
.rtm-note-box { background: #eff6ff; border: 1px solid #bfdbfe; }
.rtm-info-box { background: #ecfeff; border: 1px solid #a5f3fc; }
.rtm-note-icon,
.rtm-info-icon {
  display: inline-flex; align-items: center; justify-content: center;
  flex-shrink: 0; margin-top: 1px;
}
.rtm-note-icon svg { width: 16px; height: 16px; stroke-width: 2.2; color: #1e40af; }
.rtm-info-icon svg { width: 16px; height: 16px; stroke-width: 2.2; color: #0e7490; }
.rtm-note-body, .rtm-info-body { min-width: 0; }
.rtm-note-label {
  font-size: 10px; font-weight: 700; color: #1e40af;
  text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 3px;
}
.rtm-note-text { font-size: 13px; color: #1e3a8a; line-height: 1.5; white-space: pre-wrap; }
.rtm-info-label {
  font-size: 10px; font-weight: 700; color: #0e7490;
  text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 3px;
}
.rtm-info-text { font-size: 13px; color: #0e7490; line-height: 1.5; }

/* Success variant — already-received receipt remarks */
.rtm-note-box--success {
  background: #f0fdf4;
  border-color: #86efac;
}
.rtm-note-icon--success svg { color: #059669; }
.rtm-note-label--success { color: #065f46; }
.rtm-note-text--success { color: #065f46; }

/* ---------- Section head ---------- */
.rtm-section-head {
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px; flex-wrap: wrap; margin-top: 4px;
}
.rtm-section-title {
  font-size: 14px; font-weight: 700; color: #0f172a;
  display: inline-flex; align-items: center; gap: 8px;
}
.rtm-section-icon {
  width: 16px; height: 16px; stroke-width: 2.2;
  color: #334155; flex-shrink: 0;
}
.rtm-section-count { color: #64748b; font-weight: 500; }
.rtm-summary-chip {
  font-size: 12px; font-weight: 700; padding: 5px 12px;
  background: #dcfce7; color: #065f46;
  border: 1px solid #86efac; border-radius: 999px;
  white-space: nowrap;
}

/* ---------- Loading ---------- */
.rtm-loading { padding: 24px; text-align: center; color: #64748b; font-size: 14px; }

/* ---------- Table ---------- */
.rtm-table-wrap {
  overflow: auto;
  max-height: 50vh;
  min-height: 180px;
  flex-shrink: 0;
  border: 1px solid #e2e8f0; border-radius: 10px; background: #fff;
}
.rtm-table {
  width: 100%; border-collapse: collapse;
  min-width: 860px; font-size: 13px;
}
.rtm-table thead th {
  padding: 10px 12px; text-align: left;
  font-size: 10px; font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.06em; color: #64748b;
  background: #f8fafc; border-bottom: 1px solid #e2e8f0;
  position: sticky; top: 0; z-index: 1; white-space: nowrap;
}
.rtm-th-center { text-align: center !important; }
.rtm-table tbody td {
  padding: 10px 12px; color: #0f172a; vertical-align: middle;
  border-bottom: 1px solid #f1f5f9;
}
.rtm-td { padding: 10px 12px !important; }
.rtm-td-center { text-align: center !important; }
.rtm-td-bold { font-weight: 700; }
.rtm-td-item { min-width: 240px; }

.rtm-item-cell { display: flex; align-items: center; gap: 10px; min-width: 0; }
.rtm-item-info { min-width: 0; flex: 1; }
.rtm-item-code {
  font-weight: 700; font-size: 12px;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  color: #0f766e; line-height: 1.2;
}
.rtm-item-name {
  font-size: 11px; color: #475569; margin-top: 1px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.rtm-item-uom { font-size: 10px; color: #64748b; margin-top: 2px; font-weight: 600; }

.rtm-num-input {
  width: 90px; padding: 6px 8px;
  font-size: 13px; font-weight: 700;
  border: 1.5px solid #cbd5e1; border-radius: 6px;
  background: #fff; color: #0f172a;
  text-align: center; outline: none;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.rtm-num-input:focus {
  border-color: #00b8b0;
  box-shadow: 0 0 0 3px rgba(0, 184, 176, 0.15);
}
.rtm-text-input {
  width: 100%; padding: 6px 8px; font-size: 12px;
  border: 1px solid #cbd5e1; border-radius: 6px;
  background: #fff; color: #0f172a; outline: none;
}
.rtm-readonly-text { font-size: 12px; color: #64748b; }
.rtm-line-err {
  font-size: 10px; color: #dc2626; margin-top: 3px; font-weight: 600;
  display: inline-flex; align-items: center; gap: 4px;
}
.rtm-line-err-icon {
  width: 1em; height: 1em; flex-shrink: 0;
  stroke-width: 2.4;
  color: #dc2626;
}
.rtm-good-value {
  font-weight: 700;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  color: #065f46;
}
.rtm-good-value[data-empty="true"] { color: #94a3b8; }

/* ---------- Mobile cards (hidden on desktop) ---------- */
.rtm-cards { display: none; }

/* ---------- Remarks ---------- */
.rtm-remarks-block { display: flex; flex-direction: column; gap: 6px; }
.rtm-remarks-label {
  font-size: 11px; font-weight: 700; color: #475569;
  text-transform: uppercase; letter-spacing: 0.06em;
}
.rtm-remarks-input {
  width: 100%; padding: 10px 12px; font-size: 13px;
  border: 1.5px solid #cbd5e1; border-radius: 8px;
  background: #fff; color: #0f172a;
  font-family: inherit; resize: vertical; outline: none;
  box-sizing: border-box;
}

/* ---------- Tablet ---------- */
@media (max-width: 900px) {
  .rtm-card { max-width: 96vw; }
  .rtm-meta-grid { grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); }
  .rtm-table-wrap { max-height: 46vh; }
}

/* ---------- Mobile ---------- */
@media (max-width: 640px) {
  .rtm-overlay { padding: 0; align-items: stretch; }
  .rtm-card {
    max-height: 100vh; max-height: 100dvh;
    width: 100vw; max-width: 100vw;
    height: 100vh; height: 100dvh;
    border-radius: 0;
    animation: none;
  }
  .rtm-header { padding: 12px 14px; }
  .rtm-header-icon { width: 36px; height: 36px; border-radius: 10px; }
  .rtm-header-icon svg { width: 18px; height: 18px; }
  .rtm-header-title { font-size: 15px; }
  .rtm-header-sub { font-size: 11px; }
  .rtm-body { padding: 12px 14px; gap: 10px; }
  .rtm-footer { padding: 10px 14px; gap: 8px; flex-wrap: wrap; }
  .rtm-footer > button {
    flex: 1 1 auto; min-height: 44px;
    padding: 12px 16px; font-size: 14px;
  }
  .rtm-meta-grid { grid-template-columns: 1fr 1fr; gap: 8px; }
  .rtm-meta-box { padding: 8px 10px; }
  .rtm-meta-label { font-size: 9px; }
  .rtm-meta-value { font-size: 12px; }
  .rtm-info-box { padding: 10px 12px; }
  .rtm-info-text { font-size: 12px; }
  .rtm-section-head { flex-direction: column; align-items: flex-start; gap: 6px; }
  .rtm-summary-chip { font-size: 11px; padding: 4px 10px; }
  .rtm-table-wrap { display: none; }
  .rtm-cards { display: flex; flex-direction: column; gap: 10px; }
  .rtm-line-card {
    border: 1px solid #e2e8f0; border-radius: 10px;
    background: #ffffff; padding: 12px;
    display: flex; flex-direction: column; gap: 10px;
  }
  .rtm-line-head { display: flex; gap: 10px; align-items: flex-start; }
  .rtm-line-head-info { flex: 1; min-width: 0; }
  .rtm-line-code {
    font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
    font-weight: 700; font-size: 13px; color: #0f766e; line-height: 1.2;
  }
  .rtm-line-name {
    font-size: 12px; color: #475569; margin-top: 2px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .rtm-line-uom { font-size: 10px; color: #64748b; margin-top: 2px; font-weight: 600; }
  .rtm-line-badge {
    font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
    font-size: 11px; font-weight: 700; color: #94a3b8; flex-shrink: 0;
  }
  .rtm-line-stats {
    display: grid; grid-template-columns: repeat(4, 1fr);
    gap: 6px; padding: 8px 0;
    border-top: 1px dashed #e5e7eb; border-bottom: 1px dashed #e5e7eb;
  }
  .rtm-line-stat { display: flex; flex-direction: column; align-items: center; gap: 2px; min-width: 0; }
  .rtm-line-stat-label {
    font-size: 9px; font-weight: 700; color: #64748b;
    text-transform: uppercase; letter-spacing: 0.04em;
  }
  .rtm-line-stat-value {
    font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
    font-size: 15px; font-weight: 700; color: #0f172a;
  }
  .rtm-line-stat-value[data-danger="true"] { color: #991b1b; }
  .rtm-line-stat-value[data-good="true"]  { color: #065f46; }
  .rtm-line-stat-value[data-empty="true"] { color: #94a3b8; }
  .rtm-line-inputs { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .rtm-line-field,
  .rtm-line-field--full { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  .rtm-line-label {
    font-size: 10px; font-weight: 700; color: #64748b;
    text-transform: uppercase; letter-spacing: 0.04em;
  }
  .rtm-line-input {
    width: 100%; padding: 10px 12px; font-size: 16px; font-weight: 700;
    border: 1.5px solid #cbd5e1; border-radius: 8px;
    background: #ffffff; color: #0f172a;
    box-sizing: border-box; min-height: 44px;
    text-align: center; outline: none;
    transition: border-color 0.15s ease, box-shadow 0.15s ease;
  }
  .rtm-line-input:focus {
    border-color: #00b8b0;
    box-shadow: 0 0 0 3px rgba(0, 184, 176, 0.15);
  }
  .rtm-line-input--text {
    text-align: left; font-size: 14px; font-weight: 500;
  }
  .rtm-line-input:disabled {
    background: #f8fafc; color: #94a3b8; cursor: not-allowed;
  }
  .rtm-line-errors {
    font-size: 11px; color: #dc2626; font-weight: 600;
    background: #fef2f2; border: 1px solid #fecaca;
    border-radius: 6px; padding: 6px 10px; line-height: 1.4;
    display: inline-flex; align-items: flex-start; gap: 6px;
  }
  .rtm-line-errors-icon {
    width: 1em; height: 1em; flex-shrink: 0;
    stroke-width: 2.4; color: #dc2626;
    margin-top: 2px;
  }
  .rtm-line-reason-readonly { font-size: 12px; color: #475569; line-height: 1.4; }
}

/* ---------- Very small phones ---------- */
@media (max-width: 380px) {
  .rtm-meta-grid { grid-template-columns: 1fr; }
  .rtm-line-stats { grid-template-columns: repeat(2, 1fr); row-gap: 10px; }
  .rtm-header-title { font-size: 14px; }
  .rtm-header-icon { width: 32px; height: 32px; }
  .rtm-header-icon svg { width: 16px; height: 16px; }
}

/* ---------- Short landscape ---------- */
@media (max-height: 500px) and (orientation: landscape) {
  .rtm-overlay { padding: 8px; align-items: center; }
  .rtm-card {
    height: auto; max-height: 96vh;
    border-radius: 12px; max-width: 96vw;
  }
  .rtm-header { padding: 8px 14px; }
  .rtm-body   { padding: 10px 14px; gap: 8px; }
  .rtm-footer { padding: 8px 14px; }
}

/* ---------- Large desktop ---------- */
@media (min-width: 1400px) {
  .rtm-card { max-width: 1200px; }
}

/* ---------- Reduced motion ---------- */
@media (prefers-reduced-motion: reduce) {
  .rtm-card, .rtm-overlay { animation: none !important; }
}
`;