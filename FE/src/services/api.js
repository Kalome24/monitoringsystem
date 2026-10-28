// src/services/api.js
import { getToken, removeToken } from '../secure/auth';

const API_URL = 'http://localhost:5000/api';

const DEBUG = import.meta.env.DEV;
const log = DEBUG ? (...args) => console.log(...args) : () => {};

const uuidv4 = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

const PUBLIC_ENDPOINTS = new Set([
  '/users/login',
  '/users/logout-other-devices',
]);

const isPublicEndpoint = (endpoint) => {
  const path = String(endpoint).split('?')[0];
  return PUBLIC_ENDPOINTS.has(path);
};

const REAL_SESSION_ERRORS = new Set([
  'NO_TOKEN',
  'SESSION_EXPIRED',
  'INVALID_TOKEN',
  'SESSION_REVOKED',
  'SESSION_ELSEWHERE',
  'USER_NOT_FOUND',
  'WAREHOUSE_DEACTIVATED',
]);

const SESSION_EXPIRED_DEDUP_MS = 2000;
let LOGGING_OUT = false;
let lastSessionExpiredAt = 0;

const handleSessionErrorCode = (code) => {
  if (REAL_SESSION_ERRORS.has(code)) {
    if (LOGGING_OUT) {
      log(`🔇 Suppressed session-expired [${code}] during explicit logout`);
    } else {
      const now = Date.now();
      const since = now - lastSessionExpiredAt;

      if (since > SESSION_EXPIRED_DEDUP_MS) {
        lastSessionExpiredAt = now;
        console.warn(`🔴 Session error [${code}] — clearing auth and redirecting to /login`);
        removeToken();
        if (typeof window !== 'undefined') {
          window.dispatchEvent(
            new CustomEvent('ims:session-expired', { detail: { reason: code } })
          );
        }
        setTimeout(() => {
          if (window.location.pathname !== '/login') {
            window.location.href = '/login';
          }
        }, 900);
      } else {
        log(`🔇 Deduped session-expired [${code}] (${since}ms since last)`);
        removeToken();
      }
    }
  } else {
    console.warn(
      `⚠️ 401 received with code "${code || 'none'}" — not a session error, not logging out`
    );
  }
};

export const SESSION_ACTIVE_CODE = 'SESSION_ACTIVE';
export const RATE_LIMITED_CODE  = 'RATE_LIMITED';

export const INACTIVITY_BANNER_KEY = 'ims:inactivityLogout';

export const INACTIVITY_BANNER_MESSAGE =
  'You have been signed out because you have been inactive for 30 mins. Please sign in again.';

export const setInactivityBanner = () => {
  try {
    localStorage.setItem(INACTIVITY_BANNER_KEY, INACTIVITY_BANNER_MESSAGE);
  } catch { /* ignore */ }
};

export const readInactivityBanner = () => {
  try { return localStorage.getItem(INACTIVITY_BANNER_KEY); } catch { return null; }
};

export const clearInactivityBanner = () => {
  try { localStorage.removeItem(INACTIVITY_BANNER_KEY); } catch { /* ignore */ }
};

const getHeaders = (includeAuth = false) => {
  const headers = { 'Content-Type': 'application/json' };
  if (includeAuth) {
    const token = getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
};

const apiRequest = async (endpoint, options = {}) => {
  const { method = 'GET', body, requireAuth = false, idempotencyKey } = options;

  const headers = getHeaders(requireAuth);

  const httpMethod = String(method).toUpperCase();
  if (httpMethod === 'POST' || httpMethod === 'PUT' || httpMethod === 'PATCH') {
    headers['Idempotency-Key'] = idempotencyKey || uuidv4();
  }

  const config = { method, headers };
  if (body) config.body = JSON.stringify(body);

  try {
    log(`📡 ${method} ${endpoint}`);
    const response = await fetch(`${API_URL}${endpoint}`, config);
    const data = await response.json();
    log(`📡 ${method} ${endpoint} → ${response.status}`);

    if (response.status === 401 && !isPublicEndpoint(endpoint)) {
      handleSessionErrorCode(data?.code);
    }

    return {
      success: response.ok,
      status: response.status,
      data,
      ok: response.ok,
    };
  } catch (error) {
    console.error('❌ API request error:', error.message || error);
    return {
      success: false,
      error: 'Network error. Please check your connection.',
      ok: false,
    };
  }
};

const extractData = (response) => {
  if (!response.ok || !response.data) return [];
  const data = response.data;
  if (Array.isArray(data)) return data;
  if (data.data && Array.isArray(data.data)) return data.data;
  if (data.result && Array.isArray(data.result)) return data.result;
  for (const key of Object.keys(data)) {
    if (Array.isArray(data[key])) return data[key];
  }
  return [];
};

// ============================================
// AUTH API
// ============================================
export const authApi = {
  login: async (username, password) => {
    log('🔐 authApi.login called');
    const result = await apiRequest('/users/login', {
      method: 'POST',
      body: { username, password },
    });
    log(`🔐 authApi.login → ${result.status}`);
    if (result.ok && result.data) {
      if (result.data.data && result.data.data.token) {
        return { ...result, data: result.data.data };
      } else if (result.data.user && result.data.token) {
        return result;
      }
    }
    return result;
  },

  logoutOtherDevices: async (username, password) => {
    return apiRequest('/users/logout-other-devices', {
      method: 'POST',
      body: { username, password },
    });
  },

  logout: async () => {
    LOGGING_OUT = true;
    try {
      const token = getToken();
      if (!token) {
        removeToken();
        return { ok: true, status: 200, data: { success: true } };
      }
      const result = await apiRequest('/users/logout', {
        method: 'POST',
        requireAuth: true,
      });
      removeToken();
      return result;
    } catch (err) {
      console.error('Logout API error:', err.message || err);
      removeToken();
      return { ok: false, status: 0, data: null, error: err.message };
    } finally {
      setTimeout(() => { LOGGING_OUT = false; }, SESSION_EXPIRED_DEDUP_MS);
    }
  },

  getCurrentUser: async () => {
    const result = await apiRequest('/users/me', {
      method: 'GET',
      requireAuth: true,
    });

    if (result.ok && result.data) {
      let userData = null;
      if (result.data.user) userData = result.data.user;
      else if (result.data.data && result.data.data.user) userData = result.data.data.user;
      else if (result.data.data) userData = result.data.data;
      else if (result.data.id) userData = result.data;

      if (userData && userData.id) {
        log('✅ getCurrentUser: user resolved');
        return { ...result, data: userData };
      } else {
        console.warn('⚠️ getCurrentUser: no valid user data in response');
      }
    }
    return result;
  },
};

// ============================================
// USER API
// ============================================
export const userApi = {
  getAllUsers: async () => {
    const response = await apiRequest('/users', {
      method: 'GET',
      requireAuth: true,
    });
    if (response.ok) {
      const extractedData = extractData(response);
      return { ...response, data: extractedData };
    }
    return response;
  },

  getUserById: async (id) => apiRequest(`/users/${id}`, { method: 'GET', requireAuth: true }),

  getUserByPublicId: async (publicUserId) => apiRequest(`/users/public/${publicUserId}`, { method: 'GET', requireAuth: true }),

  searchUsers: async (searchTerm) => apiRequest(`/users/search?q=${encodeURIComponent(searchTerm)}`, { method: 'GET', requireAuth: true }),

  createUser: async (userData) => apiRequest('/users', { method: 'POST', body: userData, requireAuth: true }),

  updateUser: async (id, userData) => apiRequest(`/users/${id}`, { method: 'PUT', body: userData, requireAuth: true }),

  deactivateUser: async (id) => apiRequest(`/users/${id}/deactivate`, { method: 'PATCH', requireAuth: true }),

  activateUser: async (id) => apiRequest(`/users/${id}/activate`, { method: 'PATCH', requireAuth: true }),

  resetPassword: async (id) => apiRequest(`/users/${id}/reset-password`, { method: 'POST', requireAuth: true }),

  forceLogoutUser: async (id) => apiRequest(`/users/${id}/force-logout`, { method: 'POST', requireAuth: true }),

  updateMyProfileImage: async (profileImage) => apiRequest('/users/me/profile-image', {
    method: 'PUT',
    body: { profile_image: profileImage },
    requireAuth: true,
  }),

  updateSelf: async (payload) => apiRequest('/users/me', {
    method: 'PATCH',
    body: payload,
    requireAuth: true,
  }),

  getAvatarBlob: async (userId) => {
    const headers = {};
    const token = getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;

    try {
      const res = await fetch(
        `${API_URL}/users/${encodeURIComponent(userId)}/avatar`,
        { method: 'GET', headers }
      );

      if (res.status === 401) {
        let code = null;
        try {
          const data = await res.json();
          code = data?.code;
        } catch { /* ignore */ }
        handleSessionErrorCode(code);
        return { ok: false, status: 401, blob: null, code };
      }

      if (!res.ok) {
        return { ok: false, status: res.status, blob: null };
      }

      const blob = await res.blob();
      return { ok: true, status: 200, blob };
    } catch (err) {
      console.error('❌ getAvatarBlob error:', err.message || err);
      return { ok: false, status: 0, blob: null, error: err.message };
    }
  },
};

// ============================================
// WAREHOUSE API
// ============================================
export const warehouseApi = {
  getAllWarehouses: async () => {
    const response = await apiRequest('/warehouses', { method: 'GET', requireAuth: true });
    if (response.ok) {
      const extractedData = extractData(response);
      return { ...response, data: extractedData };
    }
    return response;
  },

  getActiveWarehouses: async () => apiRequest('/warehouses/active', { method: 'GET', requireAuth: true }),

  getWarehouseById: async (id) => apiRequest(`/warehouses/${id}`, { method: 'GET', requireAuth: true }),

  createWarehouse: async (warehouseData) => apiRequest('/warehouses', { method: 'POST', body: warehouseData, requireAuth: true }),

  updateWarehouse: async (id, warehouseData) => apiRequest(`/warehouses/${id}`, { method: 'PUT', body: warehouseData, requireAuth: true }),

  deactivateWarehouse: async (id) => apiRequest(`/warehouses/${id}/deactivate`, { method: 'PATCH', requireAuth: true }),

  activateWarehouse: async (id) => apiRequest(`/warehouses/${id}/activate`, { method: 'PATCH', requireAuth: true }),

  deleteWarehouse: async (id, confirmText) => apiRequest(`/warehouses/${id}`, {
    method: 'DELETE',
    body: { confirm: confirmText },
    requireAuth: true,
  }),
};

// ============================================
// MASTER API
// ============================================
export const masterApi = {
  getGl: async () => {
    const response = await apiRequest('/master/gl', { method: 'GET', requireAuth: true });
    if (response.ok) return { ...response, data: extractData(response) };
    return response;
  },
  getGlById: async (id) => apiRequest(`/master/gl/${id}`, { method: 'GET', requireAuth: true }),
  createGl: async (data) => apiRequest('/master/gl', { method: 'POST', body: data, requireAuth: true }),
  updateGl: async (id, data) => apiRequest(`/master/gl/${id}`, { method: 'PUT', body: data, requireAuth: true }),
  deactivateGl: async (id) => apiRequest(`/master/gl/${id}/deactivate`, { method: 'PATCH', requireAuth: true }),
  activateGl: async (id) => apiRequest(`/master/gl/${id}/activate`, { method: 'PATCH', requireAuth: true }),

  getCategories: async () => {
    const response = await apiRequest('/master/category', { method: 'GET', requireAuth: true });
    if (response.ok) return { ...response, data: extractData(response) };
    return response;
  },
  getCategoryById: async (id) => apiRequest(`/master/category/${id}`, { method: 'GET', requireAuth: true }),
  createCategory: async (data) => apiRequest('/master/category', { method: 'POST', body: data, requireAuth: true }),
  updateCategory: async (id, data) => apiRequest(`/master/category/${id}`, { method: 'PUT', body: data, requireAuth: true }),
  deactivateCategory: async (id) => apiRequest(`/master/category/${id}/deactivate`, { method: 'PATCH', requireAuth: true }),
  activateCategory: async (id) => apiRequest(`/master/category/${id}/activate`, { method: 'PATCH', requireAuth: true }),

  getItemCodes: async () => {
    const response = await apiRequest('/master/item-codes', { method: 'GET', requireAuth: true });
    if (response.ok) return { ...response, data: extractData(response) };
    return response;
  },
  getItemCodeById: async (id) => apiRequest(`/master/item-codes/${id}`, { method: 'GET', requireAuth: true }),
  createItemCode: async (data) => apiRequest('/master/item-codes', { method: 'POST', body: data, requireAuth: true }),
  updateItemCode: async (id, data) => apiRequest(`/master/item-codes/${id}`, { method: 'PUT', body: data, requireAuth: true }),
  deactivateItemCode: async (id) => apiRequest(`/master/item-codes/${id}/deactivate`, { method: 'PATCH', requireAuth: true }),
  activateItemCode: async (id) => apiRequest(`/master/item-codes/${id}/activate`, { method: 'PATCH', requireAuth: true }),

  getPurchaseClasses: async () => {
    const response = await apiRequest('/master/purchase-class', { method: 'GET', requireAuth: true });
    if (response.ok) return { ...response, data: extractData(response) };
    return response;
  },
  getPurchaseClassById: async (id) => apiRequest(`/master/purchase-class/${id}`, { method: 'GET', requireAuth: true }),
  createPurchaseClass: async (data) => apiRequest('/master/purchase-class', { method: 'POST', body: data, requireAuth: true }),
  updatePurchaseClass: async (id, data) => apiRequest(`/master/purchase-class/${id}`, { method: 'PUT', body: data, requireAuth: true }),
  deactivatePurchaseClass: async (id) => apiRequest(`/master/purchase-class/${id}/deactivate`, { method: 'PATCH', requireAuth: true }),
  activatePurchaseClass: async (id) => apiRequest(`/master/purchase-class/${id}/activate`, { method: 'PATCH', requireAuth: true }),

  getUom: async () => {
    const response = await apiRequest('/master/uom', { method: 'GET', requireAuth: true });
    if (response.ok) return { ...response, data: extractData(response) };
    return response;
  },
  getUomById: async (id) => apiRequest(`/master/uom/${id}`, { method: 'GET', requireAuth: true }),
  createUom: async (data) => apiRequest('/master/uom', { method: 'POST', body: data, requireAuth: true }),
  updateUom: async (id, data) => apiRequest(`/master/uom/${id}`, { method: 'PUT', body: data, requireAuth: true }),
  deactivateUom: async (id) => apiRequest(`/master/uom/${id}/deactivate`, { method: 'PATCH', requireAuth: true }),
  activateUom: async (id) => apiRequest(`/master/uom/${id}/activate`, { method: 'PATCH', requireAuth: true }),
};

// ============================================
// ITEM MASTER API
// ============================================
export const itemMasterApi = {
  createItemMaster: async (data) => apiRequest('/item-master', { method: 'POST', body: data, requireAuth: true }),

  getAllItemMasters: async ({
    page = 1,
    limit = 50,
    search = '',
    gl_class,
    purchase_class,
    category,
  } = {}) => {
    const qs = new URLSearchParams();
    qs.append('page', page);
    qs.append('limit', limit);
    if (search && String(search).trim())                     qs.append('search', String(search).trim());
    if (gl_class       && gl_class       !== 'All')          qs.append('gl_class', gl_class);
    if (purchase_class && purchase_class !== 'All')          qs.append('purchase_class', purchase_class);
    if (category       && category       !== 'All')          qs.append('category', category);

    return apiRequest(`/item-master?${qs.toString()}`, { method: 'GET', requireAuth: true });
  },

  getItemFilterOptions: async () => {
    const response = await apiRequest('/item-master/filter-options', { method: 'GET', requireAuth: true });
    if (response.ok) {
      return {
        ...response,
        data: response.data?.data ?? { gl_classes: [], purchase_classes: [], categories: [] },
      };
    }
    return response;
  },

  getItemMasterByCode: async (itemCode) => apiRequest(`/item-master/${itemCode}`, { method: 'GET', requireAuth: true }),

  getImagesByCodes: async (itemCodes = []) => {
    return apiRequest('/item-master/images', {
      method: 'POST',
      body: { item_codes: itemCodes },
      requireAuth: true,
    });
  },

  updateItemMaster: async (itemCode, data) => apiRequest(`/item-master/${itemCode}`, { method: 'PUT', body: data, requireAuth: true }),

  deactivateItemMaster: async (itemCode) => apiRequest(`/item-master/${itemCode}/deactivate`, { method: 'PATCH', requireAuth: true }),

  activateItemMaster: async (itemCode) => apiRequest(`/item-master/${itemCode}/activate`, { method: 'PATCH', requireAuth: true }),

  deleteItemMaster: async (itemCode) => apiRequest(`/item-master/${itemCode}`, { method: 'DELETE', requireAuth: true }),
};

// ============================================
// EQUIPMENT MASTER API
// ============================================
export const equipmentMasterApi = {
  createEquipmentMaster: async (data) => apiRequest('/equipment-master', { method: 'POST', body: data, requireAuth: true }),

  getAllEquipmentMasters: async ({
    page = 1,
    limit = 50,
    search = '',
  } = {}) => {
    const qs = new URLSearchParams();
    qs.append('page', page);
    qs.append('limit', limit);
    if (search && String(search).trim()) qs.append('search', String(search).trim());

    return apiRequest(`/equipment-master?${qs.toString()}`, { method: 'GET', requireAuth: true });
  },

  getEquipmentMasterByCode: async (code) => apiRequest(`/equipment-master/${code}`, { method: 'GET', requireAuth: true }),

  getImagesByCodes: async (equipmentCodes = []) => {
    return apiRequest('/equipment-master/images', {
      method: 'POST',
      body: { equipment_codes: equipmentCodes },
      requireAuth: true,
    });
  },

  updateEquipmentMaster: async (code, data) => apiRequest(`/equipment-master/${code}`, { method: 'PUT', body: data, requireAuth: true }),

  deactivateEquipmentMaster: async (code) => apiRequest(`/equipment-master/${code}/deactivate`, { method: 'PATCH', requireAuth: true }),

  activateEquipmentMaster: async (code) => apiRequest(`/equipment-master/${code}/activate`, { method: 'PATCH', requireAuth: true }),

  deleteEquipmentMaster: async (code) => apiRequest(`/equipment-master/${code}`, { method: 'DELETE', requireAuth: true }),
};

// ============================================
// UOM CONVERSION API
// ============================================
export const uomConversionApi = {
  getAll: async ({ page = 1, limit = 50, search = '' } = {}) => {
    const qs = new URLSearchParams();
    qs.append('page', page);
    qs.append('limit', limit);
    if (search && String(search).trim()) qs.append('search', String(search).trim());
    return apiRequest(`/uom-conversions?${qs.toString()}`, { method: 'GET', requireAuth: true });
  },

  getById: async (id) =>
    apiRequest(`/uom-conversions/${encodeURIComponent(id)}`, { method: 'GET', requireAuth: true }),

  create: async ({ box_item_code, piece_item_code, pieces_per_box, Status } = {}) =>
    apiRequest('/uom-conversions', {
      method: 'POST',
      body: { box_item_code, piece_item_code, pieces_per_box, Status },
      requireAuth: true,
    }),

  update: async (id, { box_item_code, piece_item_code, pieces_per_box, Status } = {}) =>
    apiRequest(`/uom-conversions/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: { box_item_code, piece_item_code, pieces_per_box, Status },
      requireAuth: true,
    }),

  remove: async (id) =>
    apiRequest(`/uom-conversions/${encodeURIComponent(id)}`, { method: 'DELETE', requireAuth: true }),
};

// ============================================
// COST CENTER API
// ============================================
export const costCenterApi = {
  createCostCenter: async (data) => apiRequest('/cost-center', { method: 'POST', body: data, requireAuth: true }),
  getAllCostCenters: async ({ page = 1, limit = 50, search = '' } = {}) => {
    const qs = new URLSearchParams();
    qs.append('page', page);
    qs.append('limit', limit);
    if (search && String(search).trim()) qs.append('search', String(search).trim());
    return apiRequest(`/cost-center?${qs.toString()}`, { method: 'GET', requireAuth: true });
  },
  getCostCenterByValue: async (value) => apiRequest(`/cost-center/${value}`, { method: 'GET', requireAuth: true }),
  updateCostCenter: async (value, data) => apiRequest(`/cost-center/${value}`, { method: 'PUT', body: data, requireAuth: true }),
  deactivateCostCenter: async (value) => apiRequest(`/cost-center/${value}/deactivate`, { method: 'PATCH', requireAuth: true }),
  activateCostCenter: async (value) => apiRequest(`/cost-center/${value}/activate`, { method: 'PATCH', requireAuth: true }),
  deleteCostCenter: async (value) => apiRequest(`/cost-center/${value}`, { method: 'DELETE', requireAuth: true }),
};

// ============================================
// IMPORT PO API
// ============================================
export const importPoApi = {
  importPOs: async ({ warehouse_id, source_file, on_duplicate = 'skip', rows = [] } = {}) => {
    return apiRequest('/import-po', {
      method: 'POST',
      body: { warehouse_id, source_file, on_duplicate, rows },
      requireAuth: true,
    });
  },

  checkDuplicatePOs: async (poNos = [], itemCodes = [], warehouse_id) => {
    return apiRequest('/import-po/check-duplicates', {
      method: 'POST',
      body: { po_nos: poNos, item_codes: itemCodes, warehouse_id },
      requireAuth: true,
    });
  },

  listPOs: async ({
    warehouse_id, status, search, delivery_status, has_po,
    start_date, end_date, page, limit,
  } = {}) => {
    const qs = new URLSearchParams();
    if (warehouse_id != null && warehouse_id !== '') qs.append('warehouse_id', warehouse_id);
    if (status && status !== 'All')                    qs.append('status', status);
    if (search && String(search).trim())               qs.append('search', String(search).trim());
    if (delivery_status && delivery_status !== 'All')  qs.append('delivery_status', delivery_status);
    if (has_po != null && has_po !== '' && has_po !== 'All') qs.append('has_po', has_po);
    if (start_date)                                    qs.append('start_date', start_date);
    if (end_date)                                      qs.append('end_date', end_date);
    if (page != null && page !== '')                   qs.append('page', page);
    if (limit != null && limit !== '')                 qs.append('limit', limit);

    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    const response = await apiRequest(`/import-po${suffix}`, { method: 'GET', requireAuth: true });

    if (response.ok) {
      return {
        ...response,
        data: response.data?.data ?? [],
        total: response.data?.total ?? 0,
        page: response.data?.page ?? 1,
        limit: response.data?.limit ?? 50,
        totalPages: response.data?.totalPages ?? 1,
      };
    }
    return response;
  },

  listHandlerItems: async ({
    warehouse_id, status, search, has_po, start_date, end_date, page, limit,
  } = {}) => {
    const qs = new URLSearchParams();
    if (warehouse_id != null && warehouse_id !== '') qs.append('warehouse_id', warehouse_id);
    if (status && status !== 'All')                    qs.append('status', status);
    if (search && String(search).trim())               qs.append('search', String(search).trim());
    if (has_po != null && has_po !== '' && has_po !== 'All') qs.append('has_po', has_po);
    if (start_date)                                    qs.append('start_date', start_date);
    if (end_date)                                      qs.append('end_date', end_date);
    if (page != null && page !== '')                   qs.append('page', page);
    if (limit != null && limit !== '')                 qs.append('limit', limit);

    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    const response = await apiRequest(`/import-po/handler-items${suffix}`, {
      method: 'GET',
      requireAuth: true,
    });

    if (response.ok) {
      return {
        ...response,
        data:       response.data?.data ?? [],
        total:      response.data?.total ?? 0,
        page:       response.data?.page ?? (page || 1),
        limit:      response.data?.limit ?? (limit || 50),
        totalPages: response.data?.totalPages ?? 1,
      };
    }
    return response;
  },

  listReceivedLines: async ({
    start_date, end_date,
    warehouse_id, item_code, search, status, delivery_status, has_po,
    page = 1, limit = 50,
  } = {}) => {
    const qs = new URLSearchParams();
    if (start_date)                                    qs.append('start_date', start_date);
    if (end_date)                                      qs.append('end_date', end_date);
    if (warehouse_id != null && warehouse_id !== '')   qs.append('warehouse_id', warehouse_id);
    if (item_code && String(item_code).trim())         qs.append('item_code', String(item_code).trim());
    if (search && String(search).trim())               qs.append('search', String(search).trim());
    if (status && status !== 'All')                    qs.append('status', status);
    if (delivery_status && delivery_status !== 'All')  qs.append('delivery_status', delivery_status);
    if (has_po != null && has_po !== '' && has_po !== 'All') qs.append('has_po', has_po);
    qs.append('page', page);
    qs.append('limit', limit);

    const response = await apiRequest(`/import-po/received-lines?${qs.toString()}`, {
      method: 'GET',
      requireAuth: true,
    });

    if (response.ok) {
      return {
        ...response,
        data:       response.data?.data ?? [],
        total:      response.data?.total ?? 0,
        page:       response.data?.page ?? page,
        limit:      response.data?.limit ?? limit,
        totalPages: response.data?.totalPages ?? 1,
        totals:     response.data?.totals ?? { line_count: 0, total_qty: 0, total_value: 0 },
        warehouses: response.data?.warehouses ?? [],
      };
    }
    return response;
  },

  receivedTrend: async ({
    start_date, end_date, warehouse_id, item_code, search, status, delivery_status,
    has_po, days = 30,
  } = {}) => {
    const qs = new URLSearchParams();
    if (start_date)                                    qs.append('start_date', start_date);
    if (end_date)                                      qs.append('end_date', end_date);
    if (warehouse_id != null && warehouse_id !== '')   qs.append('warehouse_id', warehouse_id);
    if (item_code && String(item_code).trim())         qs.append('item_code', String(item_code).trim());
    if (search && String(search).trim())               qs.append('search', String(search).trim());
    if (status && status !== 'All')                    qs.append('status', status);
    if (delivery_status && delivery_status !== 'All')  qs.append('delivery_status', delivery_status);
    if (has_po != null && has_po !== '' && has_po !== 'All') qs.append('has_po', has_po);
    if (days != null && days !== '')                   qs.append('days', days);

    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    const response = await apiRequest(`/import-po/received-trend${suffix}`, {
      method: 'GET',
      requireAuth: true,
    });
    if (response.ok) return { ...response, data: response.data?.data ?? [] };
    return response;
  },

  getPODetail: async (poNo, warehouse_id) => {
    const suffix = warehouse_id != null && warehouse_id !== ''
      ? `?warehouse_id=${encodeURIComponent(warehouse_id)}`
      : '';
    const response = await apiRequest(`/import-po/${encodeURIComponent(poNo)}${suffix}`, {
      method: 'GET', requireAuth: true,
    });
    if (response.ok) return { ...response, data: response.data?.data ?? [] };
    return response;
  },

  getPOActivity: async (poNo, itemCode = null) => {
    const qs = new URLSearchParams();
    if (itemCode && String(itemCode).trim()) qs.append('item_code', String(itemCode).trim());
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    const response = await apiRequest(
      `/import-po/${encodeURIComponent(poNo)}/activity${suffix}`,
      { method: 'GET', requireAuth: true }
    );
    if (response.ok) return { ...response, data: response.data?.data ?? [] };
    return response;
  },

  receivePO: async (poNo, items = []) => {
    return apiRequest(`/import-po/${encodeURIComponent(poNo)}/receive`, {
      method: 'POST',
      body: { items },
      requireAuth: true,
    });
  },

  forwardPO: async (poNo, warehouseId = null) => {
    const body = warehouseId != null ? { warehouse_id: warehouseId } : {};
    return apiRequest(`/import-po/${encodeURIComponent(poNo)}/forward`, {
      method: 'POST',
      body,
      requireAuth: true,
    });
  },

  deletePO: async (poNo) => {
    return apiRequest(`/import-po/${encodeURIComponent(poNo)}`, {
      method: 'DELETE',
      requireAuth: true,
    });
  },

  storeLine: async (poNo, {
    item_id,
    qty_to_store,
    qty_boxes,
    qty_loose_pieces,
    damaged_qty = 0,
    damage_reason = null,
    remarks,
    locator_code,
  } = {}) => {
    return apiRequest(`/import-po/${encodeURIComponent(poNo)}/store`, {
      method: 'POST',
      body: {
        item_id,
        qty_to_store,
        qty_boxes,
        qty_loose_pieces,
        damaged_qty,
        damage_reason,
        remarks,
        locator_code,
      },
      requireAuth: true,
    });
  },

  releaseLine: async (poNo, { item_id, qty_to_release, released_to, purpose, reference, remarks } = {}) => {
    return apiRequest(`/import-po/${encodeURIComponent(poNo)}/release`, {
      method: 'POST',
      body: { item_id, qty_to_release, released_to, purpose, reference, remarks },
      requireAuth: true,
    });
  },
};

// ============================================
// STOCK TRANSFER API (STS)
// ============================================
export const stockTransferApi = {
  createSTS: async ({
    from_warehouse_id, to_warehouse_id, transfer_date,
    po_no = null, remarks = null, lines = [],
  } = {}) => {
    return apiRequest('/stock-transfer', {
      method: 'POST',
      body: {
        from_warehouse_id, to_warehouse_id, transfer_date,
        po_no, remarks, lines,
      },
      requireAuth: true,
    });
  },

  createRequest: async ({
    from_warehouse_code,
    to_warehouse_code,
    item_code,
    item_name = null,
    uom = null,
    qty,
    target_locator_code,
    remarks = null,
  } = {}) => {
    return apiRequest('/stock-transfer/request', {
      method: 'POST',
      body: {
        from_warehouse_code,
        to_warehouse_code,
        item_code,
        item_name,
        uom,
        qty,
        target_locator_code,
        remarks,
      },
      requireAuth: true,
    });
  },

  listSTSs: async ({
    status, origin, from_warehouse_id, to_warehouse_id,
    warehouse_code, warehouse_side,
    search,
    start_date, end_date, submitted_by, approved_by,
    scope, page, limit,
  } = {}) => {
    const qs = new URLSearchParams();
    if (status && status !== 'All')                                qs.append('status', status);
    if (origin && origin !== 'All')                                qs.append('origin', origin);
    if (from_warehouse_id != null && from_warehouse_id !== '')     qs.append('from_warehouse_id', from_warehouse_id);
    if (to_warehouse_id   != null && to_warehouse_id   !== '')     qs.append('to_warehouse_id',   to_warehouse_id);
    if (warehouse_code && String(warehouse_code).trim())           qs.append('warehouse_code', String(warehouse_code).trim());
    if (warehouse_side && String(warehouse_side).trim())           qs.append('warehouse_side', String(warehouse_side).trim());
    if (search && String(search).trim())                           qs.append('search', String(search).trim());
    if (start_date)                                                qs.append('start_date', start_date);
    if (end_date)                                                  qs.append('end_date', end_date);
    if (submitted_by)                                              qs.append('submitted_by', submitted_by);
    if (approved_by)                                               qs.append('approved_by', approved_by);
    if (scope)                                                     qs.append('scope', scope);
    if (page != null && page !== '')                               qs.append('page', page);
    if (limit != null && limit !== '')                             qs.append('limit', limit);

    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    const response = await apiRequest(`/stock-transfer${suffix}`, { method: 'GET', requireAuth: true });

    if (response.ok) {
      return {
        ...response,
        data:       response.data?.data ?? [],
        total:      response.data?.total ?? 0,
        page:       response.data?.page ?? 1,
        limit:      response.data?.limit ?? 50,
        totalPages: response.data?.totalPages ?? 1,
      };
    }
    return response;
  },

  approvalQueue: async ({ search, page, limit } = {}) => {
    const qs = new URLSearchParams();
    if (search && String(search).trim())   qs.append('search', String(search).trim());
    if (page != null && page !== '')       qs.append('page', page);
    if (limit != null && limit !== '')     qs.append('limit', limit);

    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    const response = await apiRequest(`/stock-transfer/approval-queue${suffix}`, {
      method: 'GET',
      requireAuth: true,
    });

    if (response.ok) {
      return {
        ...response,
        data:       response.data?.data ?? [],
        total:      response.data?.total ?? 0,
        page:       response.data?.page ?? 1,
        limit:      response.data?.limit ?? 50,
        totalPages: response.data?.totalPages ?? 1,
      };
    }
    return response;
  },

  forShipping: async ({
    from_warehouse_code,
    search,
    start_date,
    end_date,
    page,
    limit,
  } = {}) => {
    const qs = new URLSearchParams();
    if (from_warehouse_code && String(from_warehouse_code).trim()) {
      qs.append('from_warehouse_code', String(from_warehouse_code).trim());
    }
    if (search && String(search).trim())   qs.append('search', String(search).trim());
    if (start_date)                        qs.append('start_date', start_date);
    if (end_date)                          qs.append('end_date', end_date);
    if (page != null && page !== '')       qs.append('page', page);
    if (limit != null && limit !== '')     qs.append('limit', limit);

    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    const response = await apiRequest(`/stock-transfer/for-shipping${suffix}`, {
      method: 'GET',
      requireAuth: true,
    });

    if (response.ok) {
      return {
        ...response,
        data:       response.data?.data ?? [],
        total:      response.data?.total ?? 0,
        page:       response.data?.page ?? 1,
        limit:      response.data?.limit ?? 50,
        totalPages: response.data?.totalPages ?? 1,
      };
    }
    return response;
  },

  eligibleSourceLocators: async (stsId) => {
    const response = await apiRequest(
      `/stock-transfer/${encodeURIComponent(stsId)}/eligible-source-locators`,
      { method: 'GET', requireAuth: true }
    );
    if (response.ok) return { ...response, data: response.data?.data ?? [] };
    return response;
  },

  myRequests: async ({
    status,
    search,
    start_date,
    end_date,
    page,
    limit,
  } = {}) => {
    const qs = new URLSearchParams();
    if (status && status !== 'All')        qs.append('status', status);
    if (search && String(search).trim())   qs.append('search', String(search).trim());
    if (start_date)                        qs.append('start_date', start_date);
    if (end_date)                          qs.append('end_date', end_date);
    if (page != null && page !== '')       qs.append('page', page);
    if (limit != null && limit !== '')     qs.append('limit', limit);

    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    const response = await apiRequest(`/stock-transfer/my-requests${suffix}`, {
      method: 'GET',
      requireAuth: true,
    });

    if (response.ok) {
      return {
        ...response,
        data:       response.data?.data ?? [],
        total:      response.data?.total ?? 0,
        page:       response.data?.page ?? 1,
        limit:      response.data?.limit ?? 50,
        totalPages: response.data?.totalPages ?? 1,
      };
    }
    return response;
  },

  listIncoming: async ({ status, search, to_warehouse_id, page, limit } = {}) => {
    const qs = new URLSearchParams();
    if (status && status !== 'All')                                qs.append('status', status);
    if (search && String(search).trim())                           qs.append('search', String(search).trim());
    if (to_warehouse_id != null && to_warehouse_id !== '')         qs.append('to_warehouse_id', to_warehouse_id);
    if (page != null && page !== '')                               qs.append('page', page);
    if (limit != null && limit !== '')                             qs.append('limit', limit);

    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    const response = await apiRequest(`/stock-transfer/incoming${suffix}`, { method: 'GET', requireAuth: true });

    if (response.ok) {
      return {
        ...response,
        data:       response.data?.data ?? [],
        total:      response.data?.total ?? 0,
        page:       response.data?.page ?? 1,
        limit:      response.data?.limit ?? 50,
        totalPages: response.data?.totalPages ?? 1,
      };
    }
    return response;
  },

  getIncomingSummary: async ({ to_warehouse_id } = {}) => {
    const qs = new URLSearchParams();
    if (to_warehouse_id != null && to_warehouse_id !== '') qs.append('to_warehouse_id', to_warehouse_id);

    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    const response = await apiRequest(`/stock-transfer/incoming-summary${suffix}`, { method: 'GET', requireAuth: true });
    if (response.ok) {
      return {
        ...response,
        data: response.data?.data ?? { approved: 0, received: 0, total: 0 },
      };
    }
    return response;
  },

  getSummary: async () => {
    const response = await apiRequest('/stock-transfer/summary', { method: 'GET', requireAuth: true });
    if (response.ok) return { ...response, data: response.data?.data ?? null };
    return response;
  },

  getTransferredQty: async (poNo) => {
    const response = await apiRequest(
      `/stock-transfer/transferred-qty?po_no=${encodeURIComponent(poNo)}`,
      { method: 'GET', requireAuth: true }
    );
    if (response.ok) return { ...response, data: response.data?.data ?? {} };
    return response;
  },

  getSTSDetail: async (stsId) => {
    const response = await apiRequest(`/stock-transfer/${stsId}`, { method: 'GET', requireAuth: true });
    if (response.ok) return { ...response, data: response.data?.data ?? null };
    return response;
  },

  getSTSActivity: async (stsId) => {
    const response = await apiRequest(
      `/stock-transfer/${encodeURIComponent(stsId)}/activity`,
      { method: 'GET', requireAuth: true }
    );
    if (response.ok) return { ...response, data: response.data?.data ?? [] };
    return response;
  },

  approveSTS: async (stsId, body = {}) => {
    return apiRequest(`/stock-transfer/${stsId}/approve`, {
      method: 'POST',
      body,
      requireAuth: true,
    });
  },

  rejectSTS: async (stsId, reason) => {
    return apiRequest(`/stock-transfer/${stsId}/reject`, {
      method: 'POST',
      body: { reason },
      requireAuth: true,
    });
  },

  acknowledgeRejection: async (stsId) => {
    return apiRequest(`/stock-transfer/${encodeURIComponent(stsId)}/acknowledge-rejection`, {
      method: 'POST',
      requireAuth: true,
    });
  },

  ship: async (stsId, { remarks = null, source_locator_code = null } = {}) => {
    const body = {};
    if (remarks && String(remarks).trim()) {
      body.remarks = String(remarks).trim();
    }
    if (source_locator_code && String(source_locator_code).trim()) {
      body.source_locator_code = String(source_locator_code).trim();
    }
    return apiRequest(`/stock-transfer/${stsId}/ship`, {
      method: 'POST',
      body,
      requireAuth: true,
    });
  },

  cancelSTS: async (stsId) => {
    return apiRequest(`/stock-transfer/${stsId}/cancel`, { method: 'POST', requireAuth: true });
  },

  completeSTS: async (stsId) => {
    return apiRequest(`/stock-transfer/${stsId}/complete`, { method: 'POST', requireAuth: true });
  },

  receiveSTS: async (stsId, { remarks = null, lines = [] } = {}) => {
    return apiRequest(`/stock-transfer/${stsId}/receive`, {
      method: 'POST',
      body: { remarks, lines },
      requireAuth: true,
    });
  },

  listReceivedForStore: async ({ warehouse_id, search, limit } = {}) => {
    const qs = new URLSearchParams();
    if (warehouse_id != null && warehouse_id !== '') qs.append('warehouse_id', warehouse_id);
    if (search && String(search).trim())             qs.append('search', String(search).trim());
    if (limit != null && limit !== '')               qs.append('limit', limit);

    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    const response = await apiRequest(`/stock-transfer/received-for-store${suffix}`, { method: 'GET', requireAuth: true });
    if (response.ok) return { ...response, data: response.data?.data ?? [] };
    return response;
  },

  storeTransferLine: async (stsLineId, { qty_to_store, locator_code, remarks } = {}) => {
    return apiRequest(
      `/stock-transfer/lines/${encodeURIComponent(stsLineId)}/store`,
      {
        method: 'POST',
        body: { qty_to_store, locator_code, remarks },
        requireAuth: true,
      }
    );
  },
};

// ============================================
// LOCKED ITEMS API
// ============================================
export const lockedItemsApi = {
  list: async ({ warehouse_code, search, is_active, page, limit } = {}) => {
    const qs = new URLSearchParams();
    if (warehouse_code && String(warehouse_code).trim()) qs.append('warehouse_code', String(warehouse_code).trim());
    if (search && String(search).trim())                 qs.append('search', String(search).trim());
    if (is_active !== undefined && is_active !== null && is_active !== '') {
      qs.append('is_active', is_active ? 1 : 0);
    }
    if (page != null && page !== '')                     qs.append('page', page);
    if (limit != null && limit !== '')                   qs.append('limit', limit);

    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    const response = await apiRequest(`/locked-items${suffix}`, { method: 'GET', requireAuth: true });

    if (response.ok) {
      return {
        ...response,
        data: response.data?.data ?? [],
        total: response.data?.total ?? 0,
        page: response.data?.page ?? 1,
        limit: response.data?.limit ?? 50,
        totalPages: response.data?.totalPages ?? 1,
      };
    }
    return response;
  },

  getOne: async (id) => apiRequest(`/locked-items/${id}`, { method: 'GET', requireAuth: true }),

  create: async ({ item_code, warehouse_code, locator_code, remarks }) => {
    return apiRequest('/locked-items', {
      method: 'POST',
      body: { item_code, warehouse_code, locator_code, remarks },
      requireAuth: true,
    });
  },

  bulkCreate: async (items = []) => {
    return apiRequest('/locked-items/bulk', {
      method: 'POST',
      body: { items },
      requireAuth: true,
    });
  },

  update: async (id, { warehouse_code, locator_code, remarks, is_active }) => {
    return apiRequest(`/locked-items/${id}`, {
      method: 'PUT',
      body: { warehouse_code, locator_code, remarks, is_active },
      requireAuth: true,
    });
  },

  remove: async (id) => {
    return apiRequest(`/locked-items/${id}`, { method: 'DELETE', requireAuth: true });
  },
};

// ============================================
// LOCATORS API
// ============================================
export const locatorsApi = {
  list: async ({
    warehouse_code,
    search,
    page = 1,
    limit = 20,
    purchase_class,
    category,
    status,
    locator_type,
  } = {}) => {
    const qs = new URLSearchParams();
    if (warehouse_code) qs.append('warehouse_code', warehouse_code);
    if (search && String(search).trim()) qs.append('search', String(search).trim());
    if (purchase_class) qs.append('purchase_class', purchase_class);
    if (category)       qs.append('category', category);
    if (status)         qs.append('status', status);
    if (locator_type)   qs.append('locator_type', locator_type);
    qs.append('page', page);
    qs.append('limit', limit);

    const response = await apiRequest(`/locators?${qs.toString()}`, { method: 'GET', requireAuth: true });

    if (response.ok) {
      return {
        ...response,
        data:       response.data?.data ?? [],
        total:      response.data?.total ?? 0,
        page:       response.data?.page ?? 1,
        limit:      response.data?.limit ?? limit,
        totalPages: response.data?.totalPages ?? 1,
        scoped:     response.data?.scoped ?? false,
      };
    }
    return response;
  },

  totals: async ({ warehouse_code } = {}) => {
    const qs = new URLSearchParams();
    if (warehouse_code) qs.append('warehouse_code', warehouse_code);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';

    const response = await apiRequest(`/locators/totals${suffix}`, {
      method: 'GET',
      requireAuth: true,
    });

    if (response.ok) {
      return {
        ...response,
        data: response.data?.data ?? {
          summary: {
            warehouse_count: 0,
            locator_count: 0,
            item_count: 0,
            total_qty: 0,
            total_value: 0,
          },
          warehouses: [],
        },
      };
    }
    return response;
  },

  warehouseTotals: async (warehouse_code, { page = 1, limit = 20, search } = {}) => {
    const qs = new URLSearchParams();
    qs.append('page', page);
    qs.append('limit', limit);
    if (search && String(search).trim()) qs.append('search', String(search).trim());

    const response = await apiRequest(
      `/locators/totals/${encodeURIComponent(warehouse_code)}?${qs.toString()}`,
      { method: 'GET', requireAuth: true }
    );

    if (response.ok) {
      return {
        ...response,
        data: response.data?.data ?? {
          warehouse_code,
          locators: [],
          total: 0,
          page,
          limit,
          totalPages: 1,
        },
      };
    }
    return response;
  },

  getFilterOptions: async (warehouse_code) => {
    const qs = new URLSearchParams();
    if (warehouse_code) qs.append('warehouse_code', warehouse_code);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    const response = await apiRequest(`/locators/filter-options${suffix}`, { method: 'GET', requireAuth: true });
    if (response.ok) {
      return {
        ...response,
        data: response.data?.data ?? {
          purchase_classes: [], categories: [], statuses: [], total: 0,
        },
      };
    }
    return response;
  },

  getItems: async (warehouse_code, locator_code) => {
    const qs = new URLSearchParams();
    if (warehouse_code) qs.append('warehouse_code', warehouse_code);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    const response = await apiRequest(
      `/locators/${encodeURIComponent(locator_code)}/items${suffix}`,
      { method: 'GET', requireAuth: true }
    );
    if (response.ok) {
      return { ...response, data: response.data?.data ?? [] };
    }
    return response;
  },

  create: async (payload) => {
    return apiRequest('/locators', {
      method: 'POST',
      body: payload,
      requireAuth: true,
    });
  },

  update: async (locator_code, payload) => {
    return apiRequest(`/locators/${encodeURIComponent(locator_code)}`, {
      method: 'PUT',
      body: payload,
      requireAuth: true,
    });
  },

  exportStockReport: async (warehouse_code) => {
    const qs = new URLSearchParams();
    if (warehouse_code && String(warehouse_code).trim()) {
      qs.append('warehouse_code', String(warehouse_code).trim());
    }
    const suffix = qs.toString() ? `?${qs.toString()}` : '';

    const response = await apiRequest(`/locators/export-stock-report${suffix}`, {
      method: 'GET',
      requireAuth: true,
    });

    if (response.ok) {
      return {
        ...response,
        data:           Array.isArray(response.data?.data) ? response.data.data : [],
        warehouse_code: response.data?.warehouse_code ?? warehouse_code ?? null,
      };
    }
    return response;
  },

  searchItem: async (search) => {
    const term = String(search || '').trim();
    const qs = new URLSearchParams();
    qs.append('search', term);

    const response = await apiRequest(`/locators/search-item?${qs.toString()}`, {
      method: 'GET',
      requireAuth: true,
    });

    if (response.ok) {
      return {
        ...response,
        data: response.data?.data ?? {
          search: term,
          scope: 'global',
          warehouse_code: null,
          rows: [],
          totals: {
            total_qty: 0,
            total_value: 0,
            warehouse_count: 0,
            item_count: 0,
            row_count: 0,
          },
        },
      };
    }
    return response;
  },
};

// ============================================
// LOCATOR LOG API
// ============================================
export const locatorLogApi = {
  create: async (payload) => apiRequest('/locator-logs', {
    method: 'POST',
    body: payload,
    requireAuth: true,
  }),

  list: async ({
    page = 1,
    limit = 50,
    direction,
    action_type,
    export_format,
    warehouse_code,
    performed_by,
    search,
    start_date,
    end_date,
    scope,
  } = {}) => {
    const qs = new URLSearchParams();
    qs.append('page',  page);
    qs.append('limit', limit);
    if (direction     && direction     !== 'All') qs.append('direction',     direction);
    if (action_type   && action_type   !== 'All') qs.append('action_type',   action_type);
    if (export_format && export_format !== 'All') qs.append('export_format', export_format);
    if (warehouse_code && String(warehouse_code).trim()) qs.append('warehouse_code', String(warehouse_code).trim());
    if (performed_by   && String(performed_by).trim())   qs.append('performed_by',   String(performed_by).trim());
    if (search         && String(search).trim())         qs.append('search',         String(search).trim());
    if (start_date)  qs.append('start_date', start_date);
    if (end_date)    qs.append('end_date',   end_date);
    if (scope)       qs.append('scope',      scope);

    const response = await apiRequest(`/locator-logs?${qs.toString()}`, {
      method: 'GET', requireAuth: true,
    });

    if (response.ok) {
      return {
        ...response,
        data:       response.data?.data       ?? [],
        total:      response.data?.total      ?? 0,
        page:       response.data?.page       ?? 1,
        limit:      response.data?.limit      ?? 50,
        totalPages: response.data?.totalPages ?? 1,
        scope:      response.data?.scope      ?? 'mine',
      };
    }
    return response;
  },

  getOne: async (id) => {
    const response = await apiRequest(`/locator-logs/${encodeURIComponent(id)}`, {
      method: 'GET', requireAuth: true,
    });
    if (response.ok) return { ...response, data: response.data?.data ?? null };
    return response;
  },

  getLines: async (id, { page = 1, limit = 50 } = {}) => {
    const qs = new URLSearchParams();
    qs.append('page',  page);
    qs.append('limit', limit);

    const response = await apiRequest(
      `/locator-logs/${encodeURIComponent(id)}/lines?${qs.toString()}`,
      { method: 'GET', requireAuth: true }
    );

    if (response.ok) {
      return {
        ...response,
        data:       response.data?.data       ?? [],
        total:      response.data?.total      ?? 0,
        page:       response.data?.page       ?? 1,
        limit:      response.data?.limit      ?? 50,
        totalPages: response.data?.totalPages ?? 1,
      };
    }
    return response;
  },
};

// ============================================
// WAREHOUSE INVENTORY API
// ============================================
export const warehouseInventoryApi = {
  list: async ({ warehouse_id, search, limit } = {}) => {
    const qs = new URLSearchParams();
    if (warehouse_id != null && warehouse_id !== '') qs.append('warehouse_id', warehouse_id);
    if (search && String(search).trim())              qs.append('search', String(search).trim());
    if (limit != null && limit !== '')                qs.append('limit', limit);

    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    const response = await apiRequest(`/warehouse-inventory${suffix}`, { method: 'GET', requireAuth: true });
    if (response.ok) return { ...response, data: response.data?.data ?? [] };
    return response;
  },

  getOne: async (item_code, warehouse_id) => {
    const suffix = warehouse_id != null && warehouse_id !== ''
      ? `?warehouse_id=${encodeURIComponent(warehouse_id)}`
      : '';
    const response = await apiRequest(`/warehouse-inventory/${encodeURIComponent(item_code)}${suffix}`, {
      method: 'GET', requireAuth: true,
    });
    if (response.ok) return { ...response, data: response.data?.data ?? null };
    return response;
  },

  listMovements: async ({ warehouse_id, item_code, limit } = {}) => {
    const qs = new URLSearchParams();
    if (warehouse_id != null && warehouse_id !== '') qs.append('warehouse_id', warehouse_id);
    if (item_code)                                    qs.append('item_code', item_code);
    if (limit != null && limit !== '')                qs.append('limit', limit);

    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    const response = await apiRequest(`/warehouse-inventory/movements${suffix}`, { method: 'GET', requireAuth: true });
    if (response.ok) return { ...response, data: response.data?.data ?? [] };
    return response;
  },
};

// ============================================
// DAMAGED ITEMS API
// ============================================
export const damagedItemsApi = {
  list: async ({
    start_date, end_date,
    warehouse_id, item_code, source_type,
    page = 1, limit = 50,
  } = {}) => {
    const qs = new URLSearchParams();
    if (start_date)                                    qs.append('start_date', start_date);
    if (end_date)                                      qs.append('end_date', end_date);
    if (warehouse_id != null && warehouse_id !== '')   qs.append('warehouse_id', warehouse_id);
    if (item_code && String(item_code).trim())         qs.append('item_code', String(item_code).trim());
    if (source_type && source_type !== 'All')          qs.append('source_type', source_type);
    qs.append('page', page);
    qs.append('limit', limit);

    const response = await apiRequest(`/damaged-items?${qs.toString()}`, {
      method: 'GET',
      requireAuth: true,
    });

    if (response.ok) {
      return {
        ...response,
        data:          response.data?.data          ?? [],
        total:         response.data?.total         ?? 0,
        page:          response.data?.page          ?? page,
        limit:         response.data?.limit         ?? limit,
        totalPages:    response.data?.totalPages    ?? 1,
        totals:        response.data?.totals        ?? { writeoff_count: 0, total_qty: 0, total_value: 0 },
        warehouses:    response.data?.warehouses    ?? [],
        source_counts: response.data?.source_counts ?? [],
      };
    }
    return response;
  },

  recordManual: async ({
    warehouse_id,
    locator_code,
    item_code,
    qty,
    reason,
  } = {}) => {
    return apiRequest('/damaged-items/manual', {
      method: 'POST',
      body: {
        warehouse_id,
        locator_code,
        item_code,
        qty,
        reason,
      },
      requireAuth: true,
    });
  },

  totals: async ({ start_date, end_date, warehouse_id, item_code, source_type } = {}) => {
    const qs = new URLSearchParams();
    if (start_date)                                    qs.append('start_date', start_date);
    if (end_date)                                      qs.append('end_date', end_date);
    if (warehouse_id != null && warehouse_id !== '')   qs.append('warehouse_id', warehouse_id);
    if (item_code && String(item_code).trim())         qs.append('item_code', String(item_code).trim());
    if (source_type && source_type !== 'All')          qs.append('source_type', source_type);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    const response = await apiRequest(`/damaged-items/totals${suffix}`, { method: 'GET', requireAuth: true });
    if (response.ok) {
      return {
        ...response,
        data: response.data?.data ?? { writeoff_count: 0, total_qty: 0, total_value: 0 },
      };
    }
    return response;
  },

  topItems: async ({ start_date, end_date, warehouse_id, item_code, source_type, limit = 20 } = {}) => {
    const qs = new URLSearchParams();
    if (start_date)                                    qs.append('start_date', start_date);
    if (end_date)                                      qs.append('end_date', end_date);
    if (warehouse_id != null && warehouse_id !== '')   qs.append('warehouse_id', warehouse_id);
    if (item_code && String(item_code).trim())         qs.append('item_code', String(item_code).trim());
    if (source_type && source_type !== 'All')          qs.append('source_type', source_type);
    if (limit != null && limit !== '')                 qs.append('limit', limit);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    const response = await apiRequest(`/damaged-items/top-items${suffix}`, { method: 'GET', requireAuth: true });
    if (response.ok) return { ...response, data: response.data?.data ?? [] };
    return response;
  },

  trend: async ({ start_date, end_date, warehouse_id, item_code, source_type, days = 30 } = {}) => {
    const qs = new URLSearchParams();
    if (start_date)                                    qs.append('start_date', start_date);
    if (end_date)                                      qs.append('end_date', end_date);
    if (warehouse_id != null && warehouse_id !== '')   qs.append('warehouse_id', warehouse_id);
    if (item_code && String(item_code).trim())         qs.append('item_code', String(item_code).trim());
    if (source_type && source_type !== 'All')          qs.append('source_type', source_type);
    if (days != null && days !== '')                   qs.append('days', days);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    const response = await apiRequest(`/damaged-items/trend${suffix}`, { method: 'GET', requireAuth: true });
    if (response.ok) return { ...response, data: response.data?.data ?? [] };
    return response;
  },

  warehouses: async ({ start_date, end_date, warehouse_id, item_code, source_type } = {}) => {
    const qs = new URLSearchParams();
    if (start_date)                                    qs.append('start_date', start_date);
    if (end_date)                                      qs.append('end_date', end_date);
    if (warehouse_id != null && warehouse_id !== '')   qs.append('warehouse_id', warehouse_id);
    if (item_code && String(item_code).trim())         qs.append('item_code', String(item_code).trim());
    if (source_type && source_type !== 'All')          qs.append('source_type', source_type);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    const response = await apiRequest(`/damaged-items/warehouses${suffix}`, { method: 'GET', requireAuth: true });
    if (response.ok) return { ...response, data: response.data?.data ?? [] };
    return response;
  },
};

// ============================================
// UNDERGROUND API
// ============================================
export const undergroundApi = {
  dashboard: async () => {
    const response = await apiRequest('/underground/dashboard', {
      method: 'GET', requireAuth: true,
    });
    if (response.ok) {
      return {
        ...response,
        data: response.data?.data ?? null,
        scoped_bodegas: response.data?.data?.scoped_bodegas ?? null,
      };
    }
    return response;
  },

  currentShift: async () => {
    const response = await apiRequest('/underground/shift/current', {
      method: 'GET', requireAuth: true,
    });
    if (response.ok) {
      return {
        ...response,
        data: response.data?.data ?? null,
        scoped_bodegas: response.data?.data?.scoped_bodegas ?? null,
      };
    }
    return response;
  },

  currentInventory: async ({ search, locator_code, item_code, page, limit } = {}) => {
    const qs = new URLSearchParams();
    if (search && String(search).trim())   qs.append('search', String(search).trim());
    if (locator_code && String(locator_code).trim()) qs.append('locator_code', String(locator_code).trim());
    if (item_code && String(item_code).trim())       qs.append('item_code', String(item_code).trim());
    if (page != null && page !== '')       qs.append('page', page);
    if (limit != null && limit !== '')     qs.append('limit', limit);

    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    const response = await apiRequest(`/underground/inventory${suffix}`, {
      method: 'GET', requireAuth: true,
    });

    if (response.ok) {
      return {
        ...response,
        data:       response.data?.data ?? [],
        total:      response.data?.total ?? 0,
        page:       response.data?.page ?? 1,
        limit:      response.data?.limit ?? 100,
        totalPages: response.data?.totalPages ?? 1,
        shift_id:   response.data?.shift_id ?? null,
        message:    response.data?.message ?? null,
        scoped_bodegas: response.data?.scoped_bodegas ?? null,
      };
    }
    return response;
  },

  listShifts: async ({ page = 1, limit = 50, status } = {}) => {
    const qs = new URLSearchParams();
    qs.append('page', page);
    qs.append('limit', limit);
    if (status && status !== 'All') qs.append('status', status);

    const response = await apiRequest(`/underground/shifts?${qs.toString()}`, {
      method: 'GET', requireAuth: true,
    });

    if (response.ok) {
      return {
        ...response,
        data:       response.data?.data       ?? [],
        total:      response.data?.total      ?? 0,
        page:       response.data?.page       ?? 1,
        limit:      response.data?.limit      ?? 50,
        totalPages: response.data?.totalPages ?? 1,
      };
    }
    return response;
  },

  surfaceShifts: async ({ warehouse_id, status, page = 1, limit = 50 } = {}) => {
    const qs = new URLSearchParams();
    qs.append('page', page);
    qs.append('limit', limit);
    if (warehouse_id != null && warehouse_id !== '') qs.append('warehouse_id', warehouse_id);
    if (status && status !== 'All') qs.append('status', status);

    const response = await apiRequest(`/underground/shifts/surface?${qs.toString()}`, {
      method: 'GET', requireAuth: true,
    });

    if (response.ok) {
      return {
        ...response,
        data:       response.data?.data       ?? [],
        total:      response.data?.total      ?? 0,
        page:       response.data?.page       ?? 1,
        limit:      response.data?.limit      ?? 50,
        totalPages: response.data?.totalPages ?? 1,
        warehouse:  response.data?.warehouse  ?? null,
      };
    }
    return response;
  },

  getShift: async (id) => {
    const response = await apiRequest(`/underground/shift/${encodeURIComponent(id)}`, {
      method: 'GET', requireAuth: true,
    });
    if (response.ok) return { ...response, data: response.data?.data ?? null };
    return response;
  },

  getShiftLines: async (id, { kind, page = 1, limit = 50 } = {}) => {
    const qs = new URLSearchParams();
    qs.append('page', page);
    qs.append('limit', limit);
    if (kind && kind !== 'All') qs.append('kind', kind);

    const response = await apiRequest(
      `/underground/shift/${encodeURIComponent(id)}/lines?${qs.toString()}`,
      { method: 'GET', requireAuth: true }
    );

    if (response.ok) {
      return {
        ...response,
        data:       response.data?.data       ?? [],
        total:      response.data?.total      ?? 0,
        page:       response.data?.page       ?? 1,
        limit:      response.data?.limit      ?? 50,
        totalPages: response.data?.totalPages ?? 1,
      };
    }
    return response;
  },

  activeShift: async () => {
    const response = await apiRequest('/underground/shift/active', {
      method: 'GET', requireAuth: true,
    });
    if (response.ok) {
      return {
        ...response,
        data: response.data?.data ?? { shift: null, state: 'none' },
      };
    }
    return response;
  },

  listPendingSyncs: async ({ warehouse_id, limit } = {}) => {
    const qs = new URLSearchParams();
    if (warehouse_id != null && warehouse_id !== '') qs.append('warehouse_id', warehouse_id);
    if (limit != null && limit !== '')               qs.append('limit', limit);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';

    const response = await apiRequest(`/underground/shifts/pending${suffix}`, {
      method: 'GET', requireAuth: true,
    });

    if (response.ok) {
      return {
        ...response,
        data:      Array.isArray(response.data?.data) ? response.data.data : [],
        warehouse: response.data?.warehouse ?? null,
      };
    }
    return response;
  },

  listPeers: async ({ warehouse_id, limit } = {}) => {
    const qs = new URLSearchParams();
    if (warehouse_id != null && warehouse_id !== '') qs.append('warehouse_id', warehouse_id);
    if (limit != null && limit !== '')               qs.append('limit', limit);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';

    const response = await apiRequest(`/underground/peers${suffix}`, {
      method: 'GET', requireAuth: true,
    });

    if (response.ok) {
      return {
        ...response,
        data:      Array.isArray(response.data?.data) ? response.data.data : [],
        warehouse: response.data?.warehouse ?? null,
      };
    }
    return response;
  },

  createPeerCommand: async (serverId, { kind, payload } = {}) => {
    return apiRequest(
      `/underground/peers/${encodeURIComponent(serverId)}/command`,
      {
        method: 'POST',
        body: { kind, payload },
        requireAuth: true,
      }
    );
  },

  listPeerCommands: async (serverId, { limit } = {}) => {
    const qs = new URLSearchParams();
    if (limit != null && limit !== '') qs.append('limit', limit);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';

    const response = await apiRequest(
      `/underground/peers/${encodeURIComponent(serverId)}/commands${suffix}`,
      { method: 'GET', requireAuth: true }
    );

    if (response.ok) {
      return {
        ...response,
        data: Array.isArray(response.data?.data) ? response.data.data : [],
      };
    }
    return response;
  },

  openShift: async ({ seed_log_id, seed_export_uid, notes } = {}) => {
    return apiRequest('/underground/shift/open', {
      method: 'POST',
      body: { seed_log_id, seed_export_uid, notes },
      requireAuth: true,
    });
  },

  releaseLines: async (shiftId, { lines = [] } = {}) => {
    return apiRequest(`/underground/shift/${encodeURIComponent(shiftId)}/release`, {
      method: 'POST',
      body: { lines },
      requireAuth: true,
    });
  },

  closeShift: async (shiftId, { filename, file_hash, file_size_bytes, notes } = {}) => {
    return apiRequest(`/underground/shift/${encodeURIComponent(shiftId)}/close`, {
      method: 'POST',
      body: { filename, file_hash, file_size_bytes, notes },
      requireAuth: true,
    });
  },

  syncOnline: async (shiftId, { sync_token, notes } = {}) => {
    const body = {};
    if (sync_token && String(sync_token).trim()) body.sync_token = String(sync_token).trim();
    if (notes && String(notes).trim())           body.notes      = String(notes).trim();

    return apiRequest(`/underground/shift/${encodeURIComponent(shiftId)}/sync-online`, {
      method: 'POST',
      body,
      requireAuth: true,
    });
  },

  liveDeltas: async (shiftId, { limit } = {}) => {
    const qs = new URLSearchParams();
    if (limit != null && limit !== '') qs.append('limit', limit);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';

    const response = await apiRequest(
      `/underground/shift/${encodeURIComponent(shiftId)}/live-deltas${suffix}`,
      { method: 'GET', requireAuth: true }
    );
    if (response.ok) return { ...response, data: response.data?.data ?? null };
    return response;
  },

  availableSeeds: async ({ days, limit, show_used } = {}) => {
    const qs = new URLSearchParams();
    if (days != null && days !== '')       qs.append('days', days);
    if (limit != null && limit !== '')     qs.append('limit', limit);
    if (show_used)                         qs.append('show_used', '1');

    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    const response = await apiRequest(`/underground/available-seeds${suffix}`, {
      method: 'GET', requireAuth: true,
    });

    if (response.ok) {
      return {
        ...response,
        data:           Array.isArray(response.data?.data) ? response.data.data : [],
        warehouse_code: response.data?.warehouse_code ?? null,
        days:           response.data?.days ?? 7,
        show_used:      Boolean(response.data?.show_used),
      };
    }
    return response;
  },

  reconcileShift: async (shiftId, { filename, file_hash, file_size_bytes, notes } = {}) => {
    return apiRequest(`/underground/shift/${encodeURIComponent(shiftId)}/reconcile`, {
      method: 'POST',
      body: { filename, file_hash, file_size_bytes, notes },
      requireAuth: true,
    });
  },

  getClosePayload: async (shiftId) => {
    const response = await apiRequest(
      `/underground/shift/${encodeURIComponent(shiftId)}/close-payload`,
      { method: 'GET', requireAuth: true }
    );
    if (response.ok) return { ...response, data: response.data?.data ?? null };
    return response;
  },

  openShiftFromFile: async ({
    file_hash,
    filename,
    file_size_bytes,
    seed_lines,
    notes,
  } = {}) => {
    return apiRequest('/underground/shift/open-from-file', {
      method: 'POST',
      body: { file_hash, filename, file_size_bytes, seed_lines, notes },
      requireAuth: true,
    });
  },

  reconcileFromFile: async ({
    file_hash,
    filename,
    file_size_bytes,
    notes,
    release_lines,
    warehouse_code,
  } = {}) => {
    return apiRequest('/underground/shift/reconcile-from-file', {
      method: 'POST',
      body: {
        file_hash,
        filename,
        file_size_bytes,
        notes,
        release_lines,
        warehouse_code,
      },
      requireAuth: true,
    });
  },
};

// ============================================
// UNDERGROUND ISSUE FORMS API
// ============================================
export const issueFormApi = {
  meta: async () => {
    const response = await apiRequest('/underground/issue-form-meta', {
      method: 'GET', requireAuth: true,
    });
    if (response.ok) return { ...response, data: response.data?.data ?? null };
    return response;
  },

  list: async ({ form_type, start_date, end_date, page = 1, limit = 50 } = {}) => {
    const qs = new URLSearchParams();
    qs.append('page', page);
    qs.append('limit', limit);
    if (form_type && form_type !== 'All') qs.append('form_type', form_type);
    if (start_date) qs.append('start_date', start_date);
    if (end_date)   qs.append('end_date',   end_date);

    const response = await apiRequest(`/underground/issue-forms?${qs.toString()}`, {
      method: 'GET', requireAuth: true,
    });

    if (response.ok) {
      return {
        ...response,
        data:       response.data?.data       ?? [],
        total:      response.data?.total      ?? 0,
        page:       response.data?.page       ?? page,
        limit:      response.data?.limit      ?? limit,
        totalPages: response.data?.totalPages ?? 1,
        totals:     response.data?.totals     ?? { forms: 0, lines: 0, amount: 0 },
      };
    }
    return response;
  },

  getById: async (id) => {
    const response = await apiRequest(`/underground/issue-form/${encodeURIComponent(id)}`, {
      method: 'GET', requireAuth: true,
    });
    if (response.ok) return { ...response, data: response.data?.data ?? null };
    return response;
  },

  listForShift: async (shiftId) => {
    const response = await apiRequest(
      `/underground/shift/${encodeURIComponent(shiftId)}/issue-forms`,
      { method: 'GET', requireAuth: true }
    );
    if (response.ok) return { ...response, data: response.data?.data ?? [] };
    return response;
  },

  create: async (payload) => {
    return apiRequest('/underground/issue-form', {
      method: 'POST',
      body: payload,
      requireAuth: true,
    });
  },
};

// ============================================
// SIGNATURE CONFIG API (NOW MERGED UNDER OFFLINE CONFIG)
// ============================================
export const signatureConfigApi = {
  roles: async () => {
    return { ok: true, data: ['Authorized By', 'Issued By', 'Received By', 'Bodega', 'Chapa'] };
  },

  list: async ({ role_slot, is_active, include_inactive } = {}) => {
    const qs = new URLSearchParams();
    if (role_slot && String(role_slot).trim()) qs.append('role_slot', String(role_slot).trim());
    if (is_active !== undefined && is_active !== null && is_active !== '') {
      qs.append('is_active', is_active ? 1 : 0);
    }
    if (include_inactive) qs.append('include_inactive', '1');

    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    const response = await apiRequest(`/offline-config/signatures${suffix}`, {
      method: 'GET', requireAuth: true,
    });
    if (response.ok) return { ...response, data: response.data?.data ?? [] };
    return response;
  },

  getById: async (id) => {
    const response = await apiRequest(`/offline-config/signatures/${encodeURIComponent(id)}`, {
      method: 'GET', requireAuth: true,
    });
    if (response.ok) return { ...response, data: response.data?.data ?? null };
    return response;
  },

  create: async (payload) => {
    return apiRequest('/offline-config/signatures', {
      method: 'POST',
      body: payload,
      requireAuth: true,
    });
  },

  update: async (id, payload) => {
    return apiRequest(`/offline-config/signatures/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: payload,
      requireAuth: true,
    });
  },

  remove: async (id) => {
    return apiRequest(`/offline-config/signatures/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      requireAuth: true,
    });
  },
};

// ============================================
// OFFLINE CONFIG API
// ============================================
export const offlineConfigApi = {
  getAll: async ({ category, page = 1, limit = 20, search = '' } = {}) => {
    const qs = new URLSearchParams();
    if (category) qs.append('category', category);
    qs.append('page', page);
    qs.append('limit', limit);
    if (search && String(search).trim()) qs.append('search', String(search).trim());

    const r = await apiRequest(`/offline-config?${qs.toString()}`, { method: 'GET', requireAuth: true });
    if (r.ok) {
      return {
        ...r,
        data:       r.data?.data ?? [],
        signatures: r.data?.signatures ?? [],
        total:      r.data?.total ?? 0,
        page:       r.data?.page ?? page,
        limit:      r.data?.limit ?? limit,
        totalPages: r.data?.totalPages ?? 1,
      };
    }
    return r;
  },

  createItem: async (payload) => {
    return apiRequest('/offline-config/item', {
      method: 'POST',
      body: payload,
      requireAuth: true,
    });
  },

  updateItem: async (id, payload) => {
    return apiRequest(`/offline-config/item/${id}`, {
      method: 'PUT',
      body: payload,
      requireAuth: true,
    });
  },

  deleteItem: async (id) => {
    return apiRequest(`/offline-config/item/${id}`, {
      method: 'DELETE',
      requireAuth: true,
    });
  },

  exportSync: async () => {
    const response = await apiRequest('/offline-config/sync/export', {
      method: 'GET',
      requireAuth: true,
    });
    if (response.ok) {
      return {
        ...response,
        data: response.data?.data ?? null,
        meta: response.data?.meta ?? null,
      };
    }
    return response;
  },

  importSync: async ({ payload, fileName, fileHash }) => {
    return apiRequest('/offline-config/sync/import', {
      method: 'POST',
      body: { payload, fileName, fileHash },
      requireAuth: true,
    });
  },

  pullFromSurface: async () => {
    return apiRequest('/offline-config/sync/pull-from-surface', {
      method: 'POST',
      requireAuth: true,
    });
  },

  syncStatus: async () => {
    const response = await apiRequest('/offline-config/sync/status', {
      method: 'GET',
      requireAuth: true,
    });
    if (response.ok) {
      return {
        ...response,
        data: response.data?.data ?? {
          enabled: false,
          surfaceBaseUrl: null,
          serverId: null,
          warehouseCode: null,
        },
      };
    }
    return response;
  },

  getHistory: async (limit = 50) => {
    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 500);
    const response = await apiRequest(`/offline-config/sync/history?limit=${safeLimit}`, {
      method: 'GET',
      requireAuth: true,
    });
    if (response.ok) return { ...response, data: response.data?.data ?? [] };
    return response;
  },
};

// ============================================
// OFFLINE FEATURES API (Damage & Transfers)
// ============================================
export const offlineFeaturesApi = {
  recordDamage: async ({ locator_code, item_code, qty, qty_boxes, qty_loose_pieces, reason }) => {
    return apiRequest('/underground/offline-features/damage', { 
      method: 'POST', 
      body: { locator_code, item_code, qty, qty_boxes, qty_loose_pieces, reason }, 
      requireAuth: true 
    });
  },
  getDamageHistory: async ({ search, start_date, end_date, page = 1 } = {}) => {
    const qs = new URLSearchParams();
    qs.append('page', page);
    if (search && String(search).trim()) qs.append('search', String(search).trim());
    if (start_date) qs.append('start_date', start_date);
    if (end_date) qs.append('end_date', end_date);
    const response = await apiRequest(`/underground/offline-features/damage/history?${qs.toString()}`, { method: 'GET', requireAuth: true });
    if (response.ok) {
      return { ...response, data: response.data?.data ?? [], total: response.data?.total ?? 0, page: response.data?.page ?? 1, totalPages: response.data?.totalPages ?? 1 };
    }
    return response;
  },

  getTransferItems: async ({ locator_code }) => {
    const qs = new URLSearchParams();
    qs.append('locator_code', locator_code);
    const response = await apiRequest(`/underground/offline-features/transfer/items?${qs.toString()}`, { method: 'GET', requireAuth: true });
    if (response.ok) return { ...response, data: response.data?.data ?? [] };
    return response;
  },

  getDestinationLocators: async () => {
    const response = await apiRequest(`/underground/offline-features/transfer/destinations`, { method: 'GET', requireAuth: true });
    if (response.ok) return { ...response, data: response.data?.data ?? [] };
    return response;
  },

  createTransfer: async ({ sts_no, from_locator, to_locator, item_code, item_name, uom, qty, qty_boxes, qty_loose_pieces, approved_by, remarks }) => {
    return apiRequest('/underground/offline-features/transfer', { 
      method: 'POST', 
      body: { sts_no, from_locator, to_locator, item_code, item_name, uom, qty, qty_boxes, qty_loose_pieces, approved_by, remarks }, 
      requireAuth: true 
    });
  },
  getTransferHistory: async ({ search, start_date, end_date, page = 1 } = {}) => {
    const qs = new URLSearchParams();
    qs.append('page', page);
    if (search && String(search).trim()) qs.append('search', String(search).trim());
    if (start_date) qs.append('start_date', start_date);
    if (end_date) qs.append('end_date', end_date);
    const response = await apiRequest(`/underground/offline-features/transfer/history?${qs.toString()}`, { method: 'GET', requireAuth: true });
    if (response.ok) {
      return { ...response, data: response.data?.data ?? [], total: response.data?.total ?? 0, page: response.data?.page ?? 1, totalPages: response.data?.totalPages ?? 1 };
    }
    return response;
  },
};

export default {
  authApi,
  userApi,
  warehouseApi,
  masterApi,
  itemMasterApi,
  equipmentMasterApi,
  uomConversionApi,
  costCenterApi,
  importPoApi,
  stockTransferApi,
  lockedItemsApi,
  locatorsApi,
  locatorLogApi,
  warehouseInventoryApi,
  damagedItemsApi,
  undergroundApi,
  issueFormApi,
  signatureConfigApi,
  offlineConfigApi,
  offlineFeaturesApi,
};