// src/components/admin/TabMasterData.jsx
import React from 'react';
import { usePermissions } from '../../permissions/usePermissions';

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
  } = adminData;

  const { can } = usePermissions();

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
            <button className="add-user-btn" onClick={addHandler}>➕ Add {title.split(' ').pop()}</button>
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
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="pagination-btn">◀ Prev</button>
            <span className="pagination-info">Page {page} of {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="pagination-btn">Next ▶</button>
          </div>
        )}
      </div>
    );
  };

  const renderActions = (item, onEdit, onToggle, idField = 'id', statusField = 'status') => (
    <div className="action-buttons">
      {can('masterdata.edit') && (
        <button className="action-btn edit" onClick={() => onEdit(item)}>Edit</button>
      )}
      {can('masterdata.delete') && (
        item[statusField] === 'Active'
          ? <button className="action-btn deactivate-btn" onClick={() => onToggle(item[idField])}>Deactivate</button>
          : <button className="action-btn activate-btn" onClick={() => onToggle(item[idField])}>Activate</button>
      )}
    </div>
  );

  return (
    <div className="items-section">
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
              <div className="form-header"><h5>Add New UOM</h5><button className="close-form-btn" onClick={handleCloseUomForm}>✕</button></div>
              <div className="form-body">
                <div className="form-group"><label htmlFor="newUomCode">UOM Code</label><input id="newUomCode" type="text" name="code" value={newUom.code} onChange={handleNewUomChange} placeholder="e.g., PCS" /></div>
                <div className="form-group"><label htmlFor="newUomDescription">UOM Description</label><input id="newUomDescription" type="text" name="description" value={newUom.description} onChange={handleNewUomChange} placeholder="e.g., Pieces" /></div>
              </div>
              <div className="form-footer"><button className="cancel-btn" onClick={handleCloseUomForm}>Cancel</button><button className="save-btn" onClick={handleSaveUom}>Save UOM</button></div>
            </div>
          ),
          editForm: showEditUom && (
            <div className="add-user-form" style={{ marginBottom: '12px' }}>
              <div className="form-header"><h5>Edit UOM</h5><button className="close-form-btn" onClick={handleCloseEditUom}>✕</button></div>
              <div className="form-body">
                <div className="form-group"><label htmlFor="editUomCode">UOM Code</label><input id="editUomCode" type="text" value={editUomData.id} disabled style={{ background: '#f5f5f0' }} /></div>
                <div className="form-group"><label htmlFor="editUomDescription">Description <span className="required">*</span></label><input id="editUomDescription" type="text" name="description" value={editUomData.description} onChange={handleEditUomChange} /></div>
                <div className="form-group"><label htmlFor="editUomStatus">Status</label><select id="editUomStatus" name="status" value={editUomData.status} onChange={handleEditUomChange}><option value="Active">Active</option><option value="Inactive">Inactive</option></select></div>
              </div>
              <div className="form-footer"><button className="cancel-btn" onClick={handleCloseEditUom}>Cancel</button><button className="save-btn" onClick={handleUpdateUom}>Update</button></div>
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
              <div className="form-header"><h5>Add New GL Class</h5><button className="close-form-btn" onClick={handleCloseGlForm}>✕</button></div>
              <div className="form-body">
                <div className="form-group"><label htmlFor="newGlNumber">GL Number</label><input id="newGlNumber" type="text" name="number" value={newGl.number} onChange={handleNewGlChange} placeholder="e.g., 62010" /></div>
                <div className="form-group"><label htmlFor="newGlDescription">GL Description</label><input id="newGlDescription" type="text" name="description" value={newGl.description} onChange={handleNewGlChange} placeholder="Description" /></div>
              </div>
              <div className="form-footer"><button className="cancel-btn" onClick={handleCloseGlForm}>Cancel</button><button className="save-btn" onClick={handleSaveGl}>Save GL</button></div>
            </div>
          ),
          editForm: showEditGl && (
            <div className="add-user-form" style={{ marginBottom: '12px' }}>
              <div className="form-header"><h5>Edit GL Class</h5><button className="close-form-btn" onClick={handleCloseEditGl}>✕</button></div>
              <div className="form-body">
                <div className="form-group"><label htmlFor="editGlNumber">GL Number</label><input id="editGlNumber" type="text" value={editGlData.id} disabled style={{ background: '#f5f5f0' }} /></div>
                <div className="form-group"><label htmlFor="editGlDescription">Description <span className="required">*</span></label><input id="editGlDescription" type="text" name="description" value={editGlData.description} onChange={handleEditGlChange} /></div>
                <div className="form-group"><label htmlFor="editGlStatus">Status</label><select id="editGlStatus" name="status" value={editGlData.status} onChange={handleEditGlChange}><option value="Active">Active</option><option value="Inactive">Inactive</option></select></div>
              </div>
              <div className="form-footer"><button className="cancel-btn" onClick={handleCloseEditGl}>Cancel</button><button className="save-btn" onClick={handleUpdateGl}>Update</button></div>
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
              <div className="form-header"><h5>Add New Purchase Class</h5><button className="close-form-btn" onClick={handleClosePurchaseClassForm}>✕</button></div>
              <div className="form-body">
                <div className="form-group"><label htmlFor="newPurchaseClassName">Class Name (e.g., A, B, C)</label><input id="newPurchaseClassName" type="text" name="name" value={newPurchaseClass.name} onChange={handleNewPurchaseClassChange} placeholder="e.g., E" /></div>
              </div>
              <div className="form-footer"><button className="cancel-btn" onClick={handleClosePurchaseClassForm}>Cancel</button><button className="save-btn" onClick={handleSavePurchaseClass}>Save</button></div>
            </div>
          ),
          editForm: showEditPurchaseClass && (
            <div className="add-user-form" style={{ marginBottom: '12px' }}>
              <div className="form-header"><h5>Edit Purchase Class</h5><button className="close-form-btn" onClick={handleCloseEditPurchaseClass}>✕</button></div>
              <div className="form-body">
                <div className="form-group"><label htmlFor="editPurchaseClassName">Class Name</label><input id="editPurchaseClassName" type="text" value={editPurchaseClassData.id} disabled style={{ background: '#f5f5f0' }} /></div>
                <div className="form-group"><label htmlFor="editPurchaseClassStatus">Status</label><select id="editPurchaseClassStatus" name="status" value={editPurchaseClassData.status} onChange={handleEditPurchaseClassChange}><option value="Active">Active</option><option value="Inactive">Inactive</option></select></div>
              </div>
              <div className="form-footer"><button className="cancel-btn" onClick={handleCloseEditPurchaseClass}>Cancel</button><button className="save-btn" onClick={handleUpdatePurchaseClass}>Update</button></div>
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
              <div className="form-header"><h5>Add New Category</h5><button className="close-form-btn" onClick={handleCloseCategoryForm}>✕</button></div>
              <div className="form-body">
                <div className="form-group"><label htmlFor="newCategoryName">Category Name</label><input id="newCategoryName" type="text" name="name" value={newCategory.name} onChange={handleNewCategoryChange} placeholder="e.g., Raw Materials" /></div>
              </div>
              <div className="form-footer"><button className="cancel-btn" onClick={handleCloseCategoryForm}>Cancel</button><button className="save-btn" onClick={handleSaveCategory}>Save</button></div>
            </div>
          ),
          editForm: showEditCategory && (
            <div className="add-user-form" style={{ marginBottom: '12px' }}>
              <div className="form-header"><h5>Edit Category</h5><button className="close-form-btn" onClick={handleCloseEditCategory}>✕</button></div>
              <div className="form-body">
                <div className="form-group"><label htmlFor="editCategoryName">Category Name</label><input id="editCategoryName" type="text" value={editCategoryData.id} disabled style={{ background: '#f5f5f0' }} /></div>
                <div className="form-group"><label htmlFor="editCategoryStatus">Status</label><select id="editCategoryStatus" name="status" value={editCategoryData.status} onChange={handleEditCategoryChange}><option value="Active">Active</option><option value="Inactive">Inactive</option></select></div>
              </div>
              <div className="form-footer"><button className="cancel-btn" onClick={handleCloseEditCategory}>Cancel</button><button className="save-btn" onClick={handleUpdateCategory}>Update</button></div>
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