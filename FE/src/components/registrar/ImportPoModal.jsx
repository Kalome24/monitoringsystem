// src/components/registrar/ImportPoModal.jsx
import React, { useEffect, useMemo, useState } from 'react';
import {
  FiInbox,
  FiX,
  FiHome,
  FiRefreshCw,
  FiShield,
  FiUploadCloud,
  FiBarChart2,
  FiAlertTriangle,
  FiCheckCircle,
  FiChevronRight,
  FiChevronDown,
} from 'react-icons/fi';
import {
  readExcel,
  mapRows,
  groupByPo,
  checkPerPoWarehouseConsistency,
} from '../../utils/poImport';
import { importPoApi, itemMasterApi, warehouseApi } from '../../services/api';
import ModalBanner from '../shared/ModalBanner';
import ItemImageThumb from '../shared/ItemImageThumb';

const ImportPoModal = ({ onClose, onImported }) => {
  const [fileName, setFileName]   = useState('');
  const [rows, setRows]           = useState([]);
  const [errors, setErrors]       = useState([]);
  const [step, setStep]           = useState('upload'); // upload | preview | importing
  const [busy, setBusy]           = useState(false);
  const [dragging, setDragging]   = useState(false);
  const [feedback, setFeedback]   = useState(null);

  const [itemImages, setItemImages]     = useState({});
  const [expandedPOs, setExpandedPOs]   = useState(() => new Set());

  /* code (upper-cased) → warehouse_name. Populated once on mount. */
  const [warehouseNameByCode, setWarehouseNameByCode] = useState({});

  const grouped = useMemo(() => groupByPo(rows), [rows]);

  /* Warehouse by group_key — PR-based groups are keyed by their PR No. */
  const poWarehouseMap = useMemo(() => {
    const m = new Map();
    for (const r of rows) {
      if (!m.has(r.group_key)) m.set(r.group_key, r.warehouse_code || '');
    }
    return m;
  }, [rows]);

  // ============================================================
  // Fetch the warehouse directory once. Used only for display —
  // the warehouse CODE from the Excel file is what gets sent to
  // the backend. If the fetch fails, we simply fall back to
  // showing the raw code in the preview.
  // ============================================================
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await warehouseApi.getAllWarehouses();
        if (cancelled || !res.ok) return;
        const list = Array.isArray(res.data) ? res.data : [];
        const map = {};
        for (const w of list) {
          const code = String(w.warehouse_code || '').trim().toUpperCase();
          if (!code) continue;
          map[code] = String(w.warehouse_name || '').trim() || code;
        }
        setWarehouseNameByCode(map);
      } catch (err) {
        console.warn('Could not load warehouse directory for preview:', err);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ============================================================
  // Fetch item images when entering the preview step.
  // ============================================================
  useEffect(() => {
    if (step !== 'preview' || rows.length === 0) return;

    let cancelled = false;
    (async () => {
      try {
        const codes = [...new Set(rows.map((r) => r.item_code).filter(Boolean))];
        if (codes.length === 0) return;
        const res = await itemMasterApi.getImagesByCodes(codes);
        if (cancelled) return;
        if (res.ok && res.data?.images) {
          setItemImages(res.data.images);
        }
      } catch (err) {
        console.warn('Could not load item images for preview:', err);
      }
    })();

    return () => { cancelled = true; };
  }, [step, rows]);

  // ============================================================
  // Expand / collapse helpers
  // ============================================================
  const togglePO = (key) => {
    setExpandedPOs((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const expandAll  = () => setExpandedPOs(new Set(grouped.map((g) => g.group_key)));
  const collapseAll = () => setExpandedPOs(new Set());

  // ============================================================
  // Render the warehouse pill.
  // ============================================================
  const renderWarehousePill = (rawCode) => {
    const code = String(rawCode || '').trim();
    if (!code) {
      return (
        <span className="ipm-warehouse-pill ipm-warehouse-pill--empty">
          —
        </span>
      );
    }

    const upper = code.toUpperCase();
    const name  = warehouseNameByCode[upper] || '';
    const hasName = !!name && name.toUpperCase() !== upper;

    if (!hasName) {
      return (
        <span
          className="ipm-warehouse-pill ipm-warehouse-pill--code-only"
          title={`Warehouse code: ${code}`}
        >
          <span className="ipm-warehouse-pill-code">{code}</span>
        </span>
      );
    }

    return (
      <span
        className="ipm-warehouse-pill"
        title={`Warehouse code: ${code} — ${name}`}
      >
        <span className="ipm-warehouse-pill-code">{code}</span>
        <span className="ipm-warehouse-pill-name">{name}</span>
      </span>
    );
  };

  // ============================================================
  // Banner helpers
  // ============================================================
  const showMixedWarehouse = (violations) => {
    const lines = violations.map((v) => {
      const whList = v.warehouses
        .map((w) => {
          const sample = w.rows.slice(0, 10).join(', ');
          const more = w.rows.length > 10 ? `, …(+${w.rows.length - 10})` : '';
          return `      "${w.warehouse_code || '(blank)'}" → rows ${sample}${more}`;
        })
        .join('\n');
      const tag = v.has_po === 0 ? ' (PR-based)' : '';
      return `  • PO ${v.po_no}${tag}:\n${whList}`;
    }).join('\n\n');

    const totalPOs = violations.length;

    setFeedback({
      type: 'error',
      title: `Import aborted — ${totalPOs} PO/PR number${totalPOs === 1 ? '' : 's'} with multiple warehouse codes`,
      message:
        `Each PO No. (or PR No., when PO No. is blank) must use ONE warehouse. Different POs/PRs may use different warehouses.\n\n` +
        `${lines}\n\n` +
        `Fix the WAREHOUSE CODE column so every row of the same PO/PR shares one code, then try again.`,
    });
  };

  const showInvalidWarehouse = (message) => {
    setFeedback({
      type: 'error',
      title: 'Warehouse code not valid',
      message:
        (message || 'The warehouse code is not recognized by the system.') +
        `\n\nPlease check the WAREHOUSE CODE column and try again.`,
    });
  };

  const showInvalidItemCodes = (invalidCodes) => {
    const list = invalidCodes.slice(0, 15).join('\n  • ');
    const more = invalidCodes.length > 15
      ? `\n  …and ${invalidCodes.length - 15} more`
      : '';

    setFeedback({
      type: 'error',
      title: `Invalid item code${invalidCodes.length === 1 ? '' : 's'}`,
      message:
        `The following item code(s) were not found in item_master:\n\n  • ${list}${more}\n\n` +
        `Please correct them in your Excel file and try again.`,
    });
  };

  const showFileDuplicates = (dups) => {
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
      lines.push(`  • PO/PR ${poNo}: ${itemList}`);
    }

    const shown = lines.slice(0, 10).join('\n');
    const more  = lines.length > 10
      ? `\n  …and ${lines.length - 10} more`
      : '';

    setFeedback({
      type: 'error',
      title: 'Duplicate lines in your file',
      message:
        `The following (PO/PR No. + Item Code) pairs appear more than once:\n\n` +
        `${shown}${more}\n\n` +
        `Each line must be unique. Please remove the duplicate rows ` +
        `from your Excel file and try again.`,
    });
  };

  const showDbConflict = (duplicates) => {
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
      lines.push(`  • PO/PR ${poNo}: ${itemList}`);
    }

    const shown = lines.slice(0, 10).join('\n');
    const more  = lines.length > 10
      ? `\n  …and ${lines.length - 10} more`
      : '';

    setFeedback({
      type: 'error',
      title: `Import aborted — ${duplicates.length} line${duplicates.length === 1 ? '' : 's'} already exist in the system`,
      message:
        `The following lines in your file conflict with records already in the database:\n\n` +
        `${shown}${more}\n\n` +
        `Remove those rows from your file and try again.`,
    });
  };

  // ============================================================
  // Helpers
  // ============================================================
  const findWithinFileDuplicates = (mapped) => {
    const counts = new Map();
    for (const r of mapped) {
      const key = `${r.group_key}|||${r.item_code}`;
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
  // File upload pipeline
  // ============================================================
  const processFile = async (file) => {
    if (!file) return;
    setBusy(true);
    setFeedback(null);
    try {
      setFileName(file.name);
      const raw = await readExcel(file);
      const { rows: mapped, errors: errs } = mapRows(raw);

      if (mapped.length === 0 && errs.length === 0) {
        setFeedback({
          type: 'warning',
          title: 'File is empty',
          message: 'The file appears to be empty. Please check the file and try again.',
        });
        return;
      }

      const whCheck = checkPerPoWarehouseConsistency(mapped);
      if (!whCheck.ok) {
        showMixedWarehouse(whCheck.violations);
        return;
      }

      const dupLines = findWithinFileDuplicates(mapped);
      if (dupLines.length > 0) {
        showFileDuplicates(dupLines);
        return;
      }

      const groupKeys = [...new Set(mapped.map((r) => r.group_key))];
      const itemCodes = [...new Set(mapped.map((r) => r.item_code))];

      const preRes = await importPoApi.checkDuplicatePOs(groupKeys, itemCodes);

      if (!preRes.ok) {
        setFeedback({
          type: 'error',
          title: 'Validation failed',
          message: 'Could not validate the file. Please try again.',
        });
        return;
      }

      const existingPOs  = preRes.data?.existing           || [];
      const invalidCodes = preRes.data?.invalid_item_codes || [];

      if (invalidCodes.length > 0) {
        showInvalidItemCodes(invalidCodes);
        return;
      }

      if (existingPOs.length > 0) {
        const list = existingPOs.slice(0, 10).join('\n  • ');
        const more = existingPOs.length > 10
          ? `\n  …and ${existingPOs.length - 10} more`
          : '';

        setFeedback({
          type: 'error',
          title: `Import blocked — ${existingPOs.length} PO/PR number${existingPOs.length === 1 ? '' : 's'} already exist`,
          message:
            `The following PO/PR number(s) are already in the system:\n\n  • ${list}${more}\n\n` +
            `Remove them from your Excel file and try again. ` +
            `An import only proceeds when every PO/PR is new.`,
        });
        return;
      }

      setItemImages({});
      setExpandedPOs(new Set());

      setRows(mapped);
      setErrors(errs);
      setStep('preview');
      setFeedback(null);
    } catch (err) {
      console.error('Excel parse error:', err);
      setFeedback({
        type: 'error',
        title: 'Could not read file',
        message: err.message || 'Could not read the file.',
      });
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
  // Confirm import
  // ============================================================
  const handleConfirmImport = async () => {
    if (!rows.length) return;
    setStep('importing');
    setFeedback(null);
    try {
      const res = await importPoApi.importPOs({
        source_file: fileName,
        rows: rows.map((r) => ({
          po_date:         r.po_date,
          pr_no:           r.pr_no,
          po_no:           r.po_no,
          has_po:          r.has_po,
          vendor_name:     r.vendor_name,
          item_code:       r.item_code,
          qty:             r.qty,
          delivered_qty:   r.delivered_qty,
          unit_price:      r.unit_price,
          currency:        r.currency,
          forex:           r.forex,
          delivery_status: r.delivery_status,
          buyer:           r.buyer,
          warehouse_code:  r.warehouse_code,
        })),
      });

      if (!res.ok && res.data?.code === 'MIXED_WAREHOUSE_CODES_PER_PO') {
        showMixedWarehouse(res.data.violations || []);
        handleResetUpload();
        return;
      }
      if (!res.ok && (res.data?.code === 'INVALID_WAREHOUSE_CODE' ||
                      res.data?.code === 'INACTIVE_WAREHOUSE_CODE')) {
        showInvalidWarehouse(res.data.message);
        handleResetUpload();
        return;
      }
      if (!res.ok && res.data?.code === 'INVALID_ITEM_CODES') {
        showInvalidItemCodes(res.data.invalid_item_codes || []);
        handleResetUpload();
        return;
      }
      if (!res.ok && res.data?.code === 'DUPLICATE_LINES') {
        showDbConflict(res.data.duplicates || []);
        handleResetUpload();
        return;
      }
      if (!res.ok && res.data?.code === 'DUPLICATE_LINES_IN_FILE') {
        showFileDuplicates(res.data.duplicates || []);
        handleResetUpload();
        return;
      }
      if (!res.ok || !res.data?.success) {
        throw new Error(res.data?.message || 'Import failed.');
      }

      const s = res.data.summary || {};

      const warehouseLine = Array.isArray(s.distinct_warehouses) && s.distinct_warehouses.length > 0
        ? `Warehouses:     ${s.distinct_warehouses.join(', ')}\n`
        : '';

      const poSplitLine = (s.with_po_lines != null || s.without_po_lines != null)
        ? `  · With PO:    ${s.with_po_lines || 0}\n  · PR-based:   ${s.without_po_lines || 0}\n`
        : '';

      setFeedback({
        type: 'success',
        title: 'Import complete',
        message:
          warehouseLine +
          `PO/PR groups:   ${s.po_count || 0}\n` +
          `Inserted:       ${s.inserted || 0}\n` +
          (s.locked_count != null
            ? `  · Locked:     ${s.locked_count}\n`
            : '') +
          (s.unlocked_count != null
            ? `  · Unlocked:   ${s.unlocked_count}\n`
            : '') +
          poSplitLine +
          (s.errors > 0 ? `Errors:         ${s.errors}\n` : ''),
      });

      onImported?.();
      setTimeout(() => {
        onClose();
      }, 2200);
    } catch (err) {
      console.error('Import error:', err);
      setFeedback({
        type: 'error',
        title: 'Import failed',
        message: err.message || 'Failed to import.',
      });
      setStep('preview');
    }
  };

  const handleResetUpload = () => {
    setRows([]);
    setErrors([]);
    setFileName('');
    setItemImages({});
    setExpandedPOs(new Set());
    setStep('upload');
    setFeedback(null);
  };

  // ============================================================
  // Render
  // ============================================================
  return (
    <>
      <style>{modalCss}</style>

      <div
        className="ipm-overlay"
        onClick={step === 'importing' ? undefined : onClose}
      >
        <div className="ipm-card" onClick={(e) => e.stopPropagation()}>

          {/* ---------- HEADER ---------- */}
          <div className="ipm-header">
            <div className="ipm-header-left">
              <div className="ipm-header-icon"><FiInbox /></div>
              <div className="ipm-header-info">
                <h3 className="ipm-header-title">Import Purchase Orders</h3>
                <div className="ipm-header-sub">
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
              aria-label="Close"
            ><FiX /></button>
          </div>

          {/* ---------- BODY ---------- */}
          <div className="ipm-body">
            {feedback && (
              <ModalBanner
                type={feedback.type}
                title={feedback.title}
                message={feedback.message}
                onClose={() => setFeedback(null)}
                scroll={true}
              />
            )}

            {step === 'upload' && renderUpload()}
            {(step === 'preview' || step === 'importing') && renderPreview()}
          </div>

          {/* ---------- FOOTER ---------- */}
          {step !== 'upload' && (
            <div className="ipm-footer">
              {step === 'preview' && (
                <button
                  type="button"
                  className="cancel-btn"
                  onClick={handleResetUpload}
                >
                  ← Choose Different File
                </button>
              )}

              {step === 'preview' && (
                <button
                  type="button"
                  className="save-btn"
                  onClick={handleConfirmImport}
                  disabled={!rows.length}
                >
                  <FiCheckCircle className="ipm-btn-icon" />
                  <span>Import {grouped.length} PO/PR{grouped.length === 1 ? '' : 's'}</span>
                </button>
              )}

              {step === 'importing' && (
                <button type="button" className="save-btn" disabled>
                  Importing…
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );

  // ============================================================
  // STEP 1 — upload
  // ============================================================
  function renderUpload() {
    return (
      <>
        <p className="ipm-intro">
          Upload the PO export file. Every row must include a{' '}
          <strong>WAREHOUSE CODE</strong>, a <strong>CURR</strong>, and a{' '}
          <strong>STATUS</strong> value of either <em>Complete</em> or{' '}
          <em>Partial Received</em>. Non-PHP rows must also include a{' '}
          <strong>FOREX</strong> rate. Each row needs either a{' '}
          <strong>PO NO.</strong> or a <strong>PR NO.</strong> — if PO No. is
          blank, the PR No. becomes the grouping identifier (flagged as{' '}
          <em>PR-based</em>).
        </p>

        <div className="ipm-warehouse-banner">
          <span className="ipm-warehouse-icon"><FiHome /></span>
          <div className="ipm-warehouse-body">
            <div className="ipm-warehouse-label">One Warehouse Per PO / PR</div>
            <div className="ipm-warehouse-value">
              Each PO number (or PR number, when PO No. is blank) must use one
              warehouse code. Different groups may use different warehouses — and
              the same warehouse code may appear on multiple groups. Locked items
              ignore this column and route to their own warehouses.
            </div>
          </div>
        </div>

        <div className="ipm-fx-banner">
          <span className="ipm-fx-icon"><FiRefreshCw /></span>
          <div className="ipm-fx-body">
            <div className="ipm-fx-label">Multi-Currency &amp; Delivery Status</div>
            <div className="ipm-fx-value">
              <strong>CURR = PHP</strong> → forex forced to <strong>1</strong>.
              {' '}
              <strong>CURR ≠ PHP</strong> → the <strong>FOREX</strong> column is required
              (must be &gt; 0). FUNC AMOUNT is computed server-side as{' '}
              <em>unit_price × delivered_qty × forex</em>. <br />
              The <strong>STATUS</strong> column is authoritative: the user tells the
              system whether the delivery was <strong>Complete</strong> or{' '}
              <strong>Partial Received</strong> — the QTY vs DELIVERED QTY comparison is
              no longer used.
            </div>
          </div>
        </div>

        <div className="ipm-policy-note">
          <span className="ipm-policy-note-icon"><FiShield /></span>
          <span>
            The import only proceeds when every (PO/PR No. + Item Code) pair is
            unique — both within the file and against existing records.
            Duplicates abort the whole import.
          </span>
        </div>

        <label
          htmlFor="po-import-file"
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          className={`ipm-dropzone${dragging ? ' ipm-dropzone--active' : ''}${busy ? ' ipm-dropzone--busy' : ''}`}
        >
          <div className="ipm-drop-icon"><FiUploadCloud /></div>
          <div className="ipm-drop-title">
            {busy ? 'Reading file…' : 'Drop a file here or click to browse'}
          </div>
          <div className="ipm-drop-hint">Supported: .xlsx · .xls · .csv</div>
          <input
            id="po-import-file"
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={handleFile}
            disabled={busy}
            className="ipm-file-input"
          />
        </label>

        <div className="ipm-expected-block">
          <div className="ipm-expected-title">Expected Columns</div>
          <div className="ipm-expected-list">
            <span className="ipm-chip">PO DATE</span>
            <span className="ipm-chip">PR NO.</span>
            <span className="ipm-chip">
              PO NO.
              <span className="ipm-chip-note">(optional)</span>
            </span>
            <span className="ipm-chip">VENDOR NAME</span>
            <span className="ipm-chip">ITEM CODE</span>
            <span className="ipm-chip">QTY.</span>
            <span className="ipm-chip">UNIT PRICE</span>
            <span className="ipm-chip">CURR</span>
            <span className="ipm-chip ipm-chip--fx">FOREX</span>
            <span className="ipm-chip ipm-chip--fx">DELIVERED QTY</span>
            <span className="ipm-chip ipm-chip--status">STATUS</span>
            <span className="ipm-chip">BUYER</span>
            <span className="ipm-chip ipm-chip--highlight">WAREHOUSE CODE</span>
          </div>
        </div>
      </>
    );
  }

  // ============================================================
  // STEP 2 — preview
  // ============================================================
  function renderPreview() {
    const allExpanded = grouped.length > 0 && expandedPOs.size === grouped.length;

    return (
      <>
        <div className="ipm-file-summary">
          <div className="ipm-file-summary-icon"><FiBarChart2 /></div>
          <div className="ipm-file-summary-info">
            <div className="ipm-file-name" title={fileName}>{fileName}</div>
            <div className="ipm-file-meta">
              <strong>{grouped.length}</strong> PO/PR group{grouped.length === 1 ? '' : 's'}
              {' · '}
              <strong>{rows.length}</strong> line{rows.length === 1 ? '' : 's'}
              {errors.length > 0 && (
                <span className="ipm-error-inline"> · {errors.length} skipped</span>
              )}
            </div>
          </div>
        </div>

        {errors.length > 0 && (
          <details className="ipm-error-details">
            <summary className="ipm-error-summary">
              <FiAlertTriangle className="ipm-error-summary-icon" />
              <span>Show {errors.length} skipped row{errors.length === 1 ? '' : 's'}</span>
            </summary>
            <ul className="ipm-error-list">
              {errors.slice(0, 50).map((e, i) => (
                <li key={i}>Row {e.row}: {e.message}</li>
              ))}
              {errors.length > 50 && <li>…and {errors.length - 50} more</li>}
            </ul>
          </details>
        )}

        {/* ---------- TOOLBAR ---------- */}
        <div className="ipm-preview-toolbar">
          <button
            type="button"
            className="ipm-toolbar-btn"
            onClick={allExpanded ? collapseAll : expandAll}
            disabled={grouped.length === 0}
          >
            {allExpanded ? (
              <><FiChevronRight className="ipm-toolbar-icon" /><span>Collapse all</span></>
            ) : (
              <><FiChevronDown className="ipm-toolbar-icon" /><span>Expand all items</span></>
            )}
          </button>
          <span className="ipm-toolbar-hint">
            Click a PO/PR row to preview its items.
          </span>
        </div>

        {/* ---------- DESKTOP TABLE ---------- */}
        <div className="ipm-table-wrap">
          <table className="ipm-table">
            <thead>
              <tr>
                <th className="ipm-th-expand" aria-label="Expand"></th>
                <th>PO / PR No.</th>
                <th>PO Date</th>
                <th>PR No.</th>
                <th>Vendor</th>
                <th>Warehouse</th>
                <th className="ipm-th-center">Lines</th>
                <th className="ipm-th-center">Delivery</th>
                <th className="ipm-th-right">Total (PHP)</th>
              </tr>
            </thead>
            <tbody>
              {grouped.map((g) => {
                const isOpen = expandedPOs.has(g.group_key);
                const isPrBased = g.has_po === 0;
                return (
                  <React.Fragment key={g.group_key}>
                    <tr
                      className={`ipm-tr ipm-tr--clickable${isOpen ? ' is-open' : ''}`}
                      onClick={() => togglePO(g.group_key)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          togglePO(g.group_key);
                        }
                      }}
                      aria-expanded={isOpen}
                    >
                      <td className="ipm-td ipm-td-expand">
                        <span className="ipm-expand-chevron" aria-hidden="true">
                          {isOpen
                            ? <FiChevronDown className="ipm-chevron-icon" />
                            : <FiChevronRight className="ipm-chevron-icon" />}
                        </span>
                      </td>
                      <td className="ipm-td">
                        <span className="ipm-code-pill">{g.display_id}</span>
                        {isPrBased && (
                          <span className="ipm-pr-pill" title="No PO No. — grouped by PR No.">PR</span>
                        )}
                      </td>
                      <td className="ipm-td">{g.po_date}</td>
                      <td className="ipm-td">{g.pr_no || '—'}</td>
                      <td className="ipm-td">{g.vendor_name || '—'}</td>
                      <td className="ipm-td">
                        {renderWarehousePill(poWarehouseMap.get(g.group_key))}
                      </td>
                      <td className="ipm-td ipm-td-center">{g.lines.length}</td>
                      <td className="ipm-td ipm-td-center">
                        {g.hasPartial ? (
                          <span className="ipm-deliv-badge ipm-deliv-badge--partial">
                            <FiAlertTriangle className="ipm-deliv-icon" />
                            <span>Partial ({g.partialCount})</span>
                          </span>
                        ) : (
                          <span className="ipm-deliv-badge ipm-deliv-badge--complete">
                            <FiCheckCircle className="ipm-deliv-icon" />
                            <span>Complete</span>
                          </span>
                        )}
                      </td>
                      <td className="ipm-td ipm-td-right ipm-td-bold">
                        {g.funcTotal.toFixed(4)} {/* <--- UPDATED TO 4 */}
                        {g.hasNonPhp && (
                          <span
                            className="ipm-fx-note"
                            title={`Non-PHP: ${g.currencies.join(', ')}`}
                          >
                            {' '}FX
                          </span>
                        )}
                      </td>
                    </tr>

                    {isOpen && (
                      <tr className="ipm-tr-expanded">
                        <td className="ipm-td-expanded" colSpan={9}>
                          <div className="ipm-item-list">
                            {g.lines.map((line, idx) => (
                              <div className="ipm-item-line" key={`${g.group_key}-${idx}`}>
                                <div className="ipm-item-thumb">
                                  <ItemImageThumb
                                    src={itemImages[line.item_code] || null}
                                    alt={line.item_code}
                                    size={36}
                                  />
                                </div>
                                <div className="ipm-item-code-cell">
                                  <span className="ipm-item-code">
                                    {line.item_code}
                                  </span>
                                </div>
                                <div className="ipm-item-qty-cell">
                                  <span className="ipm-item-qty">
                                    {Number(line.delivered_qty) || 0}
                                  </span>
                                  <span className="ipm-item-qty-sub">
                                    of {Number(line.qty) || 0}
                                  </span>
                                </div>
                                <div className="ipm-item-price-cell">
                                  <span className="ipm-item-price">
                                    {Number(line.unit_price).toFixed(4)} {/* <--- UPDATED TO 4 */}
                                  </span>
                                  <span className="ipm-item-currency">
                                    {line.currency || 'PHP'}
                                  </span>
                                </div>
                                <div className="ipm-item-status-cell">
                                  {line.delivery_status === 'Partial Received' ? (
                                    <span className="ipm-deliv-badge ipm-deliv-badge--partial">
                                      <FiAlertTriangle className="ipm-deliv-icon" />
                                      <span>Partial</span>
                                    </span>
                                  ) : (
                                    <span className="ipm-deliv-badge ipm-deliv-badge--complete">
                                      <FiCheckCircle className="ipm-deliv-icon" />
                                      <span>Complete</span>
                                    </span>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* ---------- MOBILE CARDS ---------- */}
        <div className="ipm-cards">
          {grouped.map((g) => {
            const isOpen = expandedPOs.has(g.group_key);
            const isPrBased = g.has_po === 0;
            return (
              <div key={`m-${g.group_key}`} className="ipm-card">
                <div className="ipm-card-head">
                  <span className="ipm-code-pill">
                    {g.display_id}
                    {isPrBased && (
                      <span className="ipm-pr-pill" title="Grouped by PR No.">PR</span>
                    )}
                  </span>
                  {renderWarehousePill(poWarehouseMap.get(g.group_key))}
                </div>

                <div className="ipm-card-rows">
                  <div className="ipm-card-row">
                    <span className="ipm-card-key">PO Date</span>
                    <span className="ipm-card-val">{g.po_date || '—'}</span>
                  </div>
                  <div className="ipm-card-row">
                    <span className="ipm-card-key">PR No.</span>
                    <span className="ipm-card-val">{g.pr_no || '—'}</span>
                  </div>
                  <div className="ipm-card-row">
                    <span className="ipm-card-key">Vendor</span>
                    <span className="ipm-card-val">{g.vendor_name || '—'}</span>
                  </div>
                  <div className="ipm-card-row">
                    <span className="ipm-card-key">Delivery</span>
                    <span className="ipm-card-val">
                      {g.hasPartial ? (
                        <span className="ipm-deliv-badge ipm-deliv-badge--partial">
                          <FiAlertTriangle className="ipm-deliv-icon" />
                          <span>Partial ({g.partialCount})</span>
                        </span>
                      ) : (
                        <span className="ipm-deliv-badge ipm-deliv-badge--complete">
                          <FiCheckCircle className="ipm-deliv-icon" />
                          <span>Complete</span>
                        </span>
                      )}
                    </span>
                  </div>
                </div>

                <div className="ipm-card-footer">
                  <div className="ipm-card-stat">
                    <span className="ipm-card-stat-label">Lines</span>
                    <span className="ipm-card-stat-value">{g.lines.length}</span>
                  </div>
                  <div className="ipm-card-stat">
                    <span className="ipm-card-stat-label">Total (PHP)</span>
                    <span className="ipm-card-stat-value">
                      {g.funcTotal.toFixed(4)} {/* <--- UPDATED TO 4 */}
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  className="ipm-card-expand"
                  onClick={() => togglePO(g.group_key)}
                  aria-expanded={isOpen}
                >
                  {isOpen ? (
                    <>
                      <FiChevronDown className="ipm-chevron-icon" />
                      <span>Hide items ({g.lines.length})</span>
                    </>
                  ) : (
                    <>
                      <FiChevronRight className="ipm-chevron-icon" />
                      <span>Show items ({g.lines.length})</span>
                    </>
                  )}
                </button>

                {isOpen && (
                  <div className="ipm-item-list ipm-item-list--mobile">
                    {g.lines.map((line, idx) => (
                      <div className="ipm-item-line" key={`m-${g.group_key}-${idx}`}>
                        <div className="ipm-item-thumb">
                          <ItemImageThumb
                            src={itemImages[line.item_code] || null}
                            alt={line.item_code}
                            size={36}
                          />
                        </div>
                        <div className="ipm-item-code-cell">
                          <span className="ipm-item-code">
                            {line.item_code}
                          </span>
                          <span className="ipm-item-qty-sub">
                            {Number(line.delivered_qty) || 0} of {Number(line.qty) || 0} · {Number(line.unit_price).toFixed(4)} {line.currency || 'PHP'} {/* <--- UPDATED TO 4 */}
                          </span>
                        </div>
                        <div className="ipm-item-status-cell">
                          {line.delivery_status === 'Partial Received' ? (
                            <span className="ipm-deliv-badge ipm-deliv-badge--partial">
                              <FiAlertTriangle className="ipm-deliv-icon" />
                              <span>Partial</span>
                            </span>
                          ) : (
                            <span className="ipm-deliv-badge ipm-deliv-badge--complete">
                              <FiCheckCircle className="ipm-deliv-icon" />
                              <span>Complete</span>
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </>
    );
  }
};

/* ============================================================ */
const modalCss = `
@keyframes ipmFadeIn { from { opacity: 0 } to { opacity: 1 } }
@keyframes ipmSlideUp { from { opacity: 0; transform: translateY(16px) scale(0.98) } to { opacity: 1; transform: translateY(0) scale(1) } }

/* ---------- Overlay / Card ---------- */
.ipm-overlay {
  position: fixed; inset: 0;
  background: rgba(15, 23, 42, 0.62);
  backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
  display: flex; align-items: center; justify-content: center;
  z-index: 10000;
  padding: clamp(8px, 2vw, 24px);
  animation: ipmFadeIn 0.18s ease;
}
.ipm-card {
  background: #ffffff;
  border-radius: clamp(12px, 1.5vw, 18px);
  width: 100%;
  max-width: 960px;
  max-height: 92vh;
  max-height: 92dvh;
  display: flex; flex-direction: column;
  overflow: hidden;
  box-shadow: 0 24px 64px rgba(15, 23, 42, 0.28), 0 4px 14px rgba(15, 23, 42, 0.14);
  animation: ipmSlideUp 0.22s cubic-bezier(0.34, 1.3, 0.64, 1);
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}

/* ---------- Header ---------- */
.ipm-header {
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px;
  padding: clamp(16px, 2vw, 22px) clamp(18px, 2.4vw, 28px);
  border-bottom: 1px solid #e5e7eb;
  background: linear-gradient(135deg, #ffffff 0%, #f8fafc 100%);
  flex-shrink: 0;
}
.ipm-header-left { display: flex; align-items: center; gap: 14px; min-width: 0; flex: 1; }
.ipm-header-info { min-width: 0; }
.ipm-header-icon {
  width: 44px; height: 44px; border-radius: 12px;
  background: linear-gradient(135deg, #00e0d4 0%, #008a82 100%);
  color: #fff; display: flex; align-items: center; justify-content: center;
  box-shadow: 0 4px 12px rgba(0, 210, 200, 0.32);
  flex-shrink: 0;
}
.ipm-header-icon svg { width: 22px; height: 22px; stroke-width: 2.2; color: #ffffff; }
.ipm-header-title {
  margin: 0; font-size: clamp(16px, 1.6vw, 20px); font-weight: 700;
  color: #0f172a; letter-spacing: -0.01em; line-height: 1.2;
}
.ipm-header-sub {
  font-size: clamp(11px, 1vw, 13px); color: #64748b;
  font-weight: 500; margin-top: 2px;
}
.ipm-close {
  background: transparent; border: none;
  width: 36px; height: 36px; border-radius: 8px; cursor: pointer;
  color: #64748b; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
}
.ipm-close svg { width: 18px; height: 18px; stroke-width: 2.4; }
.ipm-close:hover:not(:disabled) { background: #f1f5f9; color: #0f172a; }
.ipm-close:disabled { opacity: 0.4; cursor: not-allowed; }

/* ---------- Body ---------- */
.ipm-body {
  flex: 1; min-height: 0; overflow-y: auto;
  padding: clamp(18px, 2.4vw, 28px);
  display: flex; flex-direction: column;
  gap: clamp(12px, 1.4vw, 16px);
  background: #ffffff;
  -webkit-overflow-scrolling: touch;
}
.ipm-body > * { flex-shrink: 0; }
.ipm-body::-webkit-scrollbar { width: 8px; }
.ipm-body::-webkit-scrollbar-track { background: #f1f5f9; border-radius: 4px; }
.ipm-body::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 4px; }
.ipm-body::-webkit-scrollbar-thumb:hover { background: #94a3b8; }

/* ---------- Footer ---------- */
.ipm-footer {
  display: flex; justify-content: flex-end; align-items: center; gap: 10px;
  padding: clamp(12px, 1.6vw, 18px) clamp(18px, 2.4vw, 28px);
  border-top: 1px solid #e5e7eb; background: #f8fafc;
  flex-shrink: 0; flex-wrap: wrap;
}
.ipm-footer .save-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
}
.ipm-btn-icon { width: 1em; height: 1em; stroke-width: 2.4; flex-shrink: 0; }

/* ---------- Upload step ---------- */
.ipm-intro {
  margin: 0; font-size: clamp(13px, 1.1vw, 14px);
  color: #475569; line-height: 1.55;
}
.ipm-warehouse-banner {
  display: flex; align-items: flex-start; gap: 12px;
  padding: 12px 16px;
  background: linear-gradient(135deg, #f0fdfa 0%, #ecfeff 100%);
  border: 1px solid #99f6e4; border-radius: 10px;
}
.ipm-warehouse-icon {
  display: inline-flex; align-items: center; justify-content: center;
  flex-shrink: 0; margin-top: 2px;
}
.ipm-warehouse-icon svg { width: 22px; height: 22px; stroke-width: 2.2; color: #0f766e; }
.ipm-warehouse-body { min-width: 0; }
.ipm-warehouse-label {
  font-size: 11px; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.08em; color: #0f766e;
}
.ipm-warehouse-value {
  font-size: clamp(12.5px, 1.15vw, 14px); font-weight: 600;
  color: #0f172a; word-break: break-word; line-height: 1.5;
}

/* FX + STATUS explainer banner */
.ipm-fx-banner {
  display: flex; align-items: flex-start; gap: 12px;
  padding: 12px 16px;
  background: linear-gradient(135deg, #f5f3ff 0%, #eef2ff 100%);
  border: 1px solid #c7d2fe; border-radius: 10px;
}
.ipm-fx-icon {
  display: inline-flex; align-items: center; justify-content: center;
  flex-shrink: 0; margin-top: 2px;
}
.ipm-fx-icon svg { width: 22px; height: 22px; stroke-width: 2.2; color: #4338ca; }
.ipm-fx-body { min-width: 0; }
.ipm-fx-label {
  font-size: 11px; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.08em; color: #4338ca;
}
.ipm-fx-value {
  font-size: clamp(12.5px, 1.15vw, 14px); font-weight: 500;
  color: #1e1b4b; word-break: break-word; line-height: 1.55; margin-top: 2px;
}

.ipm-policy-note {
  display: flex; align-items: flex-start; gap: 10px;
  padding: 12px 14px;
  background: #fefce8;
  border: 1px solid #fde68a; border-radius: 10px;
  font-size: 12.5px; color: #78350f; line-height: 1.55;
}
.ipm-policy-note-icon {
  display: inline-flex; align-items: center; justify-content: center;
  flex-shrink: 0; margin-top: 1px;
}
.ipm-policy-note-icon svg { width: 16px; height: 16px; stroke-width: 2.4; color: #b45309; }

.ipm-dropzone {
  display: block;
  border: 2px dashed #cbd5e1;
  border-radius: 14px;
  padding: clamp(28px, 5vw, 44px) 20px;
  text-align: center;
  cursor: pointer;
  background: #fafbfc;
  color: #475569;
  transition: border-color 0.15s ease, background 0.15s ease, transform 0.15s ease;
}
.ipm-dropzone--active {
  border-color: #00d2c8;
  background: #f0fdfa;
  transform: scale(1.01);
}
.ipm-dropzone--busy { opacity: 0.7; cursor: wait; }
.ipm-drop-icon {
  display: flex; justify-content: center; margin-bottom: 8px;
}
.ipm-drop-icon svg { width: clamp(32px, 5vw, 44px); height: clamp(32px, 5vw, 44px); stroke-width: 1.5; color: #94a3b8; }
.ipm-drop-title {
  font-size: clamp(14px, 1.3vw, 16px); font-weight: 600;
  color: #0f172a; margin-bottom: 4px;
}
.ipm-drop-hint { font-size: clamp(11px, 1vw, 13px); color: #64748b; }
.ipm-file-input { display: none; }

.ipm-expected-block {
  padding: 14px 16px;
  background: #f8fafc; border-radius: 10px;
  border: 1px solid #e5e7eb;
}
.ipm-expected-title {
  font-size: 12px; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.08em;
  color: #64748b; margin-bottom: 8px;
}
.ipm-expected-list { display: flex; flex-wrap: wrap; gap: 6px; }
.ipm-chip {
  font-size: 11px; font-weight: 600;
  padding: 3px 10px;
  background: #ffffff;
  border: 1px solid #e2e8f0; border-radius: 999px;
  color: #334155;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  letter-spacing: 0.02em;
}
.ipm-chip--highlight {
  background: #ecfeff; border-color: #a5f3fc; color: #0e7490;
}
.ipm-chip--fx {
  background: #eef2ff; border-color: #c7d2fe; color: #4338ca;
}
.ipm-chip--status {
  background: #fef3c7; border-color: #fcd34d; color: #92400e;
  font-weight: 700;
}

/* ---------- Preview step ---------- */
.ipm-file-summary {
  display: flex; align-items: center; gap: 14px;
  padding: 14px 16px;
  background: linear-gradient(135deg, #f0fdfa 0%, #ecfeff 100%);
  border: 1px solid #99f6e4; border-radius: 10px;
}
.ipm-file-summary-icon {
  width: 40px; height: 40px; border-radius: 10px;
  background: #ffffff;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.06);
}
.ipm-file-summary-icon svg { width: 20px; height: 20px; stroke-width: 2.2; color: #0f766e; }
.ipm-file-summary-info { min-width: 0; flex: 1; }
.ipm-file-name {
  font-size: clamp(13px, 1.2vw, 15px); font-weight: 600;
  color: #0f172a;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ipm-file-meta {
  font-size: clamp(11px, 1vw, 13px); color: #475569; margin-top: 2px;
}
.ipm-error-inline { color: #dc2626; font-weight: 600; }

.ipm-error-details {
  font-size: 13px; padding: 10px 14px;
  background: #fef2f2;
  border: 1px solid #fecaca; border-radius: 8px;
}
.ipm-error-summary {
  cursor: pointer; color: #b91c1c; font-weight: 600;
  display: inline-flex; align-items: center; gap: 6px;
}
.ipm-error-summary-icon { width: 1em; height: 1em; stroke-width: 2.4; flex-shrink: 0; color: #dc2626; }
.ipm-error-list {
  margin-top: 6px; max-height: 140px; overflow-y: auto;
  padding-left: 22px; color: #7f1d1d; font-size: 12px; line-height: 1.6;
}

/* ---------- Preview toolbar ---------- */
.ipm-preview-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}
.ipm-toolbar-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  border-radius: 8px;
  border: 1px solid #cbd5e1;
  background: #ffffff;
  color: #334155;
  font-size: 12px;
  font-weight: 700;
  font-family: inherit;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;
}
.ipm-toolbar-btn:hover:not(:disabled) {
  background: #f8fafc;
  border-color: #94a3b8;
}
.ipm-toolbar-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.ipm-toolbar-icon { width: 1em; height: 1em; stroke-width: 2.6; flex-shrink: 0; }
.ipm-toolbar-hint {
  font-size: 11.5px;
  color: #94a3b8;
  font-weight: 500;
}

/* ---------- Preview table ---------- */
.ipm-table-wrap {
  overflow: auto;
  max-height: 380px;
  min-height: 160px;
  flex-shrink: 0;
  border: 1px solid #e2e8f0; border-radius: 10px;
  background: #ffffff;
}
.ipm-table {
  width: 100%; border-collapse: collapse;
  min-width: 880px;
  font-size: clamp(12px, 1.1vw, 14px);
}
.ipm-table thead th {
  padding: 12px 14px; text-align: left;
  font-size: 11px; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.06em;
  color: #64748b; background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
  position: sticky; top: 0; z-index: 1;
  white-space: nowrap;
}
.ipm-th-center { text-align: center !important; }
.ipm-th-right  { text-align: right !important; }
.ipm-th-expand { width: 36px; }

.ipm-tr { border-bottom: 1px solid #f1f5f9; }
.ipm-tr--clickable {
  cursor: pointer;
  transition: background 0.12s ease;
}
.ipm-tr--clickable:hover { background: #f8fafc; }
.ipm-tr--clickable.is-open { background: #f0fdfa; }
.ipm-tr--clickable:focus-visible {
  outline: 2px solid #00b8b0;
  outline-offset: -2px;
}

.ipm-td {
  padding: 12px 14px; color: #0f172a;
  font-size: clamp(12px, 1.1vw, 14px);
  vertical-align: middle;
}
.ipm-td-center { text-align: center !important; }
.ipm-td-right  { text-align: right !important; }
.ipm-td-bold   { font-weight: 600; }
.ipm-td-expand { width: 36px; padding-left: 10px; padding-right: 4px; }

.ipm-expand-chevron {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px; height: 22px;
  border-radius: 6px;
  color: #94a3b8;
  transition: background 0.15s ease, color 0.15s ease;
}
.ipm-tr--clickable:hover .ipm-expand-chevron { background: #e2e8f0; color: #334155; }
.ipm-tr--clickable.is-open .ipm-expand-chevron { background: #ccfbf1; color: #0f766e; }
.ipm-chevron-icon { width: 1em; height: 1em; stroke-width: 2.8; }

.ipm-code-pill {
  display: inline-block; padding: 3px 10px;
  background: #ecfeff; color: #0e7490;
  border: 1px solid #a5f3fc; border-radius: 6px;
  font-size: 12px; font-weight: 700;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  letter-spacing: 0.02em; white-space: nowrap;
}

/* ---------- Warehouse pill ---------- */
.ipm-warehouse-pill {
  display: inline-flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  gap: 1px;
  padding: 4px 10px;
  background: #eef2ff;
  border: 1px solid #c7d2fe;
  border-radius: 6px;
  max-width: 220px;
  min-width: 0;
  box-sizing: border-box;
  vertical-align: middle;
  line-height: 1.2;
}
.ipm-warehouse-pill-code {
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-size: 13px;
  font-weight: 800;
  color: #3730a3;
  letter-spacing: 0.04em;
  line-height: 1.2;
  white-space: nowrap;
}
.ipm-warehouse-pill-name {
  font-size: 10.5px;
  font-weight: 500;
  color: #6366f1;
  line-height: 1.25;
  letter-spacing: 0.01em;
  word-break: break-word;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  max-width: 100%;
}
.ipm-warehouse-pill--code-only {
  padding: 4px 10px;
}
.ipm-warehouse-pill--code-only .ipm-warehouse-pill-code {
  font-size: 13px;
  color: #3730a3;
}
.ipm-warehouse-pill--empty {
  display: inline-block;
  padding: 3px 10px;
  font-size: 12px;
  font-weight: 600;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  color: #94a3b8;
  background: #f8fafc;
  border-color: #e2e8f0;
}

/* Delivery badge */
.ipm-deliv-badge {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 11px; font-weight: 700; letter-spacing: 0.02em;
  white-space: nowrap;
}
.ipm-deliv-badge svg { width: 1em; height: 1em; stroke-width: 2.4; flex-shrink: 0; }
.ipm-deliv-badge--complete {
  background: #dcfce7; color: #065f46; border: 1px solid #86efac;
}
.ipm-deliv-badge--partial {
  background: #fef3c7; color: #92400e; border: 1px solid #fcd34d;
}

.ipm-fx-note {
  font-size: 9px; font-weight: 800; color: #4338ca;
  background: #eef2ff; border: 1px solid #c7d2fe;
  padding: 1px 5px; border-radius: 4px;
  margin-left: 6px; letter-spacing: 0.06em;
  vertical-align: middle;
}

/* ---------- Expanded row (item detail) ---------- */
.ipm-tr-expanded { background: #f8fafc; }
.ipm-td-expanded {
  padding: 0 !important;
  border-bottom: 1px solid #e2e8f0;
}
.ipm-item-list {
  display: flex;
  flex-direction: column;
  padding: 8px 14px 12px 50px;
  gap: 6px;
  background: linear-gradient(180deg, #f0fdfa 0%, #ffffff 100%);
  border-top: 1px dashed #cbd5e1;
}
.ipm-item-line {
  display: grid;
  grid-template-columns: 44px minmax(160px, 1.4fr) minmax(80px, 0.8fr) minmax(120px, 1fr) minmax(110px, 0.9fr);
  align-items: center;
  gap: 12px;
  padding: 6px 10px;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
}
.ipm-item-thumb {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.ipm-item-code-cell {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.ipm-item-code {
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-size: 12.5px;
  font-weight: 700;
  color: #4338ca;
  line-height: 1.2;
  word-break: break-word;
}
.ipm-item-qty-cell {
  display: flex;
  align-items: baseline;
  gap: 6px;
}
.ipm-item-qty {
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-size: 14px;
  font-weight: 700;
  color: #047857;
  line-height: 1.2;
}
.ipm-item-qty-sub {
  font-size: 11px;
  font-weight: 500;
  color: #64748b;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
}
.ipm-item-price-cell {
  display: flex;
  align-items: baseline;
  gap: 5px;
  min-width: 0;
}
.ipm-item-price {
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-size: 12.5px;
  font-weight: 700;
  color: #0f172a;
}
.ipm-item-currency {
  font-size: 10px;
  font-weight: 700;
  color: #64748b;
  letter-spacing: 0.04em;
}
.ipm-item-status-cell {
  display: flex;
  justify-content: flex-end;
}

/* Mobile expanded list — code cell stacks tighter */
.ipm-item-list--mobile {
  padding: 8px 12px 12px 12px;
  background: #ffffff;
  border-top: 1px dashed #e2e8f0;
  margin: 0 -12px -12px -12px;
  border-radius: 0 0 10px 10px;
}
.ipm-item-list--mobile .ipm-item-line {
  grid-template-columns: 44px 1fr auto;
  gap: 10px;
}

/* ---------- Preview cards (hidden on desktop) ---------- */
.ipm-cards { display: none; }

/* ---------- New: optional-column note + PR-based pill ---------- */
.ipm-chip-note {
  display: inline-block;
  margin-left: 4px;
  font-size: 9px;
  font-weight: 600;
  color: #94a3b8;
  letter-spacing: 0;
  text-transform: none;
}
.ipm-pr-pill {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 6px;
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.06em;
  color: #9a3412;
  background: #fff7ed;
  border: 1px solid #fed7aa;
  border-radius: 4px;
  vertical-align: middle;
}

/* ============================================================
   TABLET — 641 to 900px
   ============================================================ */
@media (max-width: 900px) {
  .ipm-card { max-width: 96vw; }
  .ipm-body { padding: 16px; }
  .ipm-header { padding: 14px 18px; }
  .ipm-footer { padding: 12px 16px; }
  .ipm-table-wrap { max-height: 42vh; }

  .ipm-item-list { padding-left: 32px; }
  .ipm-item-line {
    grid-template-columns: 40px minmax(140px, 1.4fr) minmax(70px, 0.8fr) minmax(110px, 1fr) minmax(100px, 0.9fr);
    gap: 10px;
    padding: 6px 8px;
  }

  .ipm-warehouse-pill { max-width: 180px; }
}

/* ============================================================
   MOBILE — ≤ 640px : full screen, table → cards
   ============================================================ */
@media (max-width: 640px) {
  .ipm-overlay { padding: 0 !important; align-items: stretch !important; }
  .ipm-card {
    max-height: 100vh !important;
    max-height: 100dvh !important;
    width: 100vw !important;
    max-width: 100vw !important;
    height: 100vh !important;
    height: 100dvh !important;
    border-radius: 0 !important;
    animation: none !important;
  }

  .ipm-header { padding: 12px 14px !important; }
  .ipm-header-icon { width: 36px !important; height: 36px !important; border-radius: 10px !important; }
  .ipm-header-icon svg { width: 18px !important; height: 18px !important; }
  .ipm-header-title { font-size: 15px !important; }
  .ipm-header-sub { font-size: 11px !important; }

  .ipm-body { padding: 14px !important; gap: 12px !important; }

  .ipm-dropzone { padding: 32px 16px !important; }
  .ipm-drop-icon svg { width: 36px !important; height: 36px !important; }
  .ipm-drop-title { font-size: 14px !important; }
  .ipm-drop-hint { font-size: 11px !important; }

  .ipm-warehouse-banner { padding: 10px 12px !important; gap: 10px !important; }
  .ipm-warehouse-icon svg { width: 20px !important; height: 20px !important; }
  .ipm-warehouse-label { font-size: 10px !important; }
  .ipm-warehouse-value { font-size: 12px !important; }

  .ipm-fx-banner { padding: 10px 12px !important; gap: 10px !important; }
  .ipm-fx-icon svg { width: 20px !important; height: 20px !important; }
  .ipm-fx-label { font-size: 10px !important; }
  .ipm-fx-value { font-size: 12px !important; }

  .ipm-policy-note { font-size: 12px !important; padding: 10px 12px !important; }

  .ipm-expected-block { padding: 12px 14px !important; }
  .ipm-expected-list { gap: 4px !important; }
  .ipm-chip { font-size: 10px !important; padding: 2px 8px !important; }

  .ipm-file-summary { padding: 12px 14px !important; gap: 10px !important; }
  .ipm-file-summary-icon { width: 34px !important; height: 34px !important; }
  .ipm-file-summary-icon svg { width: 17px !important; height: 17px !important; }
  .ipm-file-name { font-size: 13px !important; }
  .ipm-file-meta { font-size: 11px !important; }

  .ipm-preview-toolbar { display: none !important; }
  .ipm-table-wrap { display: none !important; }
  .ipm-cards {
    display: flex !important;
    flex-direction: column;
    gap: 10px;
  }

  .ipm-card {
    border: 1px solid #e2e8f0; border-radius: 10px;
    background: #ffffff;
    padding: 12px;
    display: flex; flex-direction: column; gap: 10px;
  }
  .ipm-card-head {
    display: flex; align-items: center; justify-content: space-between;
    gap: 8px; flex-wrap: wrap;
  }
  .ipm-card-rows {
    display: flex; flex-direction: column; gap: 6px;
    padding: 8px 0;
    border-top: 1px dashed #e5e7eb;
    border-bottom: 1px dashed #e5e7eb;
  }
  .ipm-card-row {
    display: flex; justify-content: space-between; align-items: center;
    gap: 8px; font-size: 12.5px;
  }
  .ipm-card-key {
    font-size: 10px; font-weight: 700; color: #64748b;
    text-transform: uppercase; letter-spacing: 0.04em;
    flex-shrink: 0;
  }
  .ipm-card-val {
    color: #0f172a; font-weight: 600; text-align: right;
    word-break: break-word;
  }
  .ipm-card-footer {
    display: grid; grid-template-columns: 1fr 1fr; gap: 10px;
  }
  .ipm-card-stat {
    display: flex; flex-direction: column; gap: 2px; align-items: center;
  }
  .ipm-card-stat-label {
    font-size: 9px; font-weight: 700; color: #64748b;
    text-transform: uppercase; letter-spacing: 0.04em;
    text-align: center;
  }
  .ipm-card-stat-value {
    font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
    font-size: 15px; font-weight: 700; color: #0f172a;
  }

  .ipm-warehouse-pill {
    max-width: 100%;
    width: auto;
  }

  .ipm-card-expand {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 9px 12px;
    border-radius: 8px;
    border: 1px solid #99f6e4;
    background: #f0fdfa;
    color: #0f766e;
    font-size: 13px;
    font-weight: 700;
    font-family: inherit;
    cursor: pointer;
    transition: background 0.15s ease, border-color 0.15s ease;
  }
  .ipm-card-expand:hover { background: #ccfbf1; border-color: #5eead4; }
  .ipm-card-expand .ipm-chevron-icon { width: 1em; height: 1em; stroke-width: 2.8; }

  .ipm-footer { padding: 10px 14px !important; gap: 8px !important; }
  .ipm-footer > button {
    flex: 1 1 auto; min-height: 44px;
    padding: 12px 16px !important; font-size: 14px !important;
  }
}

/* ============================================================
   VERY SMALL PHONES — ≤ 380px
   ============================================================ */
@media (max-width: 380px) {
  .ipm-header-icon { width: 32px !important; height: 32px !important; }
  .ipm-header-icon svg { width: 16px !important; height: 16px !important; }
  .ipm-header-title { font-size: 14px !important; }
  .ipm-card-footer { grid-template-columns: 1fr; }
  .ipm-footer { flex-direction: column-reverse !important; }
  .ipm-footer > button { width: 100%; }
  .ipm-dropzone { padding: 24px 12px !important; }

  .ipm-item-list--mobile .ipm-item-line {
    grid-template-columns: 38px 1fr;
    row-gap: 6px;
  }
  .ipm-item-list--mobile .ipm-item-status-cell {
    grid-column: 1 / -1;
    justify-content: flex-start;
  }

  .ipm-warehouse-pill-code { font-size: 12px; }
  .ipm-warehouse-pill-name { font-size: 10px; }
}

/* ============================================================
   SHORT LANDSCAPE PHONE
   ============================================================ */
@media (max-height: 500px) and (orientation: landscape) {
  .ipm-overlay { padding: 8px !important; align-items: center !important; }
  .ipm-card {
    height: auto !important; max-height: 96vh !important;
    border-radius: 12px !important; max-width: 96vw !important;
  }
  .ipm-header { padding: 8px 14px !important; }
  .ipm-body   { padding: 10px 14px !important; gap: 10px !important; }
  .ipm-footer { padding: 8px 14px !important; }
  .ipm-dropzone { padding: 18px 14px !important; }
  .ipm-drop-icon svg { width: 28px !important; height: 28px !important; }
  .ipm-drop-icon { margin-bottom: 4px !important; }
}

/* ============================================================
   ULTRA-WIDE — ≥ 1921px (4K monitors, very large screens)
   ============================================================ */
@media (min-width: 1921px) {
  .ipm-card {
    max-width: 1100px;
    border-radius: 22px;
  }

  .ipm-header { padding: 26px 36px; }
  .ipm-header-icon { width: 52px; height: 52px; border-radius: 14px; }
  .ipm-header-icon svg { width: 26px; height: 26px; }
  .ipm-header-title { font-size: 22px; }
  .ipm-header-sub   { font-size: 14px; }

  .ipm-body { padding: 32px 36px; gap: 20px; }
  .ipm-footer { padding: 20px 36px; gap: 12px; }
  .ipm-footer > button { padding: 14px 22px !important; font-size: 15px !important; }

  .ipm-table-wrap { max-height: 460px; }
  .ipm-table { min-width: 1040px; }
  .ipm-table thead th { padding: 14px 18px; font-size: 12px; }
  .ipm-td { padding: 14px 18px; font-size: 14px; }

  .ipm-item-list { padding: 10px 18px 14px 56px; gap: 8px; }
  .ipm-item-line {
    grid-template-columns:
      52px
      minmax(200px, 1.6fr)
      minmax(100px, 0.7fr)
      minmax(140px, 0.9fr)
      minmax(130px, 0.8fr);
    gap: 16px;
    padding: 10px 14px;
  }
  .ipm-item-code   { font-size: 14px; }
  .ipm-item-qty    { font-size: 16px; }
  .ipm-item-qty-sub{ font-size: 12px; }
  .ipm-item-price  { font-size: 14px; }
  .ipm-item-currency { font-size: 11px; }

  .ipm-code-pill,
  .ipm-warehouse-pill {
    font-size: 13px;
    padding: 4px 12px;
  }
  .ipm-warehouse-pill-code { font-size: 15px; }
  .ipm-warehouse-pill-name { font-size: 12px; }
  .ipm-warehouse-pill { max-width: 260px; }
  .ipm-deliv-badge { font-size: 12px; padding: 4px 12px; }
  .ipm-chip        { font-size: 12px; padding: 4px 12px; }

  .ipm-toolbar-btn  { padding: 9px 18px; font-size: 13px; }
  .ipm-toolbar-hint { font-size: 12.5px; }

  .ipm-intro { font-size: 15px; }
  .ipm-warehouse-value,
  .ipm-fx-value { font-size: 15px; }
  .ipm-policy-note { font-size: 13.5px; padding: 14px 18px; }
  .ipm-drop-title { font-size: 18px; }
  .ipm-drop-hint  { font-size: 14px; }
  .ipm-file-name  { font-size: 16px; }
  .ipm-file-meta  { font-size: 14px; }
}

/* ============================================================
   REDUCED MOTION
   ============================================================ */
@media (prefers-reduced-motion: reduce) {
  .ipm-card, .ipm-overlay { animation: none !important; }
  .ipm-dropzone { transition: none !important; }
  .ipm-tr--clickable { transition: none !important; }
  .ipm-expand-chevron { transition: none !important; }
  .ipm-toolbar-btn { transition: none !important; }
  .ipm-card-expand { transition: none !important; }
}
`;

export default ImportPoModal;