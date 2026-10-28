// src/components/locator/LocatorSyncHistory.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FiRefreshCw, FiLoader, FiInbox, FiAlertTriangle, FiFileText,
  FiGrid, FiDownload, FiChevronLeft, FiChevronRight,
  FiChevronsLeft, FiChevronsRight, FiSearch, FiX, FiClock,
  FiUser, FiHash, FiPackage, FiDollarSign, FiZap, FiUploadCloud,
  FiTruck, FiSave, FiSend, FiCheckCircle, FiChevronDown,
} from 'react-icons/fi';
import * as XLSX from 'xlsx';
import { locatorLogApi } from '../../services/api';
import { useToast } from '../shared/ToastProvider';

const PAGE_SIZE       = 50;
const LINES_PAGE_SIZE = 50;
const DEBOUNCE_MS     = 300;

const intFmt = new Intl.NumberFormat('en-PH');
const curFmt = new Intl.NumberFormat('en-PH', {
  style: 'currency', currency: 'PHP',
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});
const fmtInt = (n) => intFmt.format(Number(n) || 0);
const fmtCur = (n) => curFmt.format(Number(n) || 0);

const fmtDateTime = (value) => {
  if (!value) return '—';
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'medium' });
  } catch { return '—'; }
};

const fmtTimestamp = (value) => {
  if (!value) return { date: '—', time: '' };
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return { date: '—', time: '' };
    return {
      date: d.toLocaleDateString('en-PH', {
        year: 'numeric', month: 'short', day: '2-digit',
      }),
      time: d.toLocaleTimeString('en-PH', {
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
      }),
    };
  } catch { return { date: '—', time: '' }; }
};

const shortHash = (hash) => {
  if (!hash) return '—';
  return hash.slice(0, 8) + '...' + hash.slice(-6);
};

const buildPageList = (current, total) => {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = [1];
  if (current > 3) pages.push('...');
  const start = Math.max(2, current - 1);
  const end   = Math.min(total - 1, current + 1);
  for (let i = start; i <= end; i++) pages.push(i);
  if (current < total - 2) pages.push('...');
  pages.push(total);
  return pages;
};

const deriveMethod = (r) => {
  const isReconcile = String(r.action_type || '') === 'Underground Reconciliation';
  const fmt         = String(r.export_format || '').toLowerCase();
  const noFile      = !r.filename && !r.file_hash;

  if (isReconcile) {
    if (fmt === 'crossdb' || fmt === 'cross-db') {
      return {
        kind:   'cross-db',
        label:  'Cross-DB Pull',
        source: 'Underground · cross-DB online',
        Icon:   FiTruck,
        tone:   'cross-db',
      };
    }
    const isOnline = fmt === 'online' || (noFile && fmt !== '');
    if (isOnline) {
      return {
        kind:   'online',
        label:  'Online Sync',
        source: 'Underground · online sync',
        Icon:   FiZap,
        tone:   'indigo',
      };
    }
    return {
      kind:   'file',
      label:  'Excel',
      source: 'Underground · closing file',
      Icon:   FiUploadCloud,
      tone:   'excel',
    };
  }

  if (fmt === 'pdf')   return { kind: 'pdf',   label: 'PDF',   source: null, Icon: FiFileText, tone: 'pdf' };
  if (fmt === 'excel') return { kind: 'excel', label: 'Excel', source: null, Icon: FiGrid,     tone: 'excel' };
  return {
    kind: 'other', label: r.export_format || '—',
    source: null, Icon: FiDownload, tone: 'default',
  };
};

const deriveAction = (r) => {
  const at  = String(r.action_type || '').trim();
  const dir = String(r.direction    || '').trim();
  const m   = deriveMethod(r);

  if (at === 'Underground Reconciliation') {
    if (m.kind === 'cross-db') return { label: 'Sync · Cross-DB', Icon: FiTruck,       tone: 'sync-cross-db' };
    if (m.kind === 'online')   return { label: 'Sync · Online',   Icon: FiZap,         tone: 'sync-online'   };
    return                            { label: 'Sync · File',     Icon: FiUploadCloud, tone: 'sync-file'     };
  }
  if (at === 'Underground Shift Close') return { label: 'Shift Close', Icon: FiSave,     tone: 'close'  };
  if (at === 'Underground Seed Import') return { label: 'Seed Import', Icon: FiSend,     tone: 'seed'   };
  if (at === 'Manual Export')           return { label: 'Export',      Icon: FiDownload, tone: 'export' };
  if (dir === 'Export')                 return { label: 'Export',      Icon: FiDownload, tone: 'export' };
  if (dir === 'Import')                 return { label: 'Import',      Icon: FiTruck,    tone: 'import' };
  return { label: at || '—', Icon: FiPackage, tone: 'default' };
};

const linkedStatusPillClass = (status) => {
  const s = String(status || '').toLowerCase();
  if (s === 'open')       return 'ledm-shift-pill ledm-shift-pill--open';
  if (s === 'closed')     return 'ledm-shift-pill ledm-shift-pill--closed';
  if (s === 'reconciled') return 'ledm-shift-pill ledm-shift-pill--reconciled';
  return 'ledm-shift-pill ledm-shift-pill--none';
};

const getLineKindTone = (kind) => {
  const k = String(kind || '').toLowerCase();
  if (k === 'damage') return 'damaged';
  if (k === 'transfer-out' || k === 'transfer-in') return 'transferred';
  return 'issued';
};

// ============================================================
// Reusable Excel/Word export builders (used by both single-row
// and bulk export, and by the detail modal).
// ============================================================
const buildExcelRows = (rows) =>
  rows.map((r) => {
    const m = deriveMethod(r);
    const a = deriveAction(r);
    return {
      'UID': r.export_uid,
      'Direction': r.direction,
      'Action': a.label,
      'Method': m.label,
      'Warehouse': r.source_warehouse_code,
      'Shift ID': r.linked_shift_id || '—',
      'Performed By': r.performed_by_username,
      'Position': r.performed_by_position || '—',
      'Performed At': fmtDateTime(r.performed_at),
      'Locators': Number(r.locator_count) || 0,
      'Items': Number(r.item_row_count) || 0,
      'Total Qty': Number(r.total_qty) || 0,
      'Total Value': Number(r.total_value) || 0,
      'File Hash': r.file_hash || '—',
    };
  });

const buildWordHtml = (rows, title = 'Inventory Locator - Sync History') => {
  let html = `
    <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
    <head>
      <title>${title}</title>
      <style>
        body { font-family: Arial, sans-serif; font-size: 10pt; }
        h1 { font-size: 16pt; color: #0f172a; }
        table { border-collapse: collapse; width: 100%; margin-top: 10px; }
        th, td { border: 1px solid #ccc; padding: 6px; text-align: left; }
        th { background: #f1f5f9; font-weight: bold; }
        .num { text-align: right; }
      </style>
    </head>
    <body>
      <h1>${title}</h1>
      <p>Exported: ${new Date().toLocaleString()}</p>
      <table>
        <thead>
          <tr>
            <th>UID</th>
            <th>Direction</th>
            <th>Action</th>
            <th>Method</th>
            <th>Warehouse</th>
            <th>Shift</th>
            <th>Performed By</th>
            <th>Performed At</th>
            <th class="num">Locators</th>
            <th class="num">Items</th>
            <th class="num">Total Qty</th>
            <th class="num">Total Value</th>
          </tr>
        </thead>
        <tbody>
  `;

  rows.forEach((r) => {
    const m = deriveMethod(r);
    const a = deriveAction(r);
    const ts = fmtDateTime(r.performed_at);
    html += `
      <tr>
        <td>${r.export_uid || '—'}</td>
        <td>${r.direction || '—'}</td>
        <td>${a.label}</td>
        <td>${m.label}</td>
        <td>${r.source_warehouse_code || '—'}</td>
        <td>${r.linked_shift_id ? '#' + r.linked_shift_id : '—'}</td>
        <td>${r.performed_by_username || '—'}${r.performed_by_position ? ' (' + r.performed_by_position + ')' : ''}</td>
        <td>${ts}</td>
        <td class="num">${fmtInt(r.locator_count)}</td>
        <td class="num">${fmtInt(r.item_row_count)}</td>
        <td class="num">${fmtInt(r.total_qty)}</td>
        <td class="num">${fmtCur(r.total_value)}</td>
      </tr>
    `;
  });

  html += `</tbody></table></body></html>`;
  return html;
};

// ============================================================
// Main component
// ============================================================
const LocatorSyncHistory = () => {
  const toast = useToast();

  const [rows, setRows]               = useState([]);
  const [total, setTotal]             = useState(0);
  const [totalPages, setTotalPages]   = useState(1);
  const [page, setPage]               = useState(1);
  const [loading, setLoading]         = useState(false);
  const [refreshing, setRefreshing]   = useState(false);
  const [error, setError]             = useState(null);

  const [search, setSearch]                   = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [dirFilter, setDirFilter]             = useState('all');

  const [detailId, setDetailId] = useState(null);

  // Export dropdown state (for the toolbar bulk export)
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting]   = useState(false);
  const exportRef = useRef(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [search]);

  // Click outside to close export dropdown
  useEffect(() => {
    if (!exportOpen) return;
    const onDoc = (e) => {
      if (exportRef.current && !exportRef.current.contains(e.target)) {
        setExportOpen(false);
      }
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setExportOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [exportOpen]);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const res = await locatorLogApi.list({
        page,
        limit:  PAGE_SIZE,
        search: debouncedSearch || undefined,
      });
      if (res.ok) {
        setRows(Array.isArray(res.data) ? res.data : []);
        setTotal(Number(res.total) || 0);
        setTotalPages(Math.max(Number(res.totalPages) || 1, 1));
      } else {
        setError(res?.data?.message || 'Failed to fetch sync history.');
        setRows([]);
        setTotal(0);
        setTotalPages(1);
      }
    } catch (err) {
      console.error('History load error:', err);
      setError(err?.message || 'Failed to fetch sync history.');
      setRows([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [page, debouncedSearch]);

  useEffect(() => { load(); }, [load]);

  const goToPage = (p) => {
    const next = Math.max(1, Math.min(totalPages, p));
    if (next !== page) setPage(next);
  };

  const visibleRows = useMemo(() => {
    if (dirFilter === 'all') return rows;
    const want = dirFilter === 'export' ? 'Export' : 'Import';
    return rows.filter((r) => String(r.direction || '') === want);
  }, [rows, dirFilter]);

  const pageList = useMemo(() => buildPageList(page, totalPages), [page, totalPages]);

  const showingStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const showingEnd   = Math.min(page * PAGE_SIZE, total);

  /* ============================================================
     EXPORT HANDLERS
     ============================================================ */
  const downloadExcel = (dataRows, filename) => {
    const ws = XLSX.utils.json_to_sheet(dataRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sync History');
    ws['!cols'] = [
      { wch: 15 }, { wch: 10 }, { wch: 18 }, { wch: 15 }, { wch: 12 },
      { wch: 10 }, { wch: 20 }, { wch: 20 }, { wch: 22 }, { wch: 10 },
      { wch: 10 }, { wch: 12 }, { wch: 15 }, { wch: 30 },
    ];
    XLSX.writeFile(wb, filename);
  };

  const downloadWord = (html, filename) => {
    const blob = new Blob(['\ufeff', html], { type: 'application/msword' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleExportExcel = () => {
    if (visibleRows.length === 0) {
      toast.warning('No records to export.');
      return;
    }
    setExporting(true);
    try {
      downloadExcel(buildExcelRows(visibleRows), `Sync_History_${new Date().toISOString().split('T')[0]}.xlsx`);
      toast.success('Excel file downloaded.');
    } catch (err) {
      console.error('Excel export error:', err);
      toast.error('Failed to export Excel.');
    } finally {
      setExporting(false);
      setExportOpen(false);
    }
  };

  const handleExportWord = () => {
    if (visibleRows.length === 0) {
      toast.warning('No records to export.');
      return;
    }
    setExporting(true);
    try {
      downloadWord(
        buildWordHtml(visibleRows),
        `Sync_History_${new Date().toISOString().split('T')[0]}.doc`
      );
      toast.success('Word document downloaded.');
    } catch (err) {
      console.error('Word export error:', err);
      toast.error('Failed to export Word document.');
    } finally {
      setExporting(false);
      setExportOpen(false);
    }
  };

  // ⚡ NEW: Export a single row directly from the table
  const handleExportSingleRow = (row, e) => {
    e.stopPropagation(); // Prevent row click from opening the modal
    try {
      downloadExcel(buildExcelRows([row]), `Sync_${row.export_uid || 'Record'}.xlsx`);
      toast.success(`Exported ${row.export_uid}`);
    } catch (err) {
      console.error('Single row export error:', err);
      toast.error('Failed to export record.');
    }
  };

  return (
    <div className="lehist-root">
      <style>{historyCss}</style>

      <div className="lehist-toolbar">
        <div className="lehist-search-wrap">
          <span className="lehist-search-icon" aria-hidden="true"><FiSearch /></span>
          <input
            type="text"
            className="lehist-search-input"
            placeholder="Search by UID, username, warehouse, or filename…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search history"
          />
          {search && (
            <button
              type="button"
              className="lehist-search-clear"
              onClick={() => setSearch('')}
              aria-label="Clear search"
            >
              <FiX />
            </button>
          )}
        </div>

        <div className="lehist-dirchips" role="group" aria-label="Filter by direction">
          {['all', 'export', 'import'].map((k) => (
            <button
              key={k}
              type="button"
              className={`lehist-dirchip ${dirFilter === k ? 'is-active' : ''}`}
              onClick={() => setDirFilter(k)}
              aria-pressed={dirFilter === k}
            >
              {k === 'all' ? 'All' : k === 'export' ? 'Exports' : 'Imports'}
            </button>
          ))}
        </div>

        {/* Bulk Export Dropdown */}
        <div className="lehist-export-wrap" ref={exportRef}>
          <button
            type="button"
            className={`lehist-export-btn ${exportOpen ? 'is-open' : ''}`}
            onClick={() => setExportOpen((v) => !v)}
            disabled={exporting || visibleRows.length === 0}
          >
            {exporting ? <FiLoader className="icon-spin" /> : <FiDownload />}
            <span>Export</span>
            {!exporting && <FiChevronDown className={`lehist-export-caret ${exportOpen ? 'is-open' : ''}`} />}
          </button>

          {exportOpen && !exporting && (
            <ul className="lehist-export-menu" role="menu">
              <li role="none">
                <button type="button" role="menuitem" className="lehist-export-item" onClick={handleExportExcel}>
                  <span className="lehist-export-item-icon lehist-export-item-icon--xls"><FiGrid /></span>
                  <span className="lehist-export-item-body">
                    <span className="lehist-export-item-title">Export to Excel</span>
                    <span className="lehist-export-item-sub">Spreadsheet with all visible columns</span>
                  </span>
                </button>
              </li>
              <li role="none">
                <button type="button" role="menuitem" className="lehist-export-item" onClick={handleExportWord}>
                  <span className="lehist-export-item-icon lehist-export-item-icon--doc"><FiFileText /></span>
                  <span className="lehist-export-item-body">
                    <span className="lehist-export-item-title">Export to Word</span>
                    <span className="lehist-export-item-sub">Document table for printing</span>
                  </span>
                </button>
              </li>
            </ul>
          )}
        </div>

        <button
          type="button"
          className="lehist-refresh"
          onClick={() => load({ silent: true })}
          disabled={loading || refreshing}
        >
          <span className={refreshing ? 'icon-spin' : ''} aria-hidden="true">
            <FiRefreshCw />
          </span>
          <span>{refreshing ? 'Refreshing…' : 'Refresh'}</span>
        </button>
      </div>

      {error && (
        <div className="lehist-error" role="alert">
          <FiAlertTriangle />
          <span>{error}</span>
          <button type="button" onClick={() => load()}>Try again</button>
        </div>
      )}

      {loading && (
        <div className="lehist-loading">
          <FiLoader className="icon-spin" />
          <span>Loading history…</span>
        </div>
      )}

      {!loading && !error && visibleRows.length === 0 && (
        <div className="lehist-empty">
          <FiInbox />
          <div className="lehist-empty-title">
            {debouncedSearch
              ? 'No records match your search'
              : dirFilter !== 'all'
                ? `No ${dirFilter} records on this page`
                : 'No sync records yet'}
          </div>
          <div className="lehist-empty-sub">
            {debouncedSearch
              ? 'Try a different search term.'
              : dirFilter !== 'all'
                ? 'Try "All" or go to another page.'
                : 'Your export and sync history will appear here.'}
          </div>
        </div>
      )}

      {!loading && !error && visibleRows.length > 0 && (
        <>
          <div className="lehist-table-wrap">
            <table className="lehist-table">
              <thead>
                <tr>
                  <th scope="col">UID</th>
                  <th scope="col">Direction</th>
                  <th scope="col">Action</th>
                  <th scope="col">Method</th>
                  <th scope="col">Warehouse</th>
                  <th scope="col">Shift</th>
                  <th scope="col">Performed by</th>
                  <th scope="col">Performed at</th>
                  <th scope="col" className="lehist-num">Locators</th>
                  <th scope="col" className="lehist-num">Items</th>
                  <th scope="col" className="lehist-num">Total qty</th>
                  <th scope="col" className="lehist-num">Total value</th>
                  <th scope="col">Hash</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((r) => {
                  const m  = deriveMethod(r);
                  const a  = deriveAction(r);
                  const ts = fmtTimestamp(r.performed_at);
                  return (
                    <tr
                      key={r.export_id}
                      onClick={() => setDetailId(r.export_id)}
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setDetailId(r.export_id);
                        }
                      }}
                      className="lehist-row"
                      title="Click for line-item detail"
                    >
                      <td>
                        <div className="lehist-uid-cell">
                          <span className="lehist-uid">{r.export_uid}</span>
                          <button
                            type="button"
                            className="lehist-row-export-btn"
                            onClick={(e) => handleExportSingleRow(r, e)}
                            title={`Export ${r.export_uid} to Excel`}
                          >
                            <FiDownload />
                          </button>
                        </div>
                      </td>
                      <td>
                        <span className={`lehist-chip lehist-chip--${(r.direction || '').toLowerCase()}`}>
                          {r.direction || '—'}
                        </span>
                      </td>
                      <td>
                        <span className={`lehist-action lehist-action--${a.tone}`}>
                          <a.Icon aria-hidden="true" />
                          <span>{a.label}</span>
                        </span>
                      </td>
                      <td>
                        <span className={`lehist-fmt lehist-fmt--${m.tone}`}>
                          <m.Icon aria-hidden="true" />
                          <span>{m.label}</span>
                        </span>
                      </td>
                      <td>
                        <span className="lehist-wh-code">{r.source_warehouse_code || '—'}</span>
                        {r.source_warehouse_name && (
                          <div className="lehist-wh-name">{r.source_warehouse_name}</div>
                        )}
                      </td>
                      <td>
                        {r.linked_shift_id ? (
                          <span className="lehist-shift-chip">
                            #{r.linked_shift_id}
                          </span>
                        ) : (
                          <span className="lehist-muted">—</span>
                        )}
                      </td>
                      <td>
                        <div className="lehist-user">
                          <span className="lehist-user-name">{r.performed_by_username || '—'}</span>
                          {r.performed_by_position && (
                            <span className="lehist-user-pos">{r.performed_by_position}</span>
                          )}
                          {m.source && (
                            <span className="lehist-user-source">{m.source}</span>
                          )}
                        </div>
                      </td>
                      <td>
                        <div className="lehist-ts">
                          <span className="lehist-ts-date">{ts.date}</span>
                          {ts.time && <span className="lehist-ts-time">{ts.time}</span>}
                        </div>
                      </td>
                      <td className="lehist-num">{fmtInt(r.locator_count)}</td>
                      <td className="lehist-num">{fmtInt(r.item_row_count)}</td>
                      <td className="lehist-num">{fmtInt(r.total_qty)}</td>
                      <td className="lehist-num lehist-num--cur">{fmtCur(r.total_value)}</td>
                      <td>
                        <span className="lehist-hash" title={r.file_hash || ''}>
                          {shortHash(r.file_hash)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="lehist-card-list">
            {visibleRows.map((r) => {
              const m  = deriveMethod(r);
              const a  = deriveAction(r);
              const ts = fmtTimestamp(r.performed_at);
              return (
                <article
                  key={`m-${r.export_id}`}
                  className="lehist-card"
                  onClick={() => setDetailId(r.export_id)}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setDetailId(r.export_id);
                    }
                  }}
                >
                  <header className="lehist-card-head">
                    <div className="lehist-uid-cell">
                      <span className="lehist-uid">{r.export_uid}</span>
                      <button
                        type="button"
                        className="lehist-row-export-btn"
                        onClick={(e) => handleExportSingleRow(r, e)}
                        title={`Export ${r.export_uid} to Excel`}
                      >
                        <FiDownload />
                      </button>
                    </div>
                    <span className={`lehist-chip lehist-chip--${(r.direction || '').toLowerCase()}`}>
                      {r.direction || '—'}
                    </span>
                  </header>

                  <div className="lehist-card-badges">
                    <span className={`lehist-action lehist-action--${a.tone}`}>
                      <a.Icon aria-hidden="true" />
                      <span>{a.label}</span>
                    </span>
                    <span className={`lehist-fmt lehist-fmt--${m.tone}`}>
                      <m.Icon aria-hidden="true" />
                      <span>{m.label}</span>
                    </span>
                    {r.linked_shift_id && (
                      <span className="lehist-shift-chip">
                        #{r.linked_shift_id}
                      </span>
                    )}
                  </div>

                  <dl className="lehist-card-grid">
                    <div>
                      <dt>Warehouse</dt>
                      <dd>{r.source_warehouse_code || '—'}</dd>
                    </div>
                    <div>
                      <dt>By</dt>
                      <dd>
                        <span className="lehist-card-by">{r.performed_by_username || '—'}</span>
                        {m.source && (
                          <div className="lehist-user-source">{m.source}</div>
                        )}
                      </dd>
                    </div>
                    <div className="lehist-card-grid-full">
                      <dt>Performed at</dt>
                      <dd>
                        <div className="lehist-ts">
                          <span className="lehist-ts-date">{ts.date}</span>
                          {ts.time && <span className="lehist-ts-time">{ts.time}</span>}
                        </div>
                      </dd>
                    </div>
                    <div><dt>Locators</dt><dd>{fmtInt(r.locator_count)}</dd></div>
                    <div><dt>Items</dt><dd>{fmtInt(r.item_row_count)}</dd></div>
                    <div><dt>Qty</dt><dd>{fmtInt(r.total_qty)}</dd></div>
                    <div>
                      <dt>Value</dt>
                      <dd className="lehist-num--cur">{fmtCur(r.total_value)}</dd>
                    </div>
                  </dl>
                </article>
              );
            })}
          </div>

          {totalPages > 1 && (
            <nav className="lehist-pagination" aria-label="History pagination">
              <div className="lehist-pagination-info">
                Showing <strong>{showingStart}</strong>–<strong>{showingEnd}</strong> of{' '}
                <strong>{fmtInt(total)}</strong> record{total === 1 ? '' : 's'}
              </div>

              <div className="lehist-pagination-controls">
                <button
                  type="button" className="lehist-page-btn"
                  onClick={() => goToPage(1)}
                  disabled={page <= 1}
                  aria-label="First page"
                ><FiChevronsLeft /></button>

                <button
                  type="button" className="lehist-page-btn"
                  onClick={() => goToPage(page - 1)}
                  disabled={page <= 1}
                  aria-label="Previous page"
                ><FiChevronLeft /></button>

                {pageList.map((p, i) =>
                  p === '...' ? (
                    <span key={`e${i}`} className="lehist-page-ellipsis">…</span>
                  ) : (
                    <button
                      key={p}
                      type="button"
                      className={`lehist-page-btn ${p === page ? 'is-active' : ''}`}
                      onClick={() => goToPage(p)}
                    >{p}</button>
                  )
                )}

                <button
                  type="button" className="lehist-page-btn"
                  onClick={() => goToPage(page + 1)}
                  disabled={page >= totalPages}
                  aria-label="Next page"
                ><FiChevronRight /></button>

                <button
                  type="button" className="lehist-page-btn"
                  onClick={() => goToPage(totalPages)}
                  disabled={page >= totalPages}
                  aria-label="Last page"
                ><FiChevronsRight /></button>
              </div>
            </nav>
          )}
        </>
      )}

      {detailId && (
        <SyncDetailModal
          exportId={detailId}
          onClose={() => setDetailId(null)}
        />
      )}
    </div>
  );
};

// ============================================================
// Detail modal — updated with per-record export + separated values
// ============================================================
const SyncDetailModal = ({ exportId, onClose }) => {
  const toast = useToast();
  const [header, setHeader]                   = useState(null);
  const [lines, setLines]                     = useState([]);
  const [linesTotal, setLinesTotal]           = useState(0);
  const [linesTotalPages, setLinesTotalPages] = useState(1);
  const [linesPage, setLinesPage]             = useState(1);
  const [loading, setLoading]                 = useState(true);
  const [loadingLines, setLoadingLines]       = useState(false);
  const [error, setError]                     = useState(null);
  const [modalExporting, setModalExporting]   = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await locatorLogApi.getOne(exportId);
        if (cancelled) return;
        if (res.ok && res.data) setHeader(res.data);
        else setError(res?.data?.message || 'Failed to load record.');
      } catch (e) {
        if (!cancelled) setError(e?.message || 'Failed to load record.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [exportId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingLines(true);
      try {
        const res = await locatorLogApi.getLines(exportId, {
          page: linesPage,
          limit: LINES_PAGE_SIZE,
        });
        if (cancelled) return;
        if (res.ok) {
          setLines(Array.isArray(res.data) ? res.data : []);
          setLinesTotal(Number(res.total) || 0);
          setLinesTotalPages(Math.max(Number(res.totalPages) || 1, 1));
        } else {
          setLines([]);
          setLinesTotal(0);
          setLinesTotalPages(1);
        }
      } catch (e) {
        if (!cancelled) {
          toast.error('Failed to load line items.');
          setLines([]);
        }
      } finally {
        if (!cancelled) setLoadingLines(false);
      }
    })();
    return () => { cancelled = true; };
  }, [exportId, linesPage, toast]);

  const goLinesPage = (p) => {
    const next = Math.max(1, Math.min(linesTotalPages, p));
    if (next !== linesPage) setLinesPage(next);
  };

  const method = header ? deriveMethod(header) : null;
  const action = header ? deriveAction(header) : null;
  const ts     = header ? fmtTimestamp(header.performed_at) : { date: '—', time: '' };

  const hasLinkedShift = !!(header && header.linked_shift_id);
  const isCrossDbRow = !!(header && method && method.kind === 'cross-db');

  // Calculate the separated values
  const deductedQty = (Number(header?.linked_issued_qty) || 0) + (Number(header?.linked_damaged_qty) || 0);
  const deductedValue = (Number(header?.linked_issued_value) || 0) + (Number(header?.linked_damaged_value) || 0);
  
  const transferredOutQty = Number(header?.linked_transfer_out_qty) || 0;
  const transferredOutValue = Number(header?.linked_transfer_out_value) || 0;
  
  const transferredInQty = Number(header?.linked_transfer_in_qty) || 0;
  const transferredInValue = Number(header?.linked_transfer_in_value) || 0;

  /* ============================================================
     MODAL-SPECIFIC EXPORTS (Header + full Line Items)
     ============================================================ */
  const handleExportModalExcel = () => {
    if (!header) return;
    setModalExporting(true);
    try {
      const wb = XLSX.utils.book_new();

      // Sheet 1: Summary
      const summaryRow = {
        'UID': header.export_uid,
        'Direction': header.direction,
        'Action': action?.label || header.action_type,
        'Method': method?.label || header.export_format,
        'Warehouse': header.source_warehouse_code,
        'Performed By': header.performed_by_username,
        'Performed At': fmtDateTime(header.performed_at),
        'Total Qty': Number(header.total_qty) || 0,
        'Total Value': Number(header.total_value) || 0,
        'File Hash': header.file_hash || '—',
      };
      const wsSummary = XLSX.utils.json_to_sheet([summaryRow]);
      XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');

      // Sheet 2: Line Items
      const lineData = lines.map(ln => ({
        'Type': ln.line_kind || 'Release',
        'Locator': ln.locator_code,
        'Item Code': ln.item_code,
        'Item Name': ln.item_name || '—',
        'UOM': ln.uom || '—',
        'Qty': Number(ln.qty) || 0,
        'Unit Cost': Number(ln.unit_cost) || 0,
        'Line Total': Number(ln.line_total) || 0,
      }));
      const wsLines = XLSX.utils.json_to_sheet(lineData);
      XLSX.utils.book_append_sheet(wb, wsLines, 'Line Items');

      XLSX.writeFile(wb, `Sync_Record_${header.export_uid}.xlsx`);
      toast.success('Excel file downloaded.');
    } catch (err) {
      console.error('Modal Excel export error:', err);
      toast.error('Failed to export Excel.');
    } finally {
      setModalExporting(false);
    }
  };

  const handleExportModalWord = () => {
    if (!header) return;
    setModalExporting(true);
    try {
      let html = `
        <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
        <head>
          <title>Sync Record ${header.export_uid}</title>
          <style>
            body { font-family: Arial, sans-serif; font-size: 10pt; }
            h1 { font-size: 16pt; color: #0f172a; }
            h2 { font-size: 13pt; color: #475569; margin-top: 24px; }
            table { border-collapse: collapse; width: 100%; margin-top: 10px; }
            th, td { border: 1px solid #ccc; padding: 6px; text-align: left; }
            th { background: #f1f5f9; font-weight: bold; }
            .num { text-align: right; }
          </style>
        </head>
        <body>
          <h1>Sync Record: ${header.export_uid}</h1>
          <p>Exported: ${new Date().toLocaleString()}</p>
          
          <h2>Summary</h2>
          <table>
            <tr><th>Direction</th><td>${header.direction || '—'}</td></tr>
            <tr><th>Action</th><td>${action?.label || header.action_type || '—'}</td></tr>
            <tr><th>Method</th><td>${method?.label || header.export_format || '—'}</td></tr>
            <tr><th>Warehouse</th><td>${header.source_warehouse_code || '—'}</td></tr>
            <tr><th>Performed By</th><td>${header.performed_by_username || '—'}</td></tr>
            <tr><th>Performed At</th><td>${fmtDateTime(header.performed_at)}</td></tr>
            <tr><th>Total Qty</th><td class="num">${fmtInt(header.total_qty)}</td></tr>
            <tr><th>Total Value</th><td class="num">${fmtCur(header.total_value)}</td></tr>
          </table>

          <h2>Line Items (${linesTotal})</h2>
          <table>
            <thead>
              <tr>
                <th>Type</th>
                <th>Locator</th>
                <th>Item</th>
                <th>UOM</th>
                <th class="num">Qty</th>
                <th class="num">Unit Cost</th>
                <th class="num">Line Total</th>
              </tr>
            </thead>
            <tbody>
      `;

      lines.forEach(ln => {
        html += `
          <tr>
            <td>${ln.line_kind || 'Release'}</td>
            <td>${ln.locator_code}</td>
            <td>${ln.item_code}${ln.item_name ? ' - ' + ln.item_name : ''}</td>
            <td>${ln.uom || '—'}</td>
            <td class="num">${fmtInt(ln.qty)}</td>
            <td class="num">${fmtCur(ln.unit_cost)}</td>
            <td class="num">${fmtCur(ln.line_total)}</td>
          </tr>
        `;
      });

      html += `</tbody></table></body></html>`;

      const blob = new Blob(['\ufeff', html], { type: 'application/msword' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Sync_Record_${header.export_uid}.doc`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('Word document downloaded.');
    } catch (err) {
      console.error('Modal Word export error:', err);
      toast.error('Failed to export Word document.');
    } finally {
      setModalExporting(false);
    }
  };

  return (
    <div className="ledm-overlay" onClick={onClose}>
      <div className="ledm-card" onClick={(e) => e.stopPropagation()}>
        <div className="ledm-header">
          <div className="ledm-header-left">
            <div className="ledm-header-icon"><FiDownload /></div>
            <div className="ledm-header-info">
              <h3 className="ledm-title">
                {header?.export_uid || 'Sync record'}
              </h3>
              {header && (
                <div className="ledm-sub">
                  {header.direction} · {header.action_type} · {method?.label || header.export_format || '—'}
                </div>
              )}
            </div>
          </div>
          <button
            type="button"
            className="ledm-close"
            onClick={onClose}
            aria-label="Close"
          ><FiX /></button>
        </div>

        <div className="ledm-body">
          {loading && (
            <div className="ledm-loading">
              <FiLoader className="icon-spin" />
              <span>Loading record…</span>
            </div>
          )}
          {error && (
            <div className="ledm-error">
              <FiAlertTriangle /> <span>{error}</span>
            </div>
          )}

          {!loading && header && (
            <>
              <div className="ledm-facts">
                <div className="ledm-fact">
                  <span className="ledm-fact-label">
                    {action?.Icon ? <action.Icon /> : <FiPackage />} Action
                  </span>
                  <span className="ledm-fact-value">
                    {action?.label || header.action_type || '—'}
                  </span>
                </div>
                <div className="ledm-fact">
                  <span className="ledm-fact-label"><FiUser /> Performed by</span>
                  <span className="ledm-fact-value">
                    {header.performed_by_username || '—'}
                    {header.performed_by_position ? ` · ${header.performed_by_position}` : ''}
                  </span>
                </div>
                <div className="ledm-fact">
                  <span className="ledm-fact-label"><FiClock /> Performed at</span>
                  <span className="ledm-fact-value">
                    <div className="lehist-ts">
                      <span className="lehist-ts-date">{ts.date}</span>
                      {ts.time && <span className="lehist-ts-time">{ts.time}</span>}
                    </div>
                  </span>
                </div>
                <div className="ledm-fact">
                  <span className="ledm-fact-label">
                    {method?.Icon ? <method.Icon /> : <FiPackage />} Method
                  </span>
                  <span className="ledm-fact-value">
                    {method?.label || header.export_format || '—'}
                    {method?.source ? ` — ${method.source}` : ''}
                  </span>
                </div>
                <div className="ledm-fact">
                  <span className="ledm-fact-label"><FiPackage /> Source warehouse</span>
                  <span className="ledm-fact-value">
                    {header.source_warehouse_code || '—'}
                    {header.source_warehouse_name ? ` — ${header.source_warehouse_name}` : ''}
                  </span>
                </div>
                <div className="ledm-fact">
                  <span className="ledm-fact-label"><FiDollarSign /> Total value</span>
                  <span className="ledm-fact-value">{fmtCur(header.total_value)}</span>
                </div>
                <div className="ledm-fact">
                  <span className="ledm-fact-label"><FiHash /> File hash (SHA-256)</span>
                  <span className="ledm-fact-value ledm-mono" title={header.file_hash || ''}>
                    {header.file_hash
                      ? header.file_hash
                      : isCrossDbRow
                      ? 'Cross-DB pull — no file hash'
                      : (String(header.export_format || '').toLowerCase() === 'online' || method?.kind === 'online')
                        ? 'Online — no file hash'
                        : '—'}
                  </span>
                </div>
                <div className="ledm-fact">
                  <span className="ledm-fact-label"><FiFileText /> File</span>
                  <span className="ledm-fact-value ledm-mono">
                    {header.filename
                      ? header.filename
                      : isCrossDbRow
                      ? 'Cross-DB pull — no file'
                      : (String(header.export_format || '').toLowerCase() === 'online' || method?.kind === 'online')
                        ? 'Online sync — no file'
                        : '—'}
                    {header.file_size_bytes != null && (
                      <> · {fmtInt(header.file_size_bytes)} bytes</>
                    )}
                  </span>
                </div>
              </div>

              {hasLinkedShift && (
                <div className="ledm-shift-panel">
                  <header className="ledm-shift-head">
                    <div className="ledm-shift-head-left">
                      <span className="ledm-shift-icon" aria-hidden="true">
                        <FiTruck />
                      </span>
                      <div>
                        <div className="ledm-shift-title">
                          Linked shift <span className="ledm-shift-title-id">#{header.linked_shift_id}</span>
                        </div>
                        <div className="ledm-shift-sub">
                          {header.linked_shift_warehouse_code || '—'}
                          {header.linked_shift_handler_username
                            ? ` · ${header.linked_shift_handler_username}`
                            : ''}
                        </div>
                      </div>
                    </div>
                    <span className={linkedStatusPillClass(header.linked_shift_status)}>
                      {header.linked_shift_status || '—'}
                    </span>
                  </header>

                  <div className="ledm-shift-grid">
                    <div className="ledm-shift-cell">
                      <span className="ledm-shift-lbl">
                        <FiPackage /> Beginning qty
                      </span>
                      <span className="ledm-shift-val">
                        {fmtInt(header.linked_beginning_qty)}
                      </span>
                    </div>
                    <div className="ledm-shift-cell">
                      <span className="ledm-shift-lbl">
                        <FiDollarSign /> Beginning value
                      </span>
                      <span className="ledm-shift-val ledm-shift-val--cur">
                        {fmtCur(header.linked_beginning_value)}
                      </span>
                    </div>

                    {/* DEDUCTED (Issued + Damaged) */}
                    <div className="ledm-shift-cell">
                      <span className="ledm-shift-lbl">
                        <FiAlertTriangle /> Deducted qty <small style={{ textTransform: 'lowercase', fontWeight: 400 }}>(Issued + Damage)</small>
                      </span>
                      <span className="ledm-shift-val">
                        {fmtInt(deductedQty)}
                      </span>
                    </div>
                    <div className="ledm-shift-cell">
                      <span className="ledm-shift-lbl">
                        <FiDollarSign /> Deducted value
                      </span>
                      <span className="ledm-shift-val ledm-shift-val--cur">
                        {fmtCur(deductedValue)}
                      </span>
                    </div>

                    {/* TRANSFERRED OUT */}
                    <div className="ledm-shift-cell">
                      <span className="ledm-shift-lbl">
                        <FiTruck /> Transferred Out qty
                      </span>
                      <span className="ledm-shift-val">
                        {fmtInt(transferredOutQty)}
                      </span>
                    </div>
                    <div className="ledm-shift-cell">
                      <span className="ledm-shift-lbl">
                        <FiDollarSign /> Transferred value
                      </span>
                      <span className="ledm-shift-val ledm-shift-val--cur">
                        {fmtCur(transferredOutValue)}
                      </span>
                    </div>

                    {/* TRANSFERRED IN */}
                    <div className="ledm-shift-cell">
                      <span className="ledm-shift-lbl">
                        <FiTruck /> Transferred In qty
                      </span>
                      <span className="ledm-shift-val">
                        {fmtInt(transferredInQty)}
                      </span>
                    </div>
                    <div className="ledm-shift-cell">
                      <span className="ledm-shift-lbl">
                        <FiDollarSign /> Transferred In value
                      </span>
                      <span className="ledm-shift-val ledm-shift-val--cur">
                        {fmtCur(transferredInValue)}
                      </span>
                    </div>

                    <div className="ledm-shift-cell">
                      <span className="ledm-shift-lbl">
                        <FiCheckCircle /> Ending qty
                      </span>
                      <span className="ledm-shift-val">
                        {fmtInt(header.linked_ending_qty)}
                      </span>
                    </div>
                    <div className="ledm-shift-cell">
                      <span className="ledm-shift-lbl">
                        <FiDollarSign /> Ending value
                      </span>
                      <span className="ledm-shift-val ledm-shift-val--cur">
                        {fmtCur(header.linked_ending_value)}
                      </span>
                    </div>
                  </div>

                  <div className="ledm-shift-timeline">
                    <div className="ledm-shift-timeline-row">
                      <span className="ledm-shift-timeline-lbl">Shift opened</span>
                      <span className="ledm-shift-timeline-val">
                        {fmtDateTime(header.linked_shift_started_at)}
                      </span>
                    </div>
                    <div className="ledm-shift-timeline-row">
                      <span className="ledm-shift-timeline-lbl">Shift ended</span>
                      <span className="ledm-shift-timeline-val">
                        {fmtDateTime(header.linked_shift_ended_at)}
                      </span>
                    </div>
                    <div className="ledm-shift-timeline-row">
                      <span className="ledm-shift-timeline-lbl">Synced at</span>
                      <span className="ledm-shift-timeline-val">
                        {fmtDateTime(header.linked_shift_reconciled_at)}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              <div className="ledm-lines-section">
                <div className="ledm-lines-head">
                  <span>
                    Line items{' '}
                    <strong>{fmtInt(linesTotal)}</strong>
                  </span>
                </div>

                {loadingLines ? (
                  <div className="ledm-loading">
                    <FiLoader className="icon-spin" /> <span>Loading lines…</span>
                  </div>
                ) : lines.length === 0 ? (
                  <div className="ledm-empty">
                    {header.item_row_count === 0
                      ? 'No line items were stored for this record.'
                      : 'No lines on this page.'}
                  </div>
                ) : (
                  <div className="ledm-table-wrap">
                    <table className="ledm-table">
                      <thead>
                        <tr>
                          <th>Type</th>
                          <th>Locator</th>
                          <th>Item</th>
                          <th>UOM</th>
                          <th className="ledm-num">Qty</th>
                          <th className="ledm-num">Unit cost</th>
                          <th className="ledm-num">Line total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {lines.map((ln) => (
                          <tr key={ln.line_id}>
                            <td>
                              <span className={`lehist-action lehist-action--${getLineKindTone(ln.line_kind)}`}>
                                {ln.line_kind || 'Release'}
                              </span>
                            </td>
                            <td>
                              <div className="ledm-loc-code">{ln.locator_code}</div>
                              {ln.locator_name && (
                                <div className="ledm-loc-name">{ln.locator_name}</div>
                              )}
                            </td>
                            <td>
                              <div className="ledm-item-code">{ln.item_code}</div>
                              {ln.item_name && (
                                <div className="ledm-item-name">{ln.item_name}</div>
                              )}
                            </td>
                            <td>{ln.uom || '—'}</td>
                            <td className="ledm-num">{fmtInt(ln.qty)}</td>
                            <td className="ledm-num">{fmtCur(ln.unit_cost)}</td>
                            <td className="ledm-num ledm-num--cur">{fmtCur(ln.line_total)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {linesTotalPages > 1 && (
                  <nav className="ledm-pagination">
                    <div className="ledm-pagination-info">
                      Page <strong>{linesPage}</strong> of <strong>{linesTotalPages}</strong>
                      <span> · {fmtInt(linesTotal)} line(s)</span>
                    </div>
                    <div className="ledm-pagination-controls">
                      <button
                        type="button" className="ledm-page-btn"
                        onClick={() => goLinesPage(1)}
                        disabled={linesPage <= 1 || loadingLines}
                      ><FiChevronsLeft /></button>
                      <button
                        type="button" className="ledm-page-btn"
                        onClick={() => goLinesPage(linesPage - 1)}
                        disabled={linesPage <= 1 || loadingLines}
                      ><FiChevronLeft /></button>
                      <span className="ledm-page-chip">
                        {linesPage} / {linesTotalPages}
                      </span>
                      <button
                        type="button" className="ledm-page-btn"
                        onClick={() => goLinesPage(linesPage + 1)}
                        disabled={linesPage >= linesTotalPages || loadingLines}
                      ><FiChevronRight /></button>
                      <button
                        type="button" className="ledm-page-btn"
                        onClick={() => goLinesPage(linesTotalPages)}
                        disabled={linesPage >= linesTotalPages || loadingLines}
                      ><FiChevronsRight /></button>
                    </div>
                  </nav>
                )}
              </div>
            </>
          )}
        </div>

        <div className="ledm-footer ledm-footer--split">
          <button
            type="button"
            className="ledm-btn-ghost"
            onClick={onClose}
          >Close</button>

          <div className="ledm-footer-exports">
            <button
              type="button"
              className="ledm-btn-export ledm-btn-export--xls"
              onClick={handleExportModalExcel}
              disabled={!header || modalExporting || loadingLines}
            >
              {modalExporting ? <FiLoader className="icon-spin" /> : <FiGrid />}
              <span>Export Excel</span>
            </button>
            <button
              type="button"
              className="ledm-btn-export ledm-btn-export--doc"
              onClick={handleExportModalWord}
              disabled={!header || modalExporting || loadingLines}
            >
              {modalExporting ? <FiLoader className="icon-spin" /> : <FiFileText />}
              <span>Export Word</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LocatorSyncHistory;

// ============================================================
// Component-scoped CSS
// ============================================================
const historyCss = [
  '/* ============================================================',
  '   ROOT',
  '   ============================================================ */',
  '.lehist-root { width: 100%; display: flex; flex-direction: column; gap: 14px; min-width: 0; }',

  '/* ============================================================',
  '   TOOLBAR',
  '   ============================================================ */',
  '.lehist-toolbar { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; min-width: 0; }',
  '.lehist-search-wrap { position: relative; flex: 1 1 260px; min-width: 0; }',
  '.lehist-search-icon { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: #94a3b8; font-size: 16px; pointer-events: none; display: inline-flex; align-items: center; }',
  '.lehist-search-input { width: 100%; min-height: 42px; padding: 10px 38px; border: 1.5px solid #cbd5e1; border-radius: 10px; background: #fff; font: inherit; font-size: 14px; color: #0f172a; transition: border-color 0.15s ease, box-shadow 0.15s ease; box-sizing: border-box; }',
  '.lehist-search-input:focus { outline: none; border-color: #00d2c8; box-shadow: 0 0 0 3px rgba(0, 210, 200, 0.16); }',
  '.lehist-search-input::placeholder { color: #94a3b8; }',
  '.lehist-search-clear { position: absolute; right: 8px; top: 50%; transform: translateY(-50%); width: 28px; height: 28px; border-radius: 6px; border: none; background: transparent; color: #64748b; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; transition: background 0.12s ease, color 0.12s ease; }',
  '.lehist-search-clear:hover { background: #f1f5f9; color: #0f172a; }',
  '.lehist-dirchips { display: inline-flex; gap: 4px; padding: 3px; border-radius: 10px; background: #f1f5f9; border: 1px solid #e2e8f0; flex-shrink: 0; }',
  '.lehist-dirchip { border: none; background: transparent; font: inherit; font-size: 12.5px; font-weight: 700; color: #475569; padding: 7px 12px; border-radius: 7px; cursor: pointer; transition: background 0.12s ease, color 0.12s ease, box-shadow 0.12s ease; white-space: nowrap; }',
  '.lehist-dirchip:hover { color: #0f172a; }',
  '.lehist-dirchip:focus-visible { outline: 2px solid #00b8b0; outline-offset: 2px; }',
  '.lehist-dirchip.is-active { background: #ffffff; color: #007a72; box-shadow: 0 1px 3px rgba(15, 23, 42, 0.1); }',
  '.lehist-refresh { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 42px; padding: 8px 16px; border-radius: 10px; border: 1.5px solid #94a3b8; background: #ffffff; color: #1e293b; font: inherit; font-weight: 700; cursor: pointer; transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease; flex-shrink: 0; }',
  '.lehist-refresh:hover:not(:disabled) { border-color: #00b8b0; background: #f0fdfa; color: #007a72; }',
  '.lehist-refresh:disabled { opacity: 0.6; cursor: not-allowed; }',

  '/* EXPORT DROPDOWN (TOOLBAR) */',
  '.lehist-export-wrap { position: relative; display: inline-flex; flex-shrink: 0; }',
  '.lehist-export-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 42px; padding: 8px 16px; border-radius: 10px; border: 1.5px solid #16a34a; background: #ffffff; color: #16a34a; font: inherit; font-weight: 700; cursor: pointer; transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease; }',
  '.lehist-export-btn:hover:not(:disabled) { background: #f0fdf4; color: #15803d; }',
  '.lehist-export-btn:disabled { opacity: 0.5; cursor: not-allowed; }',
  '.lehist-export-btn.is-open { background: #f0fdf4; }',
  '.lehist-export-caret { width: 12px; height: 12px; transition: transform 0.18s ease; }',
  '.lehist-export-caret.is-open { transform: rotate(180deg); }',
  '.lehist-export-menu { position: absolute; top: calc(100% + 6px); right: 0; list-style: none; margin: 0; padding: 6px; min-width: 260px; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; box-shadow: 0 12px 30px rgba(15, 23, 42, 0.15); z-index: 60; animation: lehistPop 0.15s ease-out; }',
  '@keyframes lehistPop { from { opacity: 0; transform: translateY(-4px) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }',
  '.lehist-export-item { display: flex; align-items: flex-start; gap: 10px; width: 100%; padding: 10px 12px; background: transparent; border: none; border-radius: 8px; text-align: left; font-family: inherit; cursor: pointer; transition: background 0.12s ease; }',
  '.lehist-export-item:hover { background: #f0fdf4; }',
  '.lehist-export-item-icon { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: 8px; flex-shrink: 0; color: #ffffff; }',
  '.lehist-export-item-icon--xls { background: linear-gradient(135deg, #22c55e 0%, #15803d 100%); }',
  '.lehist-export-item-icon--doc { background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%); }',
  '.lehist-export-item-icon svg { width: 16px; height: 16px; }',
  '.lehist-export-item-body { display: flex; flex-direction: column; gap: 2px; min-width: 0; }',
  '.lehist-export-item-title { font-size: 13px; font-weight: 700; color: #0f172a; line-height: 1.2; }',
  '.lehist-export-item-sub { font-size: 11px; color: #64748b; line-height: 1.3; }',
  '.lehist-export-item:hover .lehist-export-item-title { color: #15803d; }',

  '/* STATES */',
  '.lehist-error { display: flex; align-items: center; gap: 10px; padding: 12px 16px; background: #fef2f2; border: 1px solid #fecaca; border-left: 4px solid #dc2626; border-radius: 10px; color: #991b1b; flex-wrap: wrap; }',
  '.lehist-error button { margin-left: auto; padding: 6px 14px; border: 1px solid #dc2626; background: transparent; color: #dc2626; border-radius: 8px; font: inherit; font-weight: 700; cursor: pointer; transition: background 0.12s ease, color 0.12s ease; }',
  '.lehist-error button:hover { background: #dc2626; color: #fff; }',
  '.lehist-loading, .lehist-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; padding: 48px 16px; text-align: center; color: #64748b; }',
  '.lehist-empty svg { width: 40px; height: 40px; color: #cbd5e1; }',
  '.lehist-empty-title { font-weight: 700; color: #1e293b; font-size: 15px; }',
  '.lehist-empty-sub { font-size: 13px; max-width: 40ch; }',

  '/* TABLE */',
  '.lehist-table-wrap { overflow-x: auto; border: 1px solid #e2e8f0; border-radius: 12px; background: #ffffff; -webkit-overflow-scrolling: touch; }',
  '.lehist-table { width: 100%; border-collapse: collapse; font-size: 13px; min-width: 1340px; }',
  '.lehist-table thead th { text-align: left; padding: 12px 14px; font-size: 10.5px; letter-spacing: 0.06em; text-transform: uppercase; font-weight: 800; color: #475569; background: #f8fafc; border-bottom: 1px solid #e2e8f0; white-space: nowrap; position: sticky; top: 0; z-index: 1; }',
  '.lehist-table tbody td { padding: 12px 14px; border-bottom: 1px solid #f1f5f9; color: #1e293b; vertical-align: middle; }',
  '.lehist-table tbody tr:last-child td { border-bottom: none; }',
  '.lehist-row { cursor: pointer; transition: background 0.12s ease; }',
  '.lehist-row:hover { background: #f0fdfa; }',
  '.lehist-row:focus-visible { outline: 2px solid #00b8b0; outline-offset: -2px; background: #f0fdfa; }',
  '.lehist-num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }',
  '.lehist-num--cur { color: #065f46; font-weight: 700; }',
  '.lehist-uid-cell { display: inline-flex; align-items: center; gap: 6px; }',
  '.lehist-uid { font-family: "JetBrains Mono", "SF Mono", Monaco, Menlo, monospace; font-weight: 800; font-size: 12.5px; color: #0f766e; white-space: nowrap; }',
  '.lehist-row-export-btn { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 5px; border: 1px solid transparent; background: transparent; color: #94a3b8; cursor: pointer; transition: background 0.12s ease, color 0.12s ease, border-color 0.12s ease; }',
  '.lehist-row-export-btn:hover { background: #f0fdf4; color: #16a34a; border-color: #bbf7d0; }',
  '.lehist-row-export-btn svg { width: 12px; height: 12px; stroke-width: 2.6; }',
  '.lehist-chip { display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 999px; font-size: 10.5px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; white-space: nowrap; }',
  '.lehist-chip--export { background: #dcfce7; color: #166534; border: 1px solid #86efac; }',
  '.lehist-chip--import { background: #dbeafe; color: #1e40af; border: 1px solid #93c5fd; }',
  '.lehist-shift-chip { display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 6px; background: #f5f3ff; color: #6d28d9; border: 1px solid #ddd6fe; font-family: "JetBrains Mono", "SF Mono", Monaco, Menlo, monospace; font-weight: 700; font-size: 11.5px; white-space: nowrap; }',
  '.lehist-muted { color: #cbd5e1; font-size: 12.5px; }',
  '.lehist-action { display: inline-flex; align-items: center; gap: 5px; padding: 3px 9px; border-radius: 6px; font-size: 11px; font-weight: 800; white-space: nowrap; }',
  '.lehist-action svg { width: 12px; height: 12px; }',
  '.lehist-action--sync-online     { background: #eef2ff; color: #3730a3; border: 1px solid #a5b4fc; }',
  '.lehist-action--sync-file       { background: #ecfdf5; color: #047857; border: 1px solid #86efac; }',
  '.lehist-action--sync-cross-db   { background: #ede9fe; color: #5b21b6; border: 1px solid #c4b5fd; }',
  '.lehist-action--close  { background: #fff7ed; color: #9a3412; border: 1px solid #fdba74; }',
  '.lehist-action--seed   { background: #f0f9ff; color: #075985; border: 1px solid #7dd3fc; }',
  '.lehist-action--export { background: #f0fdf4; color: #166534; border: 1px solid #bbf7d0; }',
  '.lehist-action--import { background: #eff6ff; color: #1e40af; border: 1px solid #bfdbfe; }',
  '.lehist-action--default { background: #f1f5f9; color: #475569; border: 1px solid #cbd5e1; }',
  '.lehist-action--issued { background: #f0fdf4; color: #166534; border: 1px solid #bbf7d0; }',
  '.lehist-action--damaged { background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; }',
  '.lehist-action--transferred { background: #eff6ff; color: #1e40af; border: 1px solid #bfdbfe; }',
  '.lehist-fmt { display: inline-flex; align-items: center; gap: 5px; padding: 3px 9px; border-radius: 6px; font-size: 11px; font-weight: 800; white-space: nowrap; }',
  '.lehist-fmt svg { width: 12px; height: 12px; }',
  '.lehist-fmt--indigo    { background: linear-gradient(135deg, #eef2ff 0%, #e0e7ff 100%); color: #3730a3; border: 1px solid #a5b4fc; box-shadow: 0 1px 3px rgba(99, 102, 241, 0.14); }',
  '.lehist-fmt--indigo svg { color: #4338ca; }',
  '.lehist-fmt--cross-db  { background: linear-gradient(135deg, #ede9fe 0%, #ddd6fe 100%); color: #5b21b6; border: 1px solid #c4b5fd; box-shadow: 0 1px 3px rgba(139, 92, 246, 0.16); }',
  '.lehist-fmt--cross-db svg { color: #7c3aed; }',
  '.lehist-fmt--excel  { background: #ecfdf5; color: #047857; border: 1px solid #86efac; }',
  '.lehist-fmt--pdf    { background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca; }',
  '.lehist-fmt--default { background: #f1f5f9; color: #475569; border: 1px solid #cbd5e1; }',
  '.lehist-wh-code { display: inline-block; padding: 2px 8px; border-radius: 6px; background: #e0f2fe; color: #075985; border: 1px solid #7dd3fc; font-family: "JetBrains Mono", "SF Mono", Monaco, Menlo, monospace; font-weight: 700; font-size: 11.5px; }',
  '.lehist-wh-name { font-size: 11px; color: #64748b; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 200px; }',
  '.lehist-user { display: flex; flex-direction: column; gap: 2px; min-width: 0; }',
  '.lehist-user-name { font-weight: 700; font-size: 12.5px; color: #0f172a; }',
  '.lehist-user-pos { font-size: 11px; color: #64748b; }',
  '.lehist-user-source { font-size: 10.5px; font-weight: 700; color: #4338ca; letter-spacing: 0.02em; margin-top: 1px; }',
  '.lehist-ts { display: flex; flex-direction: column; gap: 1px; line-height: 1.25; min-width: 0; }',
  '.lehist-ts-date { font-size: 12.5px; font-weight: 700; color: #0f172a; white-space: nowrap; }',
  '.lehist-ts-time { font-size: 11px; font-weight: 600; color: #64748b; font-variant-numeric: tabular-nums; white-space: nowrap; }',
  '.lehist-hash { font-family: "JetBrains Mono", "SF Mono", Monaco, Menlo, monospace; font-size: 11px; color: #64748b; background: #f8fafc; border: 1px solid #e2e8f0; padding: 2px 6px; border-radius: 4px; white-space: nowrap; }',

  '/* MOBILE CARDS */',
  '.lehist-card-list { display: none; flex-direction: column; gap: 10px; }',
  '.lehist-card { background: #ffffff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px 14px; cursor: pointer; box-shadow: 0 1px 3px rgba(15, 23, 42, 0.06); transition: box-shadow 0.12s ease, transform 0.1s ease; }',
  '.lehist-card:hover { box-shadow: 0 4px 10px rgba(15, 23, 42, 0.1); }',
  '.lehist-card:active { transform: scale(0.995); }',
  '.lehist-card:focus-visible { outline: 2px solid #00b8b0; outline-offset: 2px; }',
  '.lehist-card-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 10px; flex-wrap: wrap; }',
  '.lehist-card-badges { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }',
  '.lehist-card-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 12px; margin: 0; }',
  '.lehist-card-grid-full { grid-column: 1 / -1; }',
  '.lehist-card-grid dt { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; margin: 0; }',
  '.lehist-card-grid dd { margin: 2px 0 0; font-size: 12.5px; font-weight: 600; color: #0f172a; overflow: hidden; text-overflow: ellipsis; min-width: 0; }',
  '.lehist-card-grid dd.lehist-num--cur { color: #065f46; }',
  '.lehist-card-by { display: inline-block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }',

  '/* PAGINATION */',
  '.lehist-pagination { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 12px 4px; }',
  '.lehist-pagination-info { font-size: 12.5px; color: #64748b; text-align: center; }',
  '.lehist-pagination-info strong { color: #0f172a; }',
  '.lehist-pagination-controls { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; justify-content: center; }',
  '.lehist-page-btn { display: inline-flex; align-items: center; justify-content: center; min-width: 34px; height: 34px; padding: 0 8px; border: 1px solid #cbd5e1; border-radius: 8px; background: #ffffff; color: #334155; font: inherit; font-size: 12.5px; font-weight: 700; cursor: pointer; transition: border-color 0.12s ease, background 0.12s ease, color 0.12s ease; }',
  '.lehist-page-btn:hover:not(:disabled) { border-color: #00b8b0; background: #f0fdfa; color: #007a72; }',
  '.lehist-page-btn.is-active { background: #00b8b0; border-color: #00b8b0; color: #ffffff; }',
  '.lehist-page-btn:disabled { opacity: 0.4; cursor: not-allowed; }',
  '.lehist-page-btn svg { width: 14px; height: 14px; }',
  '.lehist-page-ellipsis { color: #94a3b8; padding: 0 4px; font-weight: 700; }',

  '/* RESPONSIVE — list view */',
  '@media (min-width: 1921px) { .lehist-table { font-size: 13.5px; min-width: 1500px; } .lehist-table thead th { font-size: 11px; padding: 14px 16px; } .lehist-table tbody td { padding: 14px 16px; } .lehist-uid { font-size: 13px; } .lehist-ts-date { font-size: 13px; } .lehist-ts-time { font-size: 11.5px; } .lehist-action, .lehist-fmt { font-size: 11.5px; padding: 4px 10px; } .lehist-shift-chip { font-size: 12.5px; padding: 3px 10px; } .lehist-search-input, .lehist-refresh, .lehist-export-btn { min-height: 46px; font-size: 15px; } .lehist-dirchip { font-size: 13.5px; padding: 8px 16px; } .lehist-row-export-btn { width: 26px; height: 26px; } .lehist-row-export-btn svg { width: 14px; height: 14px; } }',
  '@media (max-width: 1024px) { .lehist-table { min-width: 1140px; } }',
  '@media (max-width: 900px) { .lehist-table-wrap { display: none; } .lehist-card-list { display: flex; } .lehist-toolbar { gap: 8px; } .lehist-dirchips { order: 3; width: 100%; justify-content: flex-start; } .lehist-refresh { order: 2; } .lehist-export-wrap { order: 2; } .lehist-search-wrap { order: 1; flex: 1 1 100%; } }',
  '@media (max-width: 640px) { .lehist-root { gap: 12px; } .lehist-dirchips { gap: 3px; padding: 3px; } .lehist-dirchip { padding: 6px 10px; font-size: 12px; flex: 1 1 auto; } .lehist-refresh { width: 100%; justify-content: center; } .lehist-export-wrap { width: 100%; } .lehist-export-btn { width: 100%; justify-content: center; } .lehist-export-menu { left: 0; right: auto; width: 100%; } .lehist-search-input { font-size: 15px; padding-left: 36px; } .lehist-card-grid { grid-template-columns: 1fr 1fr; gap: 8px 10px; } }',
  '@media (max-width: 480px) { .lehist-pagination-info { font-size: 12px; } .lehist-page-btn { min-width: 32px; height: 32px; font-size: 12px; } .lehist-card { padding: 10px 12px; } .lehist-card-head { gap: 6px; margin-bottom: 8px; } .lehist-card-badges { gap: 5px; margin-bottom: 8px; } .lehist-card-grid { gap: 6px 10px; } .lehist-card-grid dd { font-size: 12px; } .lehist-empty { padding: 36px 12px; } .lehist-error { padding: 10px 12px; font-size: 12.5px; } .lehist-error button { width: 100%; margin: 6px 0 0; } .lehist-shift-chip { font-size: 10.5px; padding: 2px 7px; } }',
  '@media (max-width: 400px) { .lehist-page-btn { min-width: 30px; height: 30px; font-size: 11.5px; } .lehist-card-grid { grid-template-columns: 1fr; gap: 8px; } .lehist-card-head .lehist-uid { font-size: 12px; } .lehist-ts-date { font-size: 12px; } .lehist-ts-time { font-size: 10.5px; } .lehist-action, .lehist-fmt { font-size: 10.5px; padding: 3px 7px; } }',
  '@media (max-width: 360px) { .lehist-dirchip { font-size: 11.5px; padding: 5px 8px; } .lehist-search-input { font-size: 14px; } .lehist-action, .lehist-fmt { font-size: 10px; padding: 2px 6px; gap: 4px; } .lehist-action svg, .lehist-fmt svg { width: 10px; height: 10px; } .lehist-shift-chip { font-size: 10px; padding: 2px 6px; } }',
  '@media (max-height: 520px) and (orientation: landscape) { .lehist-root { gap: 10px; } .lehist-empty, .lehist-loading { padding: 24px 12px; } .lehist-card { padding: 10px 12px; } }',

  '/* DETAIL MODAL — ledm- prefix (no backticks) */',
  '.ledm-overlay { position: fixed; inset: 0; background: rgba(15, 23, 42, 0.6); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); display: flex; align-items: center; justify-content: center; padding: 16px; z-index: 9000; animation: ledmFade 0.16s ease-out; }',
  '@keyframes ledmFade { from { opacity: 0 } to { opacity: 1 } }',
  '.ledm-card { background: #ffffff; border-radius: 14px; width: 100%; max-width: 1080px; max-height: 92vh; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 24px 60px rgba(15, 23, 42, 0.3); animation: ledmPop 0.2s cubic-bezier(0.34, 1.3, 0.64, 1); }',
  '@keyframes ledmPop { from { opacity: 0; transform: translateY(12px) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }',
  '.ledm-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 16px 20px; border-bottom: 1px solid #e2e8f0; background: #f8fafc; flex-shrink: 0; }',
  '.ledm-header-left { display: flex; align-items: center; gap: 12px; min-width: 0; }',
  '.ledm-header-info { min-width: 0; }',
  '.ledm-header-icon { width: 40px; height: 40px; border-radius: 10px; background: linear-gradient(135deg, #00e0d4 0%, #008a82 100%); color: #ffffff; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }',
  '.ledm-header-icon svg { width: 18px; height: 18px; stroke-width: 2.2; }',
  '.ledm-title { margin: 0; font-size: 16px; font-weight: 800; color: #0f172a; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
  '.ledm-sub { margin-top: 2px; font-size: 12px; color: #64748b; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
  '.ledm-close { width: 34px; height: 34px; border-radius: 8px; border: none; background: transparent; color: #475569; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; transition: background 0.12s ease, color 0.12s ease; flex-shrink: 0; }',
  '.ledm-close:hover { background: #e2e8f0; color: #0f172a; }',
  '.ledm-close svg { width: 18px; height: 18px; }',
  '.ledm-body { flex: 1; overflow-y: auto; padding: 18px 20px; display: flex; flex-direction: column; gap: 16px; -webkit-overflow-scrolling: touch; }',
  '.ledm-loading { display: flex; align-items: center; gap: 8px; color: #64748b; padding: 24px 0; justify-content: center; }',
  '.ledm-error { background: #fef2f2; border: 1px solid #fecaca; border-left: 4px solid #dc2626; border-radius: 8px; padding: 12px; color: #991b1b; display: flex; align-items: center; gap: 8px; }',
  '.ledm-facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px 20px; }',
  '.ledm-fact { display: flex; flex-direction: column; gap: 3px; min-width: 0; }',
  '.ledm-fact-label { display: inline-flex; align-items: center; gap: 5px; font-size: 10.5px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.06em; color: #94a3b8; }',
  '.ledm-fact-label svg { width: 12px; height: 12px; }',
  '.ledm-fact-value { font-size: 13px; font-weight: 600; color: #1e293b; word-break: break-word; }',
  '.ledm-mono { font-family: "JetBrains Mono", "SF Mono", Monaco, Menlo, monospace; font-size: 11.5px; }',
  '.ledm-shift-panel { display: flex; flex-direction: column; gap: 12px; padding: 14px 16px; background: linear-gradient(135deg, #f0fdfa 0%, #ecfeff 100%); border: 1px solid #99f6e4; border-radius: 12px; box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.7); }',
  '.ledm-shift-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; flex-wrap: wrap; }',
  '.ledm-shift-head-left { display: inline-flex; align-items: center; gap: 12px; min-width: 0; }',
  '.ledm-shift-icon { width: 34px; height: 34px; border-radius: 9px; display: inline-flex; align-items: center; justify-content: center; background: linear-gradient(135deg, #34d399 0%, #047857 100%); color: #ffffff; box-shadow: 0 4px 10px rgba(16, 185, 129, 0.28); flex-shrink: 0; }',
  '.ledm-shift-icon svg { width: 16px; height: 16px; stroke-width: 2.4; }',
  '.ledm-shift-title { font-size: 13.5px; font-weight: 800; color: #0f172a; line-height: 1.2; }',
  '.ledm-shift-title-id { font-family: "JetBrains Mono", "SF Mono", Monaco, Menlo, monospace; color: #0f766e; margin-left: 4px; }',
  '.ledm-shift-sub { font-size: 11.5px; color: #475569; margin-top: 3px; }',
  '.ledm-shift-pill { display: inline-flex; align-items: center; padding: 3px 10px; border-radius: 999px; font-size: 10.5px; font-weight: 800; letter-spacing: 0.04em; text-transform: uppercase; white-space: nowrap; border: 1px solid transparent; }',
  '.ledm-shift-pill--open { background: #ecfdf5; color: #065f46; border-color: #6ee7b7; }',
  '.ledm-shift-pill--closed { background: #fffbeb; color: #78350f; border-color: #fcd34d; }',
  '.ledm-shift-pill--reconciled { background: #eff6ff; color: #1e40af; border-color: #93c5fd; }',
  '.ledm-shift-pill--none { background: #f1f5f9; color: #475569; border-color: #cbd5e1; }',
  '.ledm-shift-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px 14px; }',
  '.ledm-shift-cell { display: flex; flex-direction: column; gap: 3px; min-width: 0; }',
  '.ledm-shift-lbl { display: inline-flex; align-items: center; gap: 4px; font-size: 10px; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; color: #0f766e; }',
  '.ledm-shift-lbl svg { width: 11px; height: 11px; stroke-width: 2.4; flex-shrink: 0; }',
  '.ledm-shift-val { font-size: 13px; font-weight: 600; color: #0f172a; font-variant-numeric: tabular-nums; word-break: break-word; }',
  '.ledm-shift-val--cur { color: #047857; font-weight: 800; }',
  '.ledm-shift-timeline { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px 14px; padding-top: 10px; border-top: 1px dashed #5eead4; }',
  '.ledm-shift-timeline-row { display: flex; flex-direction: column; gap: 2px; min-width: 0; }',
  '.ledm-shift-timeline-lbl { font-size: 9.5px; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; color: #0f766e; }',
  '.ledm-shift-timeline-val { font-size: 12px; font-weight: 600; color: #1e293b; word-break: break-word; }',
  '.ledm-lines-section { display: flex; flex-direction: column; gap: 10px; }',
  '.ledm-lines-head { display: flex; justify-content: space-between; align-items: center; font-size: 13px; color: #475569; }',
  '.ledm-lines-head strong { color: #0f172a; }',
  '.ledm-table-wrap { overflow: auto; border: 1px solid #e2e8f0; border-radius: 10px; max-height: 50vh; }',
  '.ledm-table { width: 100%; border-collapse: collapse; font-size: 12.5px; min-width: 720px; }',
  '.ledm-table thead th { position: sticky; top: 0; z-index: 1; text-align: left; padding: 10px 12px; font-size: 10.5px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.06em; color: #475569; background: #f8fafc; border-bottom: 1px solid #e2e8f0; white-space: nowrap; }',
  '.ledm-table tbody td { padding: 10px 12px; border-bottom: 1px solid #f1f5f9; color: #1e293b; }',
  '.ledm-table tbody tr:last-child td { border-bottom: none; }',
  '.ledm-num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }',
  '.ledm-num--cur { color: #065f46; font-weight: 700; }',
  '.ledm-loc-code, .ledm-item-code { font-family: "JetBrains Mono", "SF Mono", Monaco, Menlo, monospace; font-weight: 700; font-size: 12px; color: #0f172a; }',
  '.ledm-loc-name, .ledm-item-name { font-size: 11px; color: #64748b; margin-top: 1px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 260px; }',
  '.ledm-empty { padding: 32px 16px; text-align: center; color: #94a3b8; font-size: 13px; border: 1px dashed #cbd5e1; border-radius: 10px; }',
  '.ledm-pagination { display: flex; flex-direction: column; align-items: center; gap: 8px; padding-top: 4px; }',
  '.ledm-pagination-info { font-size: 12px; color: #64748b; }',
  '.ledm-pagination-info strong { color: #0f172a; }',
  '.ledm-pagination-controls { display: flex; align-items: center; gap: 4px; }',
  '.ledm-page-btn { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; border: 1px solid #cbd5e1; border-radius: 6px; background: #ffffff; color: #334155; cursor: pointer; transition: border-color 0.12s ease, background 0.12s ease, color 0.12s ease; }',
  '.ledm-page-btn:hover:not(:disabled) { border-color: #00b8b0; background: #f0fdfa; color: #007a72; }',
  '.ledm-page-btn:disabled { opacity: 0.4; cursor: not-allowed; }',
  '.ledm-page-btn svg { width: 14px; height: 14px; }',
  '.ledm-page-chip { min-width: 60px; text-align: center; font-size: 12px; font-weight: 700; color: #334155; }',
  '.ledm-footer { display: flex; justify-content: flex-end; gap: 10px; padding: 12px 20px; border-top: 1px solid #e2e8f0; background: #f8fafc; flex-shrink: 0; }',
  '.ledm-footer--split { justify-content: space-between; flex-wrap: wrap; }',
  '.ledm-footer-exports { display: inline-flex; gap: 8px; flex-wrap: wrap; }',
  '.ledm-btn-ghost { padding: 9px 18px; border-radius: 8px; background: #ffffff; border: 1px solid #cbd5e1; color: #334155; font: inherit; font-weight: 700; cursor: pointer; transition: background 0.12s ease, border-color 0.12s ease; }',
  '.ledm-btn-ghost:hover { background: #f8fafc; border-color: #94a3b8; }',
  '.ledm-btn-export { display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 9px 16px; border-radius: 8px; font: inherit; font-weight: 700; font-size: 13px; cursor: pointer; transition: background 0.12s ease, box-shadow 0.12s ease; border: 1px solid transparent; color: #ffffff; }',
  '.ledm-btn-export svg { width: 14px; height: 14px; stroke-width: 2.4; }',
  '.ledm-btn-export--xls { background: linear-gradient(135deg, #22c55e 0%, #15803d 100%); box-shadow: 0 2px 6px rgba(22, 163, 74, 0.24); }',
  '.ledm-btn-export--xls:hover:not(:disabled) { box-shadow: 0 4px 12px rgba(22, 163, 74, 0.38); }',
  '.ledm-btn-export--doc { background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%); box-shadow: 0 2px 6px rgba(37, 99, 235, 0.24); }',
  '.ledm-btn-export--doc:hover:not(:disabled) { box-shadow: 0 4px 12px rgba(37, 99, 235, 0.38); }',
  '.ledm-btn-export:disabled { opacity: 0.55; cursor: not-allowed; box-shadow: none; }',
  '@media (min-width: 1921px) { .ledm-card { max-width: 1400px; } .ledm-title { font-size: 18px; } .ledm-sub { font-size: 13px; } .ledm-body { padding: 24px 28px; gap: 20px; } .ledm-facts { grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); } .ledm-fact-value { font-size: 14px; } .ledm-table { font-size: 13.5px; min-width: 900px; } .ledm-table thead th { font-size: 11px; padding: 12px 14px; } .ledm-table tbody td { padding: 12px 14px; } .ledm-shift-panel { padding: 18px 20px; } .ledm-shift-title { font-size: 15px; } .ledm-shift-val { font-size: 14.5px; } .ledm-shift-timeline-val { font-size: 13px; } .ledm-btn-export { font-size: 14px; padding: 10px 20px; } }',
  '@media (min-width: 641px) { .ledm-pagination { flex-direction: row; justify-content: space-between; } }',
  '@media (max-width: 900px) { .ledm-shift-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } .ledm-shift-timeline { grid-template-columns: 1fr; } }',
  '@media (max-width: 640px) { .ledm-card { border-radius: 12px; } .ledm-facts { grid-template-columns: 1fr 1fr; gap: 10px 14px; } .ledm-shift-panel { padding: 12px 12px; gap: 10px; } .ledm-shift-grid { grid-template-columns: 1fr 1fr; gap: 8px 10px; } .ledm-shift-title { font-size: 13px; } .ledm-footer--split { flex-direction: column-reverse; gap: 8px; } .ledm-footer-exports { width: 100%; } .ledm-btn-export { flex: 1; } }',
  '@media (max-width: 480px) { .ledm-overlay { padding: 8px; } .ledm-card { max-height: 96vh; border-radius: 12px; } .ledm-header { padding: 12px 14px; gap: 8px; } .ledm-title { font-size: 14px; } .ledm-sub { font-size: 11px; } .ledm-body { padding: 14px; gap: 12px; } .ledm-facts { grid-template-columns: 1fr; gap: 10px; } .ledm-fact-value { font-size: 12.5px; } .ledm-table-wrap { max-height: 40vh; } .ledm-lines-head { font-size: 12.5px; } .ledm-footer { padding: 10px 14px; } .ledm-btn-ghost { flex: 1; min-height: 44px; width: 100%; } .ledm-shift-grid { grid-template-columns: 1fr; gap: 8px; } .ledm-shift-head { flex-direction: column; align-items: flex-start; } .ledm-btn-export { min-height: 44px; } }',
  '@media (max-width: 400px) { .ledm-shift-val { font-size: 12.5px; } .ledm-shift-timeline-val { font-size: 11.5px; } }',
  '@media (max-width: 360px) { .ledm-header { padding: 10px 12px; } .ledm-title { font-size: 13px; } .ledm-body { padding: 12px; } .ledm-fact-label { font-size: 10px; } .ledm-fact-value { font-size: 12px; } .ledm-page-btn { width: 28px; height: 28px; } .ledm-page-btn svg { width: 12px; height: 12px; } .ledm-shift-lbl { font-size: 9.5px; } .ledm-shift-timeline-lbl { font-size: 9px; } }',
  '@media (max-height: 520px) and (orientation: landscape) { .ledm-card { max-height: 98vh; } .ledm-body { padding: 12px 14px; gap: 10px; } .ledm-facts { grid-template-columns: repeat(3, 1fr); } .ledm-table-wrap { max-height: 35vh; } .ledm-shift-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }',

  '/* Motion + a11y */',
  '.icon-spin { animation: ledmSpin 0.9s linear infinite; }',
  '@keyframes ledmSpin { to { transform: rotate(360deg); } }',
  '@media (prefers-reduced-motion: reduce) { .ledm-overlay, .ledm-card { animation: none !important; } .icon-spin { animation: none !important; } .lehist-row, .lehist-card, .lehist-page-btn, .ledm-page-btn, .ledm-btn-ghost, .ledm-btn-export, .lehist-search-clear, .lehist-search-input, .lehist-refresh, .lehist-dirchip, .lehist-row-export-btn { transition: none !important; } .lehist-card:active { transform: none; } }',
].join('\n');