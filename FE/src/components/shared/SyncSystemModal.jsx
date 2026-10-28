// src/components/shared/SyncSystemModal.jsx
//
// System Sync modal — used by both Surface Admins and Underground
// Handlers.
//
// Session 17 — Online Sync is now LIVE (was "Coming Soon"):
//   • Underground Handler → real "Pull Configuration Now" button.
//     Calls backend → backend calls surface over HTTP → payload
//     applied to local DB → success card + history refresh.
//   • Surface Handler     → informational "You are the source of
//     truth" card (no button; the surface produces, peers consume).
//
// Role-appropriate default tab:
//   • Underground → lands on "Online Sync" (their primary action)
//   • Surface     → lands on "Manual Sync" (they still produce files)
//
// All errors/confirms render INSIDE the modal (no window.confirm,
// no top-of-browser toasts for import/pull flows).

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  FiX, FiCloud, FiFileText, FiDownload, FiUpload,
  FiAlertCircle, FiAlertTriangle, FiCheckCircle, FiInfo,
  FiLoader, FiClock, FiServer, FiChevronDown, FiChevronUp,
  FiRefreshCw, FiWifi, FiWifiOff,
} from 'react-icons/fi';
import { offlineConfigApi } from '../../services/api';
import { getUser } from '../../secure/auth';
import { useToast } from '../shared/ToastProvider';

/* ============================================================
   Helpers
   ============================================================ */
const isUndergroundPosition = (user) =>
  String(user?.emp_position || '').trim().toLowerCase() === 'underground handler';

const buildCountSummary = (payload) => {
  const c = Array.isArray(payload?.configs)     ? payload.configs.length     : 0;
  const s = Array.isArray(payload?.signatures)  ? payload.signatures.length  : 0;
  const i = Array.isArray(payload?.item_master) ? payload.item_master.length : 0;
  const l = Array.isArray(payload?.locators)    ? payload.locators.length    : 0;
  return { configs: c, signatures: s, items: i, locators: l, total: c + s + i + l };
};

const computeSha256Hex = async (file) => {
  try {
    if (typeof crypto === 'undefined' || !crypto.subtle?.digest) return null;
    const buf = await file.arrayBuffer();
    const hashBuf = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(hashBuf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  } catch {
    return null;
  }
};

/**
 * Normalize any supported export file shape into the canonical
 * payload the backend expects. Handles legacy wrapper format.
 */
const unwrapPayload = (raw) => {
  if (!raw || typeof raw !== 'object') return null;

  const candidates = [
    raw,
    raw.data,
    raw.data?.data,
    raw.payload,
    raw.body,
  ];

  for (const c of candidates) {
    if (c && typeof c === 'object' && Array.isArray(c.configs)) {
      return c;
    }
  }

  return null;
};

/* ============================================================
   Component
   ============================================================ */
const SyncSystemModal = ({ onClose }) => {
  const toast = useToast();
  const currentUser = getUser();
  const isUnderground = isUndergroundPosition(currentUser);
  const canExport = !isUnderground;

  // Role-appropriate default tab — underground users land on
  // Online Sync (their primary action); surface users land on
  // Manual Sync (they produce the file).
  const [activeTab, setActiveTab] = useState(isUnderground ? 'online' : 'manual');
  const [loading, setLoading] = useState(false);
  const [progressLabel, setProgressLabel] = useState(null);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const fileInputRef = useRef(null);

  // ---- Import flow state ----
  const [pendingImport, setPendingImport]   = useState(null);
  const [importError, setImportError]       = useState(null);
  const [importSuccess, setImportSuccess]   = useState(null);

  // ---- Online pull state ----
  const [syncStatus, setSyncStatus]               = useState({
    enabled: false, surfaceBaseUrl: null, serverId: null, warehouseCode: null,
  });
  const [syncStatusLoading, setSyncStatusLoading] = useState(true);
  const [pendingOnlinePull, setPendingOnlinePull] = useState(false);
  const [onlineError, setOnlineError]             = useState(null);
  const [onlineSuccess, setOnlineSuccess]         = useState(null);
  const [onlinePulling, setOnlinePulling]         = useState(false);

  /* ---------- Load sync history ---------- */
  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const res = await offlineConfigApi.getHistory(50);
      if (res.ok) {
        setHistory(Array.isArray(res.data) ? res.data : []);
      } else {
        setHistory([]);
      }
    } catch (err) {
      console.warn('Failed to load sync history', err);
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  /* ---------- Load sync status (Online Sync availability) ---------- */
  const loadSyncStatus = useCallback(async () => {
    setSyncStatusLoading(true);
    try {
      const res = await offlineConfigApi.syncStatus();
      if (res.ok && res.data) {
        setSyncStatus(res.data);
      } else {
        setSyncStatus({ enabled: false, surfaceBaseUrl: null, serverId: null, warehouseCode: null });
      }
    } catch (err) {
      console.warn('Failed to load sync status', err);
      setSyncStatus({ enabled: false, surfaceBaseUrl: null, serverId: null, warehouseCode: null });
    } finally {
      setSyncStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHistory();
    loadSyncStatus();
  }, [loadHistory, loadSyncStatus]);

  /* ---------- Export (surface only) ---------- */
  const handleExport = async () => {
    if (!canExport || loading) return;

    setLoading(true);
    setProgressLabel('Preparing export...');

    try {
      const res = await offlineConfigApi.exportSync();
      if (!res.ok || !res.data) {
        throw new Error(res?.data?.error || res?.data?.message || 'Export failed.');
      }

      const payload = res.data;
      const fileName = res.meta?.fileName || `offline-config-${Date.now()}.json`;

      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 4000);

      const counts = buildCountSummary(payload);
      toast.success(
        `Exported ${fileName} · ${counts.configs} config · ${counts.signatures} signatories · ${counts.items} items · ${counts.locators} locators`
      );
      loadHistory();
    } catch (err) {
      console.error('Export error:', err);
      toast.error(err.message || 'Export failed.');
    } finally {
      setLoading(false);
      setProgressLabel(null);
    }
  };

  /* ---------- Import: parse file → confirm ---------- */
  const handleImportClick = () => {
    if (loading) return;
    fileInputRef.current?.click();
  };

  const handleImportFile = async (e) => {
    const file = e.target.files?.[0];
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (!file) return;

    setImportError(null);
    setImportSuccess(null);
    setProgressLabel(`Reading ${file.name}...`);
    setLoading(true);

    try {
      const text = await file.text();

      let raw;
      try {
        raw = JSON.parse(text);
      } catch {
        throw new Error('File is not valid JSON. It may be corrupted.');
      }

      const payload = unwrapPayload(raw);
      if (!payload) {
        const keys = raw && typeof raw === 'object'
          ? Object.keys(raw).slice(0, 8).join(', ')
          : '(not an object)';
        throw new Error(
          `This file does not contain an Offline Configuration export. ` +
          `Expected a "configs" array at the top level (or inside a "data" ` +
          `wrapper from older exports). Found top-level keys: ${keys || '(none)'}.`
        );
      }

      if (!Array.isArray(payload.configs)) {
        throw new Error('This file is missing the "configs" array.');
      }
      if (!Array.isArray(payload.signatures)) {
        throw new Error(
          'This file is missing the "signatures" array. Importing without ' +
          'signatures would clear all Authorized By records.'
        );
      }

      const counts = buildCountSummary(payload);

      setPendingImport({
        file,
        payload,
        counts,
        fileName: file.name,
      });
    } catch (err) {
      setImportError({
        title:   'Invalid file',
        message: err.message || 'The file could not be read.',
        hint:    null,
        step:    null,
        code:    null,
      });
    } finally {
      setLoading(false);
      setProgressLabel(null);
    }
  };

  /* ---------- Import: confirm → backend call ---------- */
  const handleConfirmImport = async () => {
    if (!pendingImport) return;

    const { file, payload, fileName, counts } = pendingImport;
    setLoading(true);
    setProgressLabel(`Applying ${fileName}...`);

    try {
      const fileHash = await computeSha256Hex(file);

      const res = await offlineConfigApi.importSync({
        payload,
        fileName,
        fileHash,
      });

      if (!res.ok) {
        const errorData = res?.data || {};
        setImportError({
          title:   errorData.message || 'Import failed',
          message: errorData.error   || 'The server rejected the file.',
          hint:    errorData.hint    || null,
          step:    errorData.step    || null,
          code:    errorData.code    || null,
        });
        setPendingImport(null);
        return;
      }

      setImportSuccess(
        `Applied · ${counts.configs} config · ${counts.signatures} signatories · ${counts.items} items · ${counts.locators} locators`
      );
      setPendingImport(null);
      loadHistory();
    } catch (err) {
      setImportError({
        title:   'Network error',
        message: err.message || 'Could not reach the server.',
        hint:    'Check the underground server is running and reachable from this device.',
        step:    null,
        code:    null,
      });
      setPendingImport(null);
    } finally {
      setLoading(false);
      setProgressLabel(null);
    }
  };

  const handleCancelImport = () => {
    if (loading) return;
    setPendingImport(null);
  };

  /* ---------- Online pull: click → confirm → backend call ---------- */
  const handleOnlinePullClick = () => {
    if (onlinePulling || !syncStatus.enabled) return;
    setOnlineError(null);
    setOnlineSuccess(null);
    setPendingOnlinePull(true);
  };

  const handleConfirmOnlinePull = async () => {
    if (!pendingOnlinePull) return;

    setPendingOnlinePull(false);
    setOnlinePulling(true);
    setLoading(true);
    setProgressLabel('Pulling from surface…');

    try {
      const res = await offlineConfigApi.pullFromSurface();

      if (!res.ok) {
        const errorData = res?.data || {};
        setOnlineError({
          title:   errorData.message || 'Pull failed',
          message: errorData.error   || 'The surface server rejected the request.',
          hint:    errorData.hint    || null,
          code:    errorData.code    || null,
        });
        return;
      }

      const d = res.data?.data || {};
      setOnlineSuccess(
        `Pulled from surface · ${d.configs || 0} config · ${d.signatures || 0} signatories · ${d.items || 0} items · ${d.locators || 0} locators`
      );
      loadHistory();
    } catch (err) {
      setOnlineError({
        title:   'Network error',
        message: err.message || 'Could not reach the surface server.',
        hint:    'Check that this device can reach the surface over the network.',
        code:    null,
      });
    } finally {
      setOnlinePulling(false);
      setLoading(false);
      setProgressLabel(null);
    }
  };

  const handleCancelOnlinePull = () => {
    if (loading) return;
    setPendingOnlinePull(false);
  };

  /* ============================================================
     Render
     ============================================================ */
  return (
    <div className="ssm-overlay" onClick={loading ? undefined : onClose}>
      <div className="ssm-card" onClick={(e) => e.stopPropagation()}>
        <style>{css}</style>

        {/* ---------- Header ---------- */}
        <div className="ssm-header">
          <div className="ssm-header-left">
            <div className="ssm-icon"><FiServer /></div>
            <div>
              <h3 className="ssm-title">
                {isUnderground ? 'System Updates' : 'System Sync'}
              </h3>
              <p className="ssm-sub">
                {isUnderground
                  ? 'Pull the latest configuration from the surface.'
                  : 'Export or apply configuration snapshots.'}
              </p>
            </div>
          </div>
          <button
            className="ssm-close"
            onClick={onClose}
            disabled={loading}
            aria-label="Close"
          >
            <FiX />
          </button>
        </div>

        {/* ---------- Tabs ---------- */}
        <div className="ssm-tabs">
          <button
            className={`ssm-tab ${activeTab === 'online' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('online')}
            disabled={loading}
          >
            <FiCloud /> Online Sync
          </button>
          <button
            className={`ssm-tab ${activeTab === 'manual' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('manual')}
            disabled={loading}
          >
            <FiFileText /> Manual Sync
          </button>
        </div>

        {/* ---------- Body ---------- */}
        <div className="ssm-body">
          {/* ================= ONLINE SYNC TAB ================= */}
          {activeTab === 'online' && (
            <div className="ssm-online">
              {/* SURFACE HANDLER — informational (they are the source) */}
              {!isUnderground && (
                <div className="ssm-online-info">
                  <div className="ssm-online-hero-icon"><FiCloud /></div>
                  <h4 className="ssm-online-title">You are the source of truth</h4>
                  <p className="ssm-online-text">
                    Configuration originates on this surface server.
                    Underground devices pull the latest configuration
                    from here — you don't need to push anything manually.
                  </p>
                  <div className="ssm-online-note">
                    <FiInfo />
                    <span>
                      To share with a device that isn't connected to the network yet,
                      use the <strong>Manual Sync</strong> tab to export a JSON file.
                    </span>
                  </div>
                </div>
              )}

              {/* UNDERGROUND HANDLER — status + pull */}
              {isUnderground && (
                <>
                  {syncStatusLoading && (
                    <div className="ssm-loading">
                      <FiLoader className="ssm-spin" />
                      <span>Checking connection to surface…</span>
                    </div>
                  )}

                  {!syncStatusLoading && !syncStatus.enabled && (
                    <div className="ssm-online-info ssm-online-info--warn">
                      <div className="ssm-online-hero-icon ssm-online-hero-icon--warn">
                        <FiWifiOff />
                      </div>
                      <h4 className="ssm-online-title">Online Sync not configured</h4>
                      <p className="ssm-online-text">
                        This device isn't connected to a surface server yet.
                        Ask your administrator to configure the connection
                        in this device's <code>.env</code> file.
                      </p>
                      <div className="ssm-online-note ssm-online-note--warn">
                        <FiInfo />
                        <span>
                          Required env vars: <code>SURFACE_BASE_URL</code>{' '}
                          and <code>SURFACE_SYNC_KEY</code>. Until then, use the{' '}
                          <strong>Manual Sync</strong> tab to import a JSON file.
                        </span>
                      </div>
                    </div>
                  )}

                  {!syncStatusLoading && syncStatus.enabled && (
                    <>
                      {/* Connection banner */}
                      <div className="ssm-online-connection">
                        <span className="ssm-online-conn-dot" />
                        <FiWifi className="ssm-online-conn-icon" />
                        <div className="ssm-online-conn-body">
                          <div className="ssm-online-conn-title">Connected to surface</div>
                          <div className="ssm-online-conn-meta">
                            <code>{syncStatus.surfaceBaseUrl || '—'}</code>
                            {syncStatus.serverId && (
                              <> · as <code>{syncStatus.serverId}</code></>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Success card */}
                      {onlineSuccess && (
                        <div className="ssm-alert ssm-alert--success" role="status">
                          <FiCheckCircle className="ssm-alert-icon" />
                          <div className="ssm-alert-body">
                            <div className="ssm-alert-title">Configuration updated</div>
                            <div className="ssm-alert-text">{onlineSuccess}</div>
                          </div>
                          <button
                            type="button"
                            className="ssm-alert-dismiss"
                            onClick={() => setOnlineSuccess(null)}
                            aria-label="Dismiss"
                          >
                            <FiX />
                          </button>
                        </div>
                      )}

                      {/* Error card */}
                      {onlineError && (
                        <div className="ssm-alert ssm-alert--error" role="alert">
                          <FiAlertCircle className="ssm-alert-icon" />
                          <div className="ssm-alert-body">
                            <div className="ssm-alert-title">{onlineError.title}</div>
                            {onlineError.hint && (
                              <div className="ssm-alert-hint">{onlineError.hint}</div>
                            )}
                            <details className="ssm-alert-details-wrap">
                              <summary className="ssm-alert-summary">
                                Technical details
                              </summary>
                              <div className="ssm-alert-details">
                                {onlineError.message && (
                                  <div className="ssm-alert-details-row">
                                    <span className="ssm-alert-details-label">Error:</span>{' '}
                                    <code className="ssm-alert-code">{onlineError.message}</code>
                                  </div>
                                )}
                                {onlineError.code && (
                                  <div className="ssm-alert-details-row">
                                    <span className="ssm-alert-details-label">Code:</span>{' '}
                                    <code className="ssm-alert-code">{onlineError.code}</code>
                                  </div>
                                )}
                              </div>
                            </details>
                          </div>
                          <button
                            type="button"
                            className="ssm-alert-dismiss"
                            onClick={() => setOnlineError(null)}
                            aria-label="Dismiss"
                          >
                            <FiX />
                          </button>
                        </div>
                      )}

                      {/* Big pull button */}
                      <button
                        type="button"
                        className="ssm-online-pull-btn"
                        onClick={handleOnlinePullClick}
                        disabled={loading || onlinePulling}
                      >
                        {onlinePulling ? (
                          <>
                            <FiLoader className="ssm-spin" />
                            <span>Pulling from surface…</span>
                          </>
                        ) : (
                          <>
                            <FiRefreshCw />
                            <span>Pull Configuration Now</span>
                          </>
                        )}
                      </button>

                      {/* Safety note */}
                      <div className="ssm-online-warn">
                        <FiInfo />
                        <span>
                          Your underground stock, shifts, and inventory are{' '}
                          <strong>not affected</strong> — only the dropdown lists,
                          signatories, item codes, and locators are refreshed.
                        </span>
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          )}

          {/* ================= MANUAL SYNC TAB ================= */}
          {activeTab === 'manual' && (
            <div className="ssm-manual">
              {isUnderground && (
                <div className="ssm-note">
                  <FiInfo className="ssm-note-icon" />
                  <div>
                    Ask the surface admin to export the latest configuration,
                    then upload the JSON here. Your underground stock, shifts,
                    and inventory are <strong>not affected</strong> — only the
                    dropdown lists, signatories, item codes, and locators are
                    refreshed.
                  </div>
                </div>
              )}

              {/* Success card */}
              {importSuccess && (
                <div className="ssm-alert ssm-alert--success" role="status">
                  <FiCheckCircle className="ssm-alert-icon" />
                  <div className="ssm-alert-body">
                    <div className="ssm-alert-title">Import applied</div>
                    <div className="ssm-alert-text">{importSuccess}</div>
                  </div>
                  <button
                    type="button"
                    className="ssm-alert-dismiss"
                    onClick={() => setImportSuccess(null)}
                    aria-label="Dismiss"
                  >
                    <FiX />
                  </button>
                </div>
              )}

              {/* Error card */}
              {importError && (
                <ImportErrorCard
                  error={importError}
                  onDismiss={() => setImportError(null)}
                />
              )}

              {/* Export card — surface only */}
              {canExport && (
                <div className="ssm-action-card">
                  <div className="ssm-action-text">
                    <h4>Export Configuration</h4>
                    <p>
                      Download the current configuration as a JSON file. Walk it
                      to the underground device (USB drive / shared folder / email).
                    </p>
                  </div>
                  <button
                    className="ssm-btn ssm-btn--primary"
                    onClick={handleExport}
                    disabled={loading}
                  >
                    {loading && progressLabel?.startsWith('Preparing')
                      ? <FiLoader className="ssm-spin" />
                      : <FiDownload />}
                    {loading && progressLabel?.startsWith('Preparing')
                      ? 'Exporting…'
                      : 'Export JSON'}
                  </button>
                </div>
              )}

              {/* Import card */}
              <div className="ssm-action-card">
                <div className="ssm-action-text">
                  <h4>Import Configuration</h4>
                  <p>
                    Upload a JSON file previously exported from the surface.
                    The current configuration will be replaced.
                  </p>
                </div>
                <input
                  type="file"
                  accept=".json,application/json"
                  ref={fileInputRef}
                  onChange={handleImportFile}
                  disabled={loading}
                  style={{ display: 'none' }}
                />
                <button
                  className="ssm-btn ssm-btn--secondary"
                  onClick={handleImportClick}
                  disabled={loading}
                >
                  {loading && !progressLabel?.startsWith('Preparing')
                    ? <FiLoader className="ssm-spin" />
                    : <FiUpload />}
                  {loading && !progressLabel?.startsWith('Preparing')
                    ? 'Reading…'
                    : 'Choose File'}
                </button>
              </div>

              {progressLabel && (
                <div className="ssm-progress" role="status" aria-live="polite">
                  <FiLoader className="ssm-spin" />
                  <span>{progressLabel}</span>
                </div>
              )}
            </div>
          )}

          {/* History */}
          <div className="ssm-history">
            <h4 className="ssm-section-title">
              <FiClock /> Sync History
            </h4>
            {historyLoading ? (
              <div className="ssm-loading">
                <FiLoader className="ssm-spin" /> Loading history…
              </div>
            ) : history.length === 0 ? (
              <div className="ssm-empty">No sync history recorded yet.</div>
            ) : (
              <div className="ssm-history-list">
                {history.map((h) => (
                  <div key={h.sync_id} className="ssm-history-item">
                    <div className={`ssm-history-icon ${h.direction === 'Export' ? 'is-export' : 'is-import'}`}>
                      {h.direction === 'Export' ? <FiDownload /> : <FiUpload />}
                    </div>
                    <div className="ssm-history-info">
                      <div className="ssm-history-title">
                        {h.direction} · {Number(h.item_count) || 0} item{(Number(h.item_count) || 0) === 1 ? '' : 's'}
                      </div>
                      <div className="ssm-history-meta">
                        {h.performed_at
                          ? new Date(h.performed_at).toLocaleString()
                          : '—'}
                        {h.performed_by_username ? ` · ${h.performed_by_username}` : ''}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ---------- Footer ---------- */}
        <div className="ssm-footer">
          <button
            className="ssm-btn ssm-btn--ghost"
            onClick={onClose}
            disabled={loading}
          >
            Close
          </button>
        </div>
      </div>

      {/* ============================================================
          IN-APP CONFIRM — IMPORT (unchanged)
          ============================================================ */}
      {pendingImport && (
        <div
          className="ssm-confirm-overlay"
          onClick={loading ? undefined : handleCancelImport}
        >
          <div
            className="ssm-confirm-card"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="ssm-confirm-title"
          >
            <div className="ssm-confirm-header">
              <div className="ssm-confirm-icon"><FiAlertTriangle /></div>
              <div>
                <h3 id="ssm-confirm-title" className="ssm-confirm-title">
                  Apply this configuration?
                </h3>
                <p className="ssm-confirm-sub">{pendingImport.fileName}</p>
              </div>
            </div>

            <div className="ssm-confirm-body">
              <ul className="ssm-confirm-list">
                <li>
                  <strong>{pendingImport.counts.configs}</strong>{' '}
                  config item{pendingImport.counts.configs === 1 ? '' : 's'} (full replace)
                </li>
                <li>
                  <strong>{pendingImport.counts.signatures}</strong>{' '}
                  authorized signator{pendingImport.counts.signatures === 1 ? 'y' : 'ies'} (full replace)
                </li>
                <li>
                  <strong>{pendingImport.counts.items}</strong>{' '}
                  active item code{pendingImport.counts.items === 1 ? '' : 's'} (upsert)
                </li>
                <li>
                  <strong>{pendingImport.counts.locators}</strong>{' '}
                  locator{pendingImport.counts.locators === 1 ? '' : 's'} (upsert)
                </li>
              </ul>

              <div className="ssm-confirm-warn">
                <FiInfo />
                <span>
                  Your current configuration will be overwritten.
                  Underground stock, movements, and shifts are <strong>not</strong> affected.
                </span>
              </div>
            </div>

            <div className="ssm-confirm-footer">
              <button
                type="button"
                className="ssm-btn ssm-btn--ghost"
                onClick={handleCancelImport}
                disabled={loading}
              >
                Cancel
              </button>
              <button
                type="button"
                className="ssm-btn ssm-btn--primary"
                onClick={handleConfirmImport}
                disabled={loading}
              >
                {loading ? (
                  <>
                    <FiLoader className="ssm-spin" />
                    Applying…
                  </>
                ) : (
                  <>
                    <FiCheckCircle />
                    Apply Configuration
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================
          IN-APP CONFIRM — ONLINE PULL (NEW)
          ============================================================ */}
      {pendingOnlinePull && (
        <div
          className="ssm-confirm-overlay"
          onClick={loading ? undefined : handleCancelOnlinePull}
        >
          <div
            className="ssm-confirm-card"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="ssm-confirm-pull-title"
          >
            <div className="ssm-confirm-header">
              <div className="ssm-confirm-icon"><FiCloud /></div>
              <div>
                <h3 id="ssm-confirm-pull-title" className="ssm-confirm-title">
                  Pull configuration from surface?
                </h3>
                <p className="ssm-confirm-sub">
                  {syncStatus.surfaceBaseUrl || 'Surface server'}
                </p>
              </div>
            </div>

            <div className="ssm-confirm-body">
              <ul className="ssm-confirm-list ssm-confirm-list--plain">
                <li>Fetches the latest configuration from the surface over the network.</li>
                <li>Your current configuration will be overwritten.</li>
                <li>Underground stock, movements, and shifts are <strong>not</strong> affected.</li>
              </ul>

              <div className="ssm-confirm-warn">
                <FiInfo />
                <span>
                  The process takes a few seconds on a good connection.
                  You can retry any time if it fails.
                </span>
              </div>
            </div>

            <div className="ssm-confirm-footer">
              <button
                type="button"
                className="ssm-btn ssm-btn--ghost"
                onClick={handleCancelOnlinePull}
                disabled={loading}
              >
                Cancel
              </button>
              <button
                type="button"
                className="ssm-btn ssm-btn--primary"
                onClick={handleConfirmOnlinePull}
                disabled={loading}
              >
                {loading ? (
                  <>
                    <FiLoader className="ssm-spin" />
                    Pulling…
                  </>
                ) : (
                  <>
                    <FiCloud />
                    Pull Now
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

/* ============================================================
   Import error card (unchanged)
   ============================================================ */
const ImportErrorCard = ({ error, onDismiss }) => {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const hasDetails = Boolean(error.message && error.message !== error.title)
    || Boolean(error.step)
    || error.code != null;

  return (
    <div className="ssm-alert ssm-alert--error" role="alert">
      <FiAlertCircle className="ssm-alert-icon" />
      <div className="ssm-alert-body">
        <div className="ssm-alert-title">{error.title}</div>

        {error.step && (
          <div className="ssm-alert-step">
            <FiInfo />
            <span>Failed during: <strong>{error.step}</strong></span>
          </div>
        )}

        {error.hint && (
          <div className="ssm-alert-hint">{error.hint}</div>
        )}

        {hasDetails && (
          <>
            <button
              type="button"
              className="ssm-alert-toggle"
              onClick={() => setDetailsOpen((v) => !v)}
              aria-expanded={detailsOpen}
            >
              {detailsOpen ? <FiChevronUp /> : <FiChevronDown />}
              {detailsOpen ? 'Hide technical details' : 'Show technical details'}
            </button>

            {detailsOpen && (
              <div className="ssm-alert-details">
                {error.message && (
                  <div className="ssm-alert-details-row">
                    <span className="ssm-alert-details-label">Server message:</span>{' '}
                    <code className="ssm-alert-code">{error.message}</code>
                  </div>
                )}
                {error.code != null && (
                  <div className="ssm-alert-details-row">
                    <span className="ssm-alert-details-label">Error code:</span>{' '}
                    <code className="ssm-alert-code">{error.code}</code>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      <button
        type="button"
        className="ssm-alert-dismiss"
        onClick={onDismiss}
        aria-label="Dismiss"
      >
        <FiX />
      </button>
    </div>
  );
};

export default SyncSystemModal;

/* ============================================================
   Component-scoped CSS — `ssm-` prefix. Fully responsive.
   All existing classes preserved. New classes added for the
   Online Sync connection state and pull button.
   ============================================================ */
const css = `
.ssm-overlay {
  position: fixed; inset: 0; background: rgba(15,23,42,0.6);
  backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px);
  display: flex; align-items: center; justify-content: center;
  z-index: 9999; padding: 16px;
}
.ssm-card {
  background: #fff; border-radius: 16px; width: 100%; max-width: 640px;
  box-shadow: 0 20px 40px rgba(0,0,0,0.2); overflow: hidden;
  display: flex; flex-direction: column; max-height: 90vh;
  box-sizing: border-box;
  position: relative;
}
.ssm-card *, .ssm-card *::before, .ssm-card *::after { box-sizing: border-box; }

/* ---------- Header ---------- */
.ssm-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 20px 24px; border-bottom: 1px solid #e2e8f0;
  background: linear-gradient(135deg, #ffffff 0%, #f8fafc 100%);
  flex-shrink: 0;
}
.ssm-header-left { display: flex; align-items: center; gap: 14px; min-width: 0; }
.ssm-icon {
  width: 44px; height: 44px; border-radius: 12px;
  background: linear-gradient(135deg, #00e0d4 0%, #008a82 100%);
  color: #fff; display: flex; align-items: center; justify-content: center;
  box-shadow: 0 4px 12px rgba(0, 184, 176, 0.3);
  flex-shrink: 0;
}
.ssm-icon svg { width: 22px; height: 22px; }
.ssm-title { margin: 0; font-size: 18px; font-weight: 800; color: #0f172a; line-height: 1.2; }
.ssm-sub { margin: 2px 0 0; font-size: 13px; color: #64748b; line-height: 1.4; }
.ssm-close {
  background: none; border: none; color: #64748b; cursor: pointer;
  padding: 6px; border-radius: 8px;
  display: inline-flex; align-items: center; justify-content: center;
  transition: background 140ms ease, color 140ms ease;
  flex-shrink: 0;
}
.ssm-close:hover:not(:disabled) { background: #f1f5f9; color: #0f172a; }
.ssm-close:disabled { opacity: 0.5; cursor: not-allowed; }

/* ---------- Tabs ---------- */
.ssm-tabs {
  display: flex; border-bottom: 1px solid #e2e8f0; padding: 0 24px;
  background: #f8fafc; flex-shrink: 0;
}
.ssm-tab {
  display: flex; align-items: center; gap: 8px; padding: 14px 16px;
  background: none; border: none; border-bottom: 2px solid transparent;
  font: inherit; font-size: 14px; font-weight: 700; color: #64748b;
  cursor: pointer; transition: all 0.15s ease;
  margin-bottom: -1px;
}
.ssm-tab:hover:not(:disabled) { color: #0f172a; }
.ssm-tab.is-active { color: #008a82; border-bottom-color: #008a82; }
.ssm-tab:disabled { opacity: 0.55; cursor: not-allowed; }
.ssm-tab svg { width: 16px; height: 16px; }

/* ---------- Body ---------- */
.ssm-body {
  padding: 24px; overflow-y: auto;
  display: flex; flex-direction: column; gap: 20px;
  flex: 1 1 auto; min-height: 0;
}

/* ---------- Online panel (legacy — preserved) ---------- */
.ssm-online { text-align: center; padding: 20px; }
.ssm-online-icon {
  width: 64px; height: 64px; margin: 0 auto 16px; border-radius: 50%;
  background: #ecfdf5; color: #10b981;
  display: flex; align-items: center; justify-content: center;
}
.ssm-online-icon svg { width: 32px; height: 32px; }
.ssm-online h4 { margin: 0 0 8px; font-size: 16px; color: #0f172a; }
.ssm-online p { margin: 0 0 20px; color: #64748b; font-size: 14px; line-height: 1.5; }

.ssm-online-hint {
  display: flex; align-items: flex-start; gap: 8px;
  margin-top: 16px;
  padding: 10px 12px;
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  border-radius: 8px;
  font-size: 12px;
  color: #1e40af;
  line-height: 1.5;
  text-align: left;
}
.ssm-online-hint svg {
  width: 14px; height: 14px;
  flex-shrink: 0; margin-top: 2px;
  color: #3b82f6;
}
.ssm-online-hint strong { font-weight: 700; color: #1e3a8a; }

/* ---------- NEW: Online Sync connection state ---------- */
.ssm-online-info {
  display: flex; flex-direction: column; align-items: center;
  text-align: center; gap: 10px; padding: 24px 16px;
  background: linear-gradient(135deg, #f0fdfa 0%, #ecfeff 100%);
  border: 1px solid #99f6e4;
  border-radius: 12px;
}
.ssm-online-info--warn {
  background: linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%);
  border-color: #fcd34d;
}

.ssm-online-hero-icon {
  width: 60px; height: 60px; border-radius: 14px;
  background: linear-gradient(135deg, #22d3ee 0%, #0891b2 100%);
  color: #ffffff;
  display: inline-flex; align-items: center; justify-content: center;
  box-shadow: 0 6px 16px -4px rgba(8, 145, 178, 0.35);
}
.ssm-online-hero-icon svg { width: 28px; height: 28px; stroke-width: 2.2; }
.ssm-online-hero-icon--warn {
  background: linear-gradient(135deg, #fbbf24 0%, #b45309 100%);
  box-shadow: 0 6px 16px -4px rgba(180, 83, 9, 0.35);
}

.ssm-online-title {
  margin: 0; font-size: 16px; font-weight: 800; color: #0f172a;
  line-height: 1.25;
}
.ssm-online-text {
  margin: 0; font-size: 13px; color: #475569; line-height: 1.55;
  max-width: 42ch;
}
.ssm-online-text code {
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-size: 12px; background: rgba(15, 23, 42, 0.06);
  padding: 1px 5px; border-radius: 3px;
}

.ssm-online-note {
  display: flex; align-items: flex-start; gap: 8px;
  margin-top: 4px; padding: 10px 12px;
  background: rgba(255, 255, 255, 0.7);
  border: 1px solid #99f6e4;
  border-radius: 8px;
  font-size: 12px; color: #0f766e; line-height: 1.5;
  text-align: left; max-width: 44ch;
}
.ssm-online-note--warn {
  background: rgba(255, 255, 255, 0.7);
  border-color: #fcd34d;
  color: #92400e;
}
.ssm-online-note svg {
  width: 15px; height: 15px; flex-shrink: 0; margin-top: 1px;
}
.ssm-online-note strong { font-weight: 700; color: inherit; }
.ssm-online-note code {
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-size: 11px; background: rgba(15, 23, 42, 0.06);
  padding: 1px 4px; border-radius: 3px;
}

/* Connection banner */
.ssm-online-connection {
  display: flex; align-items: center; gap: 10px;
  padding: 12px 14px;
  background: #ffffff;
  border: 1.5px solid #86efac;
  border-radius: 10px;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.04);
}
.ssm-online-conn-dot {
  width: 8px; height: 8px; border-radius: 50%;
  background: #10b981; flex-shrink: 0;
  box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.15);
  animation: ssmConnPulse 2.2s ease-in-out infinite;
}
@keyframes ssmConnPulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
.ssm-online-conn-icon {
  width: 18px; height: 18px; stroke-width: 2.4;
  color: #059669; flex-shrink: 0;
}
.ssm-online-conn-body { min-width: 0; flex: 1; }
.ssm-online-conn-title {
  font-size: 13px; font-weight: 800; color: #065f46;
  line-height: 1.2;
}
.ssm-online-conn-meta {
  margin-top: 3px;
  font-size: 11.5px; color: #64748b;
  overflow-wrap: anywhere; word-break: break-word;
}
.ssm-online-conn-meta code {
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  background: #f1f5f9; color: #334155;
  padding: 1px 5px; border-radius: 3px;
  font-size: 11px;
}

/* Big pull button */
.ssm-online-pull-btn {
  display: inline-flex; align-items: center; justify-content: center;
  gap: 10px; min-height: 56px; padding: 14px 24px;
  border: none; border-radius: 12px;
  background: linear-gradient(135deg, #0ea5e9 0%, #0369a1 100%);
  color: #ffffff;
  font-family: inherit; font-size: 15px; font-weight: 800;
  letter-spacing: 0.005em;
  cursor: pointer;
  box-shadow: 0 6px 18px -6px rgba(14, 165, 233, 0.5);
  transition: transform 0.12s ease, box-shadow 0.14s ease, opacity 0.15s ease;
  width: 100%;
}
.ssm-online-pull-btn svg { width: 18px; height: 18px; stroke-width: 2.4; }
.ssm-online-pull-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 10px 22px -6px rgba(14, 165, 233, 0.65);
}
.ssm-online-pull-btn:active:not(:disabled) { transform: translateY(0); }
.ssm-online-pull-btn:disabled { opacity: 0.6; cursor: not-allowed; box-shadow: none; }

.ssm-online-warn {
  display: flex; align-items: flex-start; gap: 8px;
  padding: 10px 12px;
  background: #f8fafc;
  border: 1px dashed #cbd5e1;
  border-radius: 8px;
  font-size: 12px; color: #475569; line-height: 1.55;
}
.ssm-online-warn svg {
  width: 14px; height: 14px; flex-shrink: 0; margin-top: 1px;
  color: #0f766e;
}
.ssm-online-warn strong { font-weight: 700; color: #0f172a; }

/* ---------- Manual panel ---------- */
.ssm-manual { display: flex; flex-direction: column; gap: 16px; }

.ssm-note {
  display: flex; align-items: flex-start; gap: 10px;
  padding: 12px 14px;
  background: #eff6ff; border: 1px solid #bfdbfe;
  border-left: 4px solid #3b82f6; border-radius: 10px;
  font-size: 13px; line-height: 1.5; color: #1e40af;
}
.ssm-note-icon { width: 18px; height: 18px; flex-shrink: 0; margin-top: 1px; }
.ssm-note strong { font-weight: 700; color: #1e3a8a; }

.ssm-action-card {
  display: flex; align-items: center; justify-content: space-between;
  gap: 16px; padding: 16px;
  background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px;
  flex-wrap: wrap;
}
.ssm-action-text { min-width: 0; flex: 1 1 240px; }
.ssm-action-text h4 { margin: 0 0 4px; font-size: 15px; font-weight: 700; color: #0f172a; }
.ssm-action-text p { margin: 0; font-size: 13px; color: #64748b; line-height: 1.45; }

.ssm-progress {
  display: inline-flex; align-items: center; gap: 10px;
  padding: 10px 14px; border-radius: 10px;
  background: #f0fdfa; border: 1px solid #99f6e4;
  font-size: 13px; font-weight: 600; color: #0f766e;
}

/* ---------- Buttons ---------- */
.ssm-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  padding: 10px 16px; border-radius: 8px; font: inherit; font-size: 14px;
  font-weight: 700; cursor: pointer; border: 1px solid transparent;
  transition: all 0.15s ease; white-space: nowrap;
  flex-shrink: 0;
}
.ssm-btn:disabled { opacity: 0.6; cursor: not-allowed; }
.ssm-btn svg { width: 15px; height: 15px; }
.ssm-btn--primary { background: #00b8b0; color: #fff; }
.ssm-btn--primary:hover:not(:disabled) { background: #00d4cb; }
.ssm-btn--secondary {
  background: #fff; border-color: #cbd5e1; color: #334155;
}
.ssm-btn--secondary:hover:not(:disabled) {
  background: #f1f5f9; border-color: #94a3b8;
}
.ssm-btn--ghost { background: transparent; color: #64748b; }
.ssm-btn--ghost:hover:not(:disabled) { background: #f1f5f9; }

/* ---------- Inline alerts ---------- */
.ssm-alert {
  display: flex; align-items: flex-start; gap: 12px;
  padding: 12px 14px;
  border-radius: 10px;
  border: 1.5px solid transparent;
  font-size: 13px; line-height: 1.45;
}
.ssm-alert-icon {
  width: 20px; height: 20px;
  flex-shrink: 0; margin-top: 1px;
}
.ssm-alert-body { flex: 1; min-width: 0; }
.ssm-alert-title {
  font-size: 13.5px; font-weight: 800; line-height: 1.25;
  margin-bottom: 2px;
}
.ssm-alert-text {
  font-size: 12.5px; line-height: 1.5;
}

/* Step context pill */
.ssm-alert-step {
  display: inline-flex; align-items: center; gap: 6px;
  margin-top: 8px;
  padding: 4px 10px;
  background: rgba(255, 255, 255, 0.6);
  border: 1px solid currentColor;
  border-radius: 999px;
  font-size: 11.5px;
  font-weight: 600;
  line-height: 1.3;
  opacity: 0.95;
}
.ssm-alert-step svg { width: 12px; height: 12px; flex-shrink: 0; }
.ssm-alert-step strong { font-weight: 800; }

.ssm-alert-hint {
  margin-top: 8px;
  padding: 8px 10px;
  background: rgba(255,255,255,0.55);
  border: 1px dashed currentColor;
  border-radius: 6px;
  font-size: 12px;
  line-height: 1.45;
  opacity: 0.9;
}
.ssm-alert-toggle {
  display: inline-flex; align-items: center; gap: 5px;
  margin-top: 8px;
  padding: 4px 8px;
  background: transparent;
  border: 1px solid currentColor;
  border-radius: 6px;
  color: inherit;
  font-family: inherit;
  font-size: 11.5px;
  font-weight: 700;
  cursor: pointer;
  opacity: 0.85;
}
.ssm-alert-toggle:hover { opacity: 1; }
.ssm-alert-toggle svg { width: 12px; height: 12px; }
.ssm-alert-details {
  margin-top: 8px;
  padding: 8px 10px;
  background: rgba(255,255,255,0.6);
  border-radius: 6px;
  font-size: 11.5px;
  line-height: 1.5;
  overflow-x: auto;
}
.ssm-alert-details-wrap { margin-top: 8px; }
.ssm-alert-summary {
  cursor: pointer;
  font-size: 11.5px;
  font-weight: 700;
  opacity: 0.85;
  user-select: none;
  padding: 2px 0;
  list-style: none;
}
.ssm-alert-summary::-webkit-details-marker { display: none; }
.ssm-alert-summary::before {
  content: '▸ ';
  display: inline-block;
  transition: transform 0.15s ease;
  margin-right: 2px;
}
.ssm-alert-details-wrap[open] .ssm-alert-summary::before {
  transform: rotate(90deg);
}
.ssm-alert-details-row { margin-bottom: 4px; }
.ssm-alert-details-row:last-child { margin-bottom: 0; }
.ssm-alert-details-label {
  font-weight: 700;
  opacity: 0.85;
}
.ssm-alert-code {
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-size: 11px;
  padding: 1px 5px;
  background: rgba(15, 23, 42, 0.08);
  border-radius: 3px;
  word-break: break-word;
}
.ssm-alert-dismiss {
  display: inline-flex; align-items: center; justify-content: center;
  width: 26px; height: 26px;
  border: none; background: transparent; color: inherit;
  border-radius: 6px; cursor: pointer;
  opacity: 0.6;
  flex-shrink: 0;
  transition: opacity 0.15s ease, background 0.15s ease;
}
.ssm-alert-dismiss:hover { opacity: 1; background: rgba(255,255,255,0.4); }
.ssm-alert-dismiss svg { width: 14px; height: 14px; }

.ssm-alert--success {
  background: #ecfdf5;
  border-color: #6ee7b7;
  color: #065f46;
}
.ssm-alert--success .ssm-alert-icon { color: #10b981; }

.ssm-alert--error {
  background: #fef2f2;
  border-color: #fca5a5;
  color: #991b1b;
}
.ssm-alert--error .ssm-alert-icon { color: #dc2626; }

/* ---------- History ---------- */
.ssm-history { border-top: 1px solid #e2e8f0; padding-top: 20px; }
.ssm-section-title {
  display: flex; align-items: center; gap: 8px;
  font-size: 14px; font-weight: 800; color: #0f172a;
  margin: 0 0 12px;
}
.ssm-section-title svg { color: #00b8b0; width: 15px; height: 15px; }
.ssm-history-list { display: flex; flex-direction: column; gap: 8px; }
.ssm-history-item {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 12px;
  background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px;
  transition: border-color 140ms ease, box-shadow 140ms ease;
}
.ssm-history-item:hover {
  border-color: #cbd5e1;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.06);
}
.ssm-history-icon {
  width: 32px; height: 32px; border-radius: 8px;
  background: #f1f5f9; color: #64748b;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.ssm-history-icon.is-export { background: #dbeafe; color: #1e40af; }
.ssm-history-icon.is-import { background: #dcfce7; color: #166534; }
.ssm-history-icon svg { width: 15px; height: 15px; }
.ssm-history-info { min-width: 0; }
.ssm-history-title {
  font-size: 13px; font-weight: 700; color: #0f172a;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ssm-history-meta {
  font-size: 11.5px; color: #64748b; margin-top: 2px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ssm-empty {
  font-size: 13px; color: #94a3b8; text-align: center; padding: 20px;
  background: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 8px;
}
.ssm-loading {
  display: flex; align-items: center; gap: 8px;
  font-size: 13px; color: #64748b;
  padding: 12px 0;
}

/* ---------- Footer ---------- */
.ssm-footer {
  padding: 16px 24px; border-top: 1px solid #e2e8f0;
  display: flex; justify-content: flex-end;
  flex-shrink: 0;
  background: #ffffff;
}

/* ---------- Spinner ---------- */
.ssm-spin { animation: ssmSpin 1s linear infinite; }
@keyframes ssmSpin { 100% { transform: rotate(360deg); } }

/* ============================================================
   In-app confirm overlay
   ============================================================ */
.ssm-confirm-overlay {
  position: fixed; inset: 0;
  background: rgba(15, 23, 42, 0.75);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  display: flex; align-items: center; justify-content: center;
  z-index: 10000;
  padding: 20px;
  animation: ssmConfirmFade 160ms ease-out;
}
@keyframes ssmConfirmFade {
  from { opacity: 0; }
  to   { opacity: 1; }
}
.ssm-confirm-card {
  width: 100%; max-width: 520px;
  background: #ffffff; border-radius: 16px;
  box-shadow: 0 25px 60px rgba(0, 0, 0, 0.4);
  overflow: hidden;
  animation: ssmConfirmPop 220ms cubic-bezier(0.34, 1.3, 0.64, 1);
  max-height: 90vh; display: flex; flex-direction: column;
}
@keyframes ssmConfirmPop {
  from { opacity: 0; transform: translateY(12px) scale(0.97); }
  to   { opacity: 1; transform: translateY(0)    scale(1); }
}

.ssm-confirm-header {
  display: flex; align-items: flex-start; gap: 14px;
  padding: 22px 24px 16px;
  border-bottom: 1px solid #f1f5f9;
  flex-shrink: 0;
}
.ssm-confirm-icon {
  width: 44px; height: 44px; border-radius: 12px;
  background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%);
  color: #b45309;
  display: inline-flex; align-items: center; justify-content: center;
  flex-shrink: 0;
  box-shadow: 0 3px 10px rgba(180, 83, 9, 0.2);
}
.ssm-confirm-icon svg { width: 22px; height: 22px; stroke-width: 2.4; }
.ssm-confirm-title {
  margin: 0; font-size: 17px; font-weight: 800; color: #0f172a;
  line-height: 1.25;
}
.ssm-confirm-sub {
  margin: 4px 0 0; font-size: 12.5px; color: #64748b;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

.ssm-confirm-body {
  padding: 18px 24px;
  overflow-y: auto;
  flex: 1 1 auto;
  min-height: 0;
}
.ssm-confirm-list {
  list-style: none;
  margin: 0 0 16px;
  padding: 0;
  display: flex; flex-direction: column; gap: 8px;
}
.ssm-confirm-list li {
  padding: 10px 14px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  font-size: 13px;
  color: #334155;
  line-height: 1.4;
}
.ssm-confirm-list--plain li {
  background: transparent;
  border: none;
  padding: 4px 0;
  border-bottom: 1px solid #f1f5f9;
  border-radius: 0;
}
.ssm-confirm-list--plain li:last-child { border-bottom: none; }
.ssm-confirm-list strong {
  color: #0f172a;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-weight: 800;
}
.ssm-confirm-warn {
  display: flex; align-items: flex-start; gap: 8px;
  padding: 10px 12px;
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  border-left: 3px solid #3b82f6;
  border-radius: 8px;
  font-size: 12.5px;
  color: #1e40af;
  line-height: 1.5;
}
.ssm-confirm-warn svg {
  width: 15px; height: 15px;
  flex-shrink: 0; margin-top: 1px;
  color: #3b82f6;
}

.ssm-confirm-footer {
  display: flex; justify-content: flex-end; gap: 10px;
  padding: 16px 24px;
  border-top: 1px solid #f1f5f9;
  background: #fafbfc;
  flex-shrink: 0;
}

/* ============================================================
   Responsive breakpoints
   ============================================================ */
@media (min-width: 1600px) {
  .ssm-card { max-width: 720px; }
  .ssm-confirm-card { max-width: 580px; }
  .ssm-header { padding: 24px 28px; }
  .ssm-body { padding: 28px; gap: 24px; }
  .ssm-online-pull-btn { min-height: 60px; font-size: 16px; }
  .ssm-confirm-header { padding: 26px 28px 18px; }
  .ssm-confirm-body { padding: 20px 28px; }
  .ssm-confirm-footer { padding: 18px 28px; }
  .ssm-title { font-size: 20px; }
  .ssm-sub { font-size: 14px; }
  .ssm-btn { padding: 12px 20px; font-size: 15px; }
}

@media (max-width: 1024px) {
  .ssm-card { max-width: 600px; }
  .ssm-body { padding: 22px; }
}

@media (max-width: 900px) {
  .ssm-card { max-width: 560px; }
  .ssm-confirm-card { max-width: 480px; }
}

@media (max-width: 768px) {
  .ssm-header { padding: 16px 18px; }
  .ssm-icon { width: 38px; height: 38px; border-radius: 10px; }
  .ssm-icon svg { width: 19px; height: 19px; }
  .ssm-title { font-size: 16px; }
  .ssm-sub { font-size: 12px; }
  .ssm-tabs { padding: 0 18px; }
  .ssm-tab { padding: 12px 12px; font-size: 13px; }
  .ssm-body { padding: 18px; gap: 16px; }
  .ssm-action-card { padding: 14px; }
  .ssm-action-text h4 { font-size: 14px; }
  .ssm-action-text p { font-size: 12.5px; }
  .ssm-footer { padding: 14px 18px; }
  .ssm-online-hero-icon { width: 52px; height: 52px; }
  .ssm-online-hero-icon svg { width: 24px; height: 24px; }
  .ssm-online-title { font-size: 15px; }
  .ssm-online-text { font-size: 12.5px; }
  .ssm-online-pull-btn { min-height: 52px; font-size: 14px; }
  .ssm-confirm-header { padding: 18px 20px 14px; gap: 12px; }
  .ssm-confirm-icon { width: 38px; height: 38px; border-radius: 10px; }
  .ssm-confirm-icon svg { width: 19px; height: 19px; }
  .ssm-confirm-title { font-size: 16px; }
  .ssm-confirm-body { padding: 16px 20px; }
  .ssm-confirm-footer { padding: 14px 20px; }
}

@media (max-width: 640px) {
  .ssm-card { max-height: 95vh; }
  .ssm-action-card { flex-direction: column; align-items: stretch; text-align: left; }
  .ssm-action-card .ssm-btn { width: 100%; }
  .ssm-history-title,
  .ssm-history-meta { white-space: normal; word-break: break-word; }
  .ssm-confirm-card { max-height: 95vh; border-radius: 14px; }
  .ssm-confirm-footer { flex-direction: column-reverse; }
  .ssm-confirm-footer .ssm-btn { width: 100%; }
  .ssm-online-connection { flex-wrap: wrap; }
}

@media (max-width: 480px) {
  .ssm-overlay { padding: 8px; }
  .ssm-card { border-radius: 14px; }
  .ssm-header { padding: 14px 14px; gap: 10px; }
  .ssm-header-left { gap: 10px; }
  .ssm-icon { width: 34px; height: 34px; border-radius: 9px; }
  .ssm-icon svg { width: 17px; height: 17px; }
  .ssm-title { font-size: 15px; }
  .ssm-sub { font-size: 11.5px; }
  .ssm-tabs { padding: 0 14px; }
  .ssm-tab { padding: 11px 10px; font-size: 12.5px; gap: 6px; }
  .ssm-tab svg { width: 14px; height: 14px; }
  .ssm-body { padding: 14px; gap: 14px; }
  .ssm-action-text h4 { font-size: 13.5px; }
  .ssm-action-text p { font-size: 12px; }
  .ssm-note { font-size: 12px; padding: 10px 12px; }
  .ssm-note-icon { width: 16px; height: 16px; }
  .ssm-section-title { font-size: 13px; }
  .ssm-history-item { padding: 9px 10px; gap: 10px; }
  .ssm-history-icon { width: 28px; height: 28px; border-radius: 7px; }
  .ssm-history-icon svg { width: 13px; height: 13px; }
  .ssm-history-title { font-size: 12px; }
  .ssm-history-meta { font-size: 11px; }
  .ssm-footer { padding: 12px 14px; }
  .ssm-online-info { padding: 18px 12px; }
  .ssm-online-hero-icon { width: 44px; height: 44px; border-radius: 12px; }
  .ssm-online-hero-icon svg { width: 20px; height: 20px; }
  .ssm-online-title { font-size: 14px; }
  .ssm-online-text { font-size: 12px; }
  .ssm-online-note { font-size: 11.5px; padding: 8px 10px; }
  .ssm-online-conn-title { font-size: 12px; }
  .ssm-online-conn-meta { font-size: 11px; }
  .ssm-online-pull-btn { min-height: 50px; font-size: 13.5px; padding: 12px 16px; }
  .ssm-online-warn { font-size: 11.5px; padding: 9px 10px; }
  .ssm-confirm-overlay { padding: 12px; }
  .ssm-confirm-header { padding: 16px 16px 12px; }
  .ssm-confirm-icon { width: 34px; height: 34px; border-radius: 9px; }
  .ssm-confirm-icon svg { width: 17px; height: 17px; }
  .ssm-confirm-title { font-size: 15px; }
  .ssm-confirm-sub { font-size: 11.5px; }
  .ssm-confirm-body { padding: 14px 16px; }
  .ssm-confirm-list li { font-size: 12.5px; padding: 9px 12px; }
  .ssm-confirm-list--plain li { padding: 3px 0; }
  .ssm-confirm-footer { padding: 12px 16px; }
  .ssm-alert { padding: 10px 12px; gap: 10px; font-size: 12px; }
  .ssm-alert-icon { width: 18px; height: 18px; }
  .ssm-alert-title { font-size: 12.5px; }
  .ssm-alert-text { font-size: 11.5px; }
  .ssm-alert-hint { font-size: 11px; }
  .ssm-online-hint { font-size: 11px; padding: 8px 10px; }
}

@media (max-width: 380px) {
  .ssm-header { padding: 12px 12px; }
  .ssm-title { font-size: 14px; }
  .ssm-sub { font-size: 11px; }
  .ssm-body { padding: 12px; gap: 12px; }
  .ssm-tab,
  .ssm-tab span { font-size: 12px; }
  .ssm-btn { padding: 9px 14px; font-size: 13px; }
  .ssm-btn svg { width: 14px; height: 14px; }
  .ssm-confirm-header { padding: 14px 12px 10px; gap: 10px; }
  .ssm-confirm-title { font-size: 14px; }
  .ssm-confirm-body { padding: 12px; }
  .ssm-confirm-list li { font-size: 12px; padding: 8px 10px; }
  .ssm-confirm-footer { padding: 10px 12px; }
  .ssm-online-pull-btn { font-size: 13px; min-height: 48px; }
}

@media (prefers-reduced-motion: reduce) {
  .ssm-card *,
  .ssm-btn,
  .ssm-tab,
  .ssm-history-item,
  .ssm-icon { transition: none !important; }
  .ssm-spin,
  .ssm-online-conn-dot { animation: none !important; }
  .ssm-confirm-overlay,
  .ssm-confirm-card { animation: none !important; }
  .ssm-online-pull-btn:hover:not(:disabled) { transform: none; }
}
`;