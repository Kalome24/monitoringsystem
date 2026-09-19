// src/auth/ProtectedRoute.jsx
import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { getRoleHomeRoute, normalizeRole } from '../permissions/roles';

const ProtectedRoute = ({ children, allowedRoles = [] }) => {
  const { user, isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <div className="loading-container">
        <div className="loading-spinner"></div>
        <p>Loading...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (allowedRoles.length > 0) {
    const userRole = normalizeRole(user);
    if (!allowedRoles.includes(userRole)) {
      return <Navigate to={getRoleHomeRoute(userRole)} replace />;
    }
  }

  return children;
};

export default ProtectedRoute;