// src/components/dashboards/RegistrarDashboard.jsx
import React, { useCallback, useEffect, useState } from 'react';
import DashboardLayout from '../../layout/DashboardLayout';
import AssignmentBadge from '../../layout/AssignmentBadge';
import { useAdminData } from '../../hooks/useAdminData';
import { stockTransferApi } from '../../services/api';
import { getUser } from '../../secure/auth';
import { usePermissions } from '../../permissions/usePermissions';
import TabDashboard from '../admin/TabDashboard';
import TabItemMasters from '../admin/TabItemMasters';
import TabItemsReceived from '../registrar/TabItemsReceived';
import TabDamagedItems from '../registrar/TabDamagedItems';
import TabStockTransfer from '../registrar/TabStockTransfer';
import TabWarehouse from '../admin/TabWarehouse';

const POLL_INTERVAL_MS = 60000; // refresh badge every 60s

const RegistrarDashboard = () => {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [incomingCount, setIncomingCount] = useState(0);
  const adminData = useAdminData();
  const { fetching } = adminData;
  const { can } = usePermissions();
  const currentUser = getUser();

  const canSeeStockTransfer = can('stocktransfer.view');

  // ---------- Sidebar badge: poll incoming STS count ----------
  const refreshIncomingCount = useCallback(async () => {
    if (!canSeeStockTransfer) return;
    try {
      const res = await stockTransferApi.getIncomingSummary();
      if (res.ok && res.data) {
        setIncomingCount(res.data.approved || 0);
      }
    } catch (err) {
      // silent — badge is best-effort
    }
  }, [canSeeStockTransfer]);

  useEffect(() => {
    if (!canSeeStockTransfer) return;
    if (!currentUser) return;

    let cancelled = false;

    const tick = async () => {
      if (cancelled) return;
      await refreshIncomingCount();
    };

    tick();
    const interval = setInterval(tick, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canSeeStockTransfer, currentUser?.id]);

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
        { id: 'itemsreceived', label: 'Receive PO/PR', icon: '📥', capability: 'itemsreceived.view' },
        {
          id: 'stocktransfer',
          label: 'Stock Transfer',
          icon: '🚚',
          capability: 'stocktransfer.view',
          badge: incomingCount,
        },
        { id: 'damageditems', label: 'Damaged Items', icon: '⚠️', capability: 'damageditems.view' },
        { id: 'itemmasters',  label: 'Item Masters',  icon: '📋', capability: 'itemmasters.view' },
        { id: 'warehouse',    label: 'Warehouse',     icon: '🏭', capability: 'warehouse.view' },
      ],
    },
  ];

  const renderTab = () => {
    switch (activeTab) {
      case 'dashboard':     return <TabDashboard adminData={adminData} />;
      case 'itemsreceived': return <TabItemsReceived adminData={adminData} />;
      case 'stocktransfer':
        return (
          <TabStockTransfer
            onIncomingCountChange={setIncomingCount}
          />
        );
      case 'damageditems':  return <TabDamagedItems />;
      case 'itemmasters':   return <TabItemMasters adminData={adminData} />;
      case 'warehouse':     return <TabWarehouse adminData={adminData} />;
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
      extraBadge={<AssignmentBadge />}
    >
      {renderTab()}
    </DashboardLayout>
  );
};

export default RegistrarDashboard;