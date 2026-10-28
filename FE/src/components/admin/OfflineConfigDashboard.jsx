// src/components/admin/OfflineConfigDashboard.jsx
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FiActivity, FiLayers, FiHash, FiMapPin,
  FiUserCheck, FiRefreshCw, FiServer, FiInfo,
  FiSearch, FiX,
} from 'react-icons/fi';
import { offlineConfigApi } from '../../services/api';
import { getUser } from '../../secure/auth';
import { useToast } from '../shared/ToastProvider';
import SignatureConfigTab from './underground/SignatureConfigTab';
import ConfigListTab from './ConfigListTab';
import SyncSystemModal from '../shared/SyncSystemModal';

const TABS = [
  { id: 'ACTIVITY_CC',  label: 'Activity / CC',      icon: <FiActivity /> },
  { id: 'LEVEL',        label: 'Level',              icon: <FiLayers /> },
  { id: 'LHD_NO',       label: 'LHD No.',            icon: <FiHash /> },
  { id: 'LOCATORS',     label: 'Bodegas / Locators', icon: <FiMapPin /> }, // ← NEW
  { id: 'AUTHORIZED_BY',label: 'Authorized By',      icon: <FiUserCheck /> },
];

const OfflineConfigDashboard = () => {
  const toast = useToast();
  const currentUser = getUser();
  const isUnderground = useMemo(
    () => String(currentUser?.emp_position || '').trim().toLowerCase() === 'underground handler',
    [currentUser]
  );

  const [activeTab, setActiveTab] = useState('ACTIVITY_CC');
  const [configs, setConfigs] = useState([]);
  const [signatures, setSignatures] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncOpen, setSyncOpen] = useState(false);

  // Pagination & Search State
  const [page, setPage]           = useState(1);
  const [limit]                   = useState(20);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [searchTerm, setSearchTerm] = useState('');
  const [localSearch, setLocalSearch] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await offlineConfigApi.getAll({
        category: activeTab,
        page,
        limit,
        search: searchTerm,
      });
      if (res.ok) {
        setConfigs(Array.isArray(res.data) ? res.data : []);
        setSignatures(Array.isArray(res.signatures) ? res.signatures : []);
        setTotalPages(res.totalPages || 1);
        setTotalCount(res.total || 0);
      } else {
        toast.error(res?.data?.message || 'Failed to load configurations.');
      }
    } catch {
      toast.error('Failed to load configurations.');
    } finally {
      setLoading(false);
    }
  }, [activeTab, page, limit, searchTerm, toast]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    setSearchTerm(localSearch.trim());
    setPage(1);
  };

  const handleClearSearch = () => {
    setLocalSearch('');
    setSearchTerm('');
    setPage(1);
  };

  const handleTabChange = (tabId) => {
    setActiveTab(tabId);
    setPage(1);
    setLocalSearch('');
    setSearchTerm('');
  };

  const activeTabData = TABS.find((t) => t.id === activeTab);

  const title = isUnderground ? 'System Updates' : 'Offline Configurations';
  const subtitle = isUnderground
    ? 'View the configuration currently applied to this device, or receive the latest update from the surface.'
    : 'Manage dropdown options and signatures used by the offline forms.';
  const syncButtonLabel = isUnderground ? 'Receive Update' : 'Sync System';

  return (
    <div className="ocd-root">
      <style>{css}</style>

      {/* ---------- Topbar ---------- */}
      <div className="ocd-topbar">
        <div className="ocd-topbar-header">
          <div className="ocd-title-block">
            <h2 className="ocd-title">{title}</h2>
            <p className="ocd-sub">{subtitle}</p>
          </div>
          <div className="ocd-topbar-actions">
            <button
              className="ocd-refresh-btn"
              onClick={loadData}
              disabled={loading}
              title="Refresh Data"
              aria-label="Refresh Data"
            >
              <FiRefreshCw className={loading ? 'ocd-spin' : ''} />
            </button>
            <button
              className={`ocd-sync-btn ${isUnderground ? 'ocd-sync-btn--accent' : ''}`}
              onClick={() => setSyncOpen(true)}
            >
              <FiServer /> {syncButtonLabel}
            </button>
          </div>
        </div>

        {/* Read-only banner for underground */}
        {isUnderground && (
          <div className="ocd-readonly-banner" role="status">
            <FiInfo className="ocd-readonly-icon" />
            <div>
              <strong>Read-only view.</strong>{' '}
              Configuration changes are made by the surface admin. Use{' '}
              <strong>Receive Update</strong> to apply the latest JSON export
              from the surface.
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="ocd-tabs" role="tablist" aria-label="Configuration categories">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={activeTab === t.id}
              className={`ocd-tab ${activeTab === t.id ? 'is-active' : ''}`}
              onClick={() => handleTabChange(t.id)}
            >
              {t.icon}
              <span>{t.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ---------- Content ---------- */}
      <div className="ocd-content">
        {activeTab === 'AUTHORIZED_BY' ? (
          <SignatureConfigTab readOnly={isUnderground} />
        ) : activeTab === 'LOCATORS' ? (
          <div className="ocd-locator-list" style={{ padding: '24px', maxWidth: 1000, margin: '0 auto', width: '100%' }}>
            <div className="ocd-readonly-banner" style={{ background: '#f0fdfa', borderColor: '#99f6e4', color: '#0f766e', borderLeftColor: '#0d9488', marginBottom: 16 }}>
              <FiMapPin className="ocd-readonly-icon" style={{ color: '#0d9488' }} />
              <div>
                <strong>Synced Bodegas / Locators.</strong>{' '}
                These active locators are exported to the Underground device and appear in the <strong>To Bodega</strong> dropdown of the Offline Stock Transfer form.
              </div>
            </div>

            {/* SEARCH BAR */}
            <div className="ocd-search-section" style={{ padding: 0, marginBottom: 16, background: 'transparent', border: 'none' }}>
              <form onSubmit={handleSearchSubmit} className="ocd-search-form" style={{ maxWidth: '100%' }}>
                <div className="ocd-search-wrap">
                  <FiSearch className="ocd-search-icon" />
                  <input
                    type="text"
                    value={localSearch}
                    onChange={(e) => setLocalSearch(e.target.value)}
                    placeholder="Search locators..."
                    className="ocd-search-input"
                  />
                  {localSearch && (
                    <button type="button" className="ocd-search-clear" onClick={handleClearSearch} aria-label="Clear search">
                      <FiX />
                    </button>
                  )}
                </div>
                <button type="submit" className="ocd-search-btn">Search</button>
              </form>
            </div>

            <div className="ughist-table-wrap">
              <table className="ughist-table">
                <thead>
                  <tr>
                    <th>Warehouse</th>
                    <th>Locator Code</th>
                    <th>Locator Name</th>
                    <th>Type</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && configs.length === 0 ? (
                    <tr><td colSpan={5} style={{ textAlign: 'center', padding: 24 }}><FiRefreshCw className="ocd-spin" /> Loading…</td></tr>
                  ) : configs.length === 0 ? (
                    <tr><td colSpan={5} style={{ textAlign: 'center', padding: 24 }}>No locators found.</td></tr>
                  ) : (
                    configs.map((l) => (
                      <tr key={l.locator_code}>
                        <td><span className="ughist-uid">{l.warehouse_code}</span></td>
                        <td><span className="ughist-uid">{l.locator_code}</span></td>
                        <td>{l.locator_name || '—'}</td>
                        <td>{l.locator_type || 'Regular'}</td>
                        <td><span className="ug-pill ug-pill--open">{l.status}</span></td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <nav className="ughist-pagination" style={{ marginTop: 16 }}>
                <div className="ughist-pagination-info">
                  Showing <strong>{(page - 1) * limit + 1}</strong>–<strong>{Math.min(page * limit, totalCount)}</strong> of <strong>{totalCount}</strong> locators
                </div>
                <div className="ughist-pagination-controls">
                  <button type="button" className="ughist-page-btn" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}>‹</button>
                  <span style={{ minWidth: 60, textAlign: 'center', fontSize: 12, fontWeight: 700, color: '#334155' }}>{page} / {totalPages}</span>
                  <button type="button" className="ughist-page-btn" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>›</button>
                </div>
              </nav>
            )}
          </div>
        ) : (
          <>
            {/* SEARCH BAR */}
            <div className="ocd-search-section">
              <form onSubmit={handleSearchSubmit} className="ocd-search-form">
                <div className="ocd-search-wrap">
                  <FiSearch className="ocd-search-icon" />
                  <input
                    type="text"
                    value={localSearch}
                    onChange={(e) => setLocalSearch(e.target.value)}
                    placeholder={`Search ${activeTabData?.label || ''}...`}
                    className="ocd-search-input"
                  />
                  {localSearch && (
                    <button
                      type="button"
                      className="ocd-search-clear"
                      onClick={handleClearSearch}
                      aria-label="Clear search"
                    >
                      <FiX />
                    </button>
                  )}
                </div>
                <button type="submit" className="ocd-search-btn">
                  <FiSearch /> <span>Search</span>
                </button>
              </form>
            </div>

            {loading && configs.length === 0 ? (
              <div className="ocd-loading">
                <FiRefreshCw className="ocd-spin" /> Loading configurations…
              </div>
            ) : (
              <ConfigListTab
                category={activeTab}
                label={activeTabData?.label || ''}
                configs={configs}
                onRefresh={loadData}
                readOnly={isUnderground}
                page={page}
                totalPages={totalPages}
                totalCount={totalCount}
                onPageChange={setPage}
              />
            )}
          </>
        )}
      </div>

      {/* ---------- Sync modal ---------- */}
      {syncOpen && <SyncSystemModal onClose={() => setSyncOpen(false)} />}
    </div>
  );
};

export default OfflineConfigDashboard;

/* ============================================================ */
const css = `
.ocd-root {
  display: flex; flex-direction: column;
  height: 100%; width: 100%;
  background: #f8fafc; border-radius: 12px; overflow: hidden;
  border: 1px solid #e2e8f0;
  box-sizing: border-box;
}
.ocd-root *, .ocd-root *::before, .ocd-root *::after { box-sizing: border-box; }

/* ---------- Topbar ---------- */
.ocd-topbar {
  background: #ffffff; border-bottom: 1px solid #e2e8f0;
  padding: 24px 24px 0; flex-shrink: 0;
}
.ocd-topbar-header {
  display: flex; justify-content: space-between; align-items: flex-start;
  margin-bottom: 20px; gap: 16px; flex-wrap: wrap;
}
.ocd-title-block { min-width: 0; flex: 1 1 260px; }
.ocd-title {
  font-size: 24px; font-weight: 800; color: #0f172a;
  margin: 0 0 4px; line-height: 1.2;
}
.ocd-sub {
  font-size: 14px; color: #64748b; margin: 0; line-height: 1.45;
  max-width: 70ch;
}

/* ---------- Actions ---------- */
.ocd-topbar-actions {
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
}
.ocd-refresh-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 40px; height: 40px; border-radius: 8px;
  border: 1.5px solid #cbd5e1; background: #fff; color: #64748b;
  cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}
.ocd-refresh-btn:hover:not(:disabled) {
  background: #f1f5f9; color: #0f172a; border-color: #94a3b8;
}
.ocd-refresh-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.ocd-refresh-btn svg { width: 18px; height: 18px; }

.ocd-spin { animation: ocdSpin 1s linear infinite; }
@keyframes ocdSpin { 100% { transform: rotate(360deg); } }

.ocd-sync-btn {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 10px 18px;
  background: #f0fdfa; border: 1.5px solid #00b8b0; border-radius: 8px;
  color: #007a72;
  font: inherit; font-weight: 700; font-size: 14px;
  cursor: pointer;
  transition: background 0.15s, transform 0.15s, box-shadow 0.15s;
  white-space: nowrap;
}
.ocd-sync-btn:hover {
  background: #ccfbf1;
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(0, 184, 176, 0.2);
}
.ocd-sync-btn svg { width: 16px; height: 16px; }
.ocd-sync-btn--accent {
  background: #00b8b0; color: #ffffff; border-color: #008a82;
}
.ocd-sync-btn--accent:hover {
  background: #00d4cb; border-color: #00a099;
  box-shadow: 0 4px 12px rgba(0, 184, 176, 0.32);
}

/* ---------- Read-only banner ---------- */
.ocd-readonly-banner {
  display: flex; align-items: flex-start; gap: 10px;
  margin-bottom: 16px;
  padding: 12px 14px;
  background: #eff6ff; border: 1px solid #bfdbfe;
  border-left: 4px solid #3b82f6; border-radius: 10px;
  font-size: 13px; line-height: 1.5; color: #1e40af;
}
.ocd-readonly-icon {
  width: 18px; height: 18px; flex-shrink: 0; margin-top: 1px;
  color: #2563eb;
}
.ocd-readonly-banner strong { font-weight: 700; color: #1e3a8a; }

/* ---------- Tabs ---------- */
.ocd-tabs {
  display: flex; gap: 4px; overflow-x: auto;
  scrollbar-width: thin;
  padding-bottom: 0;
  -webkit-overflow-scrolling: touch;
}
.ocd-tab {
  display: flex; align-items: center; gap: 8px;
  padding: 12px 20px;
  background: transparent; border: none;
  border-bottom: 3px solid transparent;
  font: inherit; font-size: 14px; font-weight: 700; color: #64748b;
  cursor: pointer; white-space: nowrap;
  transition: color 0.15s, background 0.15s, border-color 0.15s;
}
.ocd-tab:hover { color: #0f172a; background: #f1f5f9; border-radius: 8px 8px 0 0; }
.ocd-tab.is-active { color: #008a82; border-bottom-color: #008a82; }
.ocd-tab svg { width: 16px; height: 16px; flex-shrink: 0; }

/* ---------- Search Bar ---------- */
.ocd-search-section {
  padding: 16px 24px;
  background: #ffffff;
  border-bottom: 1px solid #e2e8f0;
  flex-shrink: 0;
  display: flex;
  justify-content: center; /* Centers the form horizontally */
}
.ocd-search-form {
  display: flex;
  gap: 12px;
  width: 100%;
  max-width: 720px;
  align-items: center;
  margin: 0 auto; /* Double-ensures centering */
}
.ocd-search-wrap {
  position: relative;
  display: flex;
  align-items: center;
  flex: 1;
  height: 44px;
  background: #ffffff;
  border: 1.5px solid #cbd5e1;
  border-radius: 10px;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
  overflow: hidden;
}
.ocd-search-wrap:hover { border-color: #94a3b8; }
.ocd-search-wrap:focus-within {
  border-color: #00b8b0;
  box-shadow: 0 0 0 4px rgba(0, 184, 176, 0.22);
}
.ocd-search-icon {
  width: 18px; height: 18px;
  margin-left: 14px;
  color: #475569;
  stroke-width: 2.6;
  flex-shrink: 0;
}
.ocd-search-wrap:focus-within .ocd-search-icon { color: #0f766e; }
.ocd-search-input {
  flex: 1 1 auto;
  min-width: 0;
  height: 100%;
  padding: 0 10px;
  font-family: inherit;
  font-size: 15px;
  font-weight: 500;
  color: #0f172a;
  background: transparent;
  border: none;
  outline: none;
}
.ocd-search-input::placeholder { color: #64748b; opacity: 1; font-weight: 500; }
.ocd-search-clear {
  display: inline-flex; align-items: center; justify-content: center;
  width: 28px; height: 28px;
  margin-right: 8px;
  border: none; border-radius: 50%; background: transparent;
  color: #475569; cursor: pointer;
  flex-shrink: 0;
  transition: background 0.15s, color 0.15s;
}
.ocd-search-clear svg { width: 16px; height: 16px; stroke-width: 2.8; }
.ocd-search-clear:hover { background: #e2e8f0; color: #0f172a; }
.ocd-search-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  height: 44px; padding: 0 20px;
  border: none; border-radius: 10px;
  background: linear-gradient(135deg, #00e0d4 0%, #00b8b0 45%, #008a82 100%);
  color: #ffffff;
  font: inherit; font-size: 14px; font-weight: 700;
  cursor: pointer; white-space: nowrap;
  flex-shrink: 0;
  box-shadow: 0 4px 12px rgba(0, 200, 190, 0.24);
  transition: box-shadow 0.15s ease, transform 0.1s ease;
}
.ocd-search-btn:hover { box-shadow: 0 6px 16px rgba(0, 200, 190, 0.38); }
.ocd-search-btn:active { transform: scale(0.98); }
.ocd-search-btn svg { width: 15px; height: 15px; stroke-width: 2.6; }

/* ---------- Content ---------- */
.ocd-content {
  flex: 1; overflow-y: auto; background: #f8fafc;
  display: flex; flex-direction: column;
  min-height: 0;
}
.ocd-loading {
  display: flex; align-items: center; justify-content: center; gap: 10px;
  height: 100%; color: #64748b; font-weight: 600; font-size: 15px;
  padding: 40px 20px;
}

/* ============================================================
   RESPONSIVE — Tablet (≤ 900px)
   ============================================================ */
@media (max-width: 900px) {
  .ocd-topbar { padding: 16px 16px 0; }
  .ocd-search-section { padding: 12px 16px; }
  .ocd-search-form { max-width: 100%; }
  .ocd-title { font-size: 22px; }
}

/* ============================================================
   RESPONSIVE — Small Tablet / Large Phone (≤ 768px)
   ============================================================ */
@media (max-width: 768px) {
  .ocd-topbar-header { margin-bottom: 16px; }
  .ocd-title { font-size: 20px; }
  .ocd-sub { font-size: 13px; }
  .ocd-topbar-actions { width: 100%; justify-content: space-between; }
  .ocd-sync-btn { flex: 1; justify-content: center; }

  .ocd-tabs {
    flex-direction: column;
    gap: 6px;
    padding-top: 12px;
    overflow-x: visible;
  }
  .ocd-tab {
    padding: 12px 14px;
    border-radius: 8px;
    border-bottom: none;
    border-left: 3px solid transparent;
    background: #ffffff;
    border: 1px solid #e2e8f0;
    text-align: left;
    justify-content: flex-start;
    width: 100%;
  }
  .ocd-tab:hover { border-radius: 8px; }
  .ocd-tab.is-active {
    border-left: 3px solid #008a82;
    background: #f0fdfa;
    border-color: #99f6e4;
    border-left-color: #008a82;
  }

  .ocd-search-section { padding: 12px 16px; }
  .ocd-search-form { flex-direction: column; align-items: stretch; gap: 10px; }
  .ocd-search-btn { width: 100%; }
}

/* ============================================================
   RESPONSIVE — Phone (≤ 480px)
   ============================================================ */
@media (max-width: 480px) {
  .ocd-topbar { padding: 12px 12px 0; }
  .ocd-title { font-size: 18px; }
  .ocd-sub { font-size: 12px; }
  .ocd-topbar-actions { gap: 8px; }
  .ocd-refresh-btn { width: 36px; height: 36px; }
  .ocd-refresh-btn svg { width: 16px; height: 16px; }
  .ocd-sync-btn { padding: 9px 14px; font-size: 13px; }

  .ocd-tab { padding: 10px 12px; font-size: 13px; }
  .ocd-tab svg { width: 14px; height: 14px; }

  .ocd-search-section { padding: 10px 12px; }
  .ocd-search-wrap { height: 42px; }
  .ocd-search-input { font-size: 14px; }
  .ocd-search-btn { height: 42px; font-size: 13px; }
  .ocd-search-btn svg { width: 14px; height: 14px; }

  .ocd-readonly-banner { font-size: 12px; padding: 10px 12px; gap: 8px; }
  .ocd-readonly-icon { width: 16px; height: 16px; }
}

/* ============================================================
   RESPONSIVE — Ultrawide (≥ 1921px)
   ============================================================ */
@media (min-width: 1921px) {
  .ocd-topbar { padding: 32px 40px 0; }
  .ocd-search-section { padding: 20px 40px; }
  .ocd-title { font-size: 28px; }
  .ocd-sub { font-size: 15px; }
  .ocd-search-wrap { height: 50px; }
  .ocd-search-input { font-size: 16px; }
  .ocd-search-btn { height: 50px; padding: 0 28px; font-size: 15px; }
  .ocd-tab { padding: 14px 24px; font-size: 15px; }
}

/* ============================================================
   Accessibility
   ============================================================ */
@media (prefers-reduced-motion: reduce) {
  .ocd-spin { animation: none; }
  .ocd-search-btn { transition: none; }
}
`;