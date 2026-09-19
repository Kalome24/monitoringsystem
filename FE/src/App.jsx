// src/App.jsx
import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import ProtectedRoute from './auth/ProtectedRoute';
import Login from './auth/Login';

import SupAdmin from './components/dashboards/SupAdmin';
import AdminDashboard from './components/dashboards/AdminDashboard';
import RegistrarDashboard from './components/dashboards/RegistrarDashboard';
import StockHandler from './components/dashboards/StockHandler';

import { ROLES } from './permissions/roles';
import './App.css';

function App() {
  return (
    <Router>
      <AuthProvider>
        <div className="app-container">
          <Routes>
            <Route path="/login" element={<Login />} />

            <Route
              path="/super-admin"
              element={
                <ProtectedRoute allowedRoles={[ROLES.SUPER_ADMIN]}>
                  <SupAdmin />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin"
              element={
                <ProtectedRoute allowedRoles={[ROLES.ADMIN]}>
                  <AdminDashboard />
                </ProtectedRoute>
              }
            />
            <Route
              path="/registrar"
              element={
                <ProtectedRoute allowedRoles={[ROLES.REGISTRAR]}>
                  <RegistrarDashboard />
                </ProtectedRoute>
              }
            />
            <Route
              path="/handler"
              element={
                <ProtectedRoute allowedRoles={[ROLES.HANDLER]}>
                  <StockHandler />
                </ProtectedRoute>
              }
            />

            <Route path="/dashboard" element={<Navigate to="/login" replace />} />
            <Route path="/" element={<Navigate to="/login" replace />} />
            <Route path="*" element={<Navigate to="/login" replace />} />
          </Routes>
        </div>
      </AuthProvider>
    </Router>
  );
}

export default App;