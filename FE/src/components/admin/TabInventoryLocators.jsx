// src/components/admin/TabInventoryLocators.jsx
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  FiHome,
  FiMapPin,
  FiPackage,
  FiBox,
  FiDollarSign,
  FiRefreshCw,
  FiSearch,
  FiChevronDown,
  FiChevronRight,
  FiChevronLeft,
  FiChevronsLeft,
  FiChevronsRight,
  FiAlertTriangle,
  FiClock,
  FiInbox,
  FiLoader,
  FiDownload,
  FiChevronDown as FiCaretDown,
  FiFileText,
  FiGrid,
} from 'react-icons/fi';
import { locatorsApi } from '../../services/api';
import { useToast } from '../shared/ToastProvider';
import { exportLocatorStockReport } from '../locator/stockReportExport';
import { exportAllWarehousesExcel, exportAllWarehousesWord } from './locatorAdminExport';
// ▸ NEW — Cross-warehouse item code search card (Admin / Super Admin).
import ItemCodeSearchCard from '../shared/ItemCodeSearchCard';
import './TabInventoryLocators.css';

// Session 15 (UX) — one hook handles both tab-return refresh AND
// sibling-mutation refresh. INV_DATA_CHANGED is exported alongside
// the hook (single source of truth for the event name).
import useRefreshOnFocus, { INV_DATA_CHANGED } from '../../hooks/useRefreshOnFocus';

/* ---------- formatters (module scope — stable across renders) ---------- */
const intFmt = new Intl.NumberFormat('en-PH');
const curFmt = new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
});

const fmtInt = (n) => intFmt.format(Number(n) || 0);
const fmtCur = (n) => curFmt.format(Number(n) || 0);
const fmtDate = (d) => {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleString('en-PH', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return '—';
  }
};

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;

const TabInventoryLocators = () => {
  const toast = useToast();

  /* ---------- top-level state ---------- */
  const [summaryData, setSummaryData] = useState(null);
  const [loading, setLoading]         = useState(true);
  const [refreshing, setRefreshing]   = useState(false);
  const [error, setError]             = useState(null);

  const [search, setSearch]                     = useState('');
  const [debouncedSearch, setDebouncedSearch]   = useState('');
  const [warehouseFilter, setWarehouseFilter]   = useState('');

  const [expanded, setExpanded] = useState(() => new Set());

  /**
   * Per-warehouse pagination + data cache.
   */
  const [whData, setWhData] = useState(() => ({}));

  // Which warehouse (if any) is currently exporting its stock report.
  const [exportingWh, setExportingWh] = useState(null);

  // Global Export state
  const [exportAllMenuOpen, setExportAllMenuOpen] = useState(false);
  const [exportingAll, setExportingAll] = useState(false);
  const exportMenuRef = useRef(null);

  // Nonce forces the "check for stale warehouse caches" effect to re-run.
  const [refreshNonce, setRefreshNonce] = useState(0);

  /* ---------- debounce search box ---------- */
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [search]);

  /* ---------- click outside for export menu ---------- */
  useEffect(() => {
    if (!exportAllMenuOpen) return;
    const onDoc = (e) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target)) {
        setExportAllMenuOpen(false);
      }
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setExportAllMenuOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [exportAllMenuOpen]);

  /* ---------- fetch a single warehouse page ---------- */
  const fetchWarehousePage = useCallback(
    async (warehouse_code, page, searchTerm) => {
      setWhData((prev) => ({
        ...prev,
        [warehouse_code]: {
          ...(prev[warehouse_code] || {}),
          loading: true,
          error: null,
          page,
          searchKey: searchTerm,
        },
      }));

      try {
        const res = await locatorsApi.warehouseTotals(warehouse_code, {
          page,
          limit: PAGE_SIZE,
          search: searchTerm,
        });
        const payload = res?.data?.data ?? res?.data ?? null;

        setWhData((prev) => {
          const current = prev[warehouse_code];
          if (current && current.searchKey !== searchTerm) return prev;
          return {
            ...prev,
            [warehouse_code]: {
              locators:   payload?.locators ?? [],
              page:       payload?.page ?? page,
              totalPages: payload?.totalPages ?? 1,
              total:      payload?.total ?? 0,
              loading:    false,
              error:      null,
              searchKey:  searchTerm,
            },
          };
        });
      } catch (err) {
        setWhData((prev) => {
          const current = prev[warehouse_code];
          if (current && current.searchKey !== searchTerm) return prev;
          return {
            ...prev,
            [warehouse_code]: {
              ...(current || {}),
              loading: false,
              error:
                err?.response?.data?.message ||
                err?.message ||
                'Failed to load locators for this warehouse.',
            },
          };
        });
      }
    },
    []
  );

  /* ---------- fetch summary (header + cards + warehouse list) ---------- */
  const loadSummary = useCallback(async ({ silent = false } = {}) => {
    if (silent) setRefreshing(true);
    else        setLoading(true);
    setError(null);
    try {
      const res = await locatorsApi.totals();
      const payload = res?.data?.data ?? res?.data ?? null;
      setSummaryData(payload);

      setWhData({});
      setRefreshNonce((n) => n + 1);

      setExpanded((prev) => {
        if (prev.size > 0) return prev;
        const first = payload?.warehouses?.[0]?.warehouse_code;
        return first ? new Set([first]) : prev;
      });
    } catch (err) {
      setError(
        err?.response?.data?.message ||
        err?.message ||
        'Failed to load locator data.'
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { loadSummary(); }, [loadSummary]);

  /* ============================================================
     Session 15 (UX) — auto-refresh
     ============================================================ */
  useRefreshOnFocus(
    () => loadSummary({ silent: true }),
    { events: [INV_DATA_CHANGED] }
  );

  /* ---------- lazy fetch: expanded + search stale-check ---------- */
  useEffect(() => {
    expanded.forEach((code) => {
      const cache = whData[code];
      const isStale = !cache || cache.searchKey !== debouncedSearch;
      if (isStale) {
        fetchWarehousePage(code, 1, debouncedSearch);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, debouncedSearch, refreshNonce]);

  /* ---------- derived ---------- */
  const summary = summaryData?.summary || {
    warehouse_count: 0,
    locator_count: 0,
    item_count: 0,
    total_qty: 0,
    total_value: 0,
  };

  const allWarehouses = summaryData?.warehouses || [];

  const visibleWarehouses = useMemo(() => {
    if (!allWarehouses.length) return [];
    if (!warehouseFilter) return allWarehouses;
    return allWarehouses.filter((w) => w.warehouse_code === warehouseFilter);
  }, [allWarehouses, warehouseFilter]);

  const visibleLocatorCount = useMemo(
    () => visibleWarehouses.reduce((a, w) => a + (Number(w.locator_count) || 0), 0),
    [visibleWarehouses]
  );

  /* ---------- handlers ---------- */
  const toggleWarehouse = (code) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else                next.add(code);
      return next;
    });
  };

  const expandAll = () => {
    setExpanded(new Set(visibleWarehouses.map((w) => w.warehouse_code)));
  };

  const collapseAll = () => setExpanded(new Set());

  const goToPage = (warehouse_code, page) => {
    const total = whData[warehouse_code]?.totalPages || 1;
    const safePage = Math.min(Math.max(1, page), total);
    fetchWarehousePage(warehouse_code, safePage, debouncedSearch);
  };

  /* ------------------------------------------------------------
     Per-warehouse Stock Report export.
     ------------------------------------------------------------ */
  const handleWarehouseExport = async (warehouse_code, warehouse_name) => {
    if (exportingWh || exportingAll) return;
    if (!warehouse_code) return;

    setExportingWh(warehouse_code);
    try {
      const res = await locatorsApi.exportStockReport(warehouse_code);
      if (!res.ok) {
        throw new Error(res?.data?.message || 'Failed to fetch stock rows.');
      }
      if (!Array.isArray(res.data) || res.data.length === 0) {
        toast.warning(`No stock on hand in ${warehouse_code}.`);
        return;
      }

      const result = exportLocatorStockReport({
        rows: res.data,
        warehouseCode: res.warehouse_code || warehouse_code,
        warehouseName: warehouse_name || '',
      });

      toast.success(
        `Exported ${result.rowCount.toLocaleString()} row(s) for ${warehouse_code} to ${result.filename}`
      );
    } catch (err) {
      console.error('Warehouse stock report export failed:', err);
      toast.error(err?.message || 'Failed to export stock report.');
    } finally {
      setExportingWh(null);
    }
  };

  /* ------------------------------------------------------------
     Global Export (All Warehouses)
     ------------------------------------------------------------ */
  const handleExportAll = async (format) => {
    setExportAllMenuOpen(false);
    if (exportingAll) return;
    if (!allWarehouses.length) {
      toast.warning('No warehouses available to export.');
      return;
    }

    setExportingAll(true);
    toast.info('Compiling full stock data. This may take a moment...');

    try {
      // 1. Fetch stock reports for all warehouses in parallel
      const promises = allWarehouses.map(async (w) => {
        try {
          const res = await locatorsApi.exportStockReport(w.warehouse_code);
          return {
            ...w,
            rows: (res.ok && Array.isArray(res.data)) ? res.data : [],
          };
        } catch (e) {
          console.warn(`Failed to fetch data for ${w.warehouse_code}`, e);
          return { ...w, rows: [] };
        }
      });

      const fullData = await Promise.all(promises);
      
      // 2. Filter out warehouses with no rows to avoid empty sections
      const dataToExport = fullData.filter(w => w.rows.length > 0);

      if (dataToExport.length === 0) {
        toast.warning('No stock found in any warehouse.');
        return;
      }

      // 3. Trigger correct exporter
      if (format === 'excel') {
        exportAllWarehousesExcel(dataToExport);
      } else {
        exportAllWarehousesWord(dataToExport);
      }
      
      toast.success(`Successfully exported data for ${dataToExport.length} warehouses.`);
    } catch (err) {
      console.error('Global export failed:', err);
      toast.error(err?.message || 'Failed to export global data.');
    } finally {
      setExportingAll(false);
    }
  };

  /* ---------- render ---------- */
  return (
    <div className="til-root">
      {/* -------- Header -------- */}
      <div className="til-header">
        <div className="til-header-text">
          <h2 className="til-title">Inventory Locators</h2>
          <p className="til-subtitle">
            Every locator across all warehouses, with live qty and value from
            the same source the handlers see.
          </p>
        </div>
        
        <div className="til-header-actions">
          <button
            type="button"
            className="til-refresh-btn"
            onClick={() => loadSummary({ silent: true })}
            disabled={loading || refreshing || exportingAll}
            aria-label="Refresh locator data"
            title="Refresh"
          >
            <span className={`til-icon ${refreshing ? 'icon-spin' : ''}`}>
              <FiRefreshCw />
            </span>
            <span className="til-refresh-label">
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </span>
          </button>

          {/* Global Export Dropdown */}
          <div className="til-export-wrap" ref={exportMenuRef}>
            <button
              type="button"
              className={`til-export-btn ${exportAllMenuOpen ? 'is-open' : ''}`}
              onClick={() => setExportAllMenuOpen(v => !v)}
              disabled={exportingAll || loading}
            >
              {exportingAll ? (
                <FiLoader className="til-icon icon-spin" />
              ) : (
                <FiDownload className="til-icon" />
              )}
              <span className="til-export-label">
                {exportingAll ? 'Exporting All…' : 'Export All'}
              </span>
              {!exportingAll && <FiCaretDown className={`til-export-caret ${exportAllMenuOpen ? 'is-open' : ''}`} />}
            </button>

            {exportAllMenuOpen && !exportingAll && (
              <ul className="til-export-menu">
                <li>
                  <button type="button" onClick={() => handleExportAll('excel')}>
                    <span className="til-export-icon til-export-icon--xls"><FiGrid /></span>
                    <span className="til-export-item-body">
                      <span className="til-export-item-title">Export to Excel</span>
                      <span className="til-export-item-sub">Summary + Flat Item List (.xlsx)</span>
                    </span>
                  </button>
                </li>
                <li>
                  <button type="button" onClick={() => handleExportAll('word')}>
                    <span className="til-export-icon til-export-icon--doc"><FiFileText /></span>
                    <span className="til-export-item-body">
                      <span className="til-export-item-title">Export to Word</span>
                      <span className="til-export-item-sub">Professional formatted report (.docx)</span>
                    </span>
                  </button>
                </li>
              </ul>
            )}
          </div>
        </div>
      </div>

      {/* -------- Summary cards -------- */}
      <div className="til-summary-grid" role="list">
        <div className="til-summary-card til-summary-card--warehouses" role="listitem">
          <div className="til-summary-icon"><FiHome /></div>
          <div className="til-summary-body">
            <div className="til-summary-value">{fmtInt(summary.warehouse_count)}</div>
            <div className="til-summary-label">Warehouses</div>
          </div>
        </div>

        <div className="til-summary-card til-summary-card--locators" role="listitem">
          <div className="til-summary-icon"><FiMapPin /></div>
          <div className="til-summary-body">
            <div className="til-summary-value">{fmtInt(summary.locator_count)}</div>
            <div className="til-summary-label">Locators</div>
          </div>
        </div>

        <div className="til-summary-card til-summary-card--items" role="listitem">
          <div className="til-summary-icon"><FiPackage /></div>
          <div className="til-summary-body">
            <div className="til-summary-value">{fmtInt(summary.item_count)}</div>
            <div className="til-summary-label">Item slots</div>
          </div>
        </div>

        <div className="til-summary-card til-summary-card--qty" role="listitem">
          <div className="til-summary-icon"><FiBox /></div>
          <div className="til-summary-body">
            <div className="til-summary-value">{fmtInt(summary.total_qty)}</div>
            <div className="til-summary-label">Total qty</div>
          </div>
        </div>

        <div className="til-summary-card til-summary-card--value" role="listitem">
          <div className="til-summary-icon"><FiDollarSign /></div>
          <div className="til-summary-body">
            <div className="til-summary-value til-summary-value--currency">
              {fmtCur(summary.total_value)}
            </div>
            <div className="til-summary-label">Total value</div>
          </div>
        </div>
      </div>

      {/* -------- ▸ NEW: Item Code Search (global scope for Admin / Super Admin) -------- */}
      <ItemCodeSearchCard scope="global" />

      {/* -------- Filter bar -------- */}
      <div className="til-filter-bar">
        <div className="til-search-wrap">
          <span className="til-icon til-search-icon"><FiSearch /></span>
          <input
            type="text"
            className="til-search-input"
            placeholder="Search locator code or name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search locators"
          />
        </div>

        <select
          className="til-warehouse-select"
          value={warehouseFilter}
          onChange={(e) => setWarehouseFilter(e.target.value)}
          aria-label="Filter by warehouse"
        >
          <option value="">All warehouses</option>
          {allWarehouses.map((w) => (
            <option key={w.warehouse_code} value={w.warehouse_code}>
              {w.warehouse_name || w.warehouse_code} ({w.warehouse_code})
            </option>
          ))}
        </select>

        <div className="til-expand-controls">
          <button type="button" className="til-link-btn" onClick={expandAll}>
            Expand all
          </button>
          <span className="til-dot">·</span>
          <button type="button" className="til-link-btn" onClick={collapseAll}>
            Collapse all
          </button>
        </div>
      </div>

      {/* -------- Error -------- */}
      {error && (
        <div className="til-error" role="alert">
          <span className="til-icon til-error-icon"><FiAlertTriangle /></span>
          <span className="til-error-text">{error}</span>
          <button
            type="button"
            className="til-error-retry"
            onClick={() => loadSummary()}
          >
            Try again
          </button>
        </div>
      )}

      {/* -------- Loading skeleton -------- */}
      {loading && (
        <div className="til-loading" aria-live="polite">
          <span className="til-icon icon-spin til-loading-icon"><FiLoader /></span>
          <span>Loading locator data…</span>
        </div>
      )}

      {/* -------- Empty -------- */}
      {!loading && !error && visibleWarehouses.length === 0 && (
        <div className="til-empty">
          <span className="til-icon til-empty-icon"><FiInbox /></span>
          <div className="til-empty-title">
            {allWarehouses.length === 0
              ? 'No warehouses yet'
              : 'No warehouses match your filter'}
          </div>
          <div className="til-empty-sub">
            {allWarehouses.length === 0
              ? 'Create a warehouse and add locators to see them here.'
              : 'Try selecting a different warehouse.'}
          </div>
        </div>
      )}

      {/* -------- Warehouse sections -------- */}
      {!loading && !error && visibleWarehouses.length > 0 && (
        <>
          <div className="til-result-count">
            Showing <strong>{fmtInt(visibleLocatorCount)}</strong> locator
            {visibleLocatorCount === 1 ? '' : 's'} across{' '}
            <strong>{fmtInt(visibleWarehouses.length)}</strong> warehouse
            {visibleWarehouses.length === 1 ? '' : 's'}
          </div>

          <div className="til-warehouse-list">
            {visibleWarehouses.map((w) => {
              const isOpen = expanded.has(w.warehouse_code);
              const wh = whData[w.warehouse_code] || {};
              const isExportingThis = exportingWh === w.warehouse_code;
              return (
                <section
                  key={w.warehouse_code}
                  className={`til-warehouse ${isOpen ? 'is-open' : ''}`}
                >
                  <div className="til-warehouse-header-row">
                    <button
                      type="button"
                      className="til-warehouse-header"
                      onClick={() => toggleWarehouse(w.warehouse_code)}
                      aria-expanded={isOpen}
                      aria-controls={`til-wh-${w.warehouse_code}`}
                    >
                      <span className="til-icon til-wh-caret">
                        {isOpen ? <FiChevronDown /> : <FiChevronRight />}
                      </span>
                      <span className="til-icon til-wh-icon"><FiHome /></span>

                      <span className="til-wh-title">
                        <span className="til-wh-name">
                          {w.warehouse_name || w.warehouse_code}
                        </span>
                        <span className="til-wh-code">{w.warehouse_code}</span>
                      </span>

                      <span className="til-wh-stats">
                        <span className="til-wh-stat">
                          <span className="til-wh-stat-label">Locators</span>
                          <span className="til-wh-stat-value">
                            {fmtInt(w.locator_count)}
                          </span>
                        </span>
                        <span className="til-wh-stat">
                          <span className="til-wh-stat-label">Qty</span>
                          <span className="til-wh-stat-value">
                            {fmtInt(w.total_qty)}
                          </span>
                        </span>
                        <span className="til-wh-stat">
                          <span className="til-wh-stat-label">Value</span>
                          <span className="til-wh-stat-value til-wh-stat-value--cur">
                            {fmtCur(w.total_value)}
                          </span>
                        </span>
                      </span>
                    </button>

                    <button
                      type="button"
                      className="til-wh-export-btn"
                      onClick={() =>
                        handleWarehouseExport(
                          w.warehouse_code,
                          w.warehouse_name || ''
                        )
                      }
                      disabled={!!exportingWh || exportingAll}
                      aria-label={`Export stock report for ${
                        w.warehouse_name || w.warehouse_code
                      }`}
                      title={`Export stock report for ${
                        w.warehouse_name || w.warehouse_code
                      } (.xlsx)`}
                    >
                      {isExportingThis ? (
                        <span className="til-icon icon-spin"><FiLoader /></span>
                      ) : (
                        <span className="til-icon"><FiDownload /></span>
                      )}
                      <span className="til-wh-export-label">Export</span>
                    </button>
                  </div>

                  {isOpen && (
                    <div
                      className="til-warehouse-body"
                      id={`til-wh-${w.warehouse_code}`}
                    >
                      {wh.loading && !wh.locators && (
                        <div className="til-wh-loading" aria-live="polite">
                          <span className="til-icon icon-spin"><FiLoader /></span>
                          <span>Loading locators…</span>
                        </div>
                      )}

                      {wh.error && (
                        <div className="til-wh-error" role="alert">
                          <span className="til-icon til-error-icon"><FiAlertTriangle /></span>
                          <span className="til-error-text">{wh.error}</span>
                          <button
                            type="button"
                            className="til-error-retry"
                            onClick={() => goToPage(w.warehouse_code, 1)}
                          >
                            Retry
                          </button>
                        </div>
                      )}

                      {!wh.loading && !wh.error && wh.locators && wh.locators.length === 0 && (
                        <div className="til-wh-empty">
                          <span className="til-icon"><FiInbox /></span>
                          <span>
                            {debouncedSearch
                              ? 'No locators match your search in this warehouse.'
                              : 'This warehouse has no locators.'}
                          </span>
                        </div>
                      )}

                      {wh.locators && wh.locators.length > 0 && (
                        <>
                          <div className="til-table-wrap">
                            <table className="til-table">
                              <thead>
                                <tr>
                                  <th scope="col">Locator</th>
                                  <th scope="col">Type</th>
                                  <th scope="col">Status</th>
                                  <th scope="col" className="til-items-col">Items</th>
                                  <th scope="col" className="til-num">Qty</th>
                                  <th scope="col" className="til-num">Value</th>
                                  <th scope="col">Last activity</th>
                                </tr>
                              </thead>
                              <tbody>
                                {wh.locators.map((l) => {
                                  const isDamage =
                                    (l.locator_type || '').toLowerCase() === 'damage';
                                  return (
                                    <tr
                                      key={`${w.warehouse_code}-${l.locator_code}`}
                                      className={isDamage ? 'is-damage' : ''}
                                    >
                                      <td data-label="Locator">
                                        <div className="til-cell-locator">
                                          <span className="til-icon til-cell-locator-icon">
                                            <FiMapPin />
                                          </span>
                                          <div className="til-cell-locator-text">
                                            <span className="til-cell-code">
                                              {l.locator_code}
                                            </span>
                                            {l.locator_name && (
                                              <span className="til-cell-name">
                                                {l.locator_name}
                                              </span>
                                            )}
                                          </div>
                                        </div>
                                      </td>

                                      <td data-label="Type">
                                        <span
                                          className={`til-chip ${
                                            isDamage
                                              ? 'til-chip--damage'
                                              : 'til-chip--regular'
                                          }`}
                                        >
                                          {isDamage && (
                                            <span className="til-icon til-chip-icon">
                                              <FiAlertTriangle />
                                            </span>
                                          )}
                                          {l.locator_type || 'Regular'}
                                        </span>
                                      </td>

                                      <td data-label="Status">
                                        <span className="til-status">
                                          {l.status || '—'}
                                        </span>
                                      </td>

                                      <td data-label="Items" className="til-items-col">
                                        <span className="til-item-codes" title={l.item_codes}>
                                          {l.item_codes || '—'}
                                        </span>
                                      </td>
                                      <td data-label="Qty" className="til-num">
                                        {fmtInt(l.total_qty)}
                                      </td>
                                      <td
                                        data-label="Value"
                                        className="til-num til-num--cur"
                                      >
                                        {fmtCur(l.total_value)}
                                      </td>

                                      <td data-label="Last activity">
                                        <span className="til-last-activity">
                                          <span className="til-icon til-last-icon">
                                            <FiClock />
                                          </span>
                                          <span className="til-last-text">
                                            {fmtDate(l.last_activity_at)}
                                          </span>
                                        </span>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>

                          <div className="til-card-list">
                            {wh.locators.map((l) => {
                              const isDamage =
                                (l.locator_type || '').toLowerCase() === 'damage';
                              return (
                                <article
                                  key={`m-${w.warehouse_code}-${l.locator_code}`}
                                  className={`til-loc-card ${isDamage ? 'is-damage' : ''}`}
                                >
                                  <header className="til-loc-card-head">
                                    <div className="til-loc-card-title">
                                      <span className="til-icon til-loc-card-icon">
                                        <FiMapPin />
                                      </span>
                                      <div>
                                        <div className="til-loc-card-code">
                                          {l.locator_code}
                                        </div>
                                        {l.locator_name && (
                                          <div className="til-loc-card-name">
                                            {l.locator_name}
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                    <span
                                      className={`til-chip ${
                                        isDamage
                                          ? 'til-chip--damage'
                                          : 'til-chip--regular'
                                      }`}
                                    >
                                      {isDamage && (
                                        <span className="til-icon til-chip-icon">
                                          <FiAlertTriangle />
                                        </span>
                                      )}
                                      {l.locator_type || 'Regular'}
                                    </span>
                                  </header>

                                  <dl className="til-loc-card-grid">
                                    <div>
                                      <dt>Status</dt>
                                      <dd>{l.status || '—'}</dd>
                                    </div>
                                    <div>
                                      <dt>Qty</dt>
                                      <dd>{fmtInt(l.total_qty)}</dd>
                                    </div>
                                    <div>
                                      <dt>Value</dt>
                                      <dd className="til-num--cur">
                                        {fmtCur(l.total_value)}
                                      </dd>
                                    </div>
                                    <div className="til-card-items">
                                      <dt>Items</dt>
                                      <dd className="til-item-codes">
                                        {l.item_codes || '—'}
                                      </dd>
                                    </div>
                                  </dl>

                                  <footer className="til-loc-card-foot">
                                    <span className="til-icon til-last-icon">
                                      <FiClock />
                                    </span>
                                    <span>{fmtDate(l.last_activity_at)}</span>
                                  </footer>
                                </article>
                              );
                            })}
                          </div>

                          {wh.totalPages > 1 && (
                            <nav
                              className="til-pagination"
                              aria-label={`Pagination for ${w.warehouse_name || w.warehouse_code}`}
                            >
                              <div className="til-page-info">
                                Page <strong>{wh.page}</strong> of{' '}
                                <strong>{wh.totalPages}</strong>
                                <span className="til-page-total">
                                  {' '}
                                  · {fmtInt(wh.total)} locators
                                </span>
                              </div>

                              <div className="til-page-controls">
                                <button
                                  type="button"
                                  className="til-page-btn"
                                  onClick={() => goToPage(w.warehouse_code, 1)}
                                  disabled={wh.page <= 1 || wh.loading}
                                  aria-label="First page"
                                  title="First page"
                                >
                                  <span className="til-icon"><FiChevronsLeft /></span>
                                </button>
                                <button
                                  type="button"
                                  className="til-page-btn"
                                  onClick={() => goToPage(w.warehouse_code, wh.page - 1)}
                                  disabled={wh.page <= 1 || wh.loading}
                                  aria-label="Previous page"
                                  title="Previous page"
                                >
                                  <span className="til-icon"><FiChevronLeft /></span>
                                </button>
                                <span className="til-page-chip">
                                  {wh.page} / {wh.totalPages}
                                </span>
                                <button
                                  type="button"
                                  className="til-page-btn"
                                  onClick={() => goToPage(w.warehouse_code, wh.page + 1)}
                                  disabled={wh.page >= wh.totalPages || wh.loading}
                                  aria-label="Next page"
                                  title="Next page"
                                >
                                  <span className="til-icon"><FiChevronRight /></span>
                                </button>
                                <button
                                  type="button"
                                  className="til-page-btn"
                                  onClick={() => goToPage(w.warehouse_code, wh.totalPages)}
                                  disabled={wh.page >= wh.totalPages || wh.loading}
                                  aria-label="Last page"
                                  title="Last page"
                                >
                                  <span className="til-icon"><FiChevronsRight /></span>
                                </button>
                              </div>
                            </nav>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
};

export default TabInventoryLocators;