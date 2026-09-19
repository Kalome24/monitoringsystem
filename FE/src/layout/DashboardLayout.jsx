// src/layout/DashboardLayout.jsx
import React, { useEffect, useState } from 'react';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import './DashboardLayout.css';

const DashboardLayout = ({
  menuGroups,
  activeTab,
  onSelectTab,
  title,
  children,
  fetching = false,
  extraBadge = null,
}) => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);

  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth <= 768;
      setIsMobile(mobile);
      setIsSidebarOpen(!mobile);
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const toggleSidebar = () => setIsSidebarOpen((v) => !v);
  const closeMobileSidebar = () => setIsSidebarOpen(false);

  return (
    <div className="supadmin-container">
      <Sidebar
        menuGroups={menuGroups}
        activeTab={activeTab}
        onSelectTab={onSelectTab}
        isOpen={isSidebarOpen}
        onToggle={toggleSidebar}
        isMobile={isMobile}
        onCloseMobile={closeMobileSidebar}
      />

      <main className={`main-content ${isSidebarOpen ? 'sidebar-open' : 'sidebar-closed'}`}>
        <TopBar
          title={title}
          onToggleSidebar={toggleSidebar}
          onTitleClick={() => onSelectTab('dashboard')}
          extraBadge={extraBadge}
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