// src/components/registrar/TabDamagedItems.jsx
import React from 'react';
import { useAdminData } from '../../hooks/useAdminData';

const TabDamagedItems = () => {
  const {
    addedItems,
    itemListSearchTerm,
    setItemListSearchTerm,
    startDate,
    setStartDate,
    endDate,
    setEndDate,
  } = useAdminData();

  const allDamagedItems = addedItems.filter(item => item.status === 'Damaged');
  const filteredDamaged = allDamagedItems.filter(item => {
    const search = itemListSearchTerm.trim().toLowerCase();
    if (search) {
      const searchable = [
        item.item_name, item.item_code, item.gl_number,
        item.uom_code, item.purchase_class_name, item.category_name, item.damageReason
      ].filter(Boolean).join(' ').toLowerCase();
      if (!searchable.includes(search)) return false;
    }
    const created = new Date(item.created_at);
    if (startDate) { const start = new Date(startDate); start.setHours(0,0,0,0); if (created < start) return false; }
    if (endDate) { const end = new Date(endDate); end.setHours(23,59,59,999); if (created > end) return false; }
    return true;
  });

  return (
    <div className="items-section">
      <div className="section-header">
        <h3>⚠️ Damaged Items</h3>
        <div className="header-actions">
          <span className="item-count">Total: {allDamagedItems.length} items</span>
        </div>
      </div>

      <div className="dashboard-search-section">
        <div className="dashboard-filters">
          <div className="filter-row">
            <div className="filter-group search-group">
              <label htmlFor="damagedSearch">Search</label>
              <input id="damagedSearch" type="text" placeholder="Search by name, code, reason..." value={itemListSearchTerm} onChange={(e) => setItemListSearchTerm(e.target.value)} className="filter-input" />
            </div>
            <div className="filter-group">
              <label htmlFor="damagedStartDate">Start Date</label>
              <input id="damagedStartDate" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="filter-input" />
            </div>
            <div className="filter-group">
              <label htmlFor="damagedEndDate">End Date</label>
              <input id="damagedEndDate" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="filter-input" />
            </div>
            <div className="filter-group action-group">
              <button className="cancel-btn" onClick={() => { setItemListSearchTerm(''); setStartDate(''); setEndDate(''); }} style={{ padding: '8px 16px' }}>Clear Filters</button>
            </div>
          </div>
        </div>
      </div>

      <div className="table-wrapper">
        {filteredDamaged.length > 0 ? (
          <table className="data-table">
            <thead>
              <tr>
                <th>Code</th><th>Item Name</th><th>Category</th><th>GL #</th><th>UOM</th><th>Class</th>
                <th>Qty</th><th>List Price</th><th>Added By</th><th>Date</th><th>Status</th><th>Damage Reason</th>
              </tr>
            </thead>
            <tbody>
              {filteredDamaged.map(item => (
                <tr key={item.id}>
                  <td><span className="warehouse-code">{item.item_code}</span></td>
                  <td><strong>{item.item_name}</strong></td>
                  <td>{item.category_name || '-'}</td>
                  <td>{item.gl_number || '-'}</td>
                  <td>{item.uom_code || '-'}</td>
                  <td>{item.purchase_class_name || '-'}</td>
                  <td>{item.quantity || 1}</td>
                  <td>₱{item.list_price?.toFixed(2) || '0.00'}</td>
                  <td>{item.added_by || 'System'}</td>
                  <td>{new Date(item.created_at).toLocaleString()}</td>
                  <td><span className="status-badge damaged">{item.status}</span></td>
                  <td style={{ maxWidth: '200px', wordBreak: 'break-word' }}>{item.damageReason || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (<div className="no-items-message"><p>No damaged items found.</p></div>)}
      </div>
    </div>
  );
};

export default TabDamagedItems;