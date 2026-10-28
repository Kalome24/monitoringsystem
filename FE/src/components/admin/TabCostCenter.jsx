// src/components/admin/TabCostCenter.jsx
import React, { useEffect, useState, useMemo } from 'react';
import {
  FiFileText, FiPlus, FiX, FiSearch, FiRefreshCw, FiEdit2,
  FiLock, FiUnlock, FiTrash2, FiInbox, FiChevronsLeft,
  FiChevronLeft, FiChevronRight, FiChevronsRight
} from 'react-icons/fi';
import { usePermissions } from '../../permissions/usePermissions';
import ActionsMenu from '../shared/ActionsMenu';
import { buttonCss } from '../shared/buttonStyles';
import { useRefreshOnFocus } from '../../hooks/useRefreshOnFocus';

const TabCostCenter = ({ adminData }) => {
  const {
    costCenterRecords, costCenterLoading, costCenterCurrentPage, setCostCenterCurrentPage,
    costCenterTotalPages, costCenterTotalCount, costCenterSearchTerm, setCostCenterSearchTerm,
    showCreateCostCenterForm, setShowCreateCostCenterForm, newCostCenter, setNewCostCenter,
    showEditCostCenterModal, setShowEditCostCenterModal, editCostCenterData, setEditCostCenterData,
    fetchCostCenters, handleSaveCostCenter, handleEditCostCenter, handleUpdateCostCenter,
    handleToggleCostCenterStatus, handleDeleteCostCenter, loading,
  } = adminData;

  const { can } = usePermissions();
  const [localSearch, setLocalSearch] = useState(costCenterSearchTerm || '');

  useEffect(() => {
    fetchCostCenters(costCenterCurrentPage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [costCenterCurrentPage, costCenterSearchTerm]);

  useRefreshOnFocus(() => fetchCostCenters(costCenterCurrentPage));

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    setCostCenterSearchTerm(localSearch.trim());
    setCostCenterCurrentPage(1);
  };

  const handleClearSearch = () => {
    setLocalSearch('');
    setCostCenterSearchTerm('');
    setCostCenterCurrentPage(1);
  };

  const handleCreateChange = (e) => {
    const { name, value } = e.target;
    setNewCostCenter(prev => ({ ...prev, [name]: value }));
  };
  
  const handleEditChange = (e) => {
    const { name, value } = e.target;
    setEditCostCenterData(prev => ({ ...prev, [name]: value }));
  };

  // --- Advanced Pagination Logic ---
  const goToPage = (target) => {
    const next = Math.max(1, Math.min(costCenterTotalPages, target));
    if (next !== costCenterCurrentPage) setCostCenterCurrentPage(next);
  };

  const buildPageList = (current, total) => {
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
    const pages = [1];
    if (current > 3) pages.push('…');
    const start = Math.max(2, current - 1);
    const end = Math.min(total - 1, current + 1);
    for (let i = start; i <= end; i++) pages.push(i);
    if (current < total - 2) pages.push('…');
    pages.push(total);
    return pages;
  };

  const pageList = useMemo(
    () => buildPageList(costCenterCurrentPage, costCenterTotalPages),
    [costCenterCurrentPage, costCenterTotalPages]
  );

  return (
    <div className="items-section">
      <style>{buttonCss}</style>
      <style>{tabCostCenterCss}</style>

      {/* HEADER */}
      <div className="section-header item-master-section-header">
        <div className="cc-header-title">
          <h3><FiFileText className="section-heading-icon" /> Cost Centers</h3>
          <p className="section-subtitle">Manage cost center values and their descriptions</p>
        </div>
        <div className="header-actions item-master-header-actions">
          <span className="item-count">Total: {costCenterTotalCount.toLocaleString()} records</span>
          <button className="ui-btn ui-btn-secondary" onClick={() => fetchCostCenters(costCenterCurrentPage)} disabled={costCenterLoading}>
            <FiRefreshCw className={costCenterLoading ? 'icon-spin btn-icon' : 'btn-icon'} />
            <span>{costCenterLoading ? 'Loading…' : 'Refresh'}</span>
          </button>
          {can('costcenter.create') && (
            <button className="ui-btn ui-btn-primary" onClick={() => setShowCreateCostCenterForm(!showCreateCostCenterForm)}>
              {showCreateCostCenterForm ? <><FiX className="btn-icon" /><span>Close Form</span></> : <><FiPlus className="btn-icon" /><span>Add Cost Center</span></>}
            </button>
          )}
        </div>
      </div>

      {/* SEARCH BAR */}
      <div className="dashboard-search-section item-master-filters-section">
        <div className="item-master-filter-bar">
          <form onSubmit={handleSearchSubmit} className="cc-search-form">
            <div className="cc-search-wrap">
              <FiSearch className="cc-search-icon" />
              <input
                type="text"
                value={localSearch}
                onChange={(e) => setLocalSearch(e.target.value)}
                placeholder="Search by Value or Description..."
                className="cc-search-input"
              />
              {localSearch && (
                <button type="button" className="cc-search-clear" onClick={handleClearSearch} aria-label="Clear search">
                  <FiX />
                </button>
              )}
            </div>
            <button type="submit" className="ui-btn ui-btn-primary cc-search-btn">
              <FiSearch className="btn-icon" /> <span>Search</span>
            </button>
          </form>
        </div>
      </div>

      {/* CREATE FORM */}
      {can('costcenter.create') && showCreateCostCenterForm && (
        <div className="create-item-form-container">
          <div className="add-user-form">
            <div className="form-header">
              <h4>Add New Cost Center</h4>
              <button className="close-form-btn" onClick={() => setShowCreateCostCenterForm(false)}><FiX /></button>
            </div>
            <div className="form-body cc-form-grid">
              <div className="form-group form-group--full">
                <label>Cost Center Value (Integer) <span className="required">*</span></label>
                <input name="Cost_Center_Value" type="number" step="1" value={newCostCenter.Cost_Center_Value} onChange={handleCreateChange} placeholder="e.g. 1000" />
              </div>
              <div className="form-group form-group--full">
                <label>Description</label>
                <textarea name="Description" value={newCostCenter.Description} onChange={handleCreateChange} rows="3" placeholder="Optional description..." />
              </div>
              <div className="form-group">
                <label>Status</label>
                <select name="Status" value={newCostCenter.Status} onChange={handleCreateChange}>
                  <option value="Active">Active</option>
                  <option value="Inactive">Inactive</option>
                </select>
              </div>
              <div className="form-group">
                <label>Creation Date</label>
                <input name="Creation_Date" type="date" value={newCostCenter.Creation_Date} onChange={handleCreateChange} />
              </div>
            </div>
            <div className="form-footer">
              <button className="ui-btn ui-btn-secondary" onClick={() => setShowCreateCostCenterForm(false)}>Cancel</button>
              <button className="ui-btn ui-btn-primary" onClick={handleSaveCostCenter} disabled={loading}>{loading ? 'Saving...' : 'Save Cost Center'}</button>
            </div>
          </div>
        </div>
      )}

      {/* TABLE */}
      <div className="cc-table-container">
        {costCenterLoading ? (
          <div className="cc-loading">
            <div className="loading-spinner"></div>
            <span>Loading data...</span>
          </div>
        ) : costCenterRecords.length > 0 ? (
          <table className="cc-table">
            <thead>
              <tr>
                <th className="col-code">Value</th>
                <th className="col-desc">Description</th>
                <th className="col-status">Status</th>
                <th className="col-date">Created</th>
                <th className="col-date">Last Updated</th>
                <th className="col-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {costCenterRecords.map(item => {
                const isActive = item.Status === 'Active';
                const menuItems = [
                  can('costcenter.edit') && { key: 'edit', label: 'Edit', icon: <FiEdit2 />, onClick: () => handleEditCostCenter(item) },
                  can('costcenter.edit') && { key: 'toggle', label: isActive ? 'Deactivate' : 'Activate', icon: isActive ? <FiLock /> : <FiUnlock />, onClick: () => handleToggleCostCenterStatus(item) },
                  can('costcenter.delete') && { key: 'delete', label: 'Delete', icon: <FiTrash2 />, onClick: () => handleDeleteCostCenter(item), variant: 'danger', dividerBefore: true },
                ].filter(Boolean);

                return (
                  <tr key={item.Cost_Center_Value}>
                    <td className="col-code">
                      <span className="cc-value-tag">{item.Cost_Center_Value}</span>
                    </td>
                    <td className="col-desc">
                      <div className="cc-desc" title={item.Description}>{item.Description || '—'}</div>
                    </td>
                    <td className="col-status">
                      <span className={`cc-status ${isActive ? 'is-active' : 'is-inactive'}`}>
                        <span className="cc-status-dot" />
                        {item.Status}
                      </span>
                    </td>
                    <td className="col-date">
                      {item.Creation_Date ? new Date(item.Creation_Date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                    </td>
                    <td className="col-date">
                      {item.Updated_At ? (
                        <div className="cc-updated">
                          <span>{new Date(item.Updated_At).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                          <span className="cc-updated-by">by {item.Updated_By || 'System'}</span>
                        </div>
                      ) : '—'}
                    </td>
                    <td className="col-actions">
                      {menuItems.length > 0 && (
                        <div className="action-buttons action-buttons--kebab">
                          <ActionsMenu items={menuItems} ariaLabel={`Actions for ${item.Cost_Center_Value}`} />
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <div className="cc-empty-state">
            <FiInbox className="cc-empty-icon" />
            <h4>No Cost Centers Found</h4>
            <p>
              {costCenterSearchTerm 
                ? `No results match "${costCenterSearchTerm}". Try adjusting your search.` 
                : 'Get started by creating your first cost center record.'}
            </p>
          </div>
        )}
      </div>

      {/* ADVANCED PAGINATION */}
      {!costCenterLoading && costCenterTotalPages > 1 && (
        <nav className="cc-pagination" aria-label="Cost Center pagination">
          <div className="cc-pagination-info">
            Showing <strong>{((costCenterCurrentPage - 1) * 50) + 1}</strong>–<strong>{Math.min(costCenterCurrentPage * 50, costCenterTotalCount)}</strong> of <strong>{costCenterTotalCount.toLocaleString()}</strong>
          </div>
          
          <div className="cc-pagination-controls">
            <button
              type="button" className="cc-page-btn"
              onClick={() => goToPage(1)}
              disabled={costCenterCurrentPage <= 1}
              aria-label="First page"
            ><FiChevronsLeft /></button>
            
            <button
              type="button" className="cc-page-btn"
              onClick={() => goToPage(costCenterCurrentPage - 1)}
              disabled={costCenterCurrentPage <= 1}
              aria-label="Previous page"
            ><FiChevronLeft /></button>
            
            {pageList.map((p, i) =>
              p === '…' ? (
                <span key={`e${i}`} className="cc-page-ellipsis">…</span>
              ) : (
                <button
                  key={p}
                  type="button"
                  className={`cc-page-btn ${p === costCenterCurrentPage ? 'is-active' : ''}`}
                  onClick={() => goToPage(p)}
                >{p}</button>
              )
            )}

            <button
              type="button" className="cc-page-btn"
              onClick={() => goToPage(costCenterCurrentPage + 1)}
              disabled={costCenterCurrentPage >= costCenterTotalPages}
              aria-label="Next page"
            ><FiChevronRight /></button>
            
            <button
              type="button" className="cc-page-btn"
              onClick={() => goToPage(costCenterTotalPages)}
              disabled={costCenterCurrentPage >= costCenterTotalPages}
              aria-label="Last page"
            ><FiChevronsRight /></button>
          </div>
        </nav>
      )}

      {/* EDIT MODAL */}
      {can('costcenter.edit') && showEditCostCenterModal && (
        <div className="item-master-modal-overlay">
          <div className="item-master-modal item-master-modal--md">
            <div className="modal-header item-master-modal-header-bar">
              <h3>Edit Cost Center: {editCostCenterData.Cost_Center_Value}</h3>
              <button className="close-form-btn" onClick={() => setShowEditCostCenterModal(false)}><FiX /></button>
            </div>
            <div className="cc-form-grid cc-form-grid--modal">
              <div className="form-group form-group--full">
                <label>Cost Center Value</label>
                <input type="number" value={editCostCenterData.Cost_Center_Value} disabled />
              </div>
              <div className="form-group form-group--full">
                <label>Description</label>
                <textarea name="Description" value={editCostCenterData.Description} onChange={handleEditChange} rows="3" />
              </div>
              <div className="form-group">
                <label>Status</label>
                <select name="Status" value={editCostCenterData.Status} onChange={handleEditChange}>
                  <option value="Active">Active</option>
                  <option value="Inactive">Inactive</option>
                </select>
              </div>
              <div className="form-group">
                <label>Creation Date</label>
                <input name="Creation_Date" type="date" value={editCostCenterData.Creation_Date} onChange={handleEditChange} />
              </div>
            </div>
            <div className="form-footer item-master-modal-footer">
              <button className="ui-btn ui-btn-secondary" onClick={() => setShowEditCostCenterModal(false)}>Cancel</button>
              <button className="ui-btn ui-btn-primary" onClick={handleUpdateCostCenter} disabled={loading}>{loading ? 'Saving...' : 'Update'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ============================================================
// Cost Center CSS — Professional, Responsive, IMS-Matched
// ============================================================
const tabCostCenterCss = `
/* ---- Header Subtitle ---- */
.section-subtitle {
  margin: 4px 0 0 0;
  font-size: 14px;
  color: #64748b;
  line-height: 1.4;
}

/* ---- Search Bar ---- */
.cc-search-form {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  width: 100%;
  align-items: center;
}
.cc-search-wrap {
  position: relative;
  display: flex;
  align-items: center;
  flex: 1 1 320px;
  min-width: 240px;
  height: 44px;
  background: #ffffff;
  border: 1.5px solid #cbd5e1;
  border-radius: 10px;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
  overflow: hidden;
}
.cc-search-wrap:hover { border-color: #94a3b8; }
.cc-search-wrap:focus-within {
  border-color: #00b8b0;
  box-shadow: 0 0 0 4px rgba(0, 184, 176, 0.15);
}
.cc-search-icon {
  width: 18px; height: 18px;
  margin-left: 14px;
  color: #475569;
  stroke-width: 2.6;
  flex-shrink: 0;
}
.cc-search-wrap:focus-within .cc-search-icon { color: #0f766e; }
.cc-search-input {
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
.cc-search-input::placeholder { color: #64748b; opacity: 1; font-weight: 500; }
.cc-search-clear {
  display: inline-flex; align-items: center; justify-content: center;
  width: 26px; height: 26px;
  margin-right: 8px;
  border: none; border-radius: 50%; background: transparent;
  color: #475569; cursor: pointer;
  flex-shrink: 0;
  transition: background 0.15s ease, color 0.15s ease;
}
.cc-search-clear:hover { background: #e2e8f0; color: #0f172a; }
.cc-search-btn {
  height: 44px;
  padding: 0 24px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

/* ---- Form Layout ---- */
.cc-form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
.cc-form-grid .form-group { margin-bottom: 0; }
.cc-form-grid .form-group--full { grid-column: 1 / -1; }
.cc-form-grid--modal { padding: 0 20px; margin-bottom: 20px; }

/* ---- Table Container ---- */
.cc-table-container {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 1px 3px rgba(0,0,0,0.04);
  margin-top: 16px;
}

/* ---- Table Core ---- */
.cc-table {
  width: 100%;
  border-collapse: collapse;
  text-align: left;
  min-width: 900px;
}
.cc-table thead th {
  padding: 14px 16px;
  font-size: 11.5px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #475569;
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
  white-space: nowrap;
}
.cc-table tbody td {
  padding: 14px 16px;
  font-size: 14px;
  border-bottom: 1px solid #f1f5f9;
  vertical-align: middle;
  color: #0f172a;
}
.cc-table tbody tr:last-child td { border-bottom: none; }
.cc-table tbody tr { transition: background 0.15s ease; }
.cc-table tbody tr:hover { background: #f0fdfa; }

/* ---- Cell Specifics ---- */
.cc-value-tag {
  display: inline-block;
  padding: 4px 10px;
  border-radius: 6px;
  background: #f0fdfa;
  border: 1px solid #ccfbf1;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-weight: 700;
  color: #0f766e;
  font-size: 13.5px;
}
.cc-desc {
  color: #475569;
  max-width: 350px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cc-date {
  color: #64748b;
  font-size: 13px;
  white-space: nowrap;
}
.cc-updated {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 13px;
  color: #64748b;
}
.cc-updated-by {
  font-size: 10.5px;
  font-weight: 700;
  color: #94a3b8;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

/* ---- Status Badge ---- */
.cc-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.02em;
}
.cc-status-dot {
  width: 7px; height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}
.cc-status.is-active {
  background: #dcfce7; color: #065f46; border: 1px solid #86efac;
}
.cc-status.is-active .cc-status-dot { background: #10b981; box-shadow: 0 0 4px rgba(16, 185, 129, 0.5); }
.cc-status.is-inactive {
  background: #fee2e2; color: #991b1b; border: 1px solid #fca5a5;
}
.cc-status.is-inactive .cc-status-dot { background: #ef4444; }

/* ---- Column Widths ---- */
.col-code { width: 140px; }
.col-desc { min-width: 200px; }
.col-status { width: 130px; }
.col-date { width: 150px; }
.col-actions { width: 70px; text-align: right; }

/* ---- Empty State ---- */
.cc-empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  text-align: center;
  color: #64748b;
}
.cc-empty-icon {
  font-size: 48px;
  color: #cbd5e1;
  margin-bottom: 16px;
}
.cc-empty-state h4 {
  margin: 0 0 8px;
  font-size: 16px;
  font-weight: 700;
  color: #0f172a;
}
.cc-empty-state p {
  margin: 0;
  font-size: 14px;
  max-width: 400px;
  line-height: 1.5;
}

/* ---- Loading State ---- */
.cc-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 60px 20px;
  color: #64748b;
  font-size: 14px;
  font-weight: 500;
}
.cc-loading .loading-spinner {
  width: 24px; height: 24px;
  border: 3px solid #e2e8f0;
  border-top-color: #00b8b0;
  border-radius: 50%;
  animation: cc-spin 0.8s linear infinite;
}
@keyframes cc-spin { to { transform: rotate(360deg); } }

/* ---- Advanced Pagination ---- */
.cc-pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 16px;
  margin-top: 16px;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  box-shadow: 0 1px 2px rgba(0,0,0,0.02);
}
.cc-pagination-info {
  font-size: 13px;
  color: #64748b;
}
.cc-pagination-info strong {
  color: #0f172a;
  font-family: 'JetBrains Mono', monospace;
  font-weight: 700;
}
.cc-pagination-controls {
  display: flex;
  align-items: center;
  gap: 4px;
}
.cc-page-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 32px;
  height: 32px;
  padding: 0 8px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: #475569;
  font-family: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}
.cc-page-btn:hover:not(:disabled):not(.is-active) {
  background: #f1f5f9;
  color: #0f172a;
}
.cc-page-btn.is-active {
  background: #f0fdfa;
  border-color: #99f6e4;
  color: #0f766e;
  font-weight: 800;
}
.cc-page-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.cc-page-btn svg {
  width: 16px;
  height: 16px;
  stroke-width: 2.4;
}
.cc-page-ellipsis {
  color: #94a3b8;
  padding: 0 4px;
  font-size: 13px;
}

/* ============================================================
   RESPONSIVE DESIGN
   ============================================================ */

@media (max-width: 1024px) {
  .cc-table { min-width: 850px; }
  .cc-table thead th { padding: 12px 12px; font-size: 11px; }
  .cc-table tbody td { padding: 12px 12px; font-size: 13.5px; }
}

@media (max-width: 768px) {
  .cc-form-grid { grid-template-columns: 1fr; }
  .cc-search-form { flex-direction: column; align-items: stretch; }
  .cc-search-btn { width: 100%; }
  .cc-header-title { width: 100%; }
  .item-master-header-actions { width: 100%; justify-content: flex-start; margin-top: 12px; }
  
  .cc-pagination {
    flex-direction: column;
    align-items: stretch;
    gap: 12px;
  }
  .cc-pagination-info { text-align: center; }
  .cc-pagination-controls { justify-content: center; }
}

@media (max-width: 640px) {
  .item-master-section-header { flex-direction: column; align-items: stretch; gap: 12px; }
  .item-master-header-actions { display: flex; flex-wrap: wrap; gap: 10px; }
  .item-master-header-actions .item-count { width: 100%; order: -1; text-align: left; margin-bottom: 4px; }
  .item-master-header-actions .ui-btn { flex: 1 1 0; justify-content: center; }
  
  .cc-table { min-width: 800px; }
  .cc-table thead th { padding: 10px 10px; font-size: 10.5px; }
  .cc-table tbody td { padding: 10px 10px; font-size: 13px; }
  
  .cc-desc { max-width: 200px; }
}

@media (max-width: 480px) {
  .item-master-header-actions .ui-btn { flex: 1 1 100%; }
  .cc-table { min-width: 750px; }
  .cc-form-grid--modal { padding: 0 14px; }
  
  .cc-page-btn { min-width: 28px; height: 28px; font-size: 12px; }
  .cc-page-btn svg { width: 14px; height: 14px; }
}

@media (min-width: 1921px) {
  .cc-search-wrap { flex: 1 1 480px; }
  .cc-table { min-width: 1200px; }
  .cc-table thead th { padding: 18px 20px; font-size: 13px; }
  .cc-table tbody td { padding: 18px 20px; font-size: 15px; }
  .cc-value-tag { font-size: 14.5px; padding: 6px 14px; }
  .cc-desc { max-width: 600px; font-size: 15px; }
  .cc-date, .cc-updated { font-size: 14px; }
  .cc-pagination { padding: 16px 20px; }
  .cc-page-btn { min-width: 38px; height: 38px; font-size: 14px; }
}
`;

export default TabCostCenter;