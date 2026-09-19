// src/auth/Login.jsx
import React, { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { authApi } from '../services/api';
import { normalizeRole, getRoleHomeRoute } from '../permissions/roles';
import './Login.css';

const PasswordToggle = ({ showPassword, onToggle, disabled }) => (
  <button
    type="button"
    className="toggle-btn"
    onClick={onToggle}
    aria-label={showPassword ? 'Hide password' : 'Show password'}
    disabled={disabled}
  >
    {showPassword ? (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
        <line x1="1" y1="1" x2="23" y2="23" />
      </svg>
    ) : (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    )}
  </button>
);

const FeedbackMessage = ({ message, type = 'error' }) => {
  if (!message) return null;
  const className = `feedback ${type === 'success' ? 'success' : 'error'}`;
  return (
    <div className={className} role="alert" aria-live="polite">
      {message}
    </div>
  );
};

const Login = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const navigate = useNavigate();
  const { login, isAuthenticated, loading, user } = useAuth();

  useEffect(() => {
    if (!loading && isAuthenticated && user) {
      navigate(getRoleHomeRoute(normalizeRole(user)), { replace: true });
    }
  }, [isAuthenticated, loading, user, navigate]);

  const handleLogin = useCallback(async (e) => {
    e.preventDefault();
    if (isLoading) return;

    setError('');
    if (!username.trim() || !password.trim()) {
      setError('Username and password are required.');
      return;
    }

    setIsLoading(true);
    try {
      const response = await authApi.login(username.trim(), password.trim());

      if (response.ok && response.data) {
        const { user, token } = response.data;
        if (token && user) {
          login(token, user);
        } else {
          setError('Invalid login response. Please try again.');
        }
      } else {
        setError(response.data?.message || 'Invalid credentials');
      }
    } catch (err) {
      setError('Connection error. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }, [username, password, login, isLoading]);

  const handleForgotPassword = useCallback(() => {
    setError('📧 Contact your system administrator for password reset.');
  }, []);

  if (loading) {
    return (
      <div className="login-container">
        <div className="login-bg">
          <div className="glow-pulse"></div>
        </div>
        <div className="login-card">
          <div className="loading-container">
            <div className="loading-spinner"></div>
            <p>Loading...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="login-container">
      <div className="login-bg">
        <div className="glow-pulse"></div>
      </div>

      <div className="login-card">
        <div className="brand">
          <div className="brand-icon">
            <img src="/lepantologo.svg" alt="Company Logo" className="brand-logo" />
          </div>
          <h1>Inventory Monitoring System</h1>
        </div>
        <p className="subtitle">Welcome</p>

        <form className="login-form" onSubmit={handleLogin}>
          <div className="field">
            <label htmlFor="username">Username</label>
            <input
              id="username"
              type="text"
              placeholder="Enter your username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={isLoading}
              autoComplete="off"
            />
          </div>

          <div className="field">
            <label htmlFor="password">Password</label>
            <div className="password-wrapper">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isLoading}
                autoComplete="off"
              />
              <PasswordToggle
                showPassword={showPassword}
                onToggle={() => setShowPassword((prev) => !prev)}
                disabled={isLoading}
              />
            </div>
          </div>

          <div className="options">
            <button
              type="button"
              className="forgot-link"
              onClick={handleForgotPassword}
              disabled={isLoading}
            >
              forgot password?
            </button>
          </div>

          <FeedbackMessage message={error} type={error.includes('successful') ? 'success' : 'error'} />

          <button
            type="submit"
            className={`login-btn ${isLoading ? 'loading' : ''}`}
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <span className="spinner" />
                signing in...
              </>
            ) : (
              'Log in'
            )}
          </button>
        </form>

        <div className="footer">
          <p>Inventory Management Department @2026</p>
          <span className="version">v1.0.0</span>
        </div>
      </div>
    </div>
  );
};

export default Login;