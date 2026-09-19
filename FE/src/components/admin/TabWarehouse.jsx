// src/components/admin/TabWarehouse.jsx
import React from 'react';
import { usePermissions } from '../../permissions/usePermissions';

const TabWarehouse = ({ adminData }) => {
  const {
    warehouses,
    loading,
    // main warehouse state
    showAddWarehouse,
    showEditWarehouse,
    newWarehouse,
    editWarehouseData,
    handleAddWarehouse,
    handleCloseWarehouseForm,
    handleNewWarehouseChange,
    handleSaveWarehouse,
    handleEditWarehouse,
    handleCloseEditWarehouse,
    handleEditWarehouseChange,
    handleUpdateWarehouse,
    handleDeactivateWarehouse,
    handleActivateWarehouse,
    handleDeleteWarehouse,
  } = adminData;

  const { can } = usePermissions();

  return (
    <div className="warehouse-section">
      <div className="section-header">
        <h3>Warehouse Management</h3>
        <div className="header-actions">
          <div className="warehouse-stats">
            <span className="stat-badge active">
              Active: {warehouses.filter(w => w.status === 'Active').length}
            </span>
            <span className="stat-badge inactive">
              Deactivated: {warehouses.filter(w => w.status === 'Deactivated').length}
            </span>
          </div>
          {can('warehouse.create') && (
            <button className="add-warehouse-btn" onClick={handleAddWarehouse}>
              <span className="btn-icon">➕</span>
              <span>Add Warehouse</span>
            </button>
          )}
        </div>
      </div>

      {/* ============================================
          ADD WAREHOUSE FORM
          ============================================ */}
      {can('warehouse.create') && showAddWarehouse && (
        <div className="add-warehouse-form">
          <div className="form-header">
            <h4>Add New Warehouse</h4>
            <button className="close-form-btn" onClick={handleCloseWarehouseForm}>✕</button>
          </div>
          <div className="form-body">
            <div className="form-group">
              <label htmlFor="warehouseName">
                Warehouse Name <span className="required">*</span>
              </label>
              <input
                id="warehouseName"
                name="warehouse_name"
                type="text"
                placeholder="Enter name"
                value={newWarehouse.warehouse_name}
                onChange={handleNewWarehouseChange}
              />
            </div>
            <div className="form-group">
              <label htmlFor="warehouseCode">
                Warehouse Code <span className="required">*</span>
              </label>
              <input
                id="warehouseCode"
                name="warehouse_code"
                type="text"
                placeholder="Unique code"
                value={newWarehouse.warehouse_code}
                onChange={handleNewWarehouseChange}
              />
              <small style={{ color: '#7a8699' }}>
                Must be unique. Once saved, the code cannot be changed.
              </small>
            </div>
            <div className="form-group">
              <label htmlFor="warehouseLocation">
                Location <span className="required">*</span>
              </label>
              <input
                id="warehouseLocation"
                name="warehouse_location"
                type="text"
                placeholder="Location"
                value={newWarehouse.warehouse_location}
                onChange={handleNewWarehouseChange}
              />
            </div>
            <div className="form-group">
              <label htmlFor="warehouseStatus">Status</label>
              <select
                id="warehouseStatus"
                name="status"
                value={newWarehouse.status}
                onChange={handleNewWarehouseChange}
              >
                <option value="Active">Active</option>
                <option value="Deactivated">Deactivated</option>
              </select>
            </div>
          </div>
          <div className="form-footer">
            <button className="cancel-btn" onClick={handleCloseWarehouseForm}>
              <span className="btn-icon">✕</span>
              <span>Cancel</span>
            </button>
            <button className="save-btn" onClick={handleSaveWarehouse}>
              <span className="btn-icon">💾</span>
              <span>Save Warehouse</span>
            </button>
          </div>
        </div>
      )}

      {/* ============================================
          EDIT WAREHOUSE FORM
          ============================================ */}
      {can('warehouse.edit') && showEditWarehouse && (
        <div className="add-warehouse-form">
          <div className="form-header">
            <h4>Edit Warehouse</h4>
            <button className="close-form-btn" onClick={handleCloseEditWarehouse}>✕</button>
          </div>
          <div className="form-body">
            <div className="form-group">
              <label htmlFor="editWarehouseName">
                Warehouse Name <span className="required">*</span>
              </label>
              <input
                id="editWarehouseName"
                name="warehouse_name"
                type="text"
                value={editWarehouseData.warehouse_name}
                onChange={handleEditWarehouseChange}
              />
            </div>
            <div className="form-group">
              <label htmlFor="editWarehouseCode">
                Warehouse Code <span className="required">*</span>
              </label>
              <input
                id="editWarehouseCode"
                name="warehouse_code"
                type="text"
                value={editWarehouseData.warehouse_code}
                disabled
                readOnly
                style={{
                  background: '#f5f5f0',
                  cursor: 'not-allowed',
                  color: '#7a8699',
                }}
              />
              <small style={{ color: '#7a8699' }}>
                Locked. The code is referenced by users and item records and cannot be changed.
              </small>
            </div>
            <div className="form-group">
              <label htmlFor="editWarehouseLocation">
                Location <span className="required">*</span>
              </label>
              <input
                id="editWarehouseLocation"
                name="warehouse_location"
                type="text"
                value={editWarehouseData.warehouse_location}
                onChange={handleEditWarehouseChange}
              />
            </div>
            <div className="form-group">
              <label htmlFor="editWarehouseStatus">Status</label>
              <select
                id="editWarehouseStatus"
                name="status"
                value={editWarehouseData.status}
                onChange={handleEditWarehouseChange}
              >
                <option value="Active">Active</option>
                <option value="Deactivated">Deactivated</option>
              </select>
            </div>
          </div>
          <div className="form-footer">
            <button className="cancel-btn" onClick={handleCloseEditWarehouse}>
              <span className="btn-icon">✕</span>
              <span>Cancel</span>
            </button>
            <button className="save-btn" onClick={handleUpdateWarehouse} disabled={loading}>
              <span className="btn-icon">💾</span>
              <span>{loading ? 'Updating...' : 'Update Warehouse'}</span>
            </button>
          </div>
        </div>
      )}

      {/* ============================================
          WAREHOUSE TABLE
          ============================================ */}
      <div className="table-wrapper">
        <table className="data-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Warehouse Name</th>
              <th>Code</th>
              <th>Location</th>
              <th>Status</th>
              <th>Users</th>
              <th>Created At</th>
              <th>Created By</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {warehouses.length > 0 ? (
              warehouses.map(wh => (
                <tr key={wh.warehouse_id}>
                  <td>{wh.warehouse_id}</td>
                  <td><strong>{wh.warehouse_name}</strong></td>
                  <td><span className="warehouse-code">{wh.warehouse_code}</span></td>
                  <td>{wh.warehouse_location || 'N/A'}</td>
                  <td>
                    <span className={`status-badge ${wh.status.toLowerCase()}`}>
                      {wh.status}
                    </span>
                  </td>
                  <td>
                    <span className="public-id-badge">{wh.user_count ?? 0}</span>
                  </td>
                  <td>{wh.created_at ? new Date(wh.created_at).toLocaleString() : 'N/A'}</td>
                  <td>{wh.created_by || 'System'}</td>
                  <td>
                    <div className="action-buttons">
                      {can('warehouse.edit') && (
                        wh.status === 'Active' ? (
                          <button
                            className="action-btn deactivate-btn"
                            onClick={() => handleDeactivateWarehouse(wh.warehouse_id)}
                            title="Deactivate this warehouse"
                          >
                            <span className="btn-icon">🔒</span>
                            <span>Deactivate</span>
                          </button>
                        ) : (
                          <button
                            className="action-btn activate-btn"
                            onClick={() => handleActivateWarehouse(wh.warehouse_id)}
                            title="Activate this warehouse"
                          >
                            <span className="btn-icon">🔓</span>
                            <span>Activate</span>
                          </button>
                        )
                      )}
                      {can('warehouse.edit') && (
                        <button
                          className="action-btn edit"
                          onClick={() => handleEditWarehouse(wh)}
                          title="Edit this warehouse"
                        >
                          <span className="btn-icon">✏️</span>
                          <span>Edit</span>
                        </button>
                      )}
                      {can('warehouse.delete') && (
                        <button
                          className="action-btn delete-btn"
                          onClick={() => handleDeleteWarehouse(wh)}
                          title="Permanently delete this warehouse"
                        >
                          <span className="btn-icon">🗑️</span>
                          <span>Delete</span>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan="9" style={{ textAlign: 'center' }}>
                  No warehouses found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default TabWarehouse;