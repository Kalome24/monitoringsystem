// src/components/admin/TabMasterData.jsx
import React from 'react';
import { FiPlus, FiX, FiEdit2, FiLock, FiUnlock } from 'react-icons/fi';
import { usePermissions } from '../../permissions/usePermissions';
import ActionsMenu from '../shared/ActionsMenu';
import { buttonCss } from '../shared/buttonStyles';
import { useRefreshOnFocus } from '../../hooks/useRefreshOnFocus';

const TabMasterData = ({ adminData }) => {
  const {
    glList, glSearch, setGlSearch, glPage, setGlPage,
    uomList, uomSearch, setUomSearch, uomPage, setUomPage,
    purchaseClassList, purchaseClassSearch, setPurchaseClassSearch, purchaseClassPage, setPurchaseClassPage,
    categoryList, categorySearch, setCategorySearch, categoryPage, setCategoryPage,
    showAddGl, setShowAddGl,
    showEditGl, setShowEditGl,
    showAddUom, setShowAddUom,
    showEditUom, setShowEditUom,
    showAddPurchaseClass, setShowAddPurchaseClass,
    showEditPurchaseClass, setShowEditPurchaseClass,
    showAddCategory, setShowAddCategory,
    showEditCategory, setShowEditCategory,
    newGl, setNewGl,
    newUom, setNewUom,
    newPurchaseClass, setNewPurchaseClass,
    newCategory, setNewCategory,
    editGlData, setEditGlData,
    editUomData, setEditUomData,
    editPurchaseClassData, setEditPurchaseClassData,
    editCategoryData, setEditCategoryData,
    handleAddGl,
    handleCloseGlForm,
    handleNewGlChange,
    handleSaveGl,
    handleDeleteGl,
    handleEditGl,
    handleCloseEditGl,
    handleEditGlChange,
    handleUpdateGl,
    handleAddUom,
    handleCloseUomForm,
    handleNewUomChange,
    handleSaveUom,
    handleDeleteUom,
    handleEditUom,
    handleCloseEditUom,
    handleEditUomChange,
    handleUpdateUom,
    handleAddPurchaseClass,
    handleClosePurchaseClassForm,
    handleNewPurchaseClassChange,
    handleSavePurchaseClass,
    handleDeletePurchaseClass,
    handleEditPurchaseClass,
    handleCloseEditPurchaseClass,
    handleEditPurchaseClassChange,
    handleUpdatePurchaseClass,
    handleAddCategory,
    handleCloseCategoryForm,
    handleNewCategoryChange,
    handleSaveCategory,
    handleDeleteCategory,
    handleEditCategory,
    handleCloseEditCategory,
    handleEditCategoryChange,
    handleUpdateCategory,
    ITEMS_PER_PAGE,
    // Session 10 (G5): exposed so the focus-refresh hook can re-run the
    // same loader the tab already calls on mount.
    fetchMasterData,
  } = adminData;

  const { can } = usePermissions();

  // Session 10 (G5): silent refresh when the browser tab regains focus.
  // Re-runs the master-data loader so GL / UOM / PC / Category lists
  // pick up any changes made elsewhere without a manual reload.
  useRefreshOnFocus(() => {
    if (typeof fetchMasterData === 'function') fetchMasterData();
  });

  const renderMasterCard = ({ title, list, search, setSearch, page, setPage, addHandler, showAdd, addForm, editForm, renderTableRows, columns, actions }) => {
    const filtered = list.filter(item =>
      Object.values(item).some(val =>
        String(val).toLowerCase().includes(search.toLowerCase())
      )
    );
    const totalPages = Math.ceil(filtered.length / ITEMS_PER_PAGE);
    const start = (page - 1) * ITEMS_PER_PAGE;
    const end = start + ITEMS_PER_PAGE;
    const paginated = filtered.slice(start, end);

    return (
      <div className="master-card">
        <div className="master-header">
          <h4>{title}</h4>
          {can('masterdata.create') && (
            <button className="ui-btn ui-btn-primary" onClick={addHandler} type="button">
              <FiPlus className="btn-icon" />
              <span>Add {title.split(' ').pop()}</span>
            </button>
          )}
        </div>
        {can('masterdata.create') && showAdd && addForm}
        {can('masterdata.edit') && editForm}
        <div className="master-search-wrapper">
          <input type="text" placeholder={`Search ${title.toLowerCase()}...`} value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
          <span className="total-count">Total: {list.length} items</span>
        </div>
        <div className="table-wrapper">
          <table className="data-table">
            <thead><tr>{columns.map((col, idx) => <th key={idx}>{col}</th>)}</tr></thead>
            <tbody>
              {paginated.map(item => renderTableRows(item, actions))}
              {list.length === 0 && <tr><td colSpan={columns.length} style={{ textAlign: 'center' }}>No {title.toLowerCase()} defined.</td></tr>}
            </tbody>
          </table>
        </div>
        {totalPages > 1 && (
          <div style={{ display: 'flex', justifyContent: 'center', gap: '10px', marginTop: '10px' }}>
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="ui-btn ui-btn-secondary ui-btn-sm" type="button">Prev</button>
            <span className="pagination-info">Page {page} of {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="ui-btn ui-btn-secondary ui-btn-sm" type="button">Next</button>
          </div>
        )}
      </div>
    );
  };

  /**
   * Renders the kebab menu for a master-data row.
   * Only includes actions the current user can perform; returns null
   * if there are none (so the cell stays empty instead of showing a
   * dangling menu button).
   */
  const renderActions = (item, onEdit, onToggle, idField = 'id', statusField = 'status') => {
    const isActive = item[statusField] === 'Active';

    const items = [
      can('masterdata.edit') && {
        key: 'edit',
        label: 'Edit',
        icon: <FiEdit2 />,
        onClick: () => onEdit(item),
      },
      can('masterdata.delete') && (isActive
        ? {
            key: 'deactivate',
            label: 'Deactivate',
            icon: <FiLock />,
            onClick: () => onToggle(item[idField]),
            variant: 'muted',
          }
        : {
            key: 'activate',
            label: 'Activate',
            icon: <FiUnlock />,
            onClick: () => onToggle(item[idField]),
            variant: 'success',
          }),
    ].filter(Boolean);

    if (items.length === 0) return null;

    return (
      <div className="action-buttons action-buttons--kebab">
        <ActionsMenu items={items} ariaLabel={`Actions for ${item.name || item.number || item.code || item[idField] || 'row'}`} />
      </div>
    );
  };

  return (
    <div className="items-section">
      <style>{buttonCss}</style>
      <style>{tabMasterDataIconCss}</style>
      <div className="master-data-section">
        <h3>Manage Master Data</h3>
        <p className="sub-info">Manage UOM, GL, Purchase Class, and Category lists.</p>

        {renderMasterCard({
          title: 'Unit of Measure (UOM)',
          list: uomList,
          search: uomSearch,
          setSearch: setUomSearch,
          page: uomPage,
          setPage: setUomPage,
          addHandler: handleAddUom,
          showAdd: showAddUom,
          addForm: (
            <div className="add-user-form" style={{ marginBottom: '12px' }}>
              <div className="form-header"><h5>Add New UOM</h5><button className="close-form-btn" onClick={handleCloseUomForm}><FiX /></button></div>
              <div className="form-body">
                <div className="form-group"><label htmlFor="newUomCode">UOM Code</label><input id="newUomCode" type="text" name="code" value={newUom.code} onChange={handleNewUomChange} placeholder="e.g., PCS" /></div>
                <div className="form-group"><label htmlFor="newUomDescription">UOM Description</label><input id="newUomDescription" type="text" name="description" value={newUom.description} onChange={handleNewUomChange} placeholder="e.g., Pieces" /></div>
              </div>
              <div className="form-footer">
                <button className="ui-btn ui-btn-secondary" onClick={handleCloseUomForm} type="button">Cancel</button>
                <button className="ui-btn ui-btn-primary" onClick={handleSaveUom} type="button">Save UOM</button>
              </div>
            </div>
          ),
          editForm: showEditUom && (
            <div className="add-user-form" style={{ marginBottom: '12px' }}>
              <div className="form-header"><h5>Edit UOM</h5><button className="close-form-btn" onClick={handleCloseEditUom}><FiX /></button></div>
              <div className="form-body">
                <div className="form-group"><label htmlFor="editUomCode">UOM Code</label><input id="editUomCode" type="text" value={editUomData.id} disabled style={{ background: '#f5f5f0' }} /></div>
                <div className="form-group"><label htmlFor="editUomDescription">Description <span className="required">*</span></label><input id="editUomDescription" type="text" name="description" value={editUomData.description} onChange={handleEditUomChange} /></div>
                <div className="form-group"><label htmlFor="editUomStatus">Status</label><select id="editUomStatus" name="status" value={editUomData.status} onChange={handleEditUomChange}><option value="Active">Active</option><option value="Inactive">Inactive</option></select></div>
              </div>
              <div className="form-footer">
                <button className="ui-btn ui-btn-secondary" onClick={handleCloseEditUom} type="button">Cancel</button>
                <button className="ui-btn ui-btn-primary" onClick={handleUpdateUom} type="button">Update</button>
              </div>
            </div>
          ),
          renderTableRows: (uom, actions) => (
            <tr key={uom.id}>
              <td><span className="warehouse-code">{uom.code}</span></td>
              <td>{uom.description}</td>
              <td><span className={`status-badge ${uom.status?.toLowerCase() || 'active'}`}>{uom.status || 'Active'}</span></td>
              <td>{actions(uom)}</td>
            </tr>
          ),
          columns: ['Code', 'Description', 'Status', 'Actions'],
          actions: (uom) => renderActions(uom, handleEditUom, handleDeleteUom),
        })}

        {renderMasterCard({
          title: 'General Ledger Classes',
          list: glList,
          search: glSearch,
          setSearch: setGlSearch,
          page: glPage,
          setPage: setGlPage,
          addHandler: handleAddGl,
          showAdd: showAddGl,
          addForm: (
            <div className="add-user-form" style={{ marginBottom: '12px' }}>
              <div className="form-header"><h5>Add New GL Class</h5><button className="close-form-btn" onClick={handleCloseGlForm}><FiX /></button></div>
              <div className="form-body">
                <div className="form-group"><label htmlFor="newGlNumber">GL Number</label><input id="newGlNumber" type="text" name="number" value={newGl.number} onChange={handleNewGlChange} placeholder="e.g., 62010" /></div>
                <div className="form-group"><label htmlFor="newGlDescription">GL Description</label><input id="newGlDescription" type="text" name="description" value={newGl.description} onChange={handleNewGlChange} placeholder="Description" /></div>
              </div>
              <div className="form-footer">
                <button className="ui-btn ui-btn-secondary" onClick={handleCloseGlForm} type="button">Cancel</button>
                <button className="ui-btn ui-btn-primary" onClick={handleSaveGl} type="button">Save GL</button>
              </div>
            </div>
          ),
          editForm: showEditGl && (
            <div className="add-user-form" style={{ marginBottom: '12px' }}>
              <div className="form-header"><h5>Edit GL Class</h5><button className="close-form-btn" onClick={handleCloseEditGl}><FiX /></button></div>
              <div className="form-body">
                <div className="form-group"><label htmlFor="editGlNumber">GL Number</label><input id="editGlNumber" type="text" value={editGlData.id} disabled style={{ background: '#f5f5f0' }} /></div>
                <div className="form-group"><label htmlFor="editGlDescription">Description <span className="required">*</span></label><input id="editGlDescription" type="text" name="description" value={editGlData.description} onChange={handleEditGlChange} /></div>
                <div className="form-group"><label htmlFor="editGlStatus">Status</label><select id="editGlStatus" name="status" value={editGlData.status} onChange={handleEditGlChange}><option value="Active">Active</option><option value="Inactive">Inactive</option></select></div>
              </div>
              <div className="form-footer">
                <button className="ui-btn ui-btn-secondary" onClick={handleCloseEditGl} type="button">Cancel</button>
                <button className="ui-btn ui-btn-primary" onClick={handleUpdateGl} type="button">Update</button>
              </div>
            </div>
          ),
          renderTableRows: (gl, actions) => (
            <tr key={gl.id}>
              <td><span className="warehouse-code">{gl.number}</span></td>
              <td>{gl.description}</td>
              <td><span className={`status-badge ${gl.status?.toLowerCase() || 'active'}`}>{gl.status || 'Active'}</span></td>
              <td>{actions(gl)}</td>
            </tr>
          ),
          columns: ['Number', 'Description', 'Status', 'Actions'],
          actions: (gl) => renderActions(gl, handleEditGl, handleDeleteGl),
        })}

        {renderMasterCard({
          title: 'Item Purchase Classes',
          list: purchaseClassList,
          search: purchaseClassSearch,
          setSearch: setPurchaseClassSearch,
          page: purchaseClassPage,
          setPage: setPurchaseClassPage,
          addHandler: handleAddPurchaseClass,
          showAdd: showAddPurchaseClass,
          addForm: (
            <div className="add-user-form" style={{ marginBottom: '12px' }}>
              <div className="form-header"><h5>Add New Purchase Class</h5><button className="close-form-btn" onClick={handleClosePurchaseClassForm}><FiX /></button></div>
              <div className="form-body">
                <div className="form-group"><label htmlFor="newPurchaseClassName">Class Name (e.g., A, B, C)</label><input id="newPurchaseClassName" type="text" name="name" value={newPurchaseClass.name} onChange={handleNewPurchaseClassChange} placeholder="e.g., E" /></div>
              </div>
              <div className="form-footer">
                <button className="ui-btn ui-btn-secondary" onClick={handleClosePurchaseClassForm} type="button">Cancel</button>
                <button className="ui-btn ui-btn-primary" onClick={handleSavePurchaseClass} type="button">Save</button>
              </div>
            </div>
          ),
          editForm: showEditPurchaseClass && (
            <div className="add-user-form" style={{ marginBottom: '12px' }}>
              <div className="form-header"><h5>Edit Purchase Class</h5><button className="close-form-btn" onClick={handleCloseEditPurchaseClass}><FiX /></button></div>
              <div className="form-body">
                <div className="form-group"><label htmlFor="editPurchaseClassName">Class Name</label><input id="editPurchaseClassName" type="text" value={editPurchaseClassData.id} disabled style={{ background: '#f5f5f0' }} /></div>
                <div className="form-group"><label htmlFor="editPurchaseClassStatus">Status</label><select id="editPurchaseClassStatus" name="status" value={editPurchaseClassData.status} onChange={handleEditPurchaseClassChange}><option value="Active">Active</option><option value="Inactive">Inactive</option></select></div>
              </div>
              <div className="form-footer">
                <button className="ui-btn ui-btn-secondary" onClick={handleCloseEditPurchaseClass} type="button">Cancel</button>
                <button className="ui-btn ui-btn-primary" onClick={handleUpdatePurchaseClass} type="button">Update</button>
              </div>
            </div>
          ),
          renderTableRows: (pc, actions) => (
            <tr key={pc.id}>
              <td><span className="warehouse-code">{pc.name}</span></td>
              <td><span className={`status-badge ${pc.status?.toLowerCase() || 'active'}`}>{pc.status || 'Active'}</span></td>
              <td>{actions(pc)}</td>
            </tr>
          ),
          columns: ['Name', 'Status', 'Actions'],
          actions: (pc) => renderActions(pc, handleEditPurchaseClass, handleDeletePurchaseClass),
        })}

        {renderMasterCard({
          title: 'Categories',
          list: categoryList,
          search: categorySearch,
          setSearch: setCategorySearch,
          page: categoryPage,
          setPage: setCategoryPage,
          addHandler: handleAddCategory,
          showAdd: showAddCategory,
          addForm: (
            <div className="add-user-form" style={{ marginBottom: '12px' }}>
              <div className="form-header"><h5>Add New Category</h5><button className="close-form-btn" onClick={handleCloseCategoryForm}><FiX /></button></div>
              <div className="form-body">
                <div className="form-group"><label htmlFor="newCategoryName">Category Name</label><input id="newCategoryName" type="text" name="name" value={newCategory.name} onChange={handleNewCategoryChange} placeholder="e.g., Raw Materials" /></div>
              </div>
              <div className="form-footer">
                <button className="ui-btn ui-btn-secondary" onClick={handleCloseCategoryForm} type="button">Cancel</button>
                <button className="ui-btn ui-btn-primary" onClick={handleSaveCategory} type="button">Save</button>
              </div>
            </div>
          ),
          editForm: showEditCategory && (
            <div className="add-user-form" style={{ marginBottom: '12px' }}>
              <div className="form-header"><h5>Edit Category</h5><button className="close-form-btn" onClick={handleCloseEditCategory}><FiX /></button></div>
              <div className="form-body">
                <div className="form-group"><label htmlFor="editCategoryName">Category Name</label><input id="editCategoryName" type="text" value={editCategoryData.id} disabled style={{ background: '#f5f5f0' }} /></div>
                <div className="form-group"><label htmlFor="editCategoryStatus">Status</label><select id="editCategoryStatus" name="status" value={editCategoryData.status} onChange={handleEditCategoryChange}><option value="Active">Active</option><option value="Inactive">Inactive</option></select></div>
              </div>
              <div className="form-footer">
                <button className="ui-btn ui-btn-secondary" onClick={handleCloseEditCategory} type="button">Cancel</button>
                <button className="ui-btn ui-btn-primary" onClick={handleUpdateCategory} type="button">Update</button>
              </div>
            </div>
          ),
          renderTableRows: (cat, actions) => (
            <tr key={cat.id}>
              <td>{cat.name}</td>
              <td><span className={`status-badge ${cat.status?.toLowerCase() || 'active'}`}>{cat.status || 'Active'}</span></td>
              <td>{actions(cat)}</td>
            </tr>
          ),
          columns: ['Name', 'Status', 'Actions'],
          actions: (cat) => renderActions(cat, handleEditCategory, handleDeleteCategory),
        })}
      </div>
    </div>
  );
};

export default TabMasterData;

// ============================================================
// Icon styles + kebab action cell
// ============================================================
const tabMasterDataIconCss = `
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

/* Right-align the kebab inside the actions cell */
.action-buttons--kebab {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 6px;
}
`;