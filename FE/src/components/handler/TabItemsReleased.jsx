// src/components/handler/TabItemsReleased.jsx
import React, { useEffect, useRef, useState } from 'react';
import {
  FiSend,
  FiPlus,
  FiX,
  FiSearch,
  FiCheckCircle,
  FiList,
  FiTrash2,
} from 'react-icons/fi';
import { warehouseApi } from '../../services/api';
import { getUser } from '../../secure/auth';
import { usePermissions } from '../../permissions/usePermissions';
import { useToast } from '../shared/ToastProvider';

const TabItemsReleased = ({ adminData }) => {
  const {
    purchaseClassList,
    releasedSearchTerm, setReleasedSearchTerm,
    releasedStartDate, setReleasedStartDate,
    releasedEndDate, setReleasedEndDate,
    releasedClassFilter, setReleasedClassFilter,
  } = adminData || {};

  const { can } = usePermissions();
  const currentUser = getUser();
  const userWarehouseId = currentUser?.warehouse_assigned;
  const barcodeInputRef = useRef(null);
  const toast = useToast();
  const [loading, setLoading] = useState(false);

  const [items, setItems] = useState([]);
  const [releaseRecords, setReleaseRecords] = useState([]);
  const [warehouses, setWarehouses] = useState([]);

  const [searchTerm, setSearchTerm] = useState(releasedSearchTerm || '');
  const [startDate, setStartDate] = useState(releasedStartDate || '');
  const [endDate, setEndDate] = useState(releasedEndDate || '');
  const [classFilter, setClassFilter] = useState(releasedClassFilter || 'All');

  const [showReleaseForm, setShowReleaseForm] = useState(false);
  const [releaseShared, setReleaseShared] = useState({ reason: '', warehouse_id: userWarehouseId || '' });
  const [releaseCurrentItem, setReleaseCurrentItem] = useState({
    item_id:'', item_name:'', item_code:'', barcode:'', unit:'', size:'', quantity:1, current_stock:0,
  });
  const [releaseBarcodeInput, setReleaseBarcodeInput] = useState('');
  const [releaseScannedItem, setReleaseScannedItem] = useState(null);
  const [releaseItemsList, setReleaseItemsList] = useState([]);

  const baseItems = [
    { code:'ITM-0001', name:'Item A', category:'Raw Materials', unit:'pcs', size:'M', min_stock:10 },
    { code:'ITM-0002', name:'Item B', category:'Finished Goods', unit:'kg', size:'L', min_stock:5 },
    { code:'ITM-0003', name:'Item C', category:'Packaging', unit:'box', size:'S', min_stock:8 },
    { code:'ITM-0004', name:'Item D', category:'Equipment', unit:'set', size:'XL', min_stock:2 },
    { code:'ITM-0005', name:'Item E', category:'Supplies', unit:'L', size:'M', min_stock:15 },
  ];

  const generateMockItems = (warehousesList) => {
    if (!warehousesList || warehousesList.length === 0) return [];
    const itemsData = [];
    warehousesList.forEach(wh => {
      baseItems.forEach(base => {
        itemsData.push({
          id: itemsData.length + 1,
          item_code: base.code,
          item_name: base.name,
          category: base.category,
          unit: base.unit,
          size: base.size,
          min_stock: base.min_stock,
          warehouse_id: wh.warehouse_id,
          current_stock: Math.floor(Math.random() * 120) + 20,
          status: 'Active',
          barcode: `BARCODE-${String(itemsData.length + 1).padStart(6, '0')}`,
        });
      });
    });
    return itemsData;
  };

  const generateMockReleaseRecords = (itemsData, userWhId) => {
    if (!itemsData || itemsData.length === 0) return [];
    const now = new Date();
    const records = [];
    const reasons = ['Production Use', 'Customer Order', 'Maintenance', 'Transfer', 'Sample'];
    const userItems = itemsData.filter(it => it.warehouse_id === userWhId);
    if (userItems.length === 0) return [];
    const numRecords = Math.min(Math.floor(Math.random() * 15) + 8, 30);
    for (let i = 1; i <= numRecords; i++) {
      const dayOffset = Math.floor(Math.random() * 28);
      const recordDate = new Date(now.getFullYear(), now.getMonth(), dayOffset + 1);
      recordDate.setHours(Math.floor(Math.random() * 8) + 8, Math.floor(Math.random() * 60), 0, 0);
      const item = userItems[i % userItems.length];
      const qty = Math.floor(Math.random() * Math.min(item.current_stock, 20)) + 1;
      records.push({
        id: i, item_id: item.id, item_name: item.item_name, item_code: item.item_code,
        barcode: item.barcode, quantity: qty, unit: item.unit, size: item.size,
        reason: reasons[i % reasons.length], warehouse_id: userWhId,
        released_by: currentUser?.username || 'System',
        created_at: recordDate.toISOString(), status: 'Released',
      });
    }
    records.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return records;
  };

  useEffect(() => {
    (async () => {
      const whRes = await warehouseApi.getAllWarehouses();
      const whList = whRes.ok && Array.isArray(whRes.data)
        ? whRes.data.filter(w => w.status === 'Active')
        : [{ warehouse_id: 1, warehouse_name: 'Main Warehouse', warehouse_code: 'WH-001', status: 'Active' }];
      setWarehouses(whList);
      const itemsData = generateMockItems(whList);
      setItems(itemsData);
      setReleaseRecords(generateMockReleaseRecords(itemsData, userWarehouseId));
    })();
  }, []);

  const findItemByBarcodeOrCode = (code) => {
    if (!code) return null;
    const trimmed = code.trim();
    return (items || []).find(it => it.barcode === trimmed || it.item_code === trimmed);
  };

  const handleShowReleaseForm = () => {
    setShowReleaseForm(true);
    setReleaseItemsList([]);
    setReleaseScannedItem(null);
    setReleaseBarcodeInput('');
    setReleaseShared({ reason: '', warehouse_id: userWarehouseId || '' });
    setReleaseCurrentItem({ item_id:'', item_name:'', item_code:'', barcode:'', unit:'', size:'', quantity:1, current_stock:0 });
    setTimeout(() => document.getElementById('releaseBarcodeInput')?.focus(), 300);
  };

  const handleCloseReleaseForm = () => {
    setShowReleaseForm(false);
    setReleaseItemsList([]);
    setReleaseScannedItem(null);
    setReleaseBarcodeInput('');
  };

  const handleReleaseBarcodeSubmit = () => {
    if (!releaseBarcodeInput.trim()) return toast.error('Please enter or scan a barcode.');
    const found = findItemByBarcodeOrCode(releaseBarcodeInput.trim());
    if (!found) { toast.error('Item not found.'); setReleaseScannedItem(null); return; }
    setReleaseScannedItem(found);
    setReleaseCurrentItem({
      item_id: found.id, item_name: found.item_name, item_code: found.item_code,
      barcode: found.barcode, unit: found.unit, size: found.size || 'M',
      quantity: 1, current_stock: found.current_stock,
    });
    setReleaseBarcodeInput('');
  };

  const handleReleaseBarcodeKeyPress = (e) => { if (e.key === 'Enter') { e.preventDefault(); handleReleaseBarcodeSubmit(); } };
  const handleReleaseSharedChange = (e) => { const { name, value } = e.target; setReleaseShared(prev => ({ ...prev, [name]: value })); };
  const handleReleaseCurrentChange = (e) => { const { name, value } = e.target; setReleaseCurrentItem(prev => ({ ...prev, [name]: name === 'quantity' ? parseInt(value) || 0 : value })); };

  const handleAddAnotherReleaseItem = () => {
    if (!releaseScannedItem) return toast.error('Please scan a valid item first.');
    if (releaseCurrentItem.quantity < 1) return toast.error('Quantity must be at least 1.');
    if (releaseCurrentItem.quantity > releaseCurrentItem.current_stock) return toast.error(`Insufficient stock. Available: ${releaseCurrentItem.current_stock}`);
    const newItem = {
      id: Date.now() + Math.random(),
      item_id: releaseCurrentItem.item_id,
      item_name: releaseCurrentItem.item_name,
      item_code: releaseCurrentItem.item_code,
      barcode: releaseCurrentItem.barcode,
      quantity: releaseCurrentItem.quantity,
      unit: releaseCurrentItem.unit,
      size: releaseCurrentItem.size,
      current_stock: releaseCurrentItem.current_stock,
    };
    setReleaseItemsList(prev => [...prev, newItem]);
    setReleaseScannedItem(null);
    setReleaseBarcodeInput('');
    setReleaseCurrentItem({ item_id:'', item_name:'', item_code:'', barcode:'', unit:'', size:'', quantity:1, current_stock:0 });
    setTimeout(() => document.getElementById('releaseBarcodeInput')?.focus(), 100);
  };

  const handleRemoveReleaseItem = (id) => setReleaseItemsList(prev => prev.filter(i => i.id !== id));
  const clearReleaseList = () => {
    if (releaseItemsList.length === 0) return;
    if (window.confirm('Clear all items from the release list?')) setReleaseItemsList([]);
  };

  const handleSubmitAllReleaseItems = async () => {
    if (releaseItemsList.length === 0) return toast.error('Please add at least one item to release.');
    if (!releaseShared.reason.trim()) return toast.error('Please provide a reason for the release.');
    const targetWarehouseId = releaseShared.warehouse_id || userWarehouseId;
    if (!targetWarehouseId) return toast.error('No warehouse selected.');

    const itemsMap = {};
    (items || []).forEach(item => { itemsMap[item.id] = item; });
    for (const releaseItem of releaseItemsList) {
      const found = itemsMap[releaseItem.item_id];
      if (!found) return toast.error(`Item ${releaseItem.item_name} no longer exists.`);
      const totalRequested = releaseItemsList.filter(i => i.item_id === releaseItem.item_id).reduce((s,i) => s + i.quantity, 0);
      if (totalRequested > found.current_stock) return toast.error(`Insufficient stock for ${releaseItem.item_name}. Available: ${found.current_stock}`);
    }

    let confirmMsg = `Confirm Release\n\n`;
    releaseItemsList.forEach((item, idx) => {
      confirmMsg += `${idx+1}. ${item.item_code} - ${item.item_name}\n   Qty: ${item.quantity} ${item.unit}\n\n`;
    });
    confirmMsg += `Total: ${releaseItemsList.length}\nReason: ${releaseShared.reason}\n\nProceed?`;
    if (!window.confirm(confirmMsg)) return;

    setLoading(true);
    try {
      const updatedItems = [...(items || [])];
      const newRecords = [];
      for (const releaseItem of releaseItemsList) {
        const idx = updatedItems.findIndex(i => i.id === releaseItem.item_id);
        if (idx === -1) continue;
        updatedItems[idx].current_stock -= releaseItem.quantity;
        newRecords.push({
          id: (releaseRecords?.length || 0) + newRecords.length + 1,
          item_id: releaseItem.item_id, item_name: releaseItem.item_name,
          item_code: releaseItem.item_code, barcode: releaseItem.barcode,
          quantity: releaseItem.quantity, unit: releaseItem.unit, size: releaseItem.size || 'M',
          reason: releaseShared.reason, warehouse_id: parseInt(targetWarehouseId),
          released_by: currentUser?.username || 'System',
          created_at: new Date().toISOString(), status: 'Released',
        });
      }
      setItems(updatedItems);
      setReleaseRecords([...newRecords, ...(releaseRecords || [])]);
      toast.success(`Release successful! ${newRecords.length} item(s) released.`);
      setReleaseItemsList([]);
      setShowReleaseForm(false);
      setReleaseScannedItem(null);
      setReleaseBarcodeInput('');
    } catch (error) {
      console.error('Error submitting release:', error);
      toast.error('Error submitting release.');
    } finally { setLoading(false); }
  };

  const todayReleased = new Date();
  todayReleased.setHours(0, 0, 0, 0);
  const todayReleasedItems = (releaseRecords || []).filter(r => new Date(r.created_at) >= todayReleased);

  const releasedHistory = (releaseRecords || []).filter(r => {
    const s = searchTerm.trim().toLowerCase();
    if (s) {
      const searchable = [r.item_name, r.item_code, r.reason, r.released_by].filter(Boolean).join(' ').toLowerCase();
      if (!searchable.includes(s)) return false;
    }
    const created = new Date(r.created_at);
    if (startDate) { const sd = new Date(startDate); sd.setHours(0,0,0,0); if (created < sd) return false; }
    if (endDate) { const ed = new Date(endDate); ed.setHours(23,59,59,999); if (created > ed) return false; }
    if (classFilter !== 'All') {
      const item = (items || []).find(i => i.id === r.item_id);
      const itemClass = item?.purchase_class_name || '';
      if (itemClass && itemClass !== classFilter) return false;
    }
    return true;
  });

  const clearFilters = () => {
    setSearchTerm('');
    setStartDate('');
    setEndDate('');
    setClassFilter('All');
    if (setReleasedSearchTerm) setReleasedSearchTerm('');
    if (setReleasedStartDate) setReleasedStartDate('');
    if (setReleasedEndDate) setReleasedEndDate('');
    if (setReleasedClassFilter) setReleasedClassFilter('All');
  };

  return (
    <div className="items-section">
      <style>{tabReleasedIconCss}</style>

      <div className="section-header">
        <h3>
          <FiSend className="section-heading-icon" />
          <span>Items Released</span>
        </h3>
        <div className="header-actions">
          <span className="item-count">Total: {(releaseRecords || []).length} releases</span>
          {can('itemsreleased.create') && (
            <button className="add-user-btn" onClick={handleShowReleaseForm}>
              <FiPlus className="btn-icon" />
              <span>New Release</span>
            </button>
          )}
        </div>
      </div>

      {can('itemsreleased.create') && showReleaseForm && (
        <div className="release-form" style={{ background:'#fafaf8', borderRadius:12, border:'1px solid #e5e5e0', marginBottom:20, overflow:'hidden' }}>
          <div className="form-header" style={{ display:'flex', justifyContent:'space-between', padding:'16px 20px', background:'#f5f5f0', borderBottom:'1px solid #e5e5e0' }}>
            <h4 style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <FiSend style={{ color: '#1a1f26' }} />
              <span>Release Stock – {releaseItemsList.length} item(s) added</span>
            </h4>
            <button className="close-form-btn" onClick={handleCloseReleaseForm} aria-label="Close">
              <FiX />
            </button>
          </div>

          <div className="form-body" style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, padding:20 }}>
            <div className="form-group" style={{ gridColumn:'1 / -1' }}>
              <label>Reason for Release *</label>
              <input type="text" name="reason" value={releaseShared.reason} onChange={handleReleaseSharedChange} placeholder="e.g., Production Use, Customer Order" />
            </div>
            <div className="form-group" style={{ gridColumn:'1 / -1' }}>
              <label>Warehouse</label>
              <select name="warehouse_id" value={releaseShared.warehouse_id} onChange={handleReleaseSharedChange}>
                {(warehouses || []).filter(w => w.status === 'Active').map(wh => (
                  <option key={wh.warehouse_id} value={wh.warehouse_id}>{wh.warehouse_code} - {wh.warehouse_name}</option>
                ))}
              </select>
            </div>

            <hr style={{ gridColumn:'1 / -1', border:'none', borderTop:'1px solid #e5e5e0', margin:'4px 0' }} />

            <div className="form-group" style={{ gridColumn:'1 / -1' }}>
              <label>Scan Barcode / Enter Item Code</label>
              <div style={{ display:'flex', gap:8 }}>
                <input id="releaseBarcodeInput" ref={barcodeInputRef} type="text" value={releaseBarcodeInput} onChange={(e) => setReleaseBarcodeInput(e.target.value)} onKeyPress={handleReleaseBarcodeKeyPress} placeholder="Scan or type item code..." style={{ flex:1 }} />
                <button className="search-btn" onClick={handleReleaseBarcodeSubmit} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding:'8px 20px', background:'#00d2c8', color:'#fff', border:'none', borderRadius:6 }}>
                  <FiSearch style={{ width: '1em', height: '1em', strokeWidth: 2.4 }} />
                  <span>Scan</span>
                </button>
              </div>
            </div>

            {releaseScannedItem && (
              <>
                <div style={{ gridColumn:'1 / -1', background:'#f0f8ff', padding:12, borderRadius:8, border:'1px solid #00d2c8' }}>
                  <h5 style={{ margin:'0 0 8px 0', color:'#008a82', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <FiCheckCircle style={{ width: '1em', height: '1em', strokeWidth: 2.4 }} />
                    <span>Item Found</span>
                  </h5>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
                    <div><strong>Code:</strong> {releaseScannedItem.item_code}</div>
                    <div><strong>Name:</strong> {releaseScannedItem.item_name}</div>
                    <div><strong>Unit:</strong> {releaseScannedItem.unit}</div>
                    <div><strong>Available:</strong> {releaseScannedItem.current_stock}</div>
                  </div>
                </div>
                <div className="form-group"><label>Quantity *</label><input type="number" name="quantity" value={releaseCurrentItem.quantity} onChange={handleReleaseCurrentChange} min="1" max={releaseCurrentItem.current_stock} /></div>
                <div className="form-group" style={{ gridColumn:'1 / -1' }}>
                  <button className="add-user-btn" onClick={handleAddAnotherReleaseItem} style={{ background:'#e3742a', width:'100%' }}>
                    <FiPlus className="btn-icon" />
                    <span>Add Another Item</span>
                  </button>
                </div>
              </>
            )}
          </div>

          {releaseItemsList.length > 0 && (
            <div style={{ padding:'0 20px 16px' }}>
              <h5 style={{ marginBottom:8, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <FiList style={{ width: '1em', height: '1em', strokeWidth: 2.4 }} />
                <span>Items to Release ({releaseItemsList.length})</span>
              </h5>
              <div className="table-wrapper">
                <table className="data-table" style={{ minWidth:'auto' }}>
                  <thead><tr><th>#</th><th>Code</th><th>Name</th><th>Qty</th><th>Unit</th><th>Size</th><th>Action</th></tr></thead>
                  <tbody>
                    {releaseItemsList.map((it, i) => (
                      <tr key={it.id}>
                        <td>{i+1}</td>
                        <td><span className="warehouse-code">{it.item_code}</span></td>
                        <td>{it.item_name}</td>
                        <td>{it.quantity}</td>
                        <td>{it.unit}</td>
                        <td>{it.size || 'M'}</td>
                        <td><button className="action-btn deactivate-btn" onClick={() => handleRemoveReleaseItem(it.id)} style={{ padding:'2px 8px', fontSize:'11px' }}>Remove</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ display:'flex', gap:8, marginTop:8 }}>
                <button className="cancel-btn" onClick={clearReleaseList} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background:'#ef4444', color:'#fff', border:'none' }}>
                  <FiTrash2 style={{ width: '1em', height: '1em', strokeWidth: 2.4 }} />
                  <span>Clear All</span>
                </button>
              </div>
            </div>
          )}

          <div className="form-footer" style={{ display:'flex', justifyContent:'flex-end', gap:12, padding:'16px 20px', borderTop:'1px solid #e5e5e0', background:'#f5f5f0' }}>
            <button className="cancel-btn" onClick={handleCloseReleaseForm}>Cancel</button>
            <button className="save-btn" onClick={handleSubmitAllReleaseItems} disabled={loading || releaseItemsList.length === 0} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {loading ? 'Submitting...' : (
                <>
                  <FiCheckCircle style={{ width: '1em', height: '1em', strokeWidth: 2.4 }} />
                  <span>Submit All ({releaseItemsList.length} items)</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}

      <div className="dashboard-search-section">
        <div className="dashboard-filters">
          <div className="filter-row">
            <div className="filter-group search-group">
              <label>Search</label>
              <input type="text" placeholder="Search item name, code, reason..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="filter-input" />
            </div>
            <div className="filter-group"><label>Start Date</label><input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="filter-input" /></div>
            <div className="filter-group"><label>End Date</label><input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="filter-input" /></div>
            <div className="filter-group">
              <label>Item Class</label>
              <select value={classFilter} onChange={(e) => setClassFilter(e.target.value)} className="filter-input">
                <option value="All">All Classes</option>
                {(purchaseClassList || []).map(pc => (<option key={pc.id} value={pc.name}>{pc.name}</option>))}
              </select>
            </div>
            <div className="filter-group action-group">
              <button className="cancel-btn" onClick={clearFilters} style={{ padding:'8px 16px' }}>Clear Filters</button>
            </div>
          </div>
        </div>
      </div>

      <div className="daily-items-section" style={{ marginBottom:24 }}>
        <div className="daily-items-header">
          <h4>Today's Releases – {new Date().toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' })}</h4>
          <span className="daily-items-count">Total: {todayReleasedItems.length} releases</span>
        </div>
        <div className="table-wrapper">
          {todayReleasedItems.length > 0 ? (
            <table className="data-table">
              <thead><tr><th>Code</th><th>Item Name</th><th>Qty</th><th>Unit</th><th>Reason</th><th>Released By</th><th>Time</th></tr></thead>
              <tbody>
                {todayReleasedItems.map(r => (
                  <tr key={r.id}>
                    <td><span className="warehouse-code">{r.item_code}</span></td>
                    <td><strong>{r.item_name}</strong></td>
                    <td>{r.quantity}</td>
                    <td>{r.unit}</td>
                    <td>{r.reason}</td>
                    <td>{r.released_by || 'System'}</td>
                    <td>{new Date(r.created_at).toLocaleTimeString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (<div className="no-items-message"><p>No items released today.</p></div>)}
        </div>
      </div>

      <div className="daily-items-section">
        <div className="daily-items-header">
          <h4>Full History of Released Items</h4>
          <span className="daily-items-count">Total: {releasedHistory.length} releases</span>
        </div>
        <div className="table-wrapper">
          {releasedHistory.length > 0 ? (
            <table className="data-table">
              <thead><tr><th>Code</th><th>Item Name</th><th>Qty</th><th>Unit</th><th>Size</th><th>Reason</th><th>Released By</th><th>Date Released</th></tr></thead>
              <tbody>
                {releasedHistory.map(r => (
                  <tr key={r.id}>
                    <td><span className="warehouse-code">{r.item_code}</span></td>
                    <td><strong>{r.item_name}</strong></td>
                    <td>{r.quantity}</td>
                    <td>{r.unit}</td>
                    <td>{r.size || 'M'}</td>
                    <td>{r.reason}</td>
                    <td>{r.released_by || 'System'}</td>
                    <td>{new Date(r.created_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (<div className="no-items-message"><p>No released items match the filters.</p></div>)}
        </div>
      </div>
    </div>
  );
};

const tabReleasedIconCss = `
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

.section-heading-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1em;
  height: 1em;
  margin-right: 8px;
  vertical-align: -0.15em;
  color: #1a1f26;
}
.section-heading-icon svg { width: 100%; height: 100%; stroke-width: 2.2; }

.close-form-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #475569;
}
.close-form-btn svg { width: 1em; height: 1em; stroke-width: 2.4; }

@media (max-width: 480px) {
  .section-heading-icon { margin-right: 6px; }
}
`;

export default TabItemsReleased;