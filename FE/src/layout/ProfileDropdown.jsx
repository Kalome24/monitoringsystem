// src/layout/ProfileDropdown.jsx
import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FiCamera,
  FiUser,
  FiSettings,
  FiLogOut,
  FiTrash2,
  FiX,
  FiChevronDown,
  FiHome,
  FiMapPin,
} from 'react-icons/fi';
import { useAuth } from '../auth/AuthContext';
import { useAssignment } from '../permissions/useAssignment';
import { userApi } from '../services/api';
import ConfirmModal from '../components/shared/ConfirmModal';
import EditProfileModal from '../components/shared/EditProfileModal';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

const ProfileDropdown = () => {
  const navigate = useNavigate();
  const { user, logout, updateUser, forceLocalLogout } = useAuth();
  const {
    warehouse,
    isWarehouseBound,
    warehouseLabel,
  } = useAssignment();

  const [isOpen, setIsOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const ref = useRef(null);

  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  const [showProfileModal, setShowProfileModal] = useState(false);

  const [showPhotoModal, setShowPhotoModal] = useState(false);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [photoError, setPhotoError] = useState('');
  const [photoSaving, setPhotoSaving] = useState(false);
  const fileInputRef = useRef(null);

  const [showRemovePhotoConfirm, setShowRemovePhotoConfirm] = useState(false);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleLogoutClick = () => {
    setIsOpen(false);
    setShowLogoutConfirm(true);
  };

  const handleLogoutCancel = () => {
    if (loggingOut) return;
    setShowLogoutConfirm(false);
  };

  const handleLogoutConfirm = async () => {
    setLoggingOut(true);
    try {
      await logout();
      navigate('/login');
    } finally {
      setLoggingOut(false);
      setShowLogoutConfirm(false);
    }
  };

  /* ------------ Edit Profile ------------ */
  const openProfileModal = () => {
    setIsOpen(false);
    setShowProfileModal(true);
  };

  const closeProfileModal = () => setShowProfileModal(false);

  /**
   * Called after a successful self-edit. The server has ALREADY killed
   * the session. We write the banner message to sessionStorage (via
   * forceLocalLogout), clear local auth, and let ProtectedRoute redirect.
   */
  const handleProfileSuccess = (message) => {
    setShowProfileModal(false);
    forceLocalLogout(message);
  };

  /* ------------ Photo modal ------------ */
  const openPhotoModal = () => {
    setIsOpen(false);
    setPhotoPreview(null);
    setPhotoError('');
    setShowPhotoModal(true);
  };

  const resetPhotoModalState = () => {
    setShowPhotoModal(false);
    setPhotoPreview(null);
    setPhotoError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const closePhotoModal = () => {
    if (photoSaving) return;
    resetPhotoModalState();
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    setPhotoError('');
    if (!file) return;

    if (!ACCEPTED_TYPES.includes(file.type)) {
      setPhotoError('Please select a valid image file (JPG, PNG, WEBP, or GIF).');
      e.target.value = '';
      return;
    }

    if (file.size > MAX_IMAGE_BYTES) {
      const mb = (file.size / 1024 / 1024).toFixed(2);
      setPhotoError(`Image is too large (${mb} MB). Maximum allowed is 5 MB.`);
      e.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => setPhotoPreview(reader.result);
    reader.readAsDataURL(file);
  };

  const handleSavePhoto = async () => {
    if (!photoPreview) {
      setPhotoError('Please select an image first.');
      return;
    }
    setPhotoSaving(true);
    setPhotoError('');
    try {
      const res = await userApi.updateMyProfileImage(photoPreview);
      if (res.ok) {
        const updated =
          res.data?.data ||
          res.data?.user ||
          res.data;
        if (updated && updated.id) {
          updateUser(updated);
        }
        closePhotoModal();
      } else {
        setPhotoError(res.data?.message || 'Failed to update profile picture.');
      }
    } catch (err) {
      console.error('Save photo error:', err);
      setPhotoError('Network error. Please try again.');
    } finally {
      setPhotoSaving(false);
    }
  };

  const handleRemovePhotoClick = () => {
    setShowRemovePhotoConfirm(true);
  };

  const handleRemovePhotoCancel = () => {
    if (photoSaving) return;
    setShowRemovePhotoConfirm(false);
  };

  const handleRemovePhotoConfirm = async () => {
    setPhotoSaving(true);
    setPhotoError('');
    try {
      const res = await userApi.updateMyProfileImage(null);
      if (res.ok) {
        const updated =
          res.data?.data ||
          res.data?.user ||
          res.data;
        if (updated && updated.id) updateUser(updated);
        setShowRemovePhotoConfirm(false);
        resetPhotoModalState();
        return;
      }
      setPhotoError(res.data?.message || 'Failed to remove profile picture.');
      setShowRemovePhotoConfirm(false);
    } catch (err) {
      console.error('Remove photo error:', err);
      setPhotoError('Network error. Please try again.');
      setShowRemovePhotoConfirm(false);
    } finally {
      setPhotoSaving(false);
    }
  };

  const initial = user?.first_name?.[0] || 'U';
  const fullName = `${user?.first_name || 'User'} ${user?.last_name || ''}`.trim();

  const userPosition =
    user?.emp_position ||
    user?.employee_position ||
    user?.position ||
    user?.job_title ||
    null;

  const roleLabel = user?.user_role || user?.role || 'User';
  const displayLabel = userPosition || roleLabel;

  const roleClass = (() => {
    const candidates = [displayLabel, roleLabel].map(
      (s) => String(s).toLowerCase().replace(/\s+/g, '-'),
    );

    for (const r of candidates) {
      if (r.includes('super')) return 'role-pill--super-admin';
      if (r.includes('department-head') || r.includes('dept-head')) {
        return 'role-pill--dept-head';
      }
      if (r.includes('admin')) return 'role-pill--admin';
      if (r.includes('registrar')) return 'role-pill--registrar';
      if (r.includes('handler')) return 'role-pill--handler';
      if (r.includes('manager')) return 'role-pill--manager';
    }
    return 'role-pill--default';
  })();

  const avatarContent = user?.profile_image ? (
    <img src={user.profile_image} alt={fullName} className="avatar-img" />
  ) : (
    initial
  );

  const modalAvatarContent = photoPreview ? (
    <img src={photoPreview} alt="Preview" className="avatar-img" />
  ) : user?.profile_image ? (
    <img src={user.profile_image} alt={fullName} className="avatar-img" />
  ) : (
    initial
  );

  return (
    <>
      <style>{profileDropdownCss}</style>

      <div className="profile-dropdown-wrapper" ref={ref}>
        <div className="user-profile" onClick={() => setIsOpen((v) => !v)}>
          <div className="avatar">{avatarContent}</div>
          <div className="user-info">
            <span className="user-name">{fullName}</span>
            <span className="user-role">{displayLabel}</span>
          </div>
          <FiChevronDown
            className={`dropdown-arrow${isOpen ? ' open' : ''}`}
            aria-hidden="true"
          />
        </div>

        {isOpen && (
          <div className="profile-dropdown">
            <div className="dropdown-header">
              <div className="dropdown-avatar">{avatarContent}</div>
              <div className="dropdown-user-info">
                <span className="dropdown-user-name">{fullName}</span>
                <span className={`dropdown-user-role role-pill ${roleClass}`}>
                  {displayLabel}
                </span>
              </div>
            </div>

            {isWarehouseBound && (
              <>
                <div className="dropdown-divider"></div>
                <div className="dropdown-assignment">
                  <div className="dropdown-assignment-label">
                    <FiHome className="pd-inline-icon" aria-hidden="true" />
                    <span>Warehouse</span>
                  </div>

                  <div className="dropdown-assignment-value">
                    {warehouse ? warehouseLabel : 'Not assigned'}
                  </div>

                  {warehouse?.location && (
                    <div className="dropdown-assignment-sub">
                      <FiMapPin className="pd-inline-icon" aria-hidden="true" />
                      <span>{warehouse.location}</span>
                    </div>
                  )}
                </div>
              </>
            )}

            <div className="dropdown-divider"></div>

            <button className="dropdown-item" onClick={openProfileModal}>
              <FiUser className="dropdown-icon" aria-hidden="true" />
              <span>Edit Profile</span>
            </button>

            <button className="dropdown-item" onClick={openPhotoModal}>
              <FiCamera className="dropdown-icon" aria-hidden="true" />
              <span>Change Photo</span>
            </button>

            <button className="dropdown-item">
              <FiSettings className="dropdown-icon" aria-hidden="true" />
              <span>Settings</span>
            </button>

            <div className="dropdown-divider"></div>

            <button
              className="dropdown-item logout-dropdown-item"
              onClick={handleLogoutClick}
              disabled={loggingOut}
            >
              <FiLogOut className="dropdown-icon" aria-hidden="true" />
              <span>{loggingOut ? 'Logging out...' : 'Logout'}</span>
            </button>
          </div>
        )}
      </div>

      {showProfileModal && (
        <EditProfileModal
          isOpen={showProfileModal}
          user={user}
          onClose={closeProfileModal}
          onSuccess={handleProfileSuccess}
        />
      )}

      {showPhotoModal && (
        <div className="photo-modal-overlay" onClick={closePhotoModal}>
          <div className="photo-modal" onClick={(e) => e.stopPropagation()}>
            <div className="photo-modal-header">
              <h3>
                <FiCamera className="pd-heading-icon" aria-hidden="true" />
                <span>Change Profile Photo</span>
              </h3>
              <button
                className="photo-modal-close"
                onClick={closePhotoModal}
                disabled={photoSaving}
                aria-label="Close"
              >
                <FiX aria-hidden="true" />
              </button>
            </div>

            <div className="photo-modal-body">
              <div className="photo-preview-ring">
                <div className="photo-preview-inner">{modalAvatarContent}</div>
              </div>

              <p className="photo-hint">
                Pick a square image for best results.<br />
                <strong>Max size: 5 MB</strong> · Formats: JPG, PNG, WEBP, GIF
              </p>

              <div className="photo-file-row">
                <input
                  ref={fileInputRef}
                  id="profile-photo-input"
                  type="file"
                  accept="image/*"
                  onChange={handleFileChange}
                  className="photo-file-input"
                  disabled={photoSaving}
                />
              </div>

              {photoError && <div className="photo-error">{photoError}</div>}
            </div>

            <div className="photo-modal-footer">
              <div className="left-actions">
                {user?.profile_image && (
                  <button
                    className="remove-photo-btn"
                    onClick={handleRemovePhotoClick}
                    disabled={photoSaving}
                  >
                    <FiTrash2 className="pd-btn-icon" aria-hidden="true" />
                    <span>Remove</span>
                  </button>
                )}
              </div>
              <div className="right-actions">
                <button
                  className="cancel-btn"
                  onClick={closePhotoModal}
                  disabled={photoSaving}
                >
                  Cancel
                </button>
                <button
                  className="save-btn"
                  onClick={handleSavePhoto}
                  disabled={photoSaving || !photoPreview}
                >
                  {photoSaving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        isOpen={showLogoutConfirm}
        onConfirm={handleLogoutConfirm}
        onCancel={handleLogoutCancel}
        title="Log out?"
        message="Are you sure you want to log out of your account?"
        confirmLabel="Yes, Log out"
        cancelLabel="No, stay logged in"
        variant="danger"
        icon={<FiLogOut />}
        isLoading={loggingOut}
      />

      <ConfirmModal
        isOpen={showRemovePhotoConfirm}
        onConfirm={handleRemovePhotoConfirm}
        onCancel={handleRemovePhotoCancel}
        title="Remove profile picture?"
        message="Your current profile picture will be permanently removed. You can upload a new one at any time."
        confirmLabel="Yes, remove"
        cancelLabel="No, keep it"
        variant="danger"
        icon={<FiTrash2 />}
        isLoading={photoSaving}
      />
    </>
  );
};

export default ProfileDropdown;

/* ============================================================
   ProfileDropdown.css — scoped component styles
   ============================================================ */
const profileDropdownCss = `
/* ---------- Keyframes (namespaced) ---------- */
@keyframes pdSlideDown {
  from { opacity: 0; transform: translateY(-10px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes pdFadeIn {
  from { opacity: 0; }
  to   { opacity: 1; }
}

/* ============================================
   WRAPPER + TRIGGER BUTTON
   ============================================ */
.profile-dropdown-wrapper { position: relative; }

.user-profile {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 5px 14px 5px 5px;
  border-radius: 999px;
  cursor: pointer;
  background: #00d2c8;
  border: 1px solid rgba(255, 255, 255, 0.18);
  box-shadow:
    0 2px 8px rgba(0, 210, 200, 0.28),
    inset 0 1px 0 rgba(255, 255, 255, 0.25);
  transition:
    background 0.2s ease,
    box-shadow 0.25s ease,
    transform 0.15s ease;
}

.user-profile:hover {
  background: #00b8b0;
  box-shadow:
    0 4px 16px rgba(0, 210, 200, 0.45),
    inset 0 1px 0 rgba(255, 255, 255, 0.3);
  transform: translateY(-1px);
}

.user-profile:active { transform: translateY(0) scale(0.98); }

/* ============================================
   AVATARS
   ============================================ */
.avatar,
.dropdown-avatar {
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  flex-shrink: 0;
  overflow: hidden;
  position: relative;
}

.user-profile .avatar {
  width: 42px;
  height: 42px;
  font-size: 16px;
  background: #ffffff;
  color: #008a82;
  border: 2px solid #ffffff;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.15);
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.user-profile:hover .avatar {
  transform: scale(1.04);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}

.avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center;
  border-radius: 50%;
  display: block;
}

/* ============================================
   TRIGGER TEXT
   ============================================ */
.user-info {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  line-height: 1.2;
  min-width: 0;
}

.user-name {
  font-size: 14px;
  font-weight: 700;
  color: #ffffff;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 180px;
}

.user-role {
  font-size: 11.5px;
  font-weight: 600;
  letter-spacing: 0.03em;
  color: rgba(255, 255, 255, 0.9);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 180px;
}

.dropdown-arrow {
  font-size: 11px;
  color: #ffffff;
  margin-left: 2px;
  transition: transform 0.3s ease;
}
.dropdown-arrow.open { transform: rotate(180deg); }

/* ============================================
   DROPDOWN PANEL
   ============================================ */
.profile-dropdown {
  position: absolute;
  top: calc(100% + 10px);
  right: 0;
  min-width: 260px;
  background: #ffffff;
  border-radius: 12px;
  border: 1px solid #e5e5e0;
  box-shadow:
    0 12px 36px rgba(15, 23, 42, 0.14),
    0 4px 12px rgba(15, 23, 42, 0.06);
  overflow: hidden;
  z-index: 1000;
  transform-origin: top right;
  animation: pdSlideDown 0.2s ease;
}

.profile-dropdown::before {
  content: '';
  position: absolute;
  top: -6px;
  right: 26px;
  width: 12px;
  height: 12px;
  background: #ffffff;
  border-left: 1px solid #e5e5e0;
  border-top: 1px solid #e5e5e0;
  transform: rotate(45deg);
  border-top-left-radius: 2px;
  pointer-events: none;
  z-index: 1;
}

/* ============================================
   DROPDOWN HEADER
   ============================================ */
.dropdown-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  background: #fafaf8;
}

.dropdown-avatar {
  width: 44px;
  height: 44px;
  font-size: 16px;
  background: linear-gradient(145deg, #00d2c8, #008a82);
  color: #ffffff;
  border: 2px solid #ffffff;
  box-shadow: 0 1px 4px rgba(0, 138, 130, 0.25);
}

.dropdown-user-info {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  min-width: 0;
  flex: 1;
}

.dropdown-user-name {
  display: block;
  font-size: 15px;
  font-weight: 700;
  color: #0f172a;
  line-height: 1.25;
  letter-spacing: -0.005em;
  word-break: break-word;
  overflow-wrap: anywhere;
  max-width: 100%;
}

.dropdown-user-role.role-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 10.5px;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  line-height: 1.4;
  white-space: nowrap;
  border: 1px solid transparent;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dropdown-user-role.role-pill::before {
  content: '';
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: currentColor;
  flex-shrink: 0;
  opacity: 0.85;
}

.role-pill--super-admin {
  background: linear-gradient(135deg, #ede9fe 0%, #ddd6fe 100%);
  color: #5b21b6;
  border-color: #c4b5fd;
}
.role-pill--dept-head {
  background: linear-gradient(135deg, #fce7f3 0%, #fbcfe8 100%);
  color: #9d174d;
  border-color: #f9a8d4;
}
.role-pill--admin {
  background: linear-gradient(135deg, #ecfeff 0%, #cffafe 100%);
  color: #0e7490;
  border-color: #67e8f9;
}
.role-pill--manager {
  background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%);
  color: #92400e;
  border-color: #fcd34d;
}
.role-pill--registrar {
  background: linear-gradient(135deg, #eef2ff 0%, #e0e7ff 100%);
  color: #3730a3;
  border-color: #c7d2fe;
}
.role-pill--handler {
  background: linear-gradient(135deg, #ffedd5 0%, #fed7aa 100%);
  color: #9a3412;
  border-color: #fdba74;
}
.role-pill--default {
  background: #f1f5f9;
  color: #475569;
  border-color: #cbd5e1;
}

/* ============================================
   WAREHOUSE ASSIGNMENT BLOCK
   ============================================ */
.dropdown-divider {
  height: 1px;
  background: #e5e5e0;
  margin: 0;
}

.dropdown-assignment {
  padding: 12px 16px 14px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.dropdown-assignment-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #7a8699;
  line-height: 1.2;
  margin-bottom: 2px;
}

.dropdown-assignment-value {
  font-size: 14px;
  font-weight: 700;
  color: #0f172a;
  line-height: 1.4;
  word-break: break-word;
  overflow-wrap: anywhere;
  margin: 0;
}

.dropdown-assignment-sub {
  display: inline-flex;
  align-items: flex-start;
  gap: 6px;
  font-size: 12px;
  font-weight: 500;
  color: #64748b;
  line-height: 1.45;
  margin-top: 4px;
  min-width: 0;
}
.dropdown-assignment-sub span {
  min-width: 0;
  overflow-wrap: anywhere;
}

/* ============================================
   DROPDOWN MENU ITEMS
   ============================================ */
.dropdown-item {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 10px 16px;
  background: none;
  border: none;
  color: #1a1f26;
  font-size: 14px;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  transition: background 0.2s;
}

.dropdown-item:hover { background: #f5f5f0; }

.dropdown-icon {
  font-size: 16px;
  flex-shrink: 0;
}

.logout-dropdown-item { color: #ef4444; }
.logout-dropdown-item:hover { background: rgba(239, 68, 68, 0.08); }

/* ============================================
   INLINE ICONS
   ============================================ */
.pd-inline-icon {
  width: 1em;
  height: 1em;
  flex-shrink: 0;
  margin-top: 0.15em;
  stroke-width: 2.4;
}
.dropdown-assignment-label .pd-inline-icon {
  color: #00b8b0;
  margin-top: 0;
}
.dropdown-assignment-sub .pd-inline-icon {
  color: #94a3b8;
}

.pd-heading-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.1em;
  height: 1.1em;
  margin-right: 8px;
  vertical-align: -0.15em;
  color: #00b8b0;
  stroke-width: 2.4;
}

.pd-btn-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1em;
  height: 1em;
  margin-right: 6px;
  vertical-align: -0.1em;
  flex-shrink: 0;
}
.pd-btn-icon svg { width: 100%; height: 100%; stroke-width: 2.4; }

/* ============================================
   CHANGE PHOTO MODAL
   ============================================ */
.photo-modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1100;
  padding: 16px;
  animation: pdFadeIn 0.2s ease;
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
}

.photo-modal {
  background: #ffffff;
  border-radius: 16px;
  width: 100%;
  max-width: 420px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.25);
  overflow: hidden;
  animation: pdSlideDown 0.25s ease;
  display: flex;
  flex-direction: column;
}

.photo-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid #e5e5e0;
  background: #fafaf8;
}

.photo-modal-header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: #1a1f26;
}

.photo-modal-close {
  background: none;
  border: none;
  font-size: 20px;
  color: #7a8699;
  cursor: pointer;
  padding: 2px 8px;
  border-radius: 6px;
  transition: color 0.2s ease, background 0.2s ease;
  line-height: 1;
}
.photo-modal-close:hover:not(:disabled) {
  color: #ef4444;
  background: rgba(239, 68, 68, 0.08);
}
.photo-modal-close:disabled { opacity: 0.4; cursor: not-allowed; }

.photo-modal-body {
  padding: 24px 20px 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
}

.photo-preview-ring {
  width: 160px;
  height: 160px;
  border-radius: 50%;
  padding: 4px;
  background: linear-gradient(145deg, #00d2c8, #008a82);
  box-shadow: 0 8px 24px rgba(0, 210, 200, 0.28);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.photo-preview-inner {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  background: linear-gradient(145deg, #00d2c8, #008a82);
  color: #ffffff;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  font-size: 48px;
  font-weight: 700;
}

.photo-preview-inner img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  border-radius: 50%;
}

.photo-hint {
  font-size: 12px;
  color: #7a8699;
  text-align: center;
  line-height: 1.5;
  max-width: 320px;
  margin: 0;
}
.photo-hint strong { color: #1a1f26; font-weight: 600; }

.photo-file-row {
  display: flex;
  gap: 8px;
  width: 100%;
  align-items: center;
}

.photo-file-input {
  flex: 1;
  padding: 10px 12px;
  border: 1px dashed #d5d8dd;
  border-radius: 8px;
  font-size: 13px;
  background: #fafaf8;
  color: #1a1f26;
  font-family: inherit;
  cursor: pointer;
  width: 100%;
  transition: border-color 0.2s ease, background 0.2s ease;
}
.photo-file-input:hover:not(:disabled) {
  border-color: #00d2c8;
  background: #f0fdfc;
}
.photo-file-input:focus {
  outline: none;
  border-color: #00d2c8;
  box-shadow: 0 0 0 3px rgba(0, 210, 200, 0.15);
}
.photo-file-input:disabled { opacity: 0.5; cursor: not-allowed; }

.photo-file-input::file-selector-button {
  padding: 6px 14px;
  margin-right: 12px;
  background: linear-gradient(135deg, #00e0d4 0%, #00b8b0 45%, #008a82 100%);
  color: #ffffff;
  border: none;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  transition: filter 0.2s ease;
}
.photo-file-input::file-selector-button:hover { filter: brightness(1.06); }

.photo-error {
  width: 100%;
  padding: 8px 12px;
  background: rgba(239, 68, 68, 0.08);
  border: 1px solid rgba(239, 68, 68, 0.2);
  border-radius: 8px;
  color: #dc2626;
  font-size: 12px;
  text-align: center;
  line-height: 1.4;
}

.photo-modal-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 20px;
  background: #fafaf8;
  border-top: 1px solid #e5e5e0;
  gap: 8px;
  flex-wrap: wrap;
}
.photo-modal-footer .left-actions { display: flex; gap: 8px; }
.photo-modal-footer .right-actions { display: flex; gap: 8px; margin-left: auto; }

.remove-photo-btn {
  padding: 8px 14px;
  background: #ffffff;
  color: #dc2626;
  border: 1px solid rgba(220, 38, 38, 0.3);
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.2s ease;
}
.remove-photo-btn:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.08);
  border-color: #dc2626;
  transform: translateY(-1px);
}
.remove-photo-btn:disabled { opacity: 0.5; cursor: not-allowed; }

/* ============================================
   RESPONSIVE
   ============================================ */
@media (max-width: 1200px) {
  .user-profile { gap: 10px; padding: 4px 12px 4px 4px; }
  .user-profile .avatar { width: 38px; height: 38px; font-size: 15px; }
}

@media (max-width: 768px) {
  .user-profile { padding: 3px; gap: 0; border-radius: 50%; }
  .user-info,
  .dropdown-arrow { display: none; }
  .user-profile .avatar { width: 42px; height: 42px; font-size: 16px; }
}

@media (max-width: 480px) {
  .user-profile .avatar { width: 38px; height: 38px; font-size: 15px; }

  .profile-dropdown {
    right: -8px;
    min-width: 260px;
    max-width: calc(100vw - 24px);
    max-height: calc(100vh - 100px);
    max-height: calc(100dvh - 100px);
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
  }
  .profile-dropdown::before { right: 22px; }

  .dropdown-item { font-size: 13.5px; padding: 10px 14px; }

  .photo-modal { max-width: 100%; border-radius: 14px; }
  .photo-preview-ring { width: 130px; height: 130px; }
  .photo-preview-inner { font-size: 40px; }
  .photo-modal-footer { flex-direction: column; align-items: stretch; }
  .photo-modal-footer .left-actions,
  .photo-modal-footer .right-actions { width: 100%; margin-left: 0; }
  .photo-modal-footer .left-actions button,
  .photo-modal-footer .right-actions button { flex: 1; }
}

@media (max-width: 360px) {
  .profile-dropdown {
    right: -4px;
    min-width: 240px;
  }
  .profile-dropdown::before { right: 18px; }
}

@media (max-height: 500px) and (orientation: landscape) {
  .profile-dropdown {
    max-height: calc(100vh - 80px);
    max-height: calc(100dvh - 80px);
    overflow-y: auto;
  }
}

/* ============================================
   ACCESSIBILITY
   ============================================ */
@media (prefers-reduced-motion: reduce) {
  .user-profile,
  .user-profile .avatar,
  .dropdown-arrow,
  .photo-modal-close,
  .photo-file-input,
  .remove-photo-btn {
    transition: none !important;
  }
  .user-profile:hover { transform: none; }
  .user-profile:hover .avatar { transform: none; }
  .profile-dropdown,
  .photo-modal,
  .photo-modal-overlay { animation: none !important; }
}
`;