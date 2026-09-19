// src/layout/TopBar.jsx
import React from 'react';
import ProfileDropdown from './ProfileDropdown';

const TopBar = ({ title, onToggleSidebar, onTitleClick, extraBadge }) => {
  return (
    <header className="top-bar">
      <div className="top-bar-left">
        <button className="mobile-menu-btn" onClick={onToggleSidebar} aria-label="Toggle menu">
          ☰
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