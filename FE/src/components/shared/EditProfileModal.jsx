// src/components/shared/EditProfileModal.jsx
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  FiX,
  FiUser,
  FiAtSign,
  FiMail,
  FiLock,
  FiAlertCircle,
  FiShield,
  FiCheckCircle,
} from 'react-icons/fi';
import { userApi } from '../../services/api';

// ---------------------------------------------------------------------------
// Lepanto email policy
// ---------------------------------------------------------------------------
// Mirrors LEPANTO_EMAIL_PATTERN in D:\IMDBE\controllers\userController.js and
// the copy in src/components/admin/TabUsers.jsx. Fully anchored on BOTH ends,
// so lookalikes such as:
//
//   user@lepantomining.com.evil.tld   ← rejected (trailing junk)
//   user@not-lepantomining.com        ← rejected (wrong domain)
//   user@lepantomining                ← rejected (.com required)
//   user@lepantomining.com anything   ← rejected (space + trailing)
//
// are all refused client-side before the round-trip. Keep this in sync with
// the backend regex — the server is the source of truth, this is just the
// pre-flight check for instant feedback.
// ---------------------------------------------------------------------------
const LEPANTO_EMAIL_PATTERN = /^[A-Za-z0-9._%+-]+@lepantomining\.com$/i;
const USERNAME_PATTERN = /^[A-Za-z0-9._-]+$/;

/* ============================================================
   PASSWORD POLICY — must match the Super Admin user-edit form
   (TabUsers.jsx) and the backend (userController.updateMyProfile).
   ============================================================ */
const PASSWORD_RULES = [
  {
    key: 'length',
    label: 'At least 6 characters',
    test: (pw) => pw.length >= 6,
  },
  {
    key: 'uppercase',
    label: 'At least 1 uppercase letter',
    test: (pw) => /[A-Z]/.test(pw),
  },
  {
    key: 'lowercase',
    label: 'At least 1 lowercase letter',
    test: (pw) => /[a-z]/.test(pw),
  },
  {
    key: 'number',
    label: 'At least 1 number',
    test: (pw) => /[0-9]/.test(pw),
  },
  {
    key: 'special',
    label: 'At least 1 special character',
    test: (pw) => /[!@#$%^&*(),.?":{}|<>]/.test(pw),
  },
];

const PASSWORD_MAX_LENGTH = 100;

const getFailedPasswordRules = (password) => {
  if (!password) return PASSWORD_RULES.slice();
  return PASSWORD_RULES.filter((rule) => !rule.test(password));
};

const EditProfileModal = ({ isOpen, user, onClose, onSuccess }) => {
  const [firstName, setFirstName] = useState(user?.first_name || '');
  const [lastName, setLastName] = useState(user?.last_name || '');
  const [username, setUsername] = useState(user?.username || '');
  const [email, setEmail] = useState(user?.email || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);

  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const modalRef = useRef(null);
  const firstInputRef = useRef(null);
  const currentPwRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;

    const previouslyFocused = document.activeElement;

    const onKey = (e) => {
      if (e.key === 'Escape' && !saving) {
        e.preventDefault();
        onClose();
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
    const timer = setTimeout(() => firstInputRef.current?.focus(), 30);

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKey);
      clearTimeout(timer);
      document.body.style.overflow = prevOverflow || '';
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
        try { previouslyFocused.focus(); } catch { /* ignore */ }
      }
    };
  }, [isOpen, saving, onClose]);

  if (!isOpen) return null;

  const origFirst    = user?.first_name || '';
  const origLast     = user?.last_name  || '';
  const origUsername = user?.username   || '';
  const origEmail    = (user?.email || '').toLowerCase();

  const tFirst    = firstName.trim();
  const tLast     = lastName.trim();
  const tUsername = username.trim();
  const tEmail    = email.trim().toLowerCase();

  const firstChanged    = tFirst !== origFirst;
  const lastChanged     = tLast !== origLast;
  const usernameChanged = tUsername.toLowerCase() !== origUsername.toLowerCase();
  const emailChanged    = tEmail !== origEmail;
  const wantsNewPw      = newPassword.length > 0;

  const sensitiveChange = usernameChanged || emailChanged || wantsNewPw;
  const anyChange = firstChanged || lastChanged || sensitiveChange;

  const failedPwRules = wantsNewPw ? getFailedPasswordRules(newPassword) : [];

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!tFirst) return setError('First name is required.');
    if (!tLast)  return setError('Last name is required.');
    if (tFirst.length > 100) return setError('First name is too long.');
    if (tLast.length  > 100) return setError('Last name is too long.');
    if (!tUsername) return setError('Username is required.');
    if (tUsername.length < 3 || tUsername.length > 50) {
      return setError('Username must be between 3 and 50 characters.');
    }
    if (!USERNAME_PATTERN.test(tUsername)) {
      return setError('Username may only contain letters, numbers, dots, underscores, and hyphens.');
    }
    if (!tEmail) return setError('Email is required.');
    if (tEmail.length > 100 || !LEPANTO_EMAIL_PATTERN.test(tEmail)) {
      return setError('Email must be a Lepanto email (@lepantomining.com).');
    }
    if (!anyChange) return setError('No changes to save.');

    if (sensitiveChange && !currentPassword) {
      setError('Your current password is required to change your username, email, or password.');
      currentPwRef.current?.focus();
      return;
    }

    if (wantsNewPw) {
      if (newPassword.length > PASSWORD_MAX_LENGTH) {
        return setError('New password is too long.');
      }
      if (failedPwRules.length > 0) {
        return setError(
          'Password must contain: ' + failedPwRules.map((r) => r.label).join(' · ')
        );
      }
      if (newPassword !== confirmPassword) {
        return setError('New passwords do not match.');
      }
      if (currentPassword && newPassword === currentPassword) {
        return setError('New password must be different from your current password.');
      }
    }

    setSaving(true);
    try {
      const payload = {
        first_name: tFirst,
        last_name: tLast,
        username: tUsername,
        email: tEmail,
      };
      if (sensitiveChange) payload.current_password = currentPassword;
      if (wantsNewPw)      payload.new_password = newPassword;

      const res = await userApi.updateSelf(payload);

      if (res.ok && res.data?.success !== false) {
        const message = res.data?.message
          || 'Your credentials have been updated. Please log in again. Thank you.';
        const changedFields = res.data?.data?.changedFields || [];
        onSuccess?.(message, changedFields);
      } else {
        setError(res.data?.message || 'Failed to update profile.');
        setSaving(false);
      }
    } catch (err) {
      console.error('Edit profile failed:', err);
      setError('Network error. Please try again.');
      setSaving(false);
    }
  };

  const modal = (
    <div
      className="epm-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget && !saving) onClose();
      }}
      role="presentation"
    >
      <div
        ref={modalRef}
        className="epm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="epm-title"
      >
        <header className="epm-header">
          <div className="epm-header-text">
            <h2 id="epm-title" className="epm-title">Edit Profile</h2>
            <p className="epm-subtitle">
              Update your personal info, username, email, or password.
            </p>
          </div>
          <button
            type="button"
            className="epm-close"
            onClick={onClose}
            disabled={saving}
            aria-label="Close"
          >
            <FiX aria-hidden="true" />
          </button>
        </header>

        <form className="epm-form" onSubmit={handleSubmit} noValidate>
          <section className="epm-section">
            <h3 className="epm-section-title">Personal Info</h3>
            <div className="epm-grid epm-grid--two">
              <label className="epm-field">
                <span className="epm-label">First name</span>
                <span className="epm-input-wrap">
                  <FiUser className="epm-input-icon" aria-hidden="true" />
                  <input
                    ref={firstInputRef}
                    type="text"
                    className="epm-input"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    disabled={saving}
                    maxLength={100}
                    autoComplete="given-name"
                  />
                </span>
              </label>
              <label className="epm-field">
                <span className="epm-label">Last name</span>
                <span className="epm-input-wrap">
                  <FiUser className="epm-input-icon" aria-hidden="true" />
                  <input
                    type="text"
                    className="epm-input"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    disabled={saving}
                    maxLength={100}
                    autoComplete="family-name"
                  />
                </span>
              </label>
            </div>
          </section>

          <section className="epm-section">
            <h3 className="epm-section-title">Account</h3>
            <div className="epm-grid epm-grid--two">
              <label className="epm-field">
                <span className="epm-label">Username</span>
                <span className="epm-input-wrap">
                  <FiAtSign className="epm-input-icon" aria-hidden="true" />
                  <input
                    type="text"
                    className="epm-input"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    disabled={saving}
                    maxLength={50}
                    autoComplete="username"
                  />
                </span>
              </label>
              <label className="epm-field">
                <span className="epm-label">Email</span>
                <span className="epm-input-wrap">
                  <FiMail className="epm-input-icon" aria-hidden="true" />
                  <input
                    type="email"
                    className="epm-input"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={saving}
                    maxLength={100}
                    autoComplete="email"
                  />
                </span>
              </label>
            </div>
          </section>

          <section className="epm-section">
            <div className="epm-section-head">
              <h3 className="epm-section-title">Security</h3>
              {sensitiveChange && (
                <span className="epm-badge epm-badge--warn">
                  <FiShield aria-hidden="true" />
                  Current password required
                </span>
              )}
            </div>

            <div className="epm-grid">
              <label className="epm-field">
                <span className="epm-label">
                  Current password
                  {sensitiveChange && <span className="epm-req"> *</span>}
                </span>
                <span className="epm-input-wrap">
                  <FiLock className="epm-input-icon" aria-hidden="true" />
                  <input
                    ref={currentPwRef}
                    type={showPasswords ? 'text' : 'password'}
                    className="epm-input"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    disabled={saving}
                    autoComplete="current-password"
                    placeholder={sensitiveChange ? 'Required' : 'Only needed if changing username, email, or password'}
                  />
                </span>
              </label>

              <div className="epm-grid epm-grid--two">
                <label className="epm-field">
                  <span className="epm-label">
                    New password <span className="epm-optional">(optional)</span>
                  </span>
                  <span className="epm-input-wrap">
                    <FiLock className="epm-input-icon" aria-hidden="true" />
                    <input
                      type={showPasswords ? 'text' : 'password'}
                      className="epm-input"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      disabled={saving}
                      autoComplete="new-password"
                      placeholder="Leave blank to keep current"
                      maxLength={PASSWORD_MAX_LENGTH}
                    />
                  </span>
                </label>
                <label className="epm-field">
                  <span className="epm-label">Confirm new password</span>
                  <span className="epm-input-wrap">
                    <FiLock className="epm-input-icon" aria-hidden="true" />
                    <input
                      type={showPasswords ? 'text' : 'password'}
                      className="epm-input"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      disabled={saving}
                      autoComplete="new-password"
                      maxLength={PASSWORD_MAX_LENGTH}
                    />
                  </span>
                </label>
              </div>

              {/* ---- Live password-policy checklist ---- */}
              {wantsNewPw && (
                <div className="epm-pw-rules" role="status" aria-live="polite">
                  <div className="epm-pw-rules-title">Password must contain:</div>
                  <ul className="epm-pw-rules-list">
                    {PASSWORD_RULES.map((rule) => {
                      const passed = rule.test(newPassword);
                      return (
                        <li
                          key={rule.key}
                          className={`epm-pw-rule ${passed ? 'is-valid' : 'is-invalid'}`}
                        >
                          <span className="epm-pw-rule-icon" aria-hidden="true">
                            {passed ? <FiCheckCircle /> : <FiAlertCircle />}
                          </span>
                          <span>{rule.label}</span>
                        </li>
                      );
                    })}
                    <li
                      className={`epm-pw-rule ${confirmPassword && newPassword === confirmPassword ? 'is-valid' : 'is-invalid'}`}
                    >
                      <span className="epm-pw-rule-icon" aria-hidden="true">
                        {confirmPassword && newPassword === confirmPassword
                          ? <FiCheckCircle />
                          : <FiAlertCircle />}
                      </span>
                      <span>Passwords match</span>
                    </li>
                  </ul>
                </div>
              )}

              <label className="epm-show-pw">
                <input
                  type="checkbox"
                  checked={showPasswords}
                  onChange={(e) => setShowPasswords(e.target.checked)}
                  disabled={saving}
                />
                <span>Show passwords</span>
              </label>
            </div>
          </section>

          {error && (
            <div className="epm-error" role="alert">
              <FiAlertCircle aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}

          <footer className="epm-actions">
            <button
              type="button"
              className="epm-btn epm-btn--cancel"
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="epm-btn epm-btn--primary"
              disabled={saving || !anyChange}
            >
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );

  if (typeof document === 'undefined') return modal;
  return createPortal(modal, document.body);
};

export default EditProfileModal;

/* ============================================================
   Styles — scoped, keyframes namespaced (epm*) to avoid clashes
   ============================================================ */
const _epmCss = `
@keyframes epmFadeIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes epmSlideUp {
  from { opacity: 0; transform: translateY(14px) scale(0.97); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}

.epm-backdrop {
  position: fixed;
  inset: 0;
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: clamp(12px, 4vw, 24px);
  background: rgba(10, 15, 20, 0.62);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  animation: epmFadeIn 0.18s ease-out;
}

.epm-modal {
  position: relative;
  width: 100%;
  max-width: min(560px, 100%);
  max-height: calc(100dvh - 32px);
  overflow-y: auto;
  background: #ffffff;
  border-radius: clamp(14px, 2vw, 18px);
  box-shadow:
    0 24px 60px rgba(0, 0, 0, 0.28),
    0 4px 14px rgba(0, 0, 0, 0.12),
    0 0 0 1px rgba(0, 0, 0, 0.04);
  animation: epmSlideUp 0.22s cubic-bezier(0.2, 0.9, 0.3, 1);
  display: flex;
  flex-direction: column;
}

.epm-header {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: clamp(18px, 3vw, 22px) clamp(18px, 3vw, 24px);
  border-bottom: 1px solid #e5e5e0;
  background: #fafaf8;
  border-top-left-radius: inherit;
  border-top-right-radius: inherit;
  position: sticky;
  top: 0;
  z-index: 2;
}
.epm-header-text { flex: 1; min-width: 0; }
.epm-title {
  margin: 0 0 4px;
  font-size: clamp(17px, 2.4vw, 19px);
  font-weight: 700;
  color: #1a1f26;
  letter-spacing: -0.01em;
  line-height: 1.25;
}
.epm-subtitle {
  margin: 0;
  font-size: clamp(12.5px, 1.5vw, 13.5px);
  color: #64748b;
  line-height: 1.5;
}
.epm-close {
  background: none;
  border: none;
  color: #7a8699;
  font-size: 20px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 8px;
  line-height: 1;
  transition: color 0.15s ease, background 0.15s ease;
  flex-shrink: 0;
}
.epm-close:hover:not(:disabled) { color: #ef4444; background: rgba(239, 68, 68, 0.08); }
.epm-close:disabled { opacity: 0.4; cursor: not-allowed; }
.epm-close svg { width: 20px; height: 20px; }

.epm-form {
  display: flex;
  flex-direction: column;
  gap: clamp(14px, 2.4vw, 20px);
  padding: clamp(16px, 3vw, 22px) clamp(18px, 3vw, 24px) clamp(18px, 3vw, 22px);
}

.epm-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.epm-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}
.epm-section-title {
  margin: 0;
  font-size: 11.5px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #7a8699;
}

.epm-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 9px;
  border-radius: 999px;
  font-size: 10.5px;
  font-weight: 800;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  line-height: 1.4;
}
.epm-badge--warn {
  background: #fef3c7;
  color: #92400e;
  border: 1px solid #fcd34d;
}
.epm-badge svg { width: 11px; height: 11px; }

.epm-grid {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.epm-field {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
  width: 100%;
}

.epm-label {
  font-size: 12px;
  font-weight: 600;
  color: #475569;
  letter-spacing: 0.01em;
}
.epm-req  { color: #dc2626; font-weight: 700; }
.epm-optional {
  font-weight: 500;
  color: #94a3b8;
  font-size: 11px;
}

.epm-input-wrap {
  position: relative;
  display: block;
}
.epm-input-icon {
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  color: #94a3b8;
  font-size: 15px;
  pointer-events: none;
  transition: color 0.15s ease;
}

.epm-input {
  width: 100%;
  padding: 11px 12px 11px 38px;
  background: #ffffff;
  border: 1px solid #cbd5e1;
  border-radius: 10px;
  font-family: inherit;
  font-size: 14.5px;
  color: #0f172a;
  outline: none;
  box-sizing: border-box;
  transition: border-color 0.15s ease, box-shadow 0.15s ease, background 0.15s ease;
  min-height: 44px;
}
.epm-input::placeholder {
  color: #94a3b8;
  font-size: 13px;
}
.epm-input:hover:not(:disabled) {
  border-color: #94a3b8;
}
.epm-input:focus {
  border-color: #00b8b0;
  box-shadow: 0 0 0 3px rgba(0, 184, 176, 0.15);
  background: #f0fdfa;
}
.epm-input:focus ~ .epm-input-icon,
.epm-input-wrap:focus-within .epm-input-icon {
  color: #00b8b0;
}
.epm-input:disabled {
  background: #f1f5f9;
  color: #94a3b8;
  cursor: not-allowed;
}

/* ============================================================
   Password policy checklist
   ------------------------------------------------------------
   Two states:
     .is-valid    → green — the rule has been satisfied
     .is-invalid  → yellow — the rule has NOT yet been satisfied
   The icon uses a bright yellow so it reads as a clear "warning
   still pending" signal; the text uses a darker amber so it stays
   readable against the pale-yellow card background.
   ============================================================ */
.epm-pw-rules {
  background: #fef9c3;
  border: 1px solid #fde68a;
  border-radius: 10px;
  padding: 10px 12px;
  margin-top: 2px;
}
.epm-pw-rules-title {
  font-size: 11px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #854d0e;
  margin-bottom: 6px;
}
.epm-pw-rules-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.epm-pw-rule {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.35;
  transition: color 0.18s ease;
}
.epm-pw-rule-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  transition: color 0.18s ease;
}
.epm-pw-rule-icon svg { width: 100%; height: 100%; stroke-width: 2.4; }

/* ---- Passed ---- */
.epm-pw-rule.is-valid { color: #16a34a; }
.epm-pw-rule.is-valid .epm-pw-rule-icon { color: #16a34a; }

/* ---- Not yet met (yellow / warning) ---- */
.epm-pw-rule.is-invalid { color: #92400e; }
.epm-pw-rule.is-invalid .epm-pw-rule-icon { color: #eab308; }

.epm-show-pw {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: #475569;
  cursor: pointer;
  user-select: none;
  padding: 4px 0;
  align-self: flex-start;
}
.epm-show-pw input {
  width: 16px;
  height: 16px;
  accent-color: #00b8b0;
  cursor: pointer;
}

.epm-error {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 11px 14px;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 10px;
  color: #991b1b;
  font-size: 13px;
  line-height: 1.5;
  word-break: break-word;
  animation: epmFadeIn 0.2s ease;
}
.epm-error svg {
  flex-shrink: 0;
  width: 15px;
  height: 15px;
  margin-top: 2px;
}

.epm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding-top: clamp(10px, 2vw, 14px);
  border-top: 1px solid #e5e5e0;
  margin-top: 2px;
  flex-wrap: wrap;
}

.epm-btn {
  min-height: 44px;
  padding: 11px 20px;
  border-radius: 10px;
  font-family: inherit;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.01em;
  cursor: pointer;
  border: 1px solid transparent;
  border-bottom-width: 2px;
  transition: transform 140ms ease, background 140ms ease, border-color 140ms ease;
  min-width: 120px;
}
.epm-btn:disabled { opacity: 0.55; cursor: not-allowed; transform: none !important; }
.epm-btn:focus-visible {
  outline: none;
  box-shadow: 0 0 0 4px rgba(0, 184, 176, 0.25);
}

.epm-btn--cancel {
  background: #ffffff;
  color: #1e293b;
  border-color: #cbd5e1;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.08);
}
.epm-btn--cancel:hover:not(:disabled) {
  transform: translateY(-1px);
  background: #f8fafc;
  border-color: #94a3b8;
}

.epm-btn--primary {
  background: #00b8b0;
  color: #ffffff;
  border-color: #007a72;
  box-shadow:
    0 1px 0 rgba(255, 255, 255, 0.3) inset,
    0 2px 6px rgba(0, 122, 114, 0.28),
    0 6px 16px rgba(0, 184, 176, 0.28);
}
.epm-btn--primary:hover:not(:disabled) {
  transform: translateY(-1px);
  background: #00d4cb;
  border-color: #008a82;
}
.epm-btn--primary:active:not(:disabled) {
  transform: translateY(0);
  background: #00a29b;
}

/* ---- Two-column layouts at wider widths ---- */
@media (min-width: 641px) {
  .epm-grid--two {
    flex-direction: row;
    gap: 12px;
  }
  .epm-grid--two > .epm-field { flex: 1 1 0; }
}

/* ---- Small phones: stack everything, sticky footer ---- */
@media (max-width: 480px) {
  .epm-modal { border-radius: 12px; }
  .epm-header { padding: 14px 16px; }
  .epm-form   { padding: 14px 16px 18px; }
  .epm-title  { font-size: 16px; }
  .epm-subtitle { font-size: 12px; }
  .epm-input { font-size: 16px; }
  .epm-actions {
    flex-direction: column-reverse;
    gap: 8px;
  }
  .epm-btn { width: 100%; }
}

/* ---- Short landscape ---- */
@media (max-height: 520px) and (orientation: landscape) {
  .epm-modal { max-height: calc(100dvh - 16px); }
  .epm-header { padding: 12px 16px; }
  .epm-form { padding: 12px 16px; gap: 12px; }
  .epm-section { gap: 8px; }
  .epm-input { padding: 8px 10px 8px 34px; min-height: 38px; }
  .epm-btn   { min-height: 38px; padding: 9px 16px; font-size: 13px; }
}

/* ---- Tablets (641–1024) get a wider card ---- */
@media (min-width: 641px) and (max-width: 1024px) {
  .epm-modal { max-width: min(620px, 92vw); }
}

/* ---- Ultra-wide / 4K ---- */
@media (min-width: 1921px) {
  .epm-modal { max-width: 660px; border-radius: 22px; }
  .epm-title { font-size: 22px; }
  .epm-subtitle { font-size: 15px; }
  .epm-label { font-size: 14px; }
  .epm-input { font-size: 16px; min-height: 52px; padding: 13px 14px 13px 42px; }
  .epm-btn { font-size: 16px; min-height: 52px; padding: 14px 24px; }
  .epm-pw-rule { font-size: 14px; }
  .epm-pw-rule-icon { width: 16px; height: 16px; }
}

/* ---- Accessibility ---- */
@media (prefers-reduced-motion: reduce) {
  .epm-backdrop, .epm-modal, .epm-error { animation: none !important; }
  .epm-btn { transition: none !important; }
  .epm-btn:hover:not(:disabled) { transform: none !important; }
  .epm-pw-rule, .epm-pw-rule-icon { transition: none !important; }
}
`;

if (typeof document !== 'undefined' && !document.getElementById('epm-styles')) {
  const el = document.createElement('style');
  el.id = 'epm-styles';
  el.textContent = _epmCss;
  document.head.appendChild(el);
}