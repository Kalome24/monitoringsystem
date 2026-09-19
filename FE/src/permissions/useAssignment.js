// src/permissions/useAssignment.js
import { useAuth } from '../auth/AuthContext';
import { ROLES } from './roles';

/**
 * Reads warehouse assignment from the authenticated user.
 *
 * Data normally comes straight from the backend (login + /users/me already
 * return these):
 *   user.warehouse_assigned         -> warehouse_id (FK)
 *   user.warehouse_code / _name / _location / _status
 */
export const useAssignment = () => {
  const { user } = useAuth();

  const role = user?.user_role || user?.role || null;
  const isWarehouseBound = role === ROLES.REGISTRAR || role === ROLES.HANDLER;

  const warehouseId = user?.warehouse_assigned || null;

  // ---------- Warehouse (straight from user object) ----------
  const warehouse = warehouseId
    ? {
        id: warehouseId,
        code: user.warehouse_code || null,
        name: user.warehouse_name || null,
        location: user.warehouse_location || null,
        status: user.warehouse_status || null,
      }
    : null;

  // ---------- Labels ----------
  // Warehouse: show ONLY the name. Fall back to the code only if the name
  // is genuinely unavailable.
  const warehouseLabel = warehouse
    ? (warehouse.name || warehouse.code || 'Warehouse')
    : 'Not assigned';

  return {
    warehouse,
    isWarehouseBound,
    hasAssignment: !!warehouse,
    warehouseLabel,
  };
};