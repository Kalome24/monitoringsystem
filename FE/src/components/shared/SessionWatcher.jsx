// src/components/shared/SessionWatcher.jsx
import { useEffect, useRef } from 'react';
import { useToast } from './ToastProvider';

/**
 * Renders nothing. Listens for two app-wide events and shows toasts:
 *
 *   ims:session-expiring  → fires ~5 minutes before the JWT dies
 *                           (dispatched by AuthContext)
 *
 *   ims:session-expired   → fires when the API rejects a request with a
 *                           real session error (dispatched by services/api.js)
 *
 * Also stores the logout reason in sessionStorage so the Login page
 * can show a persistent banner after the redirect.
 *
 * Must be rendered inside <ToastProvider>.
 */
const SessionWatcher = () => {
  const toast = useToast();
  const lastWarnedMinuteRef = useRef(null);

  useEffect(() => {
    // ---- Approaching expiry: warn once per distinct minute value ----
    const onExpiring = (e) => {
      const minLeft = Math.max(1, e.detail?.minutesLeft ?? 5);
      if (lastWarnedMinuteRef.current === minLeft) return;
      lastWarnedMinuteRef.current = minLeft;

      toast.warning(
        `You'll be logged out in ${minLeft} minute${minLeft === 1 ? '' : 's'}. Save your work.`,
        { title: 'Session expiring', duration: 15000 }
      );
    };

    // ---- Session ended: toast + remember why for the Login page ----
    const onExpired = (e) => {
      const reason = e.detail?.reason;
      const msg =
        reason === 'SESSION_ELSEWHERE'
          ? 'You were signed out because your account logged in from another device.'
          : reason === 'SESSION_REVOKED'
          ? 'Your session was ended by an administrator.'
          : reason === 'INVALID_TOKEN'
          ? 'Your session is no longer valid. Please log in again.'
          : reason === 'USER_NOT_FOUND'
          ? 'Your account is no longer available.'
          : 'Your session expired. Please log in again.';

      try {
        sessionStorage.setItem('ims:logoutReason', msg);
      } catch {
        /* sessionStorage can throw in private mode — ignore */
      }

      toast.error(msg, { title: 'Signed out', duration: 8000 });
    };

    window.addEventListener('ims:session-expiring', onExpiring);
    window.addEventListener('ims:session-expired', onExpired);
    return () => {
      window.removeEventListener('ims:session-expiring', onExpiring);
      window.removeEventListener('ims:session-expired', onExpired);
    };
  }, [toast]);

  return null;
};

export default SessionWatcher;