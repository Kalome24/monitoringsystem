// src/components/handler/StoreItemModal.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { FiHome, FiX, FiCheckCircle, FiInfo } from 'react-icons/fi';
import { importPoApi, stockTransferApi, uomConversionApi } from '../../services/api';
import { getUser } from '../../secure/auth';
import ModalBanner from '../shared/ModalBanner';
import ItemImageThumb from '../shared/ItemImageThumb';
import SearchableLocatorSelect from '../shared/SearchableLocatorSelect';

const StoreItemModal = ({ row, onClose, onStored }) => {
  const currentUser = getUser();
  const warehouseCode = currentUser?.warehouse_code || '';
  const isSTS = row?.source === 'STS';

  const canRecordDamage = !isSTS;

  const maxQty = useMemo(() => {
    if (!row) return 0;
    if (typeof row.available_to_store === 'number') return row.available_to_store;
    const received = Number(row.received_qty) || 0;
    const damaged  = Number(row.damaged_qty)  || 0;
    const stored   = Number(row.stored_qty)   || 0;
    const released = Number(row.released_qty) || 0;
    return Math.max(0, received - damaged - stored - released);
  }, [row]);

  // ----- Box / Piece Conversion State -----
  const [conversionRule, setConversionRule] = useState(null); // { pieces_per_box: number }
  const [loadingRule, setLoadingRule] = useState(false);

  const [boxes, setBoxes]                 = useState('');
  const [loosePieces, setLoosePieces]     = useState('');
  
  // ----- Standard Qty (fallback if no conversion) -----
  const [qty, setQty]                     = useState(maxQty);
  
  const [damageQty, setDamageQty]         = useState(0);
  const [damageReason, setDamageReason]   = useState('');
  const [remarks, setRemarks]             = useState('');
  const [locatorCode, setLocatorCode]     = useState(row?.locator_code || '');
  const [submitting, setSubmitting]       = useState(false);
  const [feedback, setFeedback]           = useState(null);

  // Reset state when row changes
  useEffect(() => {
    setQty(maxQty);
    setBoxes('');
    setLoosePieces('');
    setDamageQty(0);
    setDamageReason('');
    setFeedback(null);
  }, [maxQty, row?.id]);

  // Fetch UOM conversion rule if it exists
  useEffect(() => {
    if (!row?.item_code || isSTS) return;

    let isMounted = true;
    const fetchRule = async () => {
      setLoadingRule(true);
      try {
        const res = await uomConversionApi.getAll({ search: row.item_code, limit: 5 });
        if (res.ok && res.data?.data) {
          const exact = res.data.data.find(
            (c) => (c.box_item_code === row.item_code || c.piece_item_code === row.item_code) && c.Status === 'Active'
          );
          if (exact && isMounted) {
            setConversionRule({ pieces_per_box: Number(exact.pieces_per_box) });
          }
        }
      } catch (err) {
        console.warn('Could not fetch UOM conversion rule:', err);
      } finally {
        if (isMounted) setLoadingRule(false);
      }
    };

    fetchRule();
    return () => { isMounted = false; };
  }, [row?.item_code, isSTS]);

  // Reset locator when row changes
  useEffect(() => {
    setLocatorCode(row?.locator_code || '');
  }, [row?.locator_code, row?.id]);

  if (!row) return null;

  // ----- Input Handlers -----
  const handleQtyChange = (value) => {
    if (value === '' || value === null || value === undefined) {
      setQty('');
      return;
    }
    const n = Math.max(0, Math.min(parseInt(value, 10) || 0, maxQty));
    setQty(n);
    const d = parseInt(damageQty, 10) || 0;
    if (n + d > maxQty) {
      setDamageQty(Math.max(0, maxQty - n));
    }
  };

  const handleBoxesChange = (value) => {
    if (value === '' || value === null || value === undefined) {
      setBoxes('');
      return;
    }
    const b = Math.max(0, parseInt(value, 10) || 0);
    setBoxes(b);
    
    // Auto-cap damage if total exceeds max
    const totalPieces = (b * conversionRule.pieces_per_box) + (parseInt(loosePieces, 10) || 0);
    const d = parseInt(damageQty, 10) || 0;
    if (totalPieces + d > maxQty) {
      setDamageQty(Math.max(0, maxQty - totalPieces));
    }
  };

  const handleLoosePiecesChange = (value) => {
    if (value === '' || value === null || value === undefined) {
      setLoosePieces('');
      return;
    }
    const l = Math.max(0, parseInt(value, 10) || 0);
    setLoosePieces(l);

    const totalPieces = (parseInt(boxes, 10) || 0) * conversionRule.pieces_per_box + l;
    const d = parseInt(damageQty, 10) || 0;
    if (totalPieces + d > maxQty) {
      setDamageQty(Math.max(0, maxQty - totalPieces));
    }
  };

  const handleDamageChange = (value) => {
    if (value === '' || value === null || value === undefined) {
      setDamageQty('');
      return;
    }
    const d = Math.max(0, Math.min(parseInt(value, 10) || 0, maxQty));
    setDamageQty(d);

    // Adjust store qty if over max
    if (conversionRule) {
      const totalPieces = (parseInt(boxes, 10) || 0) * conversionRule.pieces_per_box + (parseInt(loosePieces, 10) || 0);
      if (totalPieces + d > maxQty) {
        // We can't easily auto-adjust both boxes and loose, so we just let the validation catch it
        // and show the red warning.
      }
    } else {
      const n = parseInt(qty, 10) || 0;
      if (n + d > maxQty) {
        setQty(Math.max(0, maxQty - d));
      }
    }
  };

  // ----- Calculations -----
  const enteredStore = useMemo(() => {
    if (conversionRule) {
      return ((parseInt(boxes, 10) || 0) * conversionRule.pieces_per_box) + (parseInt(loosePieces, 10) || 0);
    }
    return parseInt(qty, 10) || 0;
  }, [conversionRule, boxes, loosePieces, qty]);

  const enteredDamage = parseInt(damageQty, 10) || 0;
  const totalEntered  = enteredStore + enteredDamage;
  const overAllocated = totalEntered > maxQty;
  const reasonMissing = canRecordDamage && enteredDamage > 0 && !damageReason.trim();
  const nothingToDo   = enteredStore <= 0 && enteredDamage <= 0;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFeedback(null);

    if (enteredStore > 0 && !locatorCode) {
      setFeedback({
        type: 'warning',
        title: 'Locator required',
        message: 'Please choose a locator to store the good units into.',
      });
      return;
    }

    if (nothingToDo) {
      setFeedback({
        type: 'warning',
        title: 'Nothing to store',
        message: 'Enter a quantity to store, a damaged quantity, or both.',
      });
      return;
    }

    if (overAllocated) {
      setFeedback({
        type: 'warning',
        title: 'Exceeds available',
        message:
          `Store (${enteredStore}) + damaged (${enteredDamage}) = ${totalEntered} ` +
          `is more than the ${maxQty} unit(s) available.`,
      });
      return;
    }

    if (reasonMissing) {
      setFeedback({
        type: 'warning',
        title: 'Damage reason required',
        message: 'Please describe why the units are damaged.',
      });
      return;
    }

    setSubmitting(true);
    try {
      let res;

      if (isSTS) {
        const stsLineId = row.sts_line_id ?? row.id;
        if (!stsLineId) {
          setFeedback({
            type: 'error',
            title: 'Line error',
            message: 'This line has no id — cannot store. Try refreshing the list.',
          });
          return;
        }
        res = await stockTransferApi.storeTransferLine(stsLineId, {
          qty_to_store: enteredStore,
          locator_code: locatorCode,
          remarks:      remarks || undefined,
        });
      } else {
        const itemId = row.id ?? row.item_id;
        if (!itemId) {
          setFeedback({
            type: 'error',
            title: 'Line error',
            message: 'This line has no id — cannot store. Try refreshing the list.',
          });
          return;
        }
        res = await importPoApi.storeLine(row.po_no, {
          item_id:            itemId,
          qty_to_store:       enteredStore,
          qty_boxes:          conversionRule ? (parseInt(boxes, 10) || 0) : undefined,
          qty_loose_pieces:   conversionRule ? (parseInt(loosePieces, 10) || 0) : undefined,
          damaged_qty:        enteredDamage,
          damage_reason:      enteredDamage > 0 ? damageReason.trim() : undefined,
          remarks:            remarks || undefined,
          locator_code:       locatorCode,
        });
      }

      if (!res.ok || res.data?.success === false) {
        setFeedback({
          type: 'error',
          title: 'Store failed',
          message: res.data?.message || 'Failed to store item.',
        });
        return;
      }

      onStored?.();
      onClose?.();
    } catch (err) {
      console.error(err);
      setFeedback({
        type: 'error',
        title: 'Store failed',
        message: 'Unexpected error while storing item.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <style>{modalCss}</style>

      <div
        className="sim-overlay"
        onClick={submitting ? undefined : onClose}
      >
        <div
          className="sim-card"
          onClick={(e) => e.stopPropagation()}
        >
          {/* ---------- HEADER ---------- */}
          <div className="sim-header">
            <div className="sim-header-left">
              <div className="sim-header-icon"><FiHome /></div>
              <div className="sim-header-info">
                <h3 className="sim-header-title">Store Item</h3>
                <div className="sim-header-sub">
                  {row.item_code} · {row.item_name || '—'}
                </div>
              </div>
            </div>
            <button
              type="button"
              className="sim-close"
              onClick={onClose}
              disabled={submitting}
              aria-label="Close"
            ><FiX /></button>
          </div>

          {/* ---------- BODY ---------- */}
          <form className="sim-body" onSubmit={handleSubmit}>
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
                title="Nothing to store"
                message="Nothing left to store for this item — all received units are already stored or damaged."
              />
            )}

            {/* ---------- FULL ITEM CARD ---------- */}
            <div className="sim-item-card">
              <ItemImageThumb src={row.image_url || null} alt={row.item_code} size={92} />

              <div className="sim-item-info">
                <div className="sim-item-code-line">
                  <span className="sim-item-code">{row.item_code}</span>
                  {row.barcode && (
                    <span className="sim-barcode-chip" title={`Barcode: ${row.barcode}`}>
                      ▥ {row.barcode}
                    </span>
                  )}
                </div>

                <div className="sim-item-desc" title={row.item_name}>
                  {row.item_name || '—'}
                </div>

                <div className="sim-chip-row">
                  {row.uom && (
                    <span className="sim-chip sim-chip--uom" title="Unit of Measure">
                      {row.uom}
                      {row.uom_description && row.uom_description !== row.uom
                        ? ` · ${row.uom_description}`
                        : ''}
                    </span>
                  )}
                  {row.category && (
                    <span className="sim-chip sim-chip--cat" title="Category">{row.category}</span>
                  )}
                  {row.purchase_class && (
                    <span className="sim-chip sim-chip--pc" title="Purchase Class">{row.purchase_class}</span>
                  )}
                  {row.gl_class_code && (
                    <span className="sim-chip sim-chip--gl" title={row.gl_description || 'GL Class'}>
                      GL {row.gl_class_code}
                      {row.gl_description ? ` · ${row.gl_description}` : ''}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* ---------- PROCESS STATE ---------- */}
            <div className="sim-meta-grid">
              <div className="sim-meta-box">
                <div className="sim-meta-label">{isSTS ? 'STS No.' : 'PO No.'}</div>
                <div className="sim-meta-value">
                  {isSTS ? (row.sts_no || '—') : row.po_no}
                </div>
              </div>
              <div className="sim-meta-box">
                <div className="sim-meta-label">Received</div>
                <div className="sim-meta-value">{Number(row.received_qty) || 0}</div>
              </div>
              <div className="sim-meta-box">
                <div className="sim-meta-label">Damaged</div>
                <div className="sim-meta-value">{Number(row.damaged_qty) || 0}</div>
              </div>
              <div className="sim-meta-box">
                <div className="sim-meta-label">Already Stored</div>
                <div className="sim-meta-value">{Number(row.stored_qty) || 0}</div>
              </div>
            </div>

            {/* ---------- LOCATOR ---------- */}
            <div className="sim-field">
              <label className="sim-label">
                Locator{' '}
                {enteredStore > 0
                  ? <span className="sim-required">*</span>
                  : <span className="sim-hint">(required if storing good units)</span>}{' '}
                <span className="sim-hint">— where will the good units go?</span>
              </label>

              <SearchableLocatorSelect
                warehouseCode={warehouseCode}
                value={locatorCode}
                onChange={(item) => setLocatorCode(item?.locator_code || '')}
                placeholder="Search locator by code or name…"
                excludeDamage
                autoSelectSingle
                disabled={submitting}
              />
            </div>

            {/* ---------- QUANTITIES ---------- */}
            {canRecordDamage ? (
              <>
                {loadingRule ? (
                  <div className="sim-field">
                    <div className="sim-loading-box">Checking for UOM conversion rules…</div>
                  </div>
                ) : conversionRule ? (
                  /* --- BOX / PIECE MODE --- */
                  <>
                    <div className="sim-box-calc">
                      <div className="sim-box-calc-title">
                        <FiInfo /> Box Conversion Active
                      </div>
                      <div className="sim-box-calc-desc">
                        1 Box = {conversionRule.pieces_per_box} pieces
                      </div>
                    </div>

                    <div className="sim-box-grid">
                      <div className="sim-field">
                        <label className="sim-label">Boxes</label>
                        <input
                          type="number"
                          min={0}
                          inputMode="numeric"
                          value={boxes}
                          onChange={(e) => handleBoxesChange(e.target.value)}
                          className="sim-input"
                          disabled={submitting || maxQty === 0}
                          placeholder="0"
                        />
                      </div>

                      <div className="sim-field">
                        <label className="sim-label">Loose Pieces</label>
                        <input
                          type="number"
                          min={0}
                          inputMode="numeric"
                          value={loosePieces}
                          onChange={(e) => handleLoosePiecesChange(e.target.value)}
                          className="sim-input"
                          disabled={submitting || maxQty === 0}
                          placeholder="0"
                        />
                      </div>

                      <div className="sim-field">
                        <label className="sim-label">
                          Damaged Qty <span className="sim-hint">(→ DAMAGE)</span>
                        </label>
                        <input
                          type="number"
                          min={0}
                          max={maxQty}
                          inputMode="numeric"
                          value={damageQty}
                          onChange={(e) => handleDamageChange(e.target.value)}
                          className="sim-input sim-input--damage"
                          disabled={submitting || maxQty === 0}
                        />
                      </div>
                    </div>

                    <div className={`sim-alloc-row${overAllocated ? ' sim-alloc-row--over' : ''}`}>
                      <span className="sim-alloc-label">Total pieces to store</span>
                      <span className="sim-alloc-value">{enteredStore.toLocaleString()} pcs</span>
                    </div>
                  </>
                ) : (
                  /* --- STANDARD QTY MODE --- */
                  <>
                    <div className="sim-two-col">
                      <div className="sim-field">
                        <label className="sim-label">
                          Quantity to store <span className="sim-hint">(good units → locator)</span>
                        </label>
                        <input
                          type="number"
                          min={0}
                          max={maxQty}
                          inputMode="numeric"
                          value={qty}
                          onChange={(e) => handleQtyChange(e.target.value)}
                          className="sim-input"
                          disabled={submitting || maxQty === 0}
                        />
                      </div>

                      <div className="sim-field">
                        <label className="sim-label">
                          Damaged quantity <span className="sim-hint">(→ DAMAGE locator)</span>
                        </label>
                        <input
                          type="number"
                          min={0}
                          max={maxQty}
                          inputMode="numeric"
                          value={damageQty}
                          onChange={(e) => handleDamageChange(e.target.value)}
                          className="sim-input sim-input--damage"
                          disabled={submitting || maxQty === 0}
                        />
                      </div>
                    </div>

                    <div className={`sim-alloc-row${overAllocated ? ' sim-alloc-row--over' : ''}`}>
                      <span className="sim-alloc-label">Total allocated</span>
                      <span className="sim-alloc-value">
                        {totalEntered} / {maxQty}
                      </span>
                    </div>
                  </>
                )}

                {enteredDamage > 0 && (
                  <div className="sim-field">
                    <label className="sim-label">
                      Damage reason <span className="sim-required">*</span>
                    </label>
                    <input
                      type="text"
                      value={damageReason}
                      onChange={(e) => setDamageReason(e.target.value)}
                      placeholder="e.g. Crushed in transit, water damage, bent frame"
                      className="sim-input sim-input--reason"
                      disabled={submitting}
                    />
                    <small className="sim-helper">
                      Required when a damaged quantity is entered — the reason is
                      stored on the damage write-off record.
                    </small>
                  </div>
                )}
              </>
            ) : (
              <div className="sim-field">
                <label className="sim-label">
                  Quantity to store <span className="sim-hint">(max {maxQty})</span>
                </label>
                <input
                  type="number"
                  min={1}
                  max={maxQty}
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                  className="sim-input"
                  disabled={submitting || maxQty === 0}
                />
                <small className="sim-helper">
                  Damage for this transfer was recorded when the slip was received.
                  Only good units are stored here.
                </small>
              </div>
            )}

            {/* ---------- REMARKS ---------- */}
            <div className="sim-field">
              <label className="sim-label">
                Remarks <span className="sim-hint">(optional)</span>
              </label>
              <textarea
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                rows={3}
                className="sim-input sim-textarea"
                disabled={submitting}
              />
            </div>

            {/* ---------- FOOTER ---------- */}
            <div className="sim-footer">
              <button
                type="button"
                onClick={onClose}
                className="sim-btn-ghost"
                disabled={submitting}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="sim-btn-primary"
                disabled={
                  submitting ||
                  maxQty === 0 ||
                  overAllocated ||
                  nothingToDo ||
                  (enteredStore > 0 && !locatorCode) ||
                  reasonMissing
                }
              >
                {submitting ? (
                  'Storing…'
                ) : (
                  <>
                    <FiCheckCircle className="sim-btn-icon" />
                    <span>Store</span>
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
@keyframes simFadeIn { from { opacity: 0 } to { opacity: 1 } }
@keyframes simSlideUp { from { opacity: 0; transform: translateY(16px) scale(0.98) } to { opacity: 1; transform: translateY(0) scale(1) } }

.sim-overlay {
  position: fixed; inset: 0;
  background: rgba(15, 23, 42, 0.62);
  backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
  display: flex; align-items: center; justify-content: center;
  z-index: 10000;
  padding: clamp(8px, 2vw, 24px);
  animation: simFadeIn 0.18s ease;
}
.sim-card {
  background: #ffffff;
  border-radius: clamp(12px, 1.5vw, 16px);
  width: 100%;
  max-width: 640px;
  max-height: 92vh;
  max-height: 92dvh;
  display: flex; flex-direction: column;
  overflow: hidden;
  box-shadow: 0 24px 64px rgba(15, 23, 42, 0.28), 0 4px 14px rgba(15, 23, 42, 0.14);
  animation: simSlideUp 0.22s cubic-bezier(0.34, 1.3, 0.64, 1);
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}

.sim-header {
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px;
  padding: clamp(14px, 1.8vw, 20px) clamp(18px, 2.4vw, 22px);
  border-bottom: 1px solid #e5e7eb;
  background: linear-gradient(135deg, #ffffff 0%, #f8fafc 100%);
  flex-shrink: 0;
}
.sim-header-left { display: flex; align-items: center; gap: 12px; min-width: 0; flex: 1; }
.sim-header-info { min-width: 0; }
.sim-header-icon {
  width: 44px; height: 44px; border-radius: 12px;
  background: linear-gradient(135deg, #00e0d4 0%, #008a82 100%);
  color: #fff; display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.sim-header-icon svg { width: 22px; height: 22px; stroke-width: 2.2; }
.sim-header-title {
  margin: 0; font-size: clamp(16px, 1.6vw, 18px); font-weight: 700;
  color: #0f172a; line-height: 1.2;
}
.sim-header-sub {
  font-size: 12px; color: #64748b; margin-top: 2px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.sim-close {
  background: transparent; border: none;
  width: 36px; height: 36px; border-radius: 8px; cursor: pointer;
  color: #64748b; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
}
.sim-close svg { width: 18px; height: 18px; stroke-width: 2.4; }
.sim-close:hover:not(:disabled) { background: #f1f5f9; color: #0f172a; }
.sim-close:disabled { opacity: 0.4; cursor: not-allowed; }

.sim-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: clamp(16px, 2vw, 20px);
  display: flex; flex-direction: column;
  gap: clamp(12px, 1.4vw, 16px);
  background: #ffffff;
  -webkit-overflow-scrolling: touch;
}
.sim-body > * { flex-shrink: 0; }

.sim-body::-webkit-scrollbar { width: 8px; }
.sim-body::-webkit-scrollbar-track { background: #f1f5f9; border-radius: 4px; }
.sim-body::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 4px; }
.sim-body::-webkit-scrollbar-thumb:hover { background: #94a3b8; }

.sim-item-card {
  display: flex; gap: 14px; align-items: flex-start;
  padding: 14px 16px;
  background: linear-gradient(135deg, #f8fafc 0%, #eef2f6 100%);
  border: 1px solid #e2e8f0; border-radius: 12px;
}
.sim-item-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.sim-item-code-line { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.sim-item-code {
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-size: 16px; font-weight: 800; color: #4338ca; line-height: 1.2;
}
.sim-item-desc {
  font-size: 13px; font-weight: 600; color: #0f172a; line-height: 1.4;
  word-break: break-word;
}
.sim-chip-row { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 2px; }

.sim-barcode-chip {
  display: inline-block; padding: 3px 10px;
  font-size: 11px; font-weight: 700; color: #7c3aed; background: #f5f3ff;
  border: 1px solid #ddd6fe; border-radius: 999px;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  letter-spacing: 0.02em;
}
.sim-chip {
  display: inline-block; padding: 3px 10px;
  font-size: 11px; font-weight: 600; border-radius: 999px;
}
.sim-chip--uom {
  color: #334155; background: #f1f5f9; border: 1px solid #cbd5e1;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
}
.sim-chip--cat  { color: #0f766e; background: #f0fdfa; border: 1px solid #99f6e4; font-weight: 700; }
.sim-chip--pc   { color: #4338ca; background: #eef2ff; border: 1px solid #c7d2fe; font-weight: 700; }
.sim-chip--gl   { color: #92400e; background: #fef3c7; border: 1px solid #fcd34d; font-weight: 700; }

.sim-meta-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 8px;
}
.sim-meta-box {
  padding: 8px 10px; background: #f8fafc;
  border: 1px solid #e2e8f0; border-radius: 8px;
}
.sim-meta-label {
  font-size: 10px; font-weight: 700; color: #64748b;
  text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 2px;
}
.sim-meta-value { font-size: 13px; font-weight: 600; color: #0f172a; word-break: break-word; }

.sim-field { display: flex; flex-direction: column; gap: 6px; }
.sim-label { font-size: 13px; font-weight: 600; color: #334155; }
.sim-hint { color: #94a3b8; font-weight: 500; }
.sim-required { color: #dc2626; font-weight: 700; }
.sim-helper { font-size: 11px; color: #64748b; line-height: 1.4; }

.sim-input {
  width: 100%; padding: 10px 12px;
  border: 1px solid #cbd5e1; border-radius: 8px;
  font-size: 14px; font-family: inherit; color: #0f172a; outline: none;
  background: #fff;
  box-sizing: border-box;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.sim-input:focus {
  border-color: #00b8b0;
  box-shadow: 0 0 0 3px rgba(0, 184, 176, 0.15);
}
.sim-input:disabled { background: #f8fafc; color: #94a3b8; cursor: not-allowed; }
.sim-textarea { resize: vertical; min-height: 72px; }

.sim-input--damage:focus {
  border-color: #ef4444;
  box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.15);
}
.sim-input--reason:focus {
  border-color: #ef4444;
  box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.15);
}

.sim-two-col {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

/* Box calc layout */
.sim-box-calc {
  padding: 10px 14px;
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  border-radius: 8px;
}
.sim-box-calc-title {
  font-size: 12px; font-weight: 700; color: #1e40af;
  display: flex; align-items: center; gap: 6px;
}
.sim-box-calc-desc {
  font-size: 13px; font-weight: 600; color: #1e3a8a; margin-top: 4px;
}
.sim-box-grid {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 12px;
}

.sim-alloc-row {
  display: flex; align-items: center; justify-content: space-between;
  gap: 10px;
  padding: 8px 12px;
  background: #f8fafc;
  border: 1px solid #e2e8f0; border-radius: 8px;
  font-size: 12px;
}
.sim-alloc-label { font-weight: 600; color: #475569; }
.sim-alloc-value {
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-weight: 700; color: #0f172a;
}
.sim-alloc-row--over { background: #fef2f2; border-color: #fecaca; }
.sim-alloc-row--over .sim-alloc-label { color: #991b1b; }
.sim-alloc-row--over .sim-alloc-value { color: #dc2626; }

.sim-loading-box {
  padding: 10px 12px; border: 1px solid #cbd5e1; border-radius: 8px;
  font-size: 13px; color: #64748b; background: #f8fafc;
}
.sim-error-small { font-size: 11px; color: #991b1b; }

.sim-footer {
  display: flex; justify-content: flex-end; gap: 10px;
  margin-top: 4px;
  flex-shrink: 0;
}
.sim-btn-ghost {
  padding: 10px 18px; background: #fff; border: 1px solid #cbd5e1;
  border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer;
  color: #334155; font-family: inherit;
  transition: background 0.15s ease;
}
.sim-btn-ghost:hover:not(:disabled) { background: #f8fafc; }
.sim-btn-ghost:disabled { opacity: 0.5; cursor: not-allowed; }
.sim-btn-primary {
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  padding: 10px 22px;
  background: linear-gradient(135deg, #00e0d4 0%, #00b8b0 45%, #008a82 100%);
  color: #fff; border: none; border-radius: 8px;
  font-size: 14px; font-weight: 700; cursor: pointer; font-family: inherit;
  box-shadow: 0 4px 12px rgba(0, 200, 190, 0.32);
  transition: transform 0.1s ease, box-shadow 0.15s ease;
}
.sim-btn-primary:hover:not(:disabled) { box-shadow: 0 6px 16px rgba(0, 200, 190, 0.42); }
.sim-btn-primary:active:not(:disabled) { transform: scale(0.98); }
.sim-btn-primary:disabled { opacity: 0.5; cursor: not-allowed; box-shadow: none; }
.sim-btn-icon { width: 1em; height: 1em; stroke-width: 2.4; }

@media (max-width: 900px) {
  .sim-card { max-width: 96vw; }
  .sim-meta-grid { grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); }
}

@media (max-width: 640px) {
  .sim-overlay { padding: 0; align-items: stretch; }
  .sim-card {
    max-height: 100vh; max-height: 100dvh;
    width: 100vw; max-width: 100vw;
    height: 100vh; height: 100dvh;
    border-radius: 0;
    animation: none;
  }
  .sim-header { padding: 12px 14px; }
  .sim-header-icon { width: 36px; height: 36px; border-radius: 10px; }
  .sim-header-icon svg { width: 18px; height: 18px; }
  .sim-header-title { font-size: 15px; }
  .sim-header-sub { font-size: 11px; }
  .sim-body { padding: 14px; gap: 12px; }
  .sim-input { font-size: 16px; }
  .sim-btn-ghost,
  .sim-btn-primary { min-height: 44px; font-size: 14px; }
  .sim-footer { flex-direction: row-reverse; gap: 8px; }
  .sim-footer > button { flex: 1 1 auto; }
  .sim-item-card { padding: 12px; gap: 12px; }
  .sim-item-code { font-size: 15px; }
  .sim-meta-grid { grid-template-columns: 1fr 1fr; }
  .sim-meta-box { padding: 8px 10px; }
  .sim-meta-label { font-size: 9px; }
  .sim-meta-value { font-size: 12px; }
  .sim-two-col { grid-template-columns: 1fr; }
  .sim-box-grid { grid-template-columns: 1fr; gap: 8px; }
}

@media (max-width: 380px) {
  .sim-meta-grid { grid-template-columns: 1fr; }
  .sim-header-icon { width: 32px; height: 32px; }
  .sim-header-icon svg { width: 16px; height: 16px; }
  .sim-header-title { font-size: 14px; }
  .sim-footer { flex-direction: column-reverse; }
  .sim-footer > button { width: 100%; }
  .sim-item-card { flex-direction: column; align-items: stretch; }
}

@media (max-height: 500px) and (orientation: landscape) {
  .sim-overlay { padding: 8px; align-items: center; }
  .sim-card {
    height: auto; max-height: 96vh;
    border-radius: 12px; max-width: 96vw;
  }
  .sim-header { padding: 8px 14px; }
  .sim-body   { padding: 10px 14px; gap: 8px; }
}

@media (prefers-reduced-motion: reduce) {
  .sim-card, .sim-overlay { animation: none !important; }
  .sim-btn-primary { transition: none !important; }
}
`;

export default StoreItemModal;