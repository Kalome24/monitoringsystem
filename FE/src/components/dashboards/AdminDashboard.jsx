// src/components/dashboards/AdminDashboard.jsx
import React, { useEffect, useState } from 'react';
import {
  FiBarChart2,
  FiClipboard,
  FiSend,
  FiAlertTriangle,
  FiCheckCircle,
  FiPackage,
  FiLock,
  FiDatabase,
  FiHome,
  FiUsers,
  FiMapPin,
  FiActivity,
  FiSettings,
  FiFileText,
  FiRepeat, // ← ADDED for UOM Conversions
} from 'react-icons/fi';
import { FaCar } from 'react-icons/fa';
import { useAdminData } from '../../hooks/useAdminData';
import { getUser } from '../../secure/auth';
import { stockTransferApi } from '../../services/api';
import DashboardLayout from '../../layout/DashboardLayout';

import TabDashboard from '../admin/TabDashboard';
import TabItemMasters from '../admin/TabItemMasters';
import TabEquipmentMasters from '../admin/TabEquipmentMasters';
import TabMasterData from '../admin/TabMasterData';
import TabWarehouse from '../admin/TabWarehouse';
import TabUsers from '../admin/TabUsers';
import TabReceivedPOs from '../shared/TabReceivedPOs';
import TabItemsReleased from '../handler/TabItemsReleased';
import TabDamagedItems from '../shared/TabDamagedItems';
import TabStockTransferApproval from '../departmenthead/TabStockTransferApproval';
import AdminLockedItemsTab from '../admin/AdminLockedItemsTab';
import TabInventoryLocators from '../admin/TabInventoryLocators';
import TabAudit from '../admin/TabAudit';
import OfflineConfigDashboard from '../admin/OfflineConfigDashboard';
import TabCostCenter from '../admin/TabCostCenter';
import TabUomConversion from '../admin/TabUomConversion'; // ← ADDED

const AdminDashboard = () => {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [pendingStsCount, setPendingStsCount] = useState(0);
  const adminData = useAdminData();
  const { fetching } = adminData;
  const currentUser = getUser();

  const canApproveSts =
    currentUser?.can_approve_sts === 1 ||
    currentUser?.can_approve_sts === true;

  // Fetch pending STS count for the badge
  const refreshPendingCount = async () => {
    if (!canApproveSts) return;
    try {
      const res = await stockTransferApi.getSummary();
      if (res.ok && res.data) {
        setPendingStsCount(Number(res.data.pendingForMe) || 0);
      }
    } catch (err) {
      console.warn('Could not load STS summary:', err);
    }
  };

  useEffect(() => {
    refreshPendingCount();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canApproveSts]);

  // Refresh whenever the user navigates away from the approval tab
  useEffect(() => {
    if (canApproveSts && activeTab !== 'stsapproval') {
      refreshPendingCount();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // Sidebar label for "STS Approval" — includes a red pill if pending > 0
  const stsApprovalLabel = (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        width: '100%',
      }}
    >
      <span>STS Approval</span>
      {pendingStsCount > 0 && (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            minWidth: 20,
            height: 18,
            padding: '0 6px',
            background: '#ef4444',
            color: '#ffffff',
            fontSize: 10,
            fontWeight: 700,
            borderRadius: 999,
            lineHeight: 1,
            letterSpacing: '0.02em',
            boxShadow: '0 1px 3px rgba(239, 68, 68, 0.4)',
          }}
        >
          {pendingStsCount}
        </span>
      )}
    </span>
  );

  const menuGroups = [
    {
      title: 'Main',
      items: [
        { id: 'dashboard', label: 'Dashboard & Reports', icon: <FiBarChart2 />, capability: 'dashboard.view' },
      ],
    },
    {
      title: 'Inventory Monitoring',
      items: [
        { id: 'receivedpos',   label: "Received PO's / PR's",    icon: <FiClipboard />,     capability: 'importpo.view' },
        { id: 'itemsreleased', label: 'Items Released',   icon: <FiSend />,          capability: 'itemsreleased.view' },
        { id: 'damageditems',  label: 'Damaged Items',    icon: <FiAlertTriangle />, capability: 'damageditems.view' },
        { id: 'locators',      label: 'Inventory Locators', icon: <FiMapPin />,      capability: null },
        { id: 'activity',      label: 'Activity Feed',    icon: <FiActivity />,      capability: 'audit.view' },
      ],
    },
    ...(canApproveSts
      ? [
          {
            title: 'Approvals',
            items: [
              {
                id: 'stsapproval',
                label: stsApprovalLabel,
                icon: <FiCheckCircle />,
                capability: null,
              },
            ],
          },
        ]
      : []),
    {
      title: 'Configuration',
      items: [
        { id: 'itemmasters', label: 'Item Masters', icon: <FiPackage />,   capability: 'itemmasters.view' },
        { id: 'equipmentmasters', label: 'Equipment Master', icon: <FaCar />, capability: 'equipmentmasters.view' },
        { id: 'uomconversion', label: 'UOM Conversions', icon: <FiRepeat />, capability: 'uomconversions.view' }, // ← ADDED
        { id: 'costcenter', label: 'Cost Center', icon: <FiFileText />, capability: 'costcenter.view' },
        { id: 'lockeditems', label: 'Locked Items', icon: <FiLock />,      capability: 'lockeditems.view' },
        { id: 'masterdata',  label: 'Master Data',  icon: <FiDatabase />,  capability: 'masterdata.view' },
        { id: 'offlineconfig', label: 'Offline Configurations', icon: <FiSettings />, capability: 'masterdata.view' },
        { id: 'warehouse',   label: 'Warehouse',    icon: <FiHome />,      capability: 'warehouse.view' },
      ],
    },
    {
      title: 'Access',
      items: [
        { id: 'users', label: 'Users', icon: <FiUsers />, capability: 'users.view' },
      ],
    },
  ];

  const renderTab = () => {
    switch (activeTab) {
      case 'dashboard':     return <TabDashboard adminData={adminData} onNavigate={setActiveTab} />;
      case 'lockeditems':   return <AdminLockedItemsTab />;
      case 'itemmasters':   return <TabItemMasters adminData={adminData} />;
      case 'equipmentmasters': return <TabEquipmentMasters adminData={adminData} />;
      case 'uomconversion': return <TabUomConversion adminData={adminData} />; // ← ADDED
      case 'costcenter':    return <TabCostCenter adminData={adminData} />;
      case 'receivedpos':   return <TabReceivedPOs />;
      case 'itemsreleased': return <TabItemsReleased adminData={adminData} />;
      case 'damageditems':  return <TabDamagedItems />;
      case 'locators':      return <TabInventoryLocators />;
      case 'activity':      return <TabAudit />;
      case 'stsapproval':   return <TabStockTransferApproval />;
      case 'masterdata':    return <TabMasterData adminData={adminData} />;
      case 'offlineconfig': return <OfflineConfigDashboard />;
      case 'warehouse':     return <TabWarehouse adminData={adminData} />;
      case 'users':         return <TabUsers />;
      default:              return null;
    }
  };

  const currentLabel =
    menuGroups
      .flatMap((g) => g.items)
      .find((i) => i.id === activeTab)?.label || 'Dashboard';

  const topbarTitle =
    activeTab === 'stsapproval' ? 'STS Approval' : currentLabel;

  return (
    <DashboardLayout
      menuGroups={menuGroups}
      activeTab={activeTab}
      onSelectTab={setActiveTab}
      title={topbarTitle}
      fetching={fetching}
    >
      {renderTab()}
    </DashboardLayout>
  );
};

export default AdminDashboard;