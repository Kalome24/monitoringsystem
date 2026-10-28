// src/components/underground/UndergroundHandler.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FiBarChart2,
  FiBox,
  FiClock,
  FiUploadCloud,
  FiLock,
  FiLoader,
  FiFilePlus,
  FiRefreshCw,
  FiSettings,
  FiArrowRight,
} from 'react-icons/fi';
import DashboardLayout from '../../layout/DashboardLayout';
import AssignmentBadge from '../../layout/AssignmentBadge';
import { getUser } from '../../secure/auth';
import { undergroundApi } from '../../services/api';
import { useToast } from '../shared/ToastProvider';
import { undergroundCss } from './undergroundStyles';
import UndergroundDashboard from './UndergroundDashboard';
import UndergroundInventory from './UndergroundInventory';
import UndergroundSeedImportModal from './UndergroundSeedImportModal';
import UndergroundShiftCloseModal from './UndergroundShiftCloseModal';
import IssueFormPicker from './issueForms/IssueFormPicker';
import IssueFormModal from './issueForms/IssueFormModal';
import TabSync from './TabSync';
import OfflineConfigDashboard from '../admin/OfflineConfigDashboard';
import UndergroundOfflineActions from './UndergroundOfflineActions';
import UndergroundActivityHistory from './UndergroundActivityHistory'; // NEW IMPORT

import { emitAppEvent, UG_DATA_CHANGED } from '../../hooks/useRefreshOnFocus';

const PENDING_SYNC_KEY = 'ims:underground:pendingSync';
const RETRY_INTERVAL_MS = 20000;
const HEALTH_PING_URL = `${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api/health`;

const readPendingSync = () => {
  try {
    const raw = sessionStorage.getItem(PENDING_SYNC_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.shift_id !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
};

const writePendingSync = (payload) => {
  try { sessionStorage.setItem(PENDING_SYNC_KEY, JSON.stringify(payload)); } catch { /* ignore */ }
};

const clearPendingSyncStorage = () => {
  try { sessionStorage.removeItem(PENDING_SYNC_KEY); } catch { /* ignore */ }
};

const UndergroundHandler = () => {
  const currentUser = getUser();
  const toast = useToast();

  const [activeTab, setActiveTab] = useState('dashboard');

  const [shift, setShift] = useState(null);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  
  // NEW: Track the scoped bodegas for the UI
  const [scopedBodegas, setScopedBodegas] = useState(null);

  const [seedOpen, setSeedOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);

  const [issuePickerOpen, setIssuePickerOpen] = useState(false);
  const [issueFormType, setIssueFormType] = useState(null);

  const [pendingSync, setPendingSync] = useState(() => readPendingSync());
  const retryingRef = useRef(false);

  const refresh = useCallback(
    async ({ silent = false } = {}) => {
      if (!silent) setLoading(true);
      try {
        const res = await undergroundApi.currentShift();
        if (res.ok && res.data) {
          setShift(res.data.shift || null);
          setSummary(res.data.summary || null);
          // NEW: Extract scoped_bodegas from the response
          setScopedBodegas(res.data.scoped_bodegas || null);
        } else {
          setShift(null);
          setSummary(null);
          setScopedBodegas(null);
        }
      } catch (err) {
        console.error('Failed to load underground shift:', err);
        toast.error('Could not load shift state.');
      } finally {
        setLoading(false);
      }
    },
    [toast]
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!pendingSync) return undefined;

    let cancelled = false;
    let timer = null;

    const tryRetry = async () => {
      if (cancelled) return;
      if (retryingRef.current) return;
      if (typeof navigator !== 'undefined' && !navigator.onLine) return;

      try {
        const health = await fetch(HEALTH_PING_URL, { method: 'HEAD', cache: 'no-store' });
        if (!health.ok) return;
      } catch {
        return;
      }

      if (cancelled) return;

      retryingRef.current = true;
      try {
        const shiftId = pendingSync.shift_id;
        const result = await undergroundApi.syncOnline(shiftId, {
          sync_token: pendingSync.sync_token || undefined,
          notes: 'Auto-retry after reconnect',
        });

        if (cancelled) return;

        if (result.ok) {
          clearPendingSyncStorage();
          setPendingSync(null);
          toast.success('Sync completed after reconnect.');
          await refresh({ silent: true });
          return;
        }

        if (result.status === 409) {
          clearPendingSyncStorage();
          setPendingSync(null);
          toast.info('Shift was already reconciled.');
          await refresh({ silent: true });
          return;
        }

        if (result.status >= 400 && result.status < 500) {
          clearPendingSyncStorage();
          setPendingSync(null);
          toast.warning(result.data?.message || 'Sync could not be completed.');
          return;
        }

        console.warn('Sync retry still failing; will try again shortly.');
      } catch (err) {
        console.warn('Sync retry network error:', err);
      } finally {
        retryingRef.current = false;
      }
    };

    const onOnline = () => {
      if (typeof navigator !== 'undefined' && navigator.onLine) tryRetry();
    };
    window.addEventListener('online', onOnline);

    timer = setInterval(() => {
      if (typeof navigator !== 'undefined' && navigator.onLine) tryRetry();
    }, RETRY_INTERVAL_MS);

    tryRetry();

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      window.removeEventListener('online', onOnline);
    };
  }, [pendingSync, refresh, toast]);

  const handleSyncQueued = useCallback((payload) => {
    writePendingSync(payload);
    setPendingSync(payload);
  }, []);

  const handleSyncSucceeded = useCallback(() => {
    clearPendingSyncStorage();
    setPendingSync(null);
  }, []);

  // ---- Sidebar (UPDATED - Consolidated History) ----
  const menuGroups = useMemo(
    () => [
      {
        title: 'Underground',
        items: [
          { id: 'dashboard',        label: 'Dashboard',        icon: <FiBarChart2 /> },
          { id: 'inventory',        label: 'Inventory',        icon: <FiBox /> },
          { id: 'operations',       label: 'Operations',       icon: <FiArrowRight /> },
          { id: 'sync',             label: 'Sync',             icon: <FiRefreshCw /> },
          { id: 'activity-history', label: 'Activity History', icon: <FiClock /> },
        ],
      },
      {
        title: 'Configuration',
        items: [
          { id: 'systemupdates',    label: 'System Updates',   icon: <FiSettings /> },
        ],
      },
    ],
    []
  );

  const openSeed  = useCallback(() => setSeedOpen(true),  []);
  const openClose = useCallback(() => setCloseOpen(true), []);
  const openIssue = useCallback(() => setIssuePickerOpen(true), []);

  const closeIssueChain = useCallback(() => {
    setIssuePickerOpen(false);
    setIssueFormType(null);
  }, []);

  const handlePickFormType = useCallback((formType) => {
    setIssuePickerOpen(false);
    setIssueFormType(formType);
  }, []);

  const handleIssueSuccess = useCallback(async () => {
    await refresh({ silent: true });
    emitAppEvent(UG_DATA_CHANGED, { source: 'issue-form' });
  }, [refresh]);

  const headerActions = (
    <div className="ug-header-actions">
      {!shift && !loading && (
        <button type="button" className="ug-btn ug-btn--primary ug-btn--sm" onClick={openSeed}>
          <FiUploadCloud />
          <span>Import Surface Export</span>
        </button>
      )}
      {shift && shift.status === 'Open' && (
        <>
          <button type="button" className="ug-btn ug-btn--primary ug-btn--sm" onClick={openIssue} title="Create an issue form">
            <FiFilePlus />
            <span>Issue</span>
          </button>
          <button type="button" className="ug-btn ug-btn--danger ug-btn--sm" onClick={openClose}>
            <FiLock />
            <span>End Shift</span>
          </button>
        </>
      )}
    </div>
  );

  // ---- Render Tab (UPDATED) ----
  const renderTab = () => {
    switch (activeTab) {
      case 'dashboard':
        return (
          <UndergroundDashboard
            currentShift={shift}
            summary={summary}
            loading={loading}
            onOpenSeedImport={openSeed}
            onOpenCloseShift={openClose}
            onOpenIssue={openIssue}
            onRefresh={refresh}
            scopedBodegas={scopedBodegas} // Pass to dashboard if it needs it
          />
        );
      case 'inventory':
        return (
          <UndergroundInventory
            currentShift={shift}
            loading={loading}
            onRefresh={refresh}
            onOpenSeedImport={openSeed}
            onOpenIssue={openIssue}
            scopedBodegas={scopedBodegas} // NEW: Pass to inventory
          />
        );
      case 'operations':
        return (
          <UndergroundOfflineActions
            shift={shift}
            onRefresh={() => refresh({ silent: true })}
          />
        );
      case 'sync':
        return (
          <TabSync
            onSyncQueued={handleSyncQueued}
            onSyncSucceeded={handleSyncSucceeded}
            pendingSync={pendingSync}
          />
        );
      case 'activity-history':
        return <UndergroundActivityHistory />;
      case 'systemupdates':
        return <OfflineConfigDashboard />;
      default:
        return null;
    }
  };

  // ---- Titles ----
  const title =
    activeTab === 'dashboard'        ? 'Underground Dashboard'
    : activeTab === 'inventory'      ? 'Underground Inventory'
    : activeTab === 'operations'     ? 'Operations'
    : activeTab === 'sync'           ? 'Sync'
    : activeTab === 'activity-history'? 'Activity History'
    : activeTab === 'systemupdates'  ? 'System Updates'
    : 'Underground';

  return (
    <>
      <style>{undergroundCss}</style>
      <DashboardLayout
        menuGroups={menuGroups}
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        title={title}
        fetching={false}
        extraBadge={
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {headerActions}
            <AssignmentBadge />
          </div>
        }
      >
        <div className="ug-root ug-section">
          {loading && !shift && activeTab !== 'systemupdates' ? (
            <div className="ug-loading">
              <FiLoader className="ug-spin" />
              <span>Loading underground workspace…</span>
            </div>
          ) : (
            renderTab()
          )}
        </div>
      </DashboardLayout>

      {seedOpen && (
        <UndergroundSeedImportModal
          onClose={() => setSeedOpen(false)}
          onSuccess={async () => {
            setSeedOpen(false);
            setActiveTab('inventory');
            await refresh({ silent: true });
            emitAppEvent(UG_DATA_CHANGED, { source: 'seed-import' });
          }}
        />
      )}

      {closeOpen && shift && (
        <UndergroundShiftCloseModal
          shift={shift}
          onClose={() => setCloseOpen(false)}
          onSuccess={async () => {
            setCloseOpen(false);
            await refresh({ silent: true });
            emitAppEvent(UG_DATA_CHANGED, { source: 'shift-close' });
          }}
        />
      )}

      {issuePickerOpen && (
        <IssueFormPicker
          onClose={closeIssueChain}
          onSelect={handlePickFormType}
        />
      )}

      {issueFormType && shift && (
        <IssueFormModal
          formType={issueFormType}
          shift={shift}
          onClose={closeIssueChain}
          onSuccess={handleIssueSuccess}
        />
      )}
    </>
  );
};

export default UndergroundHandler;