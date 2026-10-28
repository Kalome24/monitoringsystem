// src/components/admin/TabDashboard.jsx
import React, { useEffect, useMemo } from 'react';
import {
  FiPackage,
  FiHome,
  FiInbox,
  FiAlertTriangle,
  FiImage,
  FiBarChart2,
  FiCalendar,
  FiTool,
  FiChevronLeft,
  FiChevronRight,
  FiTrendingUp,
} from 'react-icons/fi';

const TabDashboard = ({ adminData, onNavigate = () => {} }) => {
  const {
    dashboardItems,
    dashboardTotalCount,
    dashboardItemIndex,
    setDashboardItemIndex,
    warehouses,
    highlightedClass,
    setHighlightedClass,
    generateBarcodeDataUrl,
    prevDashboardItem,
    nextDashboardItem,
    fetchItemMastersForDashboard,
    damagedItemsCount,
  } = adminData;

  useEffect(() => {
    fetchItemMastersForDashboard(1);
  }, []);

  useEffect(() => {
    if (dashboardItems.length > 0 && dashboardItemIndex >= dashboardItems.length) {
      setDashboardItemIndex(0);
    }
    if (dashboardItems.length === 0 && dashboardItemIndex !== 0) {
      setDashboardItemIndex(0);
    }
  }, [dashboardItems, dashboardItemIndex, setDashboardItemIndex]);

  const computedStats = useMemo(() => {
    const totalItems = dashboardItems.length;
    const totalWarehouses = warehouses.length;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const itemsAddedToday = dashboardItems.filter(item => {
      if (!item.Creation_Date) return false;
      const created = new Date(item.Creation_Date);
      created.setHours(0, 0, 0, 0);
      return created.getTime() === today.getTime();
    }).length;
    return { totalItems, totalWarehouses, itemsAddedToday };
  }, [dashboardItems, warehouses]);

  const yearlyData = useMemo(() => {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const counts = Array(12).fill(0);
    const currentYear = new Date().getFullYear();
    dashboardItems.forEach(item => {
      if (item.Creation_Date) {
        const date = new Date(item.Creation_Date);
        if (date.getFullYear() === currentYear) {
          counts[date.getMonth()]++;
        }
      }
    });
    return { labels: months, values: counts };
  }, [dashboardItems]);

  const maxYearlyValue = Math.max(1, ...yearlyData.values);
  const hasYearlyData = yearlyData.values.some(v => v > 0);

  const currentItem = dashboardItems.length > 0 ? dashboardItems[dashboardItemIndex] : null;
  const totalItems = dashboardTotalCount || dashboardItems.length;

  const classCounts = {};
  dashboardItems.forEach(item => {
    const cls = item.Purchase_Class || 'Uncategorized';
    classCounts[cls] = (classCounts[cls] || 0) + 1;
  });

  const classColors = ['#00d2c8', '#1a73e8', '#e3742a', '#8b5cf6', '#ef4444', '#22c55e', '#f59e0b', '#ec4899', '#8b5cf6', '#06b6d4', '#f472b6', '#14b8a6', '#f97316', '#6366f1', '#84cc16'];

  let classIndex = 0;
  const unsortedClassPieData = Object.entries(classCounts).map(([name, count]) => {
    const color = classColors[classIndex % classColors.length];
    classIndex++;
    return { name, count, color };
  });

  const classPieData = [...unsortedClassPieData].sort((a, b) => {
    const priority = ['A', 'B', 'C', 'D'];
    const aIndex = priority.indexOf(a.name);
    const bIndex = priority.indexOf(b.name);
    if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
    if (aIndex !== -1) return -1;
    if (bIndex !== -1) return 1;
    return a.name.localeCompare(b.name);
  });

  const totalClassItems = classPieData.reduce((sum, d) => sum + d.count, 0);

  // ---------- Card → tab navigation ----------
  const goToTab = (tabId) => {
    if (typeof onNavigate === 'function') onNavigate(tabId);
  };

  // Keyboard support for the clickable cards
  const handleCardKey = (tabId) => (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      goToTab(tabId);
    }
  };

  const damagedCount = Number(damagedItemsCount) || 0;

  return (
    <div className="dashboard-wrapper">
      <style>{tabDashboardIconCss}</style>

      <div className="stats-grid">
        {/* Total Items → Item Masters tab */}
        <div
          className="stat-card stat-card--total clickable"
          role="button"
          tabIndex={0}
          aria-label="View Item Masters"
          title="View Item Masters"
          onClick={() => goToTab('itemmasters')}
          onKeyDown={handleCardKey('itemmasters')}
        >
          <div className="stat-icon"><FiPackage /></div>
          <div className="stat-info">
            <span className="stat-value">{computedStats.totalItems}</span>
            <span className="stat-label">Total Items</span>
          </div>
        </div>

        {/* Warehouses → Warehouse tab */}
        <div
          className="stat-card stat-card--warehouses clickable"
          role="button"
          tabIndex={0}
          aria-label="View Warehouses"
          title="View Warehouses"
          onClick={() => goToTab('warehouse')}
          onKeyDown={handleCardKey('warehouse')}
        >
          <div className="stat-icon"><FiHome /></div>
          <div className="stat-info">
            <span className="stat-value">{computedStats.totalWarehouses}</span>
            <span className="stat-label">Warehouses</span>
          </div>
        </div>

        {/* Added Today — informational only (no destination tab) */}
        <div className="stat-card stat-card--today">
          <div className="stat-icon"><FiInbox /></div>
          <div className="stat-info">
            <span className="stat-value">{computedStats.itemsAddedToday}</span>
            <span className="stat-label">Added Today</span>
          </div>
        </div>

        {/* Damaged Items → Damaged Items tab */}
        <div
          className={`stat-card stat-card--danger clickable${damagedCount > 0 ? ' is-alert' : ''}`}
          role="button"
          tabIndex={0}
          aria-label="View Damaged Items"
          title="View Damaged Items"
          onClick={() => goToTab('damageditems')}
          onKeyDown={handleCardKey('damageditems')}
        >
          <div className={`stat-icon ${damagedCount > 0 ? 'stat-icon--danger' : ''}`}>
            <FiAlertTriangle />
          </div>
          <div className="stat-info">
            <span className="stat-value" style={{ color: damagedCount > 0 ? '#ef4444' : '#1a1f26' }}>
              {damagedCount}
            </span>
            <span className="stat-label">Damaged Items</span>
          </div>
        </div>
      </div>

      <div className="main-grid">
        <div className="main-left">

          <div className="item-view-card">
            <div className="item-view-header">
              <h4>
                <FiImage className="tab-heading-icon" />
                Item Preview
              </h4>
              <span className="item-view-count">
                {totalItems > 0 ? `${dashboardItemIndex + 1} / ${totalItems}` : 'No items'}
              </span>
            </div>
            {currentItem ? (
              <div className="item-view-content">
                <div className="item-view-image">
                  {currentItem.Item_Image ? (
                    <img src={currentItem.Item_Image} alt={currentItem.Item_Code} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                  ) : (
                    <FiPackage />
                  )}
                </div>
                <div className="item-view-details">
                  <div className="item-view-name">
                    {currentItem.Item_Description || currentItem.Item_Code}
                  </div>
                  <div className="item-view-meta">
                    <span><strong>Code:</strong> {currentItem.Item_Code}</span>
                    <span><strong>GL:</strong> {currentItem.Gl_Class || '-'}</span>
                    <span><strong>UOM:</strong> {currentItem.Uom_Code || '-'}</span>
                    <span><strong>Class:</strong> {currentItem.Purchase_Class || '-'}</span>
                    <span><strong>Category:</strong> {currentItem.Category || '-'}</span>
                    <span><strong>Price:</strong> ₱{Number(currentItem.List_Price_Per_Unit || 0).toFixed(2)}</span>
                    <span>
                      <strong>Status:</strong>{' '}
                      <span className={`status-badge ${(currentItem.Status || 'Active').toLowerCase()}`}>
                        {currentItem.Status || 'Active'}
                      </span>
                    </span>
                    <span><strong>Created:</strong> {currentItem.Creation_Date ? new Date(currentItem.Creation_Date).toLocaleDateString() : '-'}</span>
                    {currentItem.Barcode && (
                      <span style={{ gridColumn: 'span 2' }}>
                        <strong>Barcode:</strong> {currentItem.Barcode}
                      </span>
                    )}
                  </div>
                  {currentItem.Barcode && (
                    <div style={{ marginTop: '4px' }}>
                      <img src={generateBarcodeDataUrl(currentItem.Barcode, 1.5, 30)} alt="Barcode" className="barcode-thumb" />
                    </div>
                  )}
                  <div className="item-view-nav">
                    <button className="nav-btn" onClick={prevDashboardItem} disabled={totalItems <= 1}>
                      <FiChevronLeft className="nav-btn-icon" /> Prev
                    </button>
                    <span className="item-index">{dashboardItemIndex + 1} / {totalItems}</span>
                    <button className="nav-btn" onClick={nextDashboardItem} disabled={totalItems <= 1}>
                      Next <FiChevronRight className="nav-btn-icon" />
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="no-items-message"><p>No items found in the database.</p></div>
            )}
          </div>

          <div className="class-pie-card">
            <h4>
              <FiBarChart2 className="tab-heading-icon" />
              Items by Class
            </h4>
            {classPieData.length > 0 ? (
              <div className="pie-chart-container">
                <div className="pie-chart-wrapper">
                  {classPieData.map((d, idx) => {
                    const percentage = (d.count / totalClassItems) * 100;
                    const angle = (percentage / 100) * 360;
                    const startAngle = classPieData.slice(0, idx).reduce((acc, cur) => acc + (cur.count / totalClassItems) * 360, 0);
                    const endAngle = startAngle + angle;
                    const x1 = 50 + 42 * Math.cos((startAngle - 90) * Math.PI / 180);
                    const y1 = 50 + 42 * Math.sin((startAngle - 90) * Math.PI / 180);
                    const x2 = 50 + 42 * Math.cos((endAngle - 90) * Math.PI / 180);
                    const y2 = 50 + 42 * Math.sin((endAngle - 90) * Math.PI / 180);
                    const largeArcFlag = angle > 180 ? 1 : 0;
                    const isHighlighted = highlightedClass === d.name;
                    const opacity = highlightedClass ? (isHighlighted ? 1 : 0.4) : 1;
                    return (
                      <svg key={`pie-${idx}-${d.name}`} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }} viewBox="0 0 100 100">
                        <path
                          d={`M 50 50 L ${x1} ${y1} A 42 42 0 ${largeArcFlag} 1 ${x2} ${y2} Z`}
                          fill={d.color}
                          stroke={isHighlighted ? '#fff' : 'none'}
                          strokeWidth={isHighlighted ? '2.5' : '0'}
                          filter={isHighlighted ? 'drop-shadow(0 0 8px rgba(0,210,200,0.4))' : 'none'}
                          opacity={opacity}
                          style={{ transition: 'opacity 0.35s ease, stroke 0.3s ease, filter 0.3s ease' }}
                        />
                        {percentage > 4 && (
                          <text
                            x={50 + 28 * Math.cos((startAngle + angle / 2 - 90) * Math.PI / 180)}
                            y={50 + 28 * Math.sin((startAngle + angle / 2 - 90) * Math.PI / 180)}
                            textAnchor="middle"
                            dominantBaseline="central"
                            style={{ fontSize: '6px', fill: '#fff', fontWeight: 'bold', pointerEvents: 'none', opacity: isHighlighted ? 1 : 0.85 }}
                          >
                            {percentage.toFixed(1)}%
                          </text>
                        )}
                      </svg>
                    );
                  })}
                </div>

                <div className="pie-legend">
                  {classPieData.map(d => (
                    <div
                      key={d.name}
                      className="pie-legend-item"
                      onClick={() => setHighlightedClass(highlightedClass === d.name ? null : d.name)}
                      style={{
                        opacity: highlightedClass && highlightedClass !== d.name ? 0.45 : 1,
                        background: highlightedClass === d.name ? 'rgba(0,210,200,0.12)' : 'transparent',
                        border: highlightedClass === d.name ? '1px solid rgba(0,210,200,0.25)' : '1px solid transparent',
                      }}
                    >
                      <span className="pie-legend-color" style={{ backgroundColor: d.color }}></span>
                      <span className="pie-legend-label">{d.name}</span>
                      <span className="pie-legend-count">({d.count})</span>
                    </div>
                  ))}
                  {highlightedClass && (
                    <div className="clear-highlight" onClick={() => setHighlightedClass(null)}>Clear</div>
                  )}
                </div>
              </div>
            ) : (
              <div className="no-items-message">No class data available.</div>
            )}
          </div>
        </div>

        <div className="main-right">
          {/* --------------------------------------------------------
              Reporting widgets placeholder.

              Release trends, receive trends, and monthly exports are
              not yet wired to a backend aggregation endpoint. Rather
              than render charts that always show zero, we show an
              honest placeholder so users know these are on the way.
             -------------------------------------------------------- */}
          <div className="chart-card">
            <h4>
              <FiTrendingUp className="tab-heading-icon" />
              More Reports Coming Soon
            </h4>
            <div
              style={{
                padding: '32px 20px',
                textAlign: 'center',
                color: '#7a8699',
                fontSize: 13,
                lineHeight: 1.6,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12, color: '#94a3b8' }}>
                <FiTool size={42} strokeWidth={1.5} />
              </div>
              <div style={{ fontWeight: 600, color: '#1a1f26', marginBottom: 6 }}>
                Under development
              </div>
              <div>
                Weekly release and receive trends, plus monthly PDF/Excel exports, will appear here once the reporting pipeline is ready.
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="yearly-report-section">
        <div className="yearly-header">
          <h3>
            <FiCalendar className="tab-heading-icon" />
            Yearly Overview ({new Date().getFullYear()})
          </h3>
        </div>
        <div className="yearly-chart-container">
          {hasYearlyData ? (
            <div className="yearly-line-chart">
              <svg viewBox="0 0 800 300" preserveAspectRatio="xMidYMid meet" className="yearly-svg">
                {[0, 50, 100, 150, 200, 250, 300].map(y => (
                  <line key={`grid-${y}`} x1="40" y1={y} x2="760" y2={y} stroke="#e5e5e0" strokeWidth="1" strokeDasharray="4,4" />
                ))}
                {yearlyData.labels.map((label, i) => {
                  const x = 40 + (i / 11) * 720;
                  return (<text key={`xlabel-${i}`} x={x} y="285" textAnchor="middle" fontSize="10" fill="#7a8699">{label}</text>);
                })}
                {[0, 50, 100, 150, 200, 250, 300].map(y => {
                  const val = Math.round((300 - y) / 300 * maxYearlyValue);
                  return (<text key={`ylabel-${y}`} x="30" y={y+4} textAnchor="end" fontSize="10" fill="#7a8699">{val}</text>);
                })}
                <polyline
                  points={yearlyData.values.map((val, i) => {
                    const x = 40 + (i / 11) * 720;
                    const y = 280 - (val / maxYearlyValue) * 240;
                    return `${x},${y}`;
                  }).join(' ')}
                  fill="none"
                  stroke="#00d2c8"
                  strokeWidth="3"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
                {yearlyData.values.map((val, i) => {
                  const x = 40 + (i / 11) * 720;
                  const y = 280 - (val / maxYearlyValue) * 240;
                  return (<circle key={`dot-${i}`} cx={x} cy={y} r="4" fill="#00d2c8" stroke="#fff" strokeWidth="1.5" />);
                })}
                <rect x="600" y="10" width="16" height="16" fill="#00d2c8" rx="2" />
                <text x="620" y="23" fontSize="12" fill="#1a1f26">Items Added</text>
              </svg>
            </div>
          ) : (
            <div className="no-items-message"><p>No data available for {new Date().getFullYear()} yet.</p></div>
          )}
        </div>
      </div>
    </div>
  );
};

export default TabDashboard;

// ============================================================
// Icon styling — dark icons on white cards, tinted on state.
// ============================================================
const tabDashboardIconCss = `
.dashboard-wrapper .tab-heading-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1em;
  height: 1em;
  margin-right: 8px;
  vertical-align: -0.15em;
  color: #1a1f26;
}
.dashboard-wrapper .tab-heading-icon svg {
  width: 100%;
  height: 100%;
  stroke-width: 2.2;
}

.dashboard-wrapper .item-view-image svg {
  width: 1em;
  height: 1em;
  stroke-width: 1.5;
  color: #a0a8b0;
}

.dashboard-wrapper .nav-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
}
.dashboard-wrapper .nav-btn-icon {
  width: 1em;
  height: 1em;
  stroke-width: 2.4;
}
.dashboard-wrapper .nav-btn-icon svg {
  width: 100%;
  height: 100%;
}

@media (max-width: 480px) {
  .dashboard-wrapper .tab-heading-icon { margin-right: 6px; }
}
`;