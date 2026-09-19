// src/layout/ProfileDropdown.jsx
import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useAssignment } from '../permissions/useAssignment';
import { userApi } from '../services/api';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

const ProfileDropdown = () => {
  const navigate = useNavigate();
  const { user, logout, updateUser } = useAuth();
  const {
    warehouse,
    subWarehouse,
    isWarehouseBound,
    warehouseLabel,
    subWarehouseLabel,
  } = useAssignment();

  const [isOpen, setIsOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const ref = useRef(null);

  // ---------- Photo modal state ----------
  const [showPhotoModal, setShowPhotoModal] = useState(false);
  const [photoPreview, setPhotoPreview] = useState(null);   // base64 data URL
  const [photoError, setPhotoError] = useState('');
  const [photoSaving, setPhotoSaving] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleLogout = async () => {
    if (!window.confirm('Are you sure you want to logout?')) return;
    setLoggingOut(true);
    try {
      await logout();
      navigate('/login');
    } finally {
      setLoggingOut(false);
    }
  };

  // ---------- Photo modal handlers ----------
  const openPhotoModal = () => {
    setIsOpen(false);
    setPhotoPreview(null);
    setPhotoError('');
    setShowPhotoModal(true);
  };

  const closePhotoModal = () => {
    if (photoSaving) return;
    setShowPhotoModal(false);
    setPhotoPreview(null);
    setPhotoError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
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
        // Server returns { success, message, data: user }
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

  const handleRemovePhoto = async () => {
    if (!window.confirm('Remove your profile picture?')) return;
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
        closePhotoModal();
      } else {
        setPhotoError(res.data?.message || 'Failed to remove profile picture.');
      }
    } catch (err) {
      console.error('Remove photo error:', err);
      setPhotoError('Network error. Please try again.');
    } finally {
      setPhotoSaving(false);
    }
  };

  // ---------- Rendering helpers ----------
  const initial = user?.first_name?.[0] || 'U';
  const fullName = `${user?.first_name || 'User'} ${user?.last_name || ''}`.trim();
  const roleLabel = user?.user_role || user?.role || 'User';

  const avatarContent = user?.profile_image ? (
    <img src={user.profile_image} alt={fullName} className="avatar-img" />
  ) : (
    initial
  );

  // What the modal preview shows:
  //   1. Selected-but-not-saved file (photoPreview)
  //   2. Otherwise the saved picture
  //   3. Otherwise the initial
  const modalAvatarContent = photoPreview ? (
    <img src={photoPreview} alt="Preview" className="avatar-img" />
  ) : user?.profile_image ? (
    <img src={user.profile_image} alt={fullName} className="avatar-img" />
  ) : (
    initial
  );

  return (
    <>
      <div className="profile-dropdown-wrapper" ref={ref}>
        <div className="user-profile" onClick={() => setIsOpen((v) => !v)}>
          <div className="avatar">{avatarContent}</div>
          <div className="user-info">
            <span className="user-name">{fullName}</span>
            <span className="user-role">{roleLabel}</span>
          </div>
          <span className={`dropdown-arrow ${isOpen ? 'open' : ''}`}>▼</span>
        </div>

        {isOpen && (
          <div className="profile-dropdown">
            <div className="dropdown-header">
              <div className="dropdown-avatar">{avatarContent}</div>
              <div className="dropdown-user-info">
                <span className="dropdown-user-name">{fullName}</span>
                <span className="dropdown-user-role">{roleLabel}</span>
              </div>
            </div>

            {isWarehouseBound && (
              <>
                <div className="dropdown-divider"></div>
                <div className="dropdown-assignment">
                  <div className="dropdown-assignment-row">
                    <span className="dropdown-assignment-label">🏭 Warehouse</span>
                    <span className="dropdown-assignment-value">
                      {warehouse ? warehouseLabel : 'Not assigned'}
                    </span>
                  </div>
                  {warehouse?.location && (
                    <div className="dropdown-assignment-sub">📍 {warehouse.location}</div>
                  )}

                  <div className="dropdown-assignment-row">
                    <span className="dropdown-assignment-label">🏢 Sub-warehouse</span>
                    <span className="dropdown-assignment-value">
                      {subWarehouse ? subWarehouseLabel : 'Not assigned'}
                    </span>
                  </div>
                  {subWarehouse?.location && (
                    <div className="dropdown-assignment-sub">📍 {subWarehouse.location}</div>
                  )}
                </div>
              </>
            )}

            <div className="dropdown-divider"></div>

            <button className="dropdown-item" onClick={openPhotoModal}>
              <span className="dropdown-icon">📷</span> Change Photo
            </button>

            <button className="dropdown-item">
              <span className="dropdown-icon">👤</span> My Profile
            </button>

            <button className="dropdown-item">
              <span className="dropdown-icon">⚙️</span> Settings
            </button>

            <div className="dropdown-divider"></div>

            <button
              className="dropdown-item logout-dropdown-item"
              onClick={handleLogout}
              disabled={loggingOut}
            >
              <span className="dropdown-icon">🚪</span>
              {loggingOut ? 'Logging out...' : 'Logout'}
            </button>
          </div>
        )}
      </div>

      {/* ============================================
          CHANGE PHOTO MODAL
          ============================================ */}
      {showPhotoModal && (
        <div className="photo-modal-overlay" onClick={closePhotoModal}>
          <div className="photo-modal" onClick={(e) => e.stopPropagation()}>
            <div className="photo-modal-header">
              <h3>📷 Change Profile Photo</h3>
              <button
                className="photo-modal-close"
                onClick={closePhotoModal}
                disabled={photoSaving}
                aria-label="Close"
              >
                ✕
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
                    onClick={handleRemovePhoto}
                    disabled={photoSaving}
                  >
                    🗑️ Remove
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
    </>
  );
};

export default ProfileDropdown;