// src/layout/DashboardLayout.jsx
import React, { useEffect, useState } from 'react';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import './DashboardLayout.css';

const MOBILE_QUERY = '(max-width: 768px)';

const getIsMobile = () =>
  typeof window !== 'undefined' && window.matchMedia(MOBILE_QUERY).matches;

const DashboardLayout = ({
  menuGroups,
  activeTab,
  onSelectTab,
  title,
  children,
  fetching = false,
  extraBadge = null,
}) => {
  const [isMobile, setIsMobile] = useState(getIsMobile);
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => !getIsMobile());

  useEffect(() => {
    const mql = window.matchMedia(MOBILE_QUERY);

    const handleChange = (e) => {
      const nextIsMobile = e.matches;
      setIsMobile((prev) => {
        if (prev !== nextIsMobile) {
          setIsSidebarOpen(!nextIsMobile);
        }
        return nextIsMobile;
      });
    };

    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', handleChange);
      return () => mql.removeEventListener('change', handleChange);
    }
    mql.addListener(handleChange);
    return () => mql.removeListener(handleChange);
  }, []);

  useEffect(() => {
    if (isMobile) setIsSidebarOpen(false);
  }, [activeTab, isMobile]);

  useEffect(() => {
    if (!isMobile) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = isSidebarOpen ? 'hidden' : (original || '');
    return () => {
      document.body.style.overflow = original || '';
    };
  }, [isMobile, isSidebarOpen]);

  useEffect(() => {
    if (!isMobile || !isSidebarOpen) return;
    const onKey = (e) => {
      if (e.key === 'Escape') setIsSidebarOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isMobile, isSidebarOpen]);

  const toggleSidebar = () => setIsSidebarOpen((v) => !v);
  const closeMobileSidebar = () => setIsSidebarOpen(false);

  const handleSelectTab = (tabId) => {
    onSelectTab(tabId);
    if (isMobile) setIsSidebarOpen(false);
  };

  return (
    <div
      className={`supadmin-container ${isMobile ? 'is-mobile' : 'is-desktop'} ${
        isSidebarOpen ? 'sidebar-is-open' : 'sidebar-is-closed'
      }`}
    >
      <Sidebar
        menuGroups={menuGroups}
        activeTab={activeTab}
        onSelectTab={handleSelectTab}
        isOpen={isSidebarOpen}
        onToggle={toggleSidebar}
        isMobile={isMobile}
        onCloseMobile={closeMobileSidebar}
      />

      <main className={`main-content ${isSidebarOpen ? 'sidebar-open' : 'sidebar-closed'}`}>
        <TopBar
          title={title}
          onToggleSidebar={toggleSidebar}
          onTitleClick={() => handleSelectTab('dashboard')}
          extraBadge={extraBadge}
          isSidebarOpen={isSidebarOpen}
        />

        <div className="dashboard-content">
          {fetching ? (
            <div className="loading-container">
              <div className="loading-spinner"></div>
              <p>Loading data...</p>
            </div>
          ) : (
            children
          )}
        </div>
      </main>
    </div>
  );
};

export default DashboardLayout;