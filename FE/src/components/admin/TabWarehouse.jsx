// src/components/admin/TabWarehouse.jsx
import React from 'react';
import {
  FiPlus,
  FiX,
  FiSave,
  FiLock,
  FiUnlock,
  FiEdit2,
  FiTrash2,
  FiLoader,
} from 'react-icons/fi';
import { usePermissions } from '../../permissions/usePermissions';
import ActionsMenu from '../shared/ActionsMenu';
import { buttonCss } from '../shared/buttonStyles';

const TabWarehouse = ({ adminData }) => {
  const {
    warehouses,
    loading,
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
      <style>{buttonCss}</style>
      <style>{tabWarehouseIconCss}</style>

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
            <button className="ui-btn ui-btn-primary" onClick={handleAddWarehouse} type="button">
              <FiPlus className="btn-icon" />
              <span>Add Warehouse</span>
            </button>
          )}
        </div>
      </div>

      {can('warehouse.create') && showAddWarehouse && (
        <div className="add-warehouse-form">
          <div className="form-header">
            <h4>Add New Warehouse</h4>
            <button className="close-form-btn" onClick={handleCloseWarehouseForm}><FiX /></button>
          </div>
          <div className="form-body">
            <div className="form-group">
              <label htmlFor="warehouseName">
                Warehouse Name <span className="required">*</span>
              </label>
              <input id="warehouseName" name="warehouse_name" type="text" placeholder="Enter name" value={newWarehouse.warehouse_name} onChange={handleNewWarehouseChange} />
            </div>
            <div className="form-group">
              <label htmlFor="warehouseCode">
                Warehouse Code <span className="required">*</span>
              </label>
              <input id="warehouseCode" name="warehouse_code" type="text" placeholder="Unique code" value={newWarehouse.warehouse_code} onChange={handleNewWarehouseChange} />
              <small style={{ color: '#7a8699' }}>Must be unique. Once saved, the code cannot be changed.</small>
            </div>
            <div className="form-group">
              <label htmlFor="warehouseLocation">
                Location <span className="required">*</span>
              </label>
              <input id="warehouseLocation" name="warehouse_location" type="text" placeholder="Location" value={newWarehouse.warehouse_location} onChange={handleNewWarehouseChange} />
            </div>
            <div className="form-group">
              <label htmlFor="warehouseStatus">Status</label>
              <select id="warehouseStatus" name="status" value={newWarehouse.status} onChange={handleNewWarehouseChange}>
                <option value="Active">Active</option>
                <option value="Deactivated">Deactivated</option>
              </select>
            </div>
          </div>
          <div className="form-footer">
            <button className="ui-btn ui-btn-secondary" onClick={handleCloseWarehouseForm} type="button">
              <FiX className="btn-icon" />
              <span>Cancel</span>
            </button>
            <button className="ui-btn ui-btn-primary" onClick={handleSaveWarehouse} type="button">
              <FiSave className="btn-icon" />
              <span>Save Warehouse</span>
            </button>
          </div>
        </div>
      )}

      {can('warehouse.edit') && showEditWarehouse && (
        <div className="add-warehouse-form">
          <div className="form-header">
            <h4>Edit Warehouse</h4>
            <button className="close-form-btn" onClick={handleCloseEditWarehouse}><FiX /></button>
          </div>
          <div className="form-body">
            <div className="form-group">
              <label htmlFor="editWarehouseName">
                Warehouse Name <span className="required">*</span>
              </label>
              <input id="editWarehouseName" name="warehouse_name" type="text" value={editWarehouseData.warehouse_name} onChange={handleEditWarehouseChange} />
            </div>
            <div className="form-group">
              <label htmlFor="editWarehouseCode">
                Warehouse Code <span className="required">*</span>
              </label>
              <input id="editWarehouseCode" name="warehouse_code" type="text" value={editWarehouseData.warehouse_code} disabled readOnly style={{ background: '#f5f5f0', cursor: 'not-allowed', color: '#7a8699' }} />
              <small style={{ color: '#7a8699' }}>Locked. The code is referenced by users and item records and cannot be changed.</small>
            </div>
            <div className="form-group">
              <label htmlFor="editWarehouseLocation">
                Location <span className="required">*</span>
              </label>
              <input id="editWarehouseLocation" name="warehouse_location" type="text" value={editWarehouseData.warehouse_location} onChange={handleEditWarehouseChange} />
            </div>
            <div className="form-group">
              <label htmlFor="editWarehouseStatus">Status</label>
              <select id="editWarehouseStatus" name="status" value={editWarehouseData.status} onChange={handleEditWarehouseChange}>
                <option value="Active">Active</option>
                <option value="Deactivated">Deactivated</option>
              </select>
            </div>
          </div>
          <div className="form-footer">
            <button className="ui-btn ui-btn-secondary" onClick={handleCloseEditWarehouse} type="button">
              <FiX className="btn-icon" />
              <span>Cancel</span>
            </button>
            <button className="ui-btn ui-btn-primary" onClick={handleUpdateWarehouse} disabled={loading} type="button">
              {loading ? <FiLoader className="btn-icon icon-spin" /> : <FiSave className="btn-icon" />}
              <span>{loading ? 'Updating...' : 'Update Warehouse'}</span>
            </button>
          </div>
        </div>
      )}

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
              warehouses.map(wh => {
                const isActive = wh.status === 'Active';

                const menuItems = [
                  can('warehouse.edit') && {
                    key: 'toggle',
                    label: isActive ? 'Deactivate' : 'Activate',
                    icon: isActive ? <FiLock /> : <FiUnlock />,
                    onClick: () =>
                      isActive
                        ? handleDeactivateWarehouse(wh.warehouse_id)
                        : handleActivateWarehouse(wh.warehouse_id),
                    variant: isActive ? 'muted' : 'success',
                  },
                  can('warehouse.edit') && {
                    key: 'edit',
                    label: 'Edit',
                    icon: <FiEdit2 />,
                    onClick: () => handleEditWarehouse(wh),
                  },
                  can('warehouse.delete') && {
                    key: 'delete',
                    label: 'Delete',
                    icon: <FiTrash2 />,
                    onClick: () => handleDeleteWarehouse(wh),
                    variant: 'danger',
                    dividerBefore: true,
                  },
                ].filter(Boolean);

                return (
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
                      {menuItems.length > 0 && (
                        <div className="action-buttons action-buttons--kebab">
                          <ActionsMenu
                            items={menuItems}
                            ariaLabel={`Actions for warehouse ${wh.warehouse_code}`}
                          />
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })
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

// ============================================================
// Icon styles + kebab-aware action cell
// ============================================================
const tabWarehouseIconCss = `
.btn-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 1em;
  height: 1em;
  line-height: 1;
}
.btn-icon svg { width: 100%; height: 100%; stroke-width: 2.4; }

.close-form-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #475569;
}
.close-form-btn svg { width: 1em; height: 1em; stroke-width: 2.4; }

.icon-spin { animation: tabWhSpin 0.9s linear infinite; }
@keyframes tabWhSpin { to { transform: rotate(360deg); } }

/* Right-align the kebab inside the actions cell */
.action-buttons--kebab {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 6px;
}

@media (prefers-reduced-motion: reduce) {
  .icon-spin { animation: none !important; }
}
`;