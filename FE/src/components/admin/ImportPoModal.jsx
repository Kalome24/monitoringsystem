// src/components/admin/ImportPoModal.jsx
import React, { useMemo, useState } from 'react';
import { readExcel, mapRows, groupByPo } from '../../utils/poImport';
import { importPoApi } from '../../services/api';

/**
 * Global PO import — used by the Admin team.
 *
 * Import is warehouse-agnostic. Every Registrar sees every imported PO.
 * The warehouse is stamped onto each line later, when a Registrar saves
 * a receipt (see backend receivePurchaseOrder).
 *
 * Policy: any duplicate — within the file, or against the DB — aborts the
 * import. There is no skip / update / override.
 */
const ImportPoModal = ({ onClose, onImported }) => {
  const [fileName, setFileName]   = useState('');
  const [rows, setRows]           = useState([]);
  const [errors, setErrors]       = useState([]);
  const [step, setStep]           = useState('upload'); // upload | preview | importing
  const [busy, setBusy]           = useState(false);
  const [dragging, setDragging]   = useState(false);

  const grouped = useMemo(() => groupByPo(rows), [rows]);

  // ============================================================
  // Alert: invalid item codes
  // ============================================================
  const showInvalidItemCodesAlert = (invalidCodes) => {
    const list = invalidCodes.slice(0, 15).join('\n  • ');
    const more = invalidCodes.length > 15
      ? `\n  …and ${invalidCodes.length - 15} more`
      : '';

    alert(
      `❌ Invalid item code. Please check your item codes.\n\n` +
      `The following item code(s) were not found in item_master:\n\n  • ${list}${more}\n\n` +
      `Please correct them in your Excel file and try again.`
    );
  };

  // ============================================================
  // Alert: duplicate lines within the uploaded file
  // ============================================================
  const showFileDuplicatesAlert = (dups) => {
    const byPO = new Map();
    for (const d of dups) {
      if (!byPO.has(d.po_no)) byPO.set(d.po_no, []);
      byPO.get(d.po_no).push(d);
    }

    const lines = [];
    for (const [poNo, items] of byPO.entries()) {
      const itemList = items
        .map((x) => `${x.item_code} (×${x.count})`)
        .join(', ');
      lines.push(`  • PO ${poNo}: ${itemList}`);
    }

    const shown = lines.slice(0, 10).join('\n');
    const more  = lines.length > 10
      ? `\n  …and ${lines.length - 10} more`
      : '';

    alert(
      `❌ Duplicate lines in your file.\n\n` +
      `The following (PO No. + Item Code) pairs appear more than once:\n\n` +
      `${shown}${more}\n\n` +
      `Each line must be unique. Please remove the duplicate rows ` +
      `from your Excel file and try again.`
    );
  };

  // ============================================================
  // Alert: lines already exist in the database
  // ============================================================
  const showDbConflictAlert = (duplicates) => {
    const byPO = new Map();
    for (const d of duplicates) {
      if (!byPO.has(d.po_no)) byPO.set(d.po_no, []);
      byPO.get(d.po_no).push(d);
    }

    const lines = [];
    for (const [poNo, items] of byPO.entries()) {
      const itemList = items
        .map((x) => `${x.item_code} (row ${x.excel_row})`)
        .join(', ');
      lines.push(`  • PO ${poNo}: ${itemList}`);
    }

    const shown = lines.slice(0, 10).join('\n');
    const more  = lines.length > 10
      ? `\n  …and ${lines.length - 10} more`
      : '';

    alert(
      `❌ Import aborted — duplicate lines already exist.\n\n` +
      `${duplicates.length} line${duplicates.length === 1 ? '' : 's'} ` +
      `in your file conflict with records already in the system:\n\n` +
      `${shown}${more}\n\n` +
      `Remove those rows from your file and try again.`
    );
  };

  // ============================================================
  // Scan the mapped rows for within-file duplicates
  // ============================================================
  const findWithinFileDuplicates = (mapped) => {
    const counts = new Map();
    for (const r of mapped) {
      const key = `${r.po_no}|||${r.item_code}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    }

    const dups = [];
    for (const [key, count] of counts.entries()) {
      if (count > 1) {
        const [po_no, item_code] = key.split('|||');
        dups.push({ po_no, item_code, count });
      }
    }
    return dups;
  };

  // ============================================================
  // File upload → parse → validate → preflight
  // ============================================================
  const processFile = async (file) => {
    if (!file) return;
    setBusy(true);
    try {
      setFileName(file.name);
      const raw = await readExcel(file);
      const { rows: mapped, errors: errs } = mapRows(raw);

      if (mapped.length === 0 && errs.length === 0) {
        alert('The file appears to be empty.');
        return;
      }

      // ---- 1) Within-file duplicate check ----
      const dupLines = findWithinFileDuplicates(mapped);
      if (dupLines.length > 0) {
        showFileDuplicatesAlert(dupLines);
        return;
      }

      // ---- 2) Preflight: check DB for existing POs + invalid item codes ----
      const poNos     = [...new Set(mapped.map((r) => r.po_no))];
      const itemCodes = [...new Set(mapped.map((r) => r.item_code))];

      const preRes = await importPoApi.checkDuplicatePOs(poNos, itemCodes);

      if (!preRes.ok) {
        alert('❌ Could not validate the file. Please try again.');
        return;
      }

      const existingPOs  = preRes.data?.existing           || [];
      const invalidCodes = preRes.data?.invalid_item_codes || [];

      if (invalidCodes.length > 0) {
        showInvalidItemCodesAlert(invalidCodes);
        return;
      }

      if (existingPOs.length > 0) {
        const list = existingPOs.slice(0, 10).join('\n  • ');
        const more = existingPOs.length > 10
          ? `\n  …and ${existingPOs.length - 10} more`
          : '';

        alert(
          `❌ Import blocked — PO number(s) already exist.\n\n` +
          `The following PO number(s) are already in the system:\n\n  • ${list}${more}\n\n` +
          `Remove them from your Excel file and try again. ` +
          `An import only proceeds when every PO is new.`
        );
        return;
      }

      setRows(mapped);
      setErrors(errs);
      setStep('preview');
    } catch (err) {
      console.error('Excel parse error:', err);
      alert('❌ ' + (err.message || 'Could not read the file.'));
    } finally {
      setBusy(false);
    }
  };

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    await processFile(file);
    e.target.value = '';
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    await processFile(file);
  };

  // ============================================================
  // Confirm import → POST to backend
  // ============================================================
  const handleConfirmImport = async () => {
    if (!rows.length) return;
    setStep('importing');
    try {
      const res = await importPoApi.importPOs({
        source_file: fileName,
        rows: rows.map((r) => ({
          po_date:     r.po_date,
          pr_no:       r.pr_no,
          po_no:       r.po_no,
          vendor_name: r.vendor_name,
          item_code:   r.item_code,
          qty:         r.qty,
          unit_price:  r.unit_price,
          currency:    r.currency,
          buyer:       r.buyer,
        })),
      });

      if (!res.ok && res.data?.code === 'INVALID_ITEM_CODES') {
        const invalidCodes = res.data.invalid_item_codes || [];
        showInvalidItemCodesAlert(invalidCodes);

        setStep('upload');
        setRows([]);
        setErrors([]);
        setFileName('');
        return;
      }

      if (!res.ok && res.data?.code === 'DUPLICATE_LINES') {
        const dups = res.data.duplicates || [];
        showDbConflictAlert(dups);

        // Back to upload — the file needs editing.
        setStep('upload');
        setRows([]);
        setErrors([]);
        setFileName('');
        return;
      }

      if (!res.ok && res.data?.code === 'DUPLICATE_LINES_IN_FILE') {
        const dups = res.data.duplicates || [];
        showFileDuplicatesAlert(dups);

        setStep('upload');
        setRows([]);
        setErrors([]);
        setFileName('');
        return;
      }

      if (!res.ok || !res.data?.success) {
        throw new Error(res.data?.message || 'Import failed.');
      }

      const s = res.data.summary || {};

      alert(
        `✅ Import complete\n\n` +
        `POs created:  ${s.po_count || 0}\n` +
        `Inserted:     ${s.inserted || 0}` +
        (s.errors > 0
          ? `\nErrors:       ${s.errors}`
          : '')
      );

      onImported?.();
      onClose();
    } catch (err) {
      console.error('Import error:', err);
      alert('❌ ' + (err.message || 'Failed to import.'));
      setStep('preview');
    }
  };

  const handleResetUpload = () => {
    setRows([]);
    setErrors([]);
    setFileName('');
    setStep('upload');
  };

  // ============================================================
  // Render: Upload step
  // ============================================================
  const renderUpload = () => (
    <>
      <p style={styles.intro}>
        Upload the PO export file. The <strong>UOM</strong> column will be auto-filled
        from <em>item_master</em> based on each ITEM CODE.
      </p>

      <div style={styles.warehouseBanner}>
        <span style={styles.warehouseIcon}>🌐</span>
        <div style={{ minWidth: 0 }}>
          <div style={styles.warehouseLabel}>Global Import</div>
          <div style={styles.warehouseValue}>
            Every warehouse will see these POs. A Registrar claims the lines when they save a receipt.
          </div>
        </div>
      </div>

      <div style={styles.policyNote}>
        <span style={styles.policyNoteIcon}>🛡️</span>
        <span>
          The import only proceeds when every (PO No. + Item Code) pair is
          unique — both within the file and against existing records.
          Duplicates abort the whole import.
        </span>
      </div>

      <label
        htmlFor="po-import-file"
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        style={{
          ...styles.dropzone,
          ...(dragging ? styles.dropzoneActive : null),
          ...(busy ? styles.dropzoneBusy : null),
        }}
      >
        <div style={styles.dropIcon}>📄</div>
        <div style={styles.dropTitle}>
          {busy ? 'Reading file…' : 'Drop a file here or click to browse'}
        </div>
        <div style={styles.dropHint}>Supported: .xlsx · .xls · .csv</div>
        <input
          id="po-import-file"
          type="file"
          accept=".xlsx,.xls,.csv"
          onChange={handleFile}
          disabled={busy}
          style={{ display: 'none' }}
        />
      </label>

      <div style={styles.expectedBlock}>
        <div style={styles.expectedTitle}>Expected Columns</div>
        <div style={styles.expectedList}>
          <span style={styles.chip}>PO DATE</span>
          <span style={styles.chip}>PR NO.</span>
          <span style={styles.chip}>PO NO.</span>
          <span style={styles.chip}>VENDOR NAME</span>
          <span style={styles.chip}>ITEM CODE</span>
          <span style={styles.chip}>QTY.</span>
          <span style={styles.chip}>UNIT PRICE</span>
          <span style={styles.chip}>CURR</span>
          <span style={styles.chip}>BUYER</span>
        </div>
      </div>
    </>
  );

  // ============================================================
  // Render: Preview step
  // ============================================================
  const renderPreview = () => (
    <>
      <div style={styles.fileSummary}>
        <div style={styles.fileSummaryIcon}>📊</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={styles.fileName} title={fileName}>{fileName}</div>
          <div style={styles.fileMeta}>
            <strong>{grouped.length}</strong> PO{grouped.length === 1 ? '' : 's'}
            {' · '}
            <strong>{rows.length}</strong> line{rows.length === 1 ? '' : 's'}
            {errors.length > 0 && (
              <span style={styles.errorInline}> · {errors.length} skipped</span>
            )}
          </div>
        </div>
      </div>

      {errors.length > 0 && (
        <details style={styles.errorDetails}>
          <summary style={styles.errorSummary}>
            ⚠️ Show {errors.length} skipped row{errors.length === 1 ? '' : 's'}
          </summary>
          <ul style={styles.errorList}>
            {errors.slice(0, 50).map((e, i) => (
              <li key={i}>Row {e.row}: {e.message}</li>
            ))}
            {errors.length > 50 && <li>…and {errors.length - 50} more</li>}
          </ul>
        </details>
      )}

      <div style={styles.tableWrap}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>PO No.</th>
              <th style={styles.th}>PO Date</th>
              <th style={styles.th}>PR No.</th>
              <th style={styles.th}>Vendor</th>
              <th style={{ ...styles.th, textAlign: 'center' }}>Lines</th>
              <th style={{ ...styles.th, textAlign: 'right' }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {grouped.map((g) => {
              const total = g.lines.reduce(
                (s, l) => s + (l.qty * l.unit_price || 0),
                0
              );
              return (
                <tr key={g.po_no} style={styles.tr}>
                  <td style={styles.td}>
                    <span style={styles.codePill}>{g.po_no}</span>
                  </td>
                  <td style={styles.td}>{g.po_date}</td>
                  <td style={styles.td}>{g.pr_no || '—'}</td>
                  <td style={styles.td}>{g.vendor_name || '—'}</td>
                  <td style={{ ...styles.td, textAlign: 'center' }}>
                    {g.lines.length}
                  </td>
                  <td style={{ ...styles.td, textAlign: 'right', fontWeight: 600 }}>
                    {total.toFixed(2)}{' '}
                    <span style={styles.currency}>{g.currency}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );

  // ============================================================
  // Render
  // ============================================================
  return (
    <>
      <style>{responsiveCss}</style>

      <div
        className="ipm-overlay"
        style={styles.overlay}
        onClick={step === 'importing' ? undefined : onClose}
      >
        <div
          className="ipm-card"
          style={styles.card}
          onClick={(e) => e.stopPropagation()}
        >
          {/* ---------- HEADER ---------- */}
          <div style={styles.header}>
            <div style={styles.headerLeft}>
              <div style={styles.headerIcon}>📥</div>
              <div style={{ minWidth: 0 }}>
                <h3 style={styles.headerTitle}>Import Purchase Orders</h3>
                <div style={styles.headerSub}>
                  {step === 'upload'    && 'Step 1 of 2 · Upload file'}
                  {step === 'preview'   && 'Step 2 of 2 · Review & confirm'}
                  {step === 'importing' && 'Importing…'}
                </div>
              </div>
            </div>
            <button
              type="button"
              className="ipm-close"
              onClick={onClose}
              disabled={step === 'importing'}
              style={styles.closeBtn}
            >
              ✕
            </button>
          </div>

          {/* ---------- BODY ---------- */}
          <div className="ipm-body" style={styles.body}>
            {step === 'upload' && renderUpload()}
            {(step === 'preview' || step === 'importing') && renderPreview()}
          </div>

          {/* ---------- FOOTER ---------- */}
          <div className="ipm-footer" style={styles.footer}>
            {step !== 'upload' && step !== 'importing' && (
              <button
                type="button"
                className="cancel-btn"
                onClick={handleResetUpload}
              >
                ← Choose Different File
              </button>
            )}

            <button
              type="button"
              className="cancel-btn"
              onClick={onClose}
              disabled={step === 'importing'}
            >
              Cancel
            </button>

            {step === 'preview' && (
              <button
                type="button"
                className="save-btn"
                onClick={handleConfirmImport}
                disabled={!rows.length}
              >
                ✅ Import {grouped.length} PO{grouped.length === 1 ? '' : 's'}
              </button>
            )}

            {step === 'importing' && (
              <button type="button" className="save-btn" disabled>
                Importing…
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

// ============================================================
// INLINE STYLES
// ============================================================
const styles = {
  // ---- Overlay / Card ----
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
    animation: 'ipmFadeIn 0.18s ease',
  },
  card: {
    background: '#ffffff',
    borderRadius: 'clamp(12px, 1.5vw, 18px)',
    width: '100%',
    maxWidth: 900,
    maxHeight: '92vh',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    boxShadow: '0 24px 64px rgba(15, 23, 42, 0.28), 0 4px 14px rgba(15, 23, 42, 0.14)',
    fontFamily:
      "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    animation: 'ipmSlideUp 0.22s cubic-bezier(0.34, 1.3, 0.64, 1)',
  },

  // ---- Header ----
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
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    minWidth: 0,
    flex: 1,
  },
  headerIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    background: 'linear-gradient(135deg, #00e0d4 0%, #008a82 100%)',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 22,
    boxShadow: '0 4px 12px rgba(0, 210, 200, 0.32)',
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
    fontWeight: 500,
    marginTop: 2,
  },
  closeBtn: {
    background: 'transparent',
    border: 'none',
    width: 36,
    height: 36,
    borderRadius: 8,
    cursor: 'pointer',
    fontSize: 18,
    color: '#64748b',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },

  // ---- Body / Footer ----
  body: {
    flex: 1,
    overflowY: 'auto',
    padding: 'clamp(18px, 2.4vw, 28px)',
    display: 'flex',
    flexDirection: 'column',
    gap: 'clamp(12px, 1.4vw, 16px)',
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

  // ---- Upload step ----
  intro: {
    margin: 0,
    fontSize: 'clamp(13px, 1.1vw, 14px)',
    color: '#475569',
    lineHeight: 1.55,
  },
  warehouseBanner: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '12px 16px',
    background: 'linear-gradient(135deg, #f0fdfa 0%, #ecfeff 100%)',
    border: '1px solid #99f6e4',
    borderRadius: 10,
  },
  warehouseIcon: { fontSize: 22, flexShrink: 0 },
  warehouseLabel: {
    fontSize: 11,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    color: '#0f766e',
  },
  warehouseValue: {
    fontSize: 'clamp(13px, 1.2vw, 15px)',
    fontWeight: 600,
    color: '#0f172a',
    wordBreak: 'break-word',
  },
  policyNote: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
    padding: '12px 14px',
    background: '#fefce8',
    border: '1px solid #fde68a',
    borderRadius: 10,
    fontSize: 12.5,
    color: '#78350f',
    lineHeight: 1.55,
  },
  policyNoteIcon: { fontSize: 16, flexShrink: 0, lineHeight: 1.2 },
  dropzone: {
    display: 'block',
    border: '2px dashed #cbd5e1',
    borderRadius: 14,
    padding: 'clamp(28px, 5vw, 44px) 20px',
    textAlign: 'center',
    cursor: 'pointer',
    background: '#fafbfc',
    color: '#475569',
    transition: 'border-color 0.15s ease, background 0.15s ease, transform 0.15s ease',
  },
  dropzoneActive: {
    borderColor: '#00d2c8',
    background: '#f0fdfa',
    transform: 'scale(1.01)',
  },
  dropzoneBusy: { opacity: 0.7, cursor: 'wait' },
  dropIcon: { fontSize: 'clamp(32px, 5vw, 44px)', marginBottom: 8 },
  dropTitle: {
    fontSize: 'clamp(14px, 1.3vw, 16px)',
    fontWeight: 600,
    color: '#0f172a',
    marginBottom: 4,
  },
  dropHint: { fontSize: 'clamp(11px, 1vw, 13px)', color: '#64748b' },
  expectedBlock: {
    padding: '14px 16px',
    background: '#f8fafc',
    borderRadius: 10,
    border: '1px solid #e5e7eb',
  },
  expectedTitle: {
    fontSize: 12,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    color: '#64748b',
    marginBottom: 8,
  },
  expectedList: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  chip: {
    fontSize: 11,
    fontWeight: 600,
    padding: '3px 10px',
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: 999,
    color: '#334155',
    fontFamily: "'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace",
    letterSpacing: '0.02em',
  },

  // ---- Preview step ----
  fileSummary: {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    padding: '14px 16px',
    background: 'linear-gradient(135deg, #f0fdfa 0%, #ecfeff 100%)',
    border: '1px solid #99f6e4',
    borderRadius: 10,
  },
  fileSummaryIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    background: '#ffffff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 20,
    flexShrink: 0,
    boxShadow: '0 2px 6px rgba(0, 0, 0, 0.06)',
  },
  fileName: {
    fontSize: 'clamp(13px, 1.2vw, 15px)',
    fontWeight: 600,
    color: '#0f172a',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  fileMeta: {
    fontSize: 'clamp(11px, 1vw, 13px)',
    color: '#475569',
    marginTop: 2,
  },
  errorInline: { color: '#dc2626', fontWeight: 600 },
  errorDetails: {
    fontSize: 13,
    padding: '10px 14px',
    background: '#fef2f2',
    border: '1px solid #fecaca',
    borderRadius: 8,
  },
  errorSummary: { cursor: 'pointer', color: '#b91c1c', fontWeight: 600 },
  errorList: {
    marginTop: 6,
    maxHeight: 140,
    overflowY: 'auto',
    paddingLeft: 22,
    color: '#7f1d1d',
    fontSize: 12,
    lineHeight: 1.6,
  },
  tableWrap: {
    overflow: 'auto',
    maxHeight: 320,
    border: '1px solid #e2e8f0',
    borderRadius: 10,
    background: '#ffffff',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    minWidth: 640,
    fontSize: 'clamp(12px, 1.1vw, 14px)',
  },
  th: {
    padding: '12px 14px',
    textAlign: 'left',
    fontSize: 11,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    color: '#64748b',
    background: '#f8fafc',
    borderBottom: '1px solid #e2e8f0',
    position: 'sticky',
    top: 0,
    zIndex: 1,
    whiteSpace: 'nowrap',
  },
  tr: { borderBottom: '1px solid #f1f5f9' },
  td: {
    padding: '12px 14px',
    color: '#0f172a',
    fontSize: 'clamp(12px, 1.1vw, 14px)',
    verticalAlign: 'middle',
  },
  codePill: {
    display: 'inline-block',
    padding: '3px 10px',
    background: '#ecfeff',
    color: '#0e7490',
    border: '1px solid #a5f3fc',
    borderRadius: 6,
    fontSize: 12,
    fontWeight: 700,
    fontFamily: "'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace",
    letterSpacing: '0.02em',
    whiteSpace: 'nowrap',
  },
  currency: {
    fontSize: 10,
    fontWeight: 700,
    color: '#64748b',
    letterSpacing: '0.06em',
    marginLeft: 4,
  },
};

// ============================================================
// RESPONSIVE CSS
// ============================================================
const responsiveCss = `
@keyframes ipmFadeIn {
  from { opacity: 0; }
  to   { opacity: 1; }
}
@keyframes ipmSlideUp {
  from { opacity: 0; transform: translateY(16px) scale(0.98); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}

.ipm-close:hover:not(:disabled) {
  background: #f1f5f9;
  color: #0f172a;
}
.ipm-close:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.ipm-body::-webkit-scrollbar { width: 8px; }
.ipm-body::-webkit-scrollbar-track {
  background: #f1f5f9;
  border-radius: 4px;
}
.ipm-body::-webkit-scrollbar-thumb {
  background: #cbd5e1;
  border-radius: 4px;
}
.ipm-body::-webkit-scrollbar-thumb:hover {
  background: #94a3b8;
}

@media (max-width: 640px) {
  .ipm-card { max-height: 94vh; }
  .ipm-body { padding: 16px; }
  .ipm-footer { padding: 12px 16px; }
  .ipm-footer button { flex: 1 1 auto; }
}

@media (max-width: 400px) {
  .ipm-overlay { padding: 0; }
  .ipm-card {
    max-height: 100vh;
    border-radius: 0;
    width: 100vw;
    height: 100vh;
  }
}

@media (prefers-reduced-motion: reduce) {
  .ipm-card, .ipm-overlay {
    animation: none !important;
  }
}
`;

export default ImportPoModal;