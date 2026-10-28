// src/components/dashboards/RegistrarDashboard.jsx
import React, { useCallback, useEffect, useState } from 'react';
import {
  FiBarChart2,
  FiUpload,
  FiInbox,
  FiTruck,
  FiAlertTriangle,
  FiPackage,
  FiHome,
  FiActivity,
  FiFileText,
} from 'react-icons/fi';
import { FaCar } from 'react-icons/fa'; // <-- CHANGED ICON
import DashboardLayout from '../../layout/DashboardLayout';
import AssignmentBadge from '../../layout/AssignmentBadge';
import { useAdminData } from '../../hooks/useAdminData';
import { stockTransferApi } from '../../services/api';
import { getUser } from '../../secure/auth';
import { usePermissions } from '../../permissions/usePermissions';
import TabDashboard from '../admin/TabDashboard';
import TabItemMasters from '../admin/TabItemMasters';
import TabEquipmentMasters from '../admin/TabEquipmentMasters';
import TabItemsReceived from '../registrar/TabItemsReceived';
import TabDamagedItems from '../shared/TabDamagedItems';
import TabInTransitReceive from '../registrar/TabInTransitReceive';
import TabImportPo from '../registrar/TabImportPo';
import TabWarehouse from '../admin/TabWarehouse';
import TabAudit from '../admin/TabAudit';
import TabCostCenter from '../admin/TabCostCenter';

const POLL_INTERVAL_MS = 60000; // refresh badge every 60s

const RegistrarDashboard = () => {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [incomingCount, setIncomingCount] = useState(0);
  const adminData = useAdminData();
  const { fetching } = adminData;
  const { can } = usePermissions();
  const currentUser = getUser();

  const canSeeStockTransfer = can('stocktransfer.view');
  const canImportPo = can('importpo.create');
  const canSeeEquipment = can('equipmentmasters.view');

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

  // ── Sidebar groups ────────────────────────────────────────────────
  const menuGroups = [
    {
      title: 'Main',
      items: [
        { id: 'dashboard', label: 'Dashboard & Reports', icon: <FiBarChart2 />, capability: 'dashboard.view' },
      ],
    },
    {
      title: 'Purchase Orders',
      items: [
        ...(canImportPo
          ? [{ id: 'importpo', label: 'Import POs', icon: <FiUpload />, capability: 'importpo.create' }]
          : []),
        { id: 'itemsreceived', label: 'Received Items', icon: <FiInbox />, capability: 'itemsreceived.view' },
      ],
    },
    {
      title: 'Warehouse Operations',
      items: [
        {
          id: 'intransit',
          label: 'In-Transit for Receiving',
          icon: <FiTruck />,
          capability: 'stocktransfer.receive',
          badge: incomingCount,
        },
        { id: 'damageditems', label: 'Damaged Items', icon: <FiAlertTriangle />, capability: 'damageditems.view' },
        { id: 'activity',     label: 'Activity Feed', icon: <FiActivity />,      capability: null },
      ],
    },
    {
      title: 'Reference',
      items: [
        { id: 'itemmasters', label: 'Item Masters', icon: <FiPackage />, capability: 'itemmasters.view' },
        ...(canSeeEquipment ? [{ id: 'equipmentmasters', label: 'Equipment Master', icon: <FaCar />, capability: 'equipmentmasters.view' }] : []), // <-- CHANGED ICON
        { id: 'costcenter',  label: 'Cost Center',  icon: <FiFileText />, capability: 'costcenter.view' },
        { id: 'warehouse',   label: 'Warehouse',    icon: <FiHome />,    capability: 'warehouse.view' },
      ],
    },
  ];

  const renderTab = () => {
    switch (activeTab) {
      case 'dashboard':     return <TabDashboard adminData={adminData} />;
      case 'importpo':      return <TabImportPo />;
      case 'itemsreceived': return <TabItemsReceived adminData={adminData} />;
      case 'intransit':     return <TabInTransitReceive />;
      case 'damageditems':  return <TabDamagedItems />;
      case 'activity':      return (
        <TabAudit
          lockWarehouse
          defaultWarehouseCode={currentUser?.warehouse_code || null}
        />
      );
      case 'itemmasters':   return <TabItemMasters adminData={adminData} />;
      case 'equipmentmasters': return <TabEquipmentMasters adminData={adminData} />;
      case 'costcenter':    return <TabCostCenter adminData={adminData} />;
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