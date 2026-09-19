// src/components/admin/TabUsers.jsx
import React, { useEffect, useState } from 'react';
import { userApi, warehouseApi } from '../../services/api';
import { usePermissions } from '../../permissions/usePermissions';

const isGlobalRole = (role) => ['Super Admin', 'Admin'].includes(role);
const requiresWarehouse = (role) => ['Stock Registrar', 'Stock Handler'].includes(role);
const isSuperAdmin = (role) => role === 'Super Admin';
const isAdmin = (role) => role === 'Admin';
const isAdminDropdownRole = (role) => role === 'Admin';

const ADMIN_POSITIONS = ['Department Head', 'Inventory Controller Manager'];

/**
 * Return the position the backend will enforce for a given role.
 * Mirrors getEffectivePosition() in userController.js
 */
const getAutoPosition = (role) => {
  if (role === 'Super Admin') return 'Programmer';
  if (role === 'Admin') return 'Inventory Controller Manager'; // default when Admin is picked
  if (role === 'Stock Registrar' || role === 'Stock Handler') return 'Inventory Controllers';
  return '';
};

/**
 * Local mirror of computeCanApproveSts() — for live preview only.
 * The backend remains the single source of truth.
 */
const computeCanApproveSts = (role, position) =>
  role === 'Admin' && position === 'Department Head';

const validatePassword = (password) => {
  const errors = [];
  if (password.length < 6) errors.push('Password must be at least 6 characters');
  if (!/[A-Z]/.test(password)) errors.push('Password must contain at least 1 uppercase letter');
  if (!/[a-z]/.test(password)) errors.push('Password must contain at least 1 lowercase letter');
  if (!/[0-9]/.test(password)) errors.push('Password must contain at least 1 number');
  if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) errors.push('Password must contain at least 1 special character');
  return errors;
};

const TabUsers = () => {
  const { can } = usePermissions();

  const [users, setUsers] = useState([]);
  const [filteredUsers, setFilteredUsers] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  const [showAddUser, setShowAddUser] = useState(false);
  const [showEditUser, setShowEditUser] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [passwordErrors, setPasswordErrors] = useState([]);
  const [editPasswordErrors, setEditPasswordErrors] = useState([]);

  const [newUser, setNewUser] = useState({
    username: '', password: '', confirmPassword: '',
    first_name: '', last_name: '', user_role: '',
    emp_position: '',
    warehouse_assigned: '',
    email: '', status: 'Active',
  });
  const [editUserData, setEditUserData] = useState({
    id: '', public_user_id: '', username: '', first_name: '', last_name: '',
    user_role: '', emp_position: '',
    warehouse_assigned: '',
    email: '', status: 'Active',
    newPassword: '', confirmPassword: '',
  });

  // ---------- Fetch functions ----------
  const fetchUsers = async () => {
    try {
      const res = await userApi.getAllUsers();
      if (res.ok && Array.isArray(res.data)) {
        setUsers(res.data);
        setFilteredUsers(res.data);
      }
    } catch (e) {
      console.error('Error fetching users:', e);
    }
  };

  const fetchWarehouses = async () => {
    try {
      const res = await warehouseApi.getAllWarehouses();
      if (res.ok && Array.isArray(res.data)) {
        setWarehouses(res.data);
      }
    } catch (e) {
      console.error('Error fetching warehouses:', e);
    }
  };

  useEffect(() => {
    (async () => {
      setFetching(true);
      await Promise.all([fetchUsers(), fetchWarehouses()]);
      setFetching(false);
    })();
  }, []);

  // ---------- Search ----------
  const handleSearch = (e) => {
    const term = e.target.value.toLowerCase();
    setSearchTerm(term);
    if (!term.trim()) { setFilteredUsers(users); return; }
    setFilteredUsers(users.filter(u =>
      u.public_user_id?.toLowerCase().includes(term) ||
      u.username?.toLowerCase().includes(term) ||
      u.first_name?.toLowerCase().includes(term) ||
      u.last_name?.toLowerCase().includes(term) ||
      u.email?.toLowerCase().includes(term) ||
      u.warehouse_code?.toLowerCase().includes(term) ||
      u.user_role?.toLowerCase().includes(term) ||
      u.emp_position?.toLowerCase().includes(term)
    ));
  };

  // ---------- Add User ----------
  const handleAddUser = () => {
    setShowAddUser(true);
    setNewUser({
      username: '', password: '', confirmPassword: '',
      first_name: '', last_name: '', user_role: '',
      emp_position: '',
      warehouse_assigned: '',
      email: '', status: 'Active',
    });
    setPasswordErrors([]);
  };

  const handleCloseUserForm = () => setShowAddUser(false);

  const handleNewUserChange = (e) => {
    const { name, value } = e.target;
    setNewUser(prev => {
      const updated = { ...prev, [name]: value };

      if (name === 'user_role') {
        // Auto-assign position based on role
        updated.emp_position = getAutoPosition(value);

        if (isGlobalRole(value)) {
          updated.warehouse_assigned = '';
        }
      }
      return updated;
    });
    if (name === 'password') setPasswordErrors(validatePassword(value));
  };

  const handleSaveUser = async () => {
    if (!newUser.username.trim()) return alert('Username is required.');
    if (!newUser.password.trim()) return alert('Password is required.');
    if (!newUser.first_name.trim()) return alert('First Name is required.');
    if (!newUser.last_name.trim()) return alert('Last Name is required.');
    if (!newUser.user_role) return alert('User Role is required.');
    if (!newUser.email.trim()) return alert('Email is required.');
    if (requiresWarehouse(newUser.user_role) && !newUser.warehouse_assigned) return alert('Warehouse is required for this role.');
    if (isGlobalRole(newUser.user_role) && newUser.warehouse_assigned) return alert('Global roles must not have a warehouse.');
    if (newUser.password !== newUser.confirmPassword) return alert('Passwords do not match.');
    const errs = validatePassword(newUser.password);
    if (errs.length) return alert('Password errors:\n' + errs.join('\n'));

    if (!window.confirm(`Create user "${newUser.username}"?`)) return;
    setLoading(true);
    try {
      const payload = {
        username: newUser.username,
        password: newUser.password,
        first_name: newUser.first_name,
        last_name: newUser.last_name,
        user_role: newUser.user_role,
        emp_position: newUser.emp_position || null,
        warehouse_assigned: newUser.warehouse_assigned ? parseInt(newUser.warehouse_assigned) : null,
        email: newUser.email,
        status: newUser.status,
      };
      const res = await userApi.createUser(payload);
      if (res.ok) {
        alert('✅ User created.');
        handleCloseUserForm();
        await fetchUsers();
      } else {
        alert('❌ ' + (res.data?.message || 'Failed to create user'));
      }
    } finally {
      setLoading(false);
    }
  };

  // ---------- Edit User ----------
  const handleEditUser = (user) => {
    setEditingUser(user);
    setEditUserData({
      id: user.id,
      public_user_id: user.public_user_id,
      username: user.username,
      first_name: user.first_name,
      last_name: user.last_name,
      user_role: user.user_role,
      emp_position: user.emp_position || getAutoPosition(user.user_role),
      warehouse_assigned: user.warehouse_assigned || '',
      email: user.email,
      status: user.status,
      newPassword: '', confirmPassword: '',
    });
    setEditPasswordErrors([]);
    setShowEditUser(true);
  };

  const handleCloseEditUser = () => {
    setShowEditUser(false);
    setEditingUser(null);
  };

  const handleEditUserChange = (e) => {
    const { name, value } = e.target;
    setEditUserData(prev => {
      const updated = { ...prev, [name]: value };

      if (name === 'user_role') {
        // Auto-assign position based on the newly chosen role
        updated.emp_position = getAutoPosition(value);

        if (isGlobalRole(value)) {
          updated.warehouse_assigned = '';
        }
      }
      return updated;
    });
    if (name === 'newPassword') setEditPasswordErrors(value ? validatePassword(value) : []);
  };

  const handleUpdateUser = async () => {
    if (!editUserData.username.trim()) return alert('Username is required.');
    if (!editUserData.first_name.trim()) return alert('First Name is required.');
    if (!editUserData.last_name.trim()) return alert('Last Name is required.');
    if (!editUserData.user_role) return alert('User Role is required.');
    if (!editUserData.email.trim()) return alert('Email is required.');
    if (requiresWarehouse(editUserData.user_role) && !editUserData.warehouse_assigned) return alert('Warehouse is required.');
    if (isGlobalRole(editUserData.user_role) && editUserData.warehouse_assigned) return alert('Global roles must not have a warehouse.');
    if (editUserData.newPassword || editUserData.confirmPassword) {
      if (editUserData.newPassword !== editUserData.confirmPassword) return alert('New passwords do not match.');
      const errs = validatePassword(editUserData.newPassword);
      if (errs.length) return alert('Password errors:\n' + errs.join('\n'));
    }
    if (!window.confirm(`Update user "${editUserData.username}"?`)) return;
    setLoading(true);
    try {
      const payload = {
        username: editUserData.username,
        first_name: editUserData.first_name,
        last_name: editUserData.last_name,
        user_role: editUserData.user_role,
        emp_position: editUserData.emp_position || null,
        warehouse_assigned: editUserData.warehouse_assigned ? parseInt(editUserData.warehouse_assigned) : null,
        email: editUserData.email,
        status: editUserData.status,
      };
      if (editUserData.newPassword) payload.password = editUserData.newPassword;
      const res = await userApi.updateUser(editUserData.id, payload);
      if (res.ok) {
        alert('✅ User updated.');
        handleCloseEditUser();
        await fetchUsers();
      } else {
        alert('❌ ' + (res.data?.message || 'Failed to update user'));
      }
    } finally {
      setLoading(false);
    }
  };

  // ---------- Deactivate / Activate ----------
  const handleDeactivateUser = async (id) => {
    if (!window.confirm('Deactivate this user?')) return;
    const res = await userApi.deactivateUser(id);
    if (res.ok) { alert('✅ Deactivated.'); await fetchUsers(); }
    else alert('❌ ' + (res.data?.message || 'Failed'));
  };
  const handleActivateUser = async (id) => {
    if (!window.confirm('Activate this user?')) return;
    const res = await userApi.activateUser(id);
    if (res.ok) { alert('✅ Activated.'); await fetchUsers(); }
    else alert('❌ ' + (res.data?.message || 'Failed'));
  };

  if (fetching) {
    return (
      <div className="loading-container">
        <div className="loading-spinner"></div>
        <p>Loading users...</p>
      </div>
    );
  }

  const baseColSpan = 8; // User ID, Username, Full Name, Email, Role, Position, Warehouse, Status
  const totalColSpan =
    (can('users.edit') || can('users.delete')) ? baseColSpan + 1 : baseColSpan;

  // Live previews for the approval indicator
  const newWillApprove = computeCanApproveSts(newUser.user_role, newUser.emp_position);
  const editWillApprove = computeCanApproveSts(editUserData.user_role, editUserData.emp_position);

  return (
    <div className="users-section">
      <div className="section-header">
        <h3>User Management</h3>
        <div className="header-actions">
          <div className="user-stats">
            <span className="stat-badge active">Active: {users.filter(u => u.status === 'Active').length}</span>
            <span className="stat-badge inactive">Inactive: {users.filter(u => u.status === 'Inactive').length}</span>
          </div>
          {can('users.create') && (
            <button className="add-user-btn" onClick={handleAddUser}>
              <span className="btn-icon">➕</span>
              <span>Add User</span>
            </button>
          )}
        </div>
      </div>

      <div className="user-search-container">
        <input
          id="user_search"
          type="text"
          className="user-search-input"
          placeholder="Search by ID, Name, Username, Email, Warehouse, Role, or Position..."
          value={searchTerm}
          onChange={handleSearch}
          autoComplete="off"
        />
        {searchTerm && <span className="search-result-count">{filteredUsers.length} results</span>}
      </div>

      {/* ============================================
          ADD USER FORM
          ============================================ */}
      {can('users.create') && showAddUser && (
        <div className="add-user-form">
          <div className="form-header">
            <h4>Add New User</h4>
            <button className="close-form-btn" onClick={handleCloseUserForm}>✕</button>
          </div>
          <div className="form-body">
            <div className="form-group">
              <label htmlFor="new_username">Username *</label>
              <input id="new_username" name="username" type="text" value={newUser.username} onChange={handleNewUserChange} autoComplete="off" />
            </div>

            <div className="form-group">
              <label htmlFor="new_password">Password *</label>
              <input id="new_password" name="password" type="password" value={newUser.password} onChange={handleNewUserChange} autoComplete="new-password" />
              {newUser.password && passwordErrors.length > 0 && (
                <div className="password-requirements">
                  <small>Password must contain:</small>
                  <ul>
                    <li className={passwordErrors.includes('Password must be at least 6 characters') ? 'error' : 'valid'}>• At least 6 characters</li>
                    <li className={passwordErrors.includes('Password must contain at least 1 uppercase letter') ? 'error' : 'valid'}>• At least 1 uppercase letter</li>
                    <li className={passwordErrors.includes('Password must contain at least 1 lowercase letter') ? 'error' : 'valid'}>• At least 1 lowercase letter</li>
                    <li className={passwordErrors.includes('Password must contain at least 1 number') ? 'error' : 'valid'}>• At least 1 number</li>
                    <li className={passwordErrors.includes('Password must contain at least 1 special character') ? 'error' : 'valid'}>• At least 1 special character</li>
                  </ul>
                </div>
              )}
            </div>

            <div className="form-group">
              <label htmlFor="new_confirm_password">Confirm Password *</label>
              <input id="new_confirm_password" name="confirmPassword" type="password" value={newUser.confirmPassword} onChange={handleNewUserChange} autoComplete="new-password" />
              {newUser.confirmPassword && newUser.password !== newUser.confirmPassword && (
                <small className="error-text">Passwords do not match</small>
              )}
            </div>

            <div className="form-group">
              <label htmlFor="new_first_name">First Name *</label>
              <input id="new_first_name" name="first_name" type="text" value={newUser.first_name} onChange={handleNewUserChange} autoComplete="off" />
            </div>

            <div className="form-group">
              <label htmlFor="new_last_name">Last Name *</label>
              <input id="new_last_name" name="last_name" type="text" value={newUser.last_name} onChange={handleNewUserChange} autoComplete="off" />
            </div>

            <div className="form-group">
              <label htmlFor="new_user_role">User Role *</label>
              <select id="new_user_role" name="user_role" value={newUser.user_role} onChange={handleNewUserChange}>
                <option value="">Select Role</option>
                <option value="Super Admin">Super Admin</option>
                <option value="Admin">Admin</option>
                <option value="Stock Registrar">Stock Registrar</option>
                <option value="Stock Handler">Stock Handler</option>
              </select>
            </div>

            {/* ---------- Position (dropdown for Admin, auto-badge for others) ---------- */}
            {newUser.user_role && (
              <div className="form-group">
                {isAdminDropdownRole(newUser.user_role) ? (
                  <>
                    <label htmlFor="new_emp_position">Employee Position *</label>
                    <select
                      id="new_emp_position"
                      name="emp_position"
                      value={newUser.emp_position}
                      onChange={handleNewUserChange}
                    >
                      {ADMIN_POSITIONS.map((p) => (
                        <option key={p} value={p}>{p}</option>
                      ))}
                    </select>
                    <small style={{ color: '#7a8699' }}>
                      Only Admins with position "Department Head" can approve Stock Transfer Slips.
                    </small>
                  </>
                ) : (
                  <>
                    <label>Employee Position</label>
                    <input
                      type="text"
                      value={getAutoPosition(newUser.user_role)}
                      readOnly
                      disabled
                      style={{ background: '#f5f5f0', cursor: 'not-allowed' }}
                    />
                    <small style={{ color: '#7a8699' }}>
                      Auto-assigned based on role.
                    </small>
                  </>
                )}
              </div>
            )}

            {/* ---------- Live STS approval indicator ---------- */}
            {newUser.user_role && newUser.emp_position && (
              <div
                className="form-group"
                style={{
                  gridColumn: '1 / -1',
                  padding: '10px 14px',
                  borderRadius: 8,
                  border: `1.5px solid ${newWillApprove ? '#10b981' : '#e5e5e0'}`,
                  background: newWillApprove ? '#f0fdf4' : '#fafaf8',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  fontSize: 13,
                }}
              >
                <span style={{ fontSize: 18 }}>
                  {newWillApprove ? '✅' : '🔒'}
                </span>
                <span style={{ color: newWillApprove ? '#065f46' : '#7a8699' }}>
                  <strong>STS Approval:</strong>{' '}
                  {newWillApprove
                    ? 'Enabled — this user can approve Stock Transfer Slips.'
                    : 'Not applicable — this user cannot approve Stock Transfer Slips.'}
                </span>
              </div>
            )}

            {newUser.user_role && requiresWarehouse(newUser.user_role) && (
              <div className="form-group">
                <label htmlFor="new_warehouse_assigned">Warehouse Assigned *</label>
                <select id="new_warehouse_assigned" name="warehouse_assigned" value={newUser.warehouse_assigned} onChange={handleNewUserChange}>
                  <option value="">Select Warehouse</option>
                  {warehouses.filter(w => w.status === 'Active').map(w => (
                    <option key={w.warehouse_id} value={w.warehouse_id}>{w.warehouse_code} - {w.warehouse_name}</option>
                  ))}
                </select>
              </div>
            )}

            <div className="form-group">
              <label htmlFor="new_email">Email *</label>
              <input id="new_email" name="email" type="email" value={newUser.email} onChange={handleNewUserChange} autoComplete="off" />
              {newUser.email && !newUser.email.includes('@lepanto.com.ph') && (
                <small className="error-text">Email must be @lepanto.com.ph</small>
              )}
            </div>

            <div className="form-group">
              <label htmlFor="new_status">Status</label>
              <select id="new_status" name="status" value={newUser.status} onChange={handleNewUserChange}>
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
              </select>
            </div>
          </div>

          <div className="form-footer">
            <button className="cancel-btn" onClick={handleCloseUserForm} disabled={loading}>
              <span className="btn-icon">✕</span>
              <span>Cancel</span>
            </button>
            <button className="save-btn" onClick={handleSaveUser} disabled={loading}>
              <span className="btn-icon">💾</span>
              <span>{loading ? 'Saving...' : 'Save User'}</span>
            </button>
          </div>
        </div>
      )}

      {/* ============================================
          EDIT USER FORM
          ============================================ */}
      {can('users.edit') && showEditUser && (
        <div className="add-user-form">
          <div className="form-header">
            <h4>Edit User - {editUserData.public_user_id}</h4>
            <button className="close-form-btn" onClick={handleCloseEditUser}>✕</button>
          </div>
          <div className="form-body">
            <div className="form-group">
              <label>Public User ID</label>
              <input type="text" value={editUserData.public_user_id} disabled style={{ background: '#f5f5f0' }} />
            </div>
            <div className="form-group">
              <label htmlFor="edit_username">Username *</label>
              <input id="edit_username" name="username" type="text" value={editUserData.username} onChange={handleEditUserChange} autoComplete="off" />
            </div>
            <div className="form-group">
              <label htmlFor="edit_first_name">First Name *</label>
              <input id="edit_first_name" name="first_name" type="text" value={editUserData.first_name} onChange={handleEditUserChange} autoComplete="off" />
            </div>
            <div className="form-group">
              <label htmlFor="edit_last_name">Last Name *</label>
              <input id="edit_last_name" name="last_name" type="text" value={editUserData.last_name} onChange={handleEditUserChange} autoComplete="off" />
            </div>
            <div className="form-group">
              <label htmlFor="edit_user_role">User Role *</label>
              <select id="edit_user_role" name="user_role" value={editUserData.user_role} onChange={handleEditUserChange}>
                <option value="">Select Role</option>
                <option value="Super Admin">Super Admin</option>
                <option value="Admin">Admin</option>
                <option value="Stock Registrar">Stock Registrar</option>
                <option value="Stock Handler">Stock Handler</option>
              </select>
            </div>

            {/* ---------- Position (dropdown for Admin, auto-badge for others) ---------- */}
            {editUserData.user_role && (
              <div className="form-group">
                {isAdminDropdownRole(editUserData.user_role) ? (
                  <>
                    <label htmlFor="edit_emp_position">Employee Position *</label>
                    <select
                      id="edit_emp_position"
                      name="emp_position"
                      value={editUserData.emp_position}
                      onChange={handleEditUserChange}
                    >
                      {ADMIN_POSITIONS.map((p) => (
                        <option key={p} value={p}>{p}</option>
                      ))}
                    </select>
                    <small style={{ color: '#7a8699' }}>
                      Only Admins with position "Department Head" can approve Stock Transfer Slips.
                    </small>
                  </>
                ) : (
                  <>
                    <label>Employee Position</label>
                    <input
                      type="text"
                      value={getAutoPosition(editUserData.user_role)}
                      readOnly
                      disabled
                      style={{ background: '#f5f5f0', cursor: 'not-allowed' }}
                    />
                    <small style={{ color: '#7a8699' }}>
                      Auto-assigned based on role.
                    </small>
                  </>
                )}
              </div>
            )}

            {/* ---------- Live STS approval indicator ---------- */}
            {editUserData.user_role && editUserData.emp_position && (
              <div
                className="form-group"
                style={{
                  gridColumn: '1 / -1',
                  padding: '10px 14px',
                  borderRadius: 8,
                  border: `1.5px solid ${editWillApprove ? '#10b981' : '#e5e5e0'}`,
                  background: editWillApprove ? '#f0fdf4' : '#fafaf8',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  fontSize: 13,
                }}
              >
                <span style={{ fontSize: 18 }}>
                  {editWillApprove ? '✅' : '🔒'}
                </span>
                <span style={{ color: editWillApprove ? '#065f46' : '#7a8699' }}>
                  <strong>STS Approval:</strong>{' '}
                  {editWillApprove
                    ? 'Enabled — this user can approve Stock Transfer Slips.'
                    : 'Not applicable — this user cannot approve Stock Transfer Slips.'}
                </span>
              </div>
            )}

            {editUserData.user_role && requiresWarehouse(editUserData.user_role) && (
              <div className="form-group">
                <label htmlFor="edit_warehouse_assigned">Warehouse Assigned *</label>
                <select id="edit_warehouse_assigned" name="warehouse_assigned" value={editUserData.warehouse_assigned} onChange={handleEditUserChange}>
                  <option value="">Select Warehouse</option>
                  {warehouses.filter(w => w.status === 'Active').map(w => (
                    <option key={w.warehouse_id} value={w.warehouse_id}>{w.warehouse_code} - {w.warehouse_name}</option>
                  ))}
                </select>
              </div>
            )}

            <div className="form-group">
              <label htmlFor="edit_email">Email *</label>
              <input id="edit_email" name="email" type="email" value={editUserData.email} onChange={handleEditUserChange} autoComplete="off" />
              {editUserData.email && !editUserData.email.includes('@lepanto.com.ph') && (
                <small className="error-text">Email must be @lepanto.com.ph</small>
              )}
            </div>

            <div className="form-group">
              <label htmlFor="edit_status">Status</label>
              <select id="edit_status" name="status" value={editUserData.status} onChange={handleEditUserChange}>
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
              </select>
            </div>

            <div className="form-group" style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '1rem', marginTop: '0.5rem' }}>
              <label style={{ fontWeight: '600', color: '#00d2c8' }}>🔑 Change Password (optional)</label>
              <small style={{ display: 'block', color: '#7a8699', marginBottom: '0.5rem' }}>Leave blank to keep current password.</small>
            </div>
            <div className="form-group">
              <label htmlFor="edit_new_password">New Password</label>
              <input id="edit_new_password" name="newPassword" type="password" value={editUserData.newPassword} onChange={handleEditUserChange} autoComplete="new-password" />
              {editUserData.newPassword && editPasswordErrors.length > 0 && (
                <div className="password-requirements">
                  <small>Password must contain:</small>
                  <ul>
                    {editPasswordErrors.map(e => <li key={e} className="error">• {e.replace('Password must contain ', '').replace('Password must be ', '')}</li>)}
                  </ul>
                </div>
              )}
            </div>
            <div className="form-group">
              <label htmlFor="edit_confirm_password">Confirm New Password</label>
              <input id="edit_confirm_password" name="confirmPassword" type="password" value={editUserData.confirmPassword} onChange={handleEditUserChange} autoComplete="new-password" />
              {editUserData.confirmPassword && editUserData.newPassword !== editUserData.confirmPassword && (
                <small className="error-text">Passwords do not match</small>
              )}
            </div>
          </div>

          <div className="form-footer">
            <button className="cancel-btn" onClick={handleCloseEditUser}>
              <span className="btn-icon">✕</span>
              <span>Cancel</span>
            </button>
            <button className="save-btn" onClick={handleUpdateUser} disabled={loading}>
              <span className="btn-icon">💾</span>
              <span>{loading ? 'Updating...' : 'Update User'}</span>
            </button>
          </div>
        </div>
      )}

      {/* ============================================
          USERS TABLE
          ============================================ */}
      <div className="table-wrapper">
        <table className="data-table">
          <thead>
            <tr>
              <th>User ID</th>
              <th>Username</th>
              <th>Full Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Position</th>
              <th>Warehouse</th>
              <th>Status</th>
              {(can('users.edit') || can('users.delete')) && <th>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {filteredUsers.length > 0 ? filteredUsers.map(u => (
              <tr key={u.id}>
                <td><span className="public-id-badge">{u.public_user_id || 'N/A'}</span></td>
                <td><strong>{u.username}</strong></td>
                <td>{u.first_name} {u.last_name}</td>
                <td>{u.email}</td>
                <td>{u.user_role}</td>
                <td>
                  {u.emp_position ? (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <span>{u.emp_position}</span>
                      {u.can_approve_sts ? (
                        <span
                          title="Can approve Stock Transfer Slips"
                          style={{
                            display: 'inline-block',
                            padding: '2px 8px',
                            borderRadius: 999,
                            fontSize: 10,
                            fontWeight: 700,
                            background: '#dcfce7',
                            color: '#065f46',
                            border: '1px solid #86efac',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          ✅ STS APPROVER
                        </span>
                      ) : null}
                    </span>
                  ) : (
                    <span style={{ color: '#a0a8b0' }}>—</span>
                  )}
                </td>
                <td>
                  {u.warehouse_code
                    ? <span className="warehouse-code">{u.warehouse_code}</span>
                    : <span style={{ color: '#a0a8b0' }}>Not Assigned</span>}
                </td>
                <td><span className={`status-badge ${u.status?.toLowerCase()}`}>{u.status}</span></td>
                {(can('users.edit') || can('users.delete')) && (
                  <td>
                    <div className="action-buttons">
                      {can('users.delete') && (
                        u.status === 'Active'
                          ? (
                            <button
                              className="action-btn deactivate-btn"
                              onClick={() => handleDeactivateUser(u.id)}
                              title="Deactivate this user"
                            >
                              <span className="btn-icon">🔒</span>
                              <span>Deactivate</span>
                            </button>
                          )
                          : (
                            <button
                              className="action-btn activate-btn"
                              onClick={() => handleActivateUser(u.id)}
                              title="Activate this user"
                            >
                              <span className="btn-icon">🔓</span>
                              <span>Activate</span>
                            </button>
                          )
                      )}
                      {can('users.edit') && (
                        <button
                          className="action-btn edit"
                          onClick={() => handleEditUser(u)}
                          title="Edit this user"
                        >
                          <span className="btn-icon">✏️</span>
                          <span>Edit</span>
                        </button>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            )) : (
              <tr>
                <td colSpan={totalColSpan} style={{ textAlign: 'center' }}>
                  {searchTerm ? 'No users found matching your search' : 'No users found'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default TabUsers;