// src/components/shared/ModalBanner.jsx
import React from 'react';
import {
  FiCheckCircle,
  FiXCircle,
  FiAlertTriangle,
  FiInfo,
  FiX,
} from 'react-icons/fi';

/* ============================================================
   ModalBanner — inline banner used INSIDE modal bodies.

   Usage:
     import ModalBanner from '../shared/ModalBanner';

     // Simple message:
     <ModalBanner type="error" message="Failed to save receipt." />

     // With title + close button:
     <ModalBanner
       type="warning"
       title="Validation"
       message="Enter a damage reason for ITEM-001."
       onClose={() => setFeedback(null)}
     />

     // With rich JSX content:
     <ModalBanner type="error">
       <ul>
         <li>Line 3: damage reason required</li>
         <li>Line 5: received exceeds sent</li>
       </ul>
     </ModalBanner>

   Types: 'success' | 'error' | 'warning' | 'info' (default: info)
   ============================================================ */

const ICONS = {
  success: FiCheckCircle,
  error:   FiXCircle,
  warning: FiAlertTriangle,
  info:    FiInfo,
};

let _bannerStylesInjected = false;
const injectBannerStyles = () => {
  if (_bannerStylesInjected) return;
  if (typeof document === 'undefined') return;
  if (document.getElementById('modal-banner-styles')) {
    _bannerStylesInjected = true;
    return;
  }
  const el = document.createElement('style');
  el.id = 'modal-banner-styles';
  el.textContent = MODAL_BANNER_CSS;
  document.head.appendChild(el);
  _bannerStylesInjected = true;
};

export const ModalBanner = ({
  type = 'info',
  title,
  children,
  message,
  onClose,
  showIcon = true,
  scroll = false,
  style,
  className = '',
}) => {
  injectBannerStyles();

  const content = children ?? message;
  if (content == null || content === '') return null;

  const classes = [
    'mb-banner',
    `mb-banner--${type}`,
    scroll ? 'mb-banner--scroll' : '',
    className,
  ].filter(Boolean).join(' ');

  const Icon = ICONS[type] || ICONS.info;

  return (
    <div
      className={classes}
      role={type === 'error' ? 'alert' : 'status'}
      aria-live={type === 'error' ? 'assertive' : 'polite'}
      style={style}
    >
      {showIcon && (
        <span className="mb-banner__icon" aria-hidden="true">
          <Icon />
        </span>
      )}
      <div className="mb-banner__body">
        {title && <div className="mb-banner__title">{title}</div>}
        <div className="mb-banner__message">{content}</div>
      </div>
      {onClose && (
        <button
          type="button"
          className="mb-banner__close"
          onClick={onClose}
          aria-label="Dismiss notification"
        >
          <FiX aria-hidden="true" />
        </button>
      )}
    </div>
  );
};

export default ModalBanner;

/* ============================================================
   CSS — injected once at module load
   ============================================================ */
const MODAL_BANNER_CSS = `
.mb-banner {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 14px;
  border-radius: 10px;
  border: 1.5px solid;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 13px;
  line-height: 1.55;
  width: 100%;
  box-sizing: border-box;
  animation: mbBannerIn 0.18s ease;
}

@keyframes mbBannerIn {
  from { opacity: 0; transform: translateY(-4px); }
  to   { opacity: 1; transform: translateY(0); }
}

.mb-banner__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.25em;
  height: 1.25em;
  flex-shrink: 0;
  margin-top: 1px;
}
.mb-banner__icon svg {
  width: 100%;
  height: 100%;
  stroke-width: 2.2;
}

.mb-banner__body {
  flex: 1;
  min-width: 0;
}

.mb-banner__title {
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  margin-bottom: 4px;
  opacity: 0.85;
}

.mb-banner__message {
  font-size: 13px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
}

.mb-banner__message ul,
.mb-banner__message ol {
  margin: 4px 0 0 0;
  padding-left: 20px;
}
.mb-banner__message li {
  margin-bottom: 2px;
  line-height: 1.5;
}
.mb-banner__message strong {
  font-weight: 700;
}
.mb-banner__message code {
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-size: 12px;
  padding: 1px 5px;
  background: rgba(0, 0, 0, 0.06);
  border-radius: 4px;
}

.mb-banner__close {
  background: transparent;
  border: none;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  cursor: pointer;
  color: inherit;
  opacity: 0.6;
  font-size: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-top: 1px;
  transition: opacity 0.15s ease, background 0.15s ease;
}
.mb-banner__close svg {
  width: 1em;
  height: 1em;
  stroke-width: 2.4;
}
.mb-banner__close:hover { opacity: 1; background: rgba(0, 0, 0, 0.06); }
.mb-banner__close:focus-visible {
  outline: 2px solid currentColor;
  outline-offset: 2px;
}

.mb-banner--success {
  background: #f0fdf4;
  border-color: #86efac;
  color: #065f46;
}
.mb-banner--error {
  background: #fef2f2;
  border-color: #fecaca;
  color: #991b1b;
}
.mb-banner--warning {
  background: #fffbeb;
  border-color: #fde68a;
  color: #92400e;
}
.mb-banner--info {
  background: #eff6ff;
  border-color: #bfdbfe;
  color: #1e40af;
}

.mb-banner--scroll .mb-banner__message {
  max-height: 220px;
  overflow-y: auto;
  padding-right: 4px;
}
.mb-banner--scroll .mb-banner__message::-webkit-scrollbar {
  width: 6px;
}
.mb-banner--scroll .mb-banner__message::-webkit-scrollbar-track {
  background: rgba(0, 0, 0, 0.04);
  border-radius: 3px;
}
.mb-banner--scroll .mb-banner__message::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.15);
  border-radius: 3px;
}

@media (prefers-reduced-motion: reduce) {
  .mb-banner { animation: none; }
}
`;