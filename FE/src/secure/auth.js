// src/secure/auth.js
// Token and user management for localStorage

const TOKEN_KEY = 'auth_token';
const USER_KEY = 'auth_user';

// Prefix used by every sessionStorage key we persist for the
// stock-transfer UI (segment, search, filters). Kept as a named
// constant so the sweep below and any future readers agree on it.
const PERSISTED_TAB_PREFIX = 'sts:';

// ---------------------------------------------------------------------------
// Session-storage keys for post-redirect notices.
// ---------------------------------------------------------------------------
export const CREDENTIALS_NOTICE_KEY = 'ims:credentialsUpdateNotice';
export const LOGOUT_NOTICE_KEY      = 'ims:logoutNotice';

// The phrase shown on the post-logout modal on the Login page.
// Rendered as a title-case hero above a muted Lepanto mark.
export const LOGOUT_NOTICE_MESSAGE = 'Iyaman Kabsat';

/**
 * Store the authentication token in localStorage
 * @param {string} token - JWT token
 */
export const setToken = (token) => {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
    console.log('✅ Token saved to localStorage');
  } else {
    console.warn('⚠️ Attempted to save null token');
    localStorage.removeItem(TOKEN_KEY);
  }
};

/**
 * Retrieve the authentication token from localStorage
 * @returns {string|null} JWT token or null
 */
export const getToken = () => {
  return localStorage.getItem(TOKEN_KEY) || null;
};

/**
 * Clear every sessionStorage key that belongs to the persisted
 * stock-transfer UI state.
 */
const clearPersistedTabState = () => {
  try {
    if (typeof sessionStorage === 'undefined') return;

    const toRemove = [];
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const key = sessionStorage.key(i);
      if (key && key.startsWith(PERSISTED_TAB_PREFIX)) toRemove.push(key);
    }
    for (const key of toRemove) sessionStorage.removeItem(key);
  } catch {
    /* storage unavailable or quota exceeded — ignore */
  }
};

/**
 * Remove token and user data from localStorage, and clear any
 * persisted per-tab UI state.
 *
 * ⚠️ This only clears LOCAL state. It does NOT notify the backend.
 */
export const removeToken = () => {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  clearPersistedTabState();
  console.log('🗑️ Auth data cleared from localStorage');
};

/**
 * Store user data in localStorage
 */
export const setUser = (user) => {
  if (user && typeof user === 'object' && user.id) {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    console.log('✅ User saved to localStorage');
  } else {
    console.warn('⚠️ Attempted to save invalid user data');
    localStorage.removeItem(USER_KEY);
  }
};

/**
 * Retrieve user data from localStorage
 */
export const getUser = () => {
  try {
    const userStr = localStorage.getItem(USER_KEY);

    if (!userStr || userStr === 'undefined' || userStr === 'null') {
      return null;
    }

    const user = JSON.parse(userStr);
    if (user && user.id) {
      return user;
    } else {
      console.warn('⚠️ Invalid user data found, clearing');
      localStorage.removeItem(USER_KEY);
      return null;
    }
  } catch (error) {
    console.error('❌ Error parsing user from localStorage:', error);
    localStorage.removeItem(USER_KEY);
    return null;
  }
};

export const isAuthenticated = () => {
  const token = getToken();
  return !!token;
};

export const isTokenExpired = () => {
  const token = getToken();
  if (!token) return true;

  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    const exp = payload.exp;
    if (!exp) return true;
    const now = Math.floor(Date.now() / 1000);
    return exp < now;
  } catch (error) {
    console.warn('⚠️ Invalid token format, treating as expired');
    return true;
  }
};

export const getAuthHeaders = () => {
  const token = getToken();
  return token ? { 'Authorization': `Bearer ${token}` } : {};
};

// ---------------------------------------------------------------------------
// CREDENTIALS-UPDATE NOTICE
// ---------------------------------------------------------------------------
export const setCredentialsNotice = (message) => {
  try {
    if (message) sessionStorage.setItem(CREDENTIALS_NOTICE_KEY, message);
  } catch { /* ignore */ }
};

export const readCredentialsNotice = () => {
  try { return sessionStorage.getItem(CREDENTIALS_NOTICE_KEY); }
  catch { return null; }
};

export const clearCredentialsNotice = () => {
  try { sessionStorage.removeItem(CREDENTIALS_NOTICE_KEY); }
  catch { /* ignore */ }
};

export const logoutWithNotice = (message) => {
  if (message) setCredentialsNotice(message);
  removeToken();
};

// ---------------------------------------------------------------------------
// LOGOUT THANK-YOU NOTICE
// ---------------------------------------------------------------------------
// Written after a SUCCESSFUL explicit logout from the ProfileDropdown.
// Read by Login.jsx on mount, which then shows a timed modal
// (auto-dismisses in ~8s, or via X / Esc / Close button).
// Idle auto-logout and 401 session-expiry intentionally do NOT write this.
// ---------------------------------------------------------------------------
export const setLogoutNotice = (message) => {
  try {
    sessionStorage.setItem(LOGOUT_NOTICE_KEY, message || LOGOUT_NOTICE_MESSAGE);
  } catch { /* ignore */ }
};

export const readLogoutNotice = () => {
  try { return sessionStorage.getItem(LOGOUT_NOTICE_KEY); }
  catch { return null; }
};

export const clearLogoutNotice = () => {
  try { sessionStorage.removeItem(LOGOUT_NOTICE_KEY); }
  catch { /* ignore */ }
};

// ---------------------------------------------------------------------------
// NOTE: The `logout()` helper has been intentionally removed from this file.
//
// For proper logout, always use:
//
//   import { useAuth } from '../auth/AuthContext';
//   const { logout } = useAuth();
//   await logout();  // hits POST /api/users/logout, then clears localStorage
//
// ---------------------------------------------------------------------------