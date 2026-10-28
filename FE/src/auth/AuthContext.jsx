// src/auth/AuthContext.jsx
import React, { createContext, useState, useContext, useEffect, useRef } from 'react';
import {
  getUser,
  setUser,
  getToken,
  setToken,
  removeToken,
  logoutWithNotice,
  setLogoutNotice,
} from '../secure/auth';
import { authApi, setInactivityBanner } from '../services/api';

const AuthContext = createContext();

// ---------------------------------------------------------------------------
// Idle timing
// ---------------------------------------------------------------------------
const INACTIVITY_MS     = 30 * 60 * 1000;  // 30 minutes
const HEARTBEAT_GATE_MS = 25 * 60 * 1000;  // 25 minutes

const ACTIVITY_EVENTS = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'];

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [user, setUserState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const lastActivityRef = useRef(Date.now());
  const heartbeatRef = useRef(null);

  useEffect(() => {
    const checkAuth = async () => {
      const token = getToken();
      const savedUser = getUser();

      if (token && savedUser) {
        setUserState(savedUser);
        try {
          const response = await authApi.getCurrentUser();
          if (response.ok && response.data) {
            let userData = response.data.user || response.data.data?.user || response.data;
            if (userData?.id) {
              setUserState(userData);
              setUser(userData);
            }
          }
        } catch (error) {
          console.warn('Token verification failed:', error.message);
          removeToken();
          setUserState(null);
        }
      }
      setLoading(false);
    };
    checkAuth();
  }, []);

  // ---- Proactive expiry warning ----
  useEffect(() => {
    if (!user) return;

    let cancelled = false;

    const checkExpiry = () => {
      if (cancelled) return;

      const token = getToken();
      if (!token) return;

      let payload;
      try {
        payload = JSON.parse(atob(token.split('.')[1]));
      } catch {
        return;
      }

      const exp = Number(payload.exp);
      if (!exp) return;

      const secondsLeft = exp - Math.floor(Date.now() / 1000);

      if (secondsLeft > 0 && secondsLeft <= 300) {
        window.dispatchEvent(
          new CustomEvent('ims:session-expiring', {
            detail: { minutesLeft: Math.max(1, Math.ceil(secondsLeft / 60)) },
          })
        );
      }
    };

    checkExpiry();
    const id = setInterval(checkExpiry, 60000);
    return () => { cancelled = true; clearInterval(id); };
  }, [user]);

  // ---- Idle auto-logout (client-side) ----
  // NOTE: does NOT write the thank-you logout notice — idle logout is a
  // passive event, not an explicit user action. Only handleLogout() does.
  useEffect(() => {
    if (!user) return;

    lastActivityRef.current = Date.now();

    let idleTimer = null;

    const handleIdleLogout = async () => {
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }

      setInactivityBanner();
      try {
        await authApi.logout();
      } catch (err) {
        console.warn('Idle logout API failed, clearing local state anyway:', err);
        removeToken();
      } finally {
        setUserState(null);
        setError(null);
      }
    };

    const resetIdleTimer = () => {
      lastActivityRef.current = Date.now();
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(handleIdleLogout, INACTIVITY_MS);
    };

    ACTIVITY_EVENTS.forEach((evt) =>
      window.addEventListener(evt, resetIdleTimer, { passive: true })
    );
    resetIdleTimer();

    return () => {
      ACTIVITY_EVENTS.forEach((evt) =>
        window.removeEventListener(evt, resetIdleTimer)
      );
      if (idleTimer) clearTimeout(idleTimer);
    };
  }, [user]);

  // ---- Heartbeat ----
  useEffect(() => {
    if (!user) return;

    const HEARTBEAT_MS = 4 * 60 * 1000;

    const ping = async () => {
      const idleMs = Date.now() - lastActivityRef.current;
      if (idleMs > HEARTBEAT_GATE_MS) return;

      try {
        await authApi.getCurrentUser();
      } catch {
        // Silent — a 401 here is handled by api.js.
      }
    };

    heartbeatRef.current = setInterval(ping, HEARTBEAT_MS);
    return () => {
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }
    };
  }, [user]);

  // ---- Session-expired listener ----
  useEffect(() => {
    const onExpired = () => {
      setUserState(null);
      setError(null);
    };
    window.addEventListener('ims:session-expired', onExpired);
    return () => window.removeEventListener('ims:session-expired', onExpired);
  }, []);

  // ---- Cross-tab logout sync ----
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === 'auth_token' && e.newValue === null) {
        setUserState(null);
        setError(null);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const handleLogin = (token, userData) => {
    if (token && userData) {
      setToken(token);
      setUser(userData);
      setUserState(userData);
      setError(null);
      lastActivityRef.current = Date.now();
    }
  };

  /**
   * Logout — clears the session on the SERVER first, then local state.
   *
   * On SUCCESS, writes the thank-you notice to sessionStorage so the
   * Login page can show a timed modal. On failure, we still clear local
   * state (so the user isn't stuck logged-in-looking), but no notice
   * is written — the thank-you modal is a reward for a clean logout.
   */
  const handleLogout = async () => {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }

    let succeeded = false;

    try {
      const res = await authApi.logout();
      succeeded = res?.ok === true;
    } catch (err) {
      console.warn('Logout API call failed, clearing local state anyway:', err);
      removeToken();
    } finally {
      if (succeeded) {
        setLogoutNotice();
      }
      setUserState(null);
      setError(null);
    }
  };

  /**
   * Clear local auth state WITHOUT calling the server.
   * Used after the server already killed the session (e.g. self-edit
   * returns requiresReauth: true). Optionally writes a persistent
   * banner message that survives the redirect to /login.
   */
  const forceLocalLogout = (bannerMessage) => {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
    logoutWithNotice(bannerMessage || null);
    setUserState(null);
    setError(null);
  };

  const updateUser = (userData) => {
    if (!userData || !userData.id) return;
    setUser(userData);
    setUserState(userData);
  };

  const refreshUser = async () => {
    try {
      const response = await authApi.getCurrentUser();
      if (response.ok && response.data) {
        const userData = response.data.user || response.data.data?.user || response.data;
        if (userData?.id) {
          setUser(userData);
          setUserState(userData);
          return userData;
        }
      }
    } catch (err) {
      console.warn('refreshUser failed:', err);
    }
    return null;
  };

  const value = {
    user,
    loading,
    error,
    isAuthenticated: !!user && !!getToken(),
    login: handleLogin,
    logout: handleLogout,
    updateUser,
    refreshUser,
    forceLocalLogout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};