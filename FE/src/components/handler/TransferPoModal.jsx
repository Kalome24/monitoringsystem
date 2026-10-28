// src/components/handler/TransferPoModal.jsx
import React, { useEffect, useMemo, useState } from 'react';
import {
  FiTruck,
  FiX,
  FiClipboard,
  FiAlertTriangle,
  FiInfo,
  FiClock,
  FiCheckCircle,
  FiPackage,
  FiRefreshCw,
} from 'react-icons/fi';
import { itemMasterApi, stockTransferApi } from '../../services/api';
import ModalBanner from '../shared/ModalBanner';
import ItemImageThumb from '../shared/ItemImageThumb';

const TransferPoModal = ({
  po,
  lines,
  warehouses,
  currentWarehouse,
  lastRejection,
  onClose,
  onSubmitted,
}) => {
  const todayIso = new Date().toISOString().split('T')[0];

  const [stsNo, setStsNo]                     = useState(null);
  const [toWarehouseId, setToWarehouseId]     = useState('');
  const [transferDate, setTransferDate]       = useState(todayIso);
  const [remarks, setRemarks]                 = useState('');
  const [editable, setEditable]               = useState([]);
  const [submitting, setSubmitting]           = useState(false);
  const [submitted, setSubmitted]             = useState(null);
  const [images, setImages]                   = useState({});
  const [transferredMap, setTransferredMap]   = useState({});
  const [lockError, setLockError]             = useState('');
  const [feedback, setFeedback]               = useState(null);

  // Fetch item images
  useEffect(() => {
    const codes = [...new Set(lines.map((l) => l.item_code).filter(Boolean))];
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
  }, [lines]);

  // Fetch previously-transferred quantities
  useEffect(() => {
    if (!po?.po_no) return;

    let cancelled = false;
    (async () => {
      try {
        const res = await stockTransferApi.getTransferredQty(po.po_no);
        if (cancelled) return;
        if (res.ok && res.data?.success) {
          setTransferredMap(res.data.data || {});
        }
      } catch (err) {
        console.warn('Could not load transferred quantities:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [po?.po_no]);

  // Build editable rows
  useEffect(() => {
    setEditable((prev) => {
      const prevByKey = new Map(prev.map((p) => [p.rowKey, p]));

      return lines.map((l, idx) => {
        const received = Number(l.received_qty) || 0;
        const already  = Number(transferredMap[l.item_code]) || 0;

        const rowKey = `line_${idx}__${l.id ?? 'noid'}__${l.item_code || 'item'}`;

        const existing = prevByKey.get(rowKey);
        const transfer_qty = existing ? existing.transfer_qty : 0;

        return {
          rowKey,
          id:                  l.id ?? rowKey,
          item_code:           l.item_code,
          item_name:           l.item_name || '',
          uom:                 l.uom || '',
          received_qty:        received,
          already_transferred: already,
          transfer_qty,
          unit_price:          l.unit_price ?? '',
          currency:            l.currency || 'PHP',
          line_status:         l.status || '',
        };
      });
    });
  }, [lines, transferredMap]);

  // Target warehouses
  const availableTargets = useMemo(() => {
    const fromId = currentWarehouse?.warehouse_id;
    return (warehouses || [])
      .filter((w) => (w.status ? w.status === 'Active' : true))
      .filter((w) => w.warehouse_id !== fromId);
  }, [warehouses, currentWarehouse]);

  // Qty edits
  const handleQtyChange = (rowKey, value) => {
    setEditable((prev) =>
      prev.map((l) => {
        if (l.rowKey !== rowKey) return l;
        const max = Math.max(0, l.received_qty - l.already_transferred);
        const n   = Math.max(0, Math.min(parseInt(value, 10) || 0, max));
        return { ...l, transfer_qty: n };
      })
    );
  };

  const summary = useMemo(() => {
    let totalQty = 0, totalLines = 0;
    for (const l of editable) {
      if (l.transfer_qty > 0) {
        totalQty += l.transfer_qty;
        totalLines += 1;
      }
    }
    return { totalQty, totalLines };
  }, [editable]);

  const pendingCount = useMemo(
    () => editable.filter((l) => l.line_status === 'Pending Transfer').length,
    [editable]
  );

  // Submit
  const handleSubmit = async () => {
    if (lockError) return;
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
        message: 'Please choose a transfer date.',
      });
      return;
    }

    const linesToTransfer = editable.filter((l) => l.transfer_qty > 0);
    if (linesToTransfer.length === 0) {
      setFeedback({
        type: 'warning',
        title: 'No items selected',
        message: 'Please enter at least one transfer quantity.',
      });
      return;
    }

    const target = availableTargets.find(
      (w) => String(w.warehouse_id) === String(toWarehouseId)
    );
    if (!target) {
      setFeedback({
        type: 'error',
        title: 'Invalid destination',
        message: 'The selected destination warehouse is invalid. Please pick another one.',
      });
      return;
    }

    const isResubmit = !!lastRejection;
    const heading = isResubmit
      ? 'Resubmit Stock Transfer Slip?'
      : 'Submit Stock Transfer Slip?';

    const confirmMsg =
      `${heading}\n\n` +
      `From:  ${currentWarehouse?.warehouse_code || '—'} — ${currentWarehouse?.warehouse_name || ''}\n` +
      `To:    ${target.warehouse_code} — ${target.warehouse_name}\n` +
      `Date:  ${transferDate}\n` +
      `Lines: ${linesToTransfer.length}\n\n` +
      (isResubmit
        ? `The slip will keep the SAME STS No. (${lastRejection.sts_no}) with the items you selected below.\n\n`
        : '') +
      `The slip will be sent to the Department Head for approval.\n\n` +
      `Proceed?`;
    if (!window.confirm(confirmMsg)) return;

    const payload = {
      from_warehouse_id: currentWarehouse?.warehouse_id,
      to_warehouse_id:   Number(toWarehouseId),
      transfer_date:     transferDate,
      po_no:             po.po_no || null,
      remarks:           remarks.trim() || null,
      lines:             linesToTransfer.map((l) => ({
        item_code:  l.item_code,
        item_name:  l.item_name,
        uom:        l.uom,
        qty:        l.transfer_qty,
        unit_price: l.unit_price === '' || l.unit_price == null ? null : Number(l.unit_price),
        currency:   l.currency || null,
      })),
    };

    setSubmitting(true);
    setLockError('');
    try {
      const res = await stockTransferApi.createSTS(payload);

      if (res.status === 409 || res.data?.code === 'PO_HAS_ACTIVE_STS') {
        const msg =
          res.data?.message ||
          'This PO already has a stock transfer awaiting Department Head approval.';
        setLockError(msg);
        setFeedback({
          type: 'warning',
          title: 'PO is locked',
          message:
            msg +
            '\n\nThe transfer form will close. Refresh the PO list to see the current state.',
        });
        return;
      }

      if (!res.ok || !res.data?.success) {
        setFeedback({
          type: 'error',
          title: 'Submission failed',
          message: res.data?.message || 'Failed to submit Stock Transfer Slip.',
        });
        return;
      }

      const created = res.data.data;
      setStsNo(created.sts_no);
      setSubmitted(created);
      onSubmitted?.(created);
    } catch (err) {
      console.error(err);
      setFeedback({
        type: 'error',
        title: 'Submission failed',
        message: 'Error submitting Stock Transfer Slip. Please try again.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const isResubmit = !!lastRejection;

  return (
    <>
      <style>{modalCss}</style>

      <div className="tpm-overlay" onClick={submitting ? undefined : onClose}>
        <div className="tpm-card" onClick={(e) => e.stopPropagation()}>

          {/* ---------- HEADER ---------- */}
          <div className="tpm-header">
            <div className="tpm-header-left">
              <div className="tpm-header-icon"><FiTruck /></div>
              <div className="tpm-header-info">
                <h3 className="tpm-header-title">
                  {isResubmit
                    ? 'Resubmit Stock Transfer Slip'
                    : 'Stock Transfer Slip'}
                </h3>
                <div className="tpm-header-sub">
                  <span className="tpm-header-pono">{po.po_no}</span>
                  <span className="tpm-header-dot">·</span>
                  <span>{po.vendor_name || '—'}</span>
                </div>
              </div>
            </div>
            <button
              type="button"
              className="tpm-close"
              onClick={onClose}
              disabled={submitting}
              aria-label="Close"
            ><FiX /></button>
          </div>

          {/* ---------- BODY ---------- */}
          <div className="tpm-body">
            {feedback && (
              <ModalBanner
                type={feedback.type}
                title={feedback.title}
                message={feedback.message}
                onClose={() => setFeedback(null)}
              />
            )}

            {submitted ? renderSuccess() : renderForm()}
          </div>

          {/* ---------- FOOTER ---------- */}
          <div className="tpm-footer">
            {submitted ? (
              <button type="button" className="save-btn" onClick={onClose}>Close</button>
            ) : (
              <>
                <button
                  type="button"
                  className="cancel-btn"
                  onClick={onClose}
                  disabled={submitting}
                >
                  {lockError ? 'Close' : 'Cancel'}
                </button>
                {!lockError && (
                  <button
                    type="button"
                    className="save-btn"
                    onClick={handleSubmit}
                    disabled={submitting}
                  >
                    {submitting ? (
                      'Submitting…'
                    ) : isResubmit ? (
                      <>
                        <FiRefreshCw className="tpm-btn-icon" />
                        <span>Resubmit Stock Transfer Slip</span>
                      </>
                    ) : (
                      <>
                        <FiCheckCircle className="tpm-btn-icon" />
                        <span>Submit Stock Transfer Slip</span>
                      </>
                    )}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );

  // ============================================================
  // Success screen
  // ============================================================
  function renderSuccess() {
    const resub = !!submitted?.reopened;
    const target = availableTargets.find(
      (w) => String(w.warehouse_id) === String(toWarehouseId)
    );
    return (
      <div className="tpm-success-wrap">
        <div className="tpm-success-icon"><FiCheckCircle /></div>
        <h2 className="tpm-success-title">
          {resub
            ? 'Stock Transfer Slip Resubmitted'
            : 'Stock Transfer Slip Submitted'}
        </h2>
        <p className="tpm-success-subtitle">
          {resub
            ? 'The slip has been resubmitted to the Department Head for approval under the same STS No.'
            : 'The slip has been sent to the Department Head for approval.'}
        </p>

        <div className="tpm-success-card">
          <div className="tpm-success-row">
            <span className="tpm-success-label">STS No.</span>
            <span className="tpm-success-value">{submitted?.sts_no}</span>
          </div>
          <div className="tpm-success-row">
            <span className="tpm-success-label">From</span>
            <span className="tpm-success-value-small">
              {currentWarehouse?.warehouse_code} — {currentWarehouse?.warehouse_name}
            </span>
          </div>
          <div className="tpm-success-row">
            <span className="tpm-success-label">To</span>
            <span className="tpm-success-value-small">
              {target?.warehouse_code} — {target?.warehouse_name}
            </span>
          </div>
          <div className="tpm-success-row">
            <span className="tpm-success-label">Date</span>
            <span className="tpm-success-value-small">{transferDate}</span>
          </div>
          <div className="tpm-success-row">
            <span className="tpm-success-label">Lines</span>
            <span className="tpm-success-value-small">
              {summary.totalLines} line{summary.totalLines === 1 ? '' : 's'} ·{' '}
              {summary.totalQty} unit{summary.totalQty === 1 ? '' : 's'}
            </span>
          </div>
          <div className="tpm-success-row">
            <span className="tpm-success-label">Status</span>
            <span className="tpm-success-badge">PENDING</span>
          </div>
          {resub && (
            <div className="tpm-success-row">
              <span className="tpm-success-label">Mode</span>
              <span className="tpm-success-value-small">Reopened existing slip</span>
            </div>
          )}
        </div>

        <button
          type="button"
          className="save-btn tpm-success-btn"
          onClick={onClose}
        >
          Close
        </button>
      </div>
    );
  }

  // ============================================================
  // Form
  // ============================================================
  function renderForm() {
    return (
      <>
        {lastRejection && (
          <div className="tpm-rejection-banner">
            <div className="tpm-rejection-header">
              <span className="tpm-rejection-icon"><FiAlertTriangle /></span>
              <span className="tpm-rejection-title">
                Previous transfer ({lastRejection.sts_no}) was rejected
              </span>
            </div>
            <div className="tpm-rejection-body">
              {lastRejection.rejection_reason || 'No reason given.'}
            </div>
            <div className="tpm-rejection-meta">
              by {lastRejection.rejected_by || '—'}
              {lastRejection.rejected_at
                ? ` · ${new Date(lastRejection.rejected_at).toLocaleString()}`
                : ''}
            </div>
            <div className="tpm-rejection-hint">
              <FiInfo className="tpm-rejection-hint-icon" />
              <span>
                Review the remarks above and adjust your new transfer accordingly.
                <br />
                <strong>STS No. {lastRejection.sts_no} will stay the same after you resubmit.</strong>
              </span>
            </div>
          </div>
        )}

        {pendingCount > 0 && !lockError && (
          <div className="tpm-pending-banner">
            <span className="tpm-pending-banner-icon"><FiClock /></span>
            <span>
              <strong>{pendingCount}</strong>{' '}
              item{pendingCount === 1 ? ' is' : 's are'} already awaiting Department
              Head approval. Only the remaining items below can be transferred on
              this new slip. Cancel a pending slip from the{' '}
              <strong>My Submitted Stock Transfer Slips</strong> section.
            </span>
          </div>
        )}

        {lockError && (
          <div className="tpm-lock-banner">
            <span className="tpm-lock-banner-icon"><FiClock /></span>
            <span>{lockError}</span>
          </div>
        )}

        <div className="tpm-head-grid">
          <div className="tpm-field-block">
            <label className="tpm-field-label">
              STS No.
              <span className="tpm-pill tpm-pill--auto">
                {lastRejection ? 'same as rejected' : 'auto'}
              </span>
            </label>
            <input
              type="text"
              value={
                stsNo ||
                (lastRejection ? lastRejection.sts_no : 'Auto-assigned on submit')
              }
              readOnly
              disabled
              className={`tpm-readonly-input ${
                stsNo || lastRejection ? '' : 'tpm-readonly-input--placeholder'
              }`}
            />
            <small className="tpm-helper-text">
              {lastRejection
                ? `Resubmission keeps STS No. ${lastRejection.sts_no}`
                : stsNo
                ? 'Assigned by the system'
                : 'A unique STS number will be generated when you submit'}
            </small>
          </div>

          <div className="tpm-field-block">
            <label className="tpm-field-label" htmlFor="tpm-date">Date</label>
            <input
              id="tpm-date"
              type="date"
              value={transferDate}
              onChange={(e) => setTransferDate(e.target.value)}
              disabled={submitting || !!lockError}
              className="tpm-input"
            />
            <small className="tpm-helper-text">Defaults to today</small>
          </div>
        </div>

        <div className="tpm-head-grid">
          <div className="tpm-field-block">
            <label className="tpm-field-label">From (Warehouse)</label>
            <input
              type="text"
              value={
                currentWarehouse?.warehouse_code
                  ? `${currentWarehouse.warehouse_code} — ${currentWarehouse.warehouse_name || ''}`
                  : 'Not assigned'
              }
              readOnly
              disabled
              className="tpm-readonly-input"
            />
          </div>

          <div className="tpm-field-block">
            <label className="tpm-field-label" htmlFor="tpm-to">To (Warehouse) *</label>
            <select
              id="tpm-to"
              value={toWarehouseId}
              onChange={(e) => setToWarehouseId(e.target.value)}
              disabled={submitting || !!lockError}
              className="tpm-input"
            >
              <option value="">Select destination warehouse</option>
              {availableTargets.map((w) => (
                <option key={w.warehouse_id} value={w.warehouse_id}>
                  {w.warehouse_code} — {w.warehouse_name}
                </option>
              ))}
            </select>
            {availableTargets.length === 0 && (
              <small className="tpm-helper-text tpm-helper-text--error">
                No other active warehouses available.
              </small>
            )}
          </div>
        </div>

        <div className="tpm-ref-badge">
          <span className="tpm-ref-icon"><FiClipboard /></span>
          <div className="tpm-ref-body">
            <span className="tpm-ref-item">
              <span className="tpm-ref-key">PO No.:</span> <strong>{po.po_no}</strong>
            </span>
            <span className="tpm-ref-item">
              <span className="tpm-ref-key">Vendor:</span> {po.vendor_name || '—'}
            </span>
            <span className="tpm-ref-item">
              <span className="tpm-ref-key">PO Date:</span> {po.po_date || '—'}
            </span>
          </div>
        </div>

        <div className="tpm-field-block">
          <label className="tpm-field-label" htmlFor="tpm-remarks">
            Remarks <span className="tpm-pill tpm-pill--optional">optional</span>
          </label>
          <textarea
            id="tpm-remarks"
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            disabled={submitting || !!lockError}
            rows={2}
            placeholder="Add any notes for the approver…"
            className="tpm-textarea"
          />
        </div>

        <div className="tpm-section-head">
          <span className="tpm-section-title">
            <FiPackage />
            <span>Items on this PO{' '}
              <span className="tpm-section-count">({editable.length})</span>
            </span>
          </span>
          {summary.totalLines > 0 && (
            <span className="tpm-summary-chip">
              {summary.totalLines} selected · {summary.totalQty} unit
              {summary.totalQty === 1 ? '' : 's'}
            </span>
          )}
        </div>

        {editable.length === 0 ? (
          <div className="tpm-empty-lines">
            No lines loaded for this PO. Try closing the modal and reopening it.
          </div>
        ) : (
          <div className="tpm-lines-list">
            {editable.map((l) => {
              const isPending   = l.line_status === 'Pending Transfer';
              const isCompleted =
                l.line_status === 'Transferred' || l.line_status === 'Stored';
              const isLocked    = isPending || isCompleted;

              const maxTransferable = isLocked
                ? 0
                : Math.max(0, l.received_qty - l.already_transferred);

              const remaining = Math.max(
                0,
                l.received_qty - l.already_transferred - l.transfer_qty
              );
              const isPartial = l.transfer_qty > 0 && remaining > 0;
              const isFull =
                l.transfer_qty === maxTransferable && l.transfer_qty > 0;

              const cardModifier = isPending
                ? 'tpm-line-card--pending'
                : isCompleted
                ? 'tpm-line-card--disabled'
                : isFull
                ? 'tpm-line-card--full'
                : isPartial
                ? 'tpm-line-card--partial'
                : '';

              return (
                <div
                  key={l.rowKey}
                  className={`tpm-line-card ${cardModifier}`.trim()}
                >
                  <div className="tpm-line-top">
                    <ItemImageThumb
                      src={images[l.item_code]}
                      alt={l.item_code}
                      size={48}
                    />
                    <div className="tpm-line-info">
                      <div className="tpm-line-code-row">
                        <span className="tpm-line-code">{l.item_code}</span>
                        {isPending && (
                          <span className="tpm-chip tpm-chip--pending">
                            <FiClock />
                            <span>Awaiting approval</span>
                          </span>
                        )}
                        {isCompleted && (
                          <span className="tpm-chip tpm-chip--completed">
                            <FiCheckCircle />
                            <span>Transferred</span>
                          </span>
                        )}
                      </div>
                      <div className="tpm-line-name" title={l.item_name}>
                        {l.item_name || '—'}
                      </div>
                    </div>
                    <div className="tpm-line-uom-wrap">
                      <span className="tpm-uom-tag">{l.uom || '—'}</span>
                    </div>
                  </div>

                  <div className="tpm-line-metrics">
                    <div className="tpm-metric">
                      <div className="tpm-metric-label">Received</div>
                      <div className="tpm-metric-value">{l.received_qty}</div>
                    </div>
                    <div className="tpm-metric">
                      <div className="tpm-metric-label">Prev. Transferred</div>
                      <div
                        className={`tpm-metric-value ${
                          l.already_transferred > 0
                            ? 'tpm-metric-value--accent'
                            : 'tpm-metric-value--empty'
                        }`}
                      >
                        {l.already_transferred}
                      </div>
                    </div>
                    <div className="tpm-metric">
                      <div className="tpm-metric-label">
                        {isPending ? 'Status' : 'Remaining'}
                      </div>
                      <div
                        className={`tpm-metric-value ${
                          isPending
                            ? 'tpm-metric-value--pending'
                            : isCompleted
                            ? 'tpm-metric-value--muted'
                            : remaining > 0
                            ? isPartial
                              ? 'tpm-metric-value--warn'
                              : 'tpm-metric-value--danger'
                            : 'tpm-metric-value--success'
                        }`}
                      >
                        {isPending ? (
                          <span>Pending</span>
                        ) : isCompleted ? (
                          <span>Done</span>
                        ) : (
                          <>
                            {remaining}
                            {isPartial && <span className="tpm-partial-tag">partial</span>}
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="tpm-line-bottom">
                    <label
                      className="tpm-transfer-qty-label"
                      htmlFor={`tpm-qty-${l.rowKey}`}
                    >
                      Transfer Quantity
                    </label>
                    <input
                      id={`tpm-qty-${l.rowKey}`}
                      type="number"
                      min="0"
                      max={maxTransferable}
                      inputMode="numeric"
                      value={l.transfer_qty}
                      onChange={(e) => handleQtyChange(l.rowKey, e.target.value)}
                      disabled={
                        submitting ||
                        !!lockError ||
                        isLocked ||
                        maxTransferable === 0
                      }
                      placeholder={
                        isPending
                          ? 'Awaiting approval'
                          : isCompleted
                          ? 'Already transferred'
                          : maxTransferable === 0
                          ? 'No qty available'
                          : '0'
                      }
                      className={`tpm-transfer-qty-input ${
                        isLocked ? 'tpm-transfer-qty-input--disabled' : ''
                      }`}
                    />
                    <span className="tpm-max-hint">
                      {isPending
                        ? 'On a pending slip — cancel it below if needed'
                        : isCompleted
                        ? 'Already moved'
                        : `Max: ${maxTransferable}`}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="tpm-note-block">
          <span className="tpm-note-icon"><FiInfo /></span>
          <span>
            Each item on this PO can be transferred independently. Items already
            on a pending slip or fully transferred cannot be re-submitted here.
            Approve or reject the pending slip first, or submit a separate slip
            for the remaining items.
          </span>
        </div>
      </>
    );
  }
};

/* ============================================================
   Responsive CSS
   ============================================================ */
const modalCss = `
@keyframes tpmFadeIn { from { opacity: 0 } to { opacity: 1 } }
@keyframes tpmSlideUp { from { opacity: 0; transform: translateY(16px) scale(0.98) } to { opacity: 1; transform: translateY(0) scale(1) } }

/* ---------- Overlay / Card ---------- */
.tpm-overlay {
  position: fixed; inset: 0;
  background: rgba(15, 23, 42, 0.62);
  backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
  display: flex; align-items: center; justify-content: center;
  z-index: 10000;
  padding: clamp(8px, 2vw, 24px);
  animation: tpmFadeIn 0.18s ease;
}
.tpm-card {
  background: #ffffff;
  border-radius: clamp(12px, 1.5vw, 18px);
  width: 100%;
  max-width: 1180px;
  max-height: 92vh;
  max-height: 92dvh;
  display: flex; flex-direction: column;
  overflow: hidden;
  box-shadow: 0 24px 64px rgba(15, 23, 42, 0.28), 0 4px 14px rgba(15, 23, 42, 0.14);
  animation: tpmSlideUp 0.22s cubic-bezier(0.34, 1.3, 0.64, 1);
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}

/* ---------- Header ---------- */
.tpm-header {
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px;
  padding: clamp(16px, 2vw, 22px) clamp(18px, 2.4vw, 28px);
  border-bottom: 1px solid #e5e7eb;
  background: linear-gradient(135deg, #ffffff 0%, #f8fafc 100%);
  flex-shrink: 0;
}
.tpm-header-left { display: flex; align-items: center; gap: 14px; flex: 1; min-width: 0; }
.tpm-header-info { min-width: 0; flex: 1; }
.tpm-header-icon {
  width: 44px; height: 44px; border-radius: 12px;
  background: linear-gradient(135deg, #6366f1 0%, #4338ca 100%);
  color: #fff; display: flex; align-items: center; justify-content: center;
  box-shadow: 0 4px 12px rgba(99, 102, 241, 0.32);
  flex-shrink: 0;
}
.tpm-header-icon svg { width: 22px; height: 22px; stroke-width: 2.2; color: #ffffff; }
.tpm-header-title {
  margin: 0; font-size: clamp(16px, 1.6vw, 20px); font-weight: 700;
  color: #0f172a; letter-spacing: -0.01em; line-height: 1.2;
}
.tpm-header-sub {
  font-size: clamp(11px, 1vw, 13px); color: #64748b; margin-top: 3px;
  display: flex; flex-wrap: wrap; align-items: center; gap: 6px;
}
.tpm-header-pono {
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-weight: 700; color: #4338ca;
}
.tpm-header-dot { color: #cbd5e1; }
.tpm-close {
  background: transparent; border: none;
  width: 36px; height: 36px; border-radius: 8px; cursor: pointer;
  color: #64748b; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
}
.tpm-close svg { width: 18px; height: 18px; stroke-width: 2.4; }
.tpm-close:hover:not(:disabled) { background: #f1f5f9; color: #0f172a; }
.tpm-close:disabled { opacity: 0.4; cursor: not-allowed; }

/* ---------- Body ---------- */
.tpm-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: clamp(18px, 2.4vw, 28px);
  display: flex; flex-direction: column;
  gap: clamp(14px, 1.6vw, 18px);
  background: #ffffff;
  -webkit-overflow-scrolling: touch;
}
.tpm-body > * { flex-shrink: 0; }

.tpm-body::-webkit-scrollbar { width: 8px; }
.tpm-body::-webkit-scrollbar-track { background: #f1f5f9; border-radius: 4px; }
.tpm-body::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 4px; }
.tpm-body::-webkit-scrollbar-thumb:hover { background: #94a3b8; }

/* ---------- Footer ---------- */
.tpm-footer {
  display: flex; justify-content: flex-end; align-items: center; gap: 10px;
  padding: clamp(12px, 1.6vw, 18px) clamp(18px, 2.4vw, 28px);
  border-top: 1px solid #e5e7eb; background: #f8fafc;
  flex-shrink: 0; flex-wrap: wrap;
}

/* ---------- Rejection banner ---------- */
.tpm-rejection-banner {
  padding: 14px 16px;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-left: 4px solid #ef4444;
  border-radius: 10px;
  color: #7f1d1d;
  display: flex; flex-direction: column; gap: 6px;
}
.tpm-rejection-header {
  display: flex; align-items: center; gap: 8px;
  font-weight: 700; font-size: 14px; color: #991b1b;
}
.tpm-rejection-icon {
  display: inline-flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.tpm-rejection-icon svg {
  width: 18px; height: 18px; stroke-width: 2.4; color: #dc2626;
}
.tpm-rejection-title { font-size: 14px; font-weight: 700; }
.tpm-rejection-body {
  font-size: 13px; line-height: 1.55; white-space: pre-wrap; color: #7f1d1d;
}
.tpm-rejection-meta { font-size: 11px; font-style: italic; color: #b91c1c; }
.tpm-rejection-hint {
  font-size: 12px; color: #991b1b;
  background: rgba(255, 255, 255, 0.6);
  padding: 6px 10px; border-radius: 6px; margin-top: 2px;
  line-height: 1.5;
  display: flex; align-items: flex-start; gap: 6px;
}
.tpm-rejection-hint-icon {
  width: 1em; height: 1em; flex-shrink: 0;
  stroke-width: 2.4;
  color: #b45309;
  margin-top: 2px;
}

/* ---------- Pending banner ---------- */
.tpm-pending-banner {
  padding: 12px 16px;
  background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%);
  border: 1px solid #fcd34d;
  border-left: 4px solid #f59e0b;
  border-radius: 10px;
  color: #78350f;
  font-size: 13px; line-height: 1.5;
  display: flex; align-items: flex-start; gap: 10px;
}
.tpm-pending-banner-icon {
  display: inline-flex; align-items: center; justify-content: center;
  flex-shrink: 0; margin-top: 1px;
}
.tpm-pending-banner-icon svg {
  width: 18px; height: 18px; stroke-width: 2.2; color: #b45309;
}

/* ---------- Lock banner ---------- */
.tpm-lock-banner {
  padding: 12px 16px;
  background: #fffbeb;
  border: 1px solid #fde68a;
  border-radius: 10px;
  color: #92400e;
  font-size: 13px; font-weight: 600;
  display: flex; align-items: flex-start; gap: 10px;
}
.tpm-lock-banner-icon {
  display: inline-flex; align-items: center; justify-content: center;
  flex-shrink: 0; margin-top: 1px;
}
.tpm-lock-banner-icon svg {
  width: 18px; height: 18px; stroke-width: 2.2; color: #b45309;
}

/* ---------- Head grid ---------- */
.tpm-head-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: clamp(12px, 1.4vw, 18px);
}
.tpm-field-block { display: flex; flex-direction: column; gap: 4px; }
.tpm-field-label {
  font-size: 12px; font-weight: 700; color: #334155;
  text-transform: uppercase; letter-spacing: 0.05em;
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
}
.tpm-pill {
  font-size: 10px; font-weight: 600;
  padding: 1px 7px; border-radius: 999px;
  text-transform: none; letter-spacing: 0;
}
.tpm-pill--auto {
  color: #6b7280; background: #f3f4f6;
}
.tpm-pill--optional {
  color: #94a3b8; background: #f1f5f9; font-style: italic; font-weight: 500;
}

.tpm-readonly-input {
  width: 100%; padding: 10px 12px; font-size: 14px;
  border: 1px solid #e2e8f0; border-radius: 8px;
  background: #f8fafc; color: #0f172a;
  font-weight: 600;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  outline: none; cursor: not-allowed;
  box-sizing: border-box;
}
.tpm-readonly-input--placeholder {
  color: #94a3b8; font-style: italic; font-weight: 500;
}
.tpm-input {
  width: 100%; padding: 10px 12px; font-size: 14px;
  border: 1px solid #cbd5e1; border-radius: 8px;
  background: #ffffff; color: #0f172a;
  font-family: inherit; outline: none; box-sizing: border-box;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.tpm-input:focus {
  border-color: #6366f1;
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.18);
}
.tpm-textarea {
  width: 100%; padding: 10px 12px; font-size: 14px;
  border: 1px solid #cbd5e1; border-radius: 8px;
  background: #ffffff; color: #0f172a;
  font-family: inherit; outline: none; box-sizing: border-box;
  resize: vertical; min-height: 60px;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.tpm-textarea:focus {
  border-color: #6366f1;
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.15);
}
.tpm-helper-text { font-size: 11px; color: #64748b; margin-top: 2px; }
.tpm-helper-text--error { color: #dc2626; }

/* ---------- Ref badge ---------- */
.tpm-ref-badge {
  display: flex; align-items: flex-start; gap: 12px;
  padding: 12px 16px;
  background: linear-gradient(135deg, #eef2ff 0%, #e0e7ff 100%);
  border: 1px solid #c7d2fe; border-radius: 10px;
}
.tpm-ref-icon {
  display: inline-flex; align-items: center; justify-content: center;
  flex-shrink: 0; margin-top: 1px;
}
.tpm-ref-icon svg {
  width: 18px; height: 18px; stroke-width: 2.2; color: #4338ca;
}
.tpm-ref-body {
  display: flex; flex-wrap: wrap; gap: 6px 20px;
  font-size: 13px; color: #3730a3;
}
.tpm-ref-item { white-space: nowrap; }
.tpm-ref-key { color: #6366f1; font-weight: 600; margin-right: 2px; }

/* ---------- Section head ---------- */
.tpm-section-head {
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px; flex-wrap: wrap;
}
.tpm-section-title {
  font-size: 14px; font-weight: 700; color: #0f172a;
  display: inline-flex; align-items: center; gap: 8px;
}
.tpm-section-title svg {
  width: 16px; height: 16px; stroke-width: 2.2; color: #334155;
}
.tpm-section-count { color: #64748b; font-weight: 500; }
.tpm-summary-chip {
  font-size: 12px; font-weight: 600; padding: 5px 12px;
  background: #eef2ff; color: #4338ca; border-radius: 999px;
  white-space: nowrap;
}

/* ---------- Empty state ---------- */
.tpm-empty-lines {
  padding: 24px 20px;
  background: #fffbeb;
  border: 1px dashed #fcd34d;
  border-radius: 10px;
  font-size: 13px; color: #92400e; text-align: center;
}

/* ---------- Lines list ---------- */
.tpm-lines-list {
  display: flex; flex-direction: column; gap: 12px;
}
.tpm-line-card {
  display: flex; flex-direction: column; gap: 12px;
  padding: 14px 16px;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
}
.tpm-line-card--full {
  background: rgba(16, 185, 129, 0.05);
  border-color: #86efac;
}
.tpm-line-card--partial {
  background: rgba(245, 158, 11, 0.05);
  border-color: #fcd34d;
}
.tpm-line-card--disabled {
  background: rgba(148, 163, 184, 0.08);
  opacity: 0.75;
}
.tpm-line-card--pending {
  background: rgba(254, 243, 199, 0.5);
  border-color: #fcd34d;
  border-style: dashed;
}

.tpm-line-top {
  display: flex; align-items: center; gap: 12px; min-width: 0;
}
.tpm-line-info { min-width: 0; flex: 1; }
.tpm-line-code-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.tpm-line-code {
  font-weight: 700; font-size: 14px;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  color: #4338ca; letter-spacing: 0.02em; line-height: 1.2;
}
.tpm-chip {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 10px; font-weight: 700;
  padding: 2px 8px; border-radius: 999px;
  text-transform: uppercase; letter-spacing: 0.04em;
  white-space: nowrap;
}
.tpm-chip svg { width: 1em; height: 1em; stroke-width: 2.4; flex-shrink: 0; }
.tpm-chip--pending {
  color: #92400e; background: #fef3c7; border: 1px solid #fcd34d;
}
.tpm-chip--completed {
  color: #065f46; background: #dcfce7; border: 1px solid #86efac;
}
.tpm-line-name {
  font-size: 12px; color: #475569; margin-top: 2px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; line-height: 1.3;
}
.tpm-line-uom-wrap { flex-shrink: 0; }
.tpm-uom-tag {
  display: inline-block; padding: 3px 9px;
  background: #f1f5f9; color: #334155;
  border-radius: 6px; font-size: 11px; font-weight: 600;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
}

.tpm-line-metrics {
  display: grid; grid-template-columns: repeat(3, 1fr);
  gap: 12px; padding-top: 10px;
  border-top: 1px dashed #e5e7eb;
}
.tpm-metric { display: flex; flex-direction: column; gap: 2px; }
.tpm-metric-label {
  font-size: 10px; font-weight: 700; color: #64748b;
  text-transform: uppercase; letter-spacing: 0.05em;
}
.tpm-metric-value {
  font-size: 16px; font-weight: 700; color: #0f172a;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
}
.tpm-metric-value--accent  { color: #4338ca; }
.tpm-metric-value--empty   { color: #94a3b8; }
.tpm-metric-value--pending { color: #92400e; }
.tpm-metric-value--muted   { color: #475569; }
.tpm-metric-value--warn    { color: #d97706; }
.tpm-metric-value--danger  { color: #dc2626; }
.tpm-metric-value--success { color: #16a34a; }

.tpm-partial-tag {
  font-size: 10px; color: #d97706; font-weight: 700;
  margin-left: 6px; text-transform: uppercase; letter-spacing: 0.05em;
}

.tpm-line-bottom {
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
}
.tpm-transfer-qty-label {
  font-size: 12px; font-weight: 700; color: #334155;
  text-transform: uppercase; letter-spacing: 0.05em;
}
.tpm-transfer-qty-input {
  width: 120px; padding: 10px 12px;
  font-size: 15px; font-weight: 700;
  border: 1.5px solid #6366f1; border-radius: 8px;
  background: #fff; color: #0f172a;
  font-family: inherit; text-align: center;
  outline: none;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.tpm-transfer-qty-input:focus {
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.18);
}
.tpm-transfer-qty-input--disabled {
  background: #f8fafc; border-color: #cbd5e1;
  color: #94a3b8; cursor: not-allowed;
}
.tpm-max-hint {
  font-size: 11px; color: #64748b; font-style: italic;
  flex: 1; min-width: 0;
}

/* ---------- Note block ---------- */
.tpm-note-block {
  display: flex; align-items: flex-start; gap: 8px;
  padding: 12px 14px;
  background: #f8fafc;
  border: 1px solid #e2e8f0; border-radius: 8px;
  font-size: 12px; color: #475569; line-height: 1.5;
}
.tpm-note-icon {
  display: inline-flex; align-items: center; justify-content: center;
  flex-shrink: 0; margin-top: 1px;
}
.tpm-note-icon svg {
  width: 14px; height: 14px; stroke-width: 2.4; color: #475569;
}

/* ---------- Success screen ---------- */
.tpm-success-wrap {
  display: flex; flex-direction: column; align-items: center;
  padding: clamp(20px, 4vw, 40px) 20px;
  text-align: center;
}
.tpm-success-icon {
  display: inline-flex; align-items: center; justify-content: center;
  margin-bottom: 16px;
}
.tpm-success-icon svg {
  width: 64px; height: 64px;
  stroke-width: 1.8;
  color: #059669;
}
.tpm-success-title {
  margin: 0; font-size: clamp(20px, 2.4vw, 26px); font-weight: 700;
  color: #0f172a; letter-spacing: -0.01em;
}
.tpm-success-subtitle {
  margin: 8px 0 24px; color: #64748b; font-size: 14px;
  max-width: 460px; line-height: 1.5;
}
.tpm-success-card {
  width: 100%; max-width: 520px;
  background: linear-gradient(135deg, #f0fdfa 0%, #ecfeff 100%);
  border: 1.5px solid #99f6e4; border-radius: 14px;
  padding: 18px 22px;
  display: flex; flex-direction: column; gap: 12px;
}
.tpm-success-row {
  display: flex; justify-content: space-between; align-items: center;
  gap: 12px; padding-bottom: 10px;
  border-bottom: 1px dashed rgba(0, 138, 130, 0.2);
}
.tpm-success-row:last-child { border-bottom: none; padding-bottom: 0; }
.tpm-success-label {
  font-size: 12px; font-weight: 700; color: #0f766e;
  text-transform: uppercase; letter-spacing: 0.05em; flex-shrink: 0;
}
.tpm-success-value {
  font-size: 20px; font-weight: 700; color: #008a82;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  letter-spacing: 0.02em;
}
.tpm-success-value-small {
  font-size: 13px; font-weight: 600; color: #0f172a;
  text-align: right; word-break: break-word;
}
.tpm-success-badge {
  font-size: 11px; font-weight: 700; color: #92400e;
  background: #fef3c7; padding: 3px 10px;
  border-radius: 999px; letter-spacing: 0.05em;
}
.tpm-success-btn { margin-top: 20px; min-width: 160px; }

/* ---------- Button icons ---------- */
.tpm-btn-icon {
  width: 1em; height: 1em; flex-shrink: 0;
  stroke-width: 2.4;
}

/* ============================================================
   TABLET — 641 to 900px
   ============================================================ */
@media (max-width: 900px) {
  .tpm-card { max-width: 96vw; }
  .tpm-body { padding: 16px; }
  .tpm-footer { padding: 12px 16px; }
}

/* ============================================================
   MOBILE — ≤ 640px
   ============================================================ */
@media (max-width: 640px) {
  .tpm-overlay { padding: 0 !important; align-items: stretch !important; }
  .tpm-card {
    max-height: 100vh !important;
    max-height: 100dvh !important;
    width: 100vw !important;
    max-width: 100vw !important;
    height: 100vh !important;
    height: 100dvh !important;
    border-radius: 0 !important;
    animation: none !important;
  }

  .tpm-header { padding: 12px 14px !important; }
  .tpm-header-icon { width: 36px !important; height: 36px !important; border-radius: 10px !important; }
  .tpm-header-icon svg { width: 18px !important; height: 18px !important; }
  .tpm-header-title { font-size: 15px !important; }
  .tpm-header-sub { font-size: 11px !important; }

  .tpm-body { padding: 14px !important; gap: 12px !important; }

  .tpm-head-grid { grid-template-columns: 1fr !important; gap: 12px !important; }

  .tpm-input,
  .tpm-textarea { font-size: 16px !important; }

  .tpm-line-metrics { grid-template-columns: 1fr 1fr !important; }

  .tpm-line-bottom {
    flex-direction: column; align-items: stretch !important; gap: 6px !important;
  }
  .tpm-transfer-qty-input { width: 100% !important; font-size: 16px !important; min-height: 46px; }
  .tpm-max-hint { text-align: center; flex: initial; }

  .tpm-section-head { flex-direction: column; align-items: flex-start !important; gap: 6px !important; }
  .tpm-summary-chip { font-size: 11px !important; }

  .tpm-ref-body { flex-direction: column; gap: 4px !important; }
  .tpm-ref-item { white-space: normal; }

  .tpm-footer { padding: 10px 14px !important; gap: 8px !important; }
  .tpm-footer > button {
    flex: 1 1 auto; min-height: 44px;
    padding: 12px 16px !important; font-size: 14px !important;
  }

  .tpm-success-wrap { padding: 16px 8px; }
  .tpm-success-icon svg { width: 48px !important; height: 48px !important; }
  .tpm-success-card { padding: 14px 16px; }
  .tpm-success-btn { min-width: 0 !important; width: 100%; }

  .tpm-rejection-banner,
  .tpm-pending-banner,
  .tpm-lock-banner { padding: 12px 14px; }
  .tpm-rejection-title { font-size: 13px; }
  .tpm-rejection-body { font-size: 12px; }
}

/* ============================================================
   VERY SMALL PHONES — ≤ 380px
   ============================================================ */
@media (max-width: 380px) {
  .tpm-header-icon { width: 32px !important; height: 32px !important; }
  .tpm-header-icon svg { width: 16px !important; height: 16px !important; }
  .tpm-header-title { font-size: 14px !important; }
  .tpm-line-metrics { grid-template-columns: 1fr !important; }
  .tpm-footer { flex-direction: column-reverse !important; }
  .tpm-footer > button { width: 100%; }
  .tpm-line-top { gap: 10px; }
  .tpm-line-code { font-size: 13px !important; }
}

/* ============================================================
   SHORT LANDSCAPE PHONE
   ============================================================ */
@media (max-height: 500px) and (orientation: landscape) {
  .tpm-overlay { padding: 8px !important; align-items: center !important; }
  .tpm-card {
    height: auto !important; max-height: 96vh !important;
    border-radius: 12px !important; max-width: 96vw !important;
  }
  .tpm-header { padding: 8px 14px !important; }
  .tpm-body   { padding: 10px 14px !important; gap: 10px !important; }
  .tpm-footer { padding: 8px 14px !important; }
}

/* ============================================================
   REDUCED MOTION
   ============================================================ */
@media (prefers-reduced-motion: reduce) {
  .tpm-card, .tpm-overlay { animation: none !important; }
}
`;

export default TransferPoModal;