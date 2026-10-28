// src/components/shared/ManualWriteoffModal.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { FiAlertTriangle, FiInfo, FiX } from 'react-icons/fi';
import { damagedItemsApi, locatorsApi } from '../../services/api';
import ModalBanner from './ModalBanner';
import ItemImageThumb from './ItemImageThumb';
import SearchableLocatorSelect from './SearchableLocatorSelect';

const ManualWriteoffModal = ({
  warehouseCode,
  warehouseLabel,
  onClose,
  onSaved,
}) => {
  const [locatorCode, setLocatorCode]           = useState('');

  const [items, setItems]                       = useState([]);
  const [itemsLoading, setItemsLoading]         = useState(false);
  const [itemsError, setItemsError]             = useState('');
  const [itemCode, setItemCode]                 = useState('');

  const [qty, setQty]                           = useState('');
  const [reason, setReason]                     = useState('');
  const [submitting, setSubmitting]             = useState(false);
  const [feedback, setFeedback]                 = useState(null);

  // Load items when a locator is selected
  useEffect(() => {
    if (!locatorCode) {
      setItems([]);
      setItemCode('');
      setItemsError('');
      return;
    }
    let cancelled = false;
    (async () => {
      setItemsLoading(true);
      setItemsError('');
      try {
        const res = await locatorsApi.getItems(warehouseCode, locatorCode);
        if (cancelled) return;
        if (res.ok) {
          const list = Array.isArray(res.data) ? res.data : [];
          const withStock = list.filter((i) => Number(i.qty) > 0);
          setItems(withStock);
          if (withStock.length === 1) setItemCode(withStock[0].item_code);
          else setItemCode('');
        } else {
          setItemsError(res.data?.message || 'Could not load items.');
        }
      } catch (err) {
        console.warn('Items load failed:', err);
        if (!cancelled) setItemsError('Could not load items.');
      } finally {
        if (!cancelled) setItemsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [warehouseCode, locatorCode]);

  useEffect(() => { setQty(''); }, [itemCode, locatorCode]);

  const selectedItem = useMemo(
    () => items.find((i) => i.item_code === itemCode) || null,
    [items, itemCode]
  );
  const maxQty     = Number(selectedItem?.qty) || 0;
  const enteredQty = Number(qty) || 0;
  const afterQty   = Math.max(0, maxQty - enteredQty);

  const canSubmit =
    !!locatorCode &&
    !!itemCode &&
    enteredQty > 0 &&
    enteredQty <= maxQty &&
    reason.trim().length > 0 &&
    !submitting;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFeedback(null);

    if (!locatorCode) {
      setFeedback({ type: 'warning', title: 'Locator required', message: 'Pick a source locator first.' });
      return;
    }
    if (!itemCode) {
      setFeedback({ type: 'warning', title: 'Item required', message: 'Pick the item to write off.' });
      return;
    }
    if (!(enteredQty > 0)) {
      setFeedback({ type: 'warning', title: 'Quantity required', message: 'Enter a quantity greater than 0.' });
      return;
    }
    if (enteredQty > maxQty) {
      setFeedback({
        type: 'warning',
        title: 'Exceeds stock',
        message: `Only ${maxQty} unit(s) of ${itemCode} are in ${locatorCode}.`,
      });
      return;
    }
    if (!reason.trim()) {
      setFeedback({ type: 'warning', title: 'Reason required', message: 'Describe why these units are damaged.' });
      return;
    }

    const ok = window.confirm(
      `Confirm manual write-off?\n\n` +
      `Warehouse: ${warehouseLabel || warehouseCode}\n` +
      `Locator:   ${locatorCode}\n` +
      `Item:      ${itemCode}\n` +
      `Qty:       ${enteredQty} (${afterQty} will remain)\n` +
      `Reason:    ${reason.trim()}\n\n` +
      `Units will be moved to the DAMAGE-XX hold and the stock will be written off.\n\n` +
      `Proceed?`
    );
    if (!ok) return;

    setSubmitting(true);
    try {
      const res = await damagedItemsApi.recordManual({
        locator_code: locatorCode,
        item_code:    itemCode,
        qty:          enteredQty,
        reason:       reason.trim(),
      });

      if (!res.ok || res.data?.success === false) {
        setFeedback({
          type: 'error',
          title: 'Write-off failed',
          message: res.data?.message || 'Could not record the write-off.',
        });
        return;
      }

      onSaved?.();
      onClose?.();
    } catch (err) {
      console.error(err);
      setFeedback({
        type: 'error',
        title: 'Write-off failed',
        message: 'Unexpected error while recording the write-off.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <style>{modalCss}</style>

      <div className="mwo-overlay" onClick={submitting ? undefined : onClose}>
        <div
          className="mwo-card"
          role="dialog"
          aria-modal="true"
          aria-labelledby="mwo-title"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mwo-header">
            <div className="mwo-header-left">
              <div className="mwo-header-icon">
                <FiAlertTriangle aria-hidden="true" />
              </div>
              <div className="mwo-header-info">
                <h3 id="mwo-title" className="mwo-header-title">
                  Log Damage Write-off
                </h3>
                <div className="mwo-header-sub">
                  <span className="mwo-wh-code">{warehouseCode || '—'}</span>
                  {warehouseLabel && warehouseLabel !== warehouseCode && (
                    <>
                      <span className="mwo-dot">·</span>
                      <span>{warehouseLabel}</span>
                    </>
                  )}
                </div>
              </div>
            </div>
            <button
              type="button"
              className="mwo-close"
              onClick={onClose}
              disabled={submitting}
              aria-label="Close"
            >
              <FiX aria-hidden="true" />
            </button>
          </div>

          <form className="mwo-body" onSubmit={handleSubmit}>
            {feedback && (
              <ModalBanner
                type={feedback.type}
                title={feedback.title}
                message={feedback.message}
                onClose={() => setFeedback(null)}
              />
            )}

            <div className="mwo-note">
              <span className="mwo-note-icon"><FiInfo aria-hidden="true" /></span>
              <span>
                Move <strong>damaged units</strong> from a regular locator into
                this warehouse's <strong>DAMAGE-XX hold</strong>. The stock is
                decremented from inventory and a permanent write-off record is
                created against <strong>Manual Adjustment</strong>.
              </span>
            </div>

            <div className="mwo-field">
              <label className="mwo-label" htmlFor="mwo-locator">
                Source Locator <span className="mwo-required">*</span>
                <span className="mwo-hint">(where the damaged units are now)</span>
              </label>

              <SearchableLocatorSelect
                warehouseCode={warehouseCode}
                value={locatorCode}
                onChange={(item) => setLocatorCode(item?.locator_code || '')}
                placeholder="Search locator by code or name…"
                excludeDamage
                disabled={submitting}
              />
            </div>

            <div className="mwo-field">
              <label className="mwo-label" htmlFor="mwo-item">
                Item <span className="mwo-required">*</span>
                <span className="mwo-hint">(held in the selected locator)</span>
              </label>
              {!locatorCode ? (
                <div className="mwo-loading-box">Pick a locator first…</div>
              ) : itemsLoading ? (
                <div className="mwo-loading-box">Loading items…</div>
              ) : itemsError ? (
                <div className="mwo-loading-box mwo-loading-box--error">
                  {itemsError}
                </div>
              ) : items.length === 0 ? (
                <ModalBanner
                  type="warning"
                  title="Locator is empty"
                  message={`No stock held in ${locatorCode}.`}
                />
              ) : (
                <select
                  id="mwo-item"
                  value={itemCode}
                  onChange={(e) => setItemCode(e.target.value)}
                  className="mwo-input"
                  disabled={submitting}
                >
                  <option value="">— Select an item —</option>
                  {items.map((i) => (
                    <option key={i.item_code} value={i.item_code}>
                      {i.item_code}
                      {i.item_name ? ` — ${i.item_name}` : ''}
                      {Number(i.qty) > 0 ? ` (${i.qty})` : ''}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {selectedItem && (
              <div className="mwo-preview">
                <ItemImageThumb
                  src={selectedItem.image_url || null}
                  alt={selectedItem.item_code}
                  size={56}
                />
                <div className="mwo-preview-info">
                  <div className="mwo-preview-code">{selectedItem.item_code}</div>
                  <div className="mwo-preview-name" title={selectedItem.item_name}>
                    {selectedItem.item_name || '—'}
                  </div>
                  <div className="mwo-preview-meta">
                    <span className="mwo-preview-meta-item">
                      <span className="mwo-preview-meta-label">Stock here</span>
                      <span className="mwo-preview-meta-value">{maxQty}</span>
                    </span>
                    <span className="mwo-preview-meta-item">
                      <span className="mwo-preview-meta-label">After write-off</span>
                      <span
                        className={
                          'mwo-preview-meta-value' +
                          (afterQty > 0 ? '' : ' mwo-preview-meta-value--zero')
                        }
                      >
                        {afterQty}
                      </span>
                    </span>
                  </div>
                </div>
              </div>
            )}

            <div className="mwo-field">
              <label className="mwo-label" htmlFor="mwo-qty">
                Quantity to write off <span className="mwo-required">*</span>
                {selectedItem && (
                  <span className="mwo-hint">(max {maxQty})</span>
                )}
              </label>
              <input
                id="mwo-qty"
                type="number"
                min="1"
                max={maxQty || undefined}
                inputMode="numeric"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                disabled={submitting || !selectedItem}
                placeholder={selectedItem ? `0 – ${maxQty}` : '—'}
                className="mwo-input mwo-input--qty"
              />
            </div>

            <div className="mwo-field">
              <label className="mwo-label" htmlFor="mwo-reason">
                Reason <span className="mwo-required">*</span>
                <span className="mwo-hint">(shown on the write-off record)</span>
              </label>
              <textarea
                id="mwo-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                disabled={submitting}
                placeholder="e.g. Cycle count discrepancy — units found physically broken during inspection."
                className="mwo-input mwo-textarea"
              />
            </div>

            <div className="mwo-footer">
              <button
                type="button"
                onClick={onClose}
                className="mwo-btn-ghost"
                disabled={submitting}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="mwo-btn-danger"
                disabled={!canSubmit}
              >
                {submitting ? (
                  'Recording…'
                ) : (
                  <>
                    <FiAlertTriangle className="mwo-btn-icon" aria-hidden="true" />
                    <span>Record Write-off</span>
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
@keyframes mwoFadeIn { from { opacity: 0 } to { opacity: 1 } }
@keyframes mwoSlideUp { from { opacity: 0; transform: translateY(16px) scale(0.98) } to { opacity: 1; transform: translateY(0) scale(1) } }

.mwo-header-icon svg { width: 1em; height: 1em; stroke-width: 2.2; }
.mwo-close svg { width: 1em; height: 1em; stroke-width: 2.2; }
.mwo-note-icon {
  display: inline-flex; align-items: center; justify-content: center;
  width: 1.15em; height: 1.15em; flex-shrink: 0;
  line-height: 1.2; color: #b45309;
}
.mwo-note-icon svg { width: 100%; height: 100%; stroke-width: 2.2; }
.mwo-btn-icon { width: 1em; height: 1em; flex-shrink: 0; stroke-width: 2.4; }

.mwo-overlay {
  position: fixed; inset: 0;
  background: rgba(15, 23, 42, 0.62);
  backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
  display: flex; align-items: center; justify-content: center;
  z-index: 10000;
  padding: clamp(8px, 2vw, 24px);
  animation: mwoFadeIn 0.18s ease;
}
.mwo-card {
  background: #ffffff;
  border-radius: clamp(12px, 1.5vw, 16px);
  width: 100%;
  max-width: 620px;
  max-height: 92vh;
  max-height: 92dvh;
  display: flex; flex-direction: column;
  overflow: hidden;
  box-shadow: 0 24px 64px rgba(15, 23, 42, 0.28), 0 4px 14px rgba(15, 23, 42, 0.14);
  animation: mwoSlideUp 0.22s cubic-bezier(0.34, 1.3, 0.64, 1);
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}

.mwo-header {
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px;
  padding: clamp(14px, 1.8vw, 20px) clamp(18px, 2.4vw, 22px);
  border-bottom: 1px solid #e5e7eb;
  background: linear-gradient(135deg, #ffffff 0%, #f8fafc 100%);
  flex-shrink: 0;
}
.mwo-header-left { display: flex; align-items: center; gap: 12px; min-width: 0; flex: 1; }
.mwo-header-info { min-width: 0; }
.mwo-header-icon {
  width: 44px; height: 44px; border-radius: 12px;
  background: linear-gradient(135deg, #fbbf24 0%, #d97706 100%);
  color: #fff; display: flex; align-items: center; justify-content: center;
  font-size: 22px; flex-shrink: 0;
  box-shadow: 0 4px 12px rgba(217, 119, 6, 0.32);
}
.mwo-header-title {
  margin: 0; font-size: clamp(16px, 1.6vw, 18px); font-weight: 700;
  color: #0f172a; line-height: 1.2;
}
.mwo-header-sub {
  font-size: 12px; color: #64748b; margin-top: 3px;
  display: flex; flex-wrap: wrap; align-items: center; gap: 5px;
}
.mwo-wh-code {
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-weight: 700; color: #0f766e;
}
.mwo-dot { color: #cbd5e1; }
.mwo-close {
  background: transparent; border: none;
  width: 36px; height: 36px; border-radius: 8px; cursor: pointer;
  font-size: 18px; color: #64748b; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
}
.mwo-close:hover:not(:disabled) { background: #f1f5f9; color: #0f172a; }
.mwo-close:disabled { opacity: 0.4; cursor: not-allowed; }

.mwo-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: clamp(16px, 2vw, 20px);
  display: flex; flex-direction: column;
  gap: clamp(12px, 1.4vw, 16px);
  background: #ffffff;
  -webkit-overflow-scrolling: touch;
}
.mwo-body > * { flex-shrink: 0; }

.mwo-body::-webkit-scrollbar { width: 8px; }
.mwo-body::-webkit-scrollbar-track { background: #f1f5f9; border-radius: 4px; }
.mwo-body::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 4px; }
.mwo-body::-webkit-scrollbar-thumb:hover { background: #94a3b8; }

.mwo-note {
  display: flex; align-items: flex-start; gap: 8px;
  padding: 11px 14px;
  background: #fef3c7;
  border: 1px solid #fcd34d;
  border-radius: 8px;
  font-size: 12.5px; color: #78350f; line-height: 1.5;
}

.mwo-field { display: flex; flex-direction: column; gap: 6px; }
.mwo-label {
  font-size: 13px; font-weight: 600; color: #334155;
  display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px;
}
.mwo-hint { color: #94a3b8; font-weight: 500; font-size: 12px; }
.mwo-required { color: #dc2626; font-weight: 700; }

.mwo-input {
  width: 100%; padding: 10px 12px;
  border: 1px solid #cbd5e1; border-radius: 8px;
  font-size: 14px; font-family: inherit; color: #0f172a; outline: none;
  background: #fff;
  box-sizing: border-box;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.mwo-input:focus {
  border-color: #00b8b0;
  box-shadow: 0 0 0 3px rgba(0, 184, 176, 0.15);
}
.mwo-input:disabled {
  background: #f8fafc; color: #94a3b8; cursor: not-allowed;
}
.mwo-input--qty {
  font-size: 15px; font-weight: 700; text-align: center;
}
.mwo-textarea {
  resize: vertical; min-height: 76px;
  font-size: 13.5px; line-height: 1.5;
}

.mwo-loading-box {
  padding: 10px 12px; border: 1px dashed #cbd5e1; border-radius: 8px;
  font-size: 13px; color: #64748b; background: #f8fafc;
}
.mwo-loading-box--error {
  border-color: #fca5a5;
  background: #fef2f2;
  color: #991b1b;
}

.mwo-preview {
  display: flex; gap: 12px; align-items: center;
  padding: 12px 14px;
  background: linear-gradient(135deg, #f8fafc 0%, #eef2f6 100%);
  border: 1px solid #e2e8f0; border-radius: 10px;
}
.mwo-preview-info {
  flex: 1; min-width: 0;
  display: flex; flex-direction: column; gap: 4px;
}
.mwo-preview-code {
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-weight: 800; font-size: 14px; color: #4338ca; line-height: 1.2;
  word-break: break-word;
}
.mwo-preview-name {
  font-size: 12px; color: #475569;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.mwo-preview-meta {
  display: flex; gap: 16px; margin-top: 4px; flex-wrap: wrap;
}
.mwo-preview-meta-item { display: flex; align-items: baseline; gap: 6px; }
.mwo-preview-meta-label {
  font-size: 10px; font-weight: 700; color: #64748b;
  text-transform: uppercase; letter-spacing: 0.05em;
}
.mwo-preview-meta-value {
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-weight: 800; font-size: 14px; color: #0f172a;
}
.mwo-preview-meta-value--zero { color: #dc2626; }

.mwo-footer {
  display: flex; justify-content: flex-end; gap: 10px;
  margin-top: 4px;
  flex-shrink: 0;
}
.mwo-btn-ghost {
  padding: 10px 18px; background: #fff; border: 1px solid #cbd5e1;
  border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer;
  color: #334155; font-family: inherit;
  transition: background 0.15s ease;
}
.mwo-btn-ghost:hover:not(:disabled) { background: #f8fafc; }
.mwo-btn-ghost:disabled { opacity: 0.5; cursor: not-allowed; }

.mwo-btn-danger {
  padding: 10px 22px;
  background: linear-gradient(135deg, #f97316 0%, #dc2626 100%);
  color: #fff; border: none; border-radius: 8px;
  font-size: 14px; font-weight: 700; cursor: pointer; font-family: inherit;
  box-shadow: 0 4px 12px rgba(220, 38, 38, 0.28);
  transition: transform 0.1s ease, box-shadow 0.15s ease;
  display: inline-flex; align-items: center; justify-content: center; gap: 7px;
}
.mwo-btn-danger:hover:not(:disabled) {
  box-shadow: 0 6px 16px rgba(220, 38, 38, 0.4);
}
.mwo-btn-danger:active:not(:disabled) { transform: scale(0.98); }
.mwo-btn-danger:disabled { opacity: 0.5; cursor: not-allowed; box-shadow: none; }

@media (max-width: 900px) {
  .mwo-card { max-width: 96vw; }
}

@media (max-width: 640px) {
  .mwo-overlay { padding: 0; align-items: stretch; }
  .mwo-card {
    max-height: 100vh;
    max-height: 100dvh;
    width: 100vw;
    max-width: 100vw;
    height: 100vh;
    height: 100dvh;
    border-radius: 0;
    animation: none;
  }
  .mwo-header { padding: 12px 14px; }
  .mwo-header-icon { width: 36px; height: 36px; font-size: 18px; border-radius: 10px; }
  .mwo-header-title { font-size: 15px; }
  .mwo-header-sub { font-size: 11px; }

  .mwo-body { padding: 14px; gap: 12px; }

  .mwo-input { font-size: 16px; }
  .mwo-textarea { font-size: 16px; min-height: 68px; }
  .mwo-input--qty { font-size: 16px; }

  .mwo-btn-ghost, .mwo-btn-danger {
    min-height: 44px; font-size: 14px;
  }
  .mwo-footer { flex-direction: column-reverse; gap: 8px; }
  .mwo-footer > button { width: 100%; }

  .mwo-preview { flex-wrap: wrap; }
  .mwo-preview-meta { gap: 12px; }
}

@media (max-width: 380px) {
  .mwo-header-icon { width: 32px; height: 32px; font-size: 16px; }
  .mwo-header-title { font-size: 14px; }
  .mwo-preview { flex-direction: column; align-items: stretch; }
}

@media (max-height: 500px) and (orientation: landscape) {
  .mwo-overlay { padding: 8px; align-items: center; }
  .mwo-card {
    height: auto; max-height: 96vh;
    border-radius: 12px; max-width: 96vw;
  }
  .mwo-header { padding: 8px 14px; }
  .mwo-body   { padding: 10px 14px; gap: 8px; }
  .mwo-footer { padding: 0; }
}

@media (prefers-reduced-motion: reduce) {
  .mwo-card, .mwo-overlay { animation: none !important; }
  .mwo-btn-danger { transition: none !important; }
}
`;

export default ManualWriteoffModal;