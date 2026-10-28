// src/components/underground/OfflineDamageModal.jsx
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FiAlertTriangle,
  FiX,
  FiLoader,
  FiCheckCircle,
  FiShield,
  FiInfo,
} from 'react-icons/fi';
import { undergroundApi, offlineFeaturesApi, uomConversionApi } from '../../services/api';
import { useToast } from '../shared/ToastProvider';
import { undergroundCss } from './undergroundStyles';

const intFmt = new Intl.NumberFormat('en-PH');
const fmtInt = (n) => intFmt.format(Number(n) || 0);

const OfflineDamageModal = ({ onClose, onSuccess }) => {
  const toast = useToast();
  
  // Data states
  const [locators, setLocators] = useState([]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingItems, setLoadingItems] = useState(false);
  const [isScoped, setIsScoped] = useState(false);
  
  // Form states
  const [locatorCode, setLocatorCode] = useState('');
  const [itemCode, setItemCode] = useState('');
  
  // UOM state
  const [conversionRule, setConversionRule] = useState(null);
  const [loadingRule, setLoadingRule] = useState(false);
  
  // Quantities
  const [qty, setQty] = useState('');
  const [boxes, setBoxes] = useState('');
  const [loosePieces, setLoosePieces] = useState('');
  
  const [reason, setReason] = useState('');
  
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState(null);

  // Fetch initial locators from the current shift
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await undergroundApi.currentInventory({ limit: 2000 });
        if (cancelled) return;
        if (res.ok && Array.isArray(res.data)) {
          // Extract unique locators
          const uniqueLocators = Array.from(
            new Map(res.data.map(r => [r.locator_code, { code: r.locator_code, name: r.locator_name }])).values()
          ).sort((a, b) => a.code.localeCompare(b.code));
          setLocators(uniqueLocators);
          
          if (Array.isArray(res.scoped_bodegas) && res.scoped_bodegas.length > 0) {
            setIsScoped(true);
          }
        } else {
          setFeedback({ type: 'error', message: res.data?.message || 'Failed to load locators.' });
        }
      } catch (err) {
        if (!cancelled) setFeedback({ type: 'error', message: 'Network error while loading locators.' });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Fetch items when locator changes
  useEffect(() => {
    if (!locatorCode) {
      setItems([]);
      setItemCode('');
      return;
    }
    let cancelled = false;
    (async () => {
      setLoadingItems(true);
      try {
        const res = await undergroundApi.currentInventory({ locator_code: locatorCode, limit: 1000 });
        if (cancelled) return;
        if (res.ok && Array.isArray(res.data)) {
          setItems(res.data.filter(r => Number(r.qty_on_hand) > 0));
          setItemCode('');
        }
      } catch (err) {
        if (!cancelled) toast.error('Failed to load items.');
      } finally {
        if (!cancelled) setLoadingItems(false);
      }
    })();
    return () => { cancelled = true; };
  }, [locatorCode, toast]);

  // Fetch UOM conversion rule when item changes
  useEffect(() => {
    if (!itemCode) {
      setConversionRule(null);
      return;
    }

    let isMounted = true;
    const fetchRule = async () => {
      setLoadingRule(true);
      try {
        const res = await uomConversionApi.getAll({ search: itemCode, limit: 5 });
        if (res.ok && res.data?.data) {
          const exact = res.data.data.find(
            (c) => c.piece_item_code === itemCode && c.Status === 'Active'
          );
          if (exact && isMounted) {
            setConversionRule({ pieces_per_box: Number(exact.pieces_per_box) });
          } else if (isMounted) {
            setConversionRule(null);
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
  }, [itemCode]);

  // Derived state
  const selectedItem = useMemo(() => items.find(i => i.item_code === itemCode), [items, itemCode]);
  const maxQty = selectedItem ? Number(selectedItem.qty_on_hand) : 0;
  
  const enteredTotalQty = useMemo(() => {
    if (conversionRule) {
      return ((parseInt(boxes, 10) || 0) * conversionRule.pieces_per_box) + (parseInt(loosePieces, 10) || 0);
    }
    return Number(qty) || 0;
  }, [conversionRule, boxes, loosePieces, qty]);

  const canSubmit = 
    locatorCode && 
    itemCode && 
    enteredTotalQty > 0 && 
    enteredTotalQty <= maxQty && 
    reason.trim().length > 0 && 
    !submitting;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    setFeedback(null);

    try {
      const payload = {
        locator_code: locatorCode,
        item_code: itemCode,
        reason: reason.trim(),
      };

      if (conversionRule) {
        payload.qty_boxes = parseInt(boxes, 10) || 0;
        payload.qty_loose_pieces = parseInt(loosePieces, 10) || 0;
        payload.qty = enteredTotalQty; // Fallback
      } else {
        payload.qty = enteredTotalQty;
      }

      const res = await offlineFeaturesApi.recordDamage(payload);

      if (res.ok && res.data?.success !== false) {
        toast.success(`Wrote off ${fmtInt(enteredTotalQty)} × ${itemCode}`);
        onSuccess?.();
      } else {
        setFeedback({ type: 'error', message: res.data?.message || 'Failed to record damage.' });
      }
    } catch (err) {
      setFeedback({ type: 'error', message: 'Network error. Please try again.' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="ugmodal-overlay" onClick={submitting ? undefined : onClose}>
      <style>{undergroundCss}</style>
      <style>{damageCss}</style>
      <div className="ugmodal-card" onClick={(e) => e.stopPropagation()}>
        
        {/* Header */}
        <div className="ugmodal-header">
          <div className="ugmodal-header-left">
            <div className="ugmodal-header-icon" style={{ background: 'linear-gradient(135deg, #f97316 0%, #dc2626 100%)' }}>
              <FiAlertTriangle />
            </div>
            <div>
              <h3 className="ugmodal-title">Log Damaged Item</h3>
              <div className="ugmodal-sub">Record a manual write-off for broken or expired units.</div>
            </div>
          </div>
          <button type="button" className="ugmodal-close" onClick={onClose} disabled={submitting}>
            <FiX />
          </button>
        </div>

        {/* Body */}
        <form className="ugmodal-body" onSubmit={handleSubmit}>
          {feedback && (
            <div className={`ugmodal-feedback ugmodal-feedback--${feedback.type}`}>
              <FiAlertTriangle />
              <span>{feedback.message}</span>
            </div>
          )}

          <div className="ugmodal-field">
            <label className="ugmodal-label">Source Locator <span className="ugmodal-required">*</span></label>
            {loading ? (
              <div className="ugmodal-input" style={{ background: '#f8fafc', color: '#94a3b8' }}><FiLoader className="ug-spin" /> Loading locators…</div>
            ) : (
              <select 
                className="ugmodal-select" 
                value={locatorCode} 
                onChange={(e) => setLocatorCode(e.target.value)} 
                disabled={submitting}
                required
              >
                <option value="">— Select a locator —</option>
                {locators.map(l => (
                  <option key={l.code} value={l.code}>{l.code} {l.name ? `— ${l.name}` : ''}</option>
                ))}
              </select>
            )}
            
            {isScoped && (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 4, fontSize: 12, color: '#0f766e', fontWeight: 600 }}>
                <FiShield size={12} />
                <span>Showing only your assigned bodegas.</span>
              </div>
            )}
          </div>

          <div className="ugmodal-field">
            <label className="ugmodal-label">Item <span className="ugmodal-required">*</span></label>
            {loadingItems ? (
              <div className="ugmodal-input" style={{ background: '#f8fafc', color: '#94a3b8' }}><FiLoader className="ug-spin" /> Loading items…</div>
            ) : (
              <select 
                className="ugmodal-select" 
                value={itemCode} 
                onChange={(e) => setItemCode(e.target.value)} 
                disabled={!locatorCode || submitting || items.length === 0}
                required
              >
                <option value="">— Select an item —</option>
                {items.map(i => (
                  <option key={i.item_code} value={i.item_code}>
                    {i.item_code} — {i.item_name} (Qty: {i.qty_on_hand})
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Quantities */}
          {loadingRule ? (
            <div className="ugmodal-input" style={{ background: '#f8fafc', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 8 }}>
              <FiLoader className="ug-spin" /> Checking for UOM rules…
            </div>
          ) : conversionRule ? (
            <>
              <div className="ug-damage-box-calc">
                <div className="ug-damage-box-calc-title"><FiInfo /> Box Conversion Active</div>
                <div className="ug-damage-box-calc-desc">1 Box = {conversionRule.pieces_per_box} pieces</div>
              </div>
              
              <div className="ugmodal-row" style={{ gridTemplateColumns: '1fr 1fr' }}>
                <div className="ugmodal-field">
                  <label className="ugmodal-label">Boxes</label>
                  <input
                    type="number"
                    className="ugmodal-input"
                    min={0}
                    value={boxes}
                    onChange={(e) => setBoxes(e.target.value)}
                    disabled={!selectedItem || submitting}
                    placeholder="0"
                  />
                </div>
                <div className="ugmodal-field">
                  <label className="ugmodal-label">Loose Pieces</label>
                  <input
                    type="number"
                    className="ugmodal-input"
                    min={0}
                    value={loosePieces}
                    onChange={(e) => setLoosePieces(e.target.value)}
                    disabled={!selectedItem || submitting}
                    placeholder="0"
                  />
                </div>
              </div>
              
              <div className={`ug-alloc-row ${enteredTotalQty > maxQty ? 'is-over' : ''}`}>
                <span className="ug-alloc-label">Total pieces to write-off</span>
                <span className="ug-alloc-value">{enteredTotalQty} / {maxQty}</span>
              </div>
            </>
          ) : (
            <div className="ugmodal-row">
              <div className="ugmodal-field">
                <label className="ugmodal-label">Quantity to Write-off <span className="ugmodal-required">*</span></label>
                <input
                  type="number"
                  className="ugmodal-input"
                  min="1"
                  max={maxQty}
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                  placeholder={maxQty ? `Max: ${maxQty}` : '0'}
                  disabled={!selectedItem || submitting}
                  required
                />
              </div>
              {selectedItem && (
                <div className="ugmodal-field">
                  <label className="ugmodal-label">Remaining After Write-off</label>
                  <div className="ugmodal-input" style={{ background: '#f8fafc', fontWeight: 800, color: enteredTotalQty > maxQty ? '#dc2626' : '#047857' }}>
                    {Math.max(0, maxQty - enteredTotalQty)}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="ugmodal-field">
            <label className="ugmodal-label">Reason / Remarks <span className="ugmodal-required">*</span></label>
            <textarea
              className="ugmodal-textarea"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Units found physically damaged during inspection."
              disabled={submitting}
              required
              maxLength={500}
            />
          </div>

          {/* Footer */}
          <div className="ugmodal-footer">
            <button type="button" className="ug-btn ug-btn--secondary" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button type="submit" className="ug-btn ug-btn--danger" disabled={!canSubmit}>
              {submitting ? <><FiLoader className="ug-spin" /> Saving…</> : <><FiCheckCircle /> Submit Write-off</>}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

const damageCss = `
.ug-damage-box-calc {
  padding: 10px 14px;
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  border-radius: 8px;
  margin-bottom: 4px;
}
.ug-damage-box-calc-title {
  font-size: 12px; font-weight: 700; color: #1e40af;
  display: flex; align-items: center; gap: 6px;
}
.ug-damage-box-calc-desc {
  font-size: 13px; font-weight: 600; color: #1e3a8a; margin-top: 4px;
}
.ug-alloc-row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 12px;
  background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px;
  font-size: 12px; margin-bottom: 8px;
}
.ug-alloc-label { font-weight: 600; color: #475569; }
.ug-alloc-value {
  font-family: 'JetBrains Mono', monospace;
  font-weight: 700; color: #0f172a;
}
.ug-alloc-row.is-over { background: #fef2f2; border-color: #fecaca; }
.ug-alloc-row.is-over .ug-alloc-label { color: #991b1b; }
.ug-alloc-row.is-over .ug-alloc-value { color: #dc2626; }
`;

export default OfflineDamageModal;