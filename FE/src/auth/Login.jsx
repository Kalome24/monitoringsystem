// src/auth/Login.jsx
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Clock,
  Lock,
  Hourglass,
  ArrowBigUp,
  ShieldCheck,
  X,
} from 'lucide-react';
import { useAuth } from './AuthContext';
import {
  authApi,
  readInactivityBanner,
  clearInactivityBanner,
  SESSION_ACTIVE_CODE,
  RATE_LIMITED_CODE,
} from '../services/api';
import {
  readCredentialsNotice,
  clearCredentialsNotice,
  readLogoutNotice,
  clearLogoutNotice,
} from '../secure/auth';
import { normalizeRole, getRoleHomeRoute } from '../permissions/roles';
import './Login.css';

/* ---------------------------------------------------------------------------
   Logo sources.
   Change ONLY these two constants if the filenames ever move. Both files
   must live in /public at the Vite project root.
     /public/ims-logo.png    → main system mark (login hero)
     /public/lepantologo.svg → parent company mark (footer, secondary)
   --------------------------------------------------------------------------- */
const IMS_LOGO_SRC     = '/ims-logo.png';
const LEPANTO_LOGO_SRC = '/lepantologo.svg';

/* How long the logout thank-you modal stays on screen before auto-dismiss. */
const LOGOUT_MODAL_AUTO_DISMISS_MS = 8000;

/* ============================================================
   ICONS — lucide-react
   ============================================================ */

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

const formatCountdown = (totalSeconds) => {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
};

const Login = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const [capsLock, setCapsLock] = useState(false);
  const [notice, setNotice] = useState('');
  const [sessionConflict, setSessionConflict] = useState(null);
  const [rateLimit, setRateLimit] = useState(null);

  const [credentialsNotice, setCredentialsNotice] = useState('');
  const [logoutNotice, setLogoutNotice] = useState('');

  const [showReclaim, setShowReclaim] = useState(false);
  const [reclaimUsername, setReclaimUsername] = useState('');
  const [reclaimPassword, setReclaimPassword] = useState('');
  const [reclaimLoading, setReclaimLoading] = useState(false);
  const [reclaimError, setReclaimError] = useState('');

  const [phase, setPhase] = useState('idle');

  const navigate = useNavigate();
  const { login, isAuthenticated, loading, user } = useAuth();

  const handledByAnimationRef = useRef(false);
  const timersRef = useRef([]);

  const credentialsOkRef = useRef(null);
  const logoutCloseRef = useRef(null);

  useEffect(() => () => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  }, []);

  // ---- Read persisted notices on mount ----
  useEffect(() => {
    try {
      const stored = sessionStorage.getItem('ims:logoutReason');
      if (stored) {
        setNotice(stored);
        sessionStorage.removeItem('ims:logoutReason');
      }
    } catch { /* ignore */ }

    try {
      const inactivityMsg = readInactivityBanner();
      if (inactivityMsg) {
        setNotice(inactivityMsg);
        clearInactivityBanner();
      }
    } catch { /* ignore */ }

    try {
      const credMsg = readCredentialsNotice();
      if (credMsg) setCredentialsNotice(credMsg);
    } catch { /* ignore */ }

    try {
      const logoutMsg = readLogoutNotice();
      if (logoutMsg) setLogoutNotice(logoutMsg);
    } catch { /* ignore */ }
  }, []);

  // ---- Credentials modal: Esc + scroll lock + focus ----
  useEffect(() => {
    if (!credentialsNotice) return;

    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        dismissCredentialsModal();
      }
    };
    document.addEventListener('keydown', onKey);

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const focusTimer = setTimeout(() => {
      credentialsOkRef.current?.focus();
    }, 60);

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow || '';
      clearTimeout(focusTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [credentialsNotice]);

  // ---- Logout modal: Esc + scroll lock + focus + 8s auto-dismiss ----
  useEffect(() => {
    if (!logoutNotice) return;

    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        dismissLogoutModal();
      }
    };
    document.addEventListener('keydown', onKey);

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const focusTimer = setTimeout(() => {
      logoutCloseRef.current?.focus();
    }, 60);

    const autoDismissTimer = setTimeout(() => {
      dismissLogoutModal();
    }, LOGOUT_MODAL_AUTO_DISMISS_MS);

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow || '';
      clearTimeout(focusTimer);
      clearTimeout(autoDismissTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logoutNotice]);

  useEffect(() => {
    if (loading || !isAuthenticated || !user) return;
    if (handledByAnimationRef.current) return;
    navigate(getRoleHomeRoute(normalizeRole(user)), { replace: true });
  }, [isAuthenticated, loading, user, navigate]);

  const hasRateLimit = !!rateLimit;
  useEffect(() => {
    if (!hasRateLimit) return;
    const id = setInterval(() => {
      setRateLimit((prev) => {
        if (!prev || prev.retryAfterSeconds <= 1) return null;
        return { ...prev, retryAfterSeconds: prev.retryAfterSeconds - 1 };
      });
    }, 1000);
    return () => clearInterval(id);
  }, [hasRateLimit]);

  const runSuccessFlow = useCallback((token, authUser) => {
    handledByAnimationRef.current = true;
    setIsLoading(false);
    setPhase('success');
    login(token, authUser);

    timersRef.current.push(setTimeout(() => setPhase('exit'), 1000));
    timersRef.current.push(setTimeout(() => {
      navigate(getRoleHomeRoute(normalizeRole(authUser)), { replace: true });
    }, 1750));
  }, [login, navigate]);

  const handleLogin = useCallback(async (e) => {
    e.preventDefault();
    if (isLoading || phase !== 'idle') return;

    setError('');
    setSessionConflict(null);
    setRateLimit(null);

    if (!username.trim() || !password.trim()) {
      setError('Username and password are required.');
      return;
    }

    setIsLoading(true);
    try {
      const response = await authApi.login(username.trim(), password.trim());

      if (response.ok && response.data) {
        const { user: authUser, token } = response.data;

        if (token && authUser) {
          clearCredentialsNotice();
          setCredentialsNotice('');
          clearLogoutNotice();
          setLogoutNotice('');
          runSuccessFlow(token, authUser);
          return;
        }
        setError('Invalid login response. Please try again.');
      } else {
        const code = response.data?.code;
        if (code === SESSION_ACTIVE_CODE) {
          setSessionConflict({
            message: response.data.message,
            since: response.data.active_session_at,
          });
        } else if (code === RATE_LIMITED_CODE) {
          setRateLimit({
            message: response.data?.message
              || 'Too many failed attempts. Please wait a few minutes and try again.',
            retryAfterSeconds: Number(response.data?.retry_after_seconds) || 300,
          });
        } else {
          setError(response.data?.message || 'Invalid credentials');
        }
      }
    } catch (err) {
      setError('Connection error. Please try again.');
    }
    setIsLoading(false);
  }, [username, password, runSuccessFlow, isLoading, phase]);

  const handleForgotPassword = useCallback(() => {
    setError('Contact your system administrator for password reset.');
  }, []);

  const dismissCredentialsModal = useCallback(() => {
    clearCredentialsNotice();
    setCredentialsNotice('');
  }, []);

  const dismissLogoutModal = useCallback(() => {
    clearLogoutNotice();
    setLogoutNotice('');
  }, []);

  const handleReclaim = useCallback(async (e) => {
    e.preventDefault();
    setReclaimError('');

    if (!reclaimUsername.trim() || !reclaimPassword) {
      setReclaimError('Username and password are required.');
      return;
    }

    const uname = reclaimUsername.trim();
    const pwd = reclaimPassword;

    setReclaimLoading(true);
    try {
      const clearRes = await authApi.logoutOtherDevices(uname, pwd);

      if (!clearRes.ok || clearRes.data?.success === false) {
        const code = clearRes.data?.code;
        if (code === RATE_LIMITED_CODE) {
          setReclaimError(
            clearRes.data?.message
              || 'Too many attempts. Please wait a few minutes and try again.'
          );
        } else {
          setReclaimError(clearRes.data?.message || 'Invalid username or password.');
        }
        setReclaimLoading(false);
        return;
      }

      const loginRes = await authApi.login(uname, pwd);

      if (loginRes.ok && loginRes.data) {
        const { user: authUser, token } = loginRes.data;
        if (token && authUser) {
          setShowReclaim(false);
          setReclaimPassword('');
          setReclaimError('');
          setSessionConflict(null);
          setRateLimit(null);
          setError('');
          setReclaimLoading(false);
          clearCredentialsNotice();
          setCredentialsNotice('');
          clearLogoutNotice();
          setLogoutNotice('');
          runSuccessFlow(token, authUser);
          return;
        }
      }

      const code = loginRes.data?.code;
      if (code === SESSION_ACTIVE_CODE) {
        setReclaimError(
          'The session was cleared, but the server still reports it active. ' +
          'Please wait a moment and try again.'
        );
      } else if (code === RATE_LIMITED_CODE) {
        setReclaimError(
          loginRes.data?.message || 'Too many attempts. Please wait a few minutes and try again.'
        );
      } else {
        setReclaimError(loginRes.data?.message || 'Session cleared, but login failed. Please try again.');
      }
    } catch (err) {
      console.error('Reclaim failed:', err);
      setReclaimError('Error connecting to server.');
    } finally {
      setReclaimLoading(false);
    }
  }, [reclaimUsername, reclaimPassword, runSuccessFlow]);

  if (loading) {
    return (
      <div className="login-container">
        <div className="login-bg" aria-hidden="true" />
        <div className="login-card">
          <div className="loading-container">
            <div className="loading-spinner"></div>
            <p>Loading...</p>
          </div>
        </div>
      </div>
    );
  }

  const isBusy = phase !== 'idle';
  const containerClass = `login-container${phase === 'exit' ? ' is-exit' : ''}`;
  const cardClass =
    `login-card${isBusy ? ' is-success' : ''}${phase === 'exit' ? ' is-exit' : ''}`;

  return (
    <div className={containerClass}>
      <div className="login-bg" aria-hidden="true" />

      <div className={cardClass}>
        {isBusy && (
          <div className="success-overlay" role="status" aria-live="polite">
            <span className="sr-only">Login successful. Redirecting…</span>
            <div className="success-burst" aria-hidden="true">
              <span className="success-ring" />
              <span className="success-ring" />
              <svg className="success-check" viewBox="0 0 52 52">
                <circle className="success-check-circle" cx="26" cy="26" r="24" />
                <path className="success-check-mark" d="M14 27l8 8 16-16" />
              </svg>
            </div>
          </div>
        )}

        {/* ============================ BRAND ============================ */}
        {/* Icon only — the visible title is now the <h1> below. */}
        <div className="brand">
          <div className="brand-icon">
            <div className="brand-icon-clip">
              <img
                src={IMS_LOGO_SRC}
                alt="Inventory Monitoring System"
                className="brand-logo"
              />
            </div>
          </div>
        </div>

        {/* Main visible + semantic heading of the page */}
        <h1 className="subtitle">WELCOME BACK</h1>

        {notice && (
          <div className="login-notice" role="status">
            <span className="login-notice-icon">
              <Clock size={16} strokeWidth={2} aria-hidden="true" />
            </span>
            <span className="login-notice-text">{notice}</span>
          </div>
        )}

        {sessionConflict && (
          <div className="session-conflict" role="alert">
            <div className="session-conflict-header">
              <span className="session-conflict-icon">
                <Lock size={16} strokeWidth={2} aria-hidden="true" />
              </span>
              <strong className="session-conflict-title">Account already in use</strong>
            </div>
            <div className="session-conflict-body">{sessionConflict.message}</div>
            {sessionConflict.since && (
              <div className="session-conflict-meta">
                Session started: {new Date(sessionConflict.since).toLocaleString()}
              </div>
            )}
          </div>
        )}

        {rateLimit && (
          <div className="rate-limit" role="alert" aria-live="polite">
            <div className="rate-limit-header">
              <span className="rate-limit-icon">
                <Hourglass size={16} strokeWidth={2} aria-hidden="true" />
              </span>
              <strong className="rate-limit-title">Too many failed attempts</strong>
            </div>
            <div className="rate-limit-body">{rateLimit.message}</div>
            <div className="rate-limit-countdown">
              <span>Try again in</span>
              <span className="rate-limit-countdown-value">
                {formatCountdown(rateLimit.retryAfterSeconds)}
              </span>
            </div>
          </div>
        )}

        <form className="login-form" onSubmit={handleLogin}>
          <div className="field">
            <label htmlFor="username">Username</label>
            <input
              id="username"
              type="text"
              placeholder="Enter your username"
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                if (sessionConflict) setSessionConflict(null);
                if (rateLimit) setRateLimit(null);
              }}
              disabled={isLoading || isBusy}
              autoComplete="username"
            />
          </div>

          <div className="field">
            <div className="field-label-row">
              <label htmlFor="password">Password</label>
              <button
                type="button"
                className="forgot-link"
                onClick={handleForgotPassword}
                disabled={isLoading || isBusy}
              >
                forgot password?
              </button>
            </div>
            <div className="password-wrapper">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                placeholder="Enter your password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (sessionConflict) setSessionConflict(null);
                  if (rateLimit) setRateLimit(null);
                }}
                onKeyDown={(e) => setCapsLock(e.getModifierState?.('CapsLock') || false)}
                onKeyUp={(e) => setCapsLock(e.getModifierState?.('CapsLock') || false)}
                onBlur={() => setCapsLock(false)}
                disabled={isLoading || isBusy}
                autoComplete="current-password"
              />
              <PasswordToggle
                showPassword={showPassword}
                onToggle={() => setShowPassword((prev) => !prev)}
                disabled={isLoading || isBusy}
              />
            </div>
            {capsLock && (
              <div className="caps-lock-hint" role="status">
                <ArrowBigUp size={12} strokeWidth={2} aria-hidden="true" />
                <span>Caps Lock is on</span>
              </div>
            )}
          </div>

          <FeedbackMessage
            message={error}
            type={error.includes('successful') ? 'success' : 'error'}
          />

          <button
            type="submit"
            className={`login-btn ${isLoading ? 'loading' : ''}`}
            disabled={isLoading || isBusy}
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

          <div className="reclaim-trigger-wrap">
            <button
              type="button"
              className="reclaim-trigger"
              onClick={() => {
                setShowReclaim(true);
                setReclaimUsername(username);
                setReclaimPassword('');
                setReclaimError('');
              }}
              disabled={isLoading || isBusy}
            >
              Can't log in? Log out from other devices
            </button>
          </div>
        </form>

        {/* ============================ FOOTER ============================ */}
        <div className="footer">
          <span className="footer-accent" aria-hidden="true" />
          <div className="footer-brand">
            <img
              src={LEPANTO_LOGO_SRC}
              alt="Lepanto"
              className="footer-logo"
            />
            <p>Inventory Management Department</p>
          </div>
          <span className="version">v1.0.0</span>
        </div>
      </div>

      {/* ============================================================
          CREDENTIALS-UPDATED MODAL
          ============================================================ */}
      {credentialsNotice && (
        <div className="credentials-modal-backdrop" role="presentation">
          <div
            className="credentials-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="credentials-modal-title"
            aria-describedby="credentials-modal-desc"
          >
            <button
              type="button"
              className="credentials-modal-close"
              onClick={dismissCredentialsModal}
              aria-label="Close"
            >
              <X size={20} strokeWidth={2.4} aria-hidden="true" />
            </button>

            <div className="credentials-modal-icon" aria-hidden="true">
              <ShieldCheck strokeWidth={2} />
            </div>

            <h2 id="credentials-modal-title" className="credentials-modal-title">
              Credentials Updated
            </h2>

            <p id="credentials-modal-desc" className="credentials-modal-message">
              {credentialsNotice}
            </p>

            <button
              type="button"
              ref={credentialsOkRef}
              className="credentials-modal-ok"
              onClick={dismissCredentialsModal}
            >
              OK
            </button>
          </div>
        </div>
      )}

      {/* ============================================================
          LOGOUT FAREWELL MODAL
          ------------------------------------------------------------
          Slim, formal. Only the phrase + a Lepanto mark, then Close.
          No kicker, no subtext — the phrase carries the moment.
          ============================================================ */}
      {logoutNotice && (
        <div className="logout-modal-backdrop" role="presentation">
          <div
            className="logout-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="logout-modal-title"
          >
            <button
              type="button"
              ref={logoutCloseRef}
              className="logout-modal-close"
              onClick={dismissLogoutModal}
              aria-label="Close"
            >
              <X size={20} strokeWidth={2.4} aria-hidden="true" />
            </button>

            <div id="logout-modal-title" className="logout-modal-hero">
              <span className="logout-modal-hero-text">{logoutNotice}</span>
              <span className="logout-modal-hero-glow" aria-hidden="true" />
            </div>

            <div className="logout-modal-logo" aria-hidden="true">
              <img src={LEPANTO_LOGO_SRC} alt="" />
            </div>

            <button
              type="button"
              className="logout-modal-ok"
              onClick={dismissLogoutModal}
            >
              Close
            </button>

            <div className="logout-modal-progress" aria-hidden="true">
              <div className="logout-modal-progress-bar" />
            </div>
          </div>
        </div>
      )}

      {showReclaim && (
        <div
          className="reclaim-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="reclaim-title"
          onClick={() => !reclaimLoading && setShowReclaim(false)}
        >
          <div className="reclaim-modal" onClick={(e) => e.stopPropagation()}>
            <h3 id="reclaim-title" className="reclaim-title">
              Log out from other devices
            </h3>
            <p className="reclaim-desc">
              If your account is stuck logged in on another device, enter your
              credentials below. This will end that session and sign you in
              here in one step.
            </p>

            {reclaimError && (
              <div className="reclaim-alert is-error" role="alert">
                {reclaimError}
              </div>
            )}

            <form onSubmit={handleReclaim}>
              <div className="reclaim-field">
                <label htmlFor="reclaim_username" className="reclaim-label">Username</label>
                <input
                  id="reclaim_username"
                  type="text"
                  className="reclaim-input"
                  value={reclaimUsername}
                  onChange={(e) => setReclaimUsername(e.target.value)}
                  autoComplete="username"
                  disabled={reclaimLoading}
                />
              </div>

              <div className="reclaim-field" style={{ marginBottom: 22 }}>
                <label htmlFor="reclaim_password" className="reclaim-label">Password</label>
                <input
                  id="reclaim_password"
                  type="password"
                  className="reclaim-input"
                  value={reclaimPassword}
                  onChange={(e) => setReclaimPassword(e.target.value)}
                  autoComplete="current-password"
                  disabled={reclaimLoading}
                />
              </div>

              <div className="reclaim-actions">
                <button
                  type="button"
                  className="reclaim-btn is-secondary"
                  onClick={() => setShowReclaim(false)}
                  disabled={reclaimLoading}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="reclaim-btn is-primary"
                  disabled={reclaimLoading}
                >
                  {reclaimLoading ? 'Signing in…' : 'Log out & sign in here'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Login;