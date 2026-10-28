// src/components/dashboards/StockHandler.jsx
import React, { useCallback, useEffect, useState } from 'react';
import {
  FiBarChart2,
  FiInbox,
  FiMapPin,
  FiAlertTriangle,
  FiRepeat,
  FiSend,
  FiCheckCircle,
  FiPackage,
  FiHome,
  FiSettings,
  FiFileText,
} from 'react-icons/fi';
import { FaCar } from 'react-icons/fa'; // <-- CHANGED ICON
import DashboardLayout from '../../layout/DashboardLayout';
import AssignmentBadge from '../../layout/AssignmentBadge';
import { useAdminData } from '../../hooks/useAdminData';
import { getUser } from '../../secure/auth';
import { stockTransferApi } from '../../services/api';
import { usePermissions } from '../../permissions/usePermissions';
import TabDashboard from '../admin/TabDashboard';
import TabItemMasters from '../admin/TabItemMasters';
import TabEquipmentMasters from '../admin/TabEquipmentMasters';
import TabItemsReleased from '../handler/TabItemsReleased';
import TabReceivedItems from '../handler/TabReceivedPO';
import TabStockTransfer from '../handler/TabStockTransfer';
import TabStockTransferApproval from '../departmenthead/TabStockTransferApproval';
import TabWarehouse from '../admin/TabWarehouse';
import InventoryLocatorSection from '../locator/InventoryLocatorSection';
import TabDamagedItems from '../shared/TabDamagedItems';
import UndergroundHandler from '../underground/UndergroundHandler';
import OfflineConfigDashboard from '../admin/OfflineConfigDashboard';
import TabCostCenter from '../admin/TabCostCenter';

const BADGE_REFRESH_MS = 60 * 1000;

const isUndergroundHandler = (user) => {
  if (!user) return false;
  const pos = String(user.emp_position || '').trim().toLowerCase();
  return pos === 'underground handler';
};

const StockHandler = () => {
  const currentUser = getUser();
  if (isUndergroundHandler(currentUser)) {
    return <UndergroundHandler />;
  }
  return <SurfaceStockHandler />;
};

const SurfaceStockHandler = () => {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [pendingStsCount, setPendingStsCount] = useState(0);
  const [transferActionsCount, setTransferActionsCount] = useState(0);
  const [transferRejectionsCount, setTransferRejectionsCount] = useState(0);

  const adminData = useAdminData();
  const { fetching } = adminData;
  const { can } = usePermissions();
  const currentUser = getUser();

  const canSeeEquipment = can('equipmentmasters.view');

  const canApproveSts =
    currentUser?.can_approve_sts === 1 ||
    currentUser?.can_approve_sts === true;

  const isSurfaceHandler =
    String(currentUser?.emp_position || '').trim() === 'Surface Handler';
  
  const isUG = currentUser?.warehouse_code === 'UG';

  const refreshSummaryCounts = useCallback(async () => {
    try {
      const res = await stockTransferApi.getSummary();
      if (!res.ok || !res.data) return;

      const data = res.data;

      if (canApproveSts) {
        setPendingStsCount(Number(data.pendingForMe) || 0);
      } else {
        setPendingStsCount(0);
      }

      const actions = data.handlerActions || {};
      setTransferActionsCount(Number(actions.total) || 0);
      setTransferRejectionsCount(Number(actions.rejections) || 0);
    } catch (err) {
      console.warn('Could not load STS summary:', err);
    }
  }, [canApproveSts]);

  useEffect(() => {
    refreshSummaryCounts();
  }, [refreshSummaryCounts]);

  useEffect(() => {
    refreshSummaryCounts();
  }, [activeTab, refreshSummaryCounts]);

  useEffect(() => {
    const t = setInterval(refreshSummaryCounts, BADGE_REFRESH_MS);
    return () => clearInterval(t);
  }, [refreshSummaryCounts]);

  useEffect(() => {
    const onFocus = () => refreshSummaryCounts();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refreshSummaryCounts]);

  useEffect(() => {
    const onStsChanged = () => refreshSummaryCounts();
    window.addEventListener('sts:changed', onStsChanged);
    return () => window.removeEventListener('sts:changed', onStsChanged);
  }, [refreshSummaryCounts]);

  const stsApprovalLabel = (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, width: '100%' }}>
      <span>STS Approval</span>
      {pendingStsCount > 0 && (
        <span
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            minWidth: 20, height: 18, padding: '0 6px',
            background: '#ef4444', color: '#ffffff',
            fontSize: 10, fontWeight: 700, borderRadius: 999,
            lineHeight: 1, letterSpacing: '0.02em',
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
      title: 'Receiving & Storage',
      items: [
        { id: 'receiveditems',    label: 'Received Items',    icon: <FiInbox />,          capability: 'stocktransfer.view' },
        { id: 'inventorylocator', label: 'Inventory Locator', icon: <FiMapPin />,         capability: 'inventorylocator.view' },
        { id: 'damageditems',     label: 'Damaged Items',     icon: <FiAlertTriangle />,  capability: 'damageditems.view' },
      ],
    },
    {
      title: 'Transfers & Outflow',
      items: [
        {
          id: 'transferstocks',
          label: 'Transfer Stocks',
          icon: <FiRepeat />,
          capability: 'stocktransfer.view',
          badge: transferActionsCount,
          badgeTone: transferRejectionsCount > 0 ? 'amber' : undefined,
        },
        { id: 'itemsreleased', label: 'Items Released', icon: <FiSend />, capability: 'itemsreleased.view' },
      ],
    },
    ...(canApproveSts
      ? [
          {
            title: 'Approvals',
            items: [
              { id: 'stsapproval', label: stsApprovalLabel, icon: <FiCheckCircle />, capability: null },
            ],
          },
        ]
      : []),
    {
      title: 'Reference',
      items: [
        { id: 'itemmasters', label: 'Item Masters', icon: <FiPackage />, capability: 'itemmasters.view' },
        ...(canSeeEquipment ? [{ id: 'equipmentmasters', label: 'Equipment Master', icon: <FaCar />, capability: 'equipmentmasters.view' }] : []), // <-- CHANGED ICON
        { id: 'costcenter',  label: 'Cost Center',  icon: <FiFileText />, capability: 'costcenter.view' },
        { id: 'warehouse',   label: 'Warehouse',    icon: <FiHome />,    capability: 'warehouse.view' },
      ],
    },
    ...(isSurfaceHandler && isUG
      ? [
          {
            title: 'Configuration',
            items: [
              { id: 'offlineconfig', label: 'Offline Configurations', icon: <FiSettings />, capability: null },
            ],
          },
        ]
      : []),
  ];

  const renderTab = () => {
    switch (activeTab) {
      case 'dashboard':         return <TabDashboard adminData={adminData} />;
      case 'itemsreleased':     return <TabItemsReleased adminData={adminData} />;
      case 'receiveditems':     return <TabReceivedItems />;
      case 'transferstocks':    return <TabStockTransfer />;
      case 'inventorylocator':  return <InventoryLocatorSection />;
      case 'damageditems':      return <TabDamagedItems />;
      case 'stsapproval':       return <TabStockTransferApproval />;
      case 'itemmasters':       return <TabItemMasters adminData={adminData} />;
      case 'equipmentmasters':  return <TabEquipmentMasters adminData={adminData} />;
      case 'costcenter':        return <TabCostCenter adminData={adminData} />;
      case 'warehouse':         return <TabWarehouse adminData={adminData} />;
      case 'offlineconfig':     return <OfflineConfigDashboard />;
      default:                  return null;
    }
  };

  const currentLabel =
    menuGroups.flatMap((g) => g.items).find((i) => i.id === activeTab)?.label || 'Dashboard';

  const topbarTitle =
    activeTab === 'stsapproval' ? 'STS Approval' : currentLabel;

  return (
    <DashboardLayout
      menuGroups={menuGroups}
      activeTab={activeTab}
      onSelectTab={setActiveTab}
      title={topbarTitle}
      fetching={fetching}
      extraBadge={<AssignmentBadge />}
    >
      {renderTab()}
    </DashboardLayout>
  );
};

export default StockHandler;