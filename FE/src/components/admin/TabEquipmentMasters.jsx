// src/components/admin/TabEquipmentMasters.jsx
import React, { useEffect, useState } from 'react';
import {
  FiPlus, FiSearch, FiEdit2, FiTrash2, FiRefreshCw,
  FiImage, FiX, FiCheck, FiLock, FiUnlock,
  FiChevronLeft, FiChevronRight, FiChevronsLeft, FiChevronsRight,
} from 'react-icons/fi';
import { FaCar } from 'react-icons/fa';
import ItemImageThumb from '../shared/ItemImageThumb';
import { usePermissions } from '../../permissions/usePermissions';

const TabEquipmentMasters = ({ adminData }) => {
  const { can } = usePermissions();
  const canCreate = can('equipmentmasters.create');
  const canEdit = can('equipmentmasters.edit');
  const canDelete = can('equipmentmasters.delete');

  const {
    equipmentMasterRecords,
    equipmentMasterLoading,
    equipmentMasterCurrentPage,
    setEquipmentMasterCurrentPage,
    equipmentMasterTotalPages,
    equipmentMasterTotalCount,
    equipmentMasterSearchTerm,
    setEquipmentMasterSearchTerm,
    
    showCreateEquipmentForm,
    handleToggleCreateEquipmentForm,
    newEquipment,
    handleNewEquipmentChange,
    generateEquipmentBarcode,
    handleSaveEquipment,
    newEquipmentImagePreview,
    handleNewEquipmentImageChange,
    handleRemoveNewEquipmentImage,
    equipmentBarcodeCanvasRef,
    equipmentBarcodeImageRef,

    showEditEquipmentModal,
    editEquipmentData,
    handleEditEquipmentChange,
    handleUpdateEquipment,
    handleCloseEditEquipmentModal,
    editEquipmentImagePreview,
    handleEditEquipmentImageChange,
    handleRemoveEditEquipmentImage,

    handleToggleEquipmentStatus,
    handleDeleteEquipment,
    fetchEquipmentMasters
  } = adminData;

  // Local state for the search input to prevent uncommitted searches
  const [localSearch, setLocalSearch] = useState(equipmentMasterSearchTerm || '');

  // Sync local search if the global state is cleared or changed externally
  useEffect(() => {
    setLocalSearch(equipmentMasterSearchTerm || '');
  }, [equipmentMasterSearchTerm]);

  // Trigger fetch on page change. 
  // We omit fetchEquipmentMasters from dependencies to prevent infinite loops.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    fetchEquipmentMasters(equipmentMasterCurrentPage);
  }, [equipmentMasterCurrentPage]);

  // Handle search submit (Enter key or Search button)
  const handleSearchSubmit = (e) => {
    e.preventDefault();
    setEquipmentMasterSearchTerm(localSearch);
    setEquipmentMasterCurrentPage(1);
    fetchEquipmentMasters(1, localSearch);
  };

  const clearSearch = () => {
    setLocalSearch('');
    setEquipmentMasterSearchTerm('');
    setEquipmentMasterCurrentPage(1);
    fetchEquipmentMasters(1, '');
  };

  const formatDate = (dateString) => {
    if (!dateString) return '—';
    try {
      return new Date(dateString).toLocaleDateString();
    } catch {
      return dateString;
    }
  };

  // Pagination Math
  const showingStart = equipmentMasterTotalCount === 0 ? 0 : (equipmentMasterCurrentPage - 1) * 50 + 1;
  const showingEnd = Math.min(equipmentMasterCurrentPage * 50, equipmentMasterTotalCount);

  return (
    <div className="tem-root">
      <style>{css}</style>

      {/* ---------- Header ---------- */}
      <header className="tem-header">
        <div className="tem-header-left">
          <div className="tem-header-icon"><FaCar /></div>
          <div className="tem-header-info">
            <h2 className="tem-header-title">Equipment Master</h2>
            <div className="tem-header-sub">
              {canCreate ? 'Manage equipment codes, numeric values, and barcodes.' : 'View equipment records.'}
            </div>
          </div>
        </div>
        {canCreate && (
          <div className="tem-header-actions">
            <button
              type="button"
              className={`tem-btn tem-btn--primary ${showCreateEquipmentForm ? 'is-active' : ''}`}
              onClick={handleToggleCreateEquipmentForm}
            >
              {showCreateEquipmentForm ? <FiX /> : <FiPlus />}
              <span>{showCreateEquipmentForm ? 'Cancel' : 'Add Equipment'}</span>
            </button>
          </div>
        )}
      </header>

      {/* ---------- Create Form ---------- */}
      {canCreate && showCreateEquipmentForm && (
        <section className="tem-form-section">
          <h3 className="tem-form-title">New Equipment</h3>
          <div className="tem-form-grid">
            <div className="tem-form-group">
              <label>Value <span className="tem-req">*</span></label>
              <input
                type="number"
                step="1"
                min="1"
                name="Value"
                value={newEquipment.Value}
                onChange={handleNewEquipmentChange}
                placeholder="e.g. 105"
                className="tem-input"
              />
              <span className="tem-hint">Must be a unique integer.</span>
            </div>

            <div className="tem-form-group">
              <label>Description <span className="tem-req">*</span></label>
              <input
                type="text"
                name="Description"
                value={newEquipment.Description}
                onChange={handleNewEquipmentChange}
                placeholder="Equipment name / model"
                className="tem-input"
                maxLength={400}
              />
            </div>

            <div className="tem-form-group">
              <label>Creation Date</label>
              <input
                type="date"
                name="Creation_Date"
                value={newEquipment.Creation_Date}
                onChange={handleNewEquipmentChange}
                className="tem-input"
              />
            </div>

            <div className="tem-form-group">
              <label>Status</label>
              <select
                name="Status"
                value={newEquipment.Status}
                onChange={handleNewEquipmentChange}
                className="tem-input"
              >
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
              </select>
            </div>

            <div className="tem-form-group tem-form-group--full">
              <label>Equipment Image (Max 5MB)</label>
              <div className="tem-image-upload">
                {newEquipmentImagePreview ? (
                  <div className="tem-image-preview-wrap">
                    <img src={newEquipmentImagePreview} alt="Preview" className="tem-image-preview" />
                    <button type="button" className="tem-btn-icon tem-btn-icon--danger" onClick={handleRemoveNewEquipmentImage}>
                      <FiTrash2 />
                    </button>
                  </div>
                ) : (
                  <label className="tem-image-dropzone">
                    <FiImage />
                    <span>Click to upload image</span>
                    <input
                      id="adminEquipmentImageInput"
                      type="file"
                      accept="image/*"
                      onChange={handleNewEquipmentImageChange}
                      hidden
                    />
                  </label>
                )}
              </div>
            </div>

            <div className="tem-form-group tem-form-group--full">
              <label>Barcode</label>
              <div className="tem-barcode-wrap">
                <button
                  type="button"
                  className="tem-btn tem-btn--secondary"
                  onClick={generateEquipmentBarcode}
                  disabled={!newEquipment.Value}
                >
                  Generate Barcode
                </button>
                <div className="tem-barcode-preview">
                  {newEquipment.Barcode ? (
                    <>
                      <span className="tem-barcode-text">{newEquipment.Barcode}</span>
                      <canvas ref={equipmentBarcodeCanvasRef} style={{ display: 'none' }} />
                      <img ref={equipmentBarcodeImageRef} alt="Barcode" className="tem-barcode-img" />
                    </>
                  ) : (
                    <span className="tem-hint">Barcode will appear here (EQ-{newEquipment.Value || '...'})</span>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="tem-form-actions">
            <button type="button" className="tem-btn tem-btn--secondary" onClick={handleToggleCreateEquipmentForm}>
              Cancel
            </button>
            <button 
              type="button" 
              className="tem-btn tem-btn--primary" 
              onClick={handleSaveEquipment}
              disabled={!newEquipment.Value || !newEquipment.Description || !newEquipment.Barcode}
            >
              <FiCheck /> Save Equipment
            </button>
          </div>
        </section>
      )}

      {/* ---------- Toolbar ---------- */}
      <div className="tem-toolbar">
        <form onSubmit={handleSearchSubmit} className="tem-search-form">
          <div className="tem-search-wrap">
            <FiSearch className="tem-search-icon" />
            <input
              type="text"
              value={localSearch}
              onChange={(e) => setLocalSearch(e.target.value)}
              placeholder="Search by code, value, or description..."
              className="tem-search-input"
            />
            {localSearch && (
              <button type="button" className="tem-search-clear" onClick={clearSearch}>
                <FiX />
              </button>
            )}
          </div>
          <button type="submit" className="tem-btn tem-btn--primary tem-search-btn">
            <FiSearch /> <span>Search</span>
          </button>
        </form>
        <button
          type="button"
          className="tem-btn tem-btn--secondary"
          onClick={() => fetchEquipmentMasters(equipmentMasterCurrentPage, equipmentMasterSearchTerm)}
          disabled={equipmentMasterLoading}
          title="Refresh List"
        >
          <FiRefreshCw className={equipmentMasterLoading ? 'tem-spin' : ''} />
        </button>
      </div>

      {/* ---------- Table / Cards ---------- */}
      {equipmentMasterLoading && equipmentMasterRecords.length === 0 ? (
        <div className="tem-state">
          <FiRefreshCw className="tem-spin" /> Loading equipment records...
        </div>
      ) : equipmentMasterRecords.length === 0 ? (
        <div className="tem-state tem-state--empty">
          <FaCar />
          <div className="tem-state-title">No equipment found</div>
          <div className="tem-state-sub">
            {equipmentMasterSearchTerm ? 'Try a different search term.' : 'Click "Add Equipment" to create your first record.'}
          </div>
        </div>
      ) : (
        <>
          {/* Desktop Table */}
          <div className="tem-table-wrap">
            <table className="tem-table">
              <thead>
                <tr>
                  <th>Image</th>
                  <th>Code</th>
                  <th>Value</th>
                  <th>Description</th>
                  <th>Status</th>
                  <th>Created</th>
                  {(canEdit || canDelete) && <th>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {equipmentMasterRecords.map((item) => {
                  const isActive = item.Status === 'Active';
                  return (
                    <tr key={item.Equipment_Code}>
                      <td>
                        <ItemImageThumb src={item.Equipment_Image} alt={item.Equipment_Code} size={40} />
                      </td>
                      <td>
                        <span className="tem-code">{item.Equipment_Code}</span>
                      </td>
                      <td>
                        <span className="tem-value">{item.Value}</span>
                      </td>
                      <td>
                        <div className="tem-desc" title={item.Description}>
                          {item.Description}
                        </div>
                      </td>
                      <td>
                        <span className={`tem-badge ${isActive ? 'tem-badge--active' : 'tem-badge--inactive'}`}>
                          {item.Status}
                        </span>
                      </td>
                      <td>{formatDate(item.Creation_Date)}</td>
                      {(canEdit || canDelete) && (
                        <td>
                          <div className="tem-actions">
                            {canEdit && (
                              <button
                                type="button"
                                className="tem-btn-icon"
                                onClick={() => adminData.handleEditEquipment(item)}
                                title="Edit"
                              >
                                <FiEdit2 />
                              </button>
                            )}
                            {canEdit && (
                              <button
                                type="button"
                                className={`tem-btn-icon ${isActive ? 'tem-btn-icon--warning' : 'tem-btn-icon--success'}`}
                                onClick={() => handleToggleEquipmentStatus(item)}
                                title={isActive ? 'Deactivate' : 'Activate'}
                              >
                                {isActive ? <FiLock /> : <FiUnlock />}
                              </button>
                            )}
                            {canDelete && (
                              <button
                                type="button"
                                className="tem-btn-icon tem-btn-icon--danger"
                                onClick={() => handleDeleteEquipment(item)}
                                title="Delete"
                              >
                                <FiTrash2 />
                              </button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile Cards */}
          <div className="tem-cardlist">
            {equipmentMasterRecords.map((item) => {
              const isActive = item.Status === 'Active';
              return (
                <div key={`card-${item.Equipment_Code}`} className="tem-card">
                  <div className="tem-card-header">
                    <div className="tem-card-thumb">
                      <ItemImageThumb src={item.Equipment_Image} alt={item.Equipment_Code} size={44} />
                    </div>
                    <div className="tem-card-title-wrap">
                      <div className="tem-code">{item.Equipment_Code}</div>
                      <div className="tem-card-subtitle">Value: {item.Value}</div>
                    </div>
                    <span className={`tem-badge ${isActive ? 'tem-badge--active' : 'tem-badge--inactive'}`}>
                      {item.Status}
                    </span>
                  </div>
                  <div className="tem-card-body">
                    <p className="tem-card-desc">{item.Description}</p>
                    <div className="tem-card-meta">
                      <span>Created: {formatDate(item.Creation_Date)}</span>
                    </div>
                  </div>
                  {(canEdit || canDelete) && (
                    <div className="tem-card-actions">
                      {canEdit && (
                        <button type="button" className="tem-btn tem-btn--sm tem-btn--secondary" onClick={() => adminData.handleEditEquipment(item)}>
                          <FiEdit2 /> Edit
                        </button>
                      )}
                      {canEdit && (
                        <button
                          type="button"
                          className={`tem-btn tem-btn--sm ${isActive ? 'tem-btn--warning' : 'tem-btn--success'}`}
                          onClick={() => handleToggleEquipmentStatus(item)}
                        >
                          {isActive ? <><FiLock /> Deactivate</> : <><FiUnlock /> Activate</>}
                        </button>
                      )}
                      {canDelete && (
                        <button type="button" className="tem-btn tem-btn--sm tem-btn--danger" onClick={() => handleDeleteEquipment(item)}>
                          <FiTrash2 />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Pagination */}
          {equipmentMasterTotalPages > 1 && (
            <nav className="tem-pagination">
              <div className="tem-pagination-info">
                Showing <strong>{showingStart}</strong>–<strong>{showingEnd}</strong> of{' '}
                <strong>{equipmentMasterTotalCount}</strong>
              </div>
              <div className="tem-pagination-controls">
                <button
                  type="button"
                  className="tem-page-btn"
                  onClick={() => setEquipmentMasterCurrentPage(1)}
                  disabled={equipmentMasterCurrentPage <= 1}
                >
                  <FiChevronsLeft />
                </button>
                <button
                  type="button"
                  className="tem-page-btn"
                  onClick={() => setEquipmentMasterCurrentPage(prev => Math.max(1, prev - 1))}
                  disabled={equipmentMasterCurrentPage <= 1}
                >
                  <FiChevronLeft />
                </button>
                <span className="tem-page-indicator">
                  {equipmentMasterCurrentPage} / {equipmentMasterTotalPages}
                </span>
                <button
                  type="button"
                  className="tem-page-btn"
                  onClick={() => setEquipmentMasterCurrentPage(prev => Math.min(equipmentMasterTotalPages, prev + 1))}
                  disabled={equipmentMasterCurrentPage >= equipmentMasterTotalPages}
                >
                  <FiChevronRight />
                </button>
                <button
                  type="button"
                  className="tem-page-btn"
                  onClick={() => setEquipmentMasterCurrentPage(equipmentMasterTotalPages)}
                  disabled={equipmentMasterCurrentPage >= equipmentMasterTotalPages}
                >
                  <FiChevronsRight />
                </button>
              </div>
            </nav>
          )}
        </>
      )}

      {/* ---------- Edit Modal ---------- */}
      {showEditEquipmentModal && (
        <div className="tem-modal-overlay" onClick={handleCloseEditEquipmentModal}>
          <div className="tem-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="tem-modal-header">
              <h3 className="tem-modal-title">Edit Equipment</h3>
              <button type="button" className="tem-btn-icon" onClick={handleCloseEditEquipmentModal}>
                <FiX />
              </button>
            </div>
            
            <div className="tem-modal-body">
              <div className="tem-form-grid">
                <div className="tem-form-group">
                  <label>Code</label>
                  <input
                    type="text"
                    value={editEquipmentData.Equipment_Code}
                    disabled
                    className="tem-input tem-input--disabled"
                  />
                </div>
                <div className="tem-form-group">
                  <label>Value</label>
                  <input
                    type="number"
                    value={editEquipmentData.Value}
                    disabled
                    className="tem-input tem-input--disabled"
                  />
                </div>
                <div className="tem-form-group tem-form-group--full">
                  <label>Description <span className="tem-req">*</span></label>
                  <input
                    type="text"
                    name="Description"
                    value={editEquipmentData.Description}
                    onChange={handleEditEquipmentChange}
                    className="tem-input"
                    maxLength={400}
                  />
                </div>
                <div className="tem-form-group">
                  <label>Status</label>
                  <select
                    name="Status"
                    value={editEquipmentData.Status}
                    onChange={handleEditEquipmentChange}
                    className="tem-input"
                  >
                    <option value="Active">Active</option>
                    <option value="Inactive">Inactive</option>
                  </select>
                </div>
                <div className="tem-form-group">
                  <label>Creation Date</label>
                  <input
                    type="date"
                    name="Creation_Date"
                    value={editEquipmentData.Creation_Date}
                    onChange={handleEditEquipmentChange}
                    className="tem-input"
                  />
                </div>

                <div className="tem-form-group tem-form-group--full">
                  <label>Update Image</label>
                  <div className="tem-image-upload">
                    {editEquipmentImagePreview ? (
                      <div className="tem-image-preview-wrap">
                        <img src={editEquipmentImagePreview} alt="Preview" className="tem-image-preview" />
                        <button type="button" className="tem-btn-icon tem-btn-icon--danger" onClick={handleRemoveEditEquipmentImage}>
                          <FiTrash2 />
                        </button>
                      </div>
                    ) : (
                      <label className="tem-image-dropzone">
                        <FiImage />
                        <span>Click to upload new image</span>
                        <input
                          id="editEquipmentImageInput"
                          type="file"
                          accept="image/*"
                          onChange={handleEditEquipmentImageChange}
                          hidden
                        />
                      </label>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="tem-modal-footer">
              <button type="button" className="tem-btn tem-btn--secondary" onClick={handleCloseEditEquipmentModal}>
                Cancel
              </button>
              <button 
                type="button" 
                className="tem-btn tem-btn--primary" 
                onClick={handleUpdateEquipment}
                disabled={!editEquipmentData.Description}
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default TabEquipmentMasters;

/* ============================================================ */
const css = `
.tem-root {
  display: flex; flex-direction: column; gap: 20px;
  padding: clamp(16px, 2vw, 24px);
  width: 100%; box-sizing: border-box;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}

/* ---------- Header ---------- */
.tem-header {
  display: flex; justify-content: space-between; align-items: flex-start;
  gap: 16px; flex-wrap: wrap;
}
.tem-header-left { display: flex; align-items: center; gap: 12px; min-width: 0; }
.tem-header-icon {
  width: 44px; height: 44px; border-radius: 10px;
  background: linear-gradient(135deg, #6366f1 0%, #4338ca 100%);
  color: #fff; display: flex; align-items: center; justify-content: center;
  box-shadow: 0 4px 12px rgba(99, 102, 241, 0.3);
  flex-shrink: 0;
}
.tem-header-icon svg { width: 22px; height: 22px; }
.tem-header-title { margin: 0; font-size: clamp(18px, 2vw, 22px); font-weight: 800; color: #0f172a; }
.tem-header-sub { margin: 2px 0 0; font-size: 13px; color: #64748b; }
.tem-header-actions { display: flex; gap: 8px; flex-wrap: wrap; }

/* ---------- Buttons ---------- */
.tem-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  min-height: 40px; padding: 8px 16px; border-radius: 8px;
  font: inherit; font-size: 14px; font-weight: 700;
  cursor: pointer; border: 1px solid transparent;
  transition: all 0.15s ease; white-space: nowrap;
}
.tem-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.tem-btn svg { width: 16px; height: 16px; }
.tem-btn--primary { background: #4f46e5; color: #fff; }
.tem-btn--primary:hover:not(:disabled) { background: #4338ca; }
.tem-btn--secondary { background: #ffffff; color: #334155; border-color: #cbd5e1; }
.tem-btn--secondary:hover:not(:disabled) { background: #f8fafc; border-color: #94a3b8; }
.tem-btn--warning { background: #f59e0b; color: #fff; }
.tem-btn--warning:hover:not(:disabled) { background: #d97706; }
.tem-btn--danger { background: #ef4444; color: #fff; }
.tem-btn--danger:hover:not(:disabled) { background: #dc2626; }
.tem-btn--success { background: #10b981; color: #fff; }
.tem-btn--success:hover:not(:disabled) { background: #059669; }
.tem-btn--sm { min-height: 32px; padding: 4px 10px; font-size: 12.5px; }
.tem-btn-icon {
  width: 32px; height: 32px; border-radius: 6px; border: none;
  background: transparent; color: #64748b; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
  transition: background 0.15s ease, color 0.15s ease;
}
.tem-btn-icon:hover { background: #f1f5f9; color: #0f172a; }
.tem-btn-icon--danger:hover { background: #fee2e2; color: #dc2626; }
.tem-btn-icon--warning:hover { background: #fef3c7; color: #d97706; }
.tem-btn-icon--success:hover { background: #dcfce7; color: #16a34a; }

/* ---------- Create Form ---------- */
.tem-form-section {
  background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px;
  padding: clamp(16px, 2vw, 24px);
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.04);
  animation: temFadeIn 0.2s ease-out;
}
@keyframes temFadeIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
.tem-form-title { margin: 0 0 16px; font-size: 16px; font-weight: 800; color: #0f172a; }
.tem-form-grid {
  display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px;
}
.tem-form-group { display: flex; flex-direction: column; gap: 6px; }
.tem-form-group--full { grid-column: 1 / -1; }
.tem-form-group label { font-size: 13px; font-weight: 700; color: #334155; }
.tem-req { color: #ef4444; }
.tem-input {
  width: 100%; min-height: 40px; padding: 8px 12px;
  border: 1.5px solid #cbd5e1; border-radius: 8px;
  font: inherit; font-size: 14px; color: #0f172a;
  background: #ffffff; outline: none; box-sizing: border-box;
  transition: border-color 0.15s ease;
}
.tem-input:focus { border-color: #6366f1; box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.15); }
.tem-input--disabled { background: #f1f5f9; color: #94a3b8; cursor: not-allowed; }
.tem-hint { font-size: 11.5px; color: #64748b; }

/* Image Upload */
.tem-image-upload { width: 100%; }
.tem-image-dropzone {
  display: flex; align-items: center; justify-content: center; gap: 8px;
  min-height: 80px; border: 2px dashed #cbd5e1; border-radius: 8px;
  background: #f8fafc; color: #64748b; cursor: pointer;
  font-size: 13px; font-weight: 600;
  transition: all 0.15s ease;
}
.tem-image-dropzone:hover { border-color: #6366f1; background: #eef2ff; color: #4338ca; }
.tem-image-preview-wrap { position: relative; display: inline-block; }
.tem-image-preview { max-width: 120px; max-height: 120px; border-radius: 8px; border: 1px solid #e2e8f0; object-fit: contain; }
.tem-image-preview-wrap .tem-btn-icon {
  position: absolute; top: -8px; right: -8px;
  background: #ffffff; border: 1px solid #fecaca;
  border-radius: 50%; width: 24px; height: 24px;
}

/* Barcode */
.tem-barcode-wrap {
  display: flex; align-items: center; gap: 16px; flex-wrap: wrap;
  background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px;
}
.tem-barcode-preview {
  display: flex; flex-direction: column; align-items: flex-start; gap: 4px; flex: 1; min-width: 200px;
}
.tem-barcode-text { font-family: 'JetBrains Mono', monospace; font-size: 13px; font-weight: 800; color: #0f172a; }
.tem-barcode-img { max-height: 40px; }

.tem-form-actions {
  display: flex; justify-content: flex-end; gap: 12px;
  margin-top: 24px; padding-top: 16px; border-top: 1px solid #e2e8f0;
}

/* ---------- Toolbar ---------- */
.tem-toolbar {
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
}
.tem-search-form {
  display: flex; align-items: stretch; gap: 8px; flex: 1; min-width: 280px; max-width: 600px;
}
.tem-search-wrap {
  position: relative; flex: 1; display: flex; align-items: center;
}
.tem-search-icon {
  position: absolute; left: 12px; top: 50%; transform: translateY(-50%);
  color: #94a3b8; width: 16px; height: 16px; pointer-events: none;
}
.tem-search-input {
  width: 100%; min-height: 40px; padding: 8px 36px 8px 36px;
  border: 1.5px solid #cbd5e1; border-radius: 8px;
  font: inherit; font-size: 14px; outline: none; background: #ffffff;
  box-sizing: border-box;
}
.tem-search-input:focus { border-color: #6366f1; }
.tem-search-clear {
  position: absolute; right: 8px; top: 50%; transform: translateY(-50%);
  border: none; background: transparent; color: #64748b; cursor: pointer;
  padding: 4px; display: inline-flex; align-items: center;
}
.tem-search-btn {
  flex-shrink: 0; min-height: 40px; padding: 0 16px;
}

/* ---------- Table ---------- */
.tem-table-wrap {
  background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px;
  overflow-x: auto; box-shadow: 0 1px 3px rgba(15, 23, 42, 0.04);
}
.tem-table { width: 100%; border-collapse: collapse; font-size: 13.5px; min-width: 800px; }
.tem-table th {
  text-align: left; padding: 12px 16px; background: #f8fafc;
  font-size: 11px; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase;
  color: #64748b; border-bottom: 1px solid #e2e8f0; white-space: nowrap;
}
.tem-table td { padding: 12px 16px; border-bottom: 1px solid #f1f5f9; vertical-align: middle; }
.tem-table tr:last-child td { border-bottom: none; }
.tem-table tr:hover { background: #f8fafc; }
.tem-code { font-family: 'JetBrains Mono', monospace; font-weight: 800; color: #4338ca; }
.tem-value { font-weight: 600; color: #0f172a; }
.tem-desc { max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #334155; }
.tem-actions { display: flex; gap: 4px; }

/* Badges */
.tem-badge {
  display: inline-flex; padding: 2px 8px; border-radius: 6px;
  font-size: 11.5px; font-weight: 800; letter-spacing: 0.02em; text-transform: uppercase;
}
.tem-badge--active { background: #dcfce7; color: #166534; border: 1px solid #bbf7d0; }
.tem-badge--inactive { background: #f1f5f9; color: #64748b; border: 1px solid #e2e8f0; }

/* ---------- Mobile Cards ---------- */
.tem-cardlist { display: none; flex-direction: column; gap: 12px; }
.tem-card {
  background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px;
  padding: 14px; display: flex; flex-direction: column; gap: 12px;
}
.tem-card-header { display: flex; align-items: center; gap: 12px; }
.tem-card-thumb { flex-shrink: 0; }
.tem-card-title-wrap { flex: 1; min-width: 0; }
.tem-card-subtitle { font-size: 12px; color: #64748b; margin-top: 2px; }
.tem-card-body { display: flex; flex-direction: column; gap: 6px; }
.tem-card-desc { margin: 0; font-size: 13px; color: #334155; line-height: 1.4; }
.tem-card-meta { font-size: 11.5px; color: #64748b; }
.tem-card-actions { display: flex; gap: 8px; padding-top: 12px; border-top: 1px dashed #e2e8f0; }
.tem-card-actions .tem-btn { flex: 1; }

/* ---------- States ---------- */
.tem-state {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 10px; padding: 48px 20px; text-align: center;
  background: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 12px;
  color: #64748b;
}
.tem-state svg { width: 32px; height: 32px; color: #94a3b8; }
.tem-state-title { font-size: 16px; font-weight: 800; color: #334155; }
.tem-state-sub { font-size: 13.5px; line-height: 1.5; max-width: 40ch; }
.tem-spin { animation: temSpin 1s linear infinite; }
@keyframes temSpin { 100% { transform: rotate(360deg); } }

/* ---------- Pagination ---------- */
.tem-pagination {
  display: flex; align-items: center; justify-content: space-between;
  gap: 16px; flex-wrap: wrap; padding: 12px 16px;
  background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px;
}
.tem-pagination-info { font-size: 13px; color: #475569; }
.tem-pagination-info strong { color: #0f172a; }
.tem-pagination-controls { display: flex; align-items: center; gap: 6px; }
.tem-page-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 32px; height: 32px; border: 1px solid #cbd5e1; border-radius: 6px;
  background: #ffffff; color: #334155; cursor: pointer;
}
.tem-page-btn:hover:not(:disabled) { background: #eef2ff; border-color: #6366f1; color: #4338ca; }
.tem-page-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.tem-page-indicator { font-size: 13px; font-weight: 700; color: #334155; margin: 0 8px; }

/* ---------- Edit Modal ---------- */
.tem-modal-overlay {
  position: fixed; inset: 0; background: rgba(15, 23, 42, 0.6);
  backdrop-filter: blur(4px); z-index: 9999;
  display: flex; align-items: center; justify-content: center; padding: 16px;
}
.tem-modal-card {
  background: #ffffff; border-radius: 16px; width: 100%; max-width: 560px;
  max-height: 90vh; display: flex; flex-direction: column;
  box-shadow: 0 20px 40px rgba(0,0,0,0.2); overflow: hidden;
  animation: temModalIn 0.2s cubic-bezier(0.34, 1.3, 0.64, 1);
}
@keyframes temModalIn { from { opacity: 0; transform: scale(0.96); } to { opacity: 1; transform: scale(1); } }
.tem-modal-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 16px 20px; border-bottom: 1px solid #e2e8f0;
}
.tem-modal-title { margin: 0; font-size: 18px; font-weight: 800; color: #0f172a; }
.tem-modal-body { padding: 20px; overflow-y: auto; flex: 1; }
.tem-modal-footer {
  display: flex; justify-content: flex-end; gap: 12px;
  padding: 16px 20px; border-top: 1px solid #e2e8f0; background: #f8fafc;
}

/* ============================================================ */
/* Responsive Breakpoints                                       */
/* ============================================================ */

@media (max-width: 900px) {
  .tem-table-wrap { display: none; }
  .tem-cardlist { display: flex; }
  .tem-form-grid { grid-template-columns: 1fr; }
}

@media (max-width: 640px) {
  .tem-header { flex-direction: column; align-items: stretch; }
  .tem-header-actions { width: 100%; }
  .tem-header-actions .tem-btn { width: 100%; }
  
  .tem-toolbar { flex-direction: column; align-items: stretch; gap: 10px; }
  .tem-search-form { max-width: 100%; flex-direction: column; }
  .tem-search-btn { width: 100%; }
  
  .tem-pagination { flex-direction: column; align-items: center; gap: 12px; }
  .tem-pagination-info { text-align: center; }
  
  .tem-form-actions { flex-direction: column-reverse; }
  .tem-form-actions .tem-btn { width: 100%; }
  
  .tem-modal-card { max-height: 100vh; border-radius: 0; height: 100%; width: 100%; max-width: 100vw; }
  .tem-modal-overlay { padding: 0; }
  .tem-modal-footer { flex-direction: column-reverse; }
  .tem-modal-footer .tem-btn { width: 100%; }
}

@media (min-width: 1921px) {
  .tem-root { padding: 32px 40px; gap: 28px; }
  .tem-table { font-size: 15px; }
  .tem-table th, .tem-table td { padding: 16px 20px; }
  .tem-input { font-size: 15px; min-height: 46px; }
  .tem-btn { min-height: 46px; font-size: 15px; }
  .tem-card { padding: 20px; }
  .tem-page-btn { width: 40px; height: 40px; }
}

@media (prefers-reduced-motion: reduce) {
  .tem-spin { animation: none !important; }
  .tem-form-section, .tem-modal-card { animation: none !important; }
  .tem-btn, .tem-btn-icon { transition: none !important; }
}
`;