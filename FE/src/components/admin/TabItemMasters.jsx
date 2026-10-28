// src/components/admin/TabItemMasters.jsx
import React, { useEffect, useRef, useState } from 'react';
import {
  FiPackage,
  FiPlus,
  FiX,
  FiSearch,
  FiCheckCircle,
  FiXCircle,
  FiLoader,
  FiRefreshCw,
  FiDownload,
  FiSliders,
  FiInfo,
  FiChevronDown,
  FiChevronUp,
  FiEdit2,
  FiLock,
  FiUnlock,
  FiTrash2,
} from 'react-icons/fi';
import { usePermissions } from '../../permissions/usePermissions';
import { itemMasterApi } from '../../services/api';
import ActionsMenu from '../shared/ActionsMenu';
import { buttonCss } from '../shared/buttonStyles';
import { useRefreshOnFocus } from '../../hooks/useRefreshOnFocus';

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
    // Column filters
    itemMasterGlFilter,
    setItemMasterGlFilter,
    itemMasterPurchaseClassFilter,
    setItemMasterPurchaseClassFilter,
    itemMasterCategoryFilter,
    setItemMasterCategoryFilter,
    itemMasterFilterOptions,
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

  const [localBarcode, setLocalBarcode] = useState('');
  const [scanFeedback, setScanFeedback] = useState(null);
  const [showBarcodeHint, setShowBarcodeHint] = useState(false);
  const barcodeInputRefLocal = useRef(null);

  useEffect(() => {
    fetchItemMasters(itemMasterCurrentPage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    itemMasterCurrentPage,
    itemMasterSearchTerm,
    itemMasterGlFilter,
    itemMasterPurchaseClassFilter,
    itemMasterCategoryFilter,
  ]);

  // Session 10 (G5): silent refresh when the browser tab regains focus.
  // Re-runs the same fetch the tab already uses on mount / filter change,
  // so an admin returning to the tab sees fresh item-master rows without
  // having to press Refresh.
  useRefreshOnFocus(() => {
    fetchItemMasters(itemMasterCurrentPage);
  });

  const closeDetailAndRefocus = () => {
    handleCloseDetailModal();
    setTimeout(() => {
      if (barcodeInputRefLocal.current) barcodeInputRefLocal.current.focus();
    }, 120);
  };

  const handleScanBarcode = async () => {
    const value = localBarcode.trim();
    if (!value) {
      setScanFeedback('error');
      setTimeout(() => setScanFeedback(null), 1600);
      return;
    }

    setScanFeedback('scanning');

    let found =
      itemMasterRecords.find((it) => it.Barcode === value) ||
      itemMasterRecords.find((it) => it.Item_Code === value) ||
      null;

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

  // ============================================================
  // Session 11 — Fix #2: removed the client-side re-filter.
  // The backend (see useAdminData.fetchItemMasters) already ANDs
  // search + GL + Purchase Class + Category into one WHERE clause.
  // A second pass in the browser with different field rules could
  // silently drop rows the server matched (e.g. Barcode hits that
  // the client filter does not check). We now trust the server.
  // ============================================================

  const glActive = itemMasterGlFilter !== 'All';
  const pcActive = itemMasterPurchaseClassFilter !== 'All';
  const catActive = itemMasterCategoryFilter !== 'All';
  const searchActive = !!itemMasterSearchTerm;

  const activeFilterCount =
    (searchActive ? 1 : 0) +
    (glActive ? 1 : 0) +
    (pcActive ? 1 : 0) +
    (catActive ? 1 : 0);

  const hasActiveFilters = activeFilterCount > 0;

  const handleClearFilters = () => {
    setItemMasterSearchTerm('');
    setItemMasterGlFilter('All');
    setItemMasterPurchaseClassFilter('All');
    setItemMasterCategoryFilter('All');
    setItemMasterCurrentPage(1);
  };

  const renderAddModal = (show, setShow, title, fields, onSave, onClose, onFieldChange, state) => {
    if (!show) return null;
    return (
      <div className="item-master-modal-overlay">
        <div className="item-master-modal item-master-modal--sm">
          <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <h4 style={{ margin: 0 }}>{title}</h4>
            <button className="close-form-btn" onClick={onClose} type="button" aria-label="Close"><FiX /></button>
          </div>
          <div className="form-body item-master-form-grid item-master-form-grid--single">
            {fields.map((field, idx) => (
              <div className="form-group" key={idx}>
                <label>{field.label} <span className="required">*</span></label>
                <input type="text" name={field.name} value={state[field.name] || ''} onChange={onFieldChange} placeholder={field.placeholder} />
              </div>
            ))}
          </div>
          <div className="form-footer">
            <button className="ui-btn ui-btn-secondary" onClick={onClose} type="button">Cancel</button>
            <button className="ui-btn ui-btn-primary" onClick={onSave} type="button">Save</button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="items-section">
      <style>{buttonCss}</style>
      <style>{tabItemMastersIconCss}</style>

      {/* ============================================================
          SECTION HEADER
         ============================================================ */}
      <div className="section-header item-master-section-header">
        <h3>
          <FiPackage className="section-heading-icon" />
          Item Masters (Database)
        </h3>
        <div className="header-actions item-master-header-actions">
          <span className="item-count">Total: {itemMasterTotalCount} items</span>

          <button
            className="ui-btn ui-btn-secondary"
            onClick={() => fetchItemMasters(itemMasterCurrentPage)}
            type="button"
            disabled={itemMasterLoading}
          >
            <FiRefreshCw className={`btn-icon${itemMasterLoading ? ' icon-spin' : ''}`} />
            <span>{itemMasterLoading ? 'Loading…' : 'Refresh'}</span>
          </button>

          {can('itemmasters.create') && (
            <button className="ui-btn ui-btn-primary" onClick={handleToggleCreateItemForm} disabled={loading} type="button">
              {loading ? (
                <>
                  <FiLoader className="icon-spin btn-icon" />
                  <span>Saving...</span>
                </>
              ) : showCreateItemForm ? (
                <>
                  <FiX className="btn-icon" />
                  <span>Close Form</span>
                </>
              ) : (
                <>
                  <FiPlus className="btn-icon" />
                  <span>Create Item with Barcode</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* ============================================================
          BARCODE SCANNER
         ============================================================ */}
      <div className="dashboard-search-section">
        <div className="dashboard-filters">
          <div className="filter-row">
            <div className="filter-group item-master-barcode-group">
              <label
                htmlFor="barcodeSearchInput"
                className="label-with-icon"
                style={{
                  fontSize: '22px',
                  fontWeight: 800,
                  color: '#0f172a',
                  letterSpacing: '-0.01em',
                  lineHeight: 1.2,
                }}
              >
                <FiSearch className="label-icon" />
                <span style={{ fontSize: 'inherit', fontWeight: 'inherit', color: 'inherit' }}>
                  Scan or type barcode
                </span>
              </label>
              <div className="item-master-barcode-row">
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
                  className="filter-input item-master-barcode-input"
                  autoFocus
                  autoComplete="off"
                  spellCheck={false}
                />
                <button
                  type="button"
                  className="ui-btn ui-btn-primary item-master-barcode-btn"
                  onClick={handleScanBarcode}
                  title="Look up the entered barcode"
                >
                  <FiSearch className="btn-icon" />
                  <span>Scan</span>
                </button>
              </div>

              {scanFeedback && (
                <div
                  className="scan-feedback"
                  style={{
                    marginTop: 8,
                    fontSize: 14,
                    fontWeight: 700,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                    color:
                      scanFeedback === 'ok'      ? '#047857' :
                      scanFeedback === 'error'   ? '#b91c1c' :
                                                   '#334155',
                  }}
                >
                  {scanFeedback === 'ok'       && (<><FiCheckCircle className="feedback-icon" /><span>Found — opening item details</span></>)}
                  {scanFeedback === 'error'    && (<><FiXCircle className="feedback-icon" /><span>No item matched that barcode</span></>)}
                  {scanFeedback === 'scanning' && (<><FiLoader className="feedback-icon icon-spin" /><span>Looking up…</span></>)}
                </div>
              )}

              {/* Collapsible "Know more" toggle for the scanner hint */}
              <button
                type="button"
                className={`imh-info-toggle${showBarcodeHint ? ' is-open' : ''}`}
                onClick={() => setShowBarcodeHint((s) => !s)}
                aria-expanded={showBarcodeHint}
                aria-controls="barcode-hint-panel"
              >
                <FiInfo className="imh-info-toggle-icon" aria-hidden="true" />
                <span>Know more</span>
                {showBarcodeHint
                  ? <FiChevronUp className="imh-info-toggle-caret" aria-hidden="true" />
                  : <FiChevronDown className="imh-info-toggle-caret" aria-hidden="true" />}
              </button>

              {showBarcodeHint && (
                <div id="barcode-hint-panel" className="imh-info-panel">
                  <small className="item-master-barcode-hint">
                    Hardware scanners work by typing BC-"itemcode" then pressing Enter — the lookup fires automatically.
                  </small>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ============================================================
          ITEM MASTER FILTER BAR
         ============================================================ */}
      <div className="dashboard-search-section item-master-filters-section">
        <div className="item-master-filter-bar">

          {/* Search field with inline magnifier */}
          <div className="imf-search">
            <FiSearch className="imf-search-icon" aria-hidden="true" />
            <input
              id="itemMasterSearchLocal"
              type="text"
              placeholder="Search code, description, UOM, class, category..."
              value={itemMasterSearchTerm}
              onChange={(e) => {
                setItemMasterSearchTerm(e.target.value);
                setItemMasterCurrentPage(1);
              }}
              autoComplete="off"
              spellCheck={false}
            />
            {searchActive && (
              <button
                type="button"
                className="imf-search-clear"
                onClick={() => {
                  setItemMasterSearchTerm('');
                  setItemMasterCurrentPage(1);
                }}
                aria-label="Clear search"
                title="Clear search"
              >
                <FiX />
              </button>
            )}
          </div>

          {/* GL Class — chip dropdown */}
          <div className={`imf-select-wrap${glActive ? ' is-active' : ''}`}>
            <span className="imf-dot" aria-hidden="true" />
            <select
              id="itemMasterGlFilter"
              value={itemMasterGlFilter}
              onChange={(e) => {
                setItemMasterGlFilter(e.target.value);
                setItemMasterCurrentPage(1);
              }}
              aria-label="Filter by GL Class"
            >
              <option value="All">GL: All</option>
              {itemMasterFilterOptions.gl_classes.map((gl) => (
                <option key={gl.value} value={gl.value}>GL: {gl.label}</option>
              ))}
            </select>
          </div>

          {/* Purchase Class — chip dropdown */}
          <div className={`imf-select-wrap${pcActive ? ' is-active' : ''}`}>
            <span className="imf-dot" aria-hidden="true" />
            <select
              id="itemMasterPurchaseClassFilter"
              value={itemMasterPurchaseClassFilter}
              onChange={(e) => {
                setItemMasterPurchaseClassFilter(e.target.value);
                setItemMasterCurrentPage(1);
              }}
              aria-label="Filter by Purchase Class"
            >
              <option value="All">PC: All</option>
              {itemMasterFilterOptions.purchase_classes.map((pc) => (
                <option key={pc} value={pc}>PC: {pc}</option>
              ))}
            </select>
          </div>

          {/* Category — chip dropdown */}
          <div className={`imf-select-wrap${catActive ? ' is-active' : ''}`}>
            <span className="imf-dot" aria-hidden="true" />
            <select
              id="itemMasterCategoryFilter"
              value={itemMasterCategoryFilter}
              onChange={(e) => {
                setItemMasterCategoryFilter(e.target.value);
                setItemMasterCurrentPage(1);
              }}
              aria-label="Filter by Category"
            >
              <option value="All">Cat: All</option>
              {itemMasterFilterOptions.categories.map((cat) => (
                <option key={cat} value={cat}>Cat: {cat}</option>
              ))}
            </select>
          </div>

          {/* Active-filters pill */}
          {hasActiveFilters && (
            <button
              type="button"
              className="imf-clear-pill"
              onClick={handleClearFilters}
              title="Clear all filters"
            >
              <FiSliders className="imf-clear-icon" aria-hidden="true" />
              <span className="imf-clear-count">
                {activeFilterCount} filter{activeFilterCount === 1 ? '' : 's'}
              </span>
              <span className="imf-clear-sep" aria-hidden="true">·</span>
              <span className="imf-clear-cta">Clear</span>
              <FiX className="imf-clear-x" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      {/* ============================================================
          CREATE ITEM FORM
         ============================================================ */}
      {can('itemmasters.create') && showCreateItemForm && (
        <div className="create-item-form-container">
          <div className="add-user-form">
            <div className="form-header">
              <h4>Create New Item with Barcode (item_master)</h4>
              <button className="close-form-btn" onClick={handleToggleCreateItemForm} type="button" aria-label="Close"><FiX /></button>
            </div>
            <div className="form-body">
              <div className="form-group">
                <label htmlFor="newAdmin_Item_Code">Item Code <span className="required">*</span></label>
                <input id="newAdmin_Item_Code" name="Item_Code" type="text" value={newAdminItem.Item_Code} onChange={handleNewAdminItemChange} placeholder="Enter new unique code" required />
                <small style={{ color: '#475569', fontSize: 13.5 }}>Must be unique – check existing codes below.</small>
              </div>
              <div className="form-group">
                <label htmlFor="newAdmin_Item_Description">Item Description <span className="required">*</span></label>
                <input id="newAdmin_Item_Description" name="Item_Description" type="text" value={newAdminItem.Item_Description} onChange={handleNewAdminItemChange} maxLength="400" placeholder="Enter description" />
              </div>

              <div className="form-group">
                <label htmlFor="newAdmin_Uom_Code">
                  Unit of Measure (UOM) <span className="required">*</span>
                  {can('masterdata.create') && (
                    <button type="button" className="ui-btn ui-btn-primary ui-btn-xs" onClick={() => setShowAddUom(true)} style={{ marginLeft: '8px' }}>
                      <FiPlus className="btn-icon" /><span>Add</span>
                    </button>
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
                    <button type="button" className="ui-btn ui-btn-primary ui-btn-xs" onClick={() => setShowAddGl(true)} style={{ marginLeft: '8px' }}>
                      <FiPlus className="btn-icon" /><span>Add</span>
                    </button>
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
                    <button type="button" className="ui-btn ui-btn-primary ui-btn-xs" onClick={() => setShowAddPurchaseClass(true)} style={{ marginLeft: '8px' }}>
                      <FiPlus className="btn-icon" /><span>Add</span>
                    </button>
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
                    <button type="button" className="ui-btn ui-btn-primary ui-btn-xs" onClick={() => setShowAddCategory(true)} style={{ marginLeft: '8px' }}>
                      <FiPlus className="btn-icon" /><span>Add</span>
                    </button>
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

              <div className="form-group form-group--full">
                <label htmlFor="adminItemImageInput">Attach Item Image (optional, max 5MB)</label>
                <input id="adminItemImageInput" name="Item_Image" type="file" accept="image/*" onChange={handleImageChange} />
                {newAdminItemImagePreview && (
                  <div className="item-master-image-preview">
                    <img src={newAdminItemImagePreview} alt="Item preview" />
                    <button type="button" onClick={handleRemoveImage} className="ui-btn ui-btn-secondary ui-btn-xs">Remove</button>
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
                <div className="item-master-barcode-actions">
                  <button className="ui-btn ui-btn-primary ui-btn-sm" onClick={generateBarcode} type="button" disabled={loading}>
                    <FiRefreshCw className="btn-icon" />
                    <span>Generate Barcode (BC-itemcode)</span>
                  </button>
                  <button className="ui-btn ui-btn-edit ui-btn-sm" onClick={exportBarcodeImage} type="button" disabled={loading}>
                    <FiDownload className="btn-icon" />
                    <span>Export as Image</span>
                  </button>
                </div>
                <small style={{ display: 'block', marginTop: '10px', color: '#475569', fontSize: 13.5 }}>
                  Barcode will be generated as <strong>BC-{newAdminItem.Item_Code || 'itemcode'}</strong>
                </small>
              </div>
            </div>

            <div className="form-footer">
              <button className="ui-btn ui-btn-secondary" onClick={handleToggleCreateItemForm} disabled={loading}>Cancel</button>
              <button className="ui-btn ui-btn-primary" onClick={handleSaveAdminItem} disabled={loading}>
                {loading ? (
                  <>
                    <FiLoader className="btn-icon icon-spin" />
                    <span>Saving...</span>
                  </>
                ) : (
                  <span>Create Item with Barcode</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================
          TABLE
         ============================================================ */}
      <div className="table-wrapper item-master-table-wrapper">
        {itemMasterLoading ? (
          <div className="loading-spinner" style={{ margin: '20px auto' }}></div>
        ) : itemMasterRecords.length > 0 ? (
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
              {itemMasterRecords.map(item => {
                const isActive = item.Status === 'Active';

                const menuItems = [
                  can('itemmasters.edit') && {
                    key: 'edit',
                    label: 'Edit',
                    icon: <FiEdit2 />,
                    onClick: () => handleEditMasterItem(item),
                  },
                  can('itemmasters.edit') && {
                    key: 'toggle',
                    label: isActive ? 'Deactivate' : 'Activate',
                    icon: isActive ? <FiLock /> : <FiUnlock />,
                    onClick: () => handleToggleMasterStatus(item),
                    variant: isActive ? 'muted' : 'success',
                  },
                  can('itemmasters.delete') && {
                    key: 'delete',
                    label: 'Delete',
                    icon: <FiTrash2 />,
                    onClick: () => handleDeleteMasterItem(item),
                    variant: 'danger',
                    dividerBefore: true,
                  },
                ].filter(Boolean);

                return (
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
                        <span className="table-thumb-placeholder"><FiPackage /></span>
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
                      {menuItems.length > 0 && (
                        <div className="action-buttons action-buttons--kebab">
                          <ActionsMenu
                            items={menuItems}
                            ariaLabel={`Actions for ${item.Item_Code}`}
                          />
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <div className="no-items-message">
            <p>
              {hasActiveFilters
                ? 'No items match the current filters.'
                : 'No items found in the database.'}
            </p>
          </div>
        )}
      </div>

      {/* ============================================================
          PAGINATION
         ============================================================ */}
      {itemMasterTotalPages > 1 && (
        <div className="item-master-pagination">
          <button
            onClick={() => setItemMasterCurrentPage(p => Math.max(1, p - 1))}
            disabled={itemMasterCurrentPage === 1 || itemMasterLoading}
            className="ui-btn ui-btn-secondary ui-btn-sm"
            type="button"
          >
            Prev
          </button>
          <span className="pagination-info">
            Page {itemMasterCurrentPage} of {itemMasterTotalPages} (Total: {itemMasterTotalCount} items)
          </span>
          <button
            onClick={() => setItemMasterCurrentPage(p => Math.min(itemMasterTotalPages, p + 1))}
            disabled={itemMasterCurrentPage === itemMasterTotalPages || itemMasterLoading}
            className="ui-btn ui-btn-secondary ui-btn-sm"
            type="button"
          >
            Next
          </button>
        </div>
      )}

      {/* ============================================================
          EDIT MODAL
         ============================================================ */}
      {can('itemmasters.edit') && showEditMasterModal && (
        <div className="item-master-modal-overlay">
          <div className="item-master-modal item-master-modal--md">
            <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h3 style={{ margin: 0 }}>Edit Item: {editMasterData.Item_Code}</h3>
              <button className="close-form-btn" onClick={handleCloseEditMasterModal} type="button" aria-label="Close"><FiX /></button>
            </div>

            <div className="item-master-form-grid">
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

              <div className="form-group form-group--full">
                <label htmlFor="editMasterImageInput">Item Image (max 5MB)</label>
                <input id="editMasterImageInput" type="file" accept="image/*" onChange={handleEditMasterImageChange} />
                {editMasterImagePreview && (
                  <div className="item-master-image-preview">
                    <img src={editMasterImagePreview} alt="Item preview" />
                    <button type="button" onClick={handleRemoveEditMasterImage} className="ui-btn ui-btn-secondary ui-btn-xs">Remove Image</button>
                  </div>
                )}
              </div>
            </div>

            <div className="form-footer item-master-modal-footer">
              <button className="ui-btn ui-btn-secondary" onClick={handleCloseEditMasterModal} type="button">Cancel</button>
              <button className="ui-btn ui-btn-primary" onClick={handleUpdateMasterItem} disabled={loading} type="button">
                {loading ? 'Saving...' : 'Update'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================
          DETAIL MODAL
         ============================================================ */}
      {showDetailModal && detailItem && (
        <div className="item-master-modal-overlay item-master-modal-overlay--dark">
          <div className="item-master-modal item-master-modal--lg">
            <div className="modal-header item-master-modal-header-bar">
              <h3>Item Details – {detailItem.Item_Code}</h3>
              <button className="close-form-btn" onClick={closeDetailAndRefocus} type="button" aria-label="Close"><FiX /></button>
            </div>

            {detailItem.Item_Image && (
              <div className="item-master-detail-image">
                <img src={detailItem.Item_Image} alt={detailItem.Item_Code} />
              </div>
            )}

            <div className="item-master-detail-grid">
              <div><strong>Item Code:</strong> {detailItem.Item_Code}</div>
              <div><strong>Description:</strong> {detailItem.Item_Description || '-'}</div>
              <div><strong>UOM Code:</strong> {detailItem.Uom_Code || '-'}</div>
              <div><strong>UOM Description:</strong> {detailItem.Uom_Description || '-'}</div>
              <div><strong>GL Class:</strong> {detailItem.Gl_Class || '-'}</div>
              <div><strong>GL Description:</strong> {detailItem.Gl_Description || '-'}</div>
              <div><strong>Purchase Class:</strong> {detailItem.Purchase_Class || '-'}</div>
              <div><strong>Category:</strong> {detailItem.Category || '-'}</div>
              <div><strong>List Price:</strong> ₱{Number(detailItem.List_Price_Per_Unit || 0).toFixed(2)}</div>
              <div>
                <strong>Status:</strong>{' '}
                <span className={`status-badge ${(detailItem.Status || 'Active').toLowerCase()}`}>
                  {detailItem.Status || 'Active'}
                </span>
              </div>
              <div><strong>Creation Date:</strong> {detailItem.Creation_Date ? new Date(detailItem.Creation_Date).toLocaleDateString() : '-'}</div>
              <div><strong>Barcode Number:</strong> {detailItem.Barcode || '-'}</div>
            </div>

            <div className="item-master-detail-barcode">
              <h4>Barcode (Scan Me)</h4>
              {detailItem.Barcode ? (
                <div className="item-master-detail-barcode-card">
                  <img src={generateBarcodeDataUrl(detailItem.Barcode, 4, 120)} alt="Barcode" />
                  <div className="item-master-detail-barcode-code">{detailItem.Barcode}</div>
                </div>
              ) : (
                <div className="item-master-detail-barcode-empty">No barcode assigned</div>
              )}
            </div>

            <div className="form-footer item-master-modal-footer">
              <button className="ui-btn ui-btn-secondary" onClick={closeDetailAndRefocus} type="button">Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Add Modals */}
      {can('masterdata.create') && renderAddModal(showAddUom, setShowAddUom, 'Add New UOM', [{ label: 'UOM Code', name: 'code', placeholder: 'e.g., PCS' }, { label: 'UOM Description', name: 'description', placeholder: 'e.g., Pieces' }], handleSaveUom, handleCloseUomForm, handleNewUomChange, newUom)}
      {can('masterdata.create') && renderAddModal(showAddGl, setShowAddGl, 'Add New GL Class', [{ label: 'GL Number', name: 'number', placeholder: 'e.g., 62010' }, { label: 'GL Description', name: 'description', placeholder: 'Description' }], handleSaveGl, handleCloseGlForm, handleNewGlChange, newGl)}
      {can('masterdata.create') && renderAddModal(showAddPurchaseClass, setShowAddPurchaseClass, 'Add New Purchase Class', [{ label: 'Class Name', name: 'name', placeholder: 'e.g., E' }], handleSavePurchaseClass, handleClosePurchaseClassForm, handleNewPurchaseClassChange, newPurchaseClass)}
      {can('masterdata.create') && renderAddModal(showAddCategory, setShowAddCategory, 'Add New Category', [{ label: 'Category Name', name: 'name', placeholder: 'e.g., Raw Materials' }], handleSaveCategory, handleCloseCategoryForm, handleNewCategoryChange, newCategory)}
    </div>
  );
};

export default TabItemMasters;

// ============================================================
// Styles — with collapsible "Know more" for the scanner hint
// ============================================================
const tabItemMastersIconCss = `
/* ============================================================
   ICONS
   ============================================================ */
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

/* ---- "Scan or type barcode" — enlarged ---- */
.label-with-icon {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  color: #0f172a;
  font-size: 24px;
  font-weight: 800;
  letter-spacing: -0.01em;
  line-height: 1.25;
}
.label-with-icon span {
  font-size: inherit;
  font-weight: inherit;
  color: inherit;
}
.label-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.15em;
  height: 1.15em;
  color: #0f172a;
  stroke-width: 2.6;
}
.label-icon svg { width: 100%; height: 100%; }

.section-heading-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.1em;
  height: 1.1em;
  margin-right: 10px;
  vertical-align: -0.15em;
  color: #0f172a;
}
.section-heading-icon svg { width: 100%; height: 100%; stroke-width: 2.4; }

.feedback-icon {
  display: inline-flex;
  width: 1.15em;
  height: 1.15em;
  flex-shrink: 0;
}
.feedback-icon svg { width: 100%; height: 100%; stroke-width: 2.6; }

.close-form-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #334155;
  width: 36px;
  height: 36px;
  border-radius: 8px;
  transition: background 0.15s ease, color 0.15s ease;
  flex-shrink: 0;
}
.close-form-btn svg {
  width: 1.15em;
  height: 1.15em;
  stroke-width: 2.6;
}
.close-form-btn:hover { background: #f1f5f9; color: #0f172a; }

.table-thumb-placeholder svg {
  width: 1em;
  height: 1em;
  stroke-width: 1.5;
  color: #94a3b8;
}

.icon-spin { animation: tabImSpin 0.9s linear infinite; }
@keyframes tabImSpin { to { transform: rotate(360deg); } }

/* ============================================================
   ACTIONS CELL — kebab
   ============================================================ */
.action-buttons--kebab {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 6px;
}

/* ============================================================
   ITEMS SECTION
   ============================================================ */
.items-section {
  overflow-x: hidden;
  min-width: 0;
  max-width: 100%;
}

/* ============================================================
   SECTION HEADER
   ============================================================ */
.item-master-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 14px;
  margin-bottom: 20px;
}
.item-master-section-header h3 {
  display: inline-flex;
  align-items: center;
  margin: 0;
  min-width: 0;
  color: #0f172a;
  font-size: 24px;
  font-weight: 800;
  letter-spacing: -0.01em;
  line-height: 1.2;
}

.item-master-header-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  justify-content: flex-end;
  min-width: 0;
}
.item-master-header-actions .item-count {
  font-size: 16px;
  color: #1e293b;
  font-weight: 700;
  white-space: nowrap;
}

/* ============================================================
   BARCODE SCANNER
   ============================================================ */
.item-master-barcode-group {
  flex: 1 1 100% !important;
  max-width: 100%;
  min-width: 0;
}
.item-master-barcode-row {
  display: flex;
  gap: 10px;
  align-items: stretch;
  width: 100%;
  min-width: 0;
}

.item-master-barcode-input {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 22px;
  font-family: inherit;
  color: #0f172a;
  font-weight: 500;
  padding: 14px 16px !important;
  height: auto !important;
  min-height: 56px;
}
.item-master-barcode-input::placeholder {
  color: #64748b;
  opacity: 1;
  font-weight: 500;
}

.item-master-barcode-btn {
  flex: 0 0 auto;
  white-space: nowrap;
  font-size: 16px !important;
  min-height: 56px;
  padding: 0 28px;
}

/* ---- Collapsible "Know more" toggle ---- */
.imh-info-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  align-self: flex-start;
  width: fit-content;
  max-width: 100%;
  margin-top: 12px;
  padding: 8px 16px;
  border-radius: 999px;
  border: 1.5px solid #99f6e4;
  background: #f0fdfa;
  color: #0f766e;
  font-family: inherit;
  font-size: 15px;
  font-weight: 800;
  letter-spacing: 0.005em;
  line-height: 1.3;
  cursor: pointer;
  white-space: nowrap;
  transition:
    background 0.15s ease,
    border-color 0.15s ease,
    color 0.15s ease;
}
.imh-info-toggle:hover {
  background: #ccfbf1;
  border-color: #5eead4;
  color: #0d5f58;
}
.imh-info-toggle.is-open {
  background: #ffffff;
  border-color: #cbd5e1;
  color: #334155;
}
.imh-info-toggle.is-open:hover {
  background: #f8fafc;
  border-color: #94a3b8;
}
.imh-info-toggle:focus-visible {
  outline: 2px solid #00b8b0;
  outline-offset: 2px;
}
.imh-info-toggle-icon {
  width: 1.1em;
  height: 1.1em;
  stroke-width: 2.4;
  flex-shrink: 0;
}
.imh-info-toggle-caret {
  width: 1em;
  height: 1em;
  stroke-width: 2.8;
  flex-shrink: 0;
  opacity: 0.85;
}

.imh-info-panel {
  animation: imhInfoIn 0.22s ease;
}
@keyframes imhInfoIn {
  from { opacity: 0; transform: translateY(-4px); }
  to   { opacity: 1; transform: translateY(0); }
}

.item-master-barcode-hint {
  display: block;
  margin-top: 10px;
  color: #1e293b;
  font-size: 17px;
  line-height: 1.6;
  font-weight: 500;
  letter-spacing: 0.002em;
}
small.item-master-barcode-hint {
  font-size: 17px;
}

/* ============================================================
   ITEM MASTER FILTER BAR
   ============================================================ */
.item-master-filters-section {
  margin-bottom: 24px;
  min-width: 0;
}

.item-master-filter-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.04);
  min-width: 0;
}

.imf-search {
  position: relative;
  display: flex;
  align-items: center;
  flex: 1 1 280px;
  min-width: 240px;
  height: 48px;
  background: #ffffff;
  border: 1.5px solid #cbd5e1;
  border-radius: 10px;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
  overflow: hidden;
}
.imf-search:hover { border-color: #94a3b8; }
.imf-search:focus-within {
  border-color: #00b8b0;
  box-shadow: 0 0 0 4px rgba(0, 184, 176, 0.22);
}

.imf-search-icon {
  width: 18px;
  height: 18px;
  margin-left: 14px;
  color: #475569;
  stroke-width: 2.6;
  flex-shrink: 0;
}
.imf-search:focus-within .imf-search-icon { color: #0f766e; }

.imf-search input {
  flex: 1 1 auto;
  min-width: 0;
  height: 100%;
  padding: 0 10px;
  font-family: inherit;
  font-size: 16px;
  font-weight: 500;
  color: #0f172a;
  background: transparent;
  border: none;
  outline: none;
}
.imf-search input::placeholder {
  color: #64748b;
  opacity: 1;
  font-weight: 500;
}

.imf-search-clear {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  margin-right: 10px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: #475569;
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.15s ease, color 0.15s ease;
}
.imf-search-clear svg { width: 16px; height: 16px; stroke-width: 2.8; }
.imf-search-clear:hover {
  background: #e2e8f0;
  color: #0f172a;
}

.imf-select-wrap {
  position: relative;
  display: inline-flex;
  align-items: center;
  flex: 0 1 auto;
  min-width: 150px;
  max-width: 260px;
  height: 48px;
  background: #ffffff;
  border: 1.5px solid #cbd5e1;
  border-radius: 10px;
  transition: border-color 0.15s ease, box-shadow 0.15s ease, background 0.15s ease;
}
.imf-select-wrap:hover { border-color: #94a3b8; }
.imf-select-wrap:focus-within {
  border-color: #00b8b0;
  box-shadow: 0 0 0 4px rgba(0, 184, 176, 0.22);
}

.imf-select-wrap.is-active {
  border-color: #5eead4;
  background: #f0fdfa;
}
.imf-select-wrap.is-active:focus-within {
  border-color: #00b8b0;
  box-shadow: 0 0 0 4px rgba(0, 184, 176, 0.28);
}

.imf-dot {
  position: absolute;
  left: 14px;
  top: 50%;
  transform: translateY(-50%);
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #00b8b0;
  box-shadow: 0 0 0 3px rgba(0, 184, 176, 0.2);
  opacity: 0;
  transition: opacity 0.15s ease;
  pointer-events: none;
}
.imf-select-wrap.is-active .imf-dot { opacity: 1; }

.imf-select-wrap select {
  appearance: none;
  -webkit-appearance: none;
  width: 100%;
  height: 100%;
  padding: 0 38px 0 16px;
  font-family: inherit;
  font-size: 15.5px;
  font-weight: 600;
  color: #1e293b;
  background: transparent;
  border: none;
  outline: none;
  cursor: pointer;
  text-overflow: ellipsis;
  white-space: nowrap;
  overflow: hidden;
}
.imf-select-wrap.is-active select {
  padding-left: 32px;
  color: #0f766e;
  font-weight: 700;
}

.imf-select-wrap::after {
  content: '';
  position: absolute;
  right: 14px;
  top: 50%;
  width: 14px;
  height: 14px;
  transform: translateY(-50%);
  background-image: url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23334155' stroke-width='2.6' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-size: 100% 100%;
  pointer-events: none;
  transition: background-image 0.15s ease;
}
.imf-select-wrap.is-active::after {
  background-image: url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2300b8b0' stroke-width='2.8' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E");
}

.imf-clear-pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 0 16px;
  height: 48px;
  border: 1.5px solid #5eead4;
  border-radius: 10px;
  background: #f0fdfa;
  color: #0f766e;
  font-family: inherit;
  font-size: 15px;
  font-weight: 800;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
  transition:
    background 0.15s ease,
    border-color 0.15s ease,
    color 0.15s ease;
}
.imf-clear-pill:hover {
  background: #ccfbf1;
  border-color: #2dd4bf;
  color: #0d5f58;
}
.imf-clear-pill:focus-visible {
  outline: 2px solid #00b8b0;
  outline-offset: 2px;
}

.imf-clear-icon {
  width: 15px;
  height: 15px;
  stroke-width: 2.8;
  flex-shrink: 0;
}
.imf-clear-count { font-variant-numeric: tabular-nums; }
.imf-clear-sep {
  color: #0f766e;
  opacity: 0.5;
  font-weight: 400;
}
.imf-clear-cta { font-weight: 800; }
.imf-clear-x {
  width: 14px;
  height: 14px;
  stroke-width: 3;
  margin-left: 2px;
  flex-shrink: 0;
}

/* ============================================================
   IMAGE PREVIEW
   ============================================================ */
.item-master-image-preview {
  margin-top: 10px;
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.item-master-image-preview img {
  max-width: 120px;
  max-height: 120px;
  object-fit: contain;
  border: 1px solid #ddd;
  border-radius: 4px;
  background: #fafaf8;
}

/* ============================================================
   BARCODE GENERATE / EXPORT ROW
   ============================================================ */
.item-master-barcode-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: center;
}

/* ============================================================
   TABLE WRAPPER
   ============================================================ */
.item-master-table-wrapper {
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  width: 100%;
  max-width: 100%;
  position: relative;
  min-width: 0;
}
.item-master-table-wrapper::-webkit-scrollbar { height: 10px; }
.item-master-table-wrapper::-webkit-scrollbar-track { background: #f1f5f9; border-radius: 4px; }
.item-master-table-wrapper::-webkit-scrollbar-thumb { background: #94a3b8; border-radius: 4px; }
.item-master-table-wrapper::-webkit-scrollbar-thumb:hover { background: #64748b; }

/* ============================================================
   TABLE
   ============================================================ */
.item-master-table thead th {
  color: #1e293b;
  font-size: 15px;
  font-weight: 800;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  padding: 18px 16px;
}
.item-master-table tbody td {
  color: #0f172a;
  font-size: 16px;
  font-weight: 500;
  padding: 16px 16px;
}
.item-master-table .warehouse-code {
  color: #0f766e;
  font-weight: 700;
  font-size: 15px;
  padding: 5px 12px;
}

/* ============================================================
   PAGINATION
   ============================================================ */
.item-master-pagination {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  align-items: center;
  gap: 12px;
  margin-top: 20px;
  width: 100%;
}
.item-master-pagination .pagination-info {
  font-size: 15px;
  color: #1e293b;
  font-weight: 600;
  text-align: center;
  flex: 1 1 100%;
  order: -1;
  line-height: 1.4;
}

/* ============================================================
   MODALS
   ============================================================ */
.item-master-modal-overlay {
  position: fixed;
  inset: 0;
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 9999;
  padding: 16px;
  background: rgba(0, 0, 0, 0.5);
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}
.item-master-modal-overlay--dark {
  background: rgba(0, 0, 0, 0.62);
  z-index: 10000;
  backdrop-filter: blur(2px);
  -webkit-backdrop-filter: blur(2px);
}

.item-master-modal {
  background: #ffffff;
  border-radius: 12px;
  width: 100%;
  max-height: calc(100vh - 32px);
  max-height: calc(100dvh - 32px);
  overflow-y: auto;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
  padding: 32px;
  box-sizing: border-box;
  margin: auto;
  color: #0f172a;
}
.item-master-modal--sm { max-width: 540px; }
.item-master-modal--md { max-width: 760px; }
.item-master-modal--lg { max-width: 860px; }

.item-master-modal label {
  color: #1e293b;
  font-weight: 700;
  font-size: 15px;
  line-height: 1.35;
}
.item-master-modal input[type="text"],
.item-master-modal input[type="number"],
.item-master-modal input[type="date"],
.item-master-modal input[type="file"],
.item-master-modal select {
  color: #0f172a;
  font-weight: 500;
  font-size: 15.5px;
  padding: 12px 14px;
  min-height: 48px;
  box-sizing: border-box;
}
.item-master-modal input::placeholder {
  color: #64748b;
  opacity: 1;
  font-weight: 500;
}
.item-master-modal input:disabled {
  color: #334155 !important;
  font-weight: 600;
}

.item-master-modal-header-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 22px;
  border-bottom: 1px solid #e2e8f0;
  padding-bottom: 14px;
  gap: 12px;
}
.item-master-modal-header-bar h3 {
  margin: 0;
  font-size: 22px;
  font-weight: 800;
  color: #0f172a;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item-master-modal-footer {
  margin-top: 24px;
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  flex-wrap: wrap;
}

/* ============================================================
   FORM GRID
   ============================================================ */
.item-master-form-grid {
  display: grid;
  gap: 18px;
  grid-template-columns: 1fr 1fr;
}
.item-master-form-grid--single {
  grid-template-columns: 1fr;
}
.item-master-form-grid .form-group--full {
  grid-column: 1 / -1;
}

/* ============================================================
   DETAIL MODAL
   ============================================================ */
.item-master-detail-image {
  text-align: center;
  margin-bottom: 22px;
}
.item-master-detail-image img {
  max-width: 220px;
  max-height: 220px;
  object-fit: contain;
  border: 1px solid #ddd;
  border-radius: 8px;
  background: #fafaf8;
}

.item-master-detail-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px 22px;
  font-size: 15.5px;
  color: #0f172a;
}
.item-master-detail-grid > div {
  min-width: 0;
  word-break: break-word;
  line-height: 1.55;
}
.item-master-detail-grid strong {
  color: #1e293b;
  font-weight: 700;
}

.item-master-detail-barcode {
  margin-top: 28px;
  text-align: center;
  border-top: 1px solid #e2e8f0;
  padding-top: 24px;
}
.item-master-detail-barcode h4 {
  margin: 0 0 16px;
  font-size: 18px;
  font-weight: 800;
  color: #0f172a;
}
.item-master-detail-barcode-card {
  background: #fff;
  padding: 18px;
  display: inline-block;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  max-width: 100%;
}
.item-master-detail-barcode-card img {
  display: block;
  max-width: 100%;
  height: auto;
}
.item-master-detail-barcode-code {
  margin-top: 10px;
  font-size: 20px;
  font-family: monospace;
  letter-spacing: 2px;
  color: #0f172a;
  font-weight: 700;
  word-break: break-all;
}
.item-master-detail-barcode-empty {
  color: #475569;
  font-size: 15px;
  font-weight: 500;
}

/* ============================================================
   RESPONSIVE — ULTRAWIDE (≥ 1600px)
   ============================================================ */
@media (min-width: 1600px) {
  .imf-search { max-width: 760px; }
}

/* ============================================================
   RESPONSIVE — TABLET LANDSCAPE / SMALL LAPTOP (≤ 1024px)
   ============================================================ */
@media (max-width: 1024px) {
  .item-master-section-header h3 { font-size: 22px; }
  .item-master-header-actions .item-count { font-size: 15px; }

  .imf-search { flex: 1 1 240px; min-width: 220px; }
  .imf-select-wrap { min-width: 132px; max-width: 220px; }

  .item-master-table { min-width: 1020px; }
  .item-master-table thead th { font-size: 14px; padding: 14px 12px; }
  .item-master-table tbody td { font-size: 15px; padding: 14px 12px; }
  .item-master-table .col-image   { width: 68px; }
  .item-master-table .col-code    { width: 150px; }
  .item-master-table .col-uom     { width: 80px; }
  .item-master-table .col-gl      { width: 100px; }
  .item-master-table .col-pc      { width: 130px; }
  .item-master-table .col-barcode { width: 170px; }
  .item-master-table .col-actions { width: 110px; }
}

/* ============================================================
   RESPONSIVE — TABLET PORTRAIT (≤ 900px)
   ============================================================ */
@media (max-width: 900px) {
  .item-master-header-actions { justify-content: flex-start; }
  .imf-search { flex: 1 1 100%; min-width: 100%; }
  .imf-select-wrap { flex: 1 1 calc(50% - 6px); max-width: none; }
}

/* ============================================================
   RESPONSIVE — SMALL TABLET (≤ 768px)
   ============================================================ */
@media (max-width: 768px) {
  .item-master-section-header h3 { font-size: 20px; }
  .item-master-header-actions .item-count { font-size: 14px; }

  .label-with-icon { font-size: 19px; gap: 9px; }
  .item-master-barcode-input { font-size: 20px; min-height: 54px; }
  .item-master-barcode-btn { font-size: 15.5px !important; min-height: 54px; }
  .item-master-barcode-hint,
  small.item-master-barcode-hint { font-size: 16px; }

  .imh-info-toggle { font-size: 14.5px; padding: 8px 14px; }

  .item-master-filter-bar {
    padding: 12px;
    gap: 10px;
  }
  .imf-search,
  .imf-select-wrap { height: 46px; }
  .imf-select-wrap select { font-size: 14.5px; }
  .imf-clear-pill { height: 46px; font-size: 14px; flex: 1 1 100%; justify-content: center; }

  .item-master-table { min-width: 960px; }
  .item-master-table thead th { font-size: 13.5px; padding: 12px 10px; }
  .item-master-table tbody td { font-size: 14.5px; padding: 12px 10px; }
  .item-master-table .col-image   { width: 62px; }
  .item-master-table .col-code    { width: 140px; }
  .item-master-table .col-uom     { width: 75px; }
  .item-master-table .col-gl      { width: 95px; }
  .item-master-table .col-pc      { width: 120px; }
  .item-master-table .col-barcode { width: 160px; }
  .item-master-table .col-actions { width: 100px; }
  .item-master-table .table-thumb,
  .item-master-table .table-thumb-placeholder {
    width: 44px;
    height: 44px;
    font-size: 20px;
  }
  .item-master-table .table-barcode-img { height: 32px; }
}

/* ============================================================
   RESPONSIVE — PHONE LANDSCAPE (≤ 640px)
   ============================================================ */
@media (max-width: 640px) {
  .item-master-section-header {
    flex-direction: column;
    align-items: stretch;
    gap: 12px;
  }
  .item-master-section-header h3 { font-size: 19px; }
  .item-master-header-actions {
    width: 100%;
    justify-content: stretch;
    gap: 10px;
  }
  .item-master-header-actions .item-count {
    width: 100%;
    order: -1;
    text-align: left;
  }
  .item-master-header-actions .ui-btn {
    flex: 1 1 0;
    justify-content: center;
  }

  .imf-search,
  .imf-select-wrap,
  .imf-clear-pill {
    flex: 1 1 100%;
    min-width: 100%;
    max-width: 100%;
  }

  .item-master-barcode-row { flex-wrap: wrap; }
  .item-master-barcode-btn {
    min-height: 50px;
    padding: 0 24px;
  }

  .item-master-modal-overlay {
    padding: 12px;
    align-items: flex-start;
    padding-top: 24px;
  }
  .item-master-modal {
    padding: 24px 20px;
    max-height: calc(100vh - 40px);
    max-height: calc(100dvh - 40px);
  }
  .item-master-form-grid {
    grid-template-columns: 1fr;
    gap: 14px;
  }
  .item-master-detail-grid {
    grid-template-columns: 1fr;
    gap: 10px;
  }
  .item-master-modal-footer .ui-btn {
    flex: 1 1 auto;
    justify-content: center;
  }
}

/* ============================================================
   RESPONSIVE — PHONE (≤ 480px)
   ============================================================ */
@media (max-width: 480px) {
  .section-heading-icon { margin-right: 8px; }
  .item-master-section-header h3 { font-size: 18px; }
  .item-master-header-actions .item-count { font-size: 13.5px; }

  .item-master-header-actions .ui-btn {
    flex: 1 1 100%;
    font-size: 14px;
    padding: 12px 16px;
  }

  .label-with-icon { font-size: 18px; gap: 8px; }
  .item-master-barcode-input { font-size: 19px; min-height: 52px; padding: 13px 14px !important; }
  .item-master-barcode-btn { font-size: 15px !important; min-height: 52px; }
  .item-master-barcode-hint,
  small.item-master-barcode-hint { font-size: 15.5px; }
  .imh-info-toggle { font-size: 14px; padding: 7px 14px; }

  .item-master-barcode-row {
    flex-direction: column;
    gap: 10px;
  }
  .item-master-barcode-input {
    flex: none;
    width: 100%;
  }
  .item-master-barcode-btn {
    width: 100%;
    justify-content: center;
  }

  .item-master-filter-bar {
    padding: 12px;
    gap: 10px;
  }
  .imf-search,
  .imf-select-wrap { height: 44px; }
  .imf-search input { font-size: 15px; }
  .imf-select-wrap select { font-size: 14px; padding-right: 34px; }
  .imf-select-wrap.is-active select { padding-left: 28px; }
  .imf-select-wrap::after { right: 12px; width: 12px; height: 12px; }
  .imf-clear-pill {
    height: 44px;
    font-size: 13.5px;
    padding: 0 12px;
  }

  .item-master-table { min-width: 900px; }
  .item-master-table thead th { font-size: 13px; padding: 11px 9px; }
  .item-master-table tbody td { font-size: 14px; padding: 11px 9px; }
  .item-master-table .table-thumb,
  .item-master-table .table-thumb-placeholder {
    width: 42px;
    height: 42px;
    font-size: 18px;
  }
  .item-master-table .table-barcode-img { height: 28px; }

  .item-master-pagination .ui-btn {
    flex: 1 1 0;
    justify-content: center;
  }
  .item-master-pagination .pagination-info { font-size: 14px; }

  .item-master-modal { padding: 20px 16px; }
  .item-master-modal-header-bar h3 { font-size: 18px; }
  .item-master-modal label { font-size: 14px; }
  .item-master-modal input[type="text"],
  .item-master-modal input[type="number"],
  .item-master-modal input[type="date"],
  .item-master-modal input[type="file"],
  .item-master-modal select { font-size: 15px; padding: 11px 12px; min-height: 46px; }
  .item-master-detail-image img { max-width: 160px; max-height: 160px; }
  .item-master-detail-grid { font-size: 14.5px; }
  .item-master-detail-barcode h4 { font-size: 16px; }
  .item-master-detail-barcode-code { font-size: 17px; letter-spacing: 1.5px; }
}

/* ============================================================
   RESPONSIVE — SMALL PHONE (≤ 380px)
   ============================================================ */
@media (max-width: 380px) {
  .item-master-section-header h3 { font-size: 17px; }

  .label-with-icon { font-size: 17px; }
  .item-master-barcode-input { font-size: 18px; min-height: 50px; }
  .item-master-barcode-btn { font-size: 14.5px !important; min-height: 50px; }
  .item-master-barcode-hint,
  small.item-master-barcode-hint { font-size: 15px; }
  .imh-info-toggle { font-size: 13.5px; padding: 6px 12px; }

  .imf-search,
  .imf-select-wrap { height: 42px; }
  .imf-search input { font-size: 14.5px; padding: 0 8px; }
  .imf-select-wrap select { font-size: 13.5px; }

  .item-master-table { min-width: 860px; }
  .item-master-table .col-image   { width: 56px; }
  .item-master-table .col-code    { width: 130px; }
  .item-master-table .col-uom     { width: 70px; }
  .item-master-table .col-gl      { width: 90px; }
  .item-master-table .col-pc      { width: 110px; }
  .item-master-table .col-barcode { width: 150px; }
  .item-master-table .col-actions { width: 96px; }

  .item-master-header-actions .ui-btn { font-size: 13px; padding: 10px 14px; }
  .item-master-header-actions .item-count { font-size: 13px; }
}

/* ============================================================
   RESPONSIVE — VERY SMALL / LEGACY (≤ 320px)
   ============================================================ */
@media (max-width: 320px) {
  .item-master-section-header h3 { font-size: 16px; }

  .imf-search,
  .imf-select-wrap,
  .imf-clear-pill { height: 40px; }
  .imf-search input { font-size: 14px; }
  .imf-select-wrap select { font-size: 13px; }
  .imf-clear-pill { font-size: 13px; }

  .item-master-barcode-input { font-size: 16px; }
  .imh-info-toggle { font-size: 13px; padding: 6px 12px; }
  .item-master-table { min-width: 820px; }
  .item-master-table thead th,
  .item-master-table tbody td { padding: 9px 8px; font-size: 13px; }
}

/* ============================================================
   LANDSCAPE PHONE — short viewport height
   ============================================================ */
@media (max-height: 500px) and (orientation: landscape) {
  .item-master-modal-overlay {
    align-items: flex-start;
    padding: 10px;
  }
  .item-master-modal {
    max-height: calc(100vh - 20px);
    max-height: calc(100dvh - 20px);
    padding: 18px;
  }
  .item-master-detail-image img { max-width: 110px; max-height: 110px; }
  .item-master-detail-barcode { margin-top: 16px; padding-top: 14px; }
}

/* ============================================================
   ACCESSIBILITY
   ============================================================ */
@media (prefers-reduced-motion: reduce) {
  .imf-search,
  .imf-select-wrap,
  .imf-clear-pill,
  .imf-search-clear,
  .imh-info-toggle,
  .close-form-btn {
    transition: none !important;
  }
  .imh-info-panel { animation: none !important; }
  .icon-spin { animation: none !important; }
}

.imf-search input:focus-visible,
.imf-select-wrap select:focus-visible,
.item-master-barcode-input:focus-visible {
  outline: none;
}
.imf-clear-pill:focus-visible {
  outline: 2px solid #00b8b0;
  outline-offset: 2px;
}
.imh-info-toggle:focus-visible {
  outline: 2px solid #00b8b0;
  outline-offset: 2px;
}

/* ============================================================
   PRINT
   ============================================================ */
@media print {
  .item-master-filters-section,
  .item-master-header-actions,
  .item-master-pagination,
  .item-master-barcode-row,
  .imh-info-toggle,
  .imh-info-panel,
  .close-form-btn { display: none !important; }
  .item-master-table-wrapper { overflow: visible !important; }
  .item-master-table { min-width: 0 !important; }
}
`;