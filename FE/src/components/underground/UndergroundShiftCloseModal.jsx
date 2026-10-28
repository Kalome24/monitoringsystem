// src/components/underground/UndergroundShiftCloseModal.jsx
import React, { useMemo, useState } from 'react';
import {
  FiLock,
  FiX,
  FiLoader,
  FiAlertTriangle,
  FiCheckCircle,
  FiDownload,
  FiFolder,
} from 'react-icons/fi';
import { undergroundApi } from '../../services/api';
import { useToast } from '../shared/ToastProvider';
import {
  buildShiftCloseFile,
  triggerDownload,
  XLSX_MIME,
} from './shiftCloseExport';

/* ============================================================
   Formatters (STRICT 4-DECIMAL for money)
   ============================================================ */
const intFmt = new Intl.NumberFormat('en-PH');
const curFmt = new Intl.NumberFormat('en-PH', {
  style: 'currency', currency: 'PHP',
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});
const fmtInt = (n) => intFmt.format(Number(n) || 0);
const fmtCur = (n) => curFmt.format(Number(n) || 0);

/* ============================================================
   Phase labels
   ============================================================ */
const STAGE_LABEL = {
  idle:     '',
  fetching: 'Preparing closing file…',
  building: 'Building Excel…',
  posting:  'Recording close…',
};

const UndergroundShiftCloseModal = ({ shift, onClose, onSuccess }) => {
  const toast = useToast();

  const [notes, setNotes]           = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [stage, setStage]           = useState('idle');
  const [feedback, setFeedback]     = useState(null);
  const [closed, setClosed]         = useState(null);

  /* ---------- Totals from the shift prop ---------- */
  const begQty = Number(shift?.beginning_qty) || 0;
  const outQty = Number(shift?.released_qty)  || 0;
  const inQty  = Number(shift?.trans_in_qty)  || 0;
  const endQty = useMemo(
    () => Number((begQty - outQty + inQty).toFixed(4)),
    [begQty, outQty, inQty]
  );
  
  const begVal = Number(shift?.beginning_value) || 0;
  const outVal = Number(shift?.released_value)  || 0;
  const inVal  = Number(shift?.trans_in_value)  || 0;
  const endVal = useMemo(
    () => Number((begVal - outVal + inVal).toFixed(4)),
    [begVal, outVal, inVal]
  );

  const handleSubmit = async () => {
    setFeedback(null);
    setSubmitting(true);
    setStage('fetching');

    try {
      const payloadRes = await undergroundApi.getClosePayload(shift.shift_id);
      if (!payloadRes.ok || !payloadRes.data) {
        throw new Error(payloadRes?.data?.message || 'Failed to prepare the closing file.');
      }

      setStage('building');
      const file = await buildShiftCloseFile(payloadRes.data);

      if (!file.fileHash) {
        throw new Error(
          'Could not compute the file hash. Your browser may not support ' +
          'Web Crypto. Please use a modern browser (Chrome, Edge, Firefox).'
        );
      }

      setStage('posting');
      const closeRes = await undergroundApi.closeShift(shift.shift_id, {
        filename:        file.filename,
        file_hash:       file.fileHash,
        file_size_bytes: file.fileSizeBytes,
        notes:           notes.trim() || undefined,
      });

      if (!closeRes.ok || !closeRes.data) {
        throw new Error(closeRes?.data?.message || 'Failed to close shift.');
      }

      triggerDownload(file.arrayBuffer, XLSX_MIME, file.filename);

      setClosed({
        uid:           closeRes.data.closing_export_uid || null,
        filename:      file.filename,
        fileHash:      file.fileHash,
        fileSizeBytes: file.fileSizeBytes,
        arrayBuffer:   file.arrayBuffer,
      });
      setStage('done');

      toast.success(
        closeRes.data.closing_export_uid
          ? `Shift closed · ${closeRes.data.closing_export_uid} · file downloaded`
          : 'Shift closed · file downloaded'
      );
    } catch (err) {
      console.error('Close shift error:', err);
      setFeedback({
        type: 'error',
        message: err?.message || 'Unexpected error while closing shift.',
      });
      setStage('idle');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDownloadAgain = () => {
    if (!closed?.arrayBuffer) return;
    triggerDownload(closed.arrayBuffer, XLSX_MIME, closed.filename);
    toast.info('File downloaded again.');
  };

  if (closed) {
    return (
      <div className="ugmodal-overlay" onClick={onSuccess}>
        <div className="ugmodal-card" onClick={(e) => e.stopPropagation()}>
          <div className="ugmodal-header">
            <div className="ugmodal-header-left">
              <div
                className="ugmodal-header-icon"
                style={{
                  background: 'linear-gradient(135deg, #34d399 0%, #047857 100%)',
                }}
              >
                <FiCheckCircle />
              </div>
              <div style={{ minWidth: 0 }}>
                <h3 className="ugmodal-title">Shift Closed</h3>
                <div className="ugmodal-sub">
                  Deliver this file to the surface handler for reconciliation.
                </div>
              </div>
            </div>
            <button type="button" className="ugmodal-close" onClick={onSuccess} aria-label="Close">
              <FiX />
            </button>
          </div>

          <div className="ugmodal-body">
            <div className="ugmodal-feedback ugmodal-feedback--info">
              <FiDownload />
              <span>
                <strong>{closed.filename}</strong> has been saved to your
                downloads folder. Hand this file to the surface handler — they
                will upload it to reconcile.
              </span>
            </div>

            <div className="ugmodal-summary">
              <dt>Closing Export UID</dt>
              <dd style={{ fontFamily: "'JetBrains Mono', monospace" }}>{closed.uid || '—'}</dd>

              <dt>File</dt>
              <dd style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}>{closed.filename}</dd>

              <dt>SHA-256</dt>
              <dd style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, wordBreak: 'break-all' }} title={closed.fileHash || ''}>
                {closed.fileHash ? `${closed.fileHash.slice(0, 16)}…${closed.fileHash.slice(-8)}` : '—'}
              </dd>

              <dt>Total Out Qty</dt>
              <dd className="text-issued">-{fmtInt(outQty)}</dd>

              <dt>Total Out Value</dt>
              <dd className="text-issued">-{fmtCur(outVal)}</dd>

              {inQty > 0 && (
                <>
                  <dt>Transferred In Qty</dt>
                  <dd className="text-transferred">+{fmtInt(inQty)}</dd>
                  <dt>Transferred In Value</dt>
                  <dd className="text-transferred">+{fmtCur(inVal)}</dd>
                </>
              )}

              <dt style={{ borderTop: '1px solid #cbd5e1', paddingTop: 8, marginTop: 4 }}>Ending qty</dt>
              <dd style={{ borderTop: '1px solid #cbd5e1', paddingTop: 8, marginTop: 4 }}>{fmtInt(endQty)}</dd>

              <dt>Ending value</dt>
              <dd>{fmtCur(endVal)}</dd>
            </div>

            <div className="ugmodal-warn">
              <FiAlertTriangle />
              <div>
                The file must be delivered <strong>unmodified</strong> — the
                surface handler's reconciliation verifies its SHA-256 hash. If
                the hash doesn't match, they will not be able to reconcile.
              </div>
            </div>
          </div>

          <div className="ugmodal-footer">
            <button type="button" className="ug-btn ug-btn--secondary" onClick={handleDownloadAgain}>
              <FiFolder /> <span>Download again</span>
            </button>
            <button type="button" className="ug-btn ug-btn--primary" onClick={onSuccess}>
              <span>Done</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  const stageLabel = STAGE_LABEL[stage] || '';

  return (
    <div className="ugmodal-overlay" onClick={submitting ? undefined : onClose}>
      <div className="ugmodal-card" onClick={(e) => e.stopPropagation()}>
        <div className="ugmodal-header">
          <div className="ugmodal-header-left">
            <div
              className="ugmodal-header-icon"
              style={{
                background: 'linear-gradient(135deg, #f87171 0%, #b91c1c 100%)',
              }}
            >
              <FiLock />
            </div>
            <div style={{ minWidth: 0 }}>
              <h3 className="ugmodal-title">End Shift</h3>
              <div className="ugmodal-sub">
                Shift #{shift.shift_id} · {shift.warehouse_code}
              </div>
            </div>
          </div>
          <button type="button" className="ugmodal-close" onClick={onClose} disabled={submitting} aria-label="Close">
            <FiX />
          </button>
        </div>

        <div className="ugmodal-body">
          {feedback && (
            <div className="ugmodal-feedback ugmodal-feedback--error">
              <FiAlertTriangle />
              <span>{feedback.message}</span>
            </div>
          )}

          <div className="ugmodal-warn">
            <FiAlertTriangle />
            <div>
              <strong>This action cannot be undone.</strong> The shift will be
              frozen, totals recorded, and a closing Excel file downloaded. Hand
              the file to the surface handler for reconciliation.
            </div>
          </div>

          <div className="ugmodal-summary">
            <dt>Beginning qty</dt>
            <dd>{fmtInt(begQty)}</dd>

            <dt>Issued / Damaged / Transferred Out</dt>
            <dd className="text-issued">-{fmtInt(outQty)}</dd>

            {inQty > 0 && (
              <>
                <dt>Transferred In</dt>
                <dd className="text-transferred">+{fmtInt(inQty)}</dd>
              </>
            )}

            <dt>Ending qty</dt>
            <dd>{fmtInt(endQty)}</dd>

            <dt>Beginning value</dt>
            <dd>{fmtCur(begVal)}</dd>

            <dt>Deducted value (Out)</dt>
            <dd className="text-issued">-{fmtCur(outVal)}</dd>

            {inVal > 0 && (
              <>
                <dt>Added value (In)</dt>
                <dd className="text-transferred">+{fmtCur(inVal)}</dd>
              </>
            )}

            <dt>Ending value</dt>
            <dd>{fmtCur(endVal)}</dd>
          </div>

          <div className="ugmodal-field">
            <label className="ugmodal-label" htmlFor="ug-close-notes">
              Closing Notes{' '}
              <span style={{ fontWeight: 400, color: '#94a3b8' }}>(optional)</span>
            </label>
            <textarea
              id="ug-close-notes"
              className="ugmodal-textarea"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any closing remarks for the audit trail…"
              disabled={submitting}
              maxLength={500}
            />
            <div className="ugmodal-hint">{notes.length} / 500</div>
          </div>
        </div>

        <div className="ugmodal-footer">
          <button type="button" className="ug-btn ug-btn--secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button type="button" className="ug-btn ug-btn--danger" onClick={handleSubmit} disabled={submitting}>
            {submitting ? (
              <>
                <FiLoader className="ug-spin" />
                <span>{stageLabel || 'Closing…'}</span>
              </>
            ) : (
              <>
                <FiLock />
                <span>End Shift &amp; Export</span>
              </>
            )}
          </button>
        </div>
      </div>
      <style>{`
        .text-issued { color: #16a34a !important; font-weight: 700; }
        .text-damaged { color: #dc2626 !important; font-weight: 700; }
        .text-transferred { color: #2563eb !important; font-weight: 700; }
      `}</style>
    </div>
  );
};

export default UndergroundShiftCloseModal;