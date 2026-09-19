// src/components/dashboards/StockHandler.jsx
import React, { useEffect, useState } from 'react';
import DashboardLayout from '../../layout/DashboardLayout';
import AssignmentBadge from '../../layout/AssignmentBadge';
import { useAdminData } from '../../hooks/useAdminData';
import { getUser } from '../../secure/auth';
import { stockTransferApi } from '../../services/api';
import TabDashboard from '../admin/TabDashboard';
import TabItemMasters from '../admin/TabItemMasters';
import TabItemsReleased from '../handler/TabItemsReleased';
import TabReceivedItems from '../handler/TabReceivedPO';
import TabInTransitStocks from '../handler/TabTransitStocks';
import TabStockTransferApproval from '../departmenthead/TabStockTransferApproval';
import TabWarehouse from '../admin/TabWarehouse';

const StockHandler = () => {
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

  const inventoryItems = [
     { id: 'receiveditems', label: 'Received Items',    icon: '📥', capability: 'stocktransfer.view' },
         { id: 'intransit',     label: 'In-Transit Stocks', icon: '🚚', capability: 'stocktransfer.view' },
    { id: 'itemsreleased', label: 'Items Released',    icon: '📤', capability: 'itemsreleased.view' },
  ];

  if (canApproveSts) {
    inventoryItems.push({
      id: 'stsapproval',
      label: stsApprovalLabel,
      icon: '✅',
      capability: null,
    });
  }

  inventoryItems.push(
    { id: 'itemmasters', label: 'Item Masters', icon: '📋', capability: 'itemmasters.view' },
    { id: 'warehouse',   label: 'Warehouse',    icon: '🏭', capability: 'warehouse.view' },
  );

  const menuGroups = [
    {
      title: 'Main',
      items: [
        { id: 'dashboard', label: 'Dashboard & Reports', icon: '📊', capability: 'dashboard.view' },
      ],
    },
    {
      title: 'Inventory',
      items: inventoryItems,
    },
  ];

  const renderTab = () => {
    switch (activeTab) {
      case 'dashboard':     return <TabDashboard adminData={adminData} />;
      case 'itemsreleased': return <TabItemsReleased adminData={adminData} />;
      case 'receiveditems': return <TabReceivedItems />;
      case 'intransit':     return <TabInTransitStocks />;
      case 'stsapproval':   return <TabStockTransferApproval />;
      case 'itemmasters':   return <TabItemMasters adminData={adminData} />;
      case 'warehouse':     return <TabWarehouse adminData={adminData} />;
      default:              return null;
    }
  };

  const currentLabel =
    menuGroups
      .flatMap((g) => g.items)
      .find((i) => i.id === activeTab)?.label || 'Dashboard';

  // If the label is a JSX element (STS Approval), fall back to a plain string for the topbar title
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