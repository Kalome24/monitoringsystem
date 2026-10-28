// src/components/underground/UndergroundSeedImportModal.jsx
//
// Physical-file flow + Online Pickup (Session 15 S3).
//
// TWO MODES:
//   1. ONLINE PICKUP — when the tablet/computer has a stable
//      connection, the handler picks from a list of recent
//      surface exports. No file upload needed. Uses the same
//      POST /shift/open endpoint with seed_export_uid.
//   2. UPLOAD FILE — the original flow. Unchanged. Hash the
//      file, parse lines client-side, POST to open-from-file.
//      This is the offline fallback.
//
// The mode toggle auto-selects based on connectivity, but the
// handler can override at any time. Both modes end in the same
// place: a successfully opened shift.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FiUploadCloud,
  FiX,
  FiLoader,
  FiAlertTriangle,
  FiCheckCircle,
  FiFileText,
  FiTrash2,
  FiInfo,
  FiWifi,
  FiWifiOff,
  FiRefreshCw,
  FiList,
  FiClock,
} from 'react-icons/fi';
import { undergroundApi } from '../../services/api';
import { getUser } from '../../secure/auth';
import { useToast } from '../shared/ToastProvider';
import { hashAndParseSeedFile, formatBytes } from './fileHash';

/* ============================================================
   Formatters — 4-DECIMAL STRICT for money
   ============================================================ */
const intFmt = new Intl.NumberFormat('en-PH');
const curFmt = new Intl.NumberFormat('en-PH', {
  style: 'currency', currency: 'PHP',
  minimumFractionDigits: 4, maximumFractionDigits: 4,
});
const fmtInt = (n) => intFmt.format(Number(n) || 0);
const fmtCur = (n) => curFmt.format(Number(n) || 0);

const fmtDateTime = (v) => {
  if (!v) return '—';
  try {
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' });
  } catch { return '—'; }
};

const fmtRelative = (iso) => {
  if (!iso) return '—';
  try {
    const then = new Date(iso).getTime();
    if (!Number.isFinite(then)) return '—';
    const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
    if (secs < 5)   return 'just now';
    if (secs < 60)  return `${secs}s ago`;
    const mins = Math.round(secs / 60);
    if (mins < 60)  return `${mins}m ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24)   return `${hrs}h ago`;
    return `${Math.round(hrs / 24)}d ago`;
  } catch { return '—'; }
};

/* ============================================================
   Tunables
   ============================================================ */
const ACCEPT =
  '.xlsx,.xls,' +
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,' +
  'application/vnd.ms-excel';

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB

const HEALTH_PING_URL = `${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api/health`;

/* ============================================================
   Component
   ============================================================ */
const UndergroundSeedImportModal = ({ onClose, onSuccess }) => {
  const toast = useToast();
  const currentUser = getUser();
  const warehouseCode = currentUser?.warehouse_code || '';

  /* ---------- Mode ---------- */
  const [mode, setMode] = useState('online');
  const [connChecked, setConnChecked] = useState(false);
  const [connOk, setConnOk] = useState(false);

  /* ---------- Online pickup state ---------- */
  const [seeds, setSeeds]                     = useState([]);
  const [seedsLoading, setSeedsLoading]       = useState(false);
  const [seedsRefreshing, setSeedsRefreshing] = useState(false);
  const [seedsError, setSeedsError]           = useState(null);
  const [selectedSeed, setSelectedSeed]       = useState(null);
  const [showUsed, setShowUsed]               = useState(false);

  /* ---------- File upload state ---------- */
  const fileInputRef = useRef(null);
  const [dragActive, setDragActive] = useState(false);
  const [parsing, setParsing]       = useState(false);
  const [parsed, setParsed]         = useState(null);

  /* ---------- Shared submit ---------- */
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback]     = useState(null);
  const [notes, setNotes]           = useState('');

  const locked = parsing || submitting;

  /* ============================================================
     Health check
     ============================================================ */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(HEALTH_PING_URL, {
          method: 'HEAD', cache: 'no-store',
        });
        if (cancelled) return;
        const ok = res.ok;
        setConnOk(ok);
        setMode(ok ? 'online' : 'file');
      } catch {
        if (cancelled) return;
        setConnOk(false);
        setMode('file');
      } finally {
        if (!cancelled) setConnChecked(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  /* ============================================================
     Fetch available seeds
     ============================================================ */
  const loadSeeds = useCallback(async ({ silent = false } = {}) => {
    if (silent) setSeedsRefreshing(true);
    else setSeedsLoading(true);
    setSeedsError(null);
    try {
      const res = await undergroundApi.availableSeeds({
        days: 7,
        limit: 50,
        show_used: showUsed,
      });
      if (res.ok && Array.isArray(res.data)) {
        setSeeds(res.data);
      } else {
        setSeeds([]);
        setSeedsError(res?.data?.message || 'Could not load available exports.');
      }
    } catch (err) {
      console.error('availableSeeds error:', err);
      setSeeds([]);
      setSeedsError('Could not reach the server.');
    } finally {
      setSeedsLoading(false);
      setSeedsRefreshing(false);
    }
  }, [showUsed]);

  useEffect(() => {
    if (mode !== 'online') return;
    if (!connChecked) return;
    if (!connOk) return;
    loadSeeds();
  }, [mode, connChecked, connOk, loadSeeds]);

  useEffect(() => {
    if (mode === 'online' && connOk && connChecked) {
      loadSeeds({ silent: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showUsed]);

  /* ============================================================
     File upload
     ============================================================ */
  const resetFile = useCallback(() => {
    setParsed(null);
    setFeedback(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const handleFile = useCallback(async (file) => {
    if (!file) return;
    setFeedback(null);
    setParsed(null);

    if (!/\.(xlsx|xls)$/i.test(file.name)) {
      setFeedback({
        type: 'error',
        message: 'Please choose an Excel file (.xlsx or .xls).',
      });
      return;
    }
    if (file.size > MAX_BYTES) {
      setFeedback({
        type: 'error',
        message:
          `File is too large (${formatBytes(file.size)}). ` +
          `Maximum is ${formatBytes(MAX_BYTES)}.`,
      });
      return;
    }

    setParsing(true);
    try {
      const result = await hashAndParseSeedFile(file);

      if (!result.fileHash) {
        setFeedback({
          type: 'error',
          message:
            'Could not compute the file hash. Your browser may not support ' +
            'Web Crypto. Please use a modern browser (Chrome, Edge, Firefox).',
        });
        return;
      }

      if (!result.lines?.length) {
        setFeedback({
          type: 'error',
          message:
            'No item lines found in the file. Is this a valid surface export?',
        });
        return;
      }

      const fileWh = String(result.meta?.warehouse_code || '').trim().toUpperCase();
      const myWh   = String(warehouseCode).trim().toUpperCase();
      if (fileWh && myWh && fileWh !== myWh) {
        setFeedback({
          type: 'error',
          message:
            `This file was exported for warehouse ${fileWh}, not ${myWh}. ` +
            'Please use an export from your own warehouse.',
        });
        return;
      }

      setParsed(result);
    } catch (err) {
      console.error('Parse error:', err);
      setFeedback({
        type: 'error',
        message:
          err?.message ||
          'Failed to parse the file. It may be corrupted or in an unsupported format.',
      });
    } finally {
      setParsing(false);
    }
  }, [warehouseCode]);

  const onDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (locked) return;
    const f = e.dataTransfer?.files?.[0];
    if (f) handleFile(f);
  }, [handleFile, locked]);

  const onDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!locked) setDragActive(true);
  }, [locked]);

  const onDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
  }, []);

  const onPick = (e) => {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
  };

  /* ============================================================
     Submit — branches on mode
     ============================================================ */
  const submitOnline = async () => {
    if (!selectedSeed) {
      setFeedback({ type: 'error', message: 'Please pick a surface export first.' });
      return;
    }
    setSubmitting(true);
    setFeedback(null);
    try {
      const res = await undergroundApi.openShift({
        seed_export_uid: selectedSeed.export_uid,
        notes: notes.trim() || undefined,
      });

      if (res.ok && res.data) {
        const d = res.data;
        const uid = d.seed_export_uid ? ` from ${d.seed_export_uid}` : '';
        toast.success(`Shift opened${uid} · online pickup`);
        onSuccess?.();
      } else {
        setFeedback({
          type: 'error',
          message: res?.data?.message || 'Failed to open shift.',
        });
      }
    } catch (err) {
      console.error('Open shift (online) error:', err);
      setFeedback({
        type: 'error',
        message: err?.message || 'Unexpected error while opening shift.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const submitFile = async () => {
    if (!parsed) {
      setFeedback({ type: 'error', message: 'Please upload a surface export first.' });
      return;
    }
    setSubmitting(true);
    setFeedback(null);
    try {
      const res = await undergroundApi.openShiftFromFile({
        file_hash:       parsed.fileHash,
        filename:        parsed.filename,
        file_size_bytes: parsed.fileSizeBytes,
        notes:           notes.trim() || undefined,
        seed_lines:      parsed.lines,
      });

      if (res.ok && res.data) {
        const d   = res.data;
        const uid = d.seed_export_uid ? ` from ${d.seed_export_uid}` : '';
        const tag = d.verified ? '' : ' · unverified';
        const imp = d.seed_import_uid ? ` · logged as ${d.seed_import_uid}` : '';
        toast.success(`Shift opened${uid}${tag}${imp}`);
        onSuccess?.();
      } else {
        setFeedback({
          type: 'error',
          message: res?.data?.message || 'Failed to open shift.',
        });
      }
    } catch (err) {
      console.error('Open shift error:', err);
      setFeedback({
        type: 'error',
        message: err?.message || 'Unexpected error while opening shift.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = () => (mode === 'online' ? submitOnline() : submitFile());

  const canSubmit = useMemo(() => {
    if (locked) return false;
    if (mode === 'online') return !!selectedSeed;
    return !!parsed;
  }, [mode, locked, selectedSeed, parsed]);

  /* ============================================================
     Preview summary rows (file mode)
     ============================================================ */
  const summaryRows = useMemo(() => {
    if (!parsed) return [];
    return [
      ['Warehouse',   parsed.meta?.warehouse_code || warehouseCode || '—'],
      ['Exported by', parsed.meta?.exported_by || '—'],
      ['Exported at', parsed.meta?.exported_at || '—'],
      ['Locators',    fmtInt(parsed.summary.locator_count)],
      ['Item lines',  fmtInt(parsed.summary.item_row_count)],
      ['Total qty',   fmtInt(parsed.summary.total_qty)],
      ['Total value', fmtCur(parsed.summary.total_value)],
    ];
  }, [parsed, warehouseCode]);

  /* ============================================================
     Render
     ============================================================ */
  return (
    <div className="ugmodal-overlay" onClick={locked ? undefined : onClose}>
      <div
        className="ugmodal-card ugmodal-card--wide"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ---------- Header ---------- */}
        <div className="ugmodal-header">
          <div className="ugmodal-header-left">
            <div className="ugmodal-header-icon"><FiUploadCloud /></div>
            <div style={{ minWidth: 0 }}>
              <h3 className="ugmodal-title">Open Shift from Surface Export</h3>
              <div className="ugmodal-sub">
                {warehouseCode
                  ? `Pick a fresh export from ${warehouseCode}, or upload a file.`
                  : 'No warehouse assigned to your account.'}
              </div>
            </div>
          </div>
          <button
            type="button"
            className="ugmodal-close"
            onClick={onClose}
            disabled={locked}
            aria-label="Close"
          >
            <FiX />
          </button>
        </div>

        {/* ---------- Body ---------- */}
        <div className="ugmodal-body">
          {feedback && (
            <div
              className={`ugmodal-feedback ugmodal-feedback--${
                feedback.type === 'error' ? 'error' : 'info'
              }`}
            >
              <FiAlertTriangle />
              <span>{feedback.message}</span>
            </div>
          )}

          {/* ---------- Mode toggle ---------- */}
          <div className="ugseed-modes" role="tablist" aria-label="Import method">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'online'}
              className={`ugseed-mode ${mode === 'online' ? 'is-active' : ''}`}
              onClick={() => !locked && setMode('online')}
              disabled={locked}
            >
              <FiWifi />
              <div className="ugseed-mode-body">
                <div className="ugseed-mode-title">Online Pickup</div>
                <div className="ugseed-mode-sub">
                  {connOk ? 'Connection ready' : 'No connection'}
                </div>
              </div>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'file'}
              className={`ugseed-mode ${mode === 'file' ? 'is-active' : ''}`}
              onClick={() => !locked && setMode('file')}
              disabled={locked}
            >
              <FiFileText />
              <div className="ugseed-mode-body">
                <div className="ugseed-mode-title">Upload File</div>
                <div className="ugseed-mode-sub">
                  {connOk ? 'Offline fallback' : 'Recommended'}
                </div>
              </div>
            </button>
          </div>

          {/* ---------- Connection strip when checking ---------- */}
          {!connChecked && (
            <div className="ugseed-conn-check">
              <FiLoader className="ug-spin" />
              <span>Checking connection…</span>
            </div>
          )}

          {/* ---------- Warning banner ---------- */}
          {mode === 'online' && (
            <div className="ugmodal-warn">
              <FiAlertTriangle />
              <div>
                Only <strong>exports from {warehouseCode || 'your warehouse'}</strong>{' '}
                can be used as a seed. Picking one opens a new shift with
                that snapshot as the beginning balance.
              </div>
            </div>
          )}
          {mode === 'file' && (
            <div className="ugmodal-warn">
              <FiAlertTriangle />
              <div>
                Only <strong>Excel files exported from {warehouseCode || 'your warehouse'}</strong>{' '}
                may be used as a seed. The uploaded file becomes the beginning
                balance for the new shift.
              </div>
            </div>
          )}

          {/* ============================================================
             ONLINE PICKUP — seed list
             ============================================================ */}
          {mode === 'online' && connChecked && connOk && (
            <>
              <div className="ugseed-list-head">
                <div className="ugseed-list-title">
                  <FiList />
                  <span>Available exports</span>
                  {!seedsLoading && seeds.length > 0 && (
                    <span className="ugseed-list-count">
                      {seeds.length}
                    </span>
                  )}
                </div>
                <div className="ugseed-list-actions">
                  <label className="ugseed-list-toggle">
                    <input
                      type="checkbox"
                      checked={showUsed}
                      onChange={(e) => setShowUsed(e.target.checked)}
                      disabled={locked}
                    />
                    <span>Show used</span>
                  </label>
                  <button
                    type="button"
                    className="ugseed-list-refresh"
                    onClick={() => loadSeeds({ silent: true })}
                    disabled={seedsLoading || seedsRefreshing || locked}
                    title="Refresh list"
                  >
                    <FiRefreshCw className={seedsRefreshing ? 'ug-spin' : ''} />
                  </button>
                </div>
              </div>

              {seedsError && (
                <div className="ugmodal-feedback ugmodal-feedback--error">
                  <FiAlertTriangle />
                  <span>{seedsError}</span>
                </div>
              )}

              {seedsLoading && seeds.length === 0 && (
                <div className="ugseed-list-state">
                  <FiLoader className="ug-spin" />
                  <span>Loading available exports…</span>
                </div>
              )}

              {!seedsLoading && !seedsError && seeds.length === 0 && (
                <div className="ugseed-list-state ugseed-list-state--empty">
                  <FiInfo />
                  <div>
                    <div className="ugseed-list-state-title">
                      No fresh exports available
                    </div>
                    <div className="ugseed-list-state-sub">
                      Ask the surface handler to publish a new export, or
                      upload the file manually using the other tab.
                    </div>
                  </div>
                </div>
              )}

              {seeds.length > 0 && (
                <div className="ugseed-list" role="listbox">
                  {seeds.map((s) => {
                    const isSelected = selectedSeed?.export_id === s.export_id;
                    const isUsed = !!s.already_used;
                    return (
                      <button
                        key={s.export_id}
                        type="button"
                        role="option"
                        aria-selected={isSelected}
                        className={[
                          'ugseed-card',
                          isSelected ? 'is-selected' : '',
                          isUsed ? 'is-used' : '',
                        ].filter(Boolean).join(' ')}
                        onClick={() => !locked && setSelectedSeed(s)}
                        disabled={locked}
                      >
                        <div className="ugseed-card-head">
                          <div className="ugseed-card-uid">{s.export_uid}</div>
                          {isUsed && (
                            <span className="ugseed-card-used">
                              used · shift #{s.used_by_shift_id}
                            </span>
                          )}
                        </div>
                        <div className="ugseed-card-meta">
                          <span title={fmtDateTime(s.exported_at)}>
                            <FiClock />
                            {fmtRelative(s.exported_at)}
                          </span>
                          <span>·</span>
                          <span>{s.exported_by || '—'}</span>
                        </div>
                        <div className="ugseed-card-stats">
                          <span><strong>{fmtInt(s.locator_count)}</strong> locators</span>
                          <span><strong>{fmtInt(s.item_row_count)}</strong> items</span>
                          <span><strong>{fmtInt(s.total_qty)}</strong> qty</span>
                          <span className="ugseed-card-value">
                            {fmtCur(s.total_value)}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {/* ============================================================
             ONLINE PICKUP — no connection
             ============================================================ */}
          {mode === 'online' && connChecked && !connOk && (
            <div className="ugseed-list-state ugseed-list-state--empty">
              <FiWifiOff />
              <div>
                <div className="ugseed-list-state-title">
                  No connection
                </div>
                <div className="ugseed-list-state-sub">
                  Switch to <strong>Upload File</strong> to use the offline
                  fallback. You can always come back to Online Pickup once
                  the connection returns.
                </div>
              </div>
            </div>
          )}

          {/* ============================================================
             FILE UPLOAD — untouched behavior
             ============================================================ */}
          {mode === 'file' && (
            <>
              {!parsed && (
                <div
                  className={`ugseed-dropzone ${dragActive ? 'is-active' : ''} ${locked ? 'is-locked' : ''}`}
                  onClick={() => !locked && fileInputRef.current?.click()}
                  onDrop={onDrop}
                  onDragOver={onDragOver}
                  onDragLeave={onDragLeave}
                  role="button"
                  tabIndex={0}
                  aria-label="Upload surface export file"
                  onKeyDown={(e) => {
                    if ((e.key === 'Enter' || e.key === ' ') && !locked) {
                      e.preventDefault();
                      fileInputRef.current?.click();
                    }
                  }}
                >
                  {parsing ? (
                    <>
                      <FiLoader className="ug-spin ugseed-dropzone-icon" />
                      <div className="ugseed-dropzone-title">Reading file…</div>
                      <div className="ugseed-dropzone-sub">Parsing the workbook</div>
                    </>
                  ) : (
                    <>
                      <FiUploadCloud className="ugseed-dropzone-icon" />
                      <div className="ugseed-dropzone-title">
                        {dragActive
                          ? 'Drop to upload'
                          : 'Drag and drop the Excel file here'}
                      </div>
                      <div className="ugseed-dropzone-sub">
                        or <span className="ugseed-dropzone-link">click to browse</span>
                        {' '}· .xlsx or .xls · up to {formatBytes(MAX_BYTES)}
                      </div>
                    </>
                  )}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={ACCEPT}
                    onChange={onPick}
                    hidden
                    disabled={locked}
                  />
                </div>
              )}

              {parsed && (
                <>
                  <div className="ugseed-file">
                    <div className="ugseed-file-icon"><FiFileText /></div>
                    <div className="ugseed-file-body">
                      <div className="ugseed-file-name" title={parsed.filename}>
                        {parsed.filename}
                      </div>
                      <div className="ugseed-file-meta">
                        {formatBytes(parsed.fileSizeBytes)}
                        {parsed.meta?.exported_by
                          ? ` · by ${parsed.meta.exported_by}`
                          : ''}
                        {parsed.meta?.exported_at
                          ? ` · ${parsed.meta.exported_at}`
                          : ''}
                      </div>
                      <div className="ugseed-hash" title={parsed.fileHash || ''}>
                        SHA-256:{' '}
                        {parsed.fileHash
                          ? `${parsed.fileHash.slice(0, 16)}…${parsed.fileHash.slice(-8)}`
                          : '—'}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="ugseed-file-remove"
                      onClick={resetFile}
                      disabled={locked}
                      aria-label="Remove file"
                    >
                      <FiTrash2 />
                    </button>
                  </div>

                  <div className="ugseed-preview-label">
                    <FiInfo />
                    <span>This file will open a new shift with the following beginning balance:</span>
                  </div>

                  <dl className="ugmodal-summary">
                    {summaryRows.map(([label, value]) => (
                      <React.Fragment key={label}>
                        <dt>{label}</dt>
                        <dd>{value}</dd>
                      </React.Fragment>
                    ))}
                  </dl>
                </>
              )}
            </>
          )}

          {/* ---------- Notes ---------- */}
          {(mode === 'file' ? !!parsed : !!selectedSeed) && (
            <div className="ugmodal-field">
              <label className="ugmodal-label" htmlFor="ugmodal-seed-notes">
                Shift Notes{' '}
                <span style={{ fontWeight: 400, color: '#94a3b8' }}>(optional)</span>
              </label>
              <textarea
                id="ugmodal-seed-notes"
                className="ugmodal-textarea"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Anything worth recording about this shift's opening…"
                disabled={locked}
                maxLength={500}
              />
              <div className="ugmodal-hint">{notes.length} / 500</div>
            </div>
          )}
        </div>

        {/* ---------- Footer ---------- */}
        <div className="ugmodal-footer">
          <button
            type="button"
            className="ug-btn ug-btn--secondary"
            onClick={onClose}
            disabled={locked}
          >
            Cancel
          </button>
          <button
            type="button"
            className="ug-btn ug-btn--primary"
            onClick={handleSubmit}
            disabled={!canSubmit}
          >
            {submitting ? (
              <>
                <FiLoader className="ug-spin" />
                <span>Opening shift…</span>
              </>
            ) : (
              <>
                <FiCheckCircle />
                <span>Open Shift</span>
              </>
            )}
          </button>
        </div>
      </div>

      <style>{seedImportCss}</style>
    </div>
  );
};

export default UndergroundSeedImportModal;

/* ============================================================
   Component-scoped CSS — `ugseed-` prefix.
   Reuses all existing classes; adds mode toggle + list styles.
   ============================================================ */
const seedImportCss = `
/* ---------- Mode toggle ---------- */
.ugseed-modes {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  padding: 6px;
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
}
.ugseed-mode {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 56px;
  padding: 10px 14px;
  border: 1px solid transparent;
  border-radius: 9px;
  background: transparent;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  color: #475569;
  transition: background 0.16s ease, color 0.16s ease, box-shadow 0.16s ease;
  -webkit-tap-highlight-color: transparent;
}
.ugseed-mode > svg {
  width: 20px;
  height: 20px;
  stroke-width: 2.4;
  flex-shrink: 0;
}
.ugseed-mode-body { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.ugseed-mode-title {
  font-size: 13.5px;
  font-weight: 800;
  line-height: 1.2;
}
.ugseed-mode-sub {
  font-size: 11px;
  font-weight: 600;
  color: #94a3b8;
  line-height: 1.2;
}
.ugseed-mode:hover:not(.is-active):not(:disabled) {
  background: rgba(255, 255, 255, 0.6);
  color: #0f172a;
}
.ugseed-mode.is-active {
  background: #ffffff;
  color: #007a72;
  box-shadow:
    0 1px 3px rgba(15, 23, 42, 0.08),
    0 0 0 1px rgba(0, 184, 176, 0.35);
}
.ugseed-mode.is-active .ugseed-mode-sub { color: #0f766e; }
.ugseed-mode:disabled { opacity: 0.55; cursor: not-allowed; }
.ugseed-mode:focus-visible {
  outline: 2px solid #00b8b0;
  outline-offset: 2px;
}

/* ---------- Connection check ---------- */
.ugseed-conn-check {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 14px;
  color: #64748b;
  font-size: 13px;
}

/* ---------- Seed list header ---------- */
.ugseed-list-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
  padding-bottom: 4px;
}
.ugseed-list-title {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 800;
  color: #0f172a;
}
.ugseed-list-title > svg {
  width: 15px;
  height: 15px;
  stroke-width: 2.4;
  color: #0f766e;
}
.ugseed-list-count {
  display: inline-block;
  padding: 2px 9px;
  border-radius: 999px;
  font-size: 10.5px;
  font-weight: 800;
  background: #f0fdfa;
  color: #0f766e;
  border: 1px solid #99f6e4;
}
.ugseed-list-actions {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}
.ugseed-list-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 700;
  color: #475569;
  cursor: pointer;
  user-select: none;
}
.ugseed-list-toggle input { cursor: pointer; }
.ugseed-list-refresh {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border: 1.5px solid #cbd5e1;
  border-radius: 8px;
  background: #ffffff;
  color: #334155;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
}
.ugseed-list-refresh:hover:not(:disabled) {
  background: #f0fdfa;
  border-color: #00b8b0;
  color: #007a72;
}
.ugseed-list-refresh:disabled { opacity: 0.5; cursor: not-allowed; }
.ugseed-list-refresh svg { width: 15px; height: 15px; stroke-width: 2.4; }

/* ---------- Seed list ---------- */
.ugseed-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 380px;
  overflow-y: auto;
  padding-right: 4px;
  margin-top: 4px;
}

.ugseed-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 14px;
  border: 1.5px solid #e2e8f0;
  border-radius: 10px;
  background: #ffffff;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    background 0.15s ease,
    box-shadow 0.15s ease,
    transform 0.12s ease;
  -webkit-tap-highlight-color: transparent;
}
.ugseed-card:hover:not(:disabled) {
  border-color: #00b8b0;
  background: #f0fdfa;
  transform: translateY(-1px);
}
.ugseed-card:focus-visible {
  outline: 2px solid #00b8b0;
  outline-offset: 2px;
}
.ugseed-card.is-selected {
  border-color: #00b8b0;
  background: #ecfeff;
  box-shadow: 0 0 0 3px rgba(0, 184, 176, 0.18);
}
.ugseed-card.is-used {
  opacity: 0.75;
}
.ugseed-card.is-used .ugseed-card-uid {
  color: #94a3b8;
  text-decoration: line-through;
}
.ugseed-card:disabled { opacity: 0.55; cursor: not-allowed; }

.ugseed-card-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.ugseed-card-uid {
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-size: 13px;
  font-weight: 800;
  color: #0f172a;
  letter-spacing: 0.01em;
}
.ugseed-card-used {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 10.5px;
  font-weight: 800;
  letter-spacing: 0.03em;
  background: #f1f5f9;
  color: #64748b;
  border: 1px solid #cbd5e1;
}
.ugseed-card-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
  color: #64748b;
}
.ugseed-card-meta svg {
  width: 11px;
  height: 11px;
  stroke-width: 2.4;
  vertical-align: -1px;
  margin-right: 3px;
}
.ugseed-card-stats {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 12px;
  font-size: 11.5px;
  color: #475569;
}
.ugseed-card-stats strong {
  color: #0f172a;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-weight: 800;
}
.ugseed-card-value {
  margin-left: auto;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-weight: 800;
  color: #047857;
}

/* ---------- Empty / loading / error ---------- */
.ugseed-list-state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 28px 20px;
  border: 1px dashed #cbd5e1;
  border-radius: 10px;
  background: #f8fafc;
  color: #64748b;
  font-size: 13px;
  text-align: center;
}
.ugseed-list-state--empty {
  align-items: flex-start;
  text-align: left;
  justify-content: flex-start;
}
.ugseed-list-state > svg {
  width: 18px;
  height: 18px;
  stroke-width: 2.2;
  flex-shrink: 0;
  margin-top: 2px;
  color: #94a3b8;
}
.ugseed-list-state-title {
  font-size: 13.5px;
  font-weight: 800;
  color: #334155;
  margin-bottom: 3px;
}
.ugseed-list-state-sub {
  font-size: 12px;
  line-height: 1.5;
  color: #64748b;
}

/* ---------- Drop zone (unchanged) ---------- */
.ugseed-dropzone {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 28px 20px;
  border: 2px dashed #cbd5e1;
  border-radius: 12px;
  background: #f8fafc;
  cursor: pointer;
  text-align: center;
  min-height: 160px;
  outline: none;
  transition: border-color 0.18s ease, background 0.18s ease, transform 0.12s ease;
  -webkit-tap-highlight-color: transparent;
}
.ugseed-dropzone:hover:not(.is-locked),
.ugseed-dropzone:focus-visible {
  border-color: #00b8b0;
  background: #f0fdfa;
}
.ugseed-dropzone:focus-visible {
  box-shadow: 0 0 0 4px rgba(0, 184, 176, 0.20);
}
.ugseed-dropzone.is-active {
  border-color: #00b8b0;
  background: #ecfeff;
  transform: scale(1.005);
}
.ugseed-dropzone.is-locked {
  cursor: not-allowed;
  opacity: 0.75;
}
.ugseed-dropzone-icon {
  width: 36px;
  height: 36px;
  color: #00b8b0;
  stroke-width: 1.8;
  flex-shrink: 0;
}
.ugseed-dropzone-title {
  font-size: 14.5px;
  font-weight: 700;
  color: #0f172a;
  line-height: 1.35;
}
.ugseed-dropzone-sub {
  font-size: 12.5px;
  color: #64748b;
  line-height: 1.5;
}
.ugseed-dropzone-link {
  color: #008a82;
  font-weight: 700;
  text-decoration: underline;
  text-underline-offset: 2px;
}

/* ---------- File pill (unchanged) ---------- */
.ugseed-file {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 14px;
  border: 1.5px solid #b8f1ea;
  border-radius: 12px;
  background: #f0fdfa;
}
.ugseed-file-icon {
  width: 38px;
  height: 38px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  background: linear-gradient(135deg, #00e0d4 0%, #008a82 100%);
  color: #ffffff;
  box-shadow: 0 4px 12px rgba(0, 200, 190, 0.28);
}
.ugseed-file-icon svg {
  width: 18px;
  height: 18px;
  stroke-width: 2.2;
}
.ugseed-file-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.ugseed-file-name {
  font-size: 13px;
  font-weight: 700;
  color: #0f172a;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ugseed-file-meta {
  font-size: 11.5px;
  color: #475569;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ugseed-hash {
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-size: 10.5px;
  color: #64748b;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ugseed-file-remove {
  width: 34px;
  height: 34px;
  border-radius: 8px;
  border: 1px solid #fecaca;
  background: #ffffff;
  color: #dc2626;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: background 0.15s ease, border-color 0.15s ease;
}
.ugseed-file-remove:hover:not(:disabled) {
  background: #fef2f2;
  border-color: #dc2626;
}
.ugseed-file-remove:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.ugseed-file-remove svg {
  width: 15px;
  height: 15px;
  stroke-width: 2.4;
}

/* ---------- Preview label (unchanged) ---------- */
.ugseed-preview-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  font-weight: 600;
  color: #475569;
  line-height: 1.5;
}
.ugseed-preview-label svg {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  color: #00b8b0;
}

/* ---------- Responsive ---------- */
@media (max-width: 640px) {
  .ugseed-modes { grid-template-columns: 1fr; }
  .ugseed-mode { min-height: 52px; padding: 10px 12px; }
  .ugseed-mode-title { font-size: 13px; }
  .ugseed-list { max-height: 320px; }
  .ugseed-dropzone {
    padding: 24px 16px;
    min-height: 150px;
  }
  .ugseed-dropzone-title { font-size: 14px; }
  .ugseed-dropzone-sub   { font-size: 12px; }
}

@media (max-width: 480px) {
  .ugseed-mode { min-height: 48px; padding: 8px 10px; gap: 8px; }
  .ugseed-mode > svg { width: 18px; height: 18px; }
  .ugseed-mode-title { font-size: 12.5px; }
  .ugseed-mode-sub { font-size: 10.5px; }
  .ugseed-card { padding: 10px 12px; }
  .ugseed-card-uid { font-size: 12px; }
  .ugseed-card-stats { font-size: 11px; gap: 3px 10px; }
  .ugseed-list-head { gap: 8px; }
  .ugseed-list-actions { width: 100%; justify-content: space-between; }
  .ugseed-dropzone {
    padding: 20px 14px;
    min-height: 140px;
    gap: 6px;
  }
  .ugseed-dropzone-icon  { width: 32px; height: 32px; }
  .ugseed-dropzone-title { font-size: 13.5px; }
  .ugseed-dropzone-sub   { font-size: 11.5px; }
  .ugseed-file { padding: 10px 12px; gap: 10px; }
  .ugseed-file-icon { width: 34px; height: 34px; border-radius: 9px; }
  .ugseed-file-icon svg { width: 16px; height: 16px; }
  .ugseed-file-remove { width: 30px; height: 30px; }
  .ugseed-file-remove svg { width: 14px; height: 14px; }
  .ugseed-hash { font-size: 10px; }
  .ugseed-preview-label { font-size: 11.5px; }
}

@media (max-width: 360px) {
  .ugseed-mode { min-height: 44px; padding: 6px 8px; gap: 6px; }
  .ugseed-mode > svg { width: 16px; height: 16px; }
  .ugseed-mode-title { font-size: 12px; }
  .ugseed-mode-sub { display: none; }
  .ugseed-list-head { flex-direction: column; align-items: flex-start; }
  .ugseed-list-actions { width: 100%; }
  .ugseed-dropzone {
    padding: 16px 12px;
    min-height: 120px;
  }
  .ugseed-dropzone-icon { width: 28px; height: 28px; }
  .ugseed-dropzone-title { font-size: 13px; }
  .ugseed-dropzone-sub   { font-size: 11px; }
  .ugseed-file-name { font-size: 12px; }
  .ugseed-file-meta { font-size: 11px; }
}

@media (max-height: 520px) and (orientation: landscape) {
  .ugseed-dropzone {
    min-height: 110px;
    padding: 14px 16px;
  }
  .ugseed-dropzone-icon { width: 28px; height: 28px; }
  .ugseed-list { max-height: 240px; }
}

@media (min-width: 1921px) {
  .ugseed-modes { gap: 10px; padding: 8px; }
  .ugseed-mode { min-height: 64px; padding: 12px 18px; gap: 12px; }
  .ugseed-mode > svg { width: 24px; height: 24px; }
  .ugseed-mode-title { font-size: 15px; }
  .ugseed-mode-sub { font-size: 12.5px; }
  .ugseed-card { padding: 14px 18px; }
  .ugseed-card-uid { font-size: 14px; }
  .ugseed-card-stats { font-size: 12.5px; }
  .ugseed-dropzone { min-height: 200px; padding: 36px 24px; }
  .ugseed-dropzone-icon { width: 44px; height: 44px; }
  .ugseed-dropzone-title { font-size: 16px; }
  .ugseed-dropzone-sub   { font-size: 13.5px; }
  .ugseed-file { padding: 16px 18px; }
  .ugseed-file-icon { width: 44px; height: 44px; }
  .ugseed-file-icon svg { width: 20px; height: 20px; }
  .ugseed-file-name { font-size: 14.5px; }
  .ugseed-file-meta { font-size: 12.5px; }
}

@media (prefers-reduced-motion: reduce) {
  .ugseed-mode,
  .ugseed-card,
  .ugseed-dropzone,
  .ugseed-file-remove,
  .ugseed-list-refresh {
    transition: none !important;
  }
  .ugseed-dropzone.is-active { transform: none; }
  .ugseed-card:hover:not(:disabled) { transform: none; }
  .ug-spin { animation: none !important; }
}
`;