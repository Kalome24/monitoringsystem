// src/components/registrar/ReceivePoModal.jsx
import React, { useEffect, useMemo, useState } from 'react';
import {
  FiPackage,
  FiX,
  FiCheckCircle,
  FiInfo,
  FiSend,
  FiEdit2,
} from 'react-icons/fi';
import { importPoApi, itemMasterApi } from '../../services/api';
import ModalBanner from '../shared/ModalBanner';
import ItemImageThumb from '../shared/ItemImageThumb';

const CURRENCIES = [
  'PHP', 'USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD',
  'SGD', 'HKD', 'CNY', 'KRW', 'MYR', 'THB', 'IDR',
  'VND', 'INR', 'AED', 'SAR', 'CHF', 'NZD',
];

const MODAL_WIDTH = {
  mode:    760,
  entry:  1180,
  saved:   580,
};

const ReceivePoModal = ({
  po,
  warehouseLabel,
  lines,
  onClose,
  onSaved,
  onSendToHandler,
}) => {
  const [mode, setMode]                         = useState(null);
  const [editable, setEditable]                 = useState([]);
  const [saving, setSaving]                     = useState(false);
  const [images, setImages]                     = useState({});
  const [currentLines, setCurrentLines]         = useState(lines || []);
  const [savedSummary, setSavedSummary]         = useState(null);
  const [postActionBusy, setPostActionBusy]     = useState(false);
  const [feedback, setFeedback]                 = useState(null);

  useEffect(() => {
    setCurrentLines(lines || []);
  }, [lines]);

  useEffect(() => {
    const codes = [...new Set((currentLines || []).map((l) => l.item_code).filter(Boolean))];
    if (codes.length === 0) return;

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
  }, [currentLines]);

  const handleChooseMode = (chosen) => {
    setFeedback(null);
    setMode(chosen);
    setEditable(
      currentLines.map((l) => {
        const ordered   = Number(l.qty)          || 0;
        const received  = Number(l.received_qty) || 0;
        const remaining = Math.max(0, ordered - received);

        return {
          id:               l.id,
          item_code:        l.item_code,
          item_name:        l.item_name || '',
          uom:              l.uom || '',
          ordered_qty:      ordered,
          already_received: received,
          remaining,
          incoming_received: chosen === 'complete' ? remaining : 0,
          unit_price:        l.unit_price ?? '',
          currency:          l.currency || 'PHP',
          line_status:       l.status,
        };
      })
    );
  };

  const handleChange = (id, field, value) => {
    setEditable((prev) =>
      prev.map((l) => {
        if (l.id !== id) return l;

        if (field === 'incoming_received') {
          if (value === '' || value === null || value === undefined) {
            return { ...l, incoming_received: '' };
          }
          const r = Math.max(0, Math.min(parseInt(value, 10) || 0, l.remaining));
          return { ...l, incoming_received: r };
        }

        return { ...l, [field]: value };
      })
    );
  };

  const handleSave = async () => {
    setFeedback(null);

    const items = editable
      .map((l) => ({
        id:           l.id,
        received_qty: Number(l.incoming_received) || 0,
        unit_price:   l.unit_price === '' || l.unit_price === null
                        ? null
                        : Number(l.unit_price),
        currency:     l.currency || null,
      }))
      .filter((it) => it.received_qty > 0);

    if (items.length === 0) {
      setFeedback({
        type: 'warning',
        title: 'Nothing to save',
        message: 'Please enter at least one received quantity.',
      });
      return;
    }

    const modeLabel = mode === 'complete' ? 'COMPLETE' : 'PARTIAL';
    const confirmMsg =
      `Submit ${modeLabel} receive?\n\n` +
      `PO No.:    ${po.po_no}\n` +
      `Warehouse: ${warehouseLabel}\n` +
      `Lines:     ${items.length}\n\n` +
      `Proceed?`;
    if (!window.confirm(confirmMsg)) return;

    setSaving(true);
    try {
      const res = await importPoApi.receivePO(po.po_no, items);
      if (!res.ok) {
        setFeedback({
          type: 'error',
          title: 'Save failed',
          message: res.data?.message || 'Failed to save receipt.',
        });
        return;
      }

      const totalGood = items.reduce((s, it) => s + (Number(it.received_qty) || 0), 0);

      setSavedSummary({ linesCount: items.length, totalGood });
      setMode('saved');
      setFeedback(null);
    } catch (err) {
      console.error(err);
      setFeedback({
        type: 'error',
        title: 'Save failed',
        message: 'Error saving receipt. Please try again.',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleEditAfterSave = async () => {
    setPostActionBusy(true);
    setFeedback(null);
    try {
      const res = await importPoApi.getPODetail(po.po_no);
      if (!res.ok || !Array.isArray(res.data)) {
        setFeedback({
          type: 'error',
          title: 'Reload failed',
          message: 'Could not reload PO data. Close and reopen the modal.',
        });
        return;
      }
      setCurrentLines(res.data);
      setEditable([]);
      setMode(null);
      setSavedSummary(null);
    } catch (err) {
      console.error(err);
      setFeedback({
        type: 'error',
        title: 'Reload failed',
        message: 'Error reloading PO. Close and reopen the modal.',
      });
    } finally {
      setPostActionBusy(false);
    }
  };

  const handleSendAfterSave = async () => {
    if (!onSendToHandler) {
      onSaved?.();
      onClose();
      return;
    }

    const ok = window.confirm(
      `Send this PO's received lines to the Stock Handler?\n\n` +
      `PO No.: ${po.po_no}\n\n` +
      `You will not be able to edit the receipt after this. ` +
      `The lines will move to the Handler's queue.\n\n` +
      `Proceed?`
    );
    if (!ok) return;

    setPostActionBusy(true);
    setFeedback(null);
    try {
      const success = await onSendToHandler(po.po_no);
      if (success) {
        onSaved?.();
        onClose();
      }
    } finally {
      setPostActionBusy(false);
    }
  };

  const summary = useMemo(() => {
    if (editable.length === 0) return { total: 0, received: 0 };
    let received = 0;
    for (const l of editable) {
      received += Number(l.incoming_received) || 0;
    }
    return { total: editable.length, received };
  }, [editable]);

  const isSaved = mode === 'saved';
  const cardMaxWidth = isSaved
    ? MODAL_WIDTH.saved
    : mode === null
      ? MODAL_WIDTH.mode
      : MODAL_WIDTH.entry;

  const renderCurrencySelect = (l) => {
    const current = l.currency || 'PHP';
    const extraNeeded = !CURRENCIES.includes(current);
    return (
      <select
        value={current}
        onChange={(e) => handleChange(l.id, 'currency', e.target.value)}
        disabled={saving}
        className="rpm-curr-select"
      >
        {extraNeeded && <option value={current}>{current}</option>}
        {CURRENCIES.map((c) => (
          <option key={c} value={c}>{c}</option>
        ))}
      </select>
    );
  };

  return (
    <>
      <style>{modalCss}</style>

      <div
        className="rpm-overlay"
        onClick={saving || postActionBusy ? undefined : onClose}
      >
        <div
          className="rpm-card"
          style={{ maxWidth: cardMaxWidth }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className={`rpm-header${isSaved ? ' rpm-header--compact' : ''}`}>
            <div className="rpm-header-left">
              <div className={`rpm-header-icon${isSaved ? ' rpm-header-icon--compact' : ''}`}>
                <FiPackage />
              </div>
              <div className="rpm-header-info">
                <h3 className={`rpm-header-title${isSaved ? ' rpm-header-title--compact' : ''}`}>
                  {isSaved ? 'Receipt Saved' : 'Receive Purchase Order'}
                </h3>
                <div className="rpm-header-sub">
                  <span className="rpm-header-pono">{po.po_no}</span>
                  <span className="rpm-header-dot">·</span>
                  <span>{warehouseLabel || 'Not assigned'}</span>
                </div>
              </div>
            </div>
            <button
              type="button"
              className="rpm-close"
              onClick={onClose}
              disabled={saving || postActionBusy}
              aria-label="Close"
            ><FiX /></button>
          </div>

          <div className={`rpm-body${isSaved ? ' rpm-body--compact' : ''}`}>
            {feedback && (
              <ModalBanner
                type={feedback.type}
                title={feedback.title}
                message={feedback.message}
                onClose={() => setFeedback(null)}
              />
            )}

            {isSaved
              ? renderSavedStep()
              : mode === null
                ? renderModeStep()
                : renderEntryStep()}
          </div>

          {!isSaved && (
            <div className="rpm-footer">
              <button
                type="button"
                className="cancel-btn"
                onClick={onClose}
                disabled={saving}
              >
                Cancel
              </button>
              {mode !== null && (
                <button
                  type="button"
                  className="save-btn rpm-save-btn"
                  onClick={handleSave}
                  disabled={saving}
                >
                  {saving ? (
                    'Saving…'
                  ) : (
                    <>
                      <FiCheckCircle className="rpm-btn-icon" />
                      <span>Save Receipt</span>
                    </>
                  )}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );

  function renderModeStep() {
    return (
      <>
        <p className="rpm-mode-intro">
          How do you want to receive{' '}
          <strong className="rpm-mode-pono">{po.po_no}</strong>?
        </p>

        <div className="rpm-mode-grid">
          <button
            type="button"
            onClick={() => handleChooseMode('complete')}
            className="rpm-mode-card rpm-mode-card--complete"
          >
            <div className="rpm-mode-icon rpm-mode-icon--complete">
              <FiCheckCircle />
            </div>
            <div className="rpm-mode-title rpm-mode-title--complete">
              Complete Receive
            </div>
            <div className="rpm-mode-desc">Receive all remaining items in full</div>
          </button>

          <button
            type="button"
            onClick={() => handleChooseMode('partial')}
            className="rpm-mode-card rpm-mode-card--partial"
          >
            <div className="rpm-mode-icon rpm-mode-icon--partial">
              <FiPackage />
            </div>
            <div className="rpm-mode-title rpm-mode-title--partial">
              Partial Receive
            </div>
            <div className="rpm-mode-desc">Enter custom quantities per line</div>
          </button>
        </div>
      </>
    );
  }

  function renderEntryStep() {
    return (
      <>
        <div className="rpm-badges">
          <span
            className={`rpm-mode-badge ${
              mode === 'complete'
                ? 'rpm-mode-badge--complete'
                : 'rpm-mode-badge--partial'
            }`}
          >
            {mode === 'complete' ? (
              <>
                <FiCheckCircle className="rpm-mode-badge-icon" />
                <span>Complete Receive</span>
              </>
            ) : (
              <>
                <FiPackage className="rpm-mode-badge-icon" />
                <span>Partial Receive</span>
              </>
            )}
          </span>

          <div className="rpm-summary-stats">
            <span className="rpm-summary-stat">
              <strong className="rpm-summary-value">{summary.total}</strong> lines
            </span>
            <span className="rpm-summary-stat">
              <strong className="rpm-summary-value rpm-summary-value--good">
                {summary.received}
              </strong>{' '}
              receive
            </span>
          </div>

          <button
            type="button"
            className="cancel-btn rpm-change-mode-btn"
            onClick={() => { setMode(null); setEditable([]); setFeedback(null); }}
          >
            ← Change Mode
          </button>
        </div>

        {/* ---------- DESKTOP TABLE ---------- */}
        <div className="rpm-table-wrap">
          <table className="rpm-table">
            <thead>
              <tr>
                <th>Item</th>
                <th className="rpm-th-center">UOM</th>
                <th className="rpm-th-center">Ordered</th>
                <th className="rpm-th-center">Remaining</th>
                <th>Receive</th>
                <th>Price</th>
                <th className="rpm-th-center">Curr</th>
              </tr>
            </thead>
            <tbody>
              {editable.map((l) => {
                const entered = parseInt(l.incoming_received, 10) || 0;
                const full    = entered >= l.remaining && l.remaining > 0;

                return (
                  <tr
                    key={l.id}
                    className={full ? 'rpm-row rpm-row--complete' : 'rpm-row'}
                  >
                    <td className="rpm-td-item">
                      <div className="rpm-item-cell">
                        <ItemImageThumb
                          src={images[l.item_code]}
                          alt={l.item_code}
                          size={44}
                        />
                        <div className="rpm-item-info">
                          <div className="rpm-item-code">{l.item_code}</div>
                          <div className="rpm-item-name" title={l.item_name}>
                            {l.item_name || '—'}
                          </div>
                        </div>
                      </div>
                    </td>

                    <td className="rpm-td rpm-td-center">
                      <span className="rpm-uom-tag">{l.uom || '—'}</span>
                    </td>

                    <td className="rpm-td rpm-td-center rpm-td-bold">
                      {l.ordered_qty}
                    </td>

                    <td className="rpm-td rpm-td-center">
                      <strong
                        className={
                          l.remaining > 0
                            ? 'rpm-remaining-value rpm-remaining-value--positive'
                            : 'rpm-remaining-value rpm-remaining-value--zero'
                        }
                      >
                        {l.remaining}
                      </strong>
                    </td>

                    <td className="rpm-td">
                      <input
                        type="number"
                        min="0"
                        max={l.remaining}
                        value={l.incoming_received}
                        onChange={(e) =>
                          handleChange(l.id, 'incoming_received', e.target.value)
                        }
                        disabled={l.remaining === 0 || saving}
                        className="rpm-num-input rpm-num-input--received"
                      />
                    </td>

                    <td className="rpm-td">
                      <input
                        type="number"
                        step="0.0001" // <--- UPDATED TO 4 DECIMALS
                        min="0"
                        value={l.unit_price}
                        onChange={(e) =>
                          handleChange(l.id, 'unit_price', e.target.value)
                        }
                        disabled={saving}
                        placeholder="0.0000"
                        className="rpm-num-input"
                      />
                    </td>

                    <td className="rpm-td rpm-td-center">
                      {renderCurrencySelect(l)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* ---------- MOBILE CARDS ---------- */}
        <div className="rpm-cards">
          {editable.map((l) => {
            const entered = parseInt(l.incoming_received, 10) || 0;
            const full    = entered >= l.remaining && l.remaining > 0;

            return (
              <div
                key={`m-${l.id}`}
                className={`rpm-line-card${full ? ' rpm-line-card--complete' : ''}`}
              >
                <div className="rpm-line-head">
                  <ItemImageThumb
                    src={images[l.item_code]}
                    alt={l.item_code}
                    size={44}
                  />
                  <div className="rpm-line-head-info">
                    <div className="rpm-line-code">{l.item_code}</div>
                    <div className="rpm-line-name" title={l.item_name}>
                      {l.item_name || '—'}
                    </div>
                  </div>
                  <div className="rpm-line-uom-badge">{l.uom || '—'}</div>
                </div>

                <div className="rpm-line-stats">
                  <div className="rpm-line-stat">
                    <span className="rpm-line-stat-label">Ordered</span>
                    <span className="rpm-line-stat-value">{l.ordered_qty}</span>
                  </div>
                  <div className="rpm-line-stat">
                    <span className="rpm-line-stat-label">Remaining</span>
                    <span
                      className={`rpm-line-stat-value ${
                        l.remaining > 0
                          ? 'rpm-line-stat-value--danger'
                          : 'rpm-line-stat-value--good'
                      }`}
                    >
                      {l.remaining}
                    </span>
                  </div>
                </div>

                <div className="rpm-line-field rpm-line-field--full">
                  <label className="rpm-line-label">Receive</label>
                  <input
                    type="number"
                    min="0"
                    max={l.remaining}
                    inputMode="numeric"
                    value={l.incoming_received}
                    onChange={(e) =>
                      handleChange(l.id, 'incoming_received', e.target.value)
                    }
                    disabled={l.remaining === 0 || saving}
                    className="rpm-line-input rpm-line-input--received"
                  />
                </div>

                <div className="rpm-line-inputs">
                  <div className="rpm-line-field">
                    <label className="rpm-line-label">Unit Price</label>
                    <input
                      type="number"
                      step="0.0001" // <--- UPDATED TO 4 DECIMALS
                      min="0"
                      value={l.unit_price}
                      onChange={(e) =>
                        handleChange(l.id, 'unit_price', e.target.value)
                      }
                      disabled={saving}
                      placeholder="0.0000"
                      className="rpm-line-input rpm-line-input--price"
                    />
                  </div>
                  <div className="rpm-line-field">
                    <label className="rpm-line-label">Currency</label>
                    {renderCurrencySelect(l, true)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="rpm-note-block">
          <span className="rpm-note-icon"><FiInfo /></span>
          <span>
            You can receive up to the <strong>Remaining</strong> quantity per
            line. Lines left at <strong>0</strong> are not received and remain
            available for a later receipt. Damaged units discovered during
            receiving are recorded by the Stock Handler at the store step.
          </span>
        </div>
      </>
    );
  }

  function renderSavedStep() {
    return (
      <div className="rpm-saved-wrap">
        <div className="rpm-saved-strip">
          <div className="rpm-saved-strip-icon"><FiCheckCircle /></div>
          <div className="rpm-saved-strip-text">
            <div className="rpm-saved-strip-title">Receipt Saved</div>
            <div className="rpm-saved-strip-meta">
              <strong>{savedSummary?.linesCount ?? 0}</strong>{' '}
              line{(savedSummary?.linesCount ?? 0) === 1 ? '' : 's'}
              {' · '}
              <strong className="rpm-saved-strip-meta--good">
                {savedSummary?.totalGood ?? 0}
              </strong>{' '}
              good
            </div>
          </div>
        </div>

        <div className="rpm-saved-actions">
          <button
            type="button"
            className="save-btn rpm-saved-primary-btn"
            onClick={handleSendAfterSave}
            disabled={postActionBusy}
            title="Send this warehouse's lines to the Stock Handler"
          >
            {postActionBusy ? (
              'Working…'
            ) : (
              <>
                <FiSend className="rpm-btn-icon" />
                <span>Send to Handler</span>
              </>
            )}
          </button>

          <button
            type="button"
            className="cancel-btn rpm-saved-secondary-btn"
            onClick={handleEditAfterSave}
            disabled={postActionBusy}
            title="Go back and correct the quantities before sending"
          >
            <FiEdit2 className="rpm-btn-icon" />
            <span>Edit Receipt</span>
          </button>
        </div>

        <div className="rpm-saved-hint">
          <strong>Edit Receipt</strong> if you need to fix quantities. Once sent,
          the lines move to the Handler and can no longer be edited here.
        </div>
      </div>
    );
  }
};

/* ============================================================ */
const modalCss = `
@keyframes rpmFadeIn { from { opacity: 0 } to { opacity: 1 } }
@keyframes rpmSlideUp { from { opacity: 0; transform: translateY(16px) scale(0.98) } to { opacity: 1; transform: translateY(0) scale(1) } }

.rpm-overlay {
  position: fixed; inset: 0;
  background: rgba(15, 23, 42, 0.62);
  backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
  display: flex; align-items: center; justify-content: center;
  z-index: 10000;
  padding: clamp(8px, 2vw, 24px);
  animation: rpmFadeIn 0.18s ease;
}
.rpm-card {
  background: #ffffff;
  border-radius: clamp(12px, 1.5vw, 18px);
  width: 100%;
  max-height: 92vh;
  max-height: 92dvh;
  display: flex; flex-direction: column;
  overflow: hidden;
  box-shadow: 0 24px 64px rgba(15, 23, 42, 0.28), 0 4px 14px rgba(15, 23, 42, 0.14);
  animation: rpmSlideUp 0.22s cubic-bezier(0.34, 1.3, 0.64, 1);
  transition: max-width 0.22s ease;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}

.rpm-header {
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px;
  padding: clamp(14px, 1.8vw, 22px) clamp(18px, 2.4vw, 28px);
  border-bottom: 1px solid #e5e7eb;
  background: linear-gradient(135deg, #ffffff 0%, #f8fafc 100%);
  flex-shrink: 0;
}
.rpm-header--compact { padding: 14px 20px; }
.rpm-header-left { display: flex; align-items: center; gap: 14px; flex: 1; min-width: 0; }
.rpm-header-info { min-width: 0; flex: 1; }
.rpm-header-icon {
  width: 44px; height: 44px; border-radius: 12px;
  background: linear-gradient(135deg, #00e0d4 0%, #008a82 100%);
  color: #fff; display: flex; align-items: center; justify-content: center;
  box-shadow: 0 4px 12px rgba(0, 210, 200, 0.32);
  flex-shrink: 0;
}
.rpm-header-icon svg { width: 22px; height: 22px; stroke-width: 2.2; color: #ffffff; }
.rpm-header-icon--compact { width: 38px; height: 38px; border-radius: 10px; }
.rpm-header-icon--compact svg { width: 18px; height: 18px; }
.rpm-header-title {
  margin: 0; font-size: clamp(16px, 1.6vw, 20px); font-weight: 700;
  color: #0f172a; letter-spacing: -0.01em; line-height: 1.2;
}
.rpm-header-title--compact { font-size: 16px; }
.rpm-header-sub {
  font-size: 12px; color: #64748b; margin-top: 3px;
  display: flex; flex-wrap: wrap; align-items: center; gap: 6px;
}
.rpm-header-pono {
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-weight: 700; color: #0f766e;
}
.rpm-header-dot { color: #cbd5e1; }
.rpm-close {
  background: transparent; border: none;
  width: 36px; height: 36px; border-radius: 8px; cursor: pointer;
  color: #64748b; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
}
.rpm-close svg { width: 18px; height: 18px; stroke-width: 2.4; }
.rpm-close:hover:not(:disabled) { background: #f1f5f9; color: #0f172a; }
.rpm-close:disabled { opacity: 0.4; cursor: not-allowed; }

.rpm-body {
  flex: 1; min-height: 0; overflow-y: auto;
  padding: clamp(18px, 2.4vw, 28px);
  display: flex; flex-direction: column;
  gap: clamp(12px, 1.4vw, 16px);
  background: #ffffff;
  -webkit-overflow-scrolling: touch;
}
.rpm-body--compact { padding: 20px 22px; gap: 14px; }
.rpm-body > * { flex-shrink: 0; }
.rpm-body::-webkit-scrollbar { width: 8px; }
.rpm-body::-webkit-scrollbar-track { background: #f1f5f9; border-radius: 4px; }
.rpm-body::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 4px; }
.rpm-body::-webkit-scrollbar-thumb:hover { background: #94a3b8; }

.rpm-footer {
  display: flex; justify-content: flex-end; align-items: center; gap: 10px;
  padding: clamp(12px, 1.6vw, 16px) clamp(18px, 2.4vw, 28px);
  border-top: 1px solid #e5e7eb; background: #f8fafc;
  flex-shrink: 0; flex-wrap: wrap;
}

.rpm-save-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
}
.rpm-btn-icon {
  width: 1em; height: 1em; flex-shrink: 0;
  stroke-width: 2.4;
}

.rpm-mode-intro {
  margin: 0; text-align: center; color: #475569; font-size: 15px; padding: 4px 0 8px;
}
.rpm-mode-pono {
  color: #0f766e;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
}
.rpm-mode-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
.rpm-mode-card {
  display: flex; flex-direction: column; align-items: center;
  padding: 32px 22px;
  border: 2px solid; border-radius: 14px;
  cursor: pointer; text-align: center; font-family: inherit;
  background: #fff;
  transition: transform 0.18s ease, box-shadow 0.18s ease;
}
.rpm-mode-card--complete {
  border-color: #10b981;
  background: linear-gradient(135deg, #f0fdf4 0%, #ecfdf5 100%);
  box-shadow: 0 4px 16px rgba(16, 185, 129, 0.12);
}
.rpm-mode-card--partial {
  border-color: #f59e0b;
  background: linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%);
  box-shadow: 0 4px 16px rgba(245, 158, 11, 0.12);
}
.rpm-mode-card:hover { transform: translateY(-3px); }
.rpm-mode-card--complete:hover { box-shadow: 0 8px 24px rgba(16, 185, 129, 0.22); }
.rpm-mode-card--partial:hover  { box-shadow: 0 8px 24px rgba(245, 158, 11, 0.22); }
.rpm-mode-card:active { transform: translateY(-1px) scale(0.99); }

.rpm-mode-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 12px;
}
.rpm-mode-icon svg {
  width: 42px; height: 42px;
  stroke-width: 1.8;
}
.rpm-mode-icon--complete svg { color: #059669; }
.rpm-mode-icon--partial  svg { color: #d97706; }

.rpm-mode-title {
  font-size: 16px; font-weight: 700; margin-bottom: 6px; letter-spacing: -0.01em;
}
.rpm-mode-title--complete { color: #065f46; }
.rpm-mode-title--partial  { color: #92400e; }
.rpm-mode-desc { font-size: 12.5px; color: #64748b; line-height: 1.45; }

.rpm-badges {
  display: flex; align-items: center; flex-wrap: wrap; gap: 12px;
  padding: 12px 16px;
  background: #f8fafc;
  border: 1px solid #e2e8f0; border-radius: 10px;
}
.rpm-mode-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px; border-radius: 999px;
  font-size: 12px; font-weight: 700; letter-spacing: 0.02em;
}
.rpm-mode-badge--complete { background: #dcfce7; color: #065f46; }
.rpm-mode-badge--partial  { background: #fef3c7; color: #92400e; }
.rpm-mode-badge-icon {
  width: 1em; height: 1em; flex-shrink: 0;
  stroke-width: 2.4;
}
.rpm-summary-stats { display: flex; gap: 14px; flex-wrap: wrap; align-items: center; }
.rpm-summary-stat { font-size: 13px; color: #475569; }
.rpm-summary-value { font-weight: 700; color: #0f172a; margin-right: 2px; }
.rpm-summary-value--good   { color: #059669; }
.rpm-change-mode-btn { margin-left: auto; padding: 6px 14px; font-size: 13px; }

.rpm-table-wrap {
  overflow: auto;
  max-height: 52vh;
  min-height: 200px;
  flex-shrink: 0;
  border: 1px solid #e2e8f0; border-radius: 10px; background: #fff;
}
.rpm-table { width: 100%; border-collapse: collapse; min-width: 820px; font-size: 13px; }
.rpm-table thead th {
  padding: 11px 12px; text-align: left;
  font-size: 11px; font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.05em; color: #64748b;
  background: #f8fafc; border-bottom: 1px solid #e2e8f0;
  position: sticky; top: 0; z-index: 1; white-space: nowrap;
}
.rpm-th-center { text-align: center !important; }
.rpm-row { border-bottom: 1px solid #f1f5f9; }
.rpm-row--complete { background: rgba(16, 185, 129, 0.06); }
.rpm-td { padding: 10px 12px; color: #0f172a; font-size: 13px; vertical-align: middle; }
.rpm-td-item { padding: 10px 12px; vertical-align: middle; min-width: 200px; }
.rpm-td-center { text-align: center !important; }
.rpm-td-bold { font-weight: 700; }

.rpm-item-cell { display: flex; align-items: center; gap: 11px; min-width: 0; }
.rpm-item-info { min-width: 0; flex: 1; }
.rpm-item-code {
  font-weight: 700; font-size: 13px;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  color: #0f766e; letter-spacing: 0.02em; line-height: 1.2;
}
.rpm-item-name {
  font-size: 11.5px; color: #475569; margin-top: 2px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; line-height: 1.3;
}
.rpm-uom-tag {
  display: inline-block; padding: 3px 9px;
  background: #f1f5f9; color: #334155; border-radius: 6px;
  font-size: 11px; font-weight: 600;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
}
.rpm-remaining-value {
  font-size: 15px; font-weight: 700;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
}
.rpm-remaining-value--positive { color: #dc2626; }
.rpm-remaining-value--zero     { color: #059669; }

.rpm-num-input {
  width: 100%; min-width: 68px; max-width: 92px;
  padding: 7px 10px;
  font-size: 13px; font-family: inherit;
  border: 1.5px solid #cbd5e1; border-radius: 7px;
  background: #fff; color: #0f172a; text-align: center;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
  outline: none;
}
.rpm-num-input:focus { box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.15); }
.rpm-num-input--received { border-color: #10b981; }
.rpm-num-input--received:focus { border-color: #10b981; }

.rpm-curr-select {
  padding: 7px 8px; font-size: 12px; font-weight: 600;
  border: 1.5px solid #cbd5e1; border-radius: 7px;
  background: #fff; color: #0f172a;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  cursor: pointer; outline: none;
}

.rpm-cards { display: none; }

.rpm-note-block {
  display: flex; align-items: flex-start; gap: 8px;
  padding: 11px 14px;
  background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 8px;
  font-size: 12px; color: #075985; line-height: 1.5;
}
.rpm-note-icon {
  display: inline-flex; align-items: center; justify-content: center;
  flex-shrink: 0; margin-top: 1px;
}
.rpm-note-icon svg {
  width: 14px; height: 14px; stroke-width: 2.4; color: #075985;
}

.rpm-saved-wrap { display: flex; flex-direction: column; gap: 14px; width: 100%; }
.rpm-saved-strip {
  display: flex; align-items: center; gap: 12px;
  padding: 14px 16px;
  background: linear-gradient(135deg, #f0fdfa 0%, #ecfeff 100%);
  border: 1.5px solid #99f6e4; border-radius: 12px;
}
.rpm-saved-strip-icon {
  display: inline-flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.rpm-saved-strip-icon svg {
  width: 30px; height: 30px; stroke-width: 2;
  color: #059669;
}
.rpm-saved-strip-text { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.rpm-saved-strip-title {
  font-size: 15px; font-weight: 700; color: #0f766e;
  letter-spacing: -0.01em; line-height: 1.2;
}
.rpm-saved-strip-meta { font-size: 12.5px; color: #475569; line-height: 1.4; }
.rpm-saved-strip-meta--good { color: #059669; }

.rpm-saved-actions { display: flex; flex-direction: column; gap: 10px; }
.rpm-saved-primary-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  padding: 14px 18px; font-size: 14px; font-weight: 700; min-height: 48px;
  white-space: nowrap;
}
.rpm-saved-secondary-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  padding: 12px 18px; font-size: 13.5px; font-weight: 700; min-height: 44px;
  white-space: nowrap;
}
.rpm-saved-hint {
  padding: 10px 14px;
  background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px;
  font-size: 12px; color: #78350f; line-height: 1.5;
}

@media (max-width: 900px) {
  .rpm-card { max-width: 96vw !important; }
  .rpm-body { padding: 16px; }
  .rpm-header { padding: 14px 18px; }
  .rpm-footer { padding: 12px 16px; }
  .rpm-table-wrap { max-height: 46vh; }
}

@media (max-width: 640px) {
  .rpm-overlay { padding: 0 !important; align-items: stretch !important; }
  .rpm-card {
    max-height: 100vh !important;
    max-height: 100dvh !important;
    width: 100vw !important;
    max-width: 100vw !important;
    height: 100vh !important;
    height: 100dvh !important;
    border-radius: 0 !important;
    animation: none !important;
  }

  .rpm-header { padding: 12px 14px !important; }
  .rpm-header--compact { padding: 12px 14px !important; }
  .rpm-header-icon { width: 36px !important; height: 36px !important; border-radius: 10px !important; }
  .rpm-header-icon svg { width: 18px !important; height: 18px !important; }
  .rpm-header-icon--compact { width: 34px !important; height: 34px !important; }
  .rpm-header-icon--compact svg { width: 17px !important; height: 17px !important; }
  .rpm-header-title { font-size: 15px !important; }
  .rpm-header-title--compact { font-size: 15px !important; }
  .rpm-header-sub { font-size: 11px !important; }

  .rpm-body { padding: 12px 14px !important; gap: 10px !important; }
  .rpm-body--compact { padding: 12px 14px !important; }

  .rpm-mode-grid { grid-template-columns: 1fr !important; gap: 12px !important; }
  .rpm-mode-card { padding: 22px 16px !important; }
  .rpm-mode-icon { margin-bottom: 8px !important; }
  .rpm-mode-icon svg { width: 34px !important; height: 34px !important; }
  .rpm-mode-title { font-size: 15px !important; }

  .rpm-badges { flex-direction: column; align-items: stretch !important; gap: 10px !important; padding: 12px !important; }
  .rpm-change-mode-btn { margin-left: 0 !important; width: 100%; }

  .rpm-table-wrap { display: none !important; }
  .rpm-cards {
    display: flex !important;
    flex-direction: column;
    gap: 10px;
  }

  .rpm-line-card {
    border: 1px solid #e2e8f0; border-radius: 10px;
    background: #ffffff; padding: 12px;
    display: flex; flex-direction: column; gap: 10px;
  }
  .rpm-line-card--complete {
    background: rgba(16, 185, 129, 0.06);
    border-color: #86efac;
  }
  .rpm-line-head { display: flex; gap: 10px; align-items: center; min-width: 0; }
  .rpm-line-head-info { flex: 1; min-width: 0; }
  .rpm-line-code {
    font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
    font-weight: 700; font-size: 13px; color: #0f766e; line-height: 1.2;
  }
  .rpm-line-name {
    font-size: 12px; color: #475569; margin-top: 2px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .rpm-line-uom-badge {
    font-size: 10px; font-weight: 700; color: #334155;
    background: #f1f5f9; border: 1px solid #cbd5e1;
    padding: 3px 8px; border-radius: 6px;
    font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
    flex-shrink: 0;
  }
  .rpm-line-stats {
    display: grid; grid-template-columns: 1fr 1fr; gap: 10px;
    padding: 8px 0;
    border-top: 1px dashed #e5e7eb; border-bottom: 1px dashed #e5e7eb;
  }
  .rpm-line-stat { display: flex; flex-direction: column; gap: 2px; align-items: center; }
  .rpm-line-stat-label {
    font-size: 9px; font-weight: 700; color: #64748b;
    text-transform: uppercase; letter-spacing: 0.04em;
  }
  .rpm-line-stat-value {
    font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
    font-size: 16px; font-weight: 700; color: #0f172a;
  }
  .rpm-line-stat-value--danger { color: #dc2626; }
  .rpm-line-stat-value--good   { color: #059669; }

  .rpm-line-inputs { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .rpm-line-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  .rpm-line-field--full { grid-column: 1 / -1; }
  .rpm-line-label {
    font-size: 10px; font-weight: 700; color: #64748b;
    text-transform: uppercase; letter-spacing: 0.04em;
  }
  .rpm-line-input {
    width: 100%; padding: 10px 12px;
    font-size: 16px; font-weight: 700;
    border: 1.5px solid #cbd5e1; border-radius: 8px;
    background: #fff; color: #0f172a;
    box-sizing: border-box; min-height: 44px;
    text-align: center; outline: none;
    transition: border-color 0.15s ease, box-shadow 0.15s ease;
  }
  .rpm-line-input--received { border-color: #10b981; }
  .rpm-line-input--received:focus { box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.15); }
  .rpm-line-input--price { font-size: 15px; }
  .rpm-line-input:disabled { background: #f8fafc; color: #94a3b8; cursor: not-allowed; }

  .rpm-footer { padding: 10px 14px !important; gap: 8px !important; }
  .rpm-footer > button {
    flex: 1 1 auto; min-height: 44px;
    padding: 12px 16px !important; font-size: 14px !important;
  }

  .rpm-note-block { font-size: 11.5px; padding: 10px 12px; }

  .rpm-saved-wrap { gap: 12px; }
  .rpm-saved-strip { padding: 12px 14px; }
  .rpm-saved-strip-icon svg { width: 24px; height: 24px; }
  .rpm-saved-strip-title { font-size: 14px; }
  .rpm-saved-strip-meta { font-size: 12px; }
  .rpm-saved-primary-btn,
  .rpm-saved-secondary-btn {
    width: 100%; min-height: 46px;
  }
}

@media (max-width: 380px) {
  .rpm-mode-card { padding: 18px 12px !important; }
  .rpm-mode-icon svg { width: 28px !important; height: 28px !important; }
  .rpm-mode-title { font-size: 14px !important; }
  .rpm-mode-desc { font-size: 11.5px !important; }
  .rpm-line-inputs { grid-template-columns: 1fr; }
  .rpm-footer { flex-direction: column-reverse !important; }
  .rpm-footer > button { width: 100%; }
}

@media (max-height: 500px) and (orientation: landscape) {
  .rpm-overlay { padding: 8px !important; align-items: center !important; }
  .rpm-card {
    height: auto !important; max-height: 96vh !important;
    border-radius: 12px !important; max-width: 96vw !important;
  }
  .rpm-header { padding: 8px 14px !important; }
  .rpm-body   { padding: 10px 14px !important; gap: 10px !important; }
  .rpm-footer { padding: 8px 14px !important; }
  .rpm-mode-card { padding: 16px 14px !important; }
}

@media (prefers-reduced-motion: reduce) {
  .rpm-card, .rpm-overlay { animation: none !important; transition: none !important; }
  .rpm-mode-card { transition: none !important; }
}
`;

export default ReceivePoModal;