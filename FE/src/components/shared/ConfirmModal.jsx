// src/components/shared/ConfirmModal.jsx
import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import './ConfirmModal.css';

/**
 * Reusable confirmation modal.
 *
 * Renders into document.body so parent stacking contexts (sidebar, dropdowns)
 * can't clip it. Handles Esc, backdrop-click, focus trap, scroll lock, and
 * focus restoration.
 *
 * Usage:
 *   <ConfirmModal
 *     isOpen={showConfirm}
 *     onConfirm={handleYes}
 *     onCancel={handleNo}
 *     title="Log out?"
 *     message="Are you sure you want to log out of your account?"
 *     confirmLabel="Yes, Log out"
 *     cancelLabel="No, stay logged in"
 *     variant="danger"
 *     icon="🚪"
 *     isLoading={loggingOut}
 *   />
 *
 * Props:
 *   isOpen          bool    — controls visibility
 *   onConfirm       fn      — called when the user confirms
 *   onCancel        fn      — called on backdrop click / Esc / cancel button
 *   title           string  — heading
 *   message         node    — body text (string or JSX)
 *   confirmLabel    string  — confirm button text
 *   cancelLabel     string  — cancel button text
 *   variant         string  — 'primary' | 'danger' | 'warning'
 *   icon            node    — emoji/JSX; pass null to hide the icon circle
 *   isLoading       bool    — disables both buttons, blocks Esc/backdrop
 *   closeOnBackdrop bool    — default true
 */
const ConfirmModal = ({
  isOpen,
  onConfirm,
  onCancel,
  title = 'Are you sure?',
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'primary',
  icon = null,
  isLoading = false,
  closeOnBackdrop = true,
}) => {
  const modalRef = useRef(null);
  const confirmBtnRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;

    const previouslyFocused = document.activeElement;

    // Esc → cancel, Tab → cycle focus inside the modal
    const onKey = (e) => {
      if (e.key === 'Escape' && !isLoading) {
        e.preventDefault();
        onCancel();
        return;
      }
      if (e.key !== 'Tab') return;

      const node = modalRef.current;
      if (!node) return;

      const focusables = node.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (!focusables.length) return;

      const first = focusables[0];
      const last = focusables[focusables.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKey);

    // Move focus to the confirm button shortly after mount
    const focusTimer = setTimeout(() => {
      confirmBtnRef.current?.focus();
    }, 20);

    // Lock body scroll while the modal is open
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKey);
      clearTimeout(focusTimer);
      document.body.style.overflow = prevOverflow || '';

      if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
        try { previouslyFocused.focus(); } catch { /* ignore */ }
      }
    };
  }, [isOpen, isLoading, onCancel]);

  if (!isOpen) return null;

  const handleBackdropClick = (e) => {
    if (e.target !== e.currentTarget) return;   // ignore clicks on children
    if (!closeOnBackdrop || isLoading) return;
    onCancel();
  };

  const modal = (
    <div
      className="confirm-modal-backdrop"
      onClick={handleBackdropClick}
      role="presentation"
    >
      <div
        ref={modalRef}
        className={`confirm-modal is-${variant}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
        aria-describedby={message ? 'confirm-modal-desc' : undefined}
      >
        {icon !== null && icon !== undefined && (
          <div className="confirm-modal-icon" aria-hidden="true">
            {icon}
          </div>
        )}

        <h2 id="confirm-modal-title" className="confirm-modal-title">
          {title}
        </h2>

        {message && (
          <div id="confirm-modal-desc" className="confirm-modal-message">
            {message}
          </div>
        )}

        <div className="confirm-modal-actions">
          <button
            type="button"
            className="confirm-modal-btn is-cancel"
            onClick={onCancel}
            disabled={isLoading}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            ref={confirmBtnRef}
            className="confirm-modal-btn is-confirm"
            onClick={onConfirm}
            disabled={isLoading}
          >
            {isLoading ? 'Please wait…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );

  if (typeof document === 'undefined') return modal;
  return createPortal(modal, document.body);
};

export default ConfirmModal;