// src/components/underground/UndergroundReconcileImportModal.jsx
import React, { useCallback, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  FiUploadCloud,
  FiX,
  FiLoader,
  FiAlertTriangle,
  FiCheckCircle,
  FiFileText,
  FiTrash2,
  FiSend,
} from 'react-icons/fi';
import { undergroundApi } from '../../services/api';
import { getUser } from '../../secure/auth';
import { useToast } from '../shared/ToastProvider';
import { hashFileOnly, formatBytes } from './fileHash';

import { emitAppEvent, INV_DATA_CHANGED } from '../../hooks/useRefreshOnFocus';

/* ============================================================
   Formatters — 4-DECIMAL STRICT for money
   ============================================================ */
const intFmt = new Intl.NumberFormat('en-PH');
const curFmt = new Intl.NumberFormat('en-PH', {
  style: 'currency', currency: 'PHP',
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
});
const fmtInt = (n) => intFmt.format(Number(n) || 0);
const fmtCur = (n) => curFmt.format(Number(n) || 0);

/* ============================================================
   Tunables
   ============================================================ */
const ACCEPT =
  '.xlsx,.xls,' +
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,' +
  'application/vnd.ms-excel';

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB

const SUMMARY_SHEET_NAME = 'Summary';
const RELEASE_SHEET_NAME = 'Release Lines';

const STAGE_LABEL = {
  idle:    '',
  reading: 'Reading file…',
  posting: 'Verifying with server…',
};

/* ============================================================
   Silent parser — extracts Line Kind and aggregates totals
   ============================================================ */
const parseCloseFile = async (file) => {
  const buf = await file.arrayBuffer();
  const wb  = XLSX.read(buf, { type: 'array' });

  /* ---------- Summary sheet → safe meta only ---------- */
  let warehouse_code = '';
  const summarySheet = wb.Sheets[SUMMARY_SHEET_NAME];
  if (summarySheet) {
    const rows = XLSX.utils.sheet_to_json(summarySheet, { header: 1, raw: true });
    for (const row of rows) {
      if (!row || row.length < 2) continue;
      const key = String(row[0] || '').trim();
      if (key === 'Warehouse Code') {
        warehouse_code = String(row[1] || '').trim().toUpperCase();
      }
    }
  }

  /* ---------- Release Lines sheet → the lines we need ---------- */
  const releaseSheet = wb.Sheets[RELEASE_SHEET_NAME];
  if (!releaseSheet) {
    throw new Error(
      'The file is missing the "Release Lines" sheet. Is this a valid underground closing file?'
    );
  }

  const rawRows = XLSX.utils.sheet_to_json(releaseSheet, { defval: '', raw: true });
  const lines = [];
  
  // Aggregation buckets
  let issued_qty = 0, issued_value = 0;
  let damaged_qty = 0, damaged_value = 0;
  let trans_out_qty = 0, trans_out_value = 0;
  let trans_in_qty = 0, trans_in_value = 0;

  for (const r of rawRows) {
    const locator = String(r['Storage Locator'] || '').trim();
    if (!locator || locator.toUpperCase() === 'TOTAL') continue;

    const item = String(r['Item Code'] || '').trim();
    if (!item) continue;

    const qty = Number(r['Qty Released']) || 0;
    if (qty <= 0) continue;

    const lineTotal = Number(r['Line Total']) || 0;
    
    // Read the type (Line Kind) from the Excel file
    const rawType = String(r['Type'] || r['Line Kind'] || 'Release').trim();
    let lineKind = 'Release';
    if (rawType === 'Damage') lineKind = 'Damage';
    if (rawType === 'Transfer-Out') lineKind = 'Transfer-Out';
    if (rawType === 'Transfer-In') lineKind = 'Transfer-In';

    // Aggregate based on type
    if (lineKind === 'Release') {
      issued_qty += qty; issued_value += lineTotal;
    } else if (lineKind === 'Damage') {
      damaged_qty += qty; damaged_value += lineTotal;
    } else if (lineKind === 'Transfer-Out') {
      trans_out_qty += qty; trans_out_value += lineTotal;
    } else if (lineKind === 'Transfer-In') {
      trans_in_qty += qty; trans_in_value += lineTotal;
    }

    lines.push({
      locator_code: locator,
      item_code:    item,
      item_name:    String(r['Item Description'] || '') || null,
      uom:          String(r['UOM'] || '') || null,
      qty,
      unit_cost:    Number(r['Unit Cost'])  || 0,
      line_total:   lineTotal,
      destination:  String(r['Destination'] || '') || null,
      remarks:      String(r['Remarks'] || '') || null,
      line_kind:    lineKind,
    });
  }

  const locatorCount = new Set(lines.map((l) => l.locator_code)).size;
  
  // Calculate NET deductions (Issued + Damaged + Transfer-Out - Transfer-In)
  const net_qty = (issued_qty + damaged_qty + trans_out_qty) - trans_in_qty;
  const net_value = (issued_value + damaged_value + trans_out_value) - trans_in_value;

  return {
    warehouse_code,
    lines,
    summary: {
      locator_count: locatorCount,
      item_row_count: lines.length,
      issued_qty, issued_value,
      damaged_qty, damaged_value,
      trans_out_qty, trans_out_value,
      trans_in_qty, trans_in_value,
      net_qty, net_value,
    },
  };
};

/* ============================================================
   Component
   ============================================================ */
const UndergroundReconcileImportModal = ({ onClose, onSuccess }) => {
  const toast = useToast();
  const fileInputRef = useRef(null);
  const currentUser = useMemo(() => getUser(), []);
  const myWarehouseCode = currentUser?.warehouse_code || '';

  const [dragActive, setDragActive] = useState(false);
  const [reading, setReading]       = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback]     = useState(null);
  const [hashed, setHashed]         = useState(null);
  const [notes, setNotes]           = useState('');
  const [done, setDone]             = useState(null);

  const locked = reading || submitting;

  const resetFile = useCallback(() => {
    setHashed(null);
    setFeedback(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const handleFile = useCallback(async (file) => {
    if (!file) return;
    setFeedback(null);
    setHashed(null);

    if (!/\.(xlsx|xls)$/i.test(file.name)) {
      setFeedback({ type: 'error', message: 'Please choose an Excel file (.xlsx or .xls).' });
      return;
    }
    if (file.size > MAX_BYTES) {
      setFeedback({ type: 'error', message: `File is too large (${formatBytes(file.size)}). Maximum is ${formatBytes(MAX_BYTES)}.` });
      return;
    }

    setReading(true);
    try {
      const [hashResult, parseResult] = await Promise.all([
        hashFileOnly(file),
        parseCloseFile(file),
      ]);

      if (!hashResult.fileHash) {
        setFeedback({ type: 'error', message: 'Could not compute the file hash. Your browser may not support Web Crypto.' });
        return;
      }

      const fileWh = String(parseResult.warehouse_code || '').trim().toUpperCase();
      const myWh   = String(myWarehouseCode || '').trim().toUpperCase();
      if (fileWh && myWh && fileWh !== myWh) {
        setFeedback({ type: 'error', message: `This closing file was produced for warehouse ${fileWh}, not ${myWh}.` });
        return;
      }

      setHashed({
        ...hashResult,
        warehouse_code: fileWh || myWh || null,
        lines:          parseResult.lines,
        summary:        parseResult.summary,
      });
    } catch (err) {
      console.error('Parse/hash error:', err);
      setFeedback({ type: 'error', message: err?.message || 'Failed to read the file.' });
    } finally {
      setReading(false);
    }
  }, [myWarehouseCode]);

  const onDrop = useCallback((e) => {
    e.preventDefault(); e.stopPropagation(); setDragActive(false);
    if (locked) return;
    const f = e.dataTransfer?.files?.[0];
    if (f) handleFile(f);
  }, [handleFile, locked]);

  const onDragOver = useCallback((e) => {
    e.preventDefault(); e.stopPropagation();
    if (!locked) setDragActive(true);
  }, [locked]);

  const onDragLeave = useCallback((e) => {
    e.preventDefault(); e.stopPropagation(); setDragActive(false);
  }, []);

  const onPick = (e) => {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
  };

  const handleSubmit = async () => {
    if (!hashed) {
      setFeedback({ type: 'error', message: 'Please upload a closing file first.' });
      return;
    }
    setSubmitting(true);
    setFeedback(null);
    try {
      const res = await undergroundApi.reconcileFromFile({
        file_hash:       hashed.fileHash,
        filename:        hashed.filename,
        file_size_bytes: hashed.fileSizeBytes,
        notes:           notes.trim() || undefined,
        release_lines:   hashed.lines,
        warehouse_code:  hashed.warehouse_code || undefined,
      });

      if (res.ok && res.data) {
        const d = res.data;
        setDone({
          reconciliation_uid: d.reconciliation_uid || null,
          reconciled_lines:   d.reconciled_lines || 0,
          verified_against:   d.verified_against || null,
          filename:           hashed.filename,
          fileHash:           hashed.fileHash,
        });
        toast.success(d.reconciliation_uid ? `Sync recorded · ${d.reconciliation_uid}` : 'Sync recorded.');

        emitAppEvent(INV_DATA_CHANGED, {
          source: 'closing-file-reconcile',
          reconciliation_uid: d.reconciliation_uid || null,
          warehouse_code: hashed.warehouse_code || null,
          reconciled_lines: d.reconciled_lines || 0,
        });
      } else {
        setFeedback({ type: 'error', message: res?.data?.message || 'Failed to reconcile closing file.' });
      }
    } catch (err) {
      console.error('Reconcile-from-file error:', err);
      setFeedback({ type: 'error', message: err?.message || 'Unexpected error while reconciling.' });
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmit = !!hashed && !locked;
  const stageLabel = STAGE_LABEL[reading ? 'reading' : submitting ? 'posting' : 'idle'];

  if (done) {
    const verified = !!done.verified_against;
    return (
      <div className="ugmodal-overlay" onClick={onSuccess}>
        <div className="ugmodal-card" onClick={(e) => e.stopPropagation()}>
          <div className="ugmodal-header">
            <div className="ugmodal-header-left">
              <div className="ugmodal-header-icon" style={{ background: 'linear-gradient(135deg, #34d399 0%, #047857 100%)' }}>
                <FiCheckCircle />
              </div>
              <div style={{ minWidth: 0 }}>
                <h3 className="ugmodal-title">Sync Recorded</h3>
                <div className="ugmodal-sub">Real inventory has been updated.</div>
              </div>
            </div>
            <button type="button" className="ugmodal-close" onClick={onSuccess} aria-label="Close"><FiX /></button>
          </div>
          <div className="ugmodal-body">
            <div className="ugmodal-feedback ugmodal-feedback--info">
              <FiCheckCircle />
              <span>
                {verified ? (
                  <>Verified against closing file <strong>{done.verified_against}</strong>. Every line has been applied to real stock via the movement log.</>
                ) : (
                  <>Every line from the uploaded closing file has been applied to real stock via the movement log.</>
                )}
              </span>
            </div>
            <div className="ugmodal-summary">
              <dt>Lines applied</dt>
              <dd>{fmtInt(done.reconciled_lines)}</dd>
              <dt>Sync Reference</dt>
              <dd style={{ fontFamily: "'JetBrains Mono', monospace" }}>{done.reconciliation_uid || '—'}</dd>
              {verified && (
                <>
                  <dt>Verified against</dt>
                  <dd style={{ fontFamily: "'JetBrains Mono', monospace" }}>{done.verified_against}</dd>
                </>
              )}
              <dt>File</dt>
              <dd style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, wordBreak: 'break-all' }}>{done.filename}</dd>
              <dt>SHA-256</dt>
              <dd style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, wordBreak: 'break-all' }} title={done.fileHash || ''}>
                {done.fileHash ? `${done.fileHash.slice(0, 16)}…${done.fileHash.slice(-8)}` : '—'}
              </dd>
            </div>
          </div>
          <div className="ugmodal-footer">
            <button type="button" className="ug-btn ug-btn--primary" onClick={onSuccess}><span>Done</span></button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="ugmodal-overlay" onClick={locked ? undefined : onClose}>
      <div className="ugmodal-card" onClick={(e) => e.stopPropagation()}>
        <div className="ugmodal-header">
          <div className="ugmodal-header-left">
            <div className="ugmodal-header-icon"><FiSend /></div>
            <div style={{ minWidth: 0 }}>
              <h3 className="ugmodal-title">Import Closing File</h3>
              <div className="ugmodal-sub">Upload the closing Excel file received from the underground handler.</div>
            </div>
          </div>
          <button type="button" className="ugmodal-close" onClick={onClose} disabled={locked} aria-label="Close"><FiX /></button>
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
              This will <strong>apply the closing file's inventory changes</strong> to real stock. The file must be the exact one produced by the underground handler — any edit changes its SHA-256 and the sync will be refused.
            </div>
          </div>

          {!hashed && (
            <div
              className={`ugrec-dropzone ${dragActive ? 'is-active' : ''} ${locked ? 'is-locked' : ''}`}
              onClick={() => !locked && fileInputRef.current?.click()}
              onDrop={onDrop}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              role="button"
              tabIndex={0}
              aria-label="Upload closing file"
              onKeyDown={(e) => {
                if ((e.key === 'Enter' || e.key === ' ') && !locked) {
                  e.preventDefault();
                  fileInputRef.current?.click();
                }
              }}
            >
              {reading ? (
                <>
                  <FiLoader className="ug-spin ugrec-dropzone-icon" />
                  <div className="ugrec-dropzone-title">Reading file…</div>
                  <div className="ugrec-dropzone-sub">Computing SHA-256 · parsing release lines</div>
                </>
              ) : (
                <>
                  <FiUploadCloud className="ugrec-dropzone-icon" />
                  <div className="ugrec-dropzone-title">{dragActive ? 'Drop to upload' : 'Drag and drop the closing file here'}</div>
                  <div className="ugrec-dropzone-sub">
                    or <span className="ugrec-dropzone-link">click to browse</span> · .xlsx or .xls · up to {formatBytes(MAX_BYTES)}
                  </div>
                </>
              )}
              <input ref={fileInputRef} type="file" accept={ACCEPT} onChange={onPick} hidden disabled={locked} />
            </div>
          )}

          {hashed && (
            <>
              <div className="ugrec-file">
                <div className="ugrec-file-icon"><FiFileText /></div>
                <div className="ugrec-file-body">
                  <div className="ugrec-file-name" title={hashed.filename}>{hashed.filename}</div>
                  <div className="ugrec-file-meta">{formatBytes(hashed.fileSizeBytes)} · ready to sync</div>
                  <div className="ugrec-hash" title={hashed.fileHash || ''}>
                    SHA-256: {hashed.fileHash ? `${hashed.fileHash.slice(0, 16)}…${hashed.fileHash.slice(-8)}` : '—'}
                  </div>
                </div>
                <button type="button" className="ugrec-file-remove" onClick={resetFile} disabled={locked} aria-label="Remove file"><FiTrash2 /></button>
              </div>

              <div className="ugrec-preview-label">
                <FiFileText />
                <span>This closing file will apply the following to real stock:</span>
              </div>

              {hashed.summary.item_row_count === 0 ? (
                <div className="ugmodal-warn" style={{ background: '#eff6ff', borderColor: '#bfdbfe', borderLeftColor: '#3b82f6', color: '#1e40af' }}>
                  <FiAlertTriangle style={{ color: '#3b82f6' }} />
                  <div>
                    This closing file contains <strong>no inventory movements</strong>. Recording the sync will mark the shift as reconciled but will not change surface stock.
                  </div>
                </div>
              ) : (
                <div className="ugmodal-summary" style={{ gap: '12px' }}>
                  <dt style={{ gridColumn: '1 / -1', paddingBottom: '4px', borderBottom: '1px dashed #cbd5e1', fontWeight: 800, color: '#64748b' }}>Movement Breakdown</dt>
                  
                  {/* Issued */}
                  <dt className="text-issued">Issued (Out)</dt>
                  <dd className="text-issued">
                    {hashed.summary.issued_qty > 0 ? `-${fmtInt(hashed.summary.issued_qty)}` : '—'}
                  </dd>
                  
                  {/* Damaged */}
                  <dt className="text-damaged">Damaged (Out)</dt>
                  <dd className="text-damaged">
                    {hashed.summary.damaged_qty > 0 ? `-${fmtInt(hashed.summary.damaged_qty)}` : '—'}
                  </dd>

                  {/* Transfer Out */}
                  <dt className="text-transferred">Transferred (Out)</dt>
                  <dd className="text-transferred">
                    {hashed.summary.trans_out_qty > 0 ? `-${fmtInt(hashed.summary.trans_out_qty)}` : '—'}
                  </dd>

                  {/* Transfer In */}
                  <dt className="text-transferred">Transferred (In)</dt>
                  <dd className="text-transferred">
                    {hashed.summary.trans_in_qty > 0 ? `+${fmtInt(hashed.summary.trans_in_qty)}` : '—'}
                  </dd>

                  <dt style={{ gridColumn: '1 / -1', borderTop: '1px solid #cbd5e1', margin: '4px 0' }}></dt>
                  
                  {/* Net Deductions */}
                  <dt style={{ fontWeight: 800, color: '#0f172a', fontSize: 14 }}>Net Deducted Qty</dt>
                  <dd style={{ fontWeight: 800, color: '#0f172a', fontSize: 14 }}>
                    {fmtInt(hashed.summary.net_qty)}
                  </dd>
                  
                  <dt style={{ fontWeight: 800, color: '#0f172a', fontSize: 14 }}>Net Deducted Value</dt>
                  <dd style={{ fontWeight: 800, color: '#dc2626', fontSize: 15 }}>
                    {fmtCur(hashed.summary.net_value)}
                  </dd>
                  
                  <dt style={{ gridColumn: '1 / -1', borderTop: '1px solid #cbd5e1', margin: '4px 0' }}></dt>

                  {/* Meta info */}
                  <dt>Warehouse</dt>
                  <dd>{hashed.warehouse_code || myWarehouseCode || '—'}</dd>
                  <dt>Affected Locators</dt>
                  <dd>{fmtInt(hashed.summary.locator_count)}</dd>
                  <dt>Total Line Items</dt>
                  <dd>{fmtInt(hashed.summary.item_row_count)}</dd>
                </div>
              )}
            </>
          )}

          <div className="ugmodal-field">
            <label className="ugmodal-label" htmlFor="ug-recon-import-notes">
              Notes <span style={{ fontWeight: 400, color: '#94a3b8' }}>(optional)</span>
            </label>
            <textarea
              id="ug-recon-import-notes"
              className="ugmodal-textarea"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any remark worth recording for the audit trail…"
              disabled={locked}
              maxLength={500}
            />
            <div className="ugmodal-hint">{notes.length} / 500</div>
          </div>
        </div>

        <div className="ugmodal-footer">
          <button type="button" className="ug-btn ug-btn--secondary" onClick={onClose} disabled={locked}>Cancel</button>
          <button type="button" className="ug-btn ug-btn--primary" onClick={handleSubmit} disabled={!canSubmit}>
            {submitting ? (
              <>
                <FiLoader className="ug-spin" />
                <span>{stageLabel || 'Recording sync…'}</span>
              </>
            ) : (
              <>
                <FiSend />
                <span>Record Sync</span>
              </>
            )}
          </button>
        </div>
      </div>

      <style>{reconcileImportCss}</style>
    </div>
  );
};

const reconcileImportCss = `
.text-issued { color: #16a34a !important; font-weight: 700; }
.text-damaged { color: #dc2626 !important; font-weight: 700; }
.text-transferred { color: #2563eb !important; font-weight: 700; }

.ugrec-dropzone {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 8px; padding: 28px 20px; border: 2px dashed #cbd5e1; border-radius: 12px;
  background: #f8fafc; cursor: pointer; text-align: center; min-height: 160px;
  outline: none; transition: border-color 0.18s ease, background 0.18s ease, transform 0.12s ease;
  -webkit-tap-highlight-color: transparent;
}
.ugrec-dropzone:hover:not(.is-locked), .ugrec-dropzone:focus-visible { border-color: #00b8b0; background: #f0fdfa; }
.ugrec-dropzone:focus-visible { box-shadow: 0 0 0 4px rgba(0, 184, 176, 0.20); }
.ugrec-dropzone.is-active { border-color: #00b8b0; background: #ecfeff; transform: scale(1.005); }
.ugrec-dropzone.is-locked { cursor: not-allowed; opacity: 0.75; }
.ugrec-dropzone-icon { width: 36px; height: 36px; color: #00b8b0; stroke-width: 1.8; flex-shrink: 0; }
.ugrec-dropzone-title { font-size: 14.5px; font-weight: 700; color: #0f172a; line-height: 1.35; }
.ugrec-dropzone-sub { font-size: 12.5px; color: #64748b; line-height: 1.5; }
.ugrec-dropzone-link { color: #008a82; font-weight: 700; text-decoration: underline; text-underline-offset: 2px; }
.ugrec-file { display: flex; align-items: flex-start; gap: 12px; padding: 12px 14px; border: 1.5px solid #b8f1ea; border-radius: 12px; background: #f0fdfa; }
.ugrec-file-icon { width: 38px; height: 38px; border-radius: 10px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; background: linear-gradient(135deg, #00e0d4 0%, #008a82 100%); color: #ffffff; box-shadow: 0 4px 12px rgba(0, 200, 190, 0.28); }
.ugrec-file-icon svg { width: 18px; height: 18px; stroke-width: 2.2; }
.ugrec-file-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.ugrec-file-name { font-size: 13px; font-weight: 700; color: #0f172a; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ugrec-file-meta { font-size: 11.5px; color: #475569; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ugrec-hash { font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace; font-size: 10.5px; color: #64748b; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ugrec-file-remove { width: 34px; height: 34px; border-radius: 8px; border: 1px solid #fecaca; background: #ffffff; color: #dc2626; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; transition: background 0.15s ease, border-color 0.15s ease; }
.ugrec-file-remove:hover:not(:disabled) { background: #fef2f2; border-color: #dc2626; }
.ugrec-file-remove:disabled { opacity: 0.5; cursor: not-allowed; }
.ugrec-file-remove svg { width: 15px; height: 15px; stroke-width: 2.4; }
.ugrec-preview-label { display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 600; color: #475569; line-height: 1.5; }
.ugrec-preview-label svg { width: 14px; height: 14px; flex-shrink: 0; color: #00b8b0; }
@media (max-width: 640px) {
  .ugrec-dropzone { padding: 24px 16px; min-height: 150px; }
  .ugrec-dropzone-title { font-size: 14px; }
  .ugrec-dropzone-sub   { font-size: 12px; }
}
@media (max-width: 480px) {
  .ugrec-dropzone { padding: 20px 14px; min-height: 140px; gap: 6px; }
  .ugrec-dropzone-icon  { width: 32px; height: 32px; }
  .ugrec-dropzone-title { font-size: 13.5px; }
  .ugrec-dropzone-sub   { font-size: 11.5px; }
  .ugrec-file { padding: 10px 12px; gap: 10px; }
  .ugrec-file-icon { width: 34px; height: 34px; border-radius: 9px; }
  .ugrec-file-icon svg { width: 16px; height: 16px; }
  .ugrec-file-remove { width: 30px; height: 30px; }
  .ugrec-file-remove svg { width: 14px; height: 14px; }
  .ugrec-hash { font-size: 10px; }
  .ugrec-preview-label { font-size: 11.5px; }
}
@media (max-width: 360px) {
  .ugrec-dropzone { padding: 16px 12px; min-height: 120px; }
  .ugrec-dropzone-icon  { width: 28px; height: 28px; }
  .ugrec-dropzone-title { font-size: 13px; }
  .ugrec-dropzone-sub   { font-size: 11px; }
  .ugrec-file-name { font-size: 12px; }
  .ugrec-file-meta { font-size: 11px; }
}
@media (max-height: 520px) and (orientation: landscape) {
  .ugrec-dropzone { min-height: 110px; padding: 14px 16px; }
  .ugrec-dropzone-icon { width: 28px; height: 28px; }
}
@media (min-width: 1921px) {
  .ugrec-dropzone { min-height: 200px; padding: 36px 24px; }
  .ugrec-dropzone-icon { width: 44px; height: 44px; }
  .ugrec-dropzone-title { font-size: 16px; }
  .ugrec-dropzone-sub   { font-size: 13.5px; }
  .ugrec-file { padding: 16px 18px; }
  .ugrec-file-icon { width: 44px; height: 44px; }
  .ugrec-file-icon svg { width: 20px; height: 20px; }
  .ugrec-file-name { font-size: 14.5px; }
  .ugrec-file-meta { font-size: 12.5px; }
}
@media (prefers-reduced-motion: reduce) {
  .ugrec-dropzone, .ugrec-file-remove { transition: none !important; }
  .ugrec-dropzone.is-active { transform: none; }
}
`;

export default UndergroundReconcileImportModal;