// src/permissions/roles.js
// Single source of truth for role names and their landing routes.

export const ROLES = {
  SUPER_ADMIN: 'Super Admin',
  ADMIN: 'Admin',
  REGISTRAR: 'Stock Registrar',
  HANDLER: 'Stock Handler',
};

export const ROLE_ROUTES = {
  [ROLES.SUPER_ADMIN]: '/super-admin',
  [ROLES.ADMIN]: '/admin',
  [ROLES.REGISTRAR]: '/registrar',
  [ROLES.HANDLER]: '/handler',
};

export const normalizeRole = (user) => user?.user_role || user?.role || null;

export const getRoleHomeRoute = (role) => ROLE_ROUTES[role] || '/login';