// src/components/locator/InventoryLocatorSection.jsx
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  FiMapPin,
  FiAlertTriangle,
  FiPlus,
  FiRefreshCw,
  FiDownload,
  FiChevronDown,
  FiFileText,
  FiGrid,
  FiLoader,
  FiClock,
  FiLayers,
  FiUploadCloud,
} from 'react-icons/fi';
import { getUser } from '../../secure/auth';
import { usePermissions } from '../../permissions/usePermissions';
import { useToast } from '../shared/ToastProvider';
import { locatorsApi, locatorLogApi } from '../../services/api';
import LocatorFilterSidebar from './LocatorFilterSidebar';
import LocatorGrid from './LocatorGrid';
import LocatorDetailModal from './LocatorDetailModal';
import LocatorFormModal from './LocatorFormModal';
import ManualWriteoffModal from '../shared/ManualWriteoffModal';
import { locatorCss } from './locatorStyles';
import { exportToExcel, exportToPDF } from './locatorExport';
// Stock Report export — flat, single-sheet, reporting only.
import { exportLocatorStockReport } from './stockReportExport';
// ▸ NEW — Item code search card, scoped to the caller's warehouse.
import ItemCodeSearchCard from '../shared/ItemCodeSearchCard';
import LocatorSyncHistory from './LocatorSyncHistory';
import UndergroundShiftsPanel from '../underground/UndergroundShiftsPanel';

// Session 15 (UX) — one hook handles both tab-return refresh AND
// sibling-mutation refresh. INV_DATA_CHANGED is exported alongside
// the hook (single source of truth for the event name).
import useRefreshOnFocus, { INV_DATA_CHANGED } from '../../hooks/useRefreshOnFocus';

const PAGE_SIZE = 20;

// ⚡ LUMB has been removed from the offline system scope. Only UG.
const SYNC_WAREHOUSE_CODES = ['UG'];
const isSyncWarehouseCode = (code) => {
  if (!code) return false;
  return SYNC_WAREHOUSE_CODES.includes(String(code).trim().toUpperCase());
};

const InventoryLocatorSection = () => {
  const currentUser = getUser();
  const warehouseCode = currentUser?.warehouse_code || '';
  const warehouseName = currentUser?.warehouse_name || '';
  const { can } = usePermissions();
  const toast = useToast();
  const canManage = can('inventorylocator.manage');

  const isSyncWarehouse = isSyncWarehouseCode(warehouseCode);

  const [tab, setTab] = useState('locators');

  const [locators, setLocators] = useState([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filter, setFilter] = useState({ type: 'all', value: null });

  const [sidebarOptions, setSidebarOptions] = useState({
    purchase_classes: [],
    categories: [],
    statuses: [],
    locator_types: [],
    total: 0,
    summary: null,
  });

  const [editing, setEditing]             = useState(null);
  const [creating, setCreating]           = useState(false);
  const [opened, setOpened]               = useState(null);
  const [writeoffOpen, setWriteoffOpen]   = useState(false);

  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [exporting, setExporting]           = useState(false);
  const [exportProgress, setExportProgress] = useState(null);
  const exportMenuRef = useRef(null);

  // Stock Report export (flat Excel for reporting — every warehouse)
  const [reportExporting, setReportExporting] = useState(false);

  const isExporting = exporting || reportExporting;

  useEffect(() => {
    if (!isSyncWarehouse && tab !== 'locators') {
      setTab('locators');
    }
  }, [isSyncWarehouse, tab]);

  const debounceRef = useRef();
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [search]);

  useEffect(() => {
    if (!exportMenuOpen) return;
    const onDoc = (e) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target)) {
        setExportMenuOpen(false);
      }
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setExportMenuOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [exportMenuOpen]);

  /* ------------------------------------------------------------
     loadLocators — silent flag skips the full-page spinner.
     ------------------------------------------------------------ */
  const loadLocators = useCallback(async ({ silent = false } = {}) => {
    if (!warehouseCode) return;
    if (!silent) setLoading(true);
    try {
      const params = {
        warehouse_code: warehouseCode,
        page,
        limit: PAGE_SIZE,
      };
      if (debouncedSearch) params.search = debouncedSearch;
      if (filter.type === 'purchase_class') params.purchase_class = filter.value;
      if (filter.type === 'category')       params.category       = filter.value;
      if (filter.type === 'status')         params.status         = filter.value;
      if (filter.type === 'locator_type')   params.locator_type   = filter.value;

      const res = await locatorsApi.list(params);
      if (res.ok) {
        setLocators(Array.isArray(res.data) ? res.data : []);
        setTotal(res.total || 0);
        setTotalPages(res.totalPages || 1);
      } else {
        console.error('Failed to load locators:', res);
        setLocators([]);
        setTotal(0);
        setTotalPages(1);
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, [warehouseCode, page, debouncedSearch, filter]);

  useEffect(() => { loadLocators(); }, [loadLocators]);

  const loadSidebar = useCallback(async () => {
    if (!warehouseCode) return;
    try {
      const res = await locatorsApi.getFilterOptions(warehouseCode);
      if (res.ok && res.data) {
        setSidebarOptions({
          purchase_classes: res.data.purchase_classes || [],
          categories:       res.data.categories       || [],
          statuses:         res.data.statuses         || [],
          locator_types:    res.data.locator_types    || [],
          total:            res.data.total            || 0,
          summary:          res.data.summary          || null,
        });
      }
    } catch (e) {
      console.warn('Could not load filter options:', e);
    }
  }, [warehouseCode]);

  useEffect(() => { loadSidebar(); }, [loadSidebar]);

  /* ============================================================
     Session 15 (UX) — auto-refresh
     ============================================================ */
  useRefreshOnFocus(
    () => {
      loadLocators({ silent: true });
      loadSidebar();
    },
    { events: [INV_DATA_CHANGED] }
  );

  const handleSelectFilter = (type, value) => {
    setFilter({ type, value });
    setPage(1);
  };

  const handlePageChange = (next) => {
    if (next < 1 || next > totalPages) return;
    setPage(next);
    const grid = document.querySelector('.locator-grid');
    if (grid && grid.scrollIntoView) {
      grid.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const handleAdd   = () => setCreating(true);
  const handleEdit  = (loc) => setEditing(loc);
  const handleClose = () => { setCreating(false); setEditing(null); };
  const handleSaved = async () => {
    await Promise.all([loadLocators(), loadSidebar()]);
  };

  const handleOpenWriteoff  = () => setWriteoffOpen(true);
  const handleCloseWriteoff = () => setWriteoffOpen(false);
  const handleWriteoffSaved = async () => {
    await Promise.all([loadLocators(), loadSidebar()]);
  };

  /* ------------------------------------------------------------
     Sync export (existing) — UG only, file-hash + log.
     ------------------------------------------------------------ */
  const runExport = async (format) => {
    setExportMenuOpen(false);
    if (exporting) return;
    if (!warehouseCode) {
      toast.error('No warehouse assigned to this account.');
      return;
    }
    if (!isSyncWarehouse) {
      toast.error('Export is only available for the UG warehouse.');
      return;
    }

    setExporting(true);
    setExportProgress({ phase: 'locators', done: 0, total: 0 });

    try {
      const fn = format === 'pdf' ? exportToPDF : exportToExcel;

      const result = await fn({
        warehouseCode,
        warehouseName,
        exportedBy: currentUser?.username || 'user',
        onProgress: (p) => setExportProgress(p),
      });

      let loggedUid = null;
      try {
        const payload = {
          direction:              'Export',
          action_type:            'Manual Export',
          export_format:          format === 'pdf' ? 'PDF' : 'Excel',
          source_warehouse_code:  warehouseCode,
          source_warehouse_name:  warehouseName || null,
          target_warehouse_code:  null,
          target_warehouse_name:  null,
          locator_count:          result.locatorCount || 0,
          item_row_count:         result.itemRowCount || 0,
          total_qty:              result.totalQty || 0,
          total_value:            result.totalValue || 0,
          filename:               result.filename,
          file_hash:              result.fileHash || null,
          file_size_bytes:        result.fileSizeBytes || null,
          notes:                  null,
          linked_export_id:       null,
          lines:                  result.lines || [],
        };
        const logRes = await locatorLogApi.create(payload);
        if (logRes.ok) {
          loggedUid = logRes.data?.data?.export_uid || null;
        } else {
          console.warn('Export log write failed:', logRes?.data);
          toast.warning(
            'File downloaded, but history log could not be recorded. ' +
            'Please inform your administrator.'
          );
        }
      } catch (logErr) {
        console.error('Export log POST failed:', logErr);
        toast.warning(
          'File downloaded, but history log could not be recorded. ' +
          'Please inform your administrator.'
        );
      }

      const rowsLabel =
        format === 'pdf'
          ? `${result.locatorCount} locator(s)`
          : `${result.locatorCount} locator(s), ${result.itemRowCount} item row(s)`;

      const suffix = loggedUid ? ` · logged as ${loggedUid}` : '';
      toast.success(`Exported ${rowsLabel} to ${result.filename}${suffix}`);
    } catch (err) {
      console.error('Export failed:', err);
      toast.error(err?.message || 'Failed to export. Please try again.');
    } finally {
      setExporting(false);
      setExportProgress(null);
    }
  };

  /* ------------------------------------------------------------
     STOCK REPORT export (new) — flat Excel, every warehouse.
     ------------------------------------------------------------ */
  const runReportExport = async () => {
    setExportMenuOpen(false);
    if (reportExporting) return;
    if (!warehouseCode) {
      toast.error('No warehouse assigned to this account.');
      return;
    }
    setReportExporting(true);
    try {
      const res = await locatorsApi.exportStockReport(warehouseCode);
      if (!res.ok) {
        throw new Error(res?.data?.message || 'Failed to fetch stock rows.');
      }
      if (!Array.isArray(res.data) || res.data.length === 0) {
        toast.warning('No stock on hand in this warehouse.');
        return;
      }

      const result = exportLocatorStockReport({
        rows: res.data,
        warehouseCode: res.warehouse_code || warehouseCode,
        warehouseName,
        exportedBy: currentUser?.username || 'user',
      });

      toast.success(
        `Exported ${result.rowCount.toLocaleString()} row(s) to ${result.filename}`
      );
    } catch (err) {
      console.error('Stock report export failed:', err);
      toast.error(err?.message || 'Failed to export stock report.');
    } finally {
      setReportExporting(false);
    }
  };

  const sidebarTotal = sidebarOptions.total || 0;

  if (!warehouseCode) {
    return (
      <div className="items-section">
        <style>{locatorCss}</style>
        <div className="no-items-message">
          <p>Your account has no assigned warehouse, so no locators can be shown.</p>
        </div>
      </div>
    );
  }

  const warehouseLabel = warehouseName
    ? `${warehouseCode} — ${warehouseName}`
    : warehouseCode;

  const exportProgressLabel = (() => {
    if (!exporting || !exportProgress) return null;
    if (exportProgress.phase === 'locators') return 'Reading locators…';
    if (exportProgress.phase === 'items' && exportProgress.total > 0) {
      return `Fetching items… ${exportProgress.done} / ${exportProgress.total}`;
    }
    return 'Preparing file…';
  })();

  const showSyncUI = isSyncWarehouse;
  const showLocators = !showSyncUI || tab === 'locators';
  const showSync     = showSyncUI && tab === 'sync';
  const showHistory  = showSyncUI && tab === 'history';

  return (
    <div className="items-section inventory-locator-section">
      <style>{locatorCss}</style>
      <style>{exportMenuCss}</style>
      <style>{subTabsCss}</style>
      <style>{headerCss}</style>

      {/* -------- Sub-tabs: Locators / Sync / History -------- */}
      {showSyncUI && (
        <div className="ils-subtabs" role="tablist" aria-label="Inventory locator views">
          <button
            role="tab"
            aria-selected={tab === 'locators'}
            className={`ils-subtab ${tab === 'locators' ? 'is-active' : ''}`}
            onClick={() => setTab('locators')}
            type="button"
          >
            <FiLayers className="ils-subtab-icon" />
            <span>Locators</span>
          </button>
          <button
            role="tab"
            aria-selected={tab === 'sync'}
            className={`ils-subtab ${tab === 'sync' ? 'is-active' : ''}`}
            onClick={() => setTab('sync')}
            type="button"
          >
            <FiUploadCloud className="ils-subtab-icon" />
            <span>Sync</span>
          </button>
          <button
            role="tab"
            aria-selected={tab === 'history'}
            className={`ils-subtab ${tab === 'history' ? 'is-active' : ''}`}
            onClick={() => setTab('history')}
            type="button"
          >
            <FiClock className="ils-subtab-icon" />
            <span>History</span>
          </button>
        </div>
      )}

      {showLocators && (
        <>
          <div className="section-header">
            <h3>
              <FiMapPin className="section-heading-icon" />
              <span>Inventory Locator</span>
              <span className="locator-count-badge">{total.toLocaleString()} locators</span>
            </h3>
            <div className="header-actions">
              
              {/* ---- Unified Export Dropdown ---- */}
              <div className="lex-export-wrap" ref={exportMenuRef}>
                <button
                  type="button"
                  className={`lex-export-btn ${exportMenuOpen ? 'is-open' : ''}`}
                  onClick={() => setExportMenuOpen((v) => !v)}
                  disabled={isExporting}
                  aria-haspopup="menu"
                  aria-expanded={exportMenuOpen}
                  aria-label="Export data"
                  title={exportProgressLabel || 'Export'}
                >
                  {isExporting ? (
                    <FiLoader className="locator-btn-icon icon-spin" />
                  ) : (
                    <FiDownload className="locator-btn-icon" />
                  )}
                  <span className="lex-export-btn-label">
                    {isExporting ? 'Exporting…' : 'Export'}
                  </span>
                  {!isExporting && (
                    <FiChevronDown
                      className={`lex-export-caret ${exportMenuOpen ? 'is-open' : ''}`}
                    />
                  )}
                </button>

                {exportMenuOpen && !isExporting && (
                  <ul className="lex-export-menu" role="menu">
                    
                    {/* SYNC DATA SECTION (Moved to Top) */}
                    {showSyncUI && (
                      <>
                        <li role="none" className="lex-export-group-label">Underground Sync Data</li>
                        <li role="none">
                          <button
                            type="button"
                            role="menuitem"
                            className="lex-export-item"
                            onClick={() => runExport('excel')}
                          >
                            <span className="lex-export-item-icon lex-export-item-icon--blue">
                              <FiFileText />
                            </span>
                            <span className="lex-export-item-body">
                              <span className="lex-export-item-title">Sync Data (Excel)</span>
                              <span className="lex-export-item-sub">
                                Full locator summary with items
                              </span>
                            </span>
                          </button>
                        </li>
                        <li role="none">
                          <button
                            type="button"
                            role="menuitem"
                            className="lex-export-item"
                            onClick={() => runExport('pdf')}
                          >
                            <span className="lex-export-item-icon lex-export-item-icon-pdf">
                              <FiFileText />
                            </span>
                            <span className="lex-export-item-body">
                              <span className="lex-export-item-title">Sync Data (PDF)</span>
                              <span className="lex-export-item-sub">
                                Printable summary format
                              </span>
                            </span>
                          </button>
                        </li>
                        <li role="none" className="lex-export-divider" />
                      </>
                    )}

                    {/* REPORTING SECTION (Moved to Bottom) */}
                    <li role="none" className="lex-export-group-label">Reporting</li>
                    <li role="none">
                      <button
                        type="button"
                        role="menuitem"
                        className="lex-export-item"
                        onClick={runReportExport}
                      >
                        <span className="lex-export-item-icon lex-export-item-icon--xls">
                          <FiGrid />
                        </span>
                        <span className="lex-export-item-body">
                          <span className="lex-export-item-title">Stock Report (Excel)</span>
                          <span className="lex-export-item-sub">
                            Flat list of all items on hand
                          </span>
                        </span>
                      </button>
                    </li>
                  </ul>
                )}
              </div>

              {/* ---- Write-off Button (Softened) ---- */}
              {canManage && (
                <button
                  className="locator-writeoff-btn"
                  onClick={handleOpenWriteoff}
                  type="button"
                  title="Move damaged units from a locator into the DAMAGE-XX hold"
                >
                  <FiAlertTriangle className="locator-btn-icon" />
                  <span>Log Damage</span>
                </button>
              )}

              {/* ---- Add Locator (Primary) ---- */}
              {canManage && (
                <button className="add-user-btn" onClick={handleAdd} type="button">
                  <FiPlus className="locator-btn-icon" />
                  <span>Add Locator</span>
                </button>
              )}
            </div>
          </div>

          {/* -------- Item Code Search -------- */}
          <ItemCodeSearchCard scope="warehouse" />

          <div className="locator-layout">
            <LocatorFilterSidebar
              filter={filter}
              totalCount={sidebarTotal}
              purchaseClasses={sidebarOptions.purchase_classes}
              categories={sidebarOptions.categories}
              statuses={sidebarOptions.statuses}
              locatorTypes={sidebarOptions.locator_types}
              summary={sidebarOptions.summary}
              onSelect={handleSelectFilter}
            />

            <div className="locator-content">
              <div className="locator-search-bar">
                <div className="search-input-wrap">
                  <input
                    type="text"
                    placeholder="Search locator code or name…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="filter-input"
                  />
                </div>
                <div className="search-actions">
                  <button
                    className="cancel-btn"
                    onClick={() => setSearch('')}
                    type="button"
                  >
                    Clear
                  </button>
                  <button
                    className="refresh-btn"
                    onClick={() => { loadLocators(); loadSidebar(); }}
                    type="button"
                  >
                    <FiRefreshCw className="locator-btn-icon" />
                    <span>Refresh</span>
                  </button>
                </div>
              </div>

              <LocatorGrid
                locators={locators}
                loading={loading}
                page={page}
                total={total}
                totalPages={totalPages}
                limit={PAGE_SIZE}
                onOpen={setOpened}
                onPageChange={handlePageChange}
              />
            </div>
          </div>
        </>
      )}

      {showSync && <UndergroundShiftsPanel />}

      {showHistory && <LocatorSyncHistory />}

      {(creating || editing) && (
        <LocatorFormModal
          locator={editing}
          warehouseCode={warehouseCode}
          purchaseClasses={sidebarOptions.purchase_classes}
          categories={sidebarOptions.categories}
          onClose={handleClose}
          onSaved={handleSaved}
        />
      )}

      {opened && (
        <LocatorDetailModal
          locator={opened}
          warehouseCode={warehouseCode}
          canEdit={canManage}
          onClose={() => setOpened(null)}
          onEdit={handleEdit}
        />
      )}

      {writeoffOpen && (
        <ManualWriteoffModal
          warehouseCode={warehouseCode}
          warehouseLabel={warehouseLabel}
          onClose={handleCloseWriteoff}
          onSaved={handleWriteoffSaved}
        />
      )}
    </div>
  );
};

/* ------------------------------------------------------------
   Header & Buttons CSS — `headerCss`
   ------------------------------------------------------------ */
const headerCss = `
.inventory-locator-section .section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: 16px;
}
.inventory-locator-section .section-header h3 {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 20px;
  font-weight: 700;
  color: #0f172a;
  margin: 0;
}

.locator-count-badge {
  display: inline-flex;
  align-items: center;
  padding: 4px 10px;
  background: #f1f5f9;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  color: #475569;
  letter-spacing: 0.02em;
}

.inventory-locator-section .header-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

/* Softened Write-off Button */
.locator-writeoff-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 10px 16px;
  min-height: 40px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  background: #fff1f2;
  border: 1.5px solid #fecdd3;
  color: #e11d48;
  white-space: nowrap;
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease, box-shadow 0.15s ease;
}
.locator-writeoff-btn:hover {
  background: #ffe4e6;
  border-color: #fda4af;
  color: #be123c;
  box-shadow: 0 2px 6px rgba(225, 29, 72, 0.12);
}
.locator-writeoff-btn:focus-visible {
  outline: 2px solid #e11d48;
  outline-offset: 2px;
}

/* Primary Add Button Overrides (if not caught globally) */
.inventory-locator-section .add-user-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 10px 18px;
  min-height: 40px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 700;
  font-family: inherit;
  cursor: pointer;
  background: linear-gradient(135deg, #00e0d4 0%, #00b8b0 45%, #008a82 100%);
  color: #ffffff;
  border: none;
  box-shadow: 0 4px 12px rgba(0, 200, 190, 0.32);
  white-space: nowrap;
  transition: transform 0.1s ease, box-shadow 0.15s ease, opacity 0.15s ease;
}
.inventory-locator-section .add-user-btn:hover {
  box-shadow: 0 6px 16px rgba(0, 200, 190, 0.45);
  transform: translateY(-1px);
}
.inventory-locator-section .add-user-btn:active {
  transform: translateY(0);
}
.inventory-locator-section .add-user-btn:focus-visible {
  outline: 2px solid #00b8b0;
  outline-offset: 2px;
}

/* Responsive Header Layout */
@media (max-width: 768px) {
  .inventory-locator-section .section-header {
    flex-direction: column;
    align-items: flex-start;
  }
  .inventory-locator-section .header-actions {
    width: 100%;
    display: grid;
    grid-template-columns: 1fr 1fr;
  }
  .inventory-locator-section .header-actions > * {
    width: 100%;
  }
  .inventory-locator-section .lex-export-wrap {
    grid-column: span 1;
  }
  .inventory-locator-section .lex-export-btn {
    width: 100%;
    justify-content: space-between;
  }
  .inventory-locator-section .add-user-btn {
    grid-column: span 2;
  }
}

@media (max-width: 480px) {
  .inventory-locator-section .header-actions {
    grid-template-columns: 1fr;
  }
  .inventory-locator-section .lex-export-wrap {
    grid-column: span 1;
  }
  .inventory-locator-section .add-user-btn {
    grid-column: span 1;
  }
}
`;

/* ------------------------------------------------------------
   Export Dropdown — `lex-` prefix
   ------------------------------------------------------------ */
const exportMenuCss = `
.lex-export-wrap {
  position: relative;
  display: inline-flex;
}

.lex-export-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 10px 16px;
  min-height: 40px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 700;
  font-family: inherit;
  cursor: pointer;
  border: 1.5px solid #94a3b8;
  background: #ffffff;
  color: #1e293b;
  white-space: nowrap;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.08);
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease, box-shadow 0.15s ease;
}
.lex-export-btn:hover:not(:disabled) {
  border-color: #00b8b0;
  background: #f0fdfa;
  color: #007a72;
  box-shadow: 0 4px 10px rgba(0, 184, 176, 0.18);
}
.lex-export-btn:focus-visible {
  outline: 2px solid #00b8b0;
  outline-offset: 2px;
}
.lex-export-btn:disabled {
  opacity: 0.75;
  cursor: progress;
}
.lex-export-btn.is-open {
  border-color: #00b8b0;
  background: #f0fdfa;
  color: #007a72;
}

.lex-export-caret {
  width: 12px;
  height: 12px;
  transition: transform 0.18s ease;
  flex-shrink: 0;
}
.lex-export-caret.is-open { transform: rotate(180deg); }

.lex-export-menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  list-style: none;
  margin: 0;
  padding: 6px;
  min-width: 280px;
  max-width: min(340px, calc(100vw - 24px));
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  box-shadow: 0 16px 40px rgba(15, 23, 42, 0.16), 0 4px 12px rgba(15, 23, 42, 0.08);
  z-index: 60;
  animation: lexPop 0.15s cubic-bezier(0.34, 1.3, 0.64, 1);
}
@keyframes lexPop {
  from { opacity: 0; transform: translateY(-4px) scale(0.98); }
  to   { opacity: 1; transform: translateY(0)    scale(1); }
}

.lex-export-group-label {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 12px 12px 6px;
  font-size: 12px;
  font-weight: 800;
  color: #334155;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
.lex-export-group-label::before {
  content: '';
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #00b8b0;
}

.lex-export-divider {
  height: 1px;
  background: #e2e8f0;
  margin: 6px 0;
}

.lex-export-item {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  width: 100%;
  padding: 10px 12px;
  background: transparent;
  border: none;
  border-radius: 8px;
  text-align: left;
  font-family: inherit;
  cursor: pointer;
  transition: background 0.12s ease;
}
.lex-export-item:hover { background: #f0fdfa; }
.lex-export-item:focus-visible {
  outline: 2px solid #00b8b0;
  outline-offset: -2px;
}

.lex-export-item-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 8px;
  flex-shrink: 0;
  font-size: 16px;
  color: #ffffff;
}
.lex-export-item-icon--xls {
  background: linear-gradient(135deg, #22c55e 0%, #15803d 100%);
  box-shadow: 0 3px 8px rgba(22, 163, 74, 0.28);
}
.lex-export-item-icon--blue {
  background: linear-gradient(135deg, #60a5fa 0%, #2563eb 100%);
  box-shadow: 0 3px 8px rgba(37, 99, 235, 0.28);
}
.lex-export-item-icon-pdf {
  background: linear-gradient(135deg, #f87171 0%, #b91c1c 100%);
  box-shadow: 0 3px 8px rgba(220, 38, 38, 0.28);
}
.lex-export-item-icon svg { width: 16px; height: 16px; stroke-width: 2.2; }

.lex-export-item-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.lex-export-item-title {
  font-size: 13.5px;
  font-weight: 700;
  color: #0f172a;
  line-height: 1.2;
}
.lex-export-item-sub {
  font-size: 11.5px;
  font-weight: 500;
  color: #64748b;
  line-height: 1.35;
}
.lex-export-item:hover .lex-export-item-title { color: #007a72; }

@media (max-width: 640px) {
  .lex-export-wrap { flex: 1 1 100%; }
  .lex-export-btn  { width: 100%; }
  .lex-export-btn-label { flex: 1 1 auto; text-align: left; }
  .lex-export-menu {
    left: 0;
    right: auto;
    min-width: 260px;
    max-width: calc(100vw - 24px);
  }
  .lex-export-item { padding: 12px; }
}

@media (min-width: 641px) and (max-width: 900px) {
  .lex-export-btn { padding: 9px 14px; font-size: 12.5px; }
}

@media (min-width: 1921px) {
  .lex-export-btn { padding: 11px 18px; font-size: 14px; }
  .lex-export-item { padding: 12px 14px; }
  .lex-export-item-title { font-size: 14.5px; }
  .lex-export-item-sub   { font-size: 12.5px; }
}

@media (prefers-reduced-motion: reduce) {
  .lex-export-menu { animation: none !important; }
  .lex-export-caret { transition: none !important; }
  .icon-spin { animation: none !important; }
}
`;

/* ------------------------------------------------------------
   Sub-tab bar — `ils-subtabs` (Locators / Sync / History)
   ------------------------------------------------------------ */
const subTabsCss = `
.ils-subtabs {
  display: flex;
  gap: 4px;
  margin-bottom: 14px;
  padding: 4px;
  background: #f1f5f9;
  border-radius: 10px;
  border: 1px solid #e2e8f0;
  width: 100%;
  max-width: 560px;
  box-sizing: border-box;
}
.ils-subtab {
  flex: 1 1 0;
  min-height: 40px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 8px 14px;
  background: transparent;
  border: none;
  border-radius: 8px;
  color: #475569;
  font: inherit;
  font-size: 13.5px;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.16s ease, color 0.16s ease, box-shadow 0.16s ease;
}
.ils-subtab:hover:not(.is-active) {
  color: #0f172a;
  background: rgba(255, 255, 255, 0.55);
}
.ils-subtab.is-active {
  background: #ffffff;
  color: #007a72;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.08),
              0 0 0 1px rgba(0, 184, 176, 0.35);
}
.ils-subtab:focus-visible {
  outline: 2px solid #00b8b0;
  outline-offset: 2px;
}
.ils-subtab-icon { width: 15px; height: 15px; }

@media (max-width: 480px) {
  .ils-subtabs { max-width: 100%; }
  .ils-subtab  { min-height: 42px; font-size: 12.5px; padding: 6px 8px; gap: 6px; }
  .ils-subtab-icon { width: 14px; height: 14px; }
}

@media (max-width: 360px) {
  .ils-subtab { font-size: 11.5px; padding: 6px 4px; gap: 4px; }
  .ils-subtab-icon { width: 12px; height: 12px; }
}
`;

export default InventoryLocatorSection;