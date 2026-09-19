// src/components/registrar/TabStockTransfer.jsx
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { usePermissions } from '../../permissions/usePermissions';
import { getUser } from '../../secure/auth';
import { warehouseApi, stockTransferApi } from '../../services/api';
import ReceiveTransferModal from './ReceiveTransferModal';

// ============================================================
// Helpers
// ============================================================
const formatDateTime = (v) => {
  if (!v) return '—';
  try {
    return new Date(v).toLocaleString();
  } catch {
    return v;
  }
};

const statusBadgeClass = (status) => {
  if (status === 'Approved')  return 'status-badge active';
  if (status === 'Received')  return 'status-badge stored';
  if (status === 'Pending')   return 'status-badge pending-transfer';
  return 'status-badge';
};

// ============================================================
// Component
// ============================================================
const TabStockTransfer = () => {
  const { can } = usePermissions();
  const currentUser = getUser();
  const userWarehouseId = currentUser?.warehouse_assigned;

  // ---- Assigned warehouse (display only) ----
  const [assignedWarehouse, setAssignedWarehouse] = useState(null);
  const [warehouseLoading, setWarehouseLoading] = useState(false);

  // ---- List state ----
  const [transfers, setTransfers] = useState([]);
  const [loading, setLoading]     = useState(false);
  const [summary, setSummary]     = useState({ approved: 0, received: 0, total: 0 });

  // ---- Filters ----
  const [searchTerm, setSearchTerm]     = useState('');
  const [statusFilter, setStatusFilter] = useState('Approved'); // default = actionable queue

  // ---- Modal ----
  const [openTransfer, setOpenTransfer] = useState(null);

  // ============================================================
  // Assigned warehouse
  // ============================================================
  useEffect(() => {
    if (currentUser?.warehouse_code || currentUser?.warehouse_name) {
      setAssignedWarehouse({
        warehouse_id: currentUser.warehouse_assigned || null,
        warehouse_code: currentUser.warehouse_code || '',
        warehouse_name: currentUser.warehouse_name || '',
        warehouse_location: currentUser.warehouse_location || '',
      });
    }
    if (!userWarehouseId) return;

    let cancelled = false;
    (async () => {
      try {
        setWarehouseLoading(true);
        const res = await warehouseApi.getWarehouseById(userWarehouseId);
        if (cancelled) return;
        if (res.ok && res.data) {
          const wh = res.data.data || res.data;
          if (wh && (wh.warehouse_code || wh.warehouse_name)) {
            setAssignedWarehouse({
              warehouse_id: wh.warehouse_id ?? userWarehouseId,
              warehouse_code: wh.warehouse_code || '',
              warehouse_name: wh.warehouse_name || '',
              warehouse_location: wh.warehouse_location || '',
            });
          }
        }
      } catch (err) {
        console.warn('Could not refresh warehouse info:', err);
      } finally {
        if (!cancelled) setWarehouseLoading(false);
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userWarehouseId]);

  const warehouseLabel = useMemo(() => {
    if (assignedWarehouse?.warehouse_code && assignedWarehouse?.warehouse_name) {
      return `${assignedWarehouse.warehouse_code} — ${assignedWarehouse.warehouse_name}`;
    }
    if (assignedWarehouse?.warehouse_code) return assignedWarehouse.warehouse_code;
    if (assignedWarehouse?.warehouse_name) return assignedWarehouse.warehouse_name;
    if (warehouseLoading) return 'Loading warehouse...';
    return 'Not assigned';
  }, [assignedWarehouse, warehouseLoading]);

  // ============================================================
  // Load incoming transfers
  // ============================================================
  const loadTransfers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await stockTransferApi.listIncoming({
        status: statusFilter === 'All' ? undefined : statusFilter,
        search: searchTerm || undefined,
      });
      if (res.ok) {
        setTransfers(Array.isArray(res.data) ? res.data : []);
      } else {
        console.error('Failed to load incoming transfers:', res);
        setTransfers([]);
      }
    } finally {
      setLoading(false);
    }
  }, [statusFilter, searchTerm]);

  const loadSummary = useCallback(async () => {
    try {
      const res = await stockTransferApi.getIncomingSummary();
      if (res.ok && res.data) {
        setSummary(res.data);
      }
    } catch (err) {
      console.warn('Could not load summary:', err);
    }
  }, []);

  useEffect(() => { loadTransfers(); }, [loadTransfers]);
  useEffect(() => { loadSummary();  }, [loadSummary]);

  // ============================================================
  // Modal handlers
  // ============================================================
  const handleOpenReceive = (sts) => setOpenTransfer(sts);
  const handleCloseReceive = () => setOpenTransfer(null);

  const handleReceived = async () => {
    await Promise.all([loadTransfers(), loadSummary()]);
  };

  const clearFilters = () => {
    setSearchTerm('');
    setStatusFilter('Approved');
  };

  // ============================================================
  // Row actions
  // ============================================================
  const renderRowActions = (sts) => {
    const canReceive = can('stocktransfer.receive') && sts.status === 'Approved';

    if (canReceive) {
      return (
        <div className="action-buttons">
          <button
            className="action-btn edit"
            onClick={(e) => { e.stopPropagation(); handleOpenReceive(sts); }}
            title="Confirm receipt of this transfer"
          >
            📥 Receive
          </button>
        </div>
      );
    }

    return (
      <button
        type="button"
        className="po-view-hint"
        onClick={(e) => { e.stopPropagation(); handleOpenReceive(sts); }}
        title="View details"
      >
        View ›
      </button>
    );
  };

  // ============================================================
  // Render
  // ============================================================
  return (
    <div className="items-section">
      {/* ============ SECTION HEADER ============ */}
      <div className="section-header">
        <h3>🚚 Incoming Stock Transfers</h3>
        <div className="header-actions">
          <span className="item-count">
            {summary.total === 0
              ? 'No transfers yet'
              : `${summary.approved} awaiting receipt · ${summary.received} received`}
          </span>
        </div>
      </div>

      {/* Info banner */}
      <div
        style={{
          background: '#eff6ff',
          border: '1px solid #bfdbfe',
          borderRadius: 8,
          padding: '10px 14px',
          marginBottom: 16,
          fontSize: 13,
          color: '#1e3a8a',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <span style={{ fontSize: 18 }}>📥</span>
        <span>
          Stock Transfer Slips <strong>approved by the Department Head</strong> and
          addressed to <strong>{warehouseLabel}</strong> appear here. Confirm
          receipt once the physical items arrive at your warehouse.
        </span>
      </div>

      {/* ============ RECEIVE MODAL ============ */}
      {openTransfer && (
        <ReceiveTransferModal
          sts={openTransfer}
          onClose={handleCloseReceive}
          onReceived={handleReceived}
        />
      )}

      {/* ============ FILTERS ============ */}
      <div className="dashboard-search-section">
        <div className="dashboard-filters">
          <div className="filter-row">
            <div className="filter-group search-group">
              <label>Search</label>
              <input
                type="text"
                placeholder="Search STS No. or PO No..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="filter-input"
              />
            </div>
            <div className="filter-group">
              <label>Status</label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="filter-input"
              >
                <option value="Approved">Awaiting Receipt (Approved)</option>
                <option value="Received">Received</option>
                <option value="All">All</option>
              </select>
            </div>
            <div className="filter-group action-group">
              <button
                className="cancel-btn"
                onClick={clearFilters}
                style={{ padding: '8px 16px' }}
              >
                Clear Filters
              </button>
              <button
                className="add-user-btn"
                onClick={() => { loadTransfers(); loadSummary(); }}
                style={{ padding: '8px 16px' }}
              >
                Refresh
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ============ LIST ============ */}
      <div className="daily-items-section">
        <div className="daily-items-header">
          <h4>Stock Transfer Slips</h4>
          <span className="daily-items-count">
            {transfers.length === 0
              ? '0 slip(s)'
              : `${transfers.length} slip${transfers.length === 1 ? '' : 's'}`}
          </span>
        </div>

        {/* Desktop table */}
        <div className="table-wrapper">
          {loading ? (
            <div className="loading-spinner" style={{ margin: '20px auto' }} />
          ) : transfers.length > 0 ? (
            <table className="data-table po-compact-table">
              <thead>
                <tr>
                  <th>STS No.</th>
                  <th>From Warehouse</th>
                  <th>Transfer Date</th>
                  <th>PO No.</th>
                  <th style={{ textAlign: 'center' }}>Lines</th>
                  <th style={{ textAlign: 'center' }}>Total Qty</th>
                  <th>Approved By</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {transfers.map((sts) => (
                  <tr
                    key={sts.sts_id}
                    onClick={() => handleOpenReceive(sts)}
                    className="po-clickable-row"
                    title="Click to view details"
                  >
                    <td>
                      <span className="po-no-big" style={{ fontSize: 16 }}>
                        {sts.sts_no}
                      </span>
                    </td>
                    <td>
                      {sts.from_warehouse_code
                        ? `${sts.from_warehouse_code} — ${sts.from_warehouse_name || ''}`
                        : `WH ${sts.from_warehouse_id}`}
                    </td>
                    <td>{sts.transfer_date || '—'}</td>
                    <td>
                      {sts.po_no ? (
                        <span
                          style={{
                            fontFamily: "'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace",
                            fontSize: 12,
                            color: '#0f766e',
                            fontWeight: 600,
                          }}
                        >
                          {sts.po_no}
                        </span>
                      ) : '—'}
                    </td>
                    <td style={{ textAlign: 'center', fontWeight: 600 }}>
                      {sts.line_count ?? 0}
                    </td>
                    <td style={{ textAlign: 'center', fontWeight: 600 }}>
                      {sts.total_qty ?? 0}
                    </td>
                    <td>{sts.approved_by || '—'}</td>
                    <td>
                      <span className={statusBadgeClass(sts.status)}>{sts.status}</span>
                    </td>
                    <td
                      style={{ textAlign: 'right' }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {renderRowActions(sts)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="no-items-message">
              <p>
                {statusFilter === 'Approved'
                  ? 'No transfers awaiting receipt. Items you transfer in will appear here once the Department Head approves them.'
                  : 'No stock transfer slips match the current filter.'}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default TabStockTransfer;