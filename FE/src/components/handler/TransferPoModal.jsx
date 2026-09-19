// src/components/handler/TransferPoModal.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { itemMasterApi, stockTransferApi } from '../../services/api';
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

  // ============================================================
  // Fetch item images
  // ============================================================
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

  // ============================================================
  // Fetch previously-transferred quantities (approved / completed only)
  // ============================================================
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

  // ============================================================
  // Build editable rows from PO lines
  //
  // Preserves each line's status so we can disable inputs for
  // items already on a pending slip or already fully transferred.
  // rowKey includes idx to guarantee uniqueness even if the API
  // returns duplicate `id` values across lines.
  // ============================================================
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
          line_status:         l.status || '',   // ⬅ per-item status preserved
        };
      });
    });
  }, [lines, transferredMap]);

  // ============================================================
  // Target warehouse options
  // ============================================================
  const availableTargets = useMemo(() => {
    const fromId = currentWarehouse?.warehouse_id;
    return (warehouses || [])
      .filter((w) => (w.status ? w.status === 'Active' : true))
      .filter((w) => w.warehouse_id !== fromId);
  }, [warehouses, currentWarehouse]);

  // ============================================================
  // Quantity edits
  // ============================================================
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

  // Count of items on this PO that are currently awaiting approval
  const pendingCount = useMemo(
    () => editable.filter((l) => l.line_status === 'Pending Transfer').length,
    [editable]
  );

  // ============================================================
  // Submit
  // ============================================================
  const handleSubmit = async () => {
    if (lockError) return;
    if (!toWarehouseId) return alert('Please select a destination warehouse.');
    if (!transferDate)  return alert('Please choose a transfer date.');

    const linesToTransfer = editable.filter((l) => l.transfer_qty > 0);
    if (linesToTransfer.length === 0) {
      return alert('Please enter at least one transfer quantity.');
    }

    const target = availableTargets.find(
      (w) => String(w.warehouse_id) === String(toWarehouseId)
    );
    if (!target) return alert('The selected destination warehouse is invalid.');

    const confirmMsg =
      `🚚 Submit Stock Transfer Slip?\n\n` +
      `From:  ${currentWarehouse?.warehouse_code || '—'} — ${currentWarehouse?.warehouse_name || ''}\n` +
      `To:    ${target.warehouse_code} — ${target.warehouse_name}\n` +
      `Date:  ${transferDate}\n` +
      `Lines: ${linesToTransfer.length}\n\n` +
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
        alert('⚠️ ' + msg + '\n\nThe transfer form will close. Refresh the PO list to see the current state.');
        return;
      }

      if (!res.ok || !res.data?.success) {
        alert('❌ ' + (res.data?.message || 'Failed to submit Stock Transfer Slip.'));
        return;
      }

      const created = res.data.data;
      setStsNo(created.sts_no);
      setSubmitted(created);
      onSubmitted?.(created);
    } catch (err) {
      console.error(err);
      alert('❌ Error submitting Stock Transfer Slip.');
    } finally {
      setSubmitting(false);
    }
  };

  // ============================================================
  // Success screen
  // ============================================================
  const renderSuccess = () => (
    <div style={styles.successWrap}>
      <div style={styles.successIcon}>✅</div>
      <h2 style={styles.successTitle}>Stock Transfer Slip Submitted</h2>
      <p style={styles.successSubtitle}>
        The slip has been sent to the Department Head for approval.
      </p>

      <div style={styles.successCard}>
        <div style={styles.successRow}>
          <span style={styles.successLabel}>STS No.</span>
          <span style={styles.successValue}>{submitted?.sts_no}</span>
        </div>
        <div style={styles.successRow}>
          <span style={styles.successLabel}>From</span>
          <span style={styles.successValueSmall}>
            {currentWarehouse?.warehouse_code} — {currentWarehouse?.warehouse_name}
          </span>
        </div>
        <div style={styles.successRow}>
          <span style={styles.successLabel}>To</span>
          <span style={styles.successValueSmall}>
            {availableTargets.find((w) => String(w.warehouse_id) === String(toWarehouseId))
              ?.warehouse_code}{' '}
            —{' '}
            {availableTargets.find((w) => String(w.warehouse_id) === String(toWarehouseId))
              ?.warehouse_name}
          </span>
        </div>
        <div style={styles.successRow}>
          <span style={styles.successLabel}>Date</span>
          <span style={styles.successValueSmall}>{transferDate}</span>
        </div>
        <div style={styles.successRow}>
          <span style={styles.successLabel}>Lines</span>
          <span style={styles.successValueSmall}>
            {summary.totalLines} line{summary.totalLines === 1 ? '' : 's'} ·{' '}
            {summary.totalQty} unit{summary.totalQty === 1 ? '' : 's'}
          </span>
        </div>
        <div style={styles.successRow}>
          <span style={styles.successLabel}>Status</span>
          <span style={styles.successBadge}>PENDING</span>
        </div>
      </div>

      <button
        type="button"
        className="save-btn"
        onClick={onClose}
        style={{ marginTop: 20, minWidth: 160 }}
      >
        Close
      </button>
    </div>
  );

  // ============================================================
  // Form
  // ============================================================
  const renderForm = () => (
    <>
      {lastRejection && (
        <div style={styles.rejectionBanner}>
          <div style={styles.rejectionHeader}>
            <span style={styles.rejectionIcon}>⚠️</span>
            <span style={styles.rejectionTitle}>
              Previous transfer ({lastRejection.sts_no}) was rejected
            </span>
          </div>
          <div style={styles.rejectionBody}>
            {lastRejection.rejection_reason || 'No reason given.'}
          </div>
          <div style={styles.rejectionMeta}>
            by {lastRejection.rejected_by || '—'}
            {lastRejection.rejected_at
              ? ` · ${new Date(lastRejection.rejected_at).toLocaleString()}`
              : ''}
          </div>
          <div style={styles.rejectionHint}>
            Review the remarks above and adjust your new transfer accordingly.
          </div>
        </div>
      )}

      {pendingCount > 0 && !lockError && (
        <div style={styles.pendingBanner}>
          <span style={styles.pendingBannerIcon}>⏳</span>
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
        <div
          style={{
            padding: '12px 16px',
            background: '#fffbeb',
            border: '1px solid #fde68a',
            borderRadius: 10,
            color: '#92400e',
            fontSize: 13,
            fontWeight: 600,
            display: 'flex',
            alignItems: 'flex-start',
            gap: 10,
          }}
        >
          <span style={{ fontSize: 18, lineHeight: 1 }}>⏳</span>
          <span>{lockError}</span>
        </div>
      )}

      <div className="tpm-head-grid" style={styles.headGrid}>
        <div style={styles.fieldBlock}>
          <label style={styles.fieldLabel}>
            STS No.
            <span style={styles.autoPill}>auto</span>
          </label>
          <input
            type="text"
            value={stsNo || 'Auto-assigned on submit'}
            readOnly
            disabled
            style={{
              ...styles.readonlyInput,
              color: stsNo ? '#0f172a' : '#94a3b8',
              fontStyle: stsNo ? 'normal' : 'italic',
            }}
          />
          <small style={styles.helperText}>
            {stsNo
              ? 'Assigned by the system'
              : 'A unique STS number will be generated when you submit'}
          </small>
        </div>

        <div style={styles.fieldBlock}>
          <label style={styles.fieldLabel} htmlFor="tpm-date">
            Date 📅
          </label>
          <input
            id="tpm-date"
            type="date"
            value={transferDate}
            onChange={(e) => setTransferDate(e.target.value)}
            disabled={submitting || !!lockError}
            style={styles.input}
          />
          <small style={styles.helperText}>Defaults to today</small>
        </div>
      </div>

      <div className="tpm-head-grid" style={styles.headGrid}>
        <div style={styles.fieldBlock}>
          <label style={styles.fieldLabel}>From (Warehouse)</label>
          <input
            type="text"
            value={
              currentWarehouse?.warehouse_code
                ? `${currentWarehouse.warehouse_code} — ${currentWarehouse.warehouse_name || ''}`
                : 'Not assigned'
            }
            readOnly
            disabled
            style={styles.readonlyInput}
          />
        </div>

        <div style={styles.fieldBlock}>
          <label style={styles.fieldLabel} htmlFor="tpm-to">
            To (Warehouse) *
          </label>
          <select
            id="tpm-to"
            value={toWarehouseId}
            onChange={(e) => setToWarehouseId(e.target.value)}
            disabled={submitting || !!lockError}
            style={styles.input}
          >
            <option value="">Select destination warehouse</option>
            {availableTargets.map((w) => (
              <option key={w.warehouse_id} value={w.warehouse_id}>
                {w.warehouse_code} — {w.warehouse_name}
              </option>
            ))}
          </select>
          {availableTargets.length === 0 && (
            <small style={{ ...styles.helperText, color: '#dc2626' }}>
              No other active warehouses available.
            </small>
          )}
        </div>
      </div>

      <div style={styles.refBadge}>
        <span style={styles.refIcon}>📋</span>
        <div style={styles.refBody}>
          <span style={styles.refItem}>
            <span style={styles.refKey}>PO No.:</span> <strong>{po.po_no}</strong>
          </span>
          <span style={styles.refItem}>
            <span style={styles.refKey}>Vendor:</span> {po.vendor_name || '—'}
          </span>
          <span style={styles.refItem}>
            <span style={styles.refKey}>PO Date:</span> {po.po_date || '—'}
          </span>
        </div>
      </div>

      <div style={styles.fieldBlock}>
        <label style={styles.fieldLabel} htmlFor="tpm-remarks">
          Remarks <span style={styles.optionalPill}>optional</span>
        </label>
        <textarea
          id="tpm-remarks"
          value={remarks}
          onChange={(e) => setRemarks(e.target.value)}
          disabled={submitting || !!lockError}
          rows={2}
          placeholder="Add any notes for the approver…"
          style={styles.textarea}
        />
      </div>

      <div style={styles.sectionHead}>
        <span style={styles.sectionTitle}>
          📦 Items on this PO{' '}
          <span style={styles.sectionCount}>({editable.length})</span>
        </span>
        {summary.totalLines > 0 && (
          <span style={styles.summaryChip}>
            {summary.totalLines} selected · {summary.totalQty} unit
            {summary.totalQty === 1 ? '' : 's'}
          </span>
        )}
      </div>

      {editable.length === 0 ? (
        <div style={styles.emptyLines}>
          No lines loaded for this PO. Try closing the modal and reopening it.
        </div>
      ) : (
        <div style={styles.linesList}>
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

            return (
              <div
                key={l.rowKey}
                style={{
                  ...styles.lineCard,
                  ...(isPending
                    ? styles.lineCardPending
                    : isCompleted
                    ? styles.lineCardDisabled
                    : isFull
                    ? styles.lineCardFull
                    : isPartial
                    ? styles.lineCardPartial
                    : null),
                }}
              >
                <div style={styles.lineTop}>
                  <ItemImageThumb
                    src={images[l.item_code]}
                    alt={l.item_code}
                    size={48}
                  />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={styles.lineCodeRow}>
                      <span style={styles.lineCode}>{l.item_code}</span>
                      {isPending && (
                        <span style={styles.pendingLineChip}>
                          ⏳ Awaiting approval
                        </span>
                      )}
                      {isCompleted && (
                        <span style={styles.completedLineChip}>
                          ✅ Transferred
                        </span>
                      )}
                    </div>
                    <div style={styles.lineName} title={l.item_name}>
                      {l.item_name || '—'}
                    </div>
                  </div>
                  <div style={styles.lineUomWrap}>
                    <span style={styles.uomTag}>{l.uom || '—'}</span>
                  </div>
                </div>

                <div style={styles.lineMetrics}>
                  <div style={styles.metric}>
                    <div style={styles.metricLabel}>Received</div>
                    <div style={styles.metricValue}>{l.received_qty}</div>
                  </div>
                  <div style={styles.metric}>
                    <div style={styles.metricLabel}>Prev. Transferred</div>
                    <div
                      style={{
                        ...styles.metricValue,
                        color:
                          l.already_transferred > 0 ? '#4338ca' : '#94a3b8',
                      }}
                    >
                      {l.already_transferred}
                    </div>
                  </div>
                  <div style={styles.metric}>
                    <div style={styles.metricLabel}>
                      {isPending ? 'Status' : 'Remaining'}
                    </div>
                    <div
                      style={{
                        ...styles.metricValue,
                        color: isPending
                          ? '#92400e'
                          : isCompleted
                          ? '#475569'
                          : remaining > 0
                          ? isPartial
                            ? '#d97706'
                            : '#dc2626'
                          : '#16a34a',
                      }}
                    >
                      {isPending ? (
                        <span>Pending</span>
                      ) : isCompleted ? (
                        <span>Done</span>
                      ) : (
                        <>
                          {remaining}
                          {isPartial && (
                            <span style={styles.partialTag}>partial</span>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <div style={styles.lineBottom}>
                  <label
                    style={styles.transferQtyLabel}
                    htmlFor={`tpm-qty-${l.rowKey}`}
                  >
                    Transfer Quantity
                  </label>
                  <input
                    id={`tpm-qty-${l.rowKey}`}
                    type="number"
                    min="0"
                    max={maxTransferable}
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
                    style={{
                      ...styles.transferQtyInput,
                      ...(isLocked ? styles.transferQtyInputDisabled : null),
                    }}
                  />
                  <span style={styles.maxHint}>
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

      <div style={styles.noteBlock}>
        <span style={styles.noteIcon}>ℹ️</span>
        <span>
          Each item on this PO can be transferred independently. Items already
          on a pending slip or fully transferred cannot be re-submitted here.
          Approve or reject the pending slip first, or submit a separate slip
          for the remaining items.
        </span>
      </div>
    </>
  );

  return (
    <>
      <style>{responsiveCss}</style>

      <div
        className="tpm-overlay"
        style={styles.overlay}
        onClick={submitting ? undefined : onClose}
      >
        <div
          className="tpm-card"
          style={styles.card}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={styles.header}>
            <div style={styles.headerLeft}>
              <div style={styles.headerIcon}>🚚</div>
              <div style={{ minWidth: 0 }}>
                <h3 style={styles.headerTitle}>Stock Transfer Slip</h3>
                <div style={styles.headerSub}>
                  <span style={styles.headerPoNo}>{po.po_no}</span>
                  <span style={styles.headerDot}>·</span>
                  <span>{po.vendor_name || '—'}</span>
                </div>
              </div>
            </div>

            <button
              type="button"
              className="tpm-close"
              onClick={onClose}
              disabled={submitting}
              style={styles.closeBtn}
            >
              ✕
            </button>
          </div>

          <div className="tpm-body" style={styles.body}>
            {submitted ? renderSuccess() : renderForm()}
          </div>

          <div className="tpm-footer" style={styles.footer}>
            {submitted ? (
              <button type="button" className="save-btn" onClick={onClose}>
                Close
              </button>
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
                    {submitting ? 'Submitting…' : '✅ Submit Stock Transfer Slip'}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

const styles = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(15, 23, 42, 0.62)',
    backdropFilter: 'blur(6px)',
    WebkitBackdropFilter: 'blur(6px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10000,
    padding: 'clamp(8px, 2vw, 24px)',
    animation: 'tpmFadeIn 0.18s ease',
  },
  card: {
    background: '#ffffff',
    borderRadius: 'clamp(12px, 1.5vw, 18px)',
    width: '100%',
    maxWidth: 1180,
    maxHeight: '92vh',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    boxShadow:
      '0 24px 64px rgba(15, 23, 42, 0.28), 0 4px 14px rgba(15, 23, 42, 0.14)',
    fontFamily:
      "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    animation: 'tpmSlideUp 0.22s cubic-bezier(0.34, 1.3, 0.64, 1)',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    padding: 'clamp(16px, 2vw, 22px) clamp(18px, 2.4vw, 28px)',
    borderBottom: '1px solid #e5e7eb',
    background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)',
    flexShrink: 0,
  },
  headerLeft: { display: 'flex', alignItems: 'center', gap: 14, flex: 1, minWidth: 0 },
  headerIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    background: 'linear-gradient(135deg, #6366f1 0%, #4338ca 100%)',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 22,
    boxShadow: '0 4px 12px rgba(99, 102, 241, 0.32)',
    flexShrink: 0,
  },
  headerTitle: {
    margin: 0,
    fontSize: 'clamp(16px, 1.6vw, 20px)',
    fontWeight: 700,
    color: '#0f172a',
    letterSpacing: '-0.01em',
    lineHeight: 1.2,
  },
  headerSub: {
    fontSize: 'clamp(11px, 1vw, 13px)',
    color: '#64748b',
    marginTop: 3,
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
  },
  headerPoNo: {
    fontFamily: "'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace",
    fontWeight: 700,
    color: '#4338ca',
  },
  headerDot: { color: '#cbd5e1' },
  closeBtn: {
    background: 'transparent',
    border: 'none',
    width: 36,
    height: 36,
    borderRadius: 8,
    cursor: 'pointer',
    fontSize: 18,
    color: '#64748b',
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
    overflowY: 'auto',
    padding: 'clamp(18px, 2.4vw, 28px)',
    display: 'flex',
    flexDirection: 'column',
    gap: 'clamp(14px, 1.6vw, 18px)',
    background: '#ffffff',
  },
  footer: {
    display: 'flex',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 10,
    padding: 'clamp(12px, 1.6vw, 18px) clamp(18px, 2.4vw, 28px)',
    borderTop: '1px solid #e5e7eb',
    background: '#f8fafc',
    flexShrink: 0,
    flexWrap: 'wrap',
  },

  rejectionBanner: {
    padding: '14px 16px',
    background: '#fef2f2',
    border: '1px solid #fecaca',
    borderLeft: '4px solid #ef4444',
    borderRadius: 10,
    color: '#7f1d1d',
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  rejectionHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontWeight: 700,
    fontSize: 14,
    color: '#991b1b',
  },
  rejectionIcon: { fontSize: 18, lineHeight: 1 },
  rejectionTitle: { fontSize: 14, fontWeight: 700 },
  rejectionBody: {
    fontSize: 13,
    lineHeight: 1.55,
    whiteSpace: 'pre-wrap',
    color: '#7f1d1d',
  },
  rejectionMeta: {
    fontSize: 11,
    fontStyle: 'italic',
    color: '#b91c1c',
  },
  rejectionHint: {
    fontSize: 12,
    color: '#991b1b',
    background: 'rgba(255, 255, 255, 0.6)',
    padding: '6px 10px',
    borderRadius: 6,
    marginTop: 2,
  },

  pendingBanner: {
    padding: '12px 16px',
    background: 'linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)',
    border: '1px solid #fcd34d',
    borderLeft: '4px solid #f59e0b',
    borderRadius: 10,
    color: '#78350f',
    fontSize: 13,
    lineHeight: 1.5,
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
  },
  pendingBannerIcon: { fontSize: 18, lineHeight: 1, flexShrink: 0 },

  headGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 'clamp(12px, 1.4vw, 18px)',
  },
  fieldBlock: { display: 'flex', flexDirection: 'column', gap: 4 },
  fieldLabel: {
    fontSize: 12,
    fontWeight: 700,
    color: '#334155',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  autoPill: {
    fontSize: 10,
    fontWeight: 600,
    color: '#6b7280',
    background: '#f3f4f6',
    padding: '1px 7px',
    borderRadius: 999,
    textTransform: 'none',
    letterSpacing: 0,
  },
  optionalPill: {
    fontSize: 10,
    fontWeight: 500,
    color: '#94a3b8',
    background: '#f1f5f9',
    padding: '1px 7px',
    borderRadius: 999,
    textTransform: 'none',
    letterSpacing: 0,
    fontStyle: 'italic',
  },
  readonlyInput: {
    padding: '10px 12px',
    fontSize: 14,
    border: '1px solid #e2e8f0',
    borderRadius: 8,
    background: '#f8fafc',
    color: '#0f172a',
    fontWeight: 600,
    fontFamily: "'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace",
    outline: 'none',
    cursor: 'not-allowed',
  },
  input: {
    padding: '10px 12px',
    fontSize: 14,
    border: '1px solid #cbd5e1',
    borderRadius: 8,
    background: '#ffffff',
    color: '#0f172a',
    fontFamily: 'inherit',
    outline: 'none',
    transition: 'border-color 0.15s ease',
  },
  textarea: {
    padding: '10px 12px',
    fontSize: 14,
    border: '1px solid #cbd5e1',
    borderRadius: 8,
    background: '#ffffff',
    color: '#0f172a',
    fontFamily: 'inherit',
    outline: 'none',
    resize: 'vertical',
    minHeight: 60,
    transition: 'border-color 0.15s ease',
  },
  helperText: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 2,
  },

  refBadge: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 12,
    padding: '12px 16px',
    background: 'linear-gradient(135deg, #eef2ff 0%, #e0e7ff 100%)',
    border: '1px solid #c7d2fe',
    borderRadius: 10,
  },
  refIcon: { fontSize: 18, flexShrink: 0 },
  refBody: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px 20px',
    fontSize: 13,
    color: '#3730a3',
  },
  refItem: { whiteSpace: 'nowrap' },
  refKey: {
    color: '#6366f1',
    fontWeight: 600,
    marginRight: 2,
  },

  sectionHead: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    flexWrap: 'wrap',
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: 700,
    color: '#0f172a',
  },
  sectionCount: {
    color: '#64748b',
    fontWeight: 500,
  },
  summaryChip: {
    fontSize: 12,
    fontWeight: 600,
    padding: '5px 12px',
    background: '#eef2ff',
    color: '#4338ca',
    borderRadius: 999,
  },

  emptyLines: {
    padding: '24px 20px',
    background: '#fffbeb',
    border: '1px dashed #fcd34d',
    borderRadius: 10,
    fontSize: 13,
    color: '#92400e',
    textAlign: 'center',
  },
  linesList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  lineCard: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    padding: '14px 16px',
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: 12,
  },
  lineCardFull: {
    background: 'rgba(16, 185, 129, 0.05)',
    borderColor: '#86efac',
  },
  lineCardPartial: {
    background: 'rgba(245, 158, 11, 0.05)',
    borderColor: '#fcd34d',
  },
  lineCardDisabled: {
    background: 'rgba(148, 163, 184, 0.08)',
    opacity: 0.75,
  },
  lineCardPending: {
    background: 'rgba(254, 243, 199, 0.5)',
    borderColor: '#fcd34d',
    borderStyle: 'dashed',
  },
  lineTop: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    minWidth: 0,
  },
  lineCodeRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  lineCode: {
    fontWeight: 700,
    fontSize: 14,
    fontFamily: "'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace",
    color: '#4338ca',
    letterSpacing: '0.02em',
    lineHeight: 1.2,
  },
  pendingLineChip: {
    fontSize: 10,
    fontWeight: 700,
    color: '#92400e',
    background: '#fef3c7',
    padding: '2px 8px',
    borderRadius: 999,
    border: '1px solid #fcd34d',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    whiteSpace: 'nowrap',
  },
  completedLineChip: {
    fontSize: 10,
    fontWeight: 700,
    color: '#065f46',
    background: '#dcfce7',
    padding: '2px 8px',
    borderRadius: 999,
    border: '1px solid #86efac',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    whiteSpace: 'nowrap',
  },
  lineName: {
    fontSize: 12,
    color: '#475569',
    marginTop: 2,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    lineHeight: 1.3,
  },
  lineUomWrap: {
    flexShrink: 0,
  },
  lineMetrics: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: 12,
    paddingTop: 10,
    borderTop: '1px dashed #e5e7eb',
  },
  metric: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  metricLabel: {
    fontSize: 10,
    fontWeight: 700,
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  metricValue: {
    fontSize: 16,
    fontWeight: 700,
    color: '#0f172a',
  },
  lineBottom: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    flexWrap: 'wrap',
  },
  transferQtyLabel: {
    fontSize: 12,
    fontWeight: 700,
    color: '#334155',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  transferQtyInput: {
    width: 120,
    padding: '10px 12px',
    fontSize: 15,
    fontWeight: 700,
    border: '1.5px solid #6366f1',
    borderRadius: 8,
    background: '#fff',
    color: '#0f172a',
    fontFamily: 'inherit',
    textAlign: 'center',
    outline: 'none',
  },
  transferQtyInputDisabled: {
    background: '#f8fafc',
    borderColor: '#cbd5e1',
    color: '#94a3b8',
    cursor: 'not-allowed',
  },
  maxHint: {
    fontSize: 11,
    color: '#64748b',
    fontStyle: 'italic',
  },

  noteBlock: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 8,
    padding: '12px 14px',
    background: '#f8fafc',
    border: '1px solid #e2e8f0',
    borderRadius: 8,
    fontSize: 12,
    color: '#475569',
    lineHeight: 1.5,
  },
  noteIcon: { fontSize: 14, flexShrink: 0 },

  uomTag: {
    display: 'inline-block',
    padding: '3px 9px',
    background: '#f1f5f9',
    color: '#334155',
    borderRadius: 6,
    fontSize: 11,
    fontWeight: 600,
    fontFamily: "'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace",
  },
  partialTag: {
    fontSize: 10,
    color: '#d97706',
    fontWeight: 700,
    marginLeft: 6,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  doneTag: {
    fontSize: 10,
    color: '#475569',
    fontWeight: 700,
    marginLeft: 6,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },

  successWrap: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: 'clamp(20px, 4vw, 40px) 20px',
    textAlign: 'center',
  },
  successIcon: { fontSize: 64, lineHeight: 1, marginBottom: 16 },
  successTitle: {
    margin: 0,
    fontSize: 'clamp(20px, 2.4vw, 26px)',
    fontWeight: 700,
    color: '#0f172a',
    letterSpacing: '-0.01em',
  },
  successSubtitle: {
    margin: '8px 0 24px 0',
    color: '#64748b',
    fontSize: 14,
    maxWidth: 460,
    lineHeight: 1.5,
  },
  successCard: {
    width: '100%',
    maxWidth: 520,
    background: 'linear-gradient(135deg, #f0fdfa 0%, #ecfeff 100%)',
    border: '1.5px solid #99f6e4',
    borderRadius: 14,
    padding: '18px 22px',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  successRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    paddingBottom: 10,
    borderBottom: '1px dashed rgba(0, 138, 130, 0.2)',
  },
  successLabel: {
    fontSize: 12,
    fontWeight: 700,
    color: '#0f766e',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    flexShrink: 0,
  },
  successValue: {
    fontSize: 20,
    fontWeight: 700,
    color: '#008a82',
    fontFamily: "'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace",
    letterSpacing: '0.02em',
  },
  successValueSmall: {
    fontSize: 13,
    fontWeight: 600,
    color: '#0f172a',
    textAlign: 'right',
  },
  successBadge: {
    fontSize: 11,
    fontWeight: 700,
    color: '#92400e',
    background: '#fef3c7',
    padding: '3px 10px',
    borderRadius: 999,
    letterSpacing: '0.05em',
  },
};

const responsiveCss = `
@keyframes tpmFadeIn { from { opacity: 0 } to { opacity: 1 } }
@keyframes tpmSlideUp { from { opacity: 0; transform: translateY(16px) scale(0.98) } to { opacity: 1; transform: translateY(0) scale(1) } }

.tpm-close:hover:not(:disabled) { background: #f1f5f9; color: #0f172a; }
.tpm-close:disabled { opacity: 0.4; cursor: not-allowed; }
.tpm-body::-webkit-scrollbar { width: 8px; }
.tpm-body::-webkit-scrollbar-track { background: #f1f5f9; border-radius: 4px; }
.tpm-body::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 4px; }
.tpm-body::-webkit-scrollbar-thumb:hover { background: #94a3b8; }

@media (max-width: 900px) {
  .tpm-body { padding: 16px; }
  .tpm-footer { padding: 12px 16px; }
}
@media (max-width: 640px) {
  .tpm-head-grid { grid-template-columns: 1fr !important; }
  .tpm-footer button { flex: 1 1 auto; }
  .tpm-line-metrics { grid-template-columns: 1fr 1fr !important; }
}
@media (max-width: 400px) {
  .tpm-overlay { padding: 0; }
  .tpm-card { max-height: 100vh; border-radius: 0; width: 100vw; height: 100vh; }
}
@media (prefers-reduced-motion: reduce) {
  .tpm-card, .tpm-overlay { animation: none !important; }
}
`;

export default TransferPoModal;