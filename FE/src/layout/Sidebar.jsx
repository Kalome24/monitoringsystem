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

  // Close on outside click — mobile only.
  useEffect(() => {
    if (!isMobile || !isOpen) return;
    const handleClickOutside = (e) => {
      if (sidebarRef.current && !sidebarRef.current.contains(e.target)) {
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

  const handleItemClick = (itemId) => {
    onSelectTab(itemId);
    if (isMobile) onCloseMobile();
  };

  return (
    <>
      {isMobile && isOpen && (
        <div
          className="sidebar-overlay"
          onClick={onCloseMobile}
          aria-hidden="true"
        />
      )}

      <aside
        ref={sidebarRef}
        className={`sidebar ${isOpen ? 'open' : 'closed'} ${
          isMobile ? 'is-mobile' : 'is-desktop'
        }`}
        aria-hidden={isMobile && !isOpen}
      >
        <div className="sidebar-header">
          <img
            src="/ims-logo.png"
            alt="Inventory Monitoring System"
            className="sidebar-header-logo"
            draggable="false"
          />
          <span className="sidebar-header-wordmark">IMS</span>
          {isMobile ? (
            <button
              type="button"
              className="sidebar-header-toggle sidebar-close-btn"
              onClick={onCloseMobile}
              aria-label="Close menu"
            >
              ✕
            </button>
          ) : (
            <button
              type="button"
              className="sidebar-header-toggle"
              onClick={onToggle}
              aria-label="Toggle sidebar"
            >
              {isOpen ? '◀' : '▶'}
            </button>
          )}
        </div>

        <nav className="sidebar-nav">
          {visibleGroups.map((group, gi) => (
            <div key={gi} className="nav-group">
              <span className="nav-group-title">{group.title}</span>
              <ul>
                {group.items.map((item) => {
                  const hasBadge = typeof item.badge === 'number' && item.badge > 0;
                  const badgeClass =
                    'nav-badge' +
                    (item.badgeTone === 'amber' ? ' nav-badge--amber' : '');
                  return (
                    <li key={item.id} className={activeTab === item.id ? 'active' : ''}>
                      <button
                        type="button"
                        onClick={() => handleItemClick(item.id)}
                        aria-label={item.label}
                      >
                        <span className="nav-icon">{item.icon}</span>
                        <span className="nav-label">{item.label}</span>
                        {hasBadge && (
                          <span
                            className={badgeClass}
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

        <div className="sidebar-footer">
          <img
            src="/lepantologo.svg"
            alt="Lepanto"
            className="sidebar-footer-logo"
            draggable="false"
          />
        </div>
      </aside>
    </>
  );
};

export default Sidebar;