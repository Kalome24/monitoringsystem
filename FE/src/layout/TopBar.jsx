// src/layout/TopBar.jsx
import React from 'react';
import { FiMenu } from 'react-icons/fi';
import ProfileDropdown from './ProfileDropdown';

const TopBar = ({
  title,
  onToggleSidebar,
  onTitleClick,
  extraBadge,
  isSidebarOpen = false,
}) => {
  return (
    <header className="top-bar">
      <div className="top-bar-left">
        <button
          type="button"
          className="mobile-menu-btn"
          onClick={onToggleSidebar}
          aria-label={isSidebarOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={isSidebarOpen}
        >
          <FiMenu aria-hidden="true" />
        </button>
        <h1 onClick={onTitleClick} style={{ cursor: 'pointer' }}>{title}</h1>
      </div>
      <div className="top-bar-right">
        {extraBadge}
        <ProfileDropdown />
      </div>
    </header>
  );
};

export default TopBar;