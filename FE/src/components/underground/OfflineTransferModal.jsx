// src/components/underground/OfflineTransferModal.jsx
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FiTruck,
  FiX,
  FiLoader,
  FiCheckCircle,
  FiAlertTriangle,
  FiArrowRight,
  FiShield,
  FiInfo,
} from 'react-icons/fi';
import { undergroundApi, offlineFeaturesApi, signatureConfigApi, uomConversionApi } from '../../services/api';
import { getUser } from '../../secure/auth';
import { useToast } from '../shared/ToastProvider';
import { undergroundCss } from './undergroundStyles';

const intFmt = new Intl.NumberFormat('en-PH');
const fmtInt = (n) => intFmt.format(Number(n) || 0);

const OfflineTransferModal = ({ onClose, onSuccess }) => {
  const toast = useToast();
  const currentUser = getUser();
  
  // Data states
  const [locators, setLocators] = useState([]);         // From Bodega (assigned)
  const [destLocators, setDestLocators] = useState([]); // To Bodega (synced UG Warehouse)
  const [sourceItems, setSourceItems] = useState([]);
  const [signatures, setSignatures] = useState([]);
  const [isScoped, setIsScoped] = useState(false);
  
  const [loading, setLoading] = useState(true);
  const [loadingItems, setLoadingItems] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState(null);

  // UOM State
  const [conversionRule, setConversionRule] = useState(null);
  const [loadingRule, setLoadingRule] = useState(false);
  const [boxes, setBoxes] = useState('');
  const [loosePieces, setLoosePieces] = useState('');
  const [qty, setQty] = useState('');

  // Form states
  const [stsNo, setStsNo] = useState('');
  const [fromLocator, setFromLocator] = useState('');
  const [toLocator, setToLocator] = useState('');
  const [itemCode, setItemCode] = useState('');
  const [approvedBy, setApprovedBy] = useState('');
  const [initiatedBy, setInitiatedBy] = useState(currentUser?.username || '');
  const [releasedBy, setReleasedBy] = useState(currentUser?.username || '');
  const [receivedBy, setReceivedBy] = useState('');
  const [remarks, setRemarks] = useState('');

  // Fetch initial data (Locators, Destinations & Signatures)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [invRes, destRes, sigRes] = await Promise.all([
          undergroundApi.currentInventory({ limit: 2000 }),
          offlineFeaturesApi.getDestinationLocators(),
          signatureConfigApi.list({ role_slot: 'Authorized By', is_active: 1 })
        ]);

        if (cancelled) return;

        // 1. Process Source Locators (From Bodega)
        if (invRes.ok && Array.isArray(invRes.data)) {
          const uniqueLocators = Array.from(
            new Map(invRes.data.map(r => [r.locator_code, { code: r.locator_code, name: r.locator_name }])).values()
          ).sort((a, b) => a.code.localeCompare(b.code));
          setLocators(uniqueLocators);
          
          if (Array.isArray(invRes.scoped_bodegas) && invRes.scoped_bodegas.length > 0) {
            setIsScoped(true);
          }
        }

        // 2. Process Destination Locators (To Bodega - restricted to UG Warehouse)
        if (destRes.ok && Array.isArray(destRes.data)) {
          const uniqueDest = Array.from(
            new Map(destRes.data.map(r => [
              r.locator_code, 
              { code: r.locator_code, name: r.locator_name || r.description || r.warehouse_code }
            ])).values()
          ).sort((a, b) => a.code.localeCompare(b.code));
          setDestLocators(uniqueDest);
        }

        // 3. Process Signatures
        if (sigRes.ok && Array.isArray(sigRes.data)) {
          setSignatures(sigRes.data);
          if (sigRes.data.length > 0) setApprovedBy(sigRes.data[0].full_name);
        }
      } catch (err) {
        if (!cancelled) setFeedback({ type: 'error', message: 'Failed to load required data.' });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Fetch items when From Locator changes
  useEffect(() => {
    if (!fromLocator) {
      setSourceItems([]);
      setItemCode('');
      return;
    }
    let cancelled = false;
    (async () => {
      setLoadingItems(true);
      try {
        const res = await offlineFeaturesApi.getTransferItems({ locator_code: fromLocator });
        if (cancelled) return;
        if (res.ok && Array.isArray(res.data)) {
          setSourceItems(res.data);
          setItemCode('');
        }
      } catch (err) {
        if (!cancelled) toast.error('Failed to load items from source locator.');
      } finally {
        if (!cancelled) setLoadingItems(false);
      }
    })();
    return () => { cancelled = true; };
  }, [fromLocator, toast]);

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
  const selectedItem = useMemo(() => sourceItems.find(i => i.item_code === itemCode), [sourceItems, itemCode]);
  const maxQty = selectedItem ? Number(selectedItem.qty) : 0;
  
  const enteredTotalQty = useMemo(() => {
    if (conversionRule) {
      return ((parseInt(boxes, 10) || 0) * conversionRule.pieces_per_box) + (parseInt(loosePieces, 10) || 0);
    }
    return Number(qty) || 0;
  }, [conversionRule, boxes, loosePieces, qty]);

  const canSubmit = 
    stsNo.trim() && 
    fromLocator && 
    toLocator && 
    (fromLocator !== toLocator) && 
    itemCode && 
    enteredTotalQty > 0 && 
    enteredTotalQty <= maxQty && 
    approvedBy && 
    initiatedBy.trim() &&
    releasedBy.trim() &&
    receivedBy.trim() &&
    !submitting;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    setFeedback(null);

    try {
      const payload = {
        sts_no: stsNo.trim(),
        from_locator: fromLocator,
        to_locator: toLocator,
        item_code: itemCode,
        item_name: selectedItem?.item_name || '',
        uom: selectedItem?.uom || '',
        approved_by: approvedBy,
        initiated_by: initiatedBy.trim(),
        released_by: releasedBy.trim(),
        received_by: receivedBy.trim(),
        remarks: remarks.trim()
      };

      if (conversionRule) {
        payload.qty_boxes = parseInt(boxes, 10) || 0;
        payload.qty_loose_pieces = parseInt(loosePieces, 10) || 0;
        payload.qty = enteredTotalQty;
      } else {
        payload.qty = enteredTotalQty;
      }

      const res = await offlineFeaturesApi.createTransfer(payload);

      if (res.ok && res.data?.success !== false) {
        toast.success(`Transfer completed successfully.`);
        onSuccess?.();
      } else {
        setFeedback({ type: 'error', message: res.data?.message || 'Failed to complete transfer.' });
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
      <style>{transferCss}</style>
      <div className="ugmodal-card ugmodal-card--wide" onClick={(e) => e.stopPropagation()}>
        
        {/* Header */}
        <div className="ugmodal-header">
          <div className="ugmodal-header-left">
            <div className="ugmodal-header-icon" style={{ background: 'linear-gradient(135deg, #0ea5e9 0%, #0369a1 100%)' }}>
              <FiTruck />
            </div>
            <div>
              <h3 className="ugmodal-title">Stock Transfer (Offline)</h3>
              <div className="ugmodal-sub">Move items between locators in the underground warehouse.</div>
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

          <div className="ugmodal-row" style={{ gridTemplateColumns: '1fr 2fr' }}>
            <div className="ugmodal-field">
              <label className="ugmodal-label">STS No. <span className="ugmodal-required">*</span></label>
              <input
                type="text"
                className="ugmodal-input"
                placeholder="e.g. STS-001234"
                value={stsNo}
                onChange={(e) => setStsNo(e.target.value.toUpperCase())}
                disabled={submitting}
                required
              />
            </div>
            <div className="ugmodal-field">
              <label className="ugmodal-label">Approved By <span className="ugmodal-required">*</span></label>
              <select 
                className="ugmodal-select" 
                value={approvedBy} 
                onChange={(e) => setApprovedBy(e.target.value)} 
                disabled={submitting || signatures.length === 0}
                required
              >
                <option value="">— Select Signatory —</option>
                {signatures.map(s => (
                  <option key={s.id} value={s.full_name}>{s.full_name} ({s.position_title})</option>
                ))}
              </select>
            </div>
          </div>

          <div className="ugmodal-row" style={{ background: '#f8fafc', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
            <div className="ugmodal-field">
              <label className="ugmodal-label">From Bodega <span className="ugmodal-required">*</span></label>
              <select className="ugmodal-select" value={fromLocator} onChange={(e) => setFromLocator(e.target.value)} disabled={submitting} required>
                <option value="">— Select Source —</option>
                {locators.map(l => <option key={l.code} value={l.code}>{l.code} {l.name ? `— ${l.name}` : ''}</option>)}
              </select>
              
              {isScoped && (
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 4, fontSize: 12, color: '#0f766e', fontWeight: 600 }}>
                  <FiShield size={12} />
                  <span>Showing only your assigned bodegas.</span>
                </div>
              )}
            </div>
            
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', paddingTop: '18px' }}>
              <FiArrowRight style={{ color: '#94a3b8' }} />
            </div>

            <div className="ugmodal-field">
              <label className="ugmodal-label">To Bodega <span className="ugmodal-required">*</span></label>
              <select className="ugmodal-select" value={toLocator} onChange={(e) => setToLocator(e.target.value)} disabled={submitting} required>
                <option value="">— Select Destination —</option>
                {destLocators.map(l => <option key={l.code} value={l.code}>{l.code} {l.name ? `— ${l.name}` : ''}</option>)}
              </select>
            </div>
          </div>

          <div className="ugmodal-field">
            <label className="ugmodal-label">Item <span className="ugmodal-required">*</span></label>
            {loadingItems ? (
              <div className="ugmodal-input" style={{ background: '#f8fafc', color: '#94a3b8' }}><FiLoader className="ug-spin" /> Loading items…</div>
            ) : (
              <select className="ugmodal-select" value={itemCode} onChange={(e) => setItemCode(e.target.value)} disabled={!fromLocator || submitting || sourceItems.length === 0} required>
                <option value="">— Select an item —</option>
                {sourceItems.map(i => (
                  <option key={i.item_code} value={i.item_code}>
                    {i.item_code} — {i.item_name} (Qty: {i.qty})
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
              <div className="ug-transfer-box-calc">
                <div className="ug-transfer-box-calc-title"><FiInfo /> Box Conversion Active</div>
                <div className="ug-transfer-box-calc-desc">1 Box = {conversionRule.pieces_per_box} pieces</div>
              </div>
              
              <div className="ugmodal-row">
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
                <span className="ug-alloc-label">Total pieces to transfer</span>
                <span className="ug-alloc-value">{enteredTotalQty} / {maxQty}</span>
              </div>
            </>
          ) : (
            <div className="ugmodal-field">
              <label className="ugmodal-label">Quantity <span className="ugmodal-required">*</span></label>
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
          )}

          <div className="ugmodal-row" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
            <div className="ugmodal-field">
              <label className="ugmodal-label">Initiated By <span className="ugmodal-required">*</span></label>
              <input
                type="text"
                className="ugmodal-input"
                value={initiatedBy}
                onChange={(e) => setInitiatedBy(e.target.value)}
                disabled={submitting}
                required
              />
            </div>
            <div className="ugmodal-field">
              <label className="ugmodal-label">Released By <span className="ugmodal-required">*</span></label>
              <input
                type="text"
                className="ugmodal-input"
                value={releasedBy}
                onChange={(e) => setReleasedBy(e.target.value)}
                disabled={submitting}
                required
              />
            </div>
            <div className="ugmodal-field">
              <label className="ugmodal-label">Received By <span className="ugmodal-required">*</span></label>
              <input
                type="text"
                className="ugmodal-input"
                placeholder="Name of receiver"
                value={receivedBy}
                onChange={(e) => setReceivedBy(e.target.value)}
                disabled={submitting}
                required
              />
            </div>
          </div>

          <div className="ugmodal-field">
            <label className="ugmodal-label">Remarks</label>
            <input
              type="text"
              className="ugmodal-input"
              placeholder="Optional transfer notes"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              disabled={submitting}
            />
          </div>

          {/* Footer */}
          <div className="ugmodal-footer">
            <button type="button" className="ug-btn ug-btn--secondary" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button type="submit" className="ug-btn ug-btn--primary" disabled={!canSubmit}>
              {submitting ? <><FiLoader className="ug-spin" /> Processing…</> : <><FiCheckCircle /> Complete Transfer</>}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

const transferCss = `
.ug-transfer-box-calc {
  padding: 10px 14px;
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  border-radius: 8px;
  margin-bottom: 4px;
}
.ug-transfer-box-calc-title {
  font-size: 12px; font-weight: 700; color: #1e40af;
  display: flex; align-items: center; gap: 6px;
}
.ug-transfer-box-calc-desc {
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

export default OfflineTransferModal;