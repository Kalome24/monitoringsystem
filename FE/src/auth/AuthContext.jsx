// src/auth/AuthContext.jsx
import React, { createContext, useState, useContext, useEffect } from 'react';
import { getUser, setUser, getToken, setToken, removeToken } from '../secure/auth';
import { authApi } from '../services/api';

const AuthContext = createContext();

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

  const handleLogin = (token, userData) => {
    if (token && userData) {
      setToken(token);
      setUser(userData);
      setUserState(userData);
      setError(null);
    }
  };

  /**
   * Logout — clears the session on the SERVER first, then local state.
   */
  const handleLogout = async () => {
    try {
      await authApi.logout();
    } catch (err) {
      console.warn('Logout API call failed, clearing local state anyway:', err);
      removeToken();
    } finally {
      setUserState(null);
      setError(null);
    }
  };

  /**
   * Replace the currently-stored user object.
   * Used after self-service profile updates (e.g., changing profile image)
   * so the UI reflects the change immediately, without refetching /users/me.
   */
  const updateUser = (userData) => {
    if (!userData || !userData.id) return;
    setUser(userData);       // persists to localStorage
    setUserState(userData);  // updates React state → re-renders everywhere
  };

  /**
   * Force a fresh fetch of the current user from the server.
   * Falls back to updating nothing if the call fails.
   */
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
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};