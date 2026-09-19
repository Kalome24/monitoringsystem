// src/layout/Sidebar.jsx
import React, { useEffect, useRef } from 'react';
import { usePermissions } from '../permissions/usePermissions';

const Sidebar = ({
  menuGroups,
  activeTab,
  onSelectTab,
  isOpen,
  onToggle,
  isMobile,
  onCloseMobile,
}) => {
  const sidebarRef = useRef(null);
  const { can } = usePermissions();

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (isMobile && isOpen && sidebarRef.current && !sidebarRef.current.contains(e.target)) {
        onCloseMobile();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isMobile, isOpen, onCloseMobile]);

  const visibleGroups = menuGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => !item.capability || can(item.capability)),
    }))
    .filter((group) => group.items.length > 0);

  return (
    <>
      {isMobile && isOpen && (
        <div className="sidebar-overlay" onClick={onCloseMobile}></div>
      )}

      <aside ref={sidebarRef} className={`sidebar ${isOpen ? 'open' : 'closed'}`}>
        <div className="sidebar-header">
          <div className="sidebar-logo" style={{ cursor: 'pointer' }}>
            <div className="logo-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
                <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
              </svg>
            </div>
            <span>Inventory</span>
          </div>
          <button className="sidebar-toggle" onClick={onToggle} aria-label="Toggle sidebar">
            {isOpen ? '◀' : '▶'}
          </button>
        </div>

        <nav className="sidebar-nav">
          {visibleGroups.map((group, gi) => (
            <div key={gi} className="nav-group">
              <span className="nav-group-title">{group.title}</span>
              <ul>
                {group.items.map((item) => {
                  const hasBadge =
                    typeof item.badge === 'number' && item.badge > 0;
                  return (
                    <li key={item.id} className={activeTab === item.id ? 'active' : ''}>
                      <button
                        onClick={() => onSelectTab(item.id)}
                        aria-label={item.label}
                      >
                        <span className="nav-icon">{item.icon}</span>
                        <span className="nav-label">{item.label}</span>
                        {hasBadge && (
                          <span
                            className="nav-badge"
                            aria-label={`${item.badge} pending`}
                          >
                            {item.badge > 99 ? '99+' : item.badge}
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
      </aside>
    </>
  );
};

export default Sidebar;