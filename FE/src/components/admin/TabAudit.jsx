// src/components/admin/TabAudit.jsx
//
// Session 9 (F4) — Replaced the mock audit log with a real
// WarehouseActivityFeed-backed view.
//
// Session 10 (G5) — Focus-refresh is handled inside
// WarehouseActivityFeed itself, so this wrapper does not need
// to subscribe to visibilitychange.
//
// Two modes:
//   • Admin / Super Admin  → <TabAudit /> — shows a warehouse
//     selector, defaults to the first active warehouse.
//   • Registrar / other    → <TabAudit lockWarehouse
//                              defaultWarehouseCode="LUMB" />
//     — no selector; the feed is scoped to the caller's
//       assigned warehouse.
//
// The feed itself handles All / POs / Transfers tabs, stage
// filter, date range, search, pagination, and focus-refresh.
// This component only owns the warehouse picker + state panel
// when there's nothing to show.

import React, { useEffect, useState } from 'react';
import {
  FiActivity,
  FiAlertTriangle,
  FiRefreshCw,
} from 'react-icons/fi';
import { warehouseApi } from '../../services/api';
import WarehouseActivityFeed from '../shared/WarehouseActivityFeed';

// ============================================================
// Small presentational helper for empty/error/loading states.
// ============================================================
const StatePanel = ({ Icon, title, message, spinning = false }) => (
  <div className="audit-state-panel">
    {Icon && (
      <div className="audit-state-icon">
        <Icon className={spinning ? 'audit-state-icon-spin' : undefined} />
      </div>
    )}
    <div className="audit-state-title">{title}</div>
    {message && <div className="audit-state-message">{message}</div>}
  </div>
);

// ============================================================
// Main component
// ============================================================
const TabAudit = ({
  lockWarehouse = false,
  defaultWarehouseCode = null,
}) => {
  const [warehouses, setWarehouses] = useState([]);
  const [selected, setSelected]     = useState(defaultWarehouseCode || '');
  const [loading, setLoading]       = useState(!lockWarehouse);
  const [error, setError]           = useState('');

  // ---- Fetch warehouses (unlocked mode only) ----
  useEffect(() => {
    if (lockWarehouse) {
      setLoading(false);
      return undefined;
    }

    let cancelled = false;

    (async () => {
      try {
        const res = await warehouseApi.getAllWarehouses();
        if (cancelled) return;

        if (!res.ok || !Array.isArray(res.data)) {
          setError('Could not load the warehouse list.');
          return;
        }

        const active = res.data.filter(
          (w) => w && w.warehouse_code && w.status === 'Active'
        );

        setWarehouses(active);

        setSelected((prev) => {
          if (prev && active.some((w) => w.warehouse_code === prev)) return prev;
          return active[0]?.warehouse_code || '';
        });
      } catch (err) {
        if (cancelled) return;
        console.error('TabAudit warehouse load error:', err);
        setError('Could not load the warehouse list.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [lockWarehouse]);

  // ------------------------------------------------------------
  // Locked mode — scoped to the caller's assigned warehouse.
  // ------------------------------------------------------------
  if (lockWarehouse) {
    if (!defaultWarehouseCode) {
      return (
        <div className="items-section audit-tab">
          <style>{auditCss}</style>
          <StatePanel
            Icon={FiAlertTriangle}
            title="No warehouse assigned"
            message="Your account has no warehouse assignment, so there is no activity to display. Please contact your administrator."
          />
        </div>
      );
    }

    return (
      <div className="items-section audit-tab">
        <style>{auditCss}</style>
        <WarehouseActivityFeed
          warehouseCode={defaultWarehouseCode}
          title="Warehouse Activity"
          defaultSource="all"
          initialLimit={200}
        />
      </div>
    );
  }

  // ------------------------------------------------------------
  // Unlocked mode — Admin / Super Admin.
  // ------------------------------------------------------------
  if (loading) {
    return (
      <div className="items-section audit-tab">
        <style>{auditCss}</style>
        <StatePanel
          Icon={FiRefreshCw}
          title="Loading activity feed…"
          message="Fetching warehouses…"
          spinning
        />
      </div>
    );
  }

  if (error) {
    return (
      <div className="items-section audit-tab">
        <style>{auditCss}</style>
        <StatePanel
          Icon={FiAlertTriangle}
          title="Could not load activity feed"
          message={error}
        />
      </div>
    );
  }

  if (warehouses.length === 0) {
    return (
      <div className="items-section audit-tab">
        <style>{auditCss}</style>
        <StatePanel
          Icon={FiAlertTriangle}
          title="No active warehouses"
          message="Every warehouse has been deactivated. Reactivate one to see its activity."
        />
      </div>
    );
  }

  return (
    <div className="items-section audit-tab">
      <style>{auditCss}</style>

      {/* -------- Toolbar: title + warehouse selector -------- */}
      <div className="audit-toolbar">
        <div className="audit-toolbar-left">
          <div className="audit-toolbar-icon-wrap" aria-hidden="true">
            <FiActivity />
          </div>
          <div className="audit-toolbar-titles">
            <div className="audit-toolbar-title">Activity Feed</div>
            <div className="audit-toolbar-sub">
              {warehouses.length} active warehouse
              {warehouses.length === 1 ? '' : 's'} · every PO and transfer event across the whole warehouse
            </div>
          </div>
        </div>

        <div className="audit-toolbar-right">
          <label className="audit-toolbar-label" htmlFor="audit-warehouse">
            Warehouse
          </label>
          <select
            id="audit-warehouse"
            className="audit-toolbar-select"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            aria-label="Select warehouse"
          >
            {warehouses.map((w) => (
              <option key={w.warehouse_code} value={w.warehouse_code}>
                {w.warehouse_code}{w.warehouse_name ? ` — ${w.warehouse_name}` : ''}
              </option>
            ))}
          </select>
        </div>
      </div>

      {selected ? (
        <WarehouseActivityFeed
          warehouseCode={selected}
          title="Warehouse Activity"
          defaultSource="all"
          initialLimit={200}
        />
      ) : (
        <StatePanel
          Icon={FiActivity}
          title="Select a warehouse"
          message="Choose a warehouse above to view its full activity stream."
        />
      )}
    </div>
  );
};

export default TabAudit;

/* ============================================================
   CSS — component-scoped, responsive from 360px → 4K
   ============================================================ */
const auditCss = `
.audit-tab {
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  display: flex;
  flex-direction: column;
  gap: 14px;
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
}

/* ---------- Toolbar (title + warehouse selector) ---------- */
.audit-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  padding: 14px 18px;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.04);
  box-sizing: border-box;
}

.audit-toolbar-left {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  flex: 1 1 280px;
}

.audit-toolbar-icon-wrap {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 10px;
  background: linear-gradient(135deg, #00e0d4 0%, #008a82 100%);
  color: #ffffff;
  flex-shrink: 0;
  box-shadow: 0 3px 10px rgba(0, 210, 200, 0.28);
}
.audit-toolbar-icon-wrap svg {
  width: 20px;
  height: 20px;
  stroke-width: 2.2;
}

.audit-toolbar-titles {
  min-width: 0;
  flex: 1;
}
.audit-toolbar-title {
  font-size: 15px;
  font-weight: 800;
  color: #0f172a;
  line-height: 1.2;
  letter-spacing: -0.01em;
}
.audit-toolbar-sub {
  margin-top: 3px;
  font-size: 12px;
  color: #64748b;
  line-height: 1.4;
}

.audit-toolbar-right {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
  flex-wrap: wrap;
}

.audit-toolbar-label {
  display: inline-flex;
  align-items: center;
  font-size: 10.5px;
  font-weight: 800;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  white-space: nowrap;
}

.audit-toolbar-select {
  padding: 9px 14px;
  border: 1.5px solid #cbd5e1;
  border-radius: 8px;
  background: #ffffff;
  color: #0f172a;
  font-family: inherit;
  font-size: 13px;
  font-weight: 600;
  outline: none;
  min-width: 240px;
  cursor: pointer;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.audit-toolbar-select:hover:not(:disabled) {
  border-color: #94a3b8;
}
.audit-toolbar-select:focus {
  border-color: #00b8b0;
  box-shadow: 0 0 0 3px rgba(0, 184, 176, 0.15);
}

/* ---------- State panel ---------- */
.audit-state-panel {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 8px;
  padding: 56px 20px;
  background: #f8fafc;
  border: 1px dashed #e2e8f0;
  border-radius: 12px;
}
.audit-state-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: linear-gradient(135deg, #f0fdfa 0%, #ecfeff 100%);
  border: 1px solid #99f6e4;
  color: #0f766e;
  margin-bottom: 4px;
}
.audit-state-icon svg {
  width: 26px;
  height: 26px;
  stroke-width: 1.8;
}
.audit-state-icon-spin {
  animation: auditSpin 0.9s linear infinite;
}
@keyframes auditSpin {
  to { transform: rotate(360deg); }
}
.audit-state-title {
  font-size: 15px;
  font-weight: 800;
  color: #0f172a;
  letter-spacing: -0.01em;
}
.audit-state-message {
  font-size: 13px;
  color: #64748b;
  max-width: 420px;
  line-height: 1.55;
}

/* ============================================================
   Responsive
   ============================================================ */

/* -------- Tablet ≤900px -------- */
@media (max-width: 900px) {
  .audit-toolbar {
    gap: 12px;
  }
  .audit-toolbar-select {
    min-width: 200px;
  }
}

/* -------- Large phone ≤720px -------- */
@media (max-width: 720px) {
  .audit-toolbar {
    flex-direction: column;
    align-items: stretch;
    gap: 12px;
    padding: 14px;
  }
  .audit-toolbar-left {
    flex: 1 1 auto;
  }
  .audit-toolbar-right {
    justify-content: flex-start;
    width: 100%;
  }
  .audit-toolbar-select {
    flex: 1;
    min-width: 0;
  }
}

/* -------- Phone ≤480px -------- */
@media (max-width: 480px) {
  .audit-toolbar {
    padding: 12px 14px;
    gap: 10px;
  }
  .audit-toolbar-icon-wrap {
    width: 36px;
    height: 36px;
  }
  .audit-toolbar-icon-wrap svg {
    width: 18px;
    height: 18px;
  }
  .audit-toolbar-title {
    font-size: 14px;
  }
  .audit-toolbar-sub {
    font-size: 11.5px;
  }
  .audit-toolbar-right {
    flex-direction: column;
    align-items: stretch;
    gap: 6px;
  }
  .audit-toolbar-select {
    width: 100%;
    min-height: 44px;
    font-size: 16px; /* prevents iOS zoom on focus */
  }
  .audit-state-panel {
    padding: 40px 16px;
  }
  .audit-state-icon {
    width: 48px;
    height: 48px;
  }
  .audit-state-icon svg {
    width: 22px;
    height: 22px;
  }
  .audit-state-title {
    font-size: 14px;
  }
  .audit-state-message {
    font-size: 12.5px;
  }
}

/* -------- Very small phone ≤380px -------- */
@media (max-width: 380px) {
  .audit-toolbar {
    padding: 10px 12px;
  }
  .audit-toolbar-title {
    font-size: 13.5px;
  }
  .audit-toolbar-sub {
    font-size: 11px;
  }
  .audit-toolbar-select {
    font-size: 15px;
    padding: 10px 12px;
  }
}

/* -------- Ultrawide ≥1921px -------- */
@media (min-width: 1921px) {
  .audit-toolbar {
    padding: 18px 24px;
  }
  .audit-toolbar-icon-wrap {
    width: 48px;
    height: 48px;
    border-radius: 12px;
  }
  .audit-toolbar-icon-wrap svg {
    width: 24px;
    height: 24px;
  }
  .audit-toolbar-title {
    font-size: 17px;
  }
  .audit-toolbar-sub {
    font-size: 13px;
  }
  .audit-toolbar-select {
    font-size: 14px;
    padding: 10px 16px;
    min-width: 280px;
  }
}

/* -------- Reduced motion -------- */
@media (prefers-reduced-motion: reduce) {
  .audit-state-icon-spin {
    animation: none !important;
  }
  .audit-toolbar-select {
    transition: none !important;
  }
}
`;