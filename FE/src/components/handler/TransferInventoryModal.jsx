// src/components/handler/TransferInventoryModal.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { FiTruck, FiX, FiCheckCircle } from 'react-icons/fi';
import { stockTransferApi, warehouseApi, itemMasterApi } from '../../services/api';
import ModalBanner from '../shared/ModalBanner';
import ItemImageThumb from '../shared/ItemImageThumb';

const TransferInventoryModal = ({ inventory, onClose, onSubmitted }) => {
  const todayIso = new Date().toISOString().split('T')[0];
  const [warehouses, setWarehouses] = useState([]);
  const [toWarehouseId, setToWarehouseId] = useState('');
  const [transferDate, setTransferDate] = useState(todayIso);
  const [qty, setQty] = useState(0);
  const [remarks, setRemarks] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(null);
  const [image, setImage] = useState(null);

  // Unified inline feedback banner
  const [feedback, setFeedback] = useState(null);

  const maxQty = Number(inventory.qty_on_hand) || 0;

  useEffect(() => {
    (async () => {
      try {
        const res = await warehouseApi.getAllWarehouses();
        if (res.ok && Array.isArray(res.data)) {
          setWarehouses(
            res.data.filter(
              (w) => w.status === 'Active' && w.warehouse_id !== inventory.warehouse_id
            )
          );
        }
      } catch (e) { console.warn(e); }
    })();
  }, [inventory.warehouse_id]);

  useEffect(() => {
    (async () => {
      try {
        const res = await itemMasterApi.getImagesByCodes([inventory.item_code]);
        if (res.ok && res.data?.images) {
          setImage(res.data.images[inventory.item_code] || null);
        }
      } catch { /* ignore */ }
    })();
  }, [inventory.item_code]);

  const canSubmit = useMemo(
    () => toWarehouseId && transferDate && qty > 0 && qty <= maxQty && !submitting,
    [toWarehouseId, transferDate, qty, maxQty, submitting]
  );

  const handleSubmit = async () => {
    setFeedback(null);

    if (!toWarehouseId) {
      setFeedback({
        type: 'warning',
        title: 'Destination required',
        message: 'Please select a destination warehouse.',
      });
      return;
    }
    if (!transferDate) {
      setFeedback({
        type: 'warning',
        title: 'Date required',
        message: 'Please select a transfer date.',
      });
      return;
    }
    const n = Number(qty);
    if (!Number.isFinite(n) || n <= 0) {
      setFeedback({
        type: 'warning',
        title: 'Invalid quantity',
        message: 'Quantity must be greater than 0.',
      });
      return;
    }
    if (n > maxQty) {
      setFeedback({
        type: 'warning',
        title: 'Exceeds on-hand',
        message: `Only ${maxQty} on hand.`,
      });
      return;
    }

    const dest = warehouses.find((w) => String(w.warehouse_id) === String(toWarehouseId));
    const confirmMsg =
      `Submit Stock Transfer Slip?\n\n` +
      `Item:  ${inventory.item_code} — ${inventory.item_name || ''}\n` +
      `Qty:   ${n} ${inventory.uom || ''}\n` +
      `From:  ${inventory.warehouse_code}\n` +
      `To:    ${dest?.warehouse_code} — ${dest?.warehouse_name}\n` +
      `Date:  ${transferDate}\n\n` +
      `Sent to the Department Head for approval. Proceed?`;
    if (!window.confirm(confirmMsg)) return;

    setSubmitting(true);
    try {
      const res = await stockTransferApi.createSTS({
        from_warehouse_id: inventory.warehouse_id,
        to_warehouse_id:   Number(toWarehouseId),
        transfer_date:     transferDate,
        po_no:             null,
        remarks:           remarks.trim() || null,
        lines: [{
          item_code:  inventory.item_code,
          item_name:  inventory.item_name,
          uom:        inventory.uom,
          qty:        n,
          unit_price: Number(inventory.avg_unit_cost) || null,
          currency:   'PHP',
        }],
      });
      if (!res.ok || !res.data?.success) {
        setFeedback({
          type: 'error',
          title: 'Submit failed',
          message: res.data?.message || 'Failed to submit.',
        });
        return;
      }
      setSubmitted(res.data.data);
      onSubmitted?.(res.data.data);
    } catch (err) {
      console.error(err);
      setFeedback({
        type: 'error',
        title: 'Submit failed',
        message: 'Error submitting transfer.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <style>{modalCss}</style>

      <div
        className="tim-overlay"
        onClick={submitting ? undefined : onClose}
      >
        <div
          className="tim-card"
          onClick={(e) => e.stopPropagation()}
        >
          {/* ---------- HEADER ---------- */}
          <div className="tim-header">
            <div className="tim-header-left">
              <div className="tim-header-icon"><FiTruck /></div>
              <div className="tim-header-info">
                <h3 className="tim-header-title">
                  {submitted ? 'Transfer Submitted' : 'Transfer Inventory'}
                </h3>
                <div className="tim-header-sub">
                  <span className="tim-header-mono">{inventory.item_code}</span>
                  <span className="tim-header-dot">·</span>
                  <span>From {inventory.warehouse_code}</span>
                </div>
              </div>
            </div>
            <button
              type="button"
              className="tim-close"
              onClick={onClose}
              disabled={submitting}
              aria-label="Close"
            ><FiX /></button>
          </div>

          {/* ---------- BODY ---------- */}
          <div className="tim-body">
            {submitted ? (
              <SuccessScreen
                stsNo={submitted.sts_no}
                qty={qty}
                toWarehouse={warehouses.find(
                  (w) => String(w.warehouse_id) === String(toWarehouseId)
                )}
                onClose={onClose}
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

                <div className="tim-item-card">
                  <ItemImageThumb src={image} alt={inventory.item_code} size={56} />
                  <div className="tim-item-info">
                    <div className="tim-item-code">{inventory.item_code}</div>
                    <div className="tim-item-name" title={inventory.item_name}>
                      {inventory.item_name || '—'}
                    </div>
                    <div className="tim-item-meta">UOM: {inventory.uom || '—'}</div>
                  </div>
                </div>

                <div className="tim-metrics">
                  <Metric label="On Hand"       value={maxQty} />
                  <Metric label="Avg Unit Cost" value={Number(inventory.avg_unit_cost || 0).toFixed(4)} />
                  <Metric label="Total Value"   value={Number(inventory.total_value || 0).toFixed(4)} /> {/* <--- UPDATED TO 4 */}
                </div>

                <div className="tim-grid">
                  <Field label="From Warehouse">
                    <input
                      type="text" readOnly disabled
                      value={`${inventory.warehouse_code} — ${inventory.warehouse_name || ''}`}
                      className="tim-readonly-input"
                    />
                  </Field>
                  <Field label="To Warehouse *">
                    <select
                      value={toWarehouseId}
                      onChange={(e) => setToWarehouseId(e.target.value)}
                      disabled={submitting}
                      className="tim-input"
                    >
                      <option value="">Select destination</option>
                      {warehouses.map((w) => (
                        <option key={w.warehouse_id} value={w.warehouse_id}>
                          {w.warehouse_code} — {w.warehouse_name}
                        </option>
                      ))}
                    </select>
                    {warehouses.length === 0 && (
                      <small className="tim-small-error">
                        No other active warehouses available.
                      </small>
                    )}
                  </Field>
                  <Field label="Transfer Date *">
                    <input
                      type="date" value={transferDate}
                      onChange={(e) => setTransferDate(e.target.value)}
                      disabled={submitting} className="tim-input"
                    />
                  </Field>
                  <Field label={`Quantity * (max ${maxQty})`}>
                    <input
                      type="number" min="1" max={maxQty} value={qty}
                      onChange={(e) => setQty(e.target.value)}
                      disabled={submitting} className="tim-input"
                    />
                  </Field>
                </div>

                <Field label="Remarks (optional)">
                  <textarea
                    value={remarks}
                    onChange={(e) => setRemarks(e.target.value)}
                    disabled={submitting}
                    rows={2}
                    placeholder="Notes for the approver…"
                    className="tim-textarea"
                  />
                </Field>
              </>
            )}
          </div>

          {/* ---------- FOOTER ---------- */}
          <div className="tim-footer">
            {submitted ? (
              <button className="save-btn" onClick={onClose}>Close</button>
            ) : (
              <>
                <button className="cancel-btn" onClick={onClose} disabled={submitting}>Cancel</button>
                <button className="save-btn" onClick={handleSubmit} disabled={!canSubmit}>
                  {submitting ? (
                    'Submitting…'
                  ) : (
                    <>
                      <FiCheckCircle className="tim-btn-icon" />
                      <span>Submit Transfer</span>
                    </>
                  )}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

// ---- small helpers ----
const Field = ({ label, children }) => (
  <div className="tim-field">
    <label className="tim-field-label">{label}</label>
    {children}
  </div>
);

const Metric = ({ label, value }) => (
  <div className="tim-metric-box">
    <div className="tim-metric-label">{label}</div>
    <div className="tim-metric-value">{value}</div>
  </div>
);

const SuccessScreen = ({ stsNo, qty, toWarehouse, onClose }) => (
  <div className="tim-success-wrap">
    <div className="tim-success-icon"><FiCheckCircle /></div>
    <h2 className="tim-success-title">Stock Transfer Slip Submitted</h2>
    <p className="tim-success-subtitle">
      The slip has been sent to the Department Head for approval.
    </p>
    <div className="tim-success-card">
      <div className="tim-success-row">
        <span className="tim-success-label">STS No.</span>
        <span className="tim-success-value">{stsNo}</span>
      </div>
      <div className="tim-success-row">
        <span className="tim-success-label">Qty</span>
        <span className="tim-success-value-small">{qty}</span>
      </div>
      <div className="tim-success-row">
        <span className="tim-success-label">To</span>
        <span className="tim-success-value-small">
          {toWarehouse?.warehouse_code} — {toWarehouse?.warehouse_name}
        </span>
      </div>
      <div className="tim-success-row">
        <span className="tim-success-label">Status</span>
        <span className="tim-success-badge">PENDING</span>
      </div>
    </div>
    <button className="save-btn tim-success-btn" onClick={onClose}>Close</button>
  </div>
);

/* ============================================================ */
const modalCss = `
@keyframes timFadeIn { from { opacity: 0 } to { opacity: 1 } }
@keyframes timSlideUp { from { opacity: 0; transform: translateY(16px) scale(0.98) } to { opacity: 1; transform: translateY(0) scale(1) } }

.tim-overlay {
  position: fixed; inset: 0;
  background: rgba(15, 23, 42, 0.62);
  backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
  display: flex; align-items: center; justify-content: center;
  z-index: 10000;
  padding: clamp(8px, 2vw, 24px);
  animation: timFadeIn 0.18s ease;
}
.tim-card {
  background: #ffffff;
  border-radius: clamp(12px, 1.5vw, 18px);
  width: 100%;
  max-width: 720px;
  max-height: 92vh;
  max-height: 92dvh;
  display: flex; flex-direction: column;
  overflow: hidden;
  box-shadow: 0 24px 64px rgba(15, 23, 42, 0.28), 0 4px 14px rgba(15, 23, 42, 0.14);
  animation: timSlideUp 0.22s cubic-bezier(0.34, 1.3, 0.64, 1);
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}

.tim-header {
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px;
  padding: clamp(14px, 1.8vw, 20px) clamp(18px, 2.4vw, 26px);
  border-bottom: 1px solid #e5e7eb;
  background: linear-gradient(135deg, #ffffff 0%, #f8fafc 100%);
  flex-shrink: 0;
}
.tim-header-left { display: flex; align-items: center; gap: 14px; flex: 1; min-width: 0; }
.tim-header-info { min-width: 0; }
.tim-header-icon {
  width: 44px; height: 44px; border-radius: 12px;
  background: linear-gradient(135deg, #6366f1 0%, #4338ca 100%);
  color: #fff; display: flex; align-items: center; justify-content: center;
  box-shadow: 0 4px 12px rgba(99, 102, 241, 0.32);
  flex-shrink: 0;
}
.tim-header-icon svg { width: 22px; height: 22px; stroke-width: 2.2; color: #ffffff; }
.tim-header-title {
  margin: 0; font-size: clamp(16px, 1.6vw, 20px); font-weight: 700;
  color: #0f172a; line-height: 1.2;
}
.tim-header-sub {
  font-size: 12px; color: #64748b; margin-top: 4px;
  display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
}
.tim-header-mono {
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-weight: 700; color: #4338ca;
}
.tim-header-dot { color: #cbd5e1; }
.tim-close {
  background: transparent; border: none;
  width: 36px; height: 36px; border-radius: 8px; cursor: pointer;
  color: #64748b; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
}
.tim-close svg { width: 18px; height: 18px; stroke-width: 2.4; }
.tim-close:hover:not(:disabled) { background: #f1f5f9; color: #0f172a; }
.tim-close:disabled { opacity: 0.4; cursor: not-allowed; }

.tim-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: clamp(16px, 2vw, 24px);
  display: flex; flex-direction: column;
  gap: 16px;
  background: #ffffff;
  -webkit-overflow-scrolling: touch;
}
.tim-body > * { flex-shrink: 0; }

.tim-body::-webkit-scrollbar { width: 8px; }
.tim-body::-webkit-scrollbar-track { background: #f1f5f9; border-radius: 4px; }
.tim-body::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 4px; }
.tim-body::-webkit-scrollbar-thumb:hover { background: #94a3b8; }

.tim-footer {
  display: flex; justify-content: flex-end; gap: 10px;
  padding: clamp(12px, 1.5vw, 16px) clamp(18px, 2.4vw, 26px);
  border-top: 1px solid #e5e7eb; background: #f8fafc;
  flex-shrink: 0; flex-wrap: wrap;
}

.tim-item-card {
  display: flex; align-items: center; gap: 14px; padding: 14px;
  background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px;
}
.tim-item-info { min-width: 0; flex: 1; }
.tim-item-code {
  font-weight: 700; font-size: 14px;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  color: #4338ca; line-height: 1.2;
}
.tim-item-name {
  font-size: 12px; color: #475569; margin-top: 2px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.tim-item-meta { font-size: 11px; color: #64748b; margin-top: 4px; font-weight: 600; }

.tim-metrics {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}
.tim-metric-box {
  padding: 10px 12px; background: #fff;
  border: 1px solid #e2e8f0; border-radius: 8px; text-align: center;
}
.tim-metric-label {
  font-size: 10px; font-weight: 700; color: #64748b;
  text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px;
}
.tim-metric-value {
  font-size: 16px; font-weight: 700; color: #0f172a;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  word-break: break-word;
}

.tim-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.tim-field { display: flex; flex-direction: column; gap: 4px; }
.tim-field-label {
  font-size: 11px; font-weight: 700; color: #334155;
  text-transform: uppercase; letter-spacing: 0.05em;
}
.tim-input {
  width: 100%; padding: 10px 12px; font-size: 14px;
  border: 1px solid #cbd5e1; border-radius: 8px;
  background: #fff; color: #0f172a; outline: none; font-family: inherit;
  box-sizing: border-box;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.tim-input:focus {
  border-color: #6366f1;
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.18);
}
.tim-input:disabled { background: #f8fafc; color: #94a3b8; cursor: not-allowed; }
.tim-readonly-input {
  width: 100%; padding: 10px 12px; font-size: 13px;
  border: 1px solid #e2e8f0; border-radius: 8px;
  background: #f8fafc; color: #0f172a;
  font-weight: 600; outline: none; cursor: not-allowed;
  box-sizing: border-box;
}
.tim-textarea {
  width: 100%; padding: 10px 12px; font-size: 13px;
  border: 1px solid #cbd5e1; border-radius: 8px;
  background: #fff; color: #0f172a;
  outline: none; resize: vertical; min-height: 60px; font-family: inherit;
  box-sizing: border-box;
}
.tim-textarea:focus {
  border-color: #6366f1;
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.18);
}
.tim-small-error { color: #dc2626; font-size: 11px; margin-top: 2px; }

.tim-success-wrap {
  display: flex; flex-direction: column; align-items: center; text-align: center;
  padding: 20px 12px;
}
.tim-success-icon {
  display: inline-flex; align-items: center; justify-content: center;
  margin-bottom: 12px;
}
.tim-success-icon svg {
  width: 56px; height: 56px;
  stroke-width: 1.8;
  color: #059669;
}
.tim-success-title {
  margin: 0; font-size: clamp(18px, 2vw, 22px); font-weight: 700; color: #0f172a;
}
.tim-success-subtitle {
  margin: 8px 0 20px; color: #64748b; font-size: 13px;
  max-width: 420px; line-height: 1.5;
}
.tim-success-card {
  width: 100%; max-width: 420px;
  background: linear-gradient(135deg, #f0fdfa 0%, #ecfeff 100%);
  border: 1.5px solid #99f6e4; border-radius: 14px;
  padding: 16px 20px; display: flex; flex-direction: column; gap: 10px;
}
.tim-success-row {
  display: flex; justify-content: space-between; align-items: center;
  gap: 12px; padding-bottom: 8px;
  border-bottom: 1px dashed rgba(0, 138, 130, 0.2);
}
.tim-success-row:last-child { border-bottom: none; padding-bottom: 0; }
.tim-success-label {
  font-size: 11px; font-weight: 700; color: #0f766e;
  text-transform: uppercase; letter-spacing: 0.05em;
}
.tim-success-value {
  font-size: 18px; font-weight: 700; color: #008a82;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
}
.tim-success-value-small {
  font-size: 13px; font-weight: 600; color: #0f172a; text-align: right;
  word-break: break-word;
}
.tim-success-badge {
  font-size: 11px; font-weight: 700; color: #92400e;
  background: #fef3c7; padding: 3px 10px; border-radius: 999px;
  letter-spacing: 0.05em;
}
.tim-success-btn { margin-top: 20px; min-width: 160px; }

/* ---------- Button icons ---------- */
.tim-btn-icon {
  width: 1em; height: 1em; flex-shrink: 0;
  stroke-width: 2.4;
}

@media (max-width: 900px) {
  .tim-card { max-width: 96vw; }
}

@media (max-width: 640px) {
  .tim-overlay { padding: 0; align-items: stretch; }
  .tim-card {
    max-height: 100vh; max-height: 100dvh;
    width: 100vw; max-width: 100vw;
    height: 100vh; height: 100dvh;
    border-radius: 0;
    animation: none;
  }
  .tim-header { padding: 12px 14px; }
  .tim-header-icon { width: 36px; height: 36px; border-radius: 10px; }
  .tim-header-icon svg { width: 18px; height: 18px; }
  .tim-header-title { font-size: 15px; }
  .tim-header-sub { font-size: 11px; }
  .tim-body { padding: 14px; gap: 14px; }
  .tim-input,
  .tim-textarea { font-size: 16px; }
  .tim-grid { grid-template-columns: 1fr; }
  .tim-metrics { grid-template-columns: repeat(3, 1fr); gap: 8px; }
  .tim-metric-box { padding: 8px 10px; }
  .tim-metric-label { font-size: 9px; }
  .tim-metric-value { font-size: 14px; }
  .tim-footer { padding: 10px 14px; gap: 8px; }
  .tim-footer > button {
    flex: 1 1 auto; min-height: 44px;
    padding: 12px 16px; font-size: 14px;
  }
  .tim-success-wrap { padding: 12px 8px; }
  .tim-success-icon svg { width: 48px; height: 48px; }
  .tim-success-btn { min-width: 0; width: 100%; }
}

@media (max-width: 380px) {
  .tim-header-icon { width: 32px; height: 32px; }
  .tim-header-icon svg { width: 16px; height: 16px; }
  .tim-header-title { font-size: 14px; }
  .tim-metrics { grid-template-columns: 1fr; }
  .tim-footer { flex-direction: column-reverse; }
  .tim-footer > button { width: 100%; }
  .tim-item-card { padding: 10px; gap: 10px; }
}

@media (max-height: 500px) and (orientation: landscape) {
  .tim-overlay { padding: 8px; align-items: center; }
  .tim-card {
    height: auto; max-height: 96vh;
    border-radius: 12px; max-width: 96vw;
  }
  .tim-header { padding: 8px 14px; }
  .tim-body   { padding: 10px 14px; gap: 10px; }
  .tim-footer { padding: 8px 14px; }
}

@media (prefers-reduced-motion: reduce) {
  .tim-card, .tim-overlay { animation: none !important; }
}
`;

export default TransferInventoryModal;