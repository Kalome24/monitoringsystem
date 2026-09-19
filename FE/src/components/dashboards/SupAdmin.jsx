// src/components/dashboards/SupAdmin.jsx
import React, { useState } from 'react';
import DashboardLayout from '../../layout/DashboardLayout';
import { useAdminData } from '../../hooks/useAdminData';

import TabDashboard from '../admin/TabDashboard';
import TabItemMasters from '../admin/TabItemMasters';
import TabMasterData from '../admin/TabMasterData';
import TabWarehouse from '../admin/TabWarehouse';
import TabUsers from '../admin/TabUsers';
import TabAudit from '../admin/TabAudit';
import TabItemsReceived from '../registrar/TabItemsReceived';
import TabItemsReleased from '../handler/TabItemsReleased';
import TabDamagedItems from '../registrar/TabDamagedItems';

const SupAdmin = () => {
  const [activeTab, setActiveTab] = useState('dashboard');
  const adminData = useAdminData();
  const { fetching } = adminData;

  const menuGroups = [
    {
      title: 'Main',
      items: [
        { id: 'dashboard', label: 'Dashboard & Reports', icon: '📊', capability: 'dashboard.view' },
      ],
    },
    {
      title: 'Inventory',
      items: [
                { id: 'itemmasters',   label: 'Item Masters',   icon: '📋', capability: 'itemmasters.view' },
        { id: 'itemsreceived', label: 'Items Received', icon: '📥', capability: 'itemsreceived.view' },
        { id: 'itemsreleased', label: 'Items Released', icon: '📤', capability: 'itemsreleased.view' },
        { id: 'damageditems',  label: 'Damaged Items',  icon: '⚠️', capability: 'damageditems.view' },

      ],
    },
    {
      title: 'Administration',
      items: [
        { id: 'masterdata', label: 'Master Data',     icon: '🔧', capability: 'masterdata.view' },
        { id: 'warehouse',  label: 'Warehouse',       icon: '🏭', capability: 'warehouse.view' },
        { id: 'users',      label: 'User Management', icon: '👥', capability: 'users.view' },
        { id: 'audit',      label: 'Audit Logs',      icon: '📋', capability: 'audit.view' },
      ],
    },
  ];

  const renderTab = () => {
    switch (activeTab) {
      case 'dashboard':     return <TabDashboard adminData={adminData} />;
      case 'itemsreceived': return <TabItemsReceived adminData={adminData} />;
      case 'itemsreleased': return <TabItemsReleased adminData={adminData} />;
      case 'damageditems':  return <TabDamagedItems />;
      case 'itemmasters':   return <TabItemMasters adminData={adminData} />;
      case 'masterdata':    return <TabMasterData adminData={adminData} />;
      case 'warehouse':     return <TabWarehouse adminData={adminData} />;
      case 'users':         return <TabUsers />;
      case 'audit':         return <TabAudit />;
      default:              return null;
    }
  };

  const currentLabel =
    menuGroups.flatMap((g) => g.items).find((i) => i.id === activeTab)?.label || 'Dashboard';

  return (
    <DashboardLayout
      menuGroups={menuGroups}
      activeTab={activeTab}
      onSelectTab={setActiveTab}
      title={currentLabel}
      fetching={fetching}
    >
      {renderTab()}
    </DashboardLayout>
  );
};

export default SupAdmin;