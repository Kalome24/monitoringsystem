// src/services/api.js
import { getToken } from '../secure/auth';

const API_URL = 'http://localhost:5000/api';

const getHeaders = (includeAuth = false) => {
  const headers = {
    'Content-Type': 'application/json',
  };

  if (includeAuth) {
    const token = getToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
  }

  return headers;
};

const apiRequest = async (endpoint, options = {}) => {
  const { method = 'GET', body, requireAuth = false } = options;

  const config = {
    method,
    headers: getHeaders(requireAuth),
  };

  if (body) {
    config.body = JSON.stringify(body);
  }

  try {
    console.log(`📡 Making ${method} request to: ${API_URL}${endpoint}`);

    const response = await fetch(`${API_URL}${endpoint}`, config);
    console.log(`📡 Response status: ${response.status}`);

    const data = await response.json();
    console.log(`📡 Response data:`, data);

    if (response.status === 401) {
      console.warn('🔴 401 Unauthorized - Clearing auth data');
      localStorage.removeItem('auth_token');
      localStorage.removeItem('auth_user');
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    }

    return {
      success: response.ok,
      status: response.status,
      data,
      ok: response.ok,
    };
  } catch (error) {
    console.error('❌ API request error:', error);
    return {
      success: false,
      error: 'Network error. Please check your connection.',
      ok: false,
    };
  }
};

const extractData = (response) => {
  if (!response.ok || !response.data) {
    return [];
  }

  const data = response.data;

  if (Array.isArray(data)) {
    return data;
  }

  if (data.data && Array.isArray(data.data)) {
    return data.data;
  }

  if (data.result && Array.isArray(data.result)) {
    return data.result;
  }

  const keys = Object.keys(data);
  for (const key of keys) {
    if (Array.isArray(data[key])) {
      return data[key];
    }
  }

  return [];
};

// ============================================
// AUTH API
// ============================================
export const authApi = {
  login: async (username, password) => {
    console.log('🔐 authApi.login called for:', username);

    const result = await apiRequest('/users/login', {
      method: 'POST',
      body: { username, password },
    });

    console.log('🔐 authApi.login result:', result);

    if (result.ok && result.data) {
      if (result.data.data && result.data.data.token) {
        return {
          ...result,
          data: result.data.data
        };
      }
      else if (result.data.user && result.data.token) {
        return result;
      }
    }

    return result;
  },

  logout: async () => {
    const token = getToken();

    if (!token) {
      localStorage.removeItem('auth_token');
      localStorage.removeItem('auth_user');
      return { ok: true, status: 200, data: { success: true } };
    }

    try {
      const result = await apiRequest('/users/logout', {
        method: 'POST',
        requireAuth: true,
      });
      localStorage.removeItem('auth_token');
      localStorage.removeItem('auth_user');
      return result;
    } catch (err) {
      console.error('Logout API error:', err);
      localStorage.removeItem('auth_token');
      localStorage.removeItem('auth_user');
      return { ok: false, status: 0, data: null, error: err.message };
    }
  },

  getCurrentUser: async () => {
    const result = await apiRequest('/users/me', {
      method: 'GET',
      requireAuth: true,
    });

    console.log('📡 getCurrentUser raw result:', result);

    if (result.ok && result.data) {
      let userData = null;

      if (result.data.user) {
        userData = result.data.user;
      } else if (result.data.data && result.data.data.user) {
        userData = result.data.data.user;
      } else if (result.data.data) {
        userData = result.data.data;
      } else if (result.data.id) {
        userData = result.data;
      }

      if (userData && userData.id) {
        console.log('✅ Extracted user data:', userData.username);
        return {
          ...result,
          data: userData
        };
      } else {
        console.warn('⚠️ No valid user data found in response:', result.data);
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
      return {
        ...response,
        data: extractedData
      };
    }
    return response;
  },

  getUserById: async (id) => {
    return apiRequest(`/users/${id}`, {
      method: 'GET',
      requireAuth: true,
    });
  },

  getUserByPublicId: async (publicUserId) => {
    return apiRequest(`/users/public/${publicUserId}`, {
      method: 'GET',
      requireAuth: true,
    });
  },

  searchUsers: async (searchTerm) => {
    return apiRequest(`/users/search?q=${encodeURIComponent(searchTerm)}`, {
      method: 'GET',
      requireAuth: true,
    });
  },

  createUser: async (userData) => {
    return apiRequest('/users', {
      method: 'POST',
      body: userData,
      requireAuth: true,
    });
  },

  updateUser: async (id, userData) => {
    return apiRequest(`/users/${id}`, {
      method: 'PUT',
      body: userData,
      requireAuth: true,
    });
  },

  deactivateUser: async (id) => {
    return apiRequest(`/users/${id}/deactivate`, {
      method: 'PATCH',
      requireAuth: true,
    });
  },

  activateUser: async (id) => {
    return apiRequest(`/users/${id}/activate`, {
      method: 'PATCH',
      requireAuth: true,
    });
  },

  forceLogoutUser: async (id) => {
    return apiRequest(`/users/${id}/force-logout`, {
      method: 'POST',
      requireAuth: true,
    });
  },

  updateMyProfileImage: async (profileImage) => {
    return apiRequest('/users/me/profile-image', {
      method: 'PUT',
      body: { profile_image: profileImage },
      requireAuth: true,
    });
  },
};

// ============================================
// WAREHOUSE API
// ============================================
export const warehouseApi = {
  getAllWarehouses: async () => {
    const response = await apiRequest('/warehouses', {
      method: 'GET',
      requireAuth: true,
    });

    if (response.ok) {
      const extractedData = extractData(response);
      return {
        ...response,
        data: extractedData
      };
    }
    return response;
  },

  getActiveWarehouses: async () => {
    return apiRequest('/warehouses/active', {
      method: 'GET',
      requireAuth: true,
    });
  },

  getWarehouseById: async (id) => {
    return apiRequest(`/warehouses/${id}`, {
      method: 'GET',
      requireAuth: true,
    });
  },

  createWarehouse: async (warehouseData) => {
    return apiRequest('/warehouses', {
      method: 'POST',
      body: warehouseData,
      requireAuth: true,
    });
  },

  updateWarehouse: async (id, warehouseData) => {
    return apiRequest(`/warehouses/${id}`, {
      method: 'PUT',
      body: warehouseData,
      requireAuth: true,
    });
  },

  deactivateWarehouse: async (id) => {
    return apiRequest(`/warehouses/${id}/deactivate`, {
      method: 'PATCH',
      requireAuth: true,
    });
  },

  activateWarehouse: async (id) => {
    return apiRequest(`/warehouses/${id}/activate`, {
      method: 'PATCH',
      requireAuth: true,
    });
  },

  deleteWarehouse: async (id, confirmText) => {
    return apiRequest(`/warehouses/${id}`, {
      method: 'DELETE',
      body: { confirm: confirmText },
      requireAuth: true,
    });
  },
};

// ============================================
// MASTER API
// ============================================
export const masterApi = {
  getGl: async () => {
    const response = await apiRequest('/master/gl', { method: 'GET', requireAuth: true });
    if (response.ok) {
      const extractedData = extractData(response);
      return { ...response, data: extractedData };
    }
    return response;
  },
  getGlById: async (id) => apiRequest(`/master/gl/${id}`, { method: 'GET', requireAuth: true }),
  createGl: async (data) => apiRequest('/master/gl', { method: 'POST', body: data, requireAuth: true }),
  updateGl: async (id, data) => apiRequest(`/master/gl/${id}`, { method: 'PUT', body: data, requireAuth: true }),
  deactivateGl: async (id) => apiRequest(`/master/gl/${id}/deactivate`, { method: 'PATCH', requireAuth: true }),
  activateGl: async (id) => apiRequest(`/master/gl/${id}/activate`, { method: 'PATCH', requireAuth: true }),

  getCategories: async () => {
    const response = await apiRequest('/master/category', { method: 'GET', requireAuth: true });
    if (response.ok) {
      const extractedData = extractData(response);
      return { ...response, data: extractedData };
    }
    return response;
  },
  getCategoryById: async (id) => apiRequest(`/master/category/${id}`, { method: 'GET', requireAuth: true }),
  createCategory: async (data) => apiRequest('/master/category', { method: 'POST', body: data, requireAuth: true }),
  updateCategory: async (id, data) => apiRequest(`/master/category/${id}`, { method: 'PUT', body: data, requireAuth: true }),
  deactivateCategory: async (id) => apiRequest(`/master/category/${id}/deactivate`, { method: 'PATCH', requireAuth: true }),
  activateCategory: async (id) => apiRequest(`/master/category/${id}/activate`, { method: 'PATCH', requireAuth: true }),

  getItemCodes: async () => {
    const response = await apiRequest('/master/item-codes', { method: 'GET', requireAuth: true });
    if (response.ok) {
      const extractedData = extractData(response);
      return { ...response, data: extractedData };
    }
    return response;
  },
  getItemCodeById: async (id) => apiRequest(`/master/item-codes/${id}`, { method: 'GET', requireAuth: true }),
  createItemCode: async (data) => apiRequest('/master/item-codes', { method: 'POST', body: data, requireAuth: true }),
  updateItemCode: async (id, data) => apiRequest(`/master/item-codes/${id}`, { method: 'PUT', body: data, requireAuth: true }),
  deactivateItemCode: async (id) => apiRequest(`/master/item-codes/${id}/deactivate`, { method: 'PATCH', requireAuth: true }),
  activateItemCode: async (id) => apiRequest(`/master/item-codes/${id}/activate`, { method: 'PATCH', requireAuth: true }),

  getPurchaseClasses: async () => {
    const response = await apiRequest('/master/purchase-class', { method: 'GET', requireAuth: true });
    if (response.ok) {
      const extractedData = extractData(response);
      return { ...response, data: extractedData };
    }
    return response;
  },
  getPurchaseClassById: async (id) => apiRequest(`/master/purchase-class/${id}`, { method: 'GET', requireAuth: true }),
  createPurchaseClass: async (data) => apiRequest('/master/purchase-class', { method: 'POST', body: data, requireAuth: true }),
  updatePurchaseClass: async (id, data) => apiRequest(`/master/purchase-class/${id}`, { method: 'PUT', body: data, requireAuth: true }),
  deactivatePurchaseClass: async (id) => apiRequest(`/master/purchase-class/${id}/deactivate`, { method: 'PATCH', requireAuth: true }),
  activatePurchaseClass: async (id) => apiRequest(`/master/purchase-class/${id}/activate`, { method: 'PATCH', requireAuth: true }),

  getUom: async () => {
    const response = await apiRequest('/master/uom', { method: 'GET', requireAuth: true });
    if (response.ok) {
      const extractedData = extractData(response);
      return { ...response, data: extractedData };
    }
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

  getAllItemMasters: async ({ page = 1, limit = 50, search = '' } = {}) => {
    let query = `?page=${page}&limit=${limit}`;
    if (search && search.trim()) {
      query += `&search=${encodeURIComponent(search.trim())}`;
    }
    return apiRequest(`/item-master${query}`, { method: 'GET', requireAuth: true });
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
    warehouse_id,
    status,
    search,
    start_date,
    end_date,
    page,
    limit,
  } = {}) => {
    const qs = new URLSearchParams();
    if (warehouse_id != null && warehouse_id !== '') qs.append('warehouse_id', warehouse_id);
    if (status && status !== 'All')                    qs.append('status', status);
    if (search && String(search).trim())               qs.append('search', String(search).trim());
    if (start_date)                                    qs.append('start_date', start_date);
    if (end_date)                                      qs.append('end_date', end_date);
    if (page != null && page !== '')                   qs.append('page', page);
    if (limit != null && limit !== '')                 qs.append('limit', limit);

    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    const response = await apiRequest(`/import-po${suffix}`, {
      method: 'GET',
      requireAuth: true,
    });

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

  /**
   * NEW: Handler view — returns one row per item (PO line) for the
   * caller's warehouse, filtered to handler-relevant statuses.
   */
  listHandlerItems: async ({
    warehouse_id,
    status,
    search,
    start_date,
    end_date,
    limit,
  } = {}) => {
    const qs = new URLSearchParams();
    if (warehouse_id != null && warehouse_id !== '') qs.append('warehouse_id', warehouse_id);
    if (status && status !== 'All')                    qs.append('status', status);
    if (search && String(search).trim())               qs.append('search', String(search).trim());
    if (start_date)                                    qs.append('start_date', start_date);
    if (end_date)                                      qs.append('end_date', end_date);
    if (limit != null && limit !== '')                 qs.append('limit', limit);

    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    const response = await apiRequest(`/import-po/handler-items${suffix}`, {
      method: 'GET',
      requireAuth: true,
    });

    if (response.ok) {
      return { ...response, data: response.data?.data ?? [] };
    }
    return response;
  },

  getPODetail: async (poNo, warehouse_id) => {
    const suffix = warehouse_id != null && warehouse_id !== ''
      ? `?warehouse_id=${encodeURIComponent(warehouse_id)}`
      : '';
    const response = await apiRequest(`/import-po/${encodeURIComponent(poNo)}${suffix}`, {
      method: 'GET',
      requireAuth: true,
    });
    if (response.ok) {
      return { ...response, data: response.data?.data ?? [] };
    }
    return response;
  },

  getPOActivity: async (poNo) => {
    const response = await apiRequest(
      `/import-po/${encodeURIComponent(poNo)}/activity`,
      { method: 'GET', requireAuth: true }
    );
    if (response.ok) {
      return { ...response, data: response.data?.data ?? [] };
    }
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
};

// ============================================
// STOCK TRANSFER API (STS)
// ============================================
export const stockTransferApi = {
  createSTS: async ({
    from_warehouse_id,
    to_warehouse_id,
    transfer_date,
    po_no = null,
    remarks = null,
    lines = [],
  } = {}) => {
    return apiRequest('/stock-transfer', {
      method: 'POST',
      body: {
        from_warehouse_id,
        to_warehouse_id,
        transfer_date,
        po_no,
        remarks,
        lines,
      },
      requireAuth: true,
    });
  },

  listSTSs: async ({
    status,
    from_warehouse_id,
    to_warehouse_id,
    search,
    start_date,
    end_date,
    submitted_by,
    approved_by,
    scope,
    limit,
  } = {}) => {
    const qs = new URLSearchParams();
    if (status && status !== 'All')                                qs.append('status', status);
    if (from_warehouse_id != null && from_warehouse_id !== '')     qs.append('from_warehouse_id', from_warehouse_id);
    if (to_warehouse_id   != null && to_warehouse_id   !== '')     qs.append('to_warehouse_id',   to_warehouse_id);
    if (search && String(search).trim())                           qs.append('search', String(search).trim());
    if (start_date)                                                qs.append('start_date', start_date);
    if (end_date)                                                  qs.append('end_date', end_date);
    if (submitted_by)                                              qs.append('submitted_by', submitted_by);
    if (approved_by)                                               qs.append('approved_by', approved_by);
    if (scope)                                                     qs.append('scope', scope);
    if (limit)                                                     qs.append('limit', limit);

    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    const response = await apiRequest(`/stock-transfer${suffix}`, {
      method: 'GET',
      requireAuth: true,
    });

    if (response.ok) {
      return { ...response, data: response.data?.data ?? [] };
    }
    return response;
  },

  listIncoming: async ({ status, search, to_warehouse_id } = {}) => {
    const qs = new URLSearchParams();
    if (status && status !== 'All')                                qs.append('status', status);
    if (search && String(search).trim())                           qs.append('search', String(search).trim());
    if (to_warehouse_id != null && to_warehouse_id !== '')         qs.append('to_warehouse_id', to_warehouse_id);

    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    const response = await apiRequest(`/stock-transfer/incoming${suffix}`, {
      method: 'GET',
      requireAuth: true,
    });

    if (response.ok) {
      return { ...response, data: response.data?.data ?? [] };
    }
    return response;
  },

  getIncomingSummary: async ({ to_warehouse_id } = {}) => {
    const qs = new URLSearchParams();
    if (to_warehouse_id != null && to_warehouse_id !== '') qs.append('to_warehouse_id', to_warehouse_id);

    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    const response = await apiRequest(`/stock-transfer/incoming-summary${suffix}`, {
      method: 'GET',
      requireAuth: true,
    });

    if (response.ok) {
      return { ...response, data: response.data?.data ?? { approved: 0, received: 0, total: 0 } };
    }
    return response;
  },

  getSummary: async () => {
    const response = await apiRequest('/stock-transfer/summary', {
      method: 'GET',
      requireAuth: true,
    });
    if (response.ok) {
      return { ...response, data: response.data?.data ?? null };
    }
    return response;
  },

  getTransferredQty: async (poNo) => {
    const response = await apiRequest(
      `/stock-transfer/transferred-qty?po_no=${encodeURIComponent(poNo)}`,
      { method: 'GET', requireAuth: true }
    );
    if (response.ok) {
      return { ...response, data: response.data?.data ?? {} };
    }
    return response;
  },

  getSTSDetail: async (stsId) => {
    const response = await apiRequest(`/stock-transfer/${stsId}`, {
      method: 'GET',
      requireAuth: true,
    });
    if (response.ok) {
      return { ...response, data: response.data?.data ?? null };
    }
    return response;
  },

  approveSTS: async (stsId) => {
    return apiRequest(`/stock-transfer/${stsId}/approve`, {
      method: 'POST',
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

  cancelSTS: async (stsId) => {
    return apiRequest(`/stock-transfer/${stsId}/cancel`, {
      method: 'POST',
      requireAuth: true,
    });
  },

  completeSTS: async (stsId) => {
    return apiRequest(`/stock-transfer/${stsId}/complete`, {
      method: 'POST',
      requireAuth: true,
    });
  },

  receiveSTS: async (stsId, remarks = null) => {
    const body = remarks ? { remarks: String(remarks).trim() } : {};
    return apiRequest(`/stock-transfer/${stsId}/receive`, {
      method: 'POST',
      body,
      requireAuth: true,
    });
  },
};

export default {
  authApi,
  userApi,
  warehouseApi,
  masterApi,
  itemMasterApi,
  importPoApi,
  stockTransferApi,
};