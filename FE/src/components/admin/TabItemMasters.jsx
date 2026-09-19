// src/components/admin/TabItemMasters.jsx
import React, { useEffect, useRef, useState } from 'react';
import { usePermissions } from '../../permissions/usePermissions';
import { itemMasterApi } from '../../services/api';

const TabItemMasters = ({ adminData }) => {
  const {
    itemMasterRecords,
    itemMasterLoading,
    itemMasterCurrentPage,
    setItemMasterCurrentPage,
    itemMasterTotalPages,
    itemMasterTotalCount,
    itemMasterSearchTerm,
    setItemMasterSearchTerm,
    showCreateItemForm,
    newAdminItem,
    newAdminItemImagePreview,
    barcodeCanvasRef,
    barcodeImageRef,
    showEditMasterModal,
    editMasterData,
    editMasterImagePreview,
    showDetailModal,
    detailItem,
    glList,
    uomList,
    purchaseClassList,
    categoryList,
    loading,
    generateBarcodeDataUrl,
    fetchItemMasters,
    handleToggleCreateItemForm,
    handleNewAdminItemChange,
    handleImageChange,
    handleRemoveImage,
    onUomChange,
    onGlChange,
    onPurchaseClassChange,
    onCategoryChange,
    generateBarcode,
    exportBarcodeImage,
    handleSaveAdminItem,
    handleEditMasterItem,
    handleCloseEditMasterModal,
    handleEditMasterChange,
    handleEditMasterImageChange,
    handleRemoveEditMasterImage,
    handleUpdateMasterItem,
    handleToggleMasterStatus,
    handleDeleteMasterItem,
    handleRowClick,
    handleCloseDetailModal,
    showAddUom, setShowAddUom,
    newUom, setNewUom,
    handleCloseUomForm,
    handleNewUomChange,
    handleSaveUom,
    showAddGl, setShowAddGl,
    newGl, setNewGl,
    handleCloseGlForm,
    handleNewGlChange,
    handleSaveGl,
    showAddPurchaseClass, setShowAddPurchaseClass,
    newPurchaseClass, setNewPurchaseClass,
    handleClosePurchaseClassForm,
    handleNewPurchaseClassChange,
    handleSavePurchaseClass,
    showAddCategory, setShowAddCategory,
    newCategory, setNewCategory,
    handleCloseCategoryForm,
    handleNewCategoryChange,
    handleSaveCategory,
  } = adminData;

  const { can } = usePermissions();

  // ============================================================
  // Local barcode-scan state (self-contained; does not depend on
  // the older global barcode handler in useAdminData.js).
  // ============================================================
  const [localBarcode, setLocalBarcode] = useState('');
  const [scanFeedback, setScanFeedback] = useState(null); // null | 'scanning' | 'ok' | 'error'
  const barcodeInputRefLocal = useRef(null);

  useEffect(() => {
    fetchItemMasters(itemMasterCurrentPage);
  }, [itemMasterCurrentPage, itemMasterSearchTerm]);

  // Refocus the scanner input whenever the detail modal closes so
  // the next scan lands in the right field.
  const closeDetailAndRefocus = () => {
    handleCloseDetailModal();
    setTimeout(() => {
      if (barcodeInputRefLocal.current) barcodeInputRefLocal.current.focus();
    }, 120);
  };

  // ============================================================
  // Barcode scan handler
  //   1. Match against the current page's loaded records
  //   2. Server lookup by Item_Code (strips the "BC-" prefix)
  //   3. Server search by the raw scanned value
  // ============================================================
  const handleScanBarcode = async () => {
    const value = localBarcode.trim();
    if (!value) {
      setScanFeedback('error');
      setTimeout(() => setScanFeedback(null), 1600);
      return;
    }

    setScanFeedback('scanning');

    // 1) Local match — Barcode or Item_Code in the current page
    let found =
      itemMasterRecords.find((it) => it.Barcode === value) ||
      itemMasterRecords.find((it) => it.Item_Code === value) ||
      null;

    // 2) Server lookup by Item_Code. Strip "BC-" prefix if present.
    if (!found) {
      const codeCandidate = value.startsWith('BC-') ? value.slice(3) : value;
      try {
        const res = await itemMasterApi.getItemMasterByCode(codeCandidate);
        if (res.ok && res.data) {
          const row = res.data.data || res.data;
          if (row && (row.Item_Code || row.Barcode)) found = row;
        }
      } catch (err) {
        console.warn('Barcode lookup by Item_Code failed:', err);
      }
    }

    // 3) Server search by the raw scanned value (covers non-BC- legacy
    //    barcodes and any items whose barcode the server indexes).
    if (!found) {
      try {
        const res = await itemMasterApi.getAllItemMasters({
          page: 1,
          limit: 10,
          search: value,
        });
        if (res.ok && res.data) {
          const list = res.data.data || [];
          found =
            list.find((it) => it.Barcode === value) ||
            list.find((it) => it.Item_Code === value) ||
            null;
        }
      } catch (err) {
        console.warn('Barcode search fallback failed:', err);
      }
    }

    // -------------- Outcome --------------
    setLocalBarcode('');

    if (found) {
      setScanFeedback('ok');
      handleRowClick(found);
    } else {
      setScanFeedback('error');
    }

    setTimeout(() => {
      setScanFeedback(null);
      if (barcodeInputRefLocal.current) barcodeInputRefLocal.current.focus();
    }, 1600);
  };

  const filteredRecords = itemMasterRecords.filter(item =>
    item.Item_Code?.toLowerCase().includes(itemMasterSearchTerm.toLowerCase()) ||
    item.Item_Description?.toLowerCase().includes(itemMasterSearchTerm.toLowerCase()) ||
    item.Uom_Code?.toLowerCase().includes(itemMasterSearchTerm.toLowerCase()) ||
    item.Purchase_Class?.toLowerCase().includes(itemMasterSearchTerm.toLowerCase()) ||
    item.Category?.toLowerCase().includes(itemMasterSearchTerm.toLowerCase())
  );

  const renderAddModal = (show, setShow, title, fields, onSave, onClose, onFieldChange, state) => {
    if (!show) return null;
    return (
      <div className="modal-overlay" style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 9999 }}>
        <div className="modal-content" style={{ background: 'white', padding: '30px', borderRadius: '8px', maxWidth: '500px', width: '95%', maxHeight: '90vh', overflowY: 'auto' }}>
          <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px' }}>
            <h4>{title}</h4>
            <button className="close-form-btn" onClick={onClose}>✕</button>
          </div>
          <div className="form-body" style={{ gridTemplateColumns: '1fr' }}>
            {fields.map((field, idx) => (
              <div className="form-group" key={idx}>
                <label>{field.label} <span className="required">*</span></label>
                <input type="text" name={field.name} value={state[field.name] || ''} onChange={onFieldChange} placeholder={field.placeholder} />
              </div>
            ))}
          </div>
          <div className="form-footer">
            <button className="cancel-btn" onClick={onClose}>Cancel</button>
            <button className="save-btn" onClick={onSave}>Save</button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="items-section">
      <div className="section-header">
        <h3>📋 Item Masters (Database)</h3>
        <div className="header-actions">
          <span className="item-count">Total: {itemMasterTotalCount} items</span>
          {can('itemmasters.create') && (
            <button className="add-user-btn" onClick={handleToggleCreateItemForm} disabled={loading}>
              {loading ? '⏳ Saving...' : (showCreateItemForm ? '✕ Close Form' : '➕ Create Item with Barcode')}
            </button>
          )}
        </div>
      </div>

      {/* ============================================================
          Barcode Scanner
          ============================================================ */}
      <div className="dashboard-search-section">
        <div className="dashboard-filters">
          <div className="filter-row">
            <div className="filter-group" style={{ flex: '2 1 320px' }}>
              <label htmlFor="barcodeSearchInput">🔍 Scan or type barcode</label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
                <input
                  id="barcodeSearchInput"
                  ref={barcodeInputRefLocal}
                  type="text"
                  placeholder="Scan barcode or enter code..."
                  value={localBarcode}
                  onChange={(e) => setLocalBarcode(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleScanBarcode();
                    }
                  }}
                  className="filter-input"
                  style={{ fontSize: '18px', flex: 1 }}
                  autoFocus
                  autoComplete="off"
                  spellCheck={false}
                />
                <button
                  type="button"
                  className="add-user-btn"
                  onClick={handleScanBarcode}
                  style={{ padding: '10px 18px', fontSize: 14, whiteSpace: 'nowrap' }}
                  title="Look up the entered barcode"
                >
                  🔎 Scan
                </button>
              </div>

              {scanFeedback && (
                <div
                  style={{
                    marginTop: 6,
                    fontSize: 12,
                    fontWeight: 600,
                    color:
                      scanFeedback === 'ok'      ? '#059669' :
                      scanFeedback === 'error'   ? '#dc2626' :
                                                   '#64748b',
                  }}
                >
                  {scanFeedback === 'ok'       && '✅ Found — opening item details'}
                  {scanFeedback === 'error'    && '❌ No item matched that barcode'}
                  {scanFeedback === 'scanning' && '⏳ Looking up…'}
                </div>
              )}

              <small style={{ color: '#7a8699', marginTop: 4, display: 'block', fontSize: 11 }}>
                Hardware scanners work by typing digits then pressing Enter — the lookup fires automatically.
              </small>
            </div>
          </div>
        </div>
      </div>

      {/* Create Item Form — only for users with itemmasters.create */}
      {can('itemmasters.create') && showCreateItemForm && (
        <div className="create-item-form-container">
          <div className="add-user-form">
            <div className="form-header">
              <h4>Create New Item with Barcode (item_master)</h4>
              <button className="close-form-btn" onClick={handleToggleCreateItemForm}>✕</button>
            </div>
            <div className="form-body">
              <div className="form-group">
                <label htmlFor="newAdmin_Item_Code">Item Code <span className="required">*</span></label>
                <input id="newAdmin_Item_Code" name="Item_Code" type="text" value={newAdminItem.Item_Code} onChange={handleNewAdminItemChange} placeholder="Enter new unique code" required />
                <small style={{ color: '#666' }}>Must be unique – check existing codes below.</small>
              </div>
              <div className="form-group">
                <label htmlFor="newAdmin_Item_Description">Item Description <span className="required">*</span></label>
                <input id="newAdmin_Item_Description" name="Item_Description" type="text" value={newAdminItem.Item_Description} onChange={handleNewAdminItemChange} maxLength="400" placeholder="Enter description" />
              </div>

              <div className="form-group">
                <label htmlFor="newAdmin_Uom_Code">
                  Unit of Measure (UOM) <span className="required">*</span>
                  {can('masterdata.create') && (
                    <button type="button" className="add-user-btn" onClick={() => setShowAddUom(true)} style={{ padding: '2px 10px', fontSize: '11px', marginLeft: '8px' }}>➕ Add</button>
                  )}
                </label>
                <select id="newAdmin_Uom_Code" name="Uom_Code" value={newAdminItem.Uom_Code} onChange={onUomChange} required>
                  <option value="">Select UOM</option>
                  {uomList.map(uom => (
                    <option key={uom.id} value={uom.code}>{uom.code} - {uom.description}</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label htmlFor="newAdmin_Gl_Class">
                  General Ledger Class <span className="required">*</span>
                  {can('masterdata.create') && (
                    <button type="button" className="add-user-btn" onClick={() => setShowAddGl(true)} style={{ padding: '2px 10px', fontSize: '11px', marginLeft: '8px' }}>➕ Add</button>
                  )}
                </label>
                <select id="newAdmin_Gl_Class" name="Gl_Class" value={newAdminItem.Gl_Class} onChange={onGlChange} required>
                  <option value="">Select GL</option>
                  {glList.map(gl => (
                    <option key={gl.id} value={gl.id}>{gl.number} - {gl.description}</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label htmlFor="newAdmin_Purchase_Class">
                  Purchase Class <span className="required">*</span>
                  {can('masterdata.create') && (
                    <button type="button" className="add-user-btn" onClick={() => setShowAddPurchaseClass(true)} style={{ padding: '2px 10px', fontSize: '11px', marginLeft: '8px' }}>➕ Add</button>
                  )}
                </label>
                <select id="newAdmin_Purchase_Class" name="Purchase_Class" value={newAdminItem.Purchase_Class} onChange={onPurchaseClassChange} required>
                  <option value="">Select Class</option>
                  {purchaseClassList.map(pc => (
                    <option key={pc.id} value={pc.name}>{pc.name}</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label htmlFor="newAdmin_Category">
                  Category <span className="required">*</span>
                  {can('masterdata.create') && (
                    <button type="button" className="add-user-btn" onClick={() => setShowAddCategory(true)} style={{ padding: '2px 10px', fontSize: '11px', marginLeft: '8px' }}>➕ Add</button>
                  )}
                </label>
                <select id="newAdmin_Category" name="Category" value={newAdminItem.Category} onChange={onCategoryChange} required>
                  <option value="">Select Category</option>
                  {categoryList.map(cat => (
                    <option key={cat.id} value={cat.name}>{cat.name}</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label htmlFor="newAdmin_List_Price_Per_Unit">List Price per Unit</label>
                <input id="newAdmin_List_Price_Per_Unit" name="List_Price_Per_Unit" type="number" step="0.0000000001" value={newAdminItem.List_Price_Per_Unit} onChange={handleNewAdminItemChange} min="0" />
              </div>

              <div className="form-group">
                <label htmlFor="newAdmin_Status">Status</label>
                <select id="newAdmin_Status" name="Status" value={newAdminItem.Status} onChange={handleNewAdminItemChange}>
                  <option value="Active">Active</option>
                  <option value="Inactive">Inactive</option>
                </select>
              </div>

              <div className="form-group">
                <label htmlFor="newAdmin_Creation_Date">Creation Date</label>
                <input id="newAdmin_Creation_Date" name="Creation_Date" type="date" value={newAdminItem.Creation_Date} onChange={handleNewAdminItemChange} />
              </div>

              <div className="form-group" style={{ gridColumn: 'span 2' }}>
                <label htmlFor="adminItemImageInput">Attach Item Image (optional, max 5MB)</label>
                <input id="adminItemImageInput" name="Item_Image" type="file" accept="image/*" onChange={handleImageChange} />
                {newAdminItemImagePreview && (
                  <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <img src={newAdminItemImagePreview} alt="Item preview" style={{ maxWidth: '100px', maxHeight: '100px', objectFit: 'contain', border: '1px solid #ddd', borderRadius: '4px' }} />
                    <button type="button" onClick={handleRemoveImage} className="cancel-btn" style={{ padding: '4px 12px' }}>Remove</button>
                  </div>
                )}
              </div>
            </div>

            <div className="barcode-section">
              <div className="barcode-preview">
                <div className="barcode-label">
                  <strong>Barcode Number:</strong> {newAdminItem.Barcode || 'Not generated'}
                </div>
                <div className="barcode-canvas-wrapper">
                  <canvas ref={barcodeCanvasRef} id="barcodeCanvas"></canvas>
                </div>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'center' }}>
                  <button className="generate-barcode-btn" onClick={generateBarcode} type="button" disabled={loading}>
                    🔄 Generate Barcode (BC-itemcode)
                  </button>
                  <button className="generate-barcode-btn" onClick={exportBarcodeImage} type="button" style={{ background: '#1a73e8', color: '#fff', borderColor: '#1a73e8' }} disabled={loading}>
                    📷 Export as Image
                  </button>
                </div>
                <small style={{ display: 'block', marginTop: '8px', color: '#666' }}>
                  Barcode will be generated as <strong>BC-{newAdminItem.Item_Code || 'itemcode'}</strong>
                </small>
              </div>
            </div>

            <div className="form-footer">
              <button className="cancel-btn" onClick={handleToggleCreateItemForm} disabled={loading}>Cancel</button>
              <button className="save-btn" onClick={handleSaveAdminItem} disabled={loading}>
                {loading ? '⏳ Saving...' : 'Create Item with Barcode'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Search */}
      <div className="dashboard-search-section">
        <div className="dashboard-filters">
          <div className="filter-row">
            <div className="filter-group search-group">
              <label htmlFor="itemMasterSearchLocal">Search</label>
              <input id="itemMasterSearchLocal" type="text" placeholder="Search by code, description, UOM, class, category..." value={itemMasterSearchTerm} onChange={(e) => setItemMasterSearchTerm(e.target.value)} className="filter-input" />
            </div>
            <div className="filter-group action-group">
              <button className="cancel-btn" onClick={() => { setItemMasterSearchTerm(''); setItemMasterCurrentPage(1); fetchItemMasters(1); }} style={{ padding: '8px 16px' }}>
                Clear Filters
              </button>
              <button className="add-user-btn" onClick={() => fetchItemMasters(itemMasterCurrentPage)} style={{ padding: '8px 16px' }}>
                Refresh
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ============================================
          Item Master Table — compact & clickable
          ============================================ */}
      <div className="table-wrapper">
        {itemMasterLoading ? (
          <div className="loading-spinner" style={{ margin: '20px auto' }}></div>
        ) : filteredRecords.length > 0 ? (
          <table className="data-table item-master-table">
            <thead>
              <tr>
                <th className="col-image">Image</th>
                <th className="col-code">Item Code</th>
                <th className="col-desc">Description</th>
                <th className="col-uom">UOM</th>
                <th className="col-gl">GL Class</th>
                <th className="col-pc">Purchase Class</th>
                <th className="col-barcode">Barcode</th>
                <th className="col-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredRecords.map(item => (
                <tr
                  key={item.Item_Code}
                  onClick={() => handleRowClick(item)}
                  className="clickable-row"
                >
                  <td className="col-image">
                    {item.Item_Image ? (
                      <img
                        src={item.Item_Image}
                        alt={item.Item_Code}
                        className="table-thumb"
                        loading="lazy"
                      />
                    ) : (
                      <span className="table-thumb-placeholder">📦</span>
                    )}
                  </td>
                  <td className="col-code">
                    <span className="warehouse-code" title={item.Item_Code}>
                      {item.Item_Code}
                    </span>
                  </td>
                  <td className="col-desc" title={item.Item_Description || ''}>
                    {item.Item_Description || '-'}
                  </td>
                  <td className="col-uom">{item.Uom_Code || '-'}</td>
                  <td className="col-gl">{item.Gl_Class || '-'}</td>
                  <td className="col-pc">{item.Purchase_Class || '-'}</td>
                  <td className="col-barcode">
                    {item.Barcode ? (
                      <img
                        src={generateBarcodeDataUrl(item.Barcode, 1.5, 30)}
                        alt="Barcode"
                        className="table-barcode-img"
                        loading="lazy"
                      />
                    ) : (
                      <span className="table-empty">—</span>
                    )}
                  </td>
                  <td className="col-actions">
                    <div className="action-buttons">
                      {can('itemmasters.edit') && (
                        <button
                          className="action-btn edit"
                          onClick={(e) => { e.stopPropagation(); handleEditMasterItem(item); }}
                        >
                          Edit
                        </button>
                      )}

                      {can('itemmasters.edit') && (
                        item.Status === 'Active' ? (
                          <button
                            className="action-btn deactivate-btn"
                            onClick={(e) => { e.stopPropagation(); handleToggleMasterStatus(item); }}
                          >
                            Deactivate
                          </button>
                        ) : (
                          <button
                            className="action-btn activate-btn"
                            onClick={(e) => { e.stopPropagation(); handleToggleMasterStatus(item); }}
                          >
                            Activate
                          </button>
                        )
                      )}

                      {can('itemmasters.delete') && (
                        <button
                          className="action-btn delete-btn"
                          onClick={(e) => { e.stopPropagation(); handleDeleteMasterItem(item); }}
                          title="Permanently delete this item"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="no-items-message"><p>No items found in the database.</p></div>
        )}
      </div>

      {/* Pagination */}
      {itemMasterTotalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: '10px', marginTop: '16px', alignItems: 'center' }}>
          <button onClick={() => setItemMasterCurrentPage(p => Math.max(1, p - 1))} disabled={itemMasterCurrentPage === 1 || itemMasterLoading} className="pagination-btn">◀ Prev</button>
          <span className="pagination-info">Page {itemMasterCurrentPage} of {itemMasterTotalPages} (Total: {itemMasterTotalCount} items)</span>
          <button onClick={() => setItemMasterCurrentPage(p => Math.min(itemMasterTotalPages, p + 1))} disabled={itemMasterCurrentPage === itemMasterTotalPages || itemMasterLoading} className="pagination-btn">Next ▶</button>
        </div>
      )}

      {/* Edit Modal — only shows if user has edit permission */}
      {can('itemmasters.edit') && showEditMasterModal && (
        <div className="modal-overlay" style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 9999 }}>
          <div className="modal-content" style={{ background: 'white', padding: '30px', borderRadius: '8px', maxWidth: '700px', width: '95%', maxHeight: '90vh', overflowY: 'auto' }}>
            <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px' }}>
              <h3>Edit Item: {editMasterData.Item_Code}</h3>
              <button className="close-form-btn" onClick={handleCloseEditMasterModal}>✕</button>
            </div>
            <div className="form-body" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <div className="form-group"><label>Item Code</label><input type="text" value={editMasterData.Item_Code} disabled style={{ background: '#f5f5f0' }} /></div>
              <div className="form-group"><label htmlFor="editMaster_Item_Description">Description <span className="required">*</span></label><input id="editMaster_Item_Description" name="Item_Description" type="text" value={editMasterData.Item_Description} onChange={handleEditMasterChange} maxLength="400" /></div>
              <div className="form-group"><label htmlFor="editMaster_Uom_Code">UOM <span className="required">*</span></label><select id="editMaster_Uom_Code" name="Uom_Code" value={editMasterData.Uom_Code} onChange={handleEditMasterChange}><option value="">Select UOM</option>{uomList.map(uom => (<option key={uom.id} value={uom.code}>{uom.code} - {uom.description}</option>))}</select></div>
              <div className="form-group"><label htmlFor="editMaster_Uom_Description">UOM Description</label><input id="editMaster_Uom_Description" name="Uom_Description" type="text" value={editMasterData.Uom_Description} onChange={handleEditMasterChange} /></div>
              <div className="form-group"><label htmlFor="editMaster_Gl_Class">GL Class <span className="required">*</span></label><select id="editMaster_Gl_Class" name="Gl_Class" value={editMasterData.Gl_Class} onChange={handleEditMasterChange}><option value="">Select GL</option>{glList.map(gl => (<option key={gl.id} value={gl.id}>{gl.number} - {gl.description}</option>))}</select></div>
              <div className="form-group"><label htmlFor="editMaster_Gl_Description">GL Description</label><input id="editMaster_Gl_Description" name="Gl_Description" type="text" value={editMasterData.Gl_Description} onChange={handleEditMasterChange} /></div>
              <div className="form-group"><label htmlFor="editMaster_Purchase_Class">Purchase Class <span className="required">*</span></label><select id="editMaster_Purchase_Class" name="Purchase_Class" value={editMasterData.Purchase_Class} onChange={handleEditMasterChange}><option value="">Select Class</option>{purchaseClassList.map(pc => (<option key={pc.id} value={pc.name}>{pc.name}</option>))}</select></div>
              <div className="form-group"><label htmlFor="editMaster_Category">Category <span className="required">*</span></label><select id="editMaster_Category" name="Category" value={editMasterData.Category} onChange={handleEditMasterChange}><option value="">Select Category</option>{categoryList.map(cat => (<option key={cat.id} value={cat.name}>{cat.name}</option>))}</select></div>
              <div className="form-group"><label htmlFor="editMaster_List_Price_Per_Unit">List Price</label><input id="editMaster_List_Price_Per_Unit" name="List_Price_Per_Unit" type="number" step="0.0000000001" value={editMasterData.List_Price_Per_Unit} onChange={handleEditMasterChange} min="0" /></div>
              <div className="form-group"><label htmlFor="editMaster_Status">Status</label><select id="editMaster_Status" name="Status" value={editMasterData.Status} onChange={handleEditMasterChange}><option value="Active">Active</option><option value="Inactive">Inactive</option></select></div>
              <div className="form-group"><label htmlFor="editMaster_Creation_Date">Creation Date</label><input id="editMaster_Creation_Date" name="Creation_Date" type="date" value={editMasterData.Creation_Date} onChange={handleEditMasterChange} /></div>
              <div className="form-group"><label>Barcode</label><input type="text" value={editMasterData.Barcode} disabled style={{ background: '#f5f5f0' }} /></div>

              <div className="form-group" style={{ gridColumn: 'span 2' }}>
                <label htmlFor="editMasterImageInput">Item Image (max 5MB)</label>
                <input id="editMasterImageInput" type="file" accept="image/*" onChange={handleEditMasterImageChange} />
                {editMasterImagePreview && (
                  <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <img src={editMasterImagePreview} alt="Item preview" style={{ maxWidth: '100px', maxHeight: '100px', objectFit: 'contain', border: '1px solid #ddd', borderRadius: '4px' }} />
                    <button type="button" onClick={handleRemoveEditMasterImage} className="cancel-btn" style={{ padding: '4px 12px' }}>Remove Image</button>
                  </div>
                )}
              </div>
            </div>
            <div className="form-footer" style={{ marginTop: '20px', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button className="cancel-btn" onClick={handleCloseEditMasterModal}>Cancel</button>
              <button className="save-btn" onClick={handleUpdateMasterItem} disabled={loading}>{loading ? 'Saving...' : 'Update'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Detail Modal — always available (view only) */}
      {showDetailModal && detailItem && (
        <div className="modal-overlay" style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.6)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 10000, backdropFilter: 'blur(2px)' }}>
          <div className="modal-content" style={{ background: 'white', padding: '30px', borderRadius: '12px', maxWidth: '800px', width: '95%', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 10px 30px rgba(0,0,0,0.2)' }}>
            <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', borderBottom: '1px solid #eee', paddingBottom: '10px' }}>
              <h3 style={{ margin: 0 }}>Item Details – {detailItem.Item_Code}</h3>
              <button className="close-form-btn" onClick={closeDetailAndRefocus} style={{ fontSize: '24px' }}>✕</button>
            </div>
            {detailItem.Item_Image && (
              <div style={{ textAlign: 'center', marginBottom: '20px' }}>
                <img src={detailItem.Item_Image} alt={detailItem.Item_Code} style={{ maxWidth: '200px', maxHeight: '200px', objectFit: 'contain', border: '1px solid #ddd', borderRadius: '8px' }} />
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 20px' }}>
              <div><strong>Item Code:</strong> {detailItem.Item_Code}</div>
              <div><strong>Description:</strong> {detailItem.Item_Description || '-'}</div>
              <div><strong>UOM Code:</strong> {detailItem.Uom_Code || '-'}</div>
              <div><strong>UOM Description:</strong> {detailItem.Uom_Description || '-'}</div>
              <div><strong>GL Class:</strong> {detailItem.Gl_Class || '-'}</div>
              <div><strong>GL Description:</strong> {detailItem.Gl_Description || '-'}</div>
              <div><strong>Purchase Class:</strong> {detailItem.Purchase_Class || '-'}</div>
              <div><strong>Category:</strong> {detailItem.Category || '-'}</div>
              <div><strong>List Price:</strong> ₱{Number(detailItem.List_Price_Per_Unit || 0).toFixed(2)}</div>
              <div><strong>Status:</strong> <span className={`status-badge ${(detailItem.Status || 'Active').toLowerCase()}`}>{detailItem.Status || 'Active'}</span></div>
              <div><strong>Creation Date:</strong> {detailItem.Creation_Date ? new Date(detailItem.Creation_Date).toLocaleDateString() : '-'}</div>
              <div><strong>Barcode Number:</strong> {detailItem.Barcode || '-'}</div>
            </div>
            <div style={{ marginTop: '25px', textAlign: 'center', borderTop: '1px solid #eee', paddingTop: '20px' }}>
              <h4 style={{ marginBottom: '12px' }}>Barcode (Scan Me)</h4>
              {detailItem.Barcode ? (
                <div style={{ background: '#fff', padding: '15px', display: 'inline-block', borderRadius: '8px', boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}>
                  <img src={generateBarcodeDataUrl(detailItem.Barcode, 4, 120)} alt="Barcode" style={{ display: 'block', maxWidth: '100%', height: 'auto' }} />
                  <div style={{ marginTop: '8px', fontSize: '18px', fontFamily: 'monospace', letterSpacing: '2px' }}>{detailItem.Barcode}</div>
                </div>
              ) : (
                <div>No barcode assigned</div>
              )}
            </div>
            <div className="form-footer" style={{ marginTop: '25px', display: 'flex', justifyContent: 'flex-end' }}>
              <button className="cancel-btn" onClick={closeDetailAndRefocus}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Add Modals — only for users with masterdata.create */}
      {can('masterdata.create') && renderAddModal(showAddUom, setShowAddUom, 'Add New UOM', [{ label: 'UOM Code', name: 'code', placeholder: 'e.g., PCS' }, { label: 'UOM Description', name: 'description', placeholder: 'e.g., Pieces' }], handleSaveUom, handleCloseUomForm, handleNewUomChange, newUom)}
      {can('masterdata.create') && renderAddModal(showAddGl, setShowAddGl, 'Add New GL Class', [{ label: 'GL Number', name: 'number', placeholder: 'e.g., 62010' }, { label: 'GL Description', name: 'description', placeholder: 'Description' }], handleSaveGl, handleCloseGlForm, handleNewGlChange, newGl)}
      {can('masterdata.create') && renderAddModal(showAddPurchaseClass, setShowAddPurchaseClass, 'Add New Purchase Class', [{ label: 'Class Name', name: 'name', placeholder: 'e.g., E' }], handleSavePurchaseClass, handleClosePurchaseClassForm, handleNewPurchaseClassChange, newPurchaseClass)}
      {can('masterdata.create') && renderAddModal(showAddCategory, setShowAddCategory, 'Add New Category', [{ label: 'Category Name', name: 'name', placeholder: 'e.g., Raw Materials' }], handleSaveCategory, handleCloseCategoryForm, handleNewCategoryChange, newCategory)}
    </div>
  );
};

export default TabItemMasters;