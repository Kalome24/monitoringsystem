// src/components/shared/ToastProvider.jsx
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

/* ============================================================
   Toast system for the entire app.

   Usage:
     const toast = useToast();
     toast.success('Receipt saved.');
     toast.error('Could not save — check your connection.');
     toast.warning('Partial receive — 3 of 5 units arrived.');
     toast.info('Changes will apply on the next page load.');

   Or convert an API response automatically:
     import { toastFromResponse } from '../shared/ToastProvider';
     const ok = toastFromResponse(toast, res, { fallback: 'Save failed.' });
     if (!ok) return;

   The provider auto-injects its own <style> tag once on mount, so
   there is nothing to import in your global CSS.
   ============================================================ */

const ToastContext = createContext(null);

const DEFAULT_DURATION = 4500;   // ms
const MAX_TOASTS       = 6;

let _seq = 0;
const nextId = () => `t_${Date.now().toString(36)}_${++_seq}`;

const ICON = {
  success: '✅',
  error:   '❌',
  warning: '⚠️',
  info:    'ℹ️',
};

/* ---------- Single toast ---------- */
const ToastItem = ({ toast, onClose }) => {
  useEffect(() => {
    if (!toast.duration || toast.duration <= 0) return undefined;
    const t = setTimeout(() => onClose(toast.id), toast.duration);
    return () => clearTimeout(t);
  }, [toast.id, toast.duration, onClose]);

  const type = toast.type || 'info';

  return (
    <div
      className={`ims-toast ims-toast--${type}`}
      role={type === 'error' ? 'alert' : 'status'}
      aria-live={type === 'error' ? 'assertive' : 'polite'}
    >
      <div className="ims-toast__icon" aria-hidden="true">
        {ICON[type] || ICON.info}
      </div>

      <div className="ims-toast__body">
        {toast.title && <div className="ims-toast__title">{toast.title}</div>}
        <div className="ims-toast__message">{toast.message}</div>
      </div>

      <button
        type="button"
        className="ims-toast__close"
        onClick={() => onClose(toast.id)}
        aria-label="Dismiss notification"
      >
        ✕
      </button>

      {toast.duration > 0 && (
        <div
          className="ims-toast__bar"
          style={{ animationDuration: `${toast.duration}ms` }}
        />
      )}
    </div>
  );
};

/* ---------- Provider ---------- */
export const ToastProvider = ({ children, position = 'top-right' }) => {
  const [toasts, setToasts] = useState([]);
  const styleInjectedRef = useRef(false);

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback((type, message, options = {}) => {
    if (message == null || message === '') return null;
    const id = nextId();
    const toast = {
      id,
      type,
      title:    options.title || null,
      message:  typeof message === 'string' ? message : String(message),
      duration: typeof options.duration === 'number'
        ? options.duration
        : DEFAULT_DURATION,
    };
    setToasts((prev) => {
      const next = [toast, ...prev];
      return next.length > MAX_TOASTS ? next.slice(0, MAX_TOASTS) : next;
    });
    return id;
  }, []);

  const api = useMemo(
    () => ({
      success: (msg, opts) => push('success', msg, opts),
      error:   (msg, opts) => push('error',   msg, opts),
      warning: (msg, opts) => push('warning', msg, opts),
      info:    (msg, opts) => push('info',    msg, opts),
      dismiss,
      clear:   () => setToasts([]),
    }),
    [push, dismiss]
  );

  // Escape dismisses the newest toast
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && toasts.length > 0) {
        dismiss(toasts[0].id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toasts, dismiss]);

  // Inject styles once
  useEffect(() => {
    if (styleInjectedRef.current) return;
    if (typeof document === 'undefined') return;
    if (document.getElementById('ims-toast-styles')) {
      styleInjectedRef.current = true;
      return;
    }
    const styleEl = document.createElement('style');
    styleEl.id = 'ims-toast-styles';
    styleEl.textContent = TOAST_CSS;
    document.head.appendChild(styleEl);
    styleInjectedRef.current = true;
  }, []);

  const portalTarget = typeof document !== 'undefined' ? document.body : null;

  return (
    <ToastContext.Provider value={api}>
      {children}
      {portalTarget &&
        createPortal(
          <div className={`ims-toast-viewport ims-toast-viewport--${position}`}>
            {toasts.map((t) => (
              <ToastItem key={t.id} toast={t} onClose={dismiss} />
            ))}
          </div>,
          portalTarget
        )}
    </ToastContext.Provider>
  );
};

/* ---------- Hook ---------- */
export const useToast = () => {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    if (typeof window !== 'undefined') {
      // eslint-disable-next-line no-console
      console.warn('useToast() called outside <ToastProvider> — falling back to console.');
    }
    return {
      success: (msg) => console.log('[toast:success]', msg),
      error:   (msg) => console.error('[toast:error]', msg),
      warning: (msg) => console.warn('[toast:warning]', msg),
      info:    (msg) => console.info('[toast:info]', msg),
      dismiss: () => {},
      clear:   () => {},
    };
  }
  return ctx;
};

/* ============================================================
   Convert an API response into a toast automatically.
   ============================================================ */
export const toastFromResponse = (toast, res, { fallback = 'Something went wrong.' } = {}) => {
  if (!res) {
    toast.error(fallback);
    return false;
  }

  const status  = Number(res.status) || 0;
  const isOk    = res.ok === true && res.data?.success !== false;
  const message = res.data?.message || fallback;

  if (isOk) {
    const hasWarnings =
      res.data?.warning ||
      (Array.isArray(res.data?.warnings) && res.data.warnings.length > 0);
    if (hasWarnings) {
      toast.warning(message);
    } else {
      toast.success(message);
    }
    return true;
  }

  if (status >= 500) {
    toast.error(message, { title: 'Server error' });
  } else if (status === 401) {
    toast.warning(message, { title: 'Session' });
  } else if (status === 403) {
    toast.warning(message, { title: 'Not authorized' });
  } else if (status === 404) {
    toast.error(message, { title: 'Not found' });
  } else if (status === 409) {
    toast.warning(message, { title: 'Conflict' });
  } else {
    toast.error(message);
  }
  return false;
};

/* ---------- CSS injected at runtime ---------- */
const TOAST_CSS = `
.ims-toast-viewport {
  position: fixed;
  z-index: 2147483647;
  display: flex;
  flex-direction: column;
  gap: 12px;
  pointer-events: none;
  max-width: min(460px, calc(100vw - 32px));
}
.ims-toast-viewport--top-right    { top: 24px; right: 24px; }
.ims-toast-viewport--top-left     { top: 24px; left: 24px; }
.ims-toast-viewport--top-center   { top: 24px; left: 50%; transform: translateX(-50%); }
.ims-toast-viewport--bottom-right { bottom: 24px; right: 24px; flex-direction: column-reverse; }
.ims-toast-viewport--bottom-left  { bottom: 24px; left: 24px; flex-direction: column-reverse; }
.ims-toast-viewport--bottom-center{ bottom: 24px; left: 50%; transform: translateX(-50%); flex-direction: column-reverse; }

/* ============ Base toast card ============ */
.ims-toast {
  pointer-events: auto;
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 16px 48px 16px 20px;
  border-radius: 12px;
  background: #ffffff;
  border: 2px solid #e2e8f0;
  border-left-width: 6px;
  box-shadow:
    0 12px 36px rgba(15, 23, 42, 0.22),
    0 4px 12px rgba(15, 23, 42, 0.10);
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 15px;
  color: #0f172a;
  overflow: hidden;
  animation: imsToastIn 0.24s cubic-bezier(0.34, 1.3, 0.64, 1);
  min-width: 360px;
  max-width: 100%;
}

@keyframes imsToastIn {
  from { opacity: 0; transform: translateX(28px) scale(0.98); }
  to   { opacity: 1; transform: translateX(0) scale(1); }
}

/* Viewport on the left side — slide in from the left instead */
.ims-toast-viewport--top-left .ims-toast,
.ims-toast-viewport--bottom-left .ims-toast {
  animation-name: imsToastInFromLeft;
}
@keyframes imsToastInFromLeft {
  from { opacity: 0; transform: translateX(-28px) scale(0.98); }
  to   { opacity: 1; transform: translateX(0) scale(1); }
}

/* ============ Type colors ============ */
.ims-toast--success {
  background: #f0fdf4;
  border-color: #86efac;
  border-left-color: #16a34a;
  color: #065f46;
}
.ims-toast--success .ims-toast__icon { color: #16a34a; }
.ims-toast--success .ims-toast__bar  { background: #16a34a; }

.ims-toast--error {
  background: #fef2f2;
  border-color: #fecaca;
  border-left-color: #dc2626;
  color: #991b1b;
  box-shadow:
    0 12px 36px rgba(220, 38, 38, 0.22),
    0 4px 12px rgba(15, 23, 42, 0.10);
}
.ims-toast--error .ims-toast__icon { color: #dc2626; }
.ims-toast--error .ims-toast__bar  { background: #dc2626; }

.ims-toast--warning {
  background: #fffbeb;
  border-color: #fde68a;
  border-left-color: #d97706;
  color: #92400e;
}
.ims-toast--warning .ims-toast__icon { color: #d97706; }
.ims-toast--warning .ims-toast__bar  { background: #d97706; }

.ims-toast--info {
  background: #eff6ff;
  border-color: #bfdbfe;
  border-left-color: #2563eb;
  color: #1e40af;
}
.ims-toast--info .ims-toast__icon { color: #2563eb; }
.ims-toast--info .ims-toast__bar  { background: #2563eb; }

/* ============ Content ============ */
.ims-toast__icon {
  font-size: 22px;
  line-height: 1.3;
  flex-shrink: 0;
  margin-top: 1px;
}

.ims-toast__body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.ims-toast__title {
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  opacity: 0.85;
  margin-bottom: 1px;
}
.ims-toast__message {
  font-size: 15px;
  font-weight: 500;
  line-height: 1.55;
  white-space: pre-line;
  word-break: break-word;
}

/* ============ Close button ============ */
.ims-toast__close {
  position: absolute;
  top: 12px;
  right: 12px;
  flex-shrink: 0;
  background: transparent;
  border: none;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  cursor: pointer;
  color: inherit;
  opacity: 0.55;
  font-size: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: opacity 0.15s ease, background 0.15s ease;
}
.ims-toast__close:hover { opacity: 1; background: rgba(0, 0, 0, 0.08); }
.ims-toast__close:focus-visible {
  outline: 2px solid currentColor;
  outline-offset: 2px;
}

/* ============ Progress bar ============ */
.ims-toast__bar {
  position: absolute;
  left: 0;
  bottom: 0;
  height: 3px;
  width: 100%;
  background: currentColor;
  opacity: 0.55;
  transform-origin: left center;
  animation-name: imsToastBar;
  animation-timing-function: linear;
  animation-fill-mode: forwards;
}

@keyframes imsToastBar {
  from { transform: scaleX(1); }
  to   { transform: scaleX(0); }
}

/* ============ Responsive ============ */
@media (max-width: 640px) {
  .ims-toast-viewport--top-right,
  .ims-toast-viewport--top-left,
  .ims-toast-viewport--top-center {
    top: 12px; left: 12px; right: 12px;
    transform: none;
    max-width: none;
  }
  .ims-toast-viewport--bottom-right,
  .ims-toast-viewport--bottom-left,
  .ims-toast-viewport--bottom-center {
    bottom: 12px; left: 12px; right: 12px;
    transform: none;
    max-width: none;
  }
  .ims-toast {
    min-width: 0;
    width: 100%;
    padding: 14px 44px 14px 16px;
    gap: 12px;
    font-size: 14px;
  }
  .ims-toast__icon { font-size: 20px; }
  .ims-toast__message { font-size: 14px; }
  .ims-toast__title { font-size: 11px; }
}

@media (prefers-reduced-motion: reduce) {
  .ims-toast { animation: none; }
  .ims-toast__bar { animation: none; opacity: 0; }
}
`;

export default ToastProvider;