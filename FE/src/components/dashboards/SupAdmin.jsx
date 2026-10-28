// src/components/dashboards/SupAdmin.jsx
import React, { useState } from 'react';
import {
  FiBarChart2,
  FiPackage,
  FiClipboard,
  FiSend,
  FiAlertTriangle,
  FiDatabase,
  FiHome,
  FiUserCheck,
  FiActivity,
  FiMapPin,
  FiSettings,
  FiFileText,
  FiRepeat, // ← ADDED for UOM Conversions
} from 'react-icons/fi';
import { FaCar } from 'react-icons/fa';
import DashboardLayout from '../../layout/DashboardLayout';
import { useAdminData } from '../../hooks/useAdminData';

import TabDashboard from '../admin/TabDashboard';
import TabItemMasters from '../admin/TabItemMasters';
import TabEquipmentMasters from '../admin/TabEquipmentMasters';
import TabMasterData from '../admin/TabMasterData';
import TabWarehouse from '../admin/TabWarehouse';
import TabUsers from '../admin/TabUsers';
import TabAudit from '../admin/TabAudit';
import TabReceivedPOs from '../shared/TabReceivedPOs';
import TabItemsReleased from '../handler/TabItemsReleased';
import TabDamagedItems from '../shared/TabDamagedItems';
import TabInventoryLocators from '../admin/TabInventoryLocators';
import OfflineConfigDashboard from '../admin/OfflineConfigDashboard';
import TabCostCenter from '../admin/TabCostCenter';
import TabUomConversion from '../admin/TabUomConversion'; // ← ADDED

const SupAdmin = () => {
  const [activeTab, setActiveTab] = useState('dashboard');
  const adminData = useAdminData();
  const { fetching } = adminData;

  const menuGroups = [
    {
      title: 'Main',
      items: [
        { id: 'dashboard', label: 'Dashboard & Reports', icon: <FiBarChart2 />, capability: 'dashboard.view' },
      ],
    },
    {
      title: 'Inventory',
      items: [
        { id: 'itemmasters',   label: 'Item Masters',       icon: <FiPackage />,       capability: 'itemmasters.view' },
        { id: 'receivedpos',   label: "Received PO's",      icon: <FiClipboard />,     capability: 'importpo.view' },
        { id: 'itemsreleased', label: 'Items Released',     icon: <FiSend />,          capability: 'itemsreleased.view' },
        { id: 'damageditems',  label: 'Damaged Items',      icon: <FiAlertTriangle />, capability: 'damageditems.view' },
        { id: 'locators',      label: 'Inventory Locators', icon: <FiMapPin />,        capability: null },
      ],
    },
    {
      title: 'Administration',
      items: [
        { id: 'masterdata', label: 'Master Data',     icon: <FiDatabase />,  capability: 'masterdata.view' },
        { id: 'equipmentmasters', label: 'Equipment Master', icon: <FaCar />, capability: 'equipmentmasters.view' },
        { id: 'uomconversion', label: 'UOM Conversions', icon: <FiRepeat />, capability: 'uomconversions.view' }, // ← ADDED
        { id: 'costcenter', label: 'Cost Center',     icon: <FiFileText />,  capability: 'costcenter.view' },
        { id: 'offlineconfig', label: 'Offline Configurations', icon: <FiSettings />, capability: 'masterdata.view' },
        { id: 'warehouse',  label: 'Warehouse',       icon: <FiHome />,      capability: 'warehouse.view' },
        { id: 'users',      label: 'User Management', icon: <FiUserCheck />, capability: 'users.view' },
        { id: 'activity',   label: 'Activity Feed',   icon: <FiActivity />,  capability: 'audit.view' },
      ],
    },
  ];

  const renderTab = () => {
    switch (activeTab) {
      case 'dashboard':     return <TabDashboard adminData={adminData} />;
      case 'receivedpos':   return <TabReceivedPOs />;
      case 'itemsreleased': return <TabItemsReleased adminData={adminData} />;
      case 'damageditems':  return <TabDamagedItems />;
      case 'locators':      return <TabInventoryLocators />;
      case 'itemmasters':   return <TabItemMasters adminData={adminData} />;
      case 'equipmentmasters': return <TabEquipmentMasters adminData={adminData} />;
      case 'uomconversion': return <TabUomConversion adminData={adminData} />; // ← ADDED
      case 'costcenter':    return <TabCostCenter adminData={adminData} />;
      case 'masterdata':    return <TabMasterData adminData={adminData} />;
      case 'offlineconfig': return <OfflineConfigDashboard />;
      case 'warehouse':     return <TabWarehouse adminData={adminData} />;
      case 'users':         return <TabUsers />;
      case 'activity':      return <TabAudit />;
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