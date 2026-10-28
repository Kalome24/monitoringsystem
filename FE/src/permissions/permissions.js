// src/permissions/permissions.js
import { ROLES } from './roles';

export const ROLE_PERMISSIONS = {
  [ROLES.SUPER_ADMIN]: ['*'],

  [ROLES.ADMIN]: [
    'dashboard.view',

    'itemmasters.view', 'itemmasters.create', 'itemmasters.edit', 'itemmasters.delete',
    
    'equipmentmasters.view', 'equipmentmasters.create', 'equipmentmasters.edit', 'equipmentmasters.delete',
    
    'costcenter.view', 'costcenter.create', 'costcenter.edit', 'costcenter.delete',

    // ---- UOM Conversions (Admin = full configure) ----
    'uomconversions.view', 'uomconversions.create', 'uomconversions.edit', 'uomconversions.delete',

    'itemsreceived.view',
    'itemsreleased.view',
    'damageditems.view',

    // ---- Import PO ----
    'importpo.view', 'importpo.create', 'importpo.receive', 'importpo.delete',

    // ---- Locked Items ----
    'lockeditems.view', 'lockeditems.create', 'lockeditems.edit', 'lockeditems.delete',

    // ---- Stock Transfer ----
    'stocktransfer.view', 'stocktransfer.create', 'stocktransfer.delete',
    'stocktransfer.receive',

    // ---- Inventory Locator ----
    'inventorylocator.view', 'inventorylocator.manage',

    'masterdata.view', 'masterdata.create', 'masterdata.edit', 'masterdata.delete',

    'warehouse.view', 'warehouse.create', 'warehouse.edit', 'warehouse.delete',

    'users.view',

    'audit.view',
  ],

  [ROLES.REGISTRAR]: [
    'dashboard.view',

    'itemmasters.view',
    'equipmentmasters.view',
    'costcenter.view',

    // ---- UOM Conversions (Registrar = view only) ----
    'uomconversions.view',

    'itemsreceived.view', 'itemsreceived.create', 'itemsreceived.edit', 'itemsreceived.delete',

    'damageditems.view',

    'importpo.view', 'importpo.create', 'importpo.receive',

    'stocktransfer.view',
    'stocktransfer.receive',

    // ---- Inventory Locator (view only for Registrar) ----
    'inventorylocator.view',

    'masterdata.view',

    'warehouse.view',
  ],

  [ROLES.HANDLER]: [
    'dashboard.view',

    'itemmasters.view',
    'equipmentmasters.view',
    'costcenter.view',

    // ---- UOM Conversions (Handler = view only) ----
    'uomconversions.view',

    'itemsreleased.view', 'itemsreleased.create', 'itemsreleased.edit', 'itemsreleased.delete',

    // ---- Stock Transfer ----
    'stocktransfer.view', 'stocktransfer.create',

    // ---- Inventory Locator (full access for Handler) ----
    'inventorylocator.view', 'inventorylocator.manage',

    // ---- Damaged Items (read-only reference — see what was written off
    //      at the receive step before the items arrived in the handler's queue) ----
    'damageditems.view',

    'warehouse.view',
  ],
};

export const roleCan = (role, capability) => {
  if (!role) return false;
  const caps = ROLE_PERMISSIONS[role] || [];
  if (caps.includes('*')) return true;
  return caps.includes(capability);
};