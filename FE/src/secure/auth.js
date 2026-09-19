// src/secure/auth.js
// Token and user management for localStorage

const TOKEN_KEY = 'auth_token';
const USER_KEY = 'auth_user';

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
 * Remove token and user data from localStorage.
 *
 * ⚠️ This only clears LOCAL state. It does NOT notify the backend.
 * For a proper logout, use `useAuth().logout()` from AuthContext —
 * that calls POST /api/users/logout first, then clears localStorage.
 *
 * This function exists for internal use (session-expired redirects,
 * 401 handling inside services/api.js) where the DB session is already
 * terminated or never existed.
 */
export const removeToken = () => {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  console.log('🗑️ Auth data cleared from localStorage');
};

/**
 * Store user data in localStorage
 * @param {Object} user - User object (including role, warehouse, etc.)
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
 * @returns {Object|null} User object or null
 */
export const getUser = () => {
  try {
    const userStr = localStorage.getItem(USER_KEY);

    if (!userStr || userStr === 'undefined' || userStr === 'null') {
      return null;
    }

    const user = JSON.parse(userStr);
    // Validate that it has an id (basic validation)
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

/**
 * Check if user is authenticated (has a token)
 * @returns {boolean} True if token exists
 */
export const isAuthenticated = () => {
  const token = getToken();
  return !!token;
};

/**
 * Check if the stored token is expired (by decoding it)
 * @returns {boolean} True if token is expired or invalid
 */
export const isTokenExpired = () => {
  const token = getToken();
  if (!token) return true;

  try {
    // Decode the token (without verifying signature)
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

/**
 * Get Authorization header for API requests
 * @returns {Object} Headers object with Authorization if token exists
 */
export const getAuthHeaders = () => {
  const token = getToken();
  return token ? { 'Authorization': `Bearer ${token}` } : {};
};

// ---------------------------------------------------------------------------
// NOTE: The `logout()` helper has been intentionally removed from this file.
//
// It used to just clear localStorage, which caused a bug: the backend's
// `active_session_token` was never cleared, so the single-session feature
// rejected subsequent logins as "SESSION_ACTIVE".
//
// For proper logout, always use:
//
//   import { useAuth } from '../auth/AuthContext';
//   const { logout } = useAuth();
//   await logout();  // hits POST /api/users/logout, then clears localStorage
//
// ---------------------------------------------------------------------------