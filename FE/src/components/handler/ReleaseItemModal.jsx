// src/components/handler/ReleaseItemModal.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { FiSend, FiX, FiCheckCircle } from 'react-icons/fi';
import { importPoApi } from '../../services/api';
import ModalBanner from '../shared/ModalBanner';
import ItemImageThumb from '../shared/ItemImageThumb';

const ReleaseItemModal = ({ row, onClose, onReleased }) => {
  const maxQty = useMemo(() => {
    if (!row) return 0;
    const received = Number(row.received_qty) || 0;
    const damaged  = Number(row.damaged_qty)  || 0;
    const stored   = Number(row.stored_qty)   || 0;
    const released = Number(row.released_qty) || 0;
    return Math.max(0, received - damaged - stored - released);
  }, [row]);

  const [qty, setQty] = useState(maxQty);
  const [releasedTo, setReleasedTo] = useState('');
  const [purpose, setPurpose] = useState('');
  const [reference, setReference] = useState('');
  const [remarks, setRemarks] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState(null);

  useEffect(() => {
    setQty(maxQty);
    setFeedback(null);
  }, [maxQty]);

  if (!row) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFeedback(null);

    if (!releasedTo.trim()) {
      setFeedback({
        type: 'warning',
        title: 'Recipient required',
        message: 'Please enter who this item is being released to.',
      });
      return;
    }

    const n = Number(qty);
    if (!Number.isFinite(n) || n <= 0) {
      setFeedback({
        type: 'warning',
        title: 'Invalid quantity',
        message: 'Enter a quantity greater than 0.',
      });
      return;
    }
    if (n > maxQty) {
      setFeedback({
        type: 'warning',
        title: 'Exceeds available',
        message: `You can release at most ${maxQty} unit(s).`,
      });
      return;
    }

    const itemId = row.id ?? row.item_id;
    if (!itemId) {
      setFeedback({
        type: 'error',
        title: 'Line error',
        message: 'This line has no id — cannot release. Try refreshing the list.',
      });
      return;
    }

    setSubmitting(true);
    try {
      const res = await importPoApi.releaseLine(row.po_no, {
        item_id:        itemId,
        qty_to_release: n,
        released_to:    releasedTo.trim(),
        purpose:        purpose.trim() || undefined,
        reference:      reference.trim() || undefined,
        remarks:        remarks.trim() || undefined,
      });

      if (!res.ok || res.data?.success === false) {
        setFeedback({
          type: 'error',
          title: 'Release failed',
          message: res.data?.message || 'Failed to release item.',
        });
        return;
      }

      onReleased?.();
      onClose?.();
    } catch (err) {
      console.error(err);
      setFeedback({
        type: 'error',
        title: 'Release failed',
        message: 'Unexpected error while releasing item.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <style>{modalCss}</style>

      <div
        className="rim-overlay"
        onClick={submitting ? undefined : onClose}
      >
        <div
          className="rim-card"
          onClick={(e) => e.stopPropagation()}
        >
          {/* ---------- HEADER ---------- */}
          <div className="rim-header">
            <div className="rim-header-left">
              <div className="rim-header-icon"><FiSend /></div>
              <div className="rim-header-info">
                <h3 className="rim-header-title">Release Item</h3>
                <div className="rim-header-sub">
                  {row.item_code} · {row.item_name || '—'}
                </div>
              </div>
            </div>
            <button
              type="button"
              className="rim-close"
              onClick={onClose}
              disabled={submitting}
              aria-label="Close"
            ><FiX /></button>
          </div>

          {/* ---------- BODY ---------- */}
          <form className="rim-body" onSubmit={handleSubmit}>
            {feedback && (
              <ModalBanner
                type={feedback.type}
                title={feedback.title}
                message={feedback.message}
                onClose={() => setFeedback(null)}
              />
            )}

            {maxQty === 0 && !feedback && (
              <ModalBanner
                type="warning"
                title="Nothing to release"
                message="Nothing left to release on this line."
              />
            )}

            {/* ---------- FULL ITEM CARD ---------- */}
            <div className="rim-item-card">
              <ItemImageThumb src={row.image_url || null} alt={row.item_code} size={92} />

              <div className="rim-item-info">
                <div className="rim-item-code-line">
                  <span className="rim-item-code">{row.item_code}</span>
                  {row.barcode && (
                    <span className="rim-barcode-chip" title={`Barcode: ${row.barcode}`}>
                      ▥ {row.barcode}
                    </span>
                  )}
                </div>

                <div className="rim-item-desc" title={row.item_name}>
                  {row.item_name || '—'}
                </div>

                <div className="rim-chip-row">
                  {row.uom && (
                    <span className="rim-chip rim-chip--uom" title="Unit of Measure">
                      {row.uom}
                      {row.uom_description && row.uom_description !== row.uom
                        ? ` · ${row.uom_description}`
                        : ''}
                    </span>
                  )}
                  {row.category && (
                    <span className="rim-chip rim-chip--cat" title="Category">{row.category}</span>
                  )}
                  {row.purchase_class && (
                    <span className="rim-chip rim-chip--pc" title="Purchase Class">{row.purchase_class}</span>
                  )}
                  {row.gl_class_code && (
                    <span className="rim-chip rim-chip--gl" title={row.gl_description || 'GL Class'}>
                      GL {row.gl_class_code}
                      {row.gl_description ? ` · ${row.gl_description}` : ''}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* ---------- PROCESS STATE ---------- */}
            <div className="rim-meta-grid">
              <div className="rim-meta-box">
                <div className="rim-meta-label">PO No.</div>
                <div className="rim-meta-value">{row.po_no}</div>
              </div>
              <div className="rim-meta-box">
                <div className="rim-meta-label">Received</div>
                <div className="rim-meta-value">{Number(row.received_qty) || 0}</div>
              </div>
              <div className="rim-meta-box">
                <div className="rim-meta-label">Already Stored</div>
                <div className="rim-meta-value">{Number(row.stored_qty) || 0}</div>
              </div>
              <div className="rim-meta-box">
                <div className="rim-meta-label">Already Released</div>
                <div className="rim-meta-value">{Number(row.released_qty) || 0}</div>
              </div>
            </div>

            {/* ---------- RELEASE TO ---------- */}
            <div className="rim-field">
              <label className="rim-label">
                Release to <span className="rim-required">*</span>{' '}
                <span className="rim-hint">(recipient, department, person)</span>
              </label>
              <input
                type="text"
                value={releasedTo}
                onChange={(e) => setReleasedTo(e.target.value)}
                placeholder="e.g. Maintenance Dept. / Juan Dela Cruz"
                className="rim-input"
                disabled={submitting}
                required
              />
            </div>

            {/* ---------- PURPOSE ---------- */}
            <div className="rim-field">
              <label className="rim-label">
                Purpose <span className="rim-hint">(optional)</span>
              </label>
              <input
                type="text"
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                placeholder="e.g. Production use, repair, return to vendor"
                className="rim-input"
                disabled={submitting}
              />
            </div>

            {/* ---------- REFERENCE ---------- */}
            <div className="rim-field">
              <label className="rim-label">
                Reference <span className="rim-hint">(optional)</span>
              </label>
              <input
                type="text"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="e.g. ticket #, work order, slip #"
                className="rim-input"
                disabled={submitting}
              />
            </div>

            {/* ---------- QTY ---------- */}
            <div className="rim-field">
              <label className="rim-label">
                Quantity to release <span className="rim-hint">(max {maxQty})</span>
              </label>
              <input
                type="number"
                min={1}
                max={maxQty}
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                className="rim-input"
                disabled={submitting || maxQty === 0}
              />
            </div>

            {/* ---------- REMARKS ---------- */}
            <div className="rim-field">
              <label className="rim-label">
                Remarks <span className="rim-hint">(optional)</span>
              </label>
              <textarea
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                rows={3}
                className="rim-input rim-textarea"
                disabled={submitting}
              />
            </div>

            {/* ---------- FOOTER ---------- */}
            <div className="rim-footer">
              <button
                type="button"
                onClick={onClose}
                className="rim-btn-ghost"
                disabled={submitting}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rim-btn-primary"
                disabled={submitting || maxQty === 0 || !releasedTo.trim()}
              >
                {submitting ? (
                  'Releasing…'
                ) : (
                  <>
                    <FiCheckCircle className="rim-btn-icon" />
                    <span>Release</span>
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
};

/* ============================================================ */
const modalCss = `
@keyframes rimFadeIn { from { opacity: 0 } to { opacity: 1 } }
@keyframes rimSlideUp { from { opacity: 0; transform: translateY(16px) scale(0.98) } to { opacity: 1; transform: translateY(0) scale(1) } }

.rim-overlay {
  position: fixed; inset: 0;
  background: rgba(15, 23, 42, 0.62);
  backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
  display: flex; align-items: center; justify-content: center;
  z-index: 10000;
  padding: clamp(8px, 2vw, 24px);
  animation: rimFadeIn 0.18s ease;
}
.rim-card {
  background: #ffffff;
  border-radius: clamp(12px, 1.5vw, 16px);
  width: 100%;
  max-width: 600px;
  max-height: 92vh;
  max-height: 92dvh;
  display: flex; flex-direction: column;
  overflow: hidden;
  box-shadow: 0 24px 64px rgba(15, 23, 42, 0.28), 0 4px 14px rgba(15, 23, 42, 0.14);
  animation: rimSlideUp 0.22s cubic-bezier(0.34, 1.3, 0.64, 1);
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}

.rim-header {
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px;
  padding: clamp(14px, 1.8vw, 20px) clamp(18px, 2.4vw, 22px);
  border-bottom: 1px solid #e5e7eb;
  background: linear-gradient(135deg, #ffffff 0%, #fff7ed 100%);
  flex-shrink: 0;
}
.rim-header-left { display: flex; align-items: center; gap: 12px; min-width: 0; flex: 1; }
.rim-header-info { min-width: 0; }
.rim-header-icon {
  width: 44px; height: 44px; border-radius: 12px;
  background: linear-gradient(135deg, #fb923c 0%, #c2410c 100%);
  color: #fff; display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.rim-header-icon svg { width: 22px; height: 22px; stroke-width: 2.2; }
.rim-header-title {
  margin: 0; font-size: clamp(16px, 1.6vw, 18px); font-weight: 700;
  color: #0f172a; line-height: 1.2;
}
.rim-header-sub {
  font-size: 12px; color: #64748b; margin-top: 2px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.rim-close {
  background: transparent; border: none;
  width: 36px; height: 36px; border-radius: 8px; cursor: pointer;
  color: #64748b; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
}
.rim-close svg { width: 18px; height: 18px; stroke-width: 2.4; }
.rim-close:hover:not(:disabled) { background: #f1f5f9; color: #0f172a; }
.rim-close:disabled { opacity: 0.4; cursor: not-allowed; }

.rim-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: clamp(16px, 2vw, 20px);
  display: flex; flex-direction: column;
  gap: clamp(12px, 1.4vw, 16px);
  background: #ffffff;
  -webkit-overflow-scrolling: touch;
}
.rim-body > * { flex-shrink: 0; }

.rim-body::-webkit-scrollbar { width: 8px; }
.rim-body::-webkit-scrollbar-track { background: #f1f5f9; border-radius: 4px; }
.rim-body::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 4px; }
.rim-body::-webkit-scrollbar-thumb:hover { background: #94a3b8; }

.rim-item-card {
  display: flex; gap: 14px; align-items: flex-start;
  padding: 14px 16px;
  background: linear-gradient(135deg, #fff7ed 0%, #ffedd5 100%);
  border: 1px solid #fed7aa; border-radius: 12px;
}
.rim-item-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.rim-item-code-line { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.rim-item-code {
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-size: 16px; font-weight: 800; color: #c2410c; line-height: 1.2;
}
.rim-item-desc {
  font-size: 13px; font-weight: 600; color: #0f172a; line-height: 1.4;
  word-break: break-word;
}
.rim-chip-row { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 2px; }
.rim-barcode-chip {
  display: inline-block; padding: 3px 10px;
  font-size: 11px; font-weight: 700; color: #7c3aed; background: #f5f3ff;
  border: 1px solid #ddd6fe; border-radius: 999px;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  letter-spacing: 0.02em;
}
.rim-chip {
  display: inline-block; padding: 3px 10px;
  font-size: 11px; font-weight: 600; border-radius: 999px;
}
.rim-chip--uom {
  color: #334155; background: #f1f5f9; border: 1px solid #cbd5e1;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
}
.rim-chip--cat { color: #0f766e; background: #f0fdfa; border: 1px solid #99f6e4; font-weight: 700; }
.rim-chip--pc  { color: #4338ca; background: #eef2ff; border: 1px solid #c7d2fe; font-weight: 700; }
.rim-chip--gl  { color: #92400e; background: #fef3c7; border: 1px solid #fcd34d; font-weight: 700; }

.rim-meta-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 8px;
}
.rim-meta-box {
  padding: 8px 10px; background: #f8fafc;
  border: 1px solid #e2e8f0; border-radius: 8px;
}
.rim-meta-label {
  font-size: 10px; font-weight: 700; color: #64748b;
  text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 2px;
}
.rim-meta-value { font-size: 13px; font-weight: 600; color: #0f172a; word-break: break-word; }

.rim-field { display: flex; flex-direction: column; gap: 6px; }
.rim-label { font-size: 13px; font-weight: 600; color: #334155; }
.rim-hint { color: #94a3b8; font-weight: 500; }
.rim-required { color: #dc2626; font-weight: 700; }

.rim-input {
  width: 100%; padding: 10px 12px;
  border: 1px solid #cbd5e1; border-radius: 8px;
  font-size: 14px; font-family: inherit; color: #0f172a; outline: none;
  background: #fff;
  box-sizing: border-box;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.rim-input:focus {
  border-color: #fb923c;
  box-shadow: 0 0 0 3px rgba(251, 146, 60, 0.18);
}
.rim-input:disabled { background: #f8fafc; color: #94a3b8; cursor: not-allowed; }
.rim-textarea { resize: vertical; min-height: 72px; }

.rim-footer {
  display: flex; justify-content: flex-end; gap: 10px;
  margin-top: 4px;
  flex-shrink: 0;
}
.rim-btn-ghost {
  padding: 10px 18px; background: #fff; border: 1px solid #cbd5e1;
  border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer;
  color: #334155; font-family: inherit;
  transition: background 0.15s ease;
}
.rim-btn-ghost:hover:not(:disabled) { background: #f8fafc; }
.rim-btn-ghost:disabled { opacity: 0.5; cursor: not-allowed; }
.rim-btn-primary {
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  padding: 10px 22px;
  background: linear-gradient(135deg, #fb923c 0%, #ea580c 45%, #c2410c 100%);
  color: #fff; border: none; border-radius: 8px;
  font-size: 14px; font-weight: 700; cursor: pointer; font-family: inherit;
  box-shadow: 0 4px 12px rgba(251, 146, 60, 0.32);
  transition: transform 0.1s ease, box-shadow 0.15s ease;
}
.rim-btn-primary:hover:not(:disabled) { box-shadow: 0 6px 16px rgba(251, 146, 60, 0.42); }
.rim-btn-primary:active:not(:disabled) { transform: scale(0.98); }
.rim-btn-primary:disabled { opacity: 0.5; cursor: not-allowed; box-shadow: none; }
.rim-btn-icon { width: 1em; height: 1em; stroke-width: 2.4; }

@media (max-width: 900px) {
  .rim-card { max-width: 96vw; }
  .rim-meta-grid { grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); }
}

@media (max-width: 640px) {
  .rim-overlay { padding: 0; align-items: stretch; }
  .rim-card {
    max-height: 100vh; max-height: 100dvh;
    width: 100vw; max-width: 100vw;
    height: 100vh; height: 100dvh;
    border-radius: 0;
    animation: none;
  }
  .rim-header { padding: 12px 14px; }
  .rim-header-icon { width: 36px; height: 36px; border-radius: 10px; }
  .rim-header-icon svg { width: 18px; height: 18px; }
  .rim-header-title { font-size: 15px; }
  .rim-header-sub { font-size: 11px; }
  .rim-body { padding: 14px; gap: 12px; }
  .rim-input { font-size: 16px; }
  .rim-btn-ghost,
  .rim-btn-primary { min-height: 44px; font-size: 14px; }
  .rim-footer { flex-direction: row-reverse; gap: 8px; }
  .rim-footer > button { flex: 1 1 auto; }
  .rim-item-card { padding: 12px; gap: 12px; }
  .rim-item-code { font-size: 15px; }
  .rim-meta-grid { grid-template-columns: 1fr 1fr; }
  .rim-meta-box { padding: 8px 10px; }
  .rim-meta-label { font-size: 9px; }
  .rim-meta-value { font-size: 12px; }
}

@media (max-width: 380px) {
  .rim-meta-grid { grid-template-columns: 1fr; }
  .rim-header-icon { width: 32px; height: 32px; }
  .rim-header-icon svg { width: 16px; height: 16px; }
  .rim-header-title { font-size: 14px; }
  .rim-footer { flex-direction: column-reverse; }
  .rim-footer > button { width: 100%; }
}

@media (max-height: 500px) and (orientation: landscape) {
  .rim-overlay { padding: 8px; align-items: center; }
  .rim-card {
    height: auto; max-height: 96vh;
    border-radius: 12px; max-width: 96vw;
  }
  .rim-header { padding: 8px 14px; }
  .rim-body   { padding: 10px 14px; gap: 8px; }
}

@media (prefers-reduced-motion: reduce) {
  .rim-card, .rim-overlay { animation: none !important; }
  .rim-btn-primary { transition: none !important; }
}
`;

export default ReleaseItemModal;