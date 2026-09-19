// src/permissions/usePermissions.js
import { useAuth } from '../auth/AuthContext';
import { normalizeRole } from './roles';
import { roleCan } from './permissions';

export const usePermissions = () => {
  const { user } = useAuth();
  const role = normalizeRole(user);

  const can = (capability) => roleCan(role, capability);
  const canAny = (...capabilities) => capabilities.some((c) => can(c));
  const canAll = (...capabilities) => capabilities.every((c) => can(c));

  return { can, canAny, canAll, role };
};