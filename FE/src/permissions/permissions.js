// src/permissions/permissions.js
import { ROLES } from './roles';

export const ROLE_PERMISSIONS = {
  [ROLES.SUPER_ADMIN]: ['*'],

  [ROLES.ADMIN]: [
    'dashboard.view',

    'itemmasters.view', 'itemmasters.create', 'itemmasters.edit', 'itemmasters.delete',

    'itemsreceived.view',
    'itemsreleased.view',
    'damageditems.view',

    // ---- Import PO ----
    'importpo.view', 'importpo.create', 'importpo.receive', 'importpo.delete',

    // ---- Stock Transfer (Admin can also transfer/store) ----
    'stocktransfer.view', 'stocktransfer.create', 'stocktransfer.delete',
    'stocktransfer.receive',   // ← NEW (admin can receive for any warehouse)

    'masterdata.view', 'masterdata.create', 'masterdata.edit', 'masterdata.delete',

    'warehouse.view', 'warehouse.create', 'warehouse.edit', 'warehouse.delete',

    // ---- Users — VIEW ONLY for Admin ----
    'users.view',

    'audit.view',
  ],

  [ROLES.REGISTRAR]: [
    'dashboard.view',

    'itemmasters.view',

    'itemsreceived.view', 'itemsreceived.create', 'itemsreceived.edit', 'itemsreceived.delete',

    'damageditems.view',

    // ---- Import PO (Registrar can import + receive, but not delete) ----
    'importpo.view', 'importpo.create', 'importpo.receive',

    // ---- Stock Transfer (Registrar receives incoming transfers) ----
    'stocktransfer.view',      // ← NEW — can see the tab
    'stocktransfer.receive',   // ← NEW — can confirm receipt

    'masterdata.view',

    'warehouse.view',
  ],

  [ROLES.HANDLER]: [
    'dashboard.view',

    'itemmasters.view',

    'itemsreleased.view', 'itemsreleased.create', 'itemsreleased.edit', 'itemsreleased.delete',

    // ---- Stock Transfer ----
    'stocktransfer.view', 'stocktransfer.create',

    'warehouse.view',
  ],
};

export const roleCan = (role, capability) => {
  if (!role) return false;
  const caps = ROLE_PERMISSIONS[role] || [];
  if (caps.includes('*')) return true;
  return caps.includes(capability);
};