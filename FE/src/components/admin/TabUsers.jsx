// src/components/admin/TabUsers.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FiPlus, FiX, FiSave, FiKey, FiLoader, FiCheckCircle, FiLock, FiUnlock,
  FiEdit2, FiLogOut, FiCircle, FiChevronDown, FiChevronUp,
  FiMail, FiUser, FiMapPin, FiCalendar, FiClock, FiRefreshCw, FiShield,
} from 'react-icons/fi';
import { userApi, warehouseApi, locatorsApi } from '../../services/api';
import { usePermissions } from '../../permissions/usePermissions';
import { useToast } from '../shared/ToastProvider';
import ConfirmModal from '../shared/ConfirmModal';
import ActionsMenu from '../shared/ActionsMenu';
import UserAvatar from '../shared/UserAvatar';
import { buttonCss } from '../shared/buttonStyles';

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
const isGlobalRole = (role) => ['Super Admin', 'Admin'].includes(role);
const requiresWarehouse = (role) => ['Stock Registrar', 'Stock Handler'].includes(role);
const isAdminDropdownRole = (role) => role === 'Admin';

const ADMIN_POSITIONS = ['Department Head', 'Inventory Controller Manager'];

// ---------------------------------------------------------------------------
// Stock Handler position support
// ---------------------------------------------------------------------------
const HANDLER_ROLE = 'Stock Handler';
const HANDLER_WAREHOUSE_CODES = ['UG', 'LUMB'];
const HANDLER_POSITIONS = ['Surface Handler', 'Underground Handler'];

const isHandlerRole = (role) => role === HANDLER_ROLE;

const isHandlerWarehouseId = (warehouseId, warehouses) => {
  if (!warehouseId) return false;
  const wh = warehouses.find(
    (w) => String(w.warehouse_id) === String(warehouseId)
  );
  if (!wh) return false;
  const code = String(wh.warehouse_code || '').trim().toUpperCase();
  return HANDLER_WAREHOUSE_CODES.includes(code);
};

const getAutoPosition = (role) => {
  if (role === 'Super Admin') return 'Programmer';
  if (role === 'Admin') return 'Inventory Controller Manager';
  if (role === 'Stock Registrar' || role === 'Stock Handler') return 'Inventory Controllers';
  return '';
};

const computeAutoPosition = (role, warehouseId, warehouses) => {
  if (role === HANDLER_ROLE) {
    return isHandlerWarehouseId(warehouseId, warehouses)
      ? HANDLER_POSITIONS[0]
      : 'Inventory Controllers';
  }
  return getAutoPosition(role);
};

const recomputeForWarehouse = (role, warehouseId, currentPosition, warehouses) => {
  if (role !== HANDLER_ROLE) return currentPosition;
  if (isHandlerWarehouseId(warehouseId, warehouses)) {
    return HANDLER_POSITIONS.includes(currentPosition)
      ? currentPosition
      : HANDLER_POSITIONS[0];
  }
  return 'Inventory Controllers';
};

// ---------------------------------------------------------------------------
// Validation / Rules
// ---------------------------------------------------------------------------
const validatePassword = (password) => {
  const errors = [];
  if (password.length < 6) errors.push('Password must be at least 6 characters');
  if (!/[A-Z]/.test(password)) errors.push('Password must contain at least 1 uppercase letter');
  if (!/[a-z]/.test(password)) errors.push('Password must contain at least 1 lowercase letter');
  if (!/[0-9]/.test(password)) errors.push('Password must contain at least 1 number');
  if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) errors.push('Password must contain at least 1 special character');
  return errors;
};

const LEPANTO_EMAIL_PATTERN = /^[A-Za-z0-9._%+-]+@lepantomining\.com$/i;

const isLepantoEmail = (email) => {
  if (typeof email !== 'string') return false;
  return LEPANTO_EMAIL_PATTERN.test(email.trim());
};

const roleSlug = (role) => {
  if (!role) return 'default';
  return String(role).toLowerCase().replace(/\s+/g, '-');
};

const fmtDateTime = (value) => {
  if (!value) return null;
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleString();
  } catch {
    return null;
  }
};

const fmtDate = (value) => {
  if (!value) return null;
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString();
  } catch {
    return null;
  }
};

// ---------------------------------------------------------------------------
// Initial State Templates
// ---------------------------------------------------------------------------
const EMPTY_NEW_USER = {
  username: '', password: '', confirmPassword: '',
  first_name: '', last_name: '', user_role: '',
  emp_position: '', warehouse_assigned: '',
  email: '', status: 'Active',
  can_approve_sts: false,
  assigned_bodegas: [],
};

const EMPTY_EDIT_USER = {
  id: '', public_user_id: '', username: '', first_name: '', last_name: '',
  user_role: '', emp_position: '', warehouse_assigned: '',
  email: '', status: 'Active',
  newPassword: '', confirmPassword: '',
  can_approve_sts: false,
  assigned_bodegas: [],
};

const EMPTY_CONFIRM = {
  open: false,
  isLoading: false,
  action: null,
  payload: null,
  title: 'Are you sure?',
  message: '',
  confirmLabel: 'Confirm',
  cancelLabel: 'Cancel',
  variant: 'primary',
  icon: null,
};

// ---------------------------------------------------------------------------
// Bodega Multi-Select Component
//
// NEW: optional `error` + `onRetry` props. When the parent's
// `fetchLocators` fails, the inline error renders in both the chip
// area (when no locators exist yet) and the dropdown panel (when the
// user opens the picker). The Retry button calls the parent's
// `fetchLocators` again for the current warehouse.
//
// The trigger button is not disabled by `error` — the user can still
// open the panel to see the retry action. It IS disabled by `loading`
// and `disabled`.
// ---------------------------------------------------------------------------
const BodegaMultiSelect = ({
  value = [],
  onChange,
  locators = [],
  loading,
  error,
  onRetry,
  disabled,
}) => {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  const selectedSet = useMemo(() => new Set(value), [value]);
  const available = useMemo(
    () => locators.filter((l) => !selectedSet.has(l.locator_code)),
    [locators, selectedSet]
  );

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const add = (code) => {
    if (!code || selectedSet.has(code)) return;
    onChange([...value, code]);
    setOpen(false);
  };

  const remove = (code) => {
    onChange(value.filter((c) => c !== code));
  };

  return (
    <div className="user-bodega-multi" ref={wrapRef}>
      <div className="user-bodega-chips">
        {loading && value.length === 0 && (
          <div className="user-bodega-empty">Loading locators…</div>
        )}

        {!loading && error && value.length === 0 && (
          <div className="user-bodega-error">
            <span>{error}</span>
            {onRetry && (
              <button
                type="button"
                className="user-bodega-retry"
                onClick={onRetry}
                disabled={disabled}
              >
                Retry
              </button>
            )}
          </div>
        )}

        {!loading && !error && value.length === 0 && (
          <div className="user-bodega-empty">No bodegas assigned.</div>
        )}

        {value.map((code) => {
          const loc = locators.find((l) => l.locator_code === code);
          return (
            <span key={code} className="user-bodega-chip">
              <FiMapPin className="user-bodega-chip-icon" />
              <span className="user-bodega-chip-code">{code}</span>
              {loc?.locator_name && <span className="user-bodega-chip-name">{loc.locator_name}</span>}
              <button
                type="button"
                className="user-bodega-chip-remove"
                onClick={() => remove(code)}
                disabled={disabled}
              >
                <FiX />
              </button>
            </span>
          );
        })}
      </div>
      <div className="user-bodega-add">
        <button
          type="button"
          className={`user-bodega-add-btn ${open ? 'is-open' : ''}`}
          onClick={() => setOpen((v) => !v)}
          disabled={disabled || loading}
        >
          <FiPlus />
          <span>Assign Bodega</span>
          <FiChevronDown className={`user-bodega-caret ${open ? 'is-open' : ''}`} />
        </button>
        {open && (
          <div className="user-bodega-panel" role="listbox">
            {loading ? (
              <div className="user-bodega-panel-msg">Loading…</div>
            ) : error ? (
              <div className="user-bodega-panel-error">
                <span>{error}</span>
                {onRetry && (
                  <button
                    type="button"
                    className="user-bodega-retry"
                    onClick={onRetry}
                    disabled={disabled}
                  >
                    Retry
                  </button>
                )}
              </div>
            ) : available.length === 0 ? (
              <div className="user-bodega-panel-msg">
                All available bodegas are assigned.
              </div>
            ) : (
              available.map((l) => (
                <button
                  key={l.locator_code}
                  type="button"
                  role="option"
                  className="user-bodega-option"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    add(l.locator_code);
                  }}
                >
                  <div className="user-bodega-option-code">{l.locator_code}</div>
                  {l.locator_name && <div className="user-bodega-option-name">{l.locator_name}</div>}
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
const TabUsers = () => {
  const { can, role } = usePermissions();
  const toast = useToast();

  const isSuperAdmin = role === 'Super Admin';
  const canCreateUsers = isSuperAdmin && can('users.create');

  const [users, setUsers] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [locators, setLocators] = useState([]);
  const [locatorsLoading, setLocatorsLoading] = useState(false);
  // NEW: inline error state for the locator fetch. When non-null, the
  // BodegaMultiSelect shows the message + Retry button instead of
  // hanging on "Loading locators…" forever.
  const [locatorError, setLocatorError] = useState(null);

  // NEW: race guard. Incremented on every fetchLocators call; only the
  // response whose reqId matches the current value is committed to state.
  // Prevents a slow warehouse-switch response from overwriting a newer one.
  const locatorReqIdRef = useRef(0);

  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedUserId, setExpandedUserId] = useState(null);

  const [showAddUser, setShowAddUser] = useState(false);
  const [showEditUser, setShowEditUser] = useState(false);
  const [passwordErrors, setPasswordErrors] = useState([]);
  const [editPasswordErrors, setEditPasswordErrors] = useState([]);

  const [newUser, setNewUser] = useState({ ...EMPTY_NEW_USER });
  const [editUserData, setEditUserData] = useState({ ...EMPTY_EDIT_USER });

  const [confirm, setConfirm] = useState({ ...EMPTY_CONFIRM });

  const lastAutoRefreshRef = useRef(0);

  const openConfirm = (cfg) => {
    setConfirm({ ...EMPTY_CONFIRM, open: true, ...cfg });
  };

  const closeConfirm = () => {
    setConfirm((prev) => ({ ...prev, open: false, isLoading: false }));
  };

  const runConfirmAction = async () => {
    const { action, payload } = confirm;
    if (!action) {
      closeConfirm();
      return;
    }

    setConfirm((prev) => ({ ...prev, isLoading: true }));

    let res = null;
    let successMessage = '';

    try {
      switch (action) {
        case 'create':
          res = await userApi.createUser(payload);
          successMessage = 'User created.';
          break;
        case 'update':
          res = await userApi.updateUser(payload.id, payload.data);
          successMessage = 'User updated.';
          break;
        case 'deactivate':
          res = await userApi.deactivateUser(payload.id);
          successMessage = 'User deactivated.';
          break;
        case 'activate':
          res = await userApi.activateUser(payload.id);
          successMessage = 'User activated.';
          break;
        case 'forceLogout':
          res = await userApi.forceLogoutUser(payload.id);
          successMessage =
            res?.data?.message || `Session for "${payload.username}" terminated.`;
          break;
        case 'resetPassword':
          res = await userApi.resetPassword(payload.id);
          successMessage =
            res?.data?.message || `Password for "${payload.username}" reset to default.`;
          break;
        default:
          closeConfirm();
          return;
      }
    } catch (err) {
      console.error('Confirm action failed:', err);
      closeConfirm();
      toast.error('Error connecting to server.');
      return;
    }

    closeConfirm();

    if (res && res.ok) {
      if (action === 'create') setShowAddUser(false);
      if (action === 'update') setShowEditUser(false);
      toast.success(successMessage);
      await fetchUsers();
    } else {
      toast.error(res?.data?.message || 'Action failed.');
    }
  };

  // ---------- Fetch ----------
  const fetchUsers = async () => {
    try {
      const res = await userApi.getAllUsers();
      if (res.ok && Array.isArray(res.data)) {
        setUsers(res.data);
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

  /**
   * Locator fetch — race-guarded + error-surfacing.
   *
   * Now takes a `warehouseCode` directly (not an id) so the caller
   * can pass the already-resolved code, and the effect that watches
   * for warehouse changes can key on a primitive string (no spurious
   * refetches when the warehouses list refreshes).
   *
   * Race-guard: each call increments `locatorReqIdRef`. If a newer
   * call has started before the response lands, the older response
   * is discarded — user-visible state always reflects the most
   * recent warehouse selection.
   *
   * On failure: state is emptied + `locatorError` is set + a warning
   * toast is fired. The Retry button in BodegaMultiSelect calls this
   * same function again.
   */
  const fetchLocators = useCallback(
    async (warehouseCode) => {
      if (!warehouseCode) return;

      const reqId = ++locatorReqIdRef.current;
      const isStale = () => reqId !== locatorReqIdRef.current;

      setLocatorsLoading(true);
      setLocatorError(null);
      try {
        const res = await locatorsApi.list({
          warehouse_code: warehouseCode,
          limit: 5000,
        });
        if (isStale()) return;

        if (res.ok) {
          setLocators(Array.isArray(res.data) ? res.data : []);
        } else {
          setLocators([]);
          const msg =
            res?.data?.message || 'Failed to load locators for this warehouse.';
          setLocatorError(msg);
          toast.warning(msg);
        }
      } catch (err) {
        if (isStale()) return;
        console.error('Error fetching locators:', err);
        setLocators([]);
        const msg =
          err?.message || 'Failed to load locators for this warehouse.';
        setLocatorError(msg);
        toast.warning(msg);
      } finally {
        if (!isStale()) setLocatorsLoading(false);
      }
    },
    [toast]
  );

  const handleRefreshUsers = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await fetchUsers();
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    (async () => {
      setFetching(true);
      await Promise.all([fetchUsers(), fetchWarehouses()]);
      setFetching(false);
    })();
  }, []);

  useEffect(() => {
    const maybeRefresh = () => {
      const now = Date.now();
      if (now - lastAutoRefreshRef.current < 1500) return;
      lastAutoRefreshRef.current = now;
      fetchUsers();
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') maybeRefresh();
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('focus', maybeRefresh);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('focus', maybeRefresh);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (expandedUserId && !users.some((u) => u.id === expandedUserId)) {
      setExpandedUserId(null);
    }
  }, [users, expandedUserId]);

  useEffect(() => {
    if (!showAddUser && !showEditUser) return;
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (confirm.open) return;
      if (showEditUser) handleCloseEditUser();
      else if (showAddUser) handleCloseUserForm();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAddUser, showEditUser, confirm.open]);

  // Resolved warehouse codes — derived from the current selection so
  // the locator effects can key on a primitive string instead of the
  // whole `warehouses` array. A warehouse-list refresh therefore
  // never triggers a locator refetch on its own.
  const currentAddWarehouseCode = useMemo(() => {
    if (!newUser.warehouse_assigned) return '';
    const wh = warehouses.find(
      (w) => String(w.warehouse_id) === String(newUser.warehouse_assigned)
    );
    return wh?.warehouse_code || '';
  }, [newUser.warehouse_assigned, warehouses]);

  const currentEditWarehouseCode = useMemo(() => {
    if (!editUserData.warehouse_assigned) return '';
    const wh = warehouses.find(
      (w) => String(w.warehouse_id) === String(editUserData.warehouse_assigned)
    );
    return wh?.warehouse_code || '';
  }, [editUserData.warehouse_assigned, warehouses]);

  // Locators fetching for Add Modal
  useEffect(() => {
    if (
      showAddUser &&
      isHandlerRole(newUser.user_role) &&
      newUser.emp_position === 'Underground Handler' &&
      currentAddWarehouseCode
    ) {
      fetchLocators(currentAddWarehouseCode);
    } else if (showAddUser) {
      setLocators([]);
      setLocatorError(null);
    }
  }, [
    showAddUser,
    newUser.user_role,
    newUser.emp_position,
    currentAddWarehouseCode,
    fetchLocators,
  ]);

  // Locators fetching for Edit Modal
  useEffect(() => {
    if (
      showEditUser &&
      isHandlerRole(editUserData.user_role) &&
      editUserData.emp_position === 'Underground Handler' &&
      currentEditWarehouseCode
    ) {
      fetchLocators(currentEditWarehouseCode);
    } else if (showEditUser) {
      setLocators([]);
      setLocatorError(null);
    }
  }, [
    showEditUser,
    editUserData.user_role,
    editUserData.emp_position,
    currentEditWarehouseCode,
    fetchLocators,
  ]);

  // Clear locators when both modals are closed
  useEffect(() => {
    if (!showAddUser && !showEditUser) {
      setLocators([]);
      setLocatorError(null);
    }
  }, [showAddUser, showEditUser]);

  // ---------- Derived ----------
  const filteredUsers = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return users;
    return users.filter(
      (u) =>
        u.public_user_id?.toLowerCase().includes(term) ||
        u.username?.toLowerCase().includes(term) ||
        u.first_name?.toLowerCase().includes(term) ||
        u.last_name?.toLowerCase().includes(term) ||
        u.email?.toLowerCase().includes(term) ||
        u.warehouse_code?.toLowerCase().includes(term) ||
        u.user_role?.toLowerCase().includes(term) ||
        u.emp_position?.toLowerCase().includes(term)
    );
  }, [users, searchTerm]);

  const activeCount = useMemo(() => users.filter((u) => u.status === 'Active').length, [users]);
  const inactiveCount = useMemo(() => users.filter((u) => u.status === 'Inactive').length, [users]);

  // ---------- Row expansion ----------
  const toggleExpand = (id) => {
    setExpandedUserId((prev) => (prev === id ? null : id));
  };

  const handleRowKeyDown = (e, id) => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      toggleExpand(id);
    }
  };

  // ---------- Add user ----------
  const handleAddUser = () => {
    setShowAddUser(true);
    setNewUser({ ...EMPTY_NEW_USER });
    setPasswordErrors([]);
  };

  const handleCloseUserForm = () => setShowAddUser(false);

  const handleNewUserChange = (e) => {
    const { name, value } = e.target;
    setNewUser((prev) => {
      const updated = { ...prev, [name]: value };

      if (name === 'user_role') {
        if (isGlobalRole(value)) {
          updated.warehouse_assigned = '';
          updated.assigned_bodegas = [];
        }
        updated.emp_position = computeAutoPosition(value, updated.warehouse_assigned, warehouses);

        if (value !== 'Admin') {
          updated.can_approve_sts = false;
        } else if (updated.emp_position === 'Department Head') {
          updated.can_approve_sts = true;
        }
      } else if (name === 'warehouse_assigned') {
        updated.emp_position = recomputeForWarehouse(updated.user_role, value, updated.emp_position, warehouses);
        updated.assigned_bodegas = []; // Reset bodegas when warehouse changes
      } else if (name === 'emp_position') {
        if (value === 'Department Head') {
          updated.can_approve_sts = true;
        }
        if (value !== 'Underground Handler') {
          updated.assigned_bodegas = []; // Reset bodegas if not UG handler
        }
      }

      return updated;
    });
    if (name === 'password') setPasswordErrors(validatePassword(value));
  };

  const handleSaveUser = () => {
    if (!isSuperAdmin) {
      return toast.error('Only a Super Admin can create users.');
    }
    if (!newUser.username.trim()) return toast.error('Username is required.');
    if (!newUser.password.trim()) return toast.error('Password is required.');
    if (!newUser.first_name.trim()) return toast.error('First Name is required.');
    if (!newUser.last_name.trim()) return toast.error('Last Name is required.');
    if (!newUser.user_role) return toast.error('User Role is required.');
    if (!newUser.email.trim()) return toast.error('Email is required.');
    if (!isLepantoEmail(newUser.email)) {
      return toast.error('Email must be a Lepanto email (@lepantomining.com).');
    }
    if (requiresWarehouse(newUser.user_role) && !newUser.warehouse_assigned) return toast.error('Warehouse is required for this role.');
    if (isGlobalRole(newUser.user_role) && newUser.warehouse_assigned) return toast.error('Global roles must not have a warehouse.');
    if (
      isHandlerRole(newUser.user_role) &&
      isHandlerWarehouseId(newUser.warehouse_assigned, warehouses) &&
      !HANDLER_POSITIONS.includes(newUser.emp_position)
    ) {
      return toast.error('Please select a handler position (Surface or Underground).');
    }
    if (newUser.password !== newUser.confirmPassword) return toast.error('Passwords do not match.');
    const errs = validatePassword(newUser.password);
    if (errs.length) return toast.error('Password errors: ' + errs.join(' · '));

    const isUG = isHandlerRole(newUser.user_role) && newUser.emp_position === 'Underground Handler';

    const payload = {
      username: newUser.username,
      password: newUser.password,
      first_name: newUser.first_name,
      last_name: newUser.last_name,
      user_role: newUser.user_role,
      emp_position: newUser.emp_position || null,
      warehouse_assigned: newUser.warehouse_assigned ? parseInt(newUser.warehouse_assigned) : null,
      email: String(newUser.email).trim().toLowerCase(),
      status: newUser.status,
      can_approve_sts: newUser.can_approve_sts,
      assigned_bodegas: isUG ? newUser.assigned_bodegas : [],
    };

    openConfirm({
      action: 'create',
      payload,
      title: 'Create new user?',
      message: (
        <>
          A <strong>{newUser.user_role}</strong> account will be created for{' '}
          <strong>{newUser.first_name} {newUser.last_name}</strong>{' '}
          (username <strong>{newUser.username}</strong>).
        </>
      ),
      confirmLabel: 'Create User',
      cancelLabel: 'Cancel',
      variant: 'primary',
      icon: <FiPlus />,
    });
  };

  // ---------- Edit user ----------
  const handleEditUser = (user) => {
    const initialPosition = (() => {
      if (
        isHandlerRole(user.user_role) &&
        isHandlerWarehouseId(user.warehouse_assigned, warehouses)
      ) {
        return HANDLER_POSITIONS.includes(user.emp_position)
          ? user.emp_position
          : HANDLER_POSITIONS[0];
      }
      return user.emp_position || getAutoPosition(user.user_role);
    })();

    setEditUserData({
      id: user.id,
      public_user_id: user.public_user_id,
      username: user.username,
      first_name: user.first_name,
      last_name: user.last_name,
      user_role: user.user_role,
      emp_position: initialPosition,
      warehouse_assigned: user.warehouse_assigned || '',
      email: user.email,
      status: user.status,
      newPassword: '', confirmPassword: '',
      can_approve_sts: user.can_approve_sts === 1 || user.can_approve_sts === true,
      assigned_bodegas: user.assigned_bodegas || [],
    });
    setEditPasswordErrors([]);
    setShowEditUser(true);
  };

  const handleCloseEditUser = () => {
    setShowEditUser(false);
  };

  const handleEditUserChange = (e) => {
    const { name, value } = e.target;
    setEditUserData((prev) => {
      const updated = { ...prev, [name]: value };

      if (name === 'user_role') {
        if (isGlobalRole(value)) {
          updated.warehouse_assigned = '';
          updated.assigned_bodegas = [];
        }
        updated.emp_position = computeAutoPosition(value, updated.warehouse_assigned, warehouses);

        if (value !== 'Admin') {
          updated.can_approve_sts = false;
        } else if (updated.emp_position === 'Department Head') {
          updated.can_approve_sts = true;
        }
      } else if (name === 'warehouse_assigned') {
        updated.emp_position = recomputeForWarehouse(updated.user_role, value, updated.emp_position, warehouses);
        updated.assigned_bodegas = [];
      } else if (name === 'emp_position') {
        if (value === 'Department Head') {
          updated.can_approve_sts = true;
        }
        if (value !== 'Underground Handler') {
          updated.assigned_bodegas = [];
        }
      }

      return updated;
    });
    if (name === 'newPassword') setEditPasswordErrors(value ? validatePassword(value) : []);
  };

  const handleUpdateUser = () => {
    if (!editUserData.username.trim()) return toast.error('Username is required.');
    if (!editUserData.first_name.trim()) return toast.error('First Name is required.');
    if (!editUserData.last_name.trim()) return toast.error('Last Name is required.');
    if (!editUserData.user_role) return toast.error('User Role is required.');
    if (!editUserData.email.trim()) return toast.error('Email is required.');
    if (!isLepantoEmail(editUserData.email)) {
      return toast.error('Email must be a Lepanto email (@lepantomining.com).');
    }
    if (requiresWarehouse(editUserData.user_role) && !editUserData.warehouse_assigned) return toast.error('Warehouse is required.');
    if (isGlobalRole(editUserData.user_role) && editUserData.warehouse_assigned) return toast.error('Global roles must not have a warehouse.');
    if (
      isHandlerRole(editUserData.user_role) &&
      isHandlerWarehouseId(editUserData.warehouse_assigned, warehouses) &&
      !HANDLER_POSITIONS.includes(editUserData.emp_position)
    ) {
      return toast.error('Please select a handler position (Surface or Underground).');
    }
    if (editUserData.newPassword || editUserData.confirmPassword) {
      if (editUserData.newPassword !== editUserData.confirmPassword) return toast.error('New passwords do not match.');
      const errs = validatePassword(editUserData.newPassword);
      if (errs.length) return toast.error('Password errors: ' + errs.join(' · '));
    }

    const isUG = isHandlerRole(editUserData.user_role) && editUserData.emp_position === 'Underground Handler';

    const data = {
      username: editUserData.username,
      first_name: editUserData.first_name,
      last_name: editUserData.last_name,
      user_role: editUserData.user_role,
      emp_position: editUserData.emp_position || null,
      warehouse_assigned: editUserData.warehouse_assigned ? parseInt(editUserData.warehouse_assigned) : null,
      email: String(editUserData.email).trim().toLowerCase(),
      status: editUserData.status,
      can_approve_sts: editUserData.can_approve_sts,
      assigned_bodegas: isUG ? editUserData.assigned_bodegas : [],
    };
    if (editUserData.newPassword) data.password = editUserData.newPassword;

    openConfirm({
      action: 'update',
      payload: { id: editUserData.id, data },
      title: 'Save changes?',
      message: (
        <>
          Save changes to <strong>{editUserData.first_name} {editUserData.last_name}</strong>{' '}
          ({editUserData.public_user_id})?
          {editUserData.newPassword ? (
            <>
              <br /><br />
              Their password will also be changed, and they will be signed out.
            </>
          ) : null}
        </>
      ),
      confirmLabel: 'Save Changes',
      cancelLabel: 'Cancel',
      variant: 'primary',
      icon: <FiSave />,
    });
  };

  // ---------- Activate / Deactivate ----------
  const handleDeactivateUser = (user) => {
    openConfirm({
      action: 'deactivate',
      payload: user,
      title: 'Deactivate user?',
      message: (
        <>
          Deactivate <strong>{user.first_name} {user.last_name}</strong>{' '}
          (<strong>{user.username}</strong>)?
          <br /><br />
          They will be signed out and unable to log in until reactivated.
        </>
      ),
      confirmLabel: 'Deactivate',
      cancelLabel: 'Cancel',
      variant: 'danger',
      icon: <FiLock />,
    });
  };

  const handleActivateUser = (user) => {
    openConfirm({
      action: 'activate',
      payload: user,
      title: 'Activate user?',
      message: (
        <>
          Reactivate <strong>{user.first_name} {user.last_name}</strong>{' '}
          (<strong>{user.username}</strong>)?
          <br /><br />
          They will be able to log in again.
        </>
      ),
      confirmLabel: 'Activate',
      cancelLabel: 'Cancel',
      variant: 'primary',
      icon: <FiUnlock />,
    });
  };

  // ---------- Force logout ----------
  const handleForceLogout = (user) => {
    openConfirm({
      action: 'forceLogout',
      payload: user,
      title: 'Force log out?',
      message: (
        <>
          End the active session for <strong>{user.username}</strong>?
          <br /><br />
          They will need to log in again on their next request.
        </>
      ),
      confirmLabel: 'Force Logout',
      cancelLabel: 'Cancel',
      variant: 'danger',
      icon: <FiLogOut />,
    });
  };

  // ---------- Reset password ----------
  const handleResetPassword = (user) => {
    openConfirm({
      action: 'resetPassword',
      payload: user,
      title: 'Reset password?',
      message: (
        <>
          Set <strong>{user.username}</strong>'s password to{' '}
          <strong>P@ssword1</strong>?
          <br /><br />
          They will be signed out immediately and will need this new
          password to log in.
        </>
      ),
      confirmLabel: 'Reset Password',
      cancelLabel: 'Cancel',
      variant: 'warning',
      icon: <FiRefreshCw />,
    });
  };

  // ---------- Modal overlay click ----------
  const handleOverlayClick = (e, closeFn) => {
    if (e.target === e.currentTarget) closeFn();
  };

  // ---------- Early: fetching ----------
  if (fetching) {
    return (
      <div className="loading-container">
        <div className="loading-spinner"></div>
        <p>Loading users...</p>
      </div>
    );
  }

  const canEdit = can('users.edit');
  const canDelete = can('users.delete');
  const showActionsCol = canEdit || canDelete;

  const newIsHandlerUgLumb =
    isHandlerRole(newUser.user_role) &&
    isHandlerWarehouseId(newUser.warehouse_assigned, warehouses);

  const editIsHandlerUgLumb =
    isHandlerRole(editUserData.user_role) &&
    isHandlerWarehouseId(editUserData.warehouse_assigned, warehouses);

  return (
    <div className="users-section">
      <style>{buttonCss}</style>
      <style>{tabUsersCss}</style>

      {/* ============================ HEADER ============================ */}
      <div className="section-header users-section-header">
        <h3 className="users-section-title">User Management</h3>
        <div className="header-actions users-header-actions">
          <div className="user-stats">
            <span className="stat-badge active">Active: {activeCount}</span>
            <span className="stat-badge inactive">Inactive: {inactiveCount}</span>
          </div>
          <button
            type="button"
            className="ui-btn ui-btn-secondary"
            onClick={handleRefreshUsers}
            disabled={refreshing}
            title="Re-fetch the latest user data"
          >
            <FiRefreshCw className={`btn-icon${refreshing ? ' icon-spin' : ''}`} />
            <span>{refreshing ? 'Refreshing…' : 'Refresh'}</span>
          </button>
          {canCreateUsers && (
            <button className="ui-btn ui-btn-primary" onClick={handleAddUser} type="button">
              <FiPlus className="btn-icon" />
              <span>Add User</span>
            </button>
          )}
        </div>
      </div>

      {/* ============================ SEARCH ============================ */}
      <div className="user-search-container">
        <input
          id="user_search"
          type="text"
          className="user-search-input"
          placeholder="Search by ID, Name, Username, Email, Warehouse, Role, or Position..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          autoComplete="off"
        />
        {searchTerm && (
          <span className="search-result-count">
            {filteredUsers.length} result{filteredUsers.length === 1 ? '' : 's'}
          </span>
        )}
      </div>

      {/* ============================ TABLE ============================ */}
      <div className="table-wrapper users-table-wrapper">
        <table className="data-table users-table">
          <thead>
            <tr>
              <th className="user-th-caret" aria-label="Expand row"></th>
              <th className="user-th-user">User</th>
              <th className="user-th-role">Role</th>
              <th className="user-th-status">Status</th>
              {showActionsCol && <th className="user-th-actions" aria-label="Actions"></th>}
            </tr>
          </thead>
          <tbody>
            {filteredUsers.length > 0 ? filteredUsers.map(u => {
              const isExpanded = expandedUserId === u.id;
              const cols = showActionsCol ? 5 : 4;

              const userMenuItems = [
                canEdit && {
                  key: 'edit',
                  label: 'Edit',
                  icon: <FiEdit2 />,
                  onClick: () => handleEditUser(u),
                },
                canDelete && {
                  key: 'resetPassword',
                  label: 'Reset Password',
                  icon: <FiRefreshCw />,
                  onClick: () => handleResetPassword(u),
                  variant: 'warning',
                  dividerBefore: true,
                },
                canDelete && u.is_currently_logged_in === 1 && {
                  key: 'forceLogout',
                  label: 'Force Logout',
                  icon: <FiLogOut />,
                  onClick: () => handleForceLogout(u),
                  variant: 'danger',
                },
                canDelete && (u.status === 'Active'
                  ? {
                      key: 'deactivate',
                      label: 'Deactivate',
                      icon: <FiLock />,
                      onClick: () => handleDeactivateUser(u),
                      variant: 'muted',
                      dividerBefore: true,
                    }
                  : {
                      key: 'activate',
                      label: 'Activate',
                      icon: <FiUnlock />,
                      onClick: () => handleActivateUser(u),
                      variant: 'success',
                      dividerBefore: true,
                    }
                ),
              ].filter(Boolean);

              return (
                <React.Fragment key={u.id}>
                  <tr
                    className={`user-row ${isExpanded ? 'is-expanded' : ''}`}
                    onClick={() => toggleExpand(u.id)}
                    onKeyDown={(e) => handleRowKeyDown(e, u.id)}
                    tabIndex={0}
                    aria-expanded={isExpanded}
                    aria-controls={`user-details-${u.id}`}
                  >
                    <td className="user-row-caret">
                      {isExpanded ? <FiChevronUp /> : <FiChevronDown />}
                    </td>

                    <td className="user-row-user">
                      <div className="user-cell">
                        <UserAvatar
                          userId={u.id}
                          hasImage={u.has_profile_image === 1 || u.has_profile_image === true}
                          firstName={u.first_name}
                          lastName={u.last_name}
                          username={u.username}
                        />
                        <div className="user-name-block">
                          <span className="user-name">
                            {u.first_name} {u.last_name}
                            {u.is_currently_logged_in === 1 && (
                              <span className="user-online-badge" title="This user has an active session">
                                <FiCircle className="online-dot" />
                                <span>ONLINE</span>
                              </span>
                            )}
                          </span>
                          <span className="user-username">@{u.username}</span>
                        </div>
                      </div>
                    </td>

                    <td className="user-row-role">
                      <span className={`user-role-pill user-role-pill--${roleSlug(u.user_role)}`}>
                        {u.user_role}
                      </span>
                    </td>

                    <td className="user-row-status">
                      <span className={`status-badge ${u.status?.toLowerCase()}`}>{u.status}</span>
                    </td>

                    {showActionsCol && (
                      <td className="user-row-actions-hint" aria-hidden="true">
                        <span className="user-row-open-hint">
                          {isExpanded ? 'Close' : 'Details'}
                        </span>
                      </td>
                    )}
                  </tr>

                  {isExpanded && (
                    <tr className="user-expand-row">
                      <td colSpan={cols}>
                        <div className="user-expand-inner" id={`user-details-${u.id}`}>
                          {/* Detail grid */}
                          <div className="user-detail-grid">
                            <div className="user-detail-item">
                              <span className="user-detail-label"><FiUser /> User ID</span>
                              <span className="user-detail-value">
                                <span className="public-id-badge">{u.public_user_id || 'N/A'}</span>
                              </span>
                            </div>

                            <div className="user-detail-item">
                              <span className="user-detail-label"><FiMail /> Email</span>
                              <span className="user-detail-value">{u.email || '—'}</span>
                            </div>

                            <div className="user-detail-item">
                              <span className="user-detail-label"><FiShield /> Employee Position</span>
                              <span className="user-detail-value">
                                {u.emp_position ? (
                                  <>
                                    {u.emp_position}
                                    {u.can_approve_sts ? (
                                      <span className="user-sts-badge" title="Can approve Stock Transfer Slips">
                                        <FiCheckCircle className="sts-badge-icon" />
                                        <span>STS APPROVER</span>
                                      </span>
                                    ) : null}
                                  </>
                                ) : (
                                  <span className="user-detail-value muted">—</span>
                                )}
                              </span>
                            </div>

                            <div className="user-detail-item">
                              <span className="user-detail-label"><FiMapPin /> Warehouse</span>
                              <span className="user-detail-value">
                                {u.warehouse_code ? (
                                  <>
                                    <span className="warehouse-code">{u.warehouse_code}</span>
                                    {u.warehouse_name ? <span className="user-wh-name"> — {u.warehouse_name}</span> : null}
                                  </>
                                ) : (
                                  <span className="user-detail-value muted">Not Assigned</span>
                                )}
                              </span>
                            </div>

                            {/* Show assigned bodegas if any */}
                            {u.assigned_bodegas && u.assigned_bodegas.length > 0 && (
                              <div className="user-detail-item" style={{ gridColumn: '1 / -1' }}>
                                <span className="user-detail-label"><FiMapPin /> Assigned Bodegas</span>
                                <div className="user-detail-chips">
                                  {u.assigned_bodegas.map(code => (
                                    <span key={code} className="user-bodega-pill">{code}</span>
                                  ))}
                                </div>
                              </div>
                            )}

                            <div className="user-detail-item">
                              <span className="user-detail-label"><FiClock /> Last Login</span>
                              <span className="user-detail-value">
                                {fmtDateTime(u.last_login) || <span className="user-detail-value muted">Never</span>}
                              </span>
                            </div>

                            <div className="user-detail-item">
                              <span className="user-detail-label"><FiCalendar /> Created</span>
                              <span className="user-detail-value">
                                {fmtDate(u.created_at) || <span className="user-detail-value muted">—</span>}
                              </span>
                            </div>
                          </div>

                          {/* Actions — kebab menu */}
                          {showActionsCol && userMenuItems.length > 0 && (
                            <div className="user-actions-bar user-actions-bar--kebab">
                              <ActionsMenu
                                items={userMenuItems}
                                ariaLabel={`Actions for ${u.username}`}
                              />
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            }) : (
              <tr>
                <td colSpan={showActionsCol ? 5 : 4} className="users-empty-cell">
                  {searchTerm ? 'No users found matching your search' : 'No users found'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ============================ ADD USER MODAL ============================ */}
      {canCreateUsers && showAddUser && (
        <div
          className="user-modal-overlay"
          onMouseDown={(e) => handleOverlayClick(e, handleCloseUserForm)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-user-title"
        >
          <div className="user-modal">
            <div className="user-modal-header">
              <h4 className="user-modal-title" id="add-user-title">
                <FiPlus className="user-modal-title-icon" />
                <span>Add New User</span>
              </h4>
              <button className="user-modal-close" onClick={handleCloseUserForm} type="button" aria-label="Close">
                <FiX />
              </button>
            </div>

            <div className="user-modal-body">
              <div className="form-group">
                <label htmlFor="new_username">Username *</label>
                <input id="new_username" name="username" type="text" value={newUser.username} onChange={handleNewUserChange} autoComplete="off" />
              </div>

              <div className="form-group">
                <label htmlFor="new_email">Email *</label>
                <input
                  id="new_email"
                  name="email"
                  type="email"
                  value={newUser.email}
                  onChange={handleNewUserChange}
                  autoComplete="off"
                  pattern="[A-Za-z0-9._%+-]+@lepantomining\.com"
                  title="Use your @lepantomining.com email"
                />
                {newUser.email && !isLepantoEmail(newUser.email) && (
                  <small className="error-text">Email must be @lepantomining.com</small>
                )}
              </div>

              <div className="form-group">
                <label htmlFor="new_password">Password *</label>
                <input id="new_password" name="password" type="password" value={newUser.password} onChange={handleNewUserChange} autoComplete="new-password" />
                {newUser.password && passwordErrors.length > 0 && (
                  <div className="password-requirements">
                    <small>Password must contain:</small>
                    <ul>
                      <li className={passwordErrors.includes('Password must be at least 6 characters') ? 'error' : 'valid'}>At least 6 characters</li>
                      <li className={passwordErrors.includes('Password must contain at least 1 uppercase letter') ? 'error' : 'valid'}>At least 1 uppercase letter</li>
                      <li className={passwordErrors.includes('Password must contain at least 1 lowercase letter') ? 'error' : 'valid'}>At least 1 lowercase letter</li>
                      <li className={passwordErrors.includes('Password must contain at least 1 number') ? 'error' : 'valid'}>At least 1 number</li>
                      <li className={passwordErrors.includes('Password must contain at least 1 special character') ? 'error' : 'valid'}>At least 1 special character</li>
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

              {newUser.user_role && (
                <div className="form-group">
                  {isAdminDropdownRole(newUser.user_role) ? (
                    <>
                      <label htmlFor="new_emp_position">Employee Position *</label>
                      <select id="new_emp_position" name="emp_position" value={newUser.emp_position} onChange={handleNewUserChange}>
                        {ADMIN_POSITIONS.map((p) => (<option key={p} value={p}>{p}</option>))}
                      </select>
                      <small>Only Admins with position "Department Head" can approve Stock Transfer Slips.</small>
                    </>
                  ) : newIsHandlerUgLumb ? (
                    <>
                      <label htmlFor="new_emp_position">Employee Position *</label>
                      <select
                        id="new_emp_position"
                        name="emp_position"
                        value={HANDLER_POSITIONS.includes(newUser.emp_position) ? newUser.emp_position : HANDLER_POSITIONS[0]}
                        onChange={handleNewUserChange}
                      >
                        {HANDLER_POSITIONS.map((p) => (<option key={p} value={p}>{p}</option>))}
                      </select>
                      <small>Required for handlers in this warehouse. Surface and underground operations are tracked separately.</small>
                    </>
                  ) : (
                    <>
                      <label>Employee Position</label>
                      <input
                        type="text"
                        value={computeAutoPosition(newUser.user_role, newUser.warehouse_assigned, warehouses)}
                        readOnly
                        disabled
                      />
                      <small>Auto-assigned based on role{isHandlerRole(newUser.user_role) ? ' and warehouse' : ''}.</small>
                    </>
                  )}
                </div>
              )}

              {/* Bodega Assignments — only for UG Handlers */}
              {newIsHandlerUgLumb && newUser.emp_position === 'Underground Handler' && (
                <div className="form-group full">
                  <label>Assigned Bodegas</label>
                  <BodegaMultiSelect
                    value={newUser.assigned_bodegas || []}
                    onChange={(arr) => setNewUser(prev => ({ ...prev, assigned_bodegas: arr }))}
                    locators={locators}
                    loading={locatorsLoading}
                    error={locatorError}
                    onRetry={() => fetchLocators(currentAddWarehouseCode)}
                    disabled={loading}
                  />
                  <small>Leave blank to allow the handler to see all bodegas in the warehouse.</small>
                </div>
              )}

              {/* STS Backup Approver Checkbox */}
              {newUser.user_role === 'Admin' && (
                <div className="checkbox-container">
                  <input
                    type="checkbox"
                    id="new_can_approve_sts"
                    checked={newUser.can_approve_sts || newUser.emp_position === 'Department Head'}
                    disabled={newUser.emp_position === 'Department Head'}
                    onChange={(e) => setNewUser(prev => ({ ...prev, can_approve_sts: e.target.checked }))}
                  />
                  <label htmlFor="new_can_approve_sts">
                    Enable STS Approval Rights (Backup for Dept Head)
                  </label>
                </div>
              )}

              <div className="form-group">
                <label htmlFor="new_status">Status</label>
                <select id="new_status" name="status" value={newUser.status} onChange={handleNewUserChange}>
                  <option value="Active">Active</option>
                  <option value="Inactive">Inactive</option>
                </select>
              </div>
            </div>

            <div className="user-modal-footer">
              <button className="ui-btn ui-btn-secondary" onClick={handleCloseUserForm} disabled={loading} type="button">
                <FiX className="btn-icon" />
                <span>Cancel</span>
              </button>
              <button className="ui-btn ui-btn-primary" onClick={handleSaveUser} disabled={loading} type="button">
                {loading ? <FiLoader className="btn-icon icon-spin" /> : <FiSave className="btn-icon" />}
                <span>{loading ? 'Saving...' : 'Save User'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================ EDIT USER MODAL ============================ */}
      {can('users.edit') && showEditUser && (
        <div
          className="user-modal-overlay"
          onMouseDown={(e) => handleOverlayClick(e, handleCloseEditUser)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-user-title"
        >
          <div className="user-modal">
            <div className="user-modal-header">
              <h4 className="user-modal-title" id="edit-user-title">
                <FiEdit2 className="user-modal-title-icon" />
                <span>Edit User — {editUserData.public_user_id}</span>
              </h4>
              <button className="user-modal-close" onClick={handleCloseEditUser} type="button" aria-label="Close">
                <FiX />
              </button>
            </div>

            <div className="user-modal-body">
              <div className="form-group">
                <label>Public User ID</label>
                <input type="text" value={editUserData.public_user_id} disabled />
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

              {editUserData.user_role && (
                <div className="form-group">
                  {isAdminDropdownRole(editUserData.user_role) ? (
                    <>
                      <label htmlFor="edit_emp_position">Employee Position *</label>
                      <select id="edit_emp_position" name="emp_position" value={editUserData.emp_position} onChange={handleEditUserChange}>
                        {ADMIN_POSITIONS.map((p) => (<option key={p} value={p}>{p}</option>))}
                      </select>
                      <small>Only Admins with position "Department Head" can approve Stock Transfer Slips.</small>
                    </>
                  ) : editIsHandlerUgLumb ? (
                    <>
                      <label htmlFor="edit_emp_position">Employee Position *</label>
                      <select
                        id="edit_emp_position"
                        name="emp_position"
                        value={HANDLER_POSITIONS.includes(editUserData.emp_position) ? editUserData.emp_position : HANDLER_POSITIONS[0]}
                        onChange={handleEditUserChange}
                      >
                        {HANDLER_POSITIONS.map((p) => (<option key={p} value={p}>{p}</option>))}
                      </select>
                      <small>Required for handlers in this warehouse. Surface and underground operations are tracked separately.</small>
                    </>
                  ) : (
                    <>
                      <label>Employee Position</label>
                      <input
                        type="text"
                        value={computeAutoPosition(editUserData.user_role, editUserData.warehouse_assigned, warehouses)}
                        readOnly
                        disabled
                      />
                      <small>Auto-assigned based on role{isHandlerRole(editUserData.user_role) ? ' and warehouse' : ''}.</small>
                    </>
                  )}
                </div>
              )}

              {/* Bodega Assignments — only for UG Handlers */}
              {editIsHandlerUgLumb && editUserData.emp_position === 'Underground Handler' && (
                <div className="form-group full">
                  <label>Assigned Bodegas</label>
                  <BodegaMultiSelect
                    value={editUserData.assigned_bodegas || []}
                    onChange={(arr) => setEditUserData(prev => ({ ...prev, assigned_bodegas: arr }))}
                    locators={locators}
                    loading={locatorsLoading}
                    error={locatorError}
                    onRetry={() => fetchLocators(currentEditWarehouseCode)}
                    disabled={loading}
                  />
                  <small>Leave blank to allow the handler to see all bodegas in the warehouse.</small>
                </div>
              )}

              {/* STS Backup Approver Checkbox */}
              {editUserData.user_role === 'Admin' && (
                <div className="checkbox-container">
                  <input
                    type="checkbox"
                    id="edit_can_approve_sts"
                    checked={editUserData.can_approve_sts || editUserData.emp_position === 'Department Head'}
                    disabled={editUserData.emp_position === 'Department Head'}
                    onChange={(e) => setEditUserData(prev => ({ ...prev, can_approve_sts: e.target.checked }))}
                  />
                  <label htmlFor="edit_can_approve_sts">
                    Enable STS Approval Rights (Backup for Dept Head)
                  </label>
                </div>
              )}

              <div className="form-group">
                <label htmlFor="edit_email">Email *</label>
                <input
                  id="edit_email"
                  name="email"
                  type="email"
                  value={editUserData.email}
                  onChange={handleEditUserChange}
                  autoComplete="off"
                  pattern="[A-Za-z0-9._%+-]+@lepantomining\.com"
                  title="Use your @lepantomining.com email"
                />
                {editUserData.email && !isLepantoEmail(editUserData.email) && (
                  <small className="error-text">Email must be @lepantomining.com</small>
                )}
              </div>

              <div className="form-group">
                <label htmlFor="edit_status">Status</label>
                <select id="edit_status" name="status" value={editUserData.status} onChange={handleEditUserChange}>
                  <option value="Active">Active</option>
                  <option value="Inactive">Inactive</option>
                </select>
              </div>

              <div className="form-group full">
                <label className="pw-section-label">
                  <FiKey className="label-key-icon" />
                  <span>Change Password (optional)</span>
                </label>
                <small>Leave blank to keep the current password.</small>
              </div>

              <div className="form-group">
                <label htmlFor="edit_new_password">New Password</label>
                <input id="edit_new_password" name="newPassword" type="password" value={editUserData.newPassword} onChange={handleEditUserChange} autoComplete="new-password" />
                {editUserData.newPassword && editPasswordErrors.length > 0 && (
                  <div className="password-requirements">
                    <small>Password must contain:</small>
                    <ul>
                      {editPasswordErrors.map(e => (
                        <li key={e} className="error">
                          {e.replace('Password must contain ', '').replace('Password must be ', '')}
                        </li>
                      ))}
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

            <div className="user-modal-footer">
              <button className="ui-btn ui-btn-secondary" onClick={handleCloseEditUser} disabled={loading} type="button">
                <FiX className="btn-icon" />
                <span>Cancel</span>
              </button>
              <button className="ui-btn ui-btn-primary" onClick={handleUpdateUser} disabled={loading} type="button">
                {loading ? <FiLoader className="btn-icon icon-spin" /> : <FiSave className="btn-icon" />}
                <span>{loading ? 'Updating...' : 'Update User'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================ CONFIRM MODAL ============================ */}
      <ConfirmModal
        isOpen={confirm.open}
        isLoading={confirm.isLoading}
        title={confirm.title}
        message={confirm.message}
        confirmLabel={confirm.confirmLabel}
        cancelLabel={confirm.cancelLabel}
        variant={confirm.variant}
        icon={confirm.icon}
        onConfirm={runConfirmAction}
        onCancel={closeConfirm}
      />
    </div>
  );
};

export default TabUsers;

// ============================================================
// Component-scoped CSS
// Prefixes: user-, users-, sts-approval-, pw-section-, public-id-, warehouse-code
// ============================================================
const tabUsersCss = `
/* -------- Section header / search -------- */
.users-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}
.users-section-title {
  margin: 0;
  font-size: 20px;
  font-weight: 800;
  color: #0f172a;
  letter-spacing: -0.01em;
}
.users-header-actions {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
}
.user-stats {
  display: inline-flex;
  gap: 8px;
  flex-wrap: wrap;
}
.stat-badge {
  display: inline-flex;
  align-items: center;
  padding: 5px 11px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.02em;
  white-space: nowrap;
}
.stat-badge.active {
  background: #dcfce7;
  color: #166534;
  border: 1px solid #86efac;
}
.stat-badge.inactive {
  background: #fee2e2;
  color: #991b1b;
  border: 1px solid #fca5a5;
}

.user-search-container {
  position: relative;
  margin: 16px 0;
}
.user-search-input {
  width: 100%;
  padding: 12px 16px;
  border-radius: 10px;
  border: 1.5px solid #cbd5e1;
  background: #ffffff;
  font-size: 14.5px;
  font-family: inherit;
  color: #0f172a;
  transition: border-color 0.15s ease-out, box-shadow 0.15s ease-out;
  min-height: 48px;
  box-sizing: border-box;
}
.user-search-input:focus {
  outline: none;
  border-color: #00d2c8;
  box-shadow: 0 0 0 3px rgba(0, 210, 200, 0.18);
}
.user-search-input::placeholder {
  color: #64748b;
  font-weight: 500;
  opacity: 1;
}
.search-result-count {
  position: absolute;
  right: 14px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 12px;
  font-weight: 700;
  color: #475569;
  background: #f1f5f9;
  padding: 3px 9px;
  border-radius: 999px;
  pointer-events: none;
}

/* -------- Table shell -------- */
.users-table-wrapper {
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  border-radius: 12px;
  border: 1px solid #e2e8f0;
  background: #ffffff;
}
.users-table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  font-size: 14px;
  table-layout: auto;
}
.users-table thead th {
  text-align: left;
  padding: 12px 16px;
  font-size: 11.5px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #475569;
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
  white-space: nowrap;
}
.users-table tbody td {
  padding: 14px 16px;
  border-bottom: 1px solid #f1f5f9;
  vertical-align: middle;
}
.user-th-caret,
.user-row-caret {
  width: 42px;
  text-align: center;
  color: #94a3b8;
}
.user-th-caret { padding-left: 8px !important; padding-right: 8px !important; }
.user-th-actions { width: 90px; }

.users-empty-cell {
  text-align: center;
  padding: 34px 16px !important;
  color: #64748b;
  font-style: italic;
}

/* -------- Rows -------- */
.user-row {
  cursor: pointer;
  transition: background-color 0.15s ease-out;
  outline: none;
}
.user-row:hover { background-color: #f8fafc; }
.user-row:focus-visible {
  background-color: #f0fdfa;
  box-shadow: inset 0 0 0 2px #00d2c8;
}
.user-row.is-expanded {
  background-color: #f0fdfa;
}
.user-row.is-expanded td:first-child {
  box-shadow: inset 3px 0 0 #00b8b0;
}
.user-row.is-expanded td {
  border-bottom-color: transparent;
}
.user-row-caret svg {
  width: 18px;
  height: 18px;
  stroke-width: 2.4;
  transition: color 0.15s ease-out;
}
.user-row.is-expanded .user-row-caret { color: #00b8b0; }

.user-row-actions-hint {
  text-align: right;
  white-space: nowrap;
}
.user-row-open-hint {
  font-size: 11.5px;
  font-weight: 700;
  color: #94a3b8;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  transition: color 0.15s ease-out;
}
.user-row:hover .user-row-open-hint,
.user-row.is-expanded .user-row-open-hint {
  color: #00b8b0;
}

/* -------- User cell -------- */
.user-cell {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

/* -------- Avatar -------- */
.user-avatar {
  position: relative;
  width: 38px;
  height: 38px;
  border-radius: 50%;
  background: linear-gradient(135deg, #00d2c8, #00b8b0);
  color: #ffffff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: 800;
  font-size: 13px;
  letter-spacing: 0.02em;
  flex-shrink: 0;
  box-shadow: 0 2px 6px rgba(0, 184, 176, 0.25);
  overflow: hidden;
  border: 1px solid rgba(0, 184, 176, 0.25);
}
.user-avatar-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 50%;
  display: block;
}

.user-name-block {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 2px;
}
.user-name {
  font-weight: 700;
  color: #0f172a;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 14px;
}
.user-username {
  font-size: 12.5px;
  color: #64748b;
  font-weight: 500;
}

/* -------- Role pill -------- */
.user-role-pill {
  display: inline-flex;
  align-items: center;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 10.5px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  white-space: nowrap;
}
.user-role-pill--super-admin {
  background: #ede9fe; color: #6d28d9; border: 1px solid #c4b5fd;
}
.user-role-pill--admin {
  background: #ccfbf1; color: #0f766e; border: 1px solid #5eead4;
}
.user-role-pill--stock-registrar {
  background: #e0e7ff; color: #4338ca; border: 1px solid #a5b4fc;
}
.user-role-pill--stock-handler {
  background: #ffedd5; color: #c2410c; border: 1px solid #fdba74;
}
.user-role-pill--default {
  background: #f1f5f9; color: #475569; border: 1px solid #cbd5e1;
}

/* -------- Status badge -------- */
.users-table .status-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 10.5px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  white-space: nowrap;
}
.users-table .status-badge.active {
  background: #dcfce7; color: #166534; border: 1px solid #86efac;
}
.users-table .status-badge.inactive {
  background: #fee2e2; color: #991b1b; border: 1px solid #fca5a5;
}

/* -------- ONLINE + STS badges -------- */
.user-online-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 9.5px;
  font-weight: 800;
  background: #dcfce7;
  color: #065f46;
  border: 1px solid #86efac;
  white-space: nowrap;
  letter-spacing: 0.04em;
}
.online-dot {
  width: 8px;
  height: 8px;
  color: #16a34a;
  fill: #16a34a;
  stroke: #16a34a;
}
.online-dot svg, .online-dot { fill: currentColor; }

.user-sts-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 9.5px;
  font-weight: 800;
  background: #dcfce7;
  color: #065f46;
  border: 1px solid #86efac;
  white-space: nowrap;
  margin-left: 8px;
  letter-spacing: 0.04em;
}
.sts-badge-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1em;
  height: 1em;
}
.sts-badge-icon svg { width: 100%; height: 100%; stroke-width: 2.5; }

/* -------- Expanded panel -------- */
.user-expand-row > td {
  padding: 0 !important;
  border-bottom: 1px solid #e2e8f0 !important;
  background: #f8fafc;
}
.user-expand-inner {
  padding: 20px 22px 22px;
  display: flex;
  flex-direction: column;
  gap: 18px;
  border-left: 3px solid #00b8b0;
  animation: userExpandFade 0.2s ease-out;
}
@keyframes userExpandFade {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: translateY(0); }
}

.user-detail-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 16px 24px;
}
.user-detail-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.user-detail-label {
  font-size: 10.5px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #94a3b8;
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.user-detail-label svg {
  width: 12px;
  height: 12px;
  stroke-width: 2.4;
}
.user-detail-value {
  font-size: 14px;
  font-weight: 600;
  color: #1e293b;
  word-break: break-word;
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
}
.user-detail-value.muted {
  color: #94a3b8;
  font-weight: 500;
}
.user-wh-name {
  color: #64748b;
  font-weight: 500;
  font-size: 13px;
}
.public-id-badge {
  display: inline-flex;
  align-items: center;
  padding: 3px 9px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 800;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  background: #f1f5f9;
  color: #334155;
  border: 1px solid #cbd5e1;
  letter-spacing: 0.02em;
}
.warehouse-code {
  display: inline-flex;
  align-items: center;
  padding: 3px 9px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 800;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  background: #e0f2fe;
  color: #075985;
  border: 1px solid #7dd3fc;
  letter-spacing: 0.02em;
}

/* -------- Bodega Chips (Read-only details) -------- */
.user-detail-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 4px;
}
.user-bodega-pill {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11.5px;
  font-weight: 700;
  background: #e0f2fe;
  color: #0369a1;
  border: 1px solid #7dd3fc;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
}

/* -------- Actions bar (kebab) -------- */
.user-actions-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding-top: 16px;
  border-top: 1px solid #e2e8f0;
}
.user-actions-bar--kebab {
  justify-content: flex-end;
  align-items: center;
}

/* -------- Modals -------- */
.user-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 1100;
  background: rgba(15, 23, 42, 0.55);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 40px 20px;
  overflow-y: auto;
  animation: userModalFadeIn 0.18s ease-out;
}
@keyframes userModalFadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}
.user-modal {
  background: #ffffff;
  border-radius: 16px;
  box-shadow: 0 24px 60px rgba(15, 23, 42, 0.28);
  width: 100%;
  max-width: 780px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: userModalSlideUp 0.22s cubic-bezier(0.16, 1, 0.3, 1);
  margin: auto 0;
}
@keyframes userModalSlideUp {
  from { opacity: 0; transform: translateY(12px) scale(0.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

.user-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 18px 22px;
  border-bottom: 1px solid #e2e8f0;
  background: #f8fafc;
  flex-shrink: 0;
}
.user-modal-title {
  font-size: 17px;
  font-weight: 800;
  color: #0f172a;
  margin: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  letter-spacing: -0.01em;
}
.user-modal-title-icon {
  width: 18px;
  height: 18px;
  color: #00b8b0;
  flex-shrink: 0;
}
.user-modal-close {
  width: 34px;
  height: 34px;
  border-radius: 8px;
  border: none;
  background: transparent;
  color: #475569;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s ease-out, color 0.15s ease-out;
}
.user-modal-close:hover {
  background: #e2e8f0;
  color: #0f172a;
}
.user-modal-close svg { width: 18px; height: 18px; }

.user-modal-body {
  padding: 22px;
  overflow-y: auto;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 18px 20px;
  flex: 1;
}
.user-modal-body .form-group.full { grid-column: 1 / -1; }

.user-modal-body .form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.user-modal-body .form-group label {
  font-size: 11.5px;
  font-weight: 800;
  color: #334155;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.user-modal-body .form-group input,
.user-modal-body .form-group select {
  width: 100%;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1.5px solid #cbd5e1;
  background: #ffffff;
  font-size: 14px;
  font-family: inherit;
  color: #0f172a;
  transition: border-color 0.15s ease-out, box-shadow 0.15s ease-out;
  min-height: 44px;
  box-sizing: border-box;
}
.user-modal-body .form-group input:focus,
.user-modal-body .form-group select:focus {
  outline: none;
  border-color: #00d2c8;
  box-shadow: 0 0 0 3px rgba(0, 210, 200, 0.18);
}
.user-modal-body .form-group input:disabled {
  background: #f1f5f9;
  cursor: not-allowed;
  color: #64748b;
}
.user-modal-body .form-group input::placeholder {
  color: #94a3b8;
  font-weight: 500;
  opacity: 1;
}
.user-modal-body .form-group small {
  font-size: 11.5px;
  color: #64748b;
  font-weight: 500;
  line-height: 1.4;
}
.user-modal-body .error-text {
  color: #dc2626;
  font-weight: 700;
}

.pw-section-label {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: #00b8b0 !important;
  font-size: 12px !important;
}
.label-key-icon {
  width: 14px;
  height: 14px;
}

/* Password requirements box */
.password-requirements {
  margin-top: 6px;
  padding: 10px 12px;
  background: #fef9c3;
  border: 1px solid #fde68a;
  border-radius: 8px;
  font-size: 11.5px;
}
.password-requirements small {
  font-weight: 800;
  color: #854d0e;
  display: block;
  margin-bottom: 4px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.password-requirements ul {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.password-requirements li {
  position: relative;
  padding-left: 16px;
  font-size: 11.5px;
  line-height: 1.4;
  font-weight: 600;
}
.password-requirements li::before {
  position: absolute;
  left: 0;
  top: 0;
  font-weight: 800;
}
.password-requirements li.valid { color: #16a34a; }
.password-requirements li.valid::before { content: '✓'; color: #16a34a; }
.password-requirements li.error { color: #dc2626; }
.password-requirements li.error::before { content: '✕'; color: #dc2626; }

/* Checkbox container for STS Approval */
.checkbox-container {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  margin-top: 4px;
}
.checkbox-container input[type="checkbox"] {
  width: 18px;
  height: 18px;
  cursor: pointer;
  accent-color: #00b8b0;
  flex-shrink: 0;
}
.checkbox-container input[type="checkbox"]:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}
.checkbox-container label {
  font-size: 14px;
  font-weight: 600;
  color: #334155;
  cursor: pointer;
  text-transform: none;
  letter-spacing: 0;
  margin: 0;
}
.checkbox-container label:has(input:disabled) {
  cursor: not-allowed;
}

.user-modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 16px 22px;
  border-top: 1px solid #e2e8f0;
  background: #f8fafc;
  flex-shrink: 0;
  flex-wrap: wrap;
}

/* -------- Bodega Multi-Select (Interactive) -------- */
.user-bodega-multi {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.user-bodega-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 8px;
  min-height: 44px;
  background: #f1f5f9;
  border: 1.5px solid #cbd5e1;
  border-radius: 8px;
}
.user-bodega-empty {
  font-size: 13px;
  color: #94a3b8;
  padding: 4px;
}
.user-bodega-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px 4px 10px;
  border-radius: 999px;
  background: #e0f2fe;
  border: 1px solid #7dd3fc;
  font-size: 12px;
  color: #0369a1;
}
.user-bodega-chip-icon {
  width: 12px;
  height: 12px;
}
.user-bodega-chip-code {
  font-family: 'JetBrains Mono', monospace;
  font-weight: 700;
}
.user-bodega-chip-name {
  font-size: 11px;
  color: #0284c7;
}
.user-bodega-chip-remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border: none;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.05);
  color: #0369a1;
  cursor: pointer;
  transition: background 0.15s;
}
.user-bodega-chip-remove:hover {
  background: #dc2626;
  color: #fff;
}
.user-bodega-add {
  position: relative;
}
.user-bodega-add-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  background: #fff;
  border: 1.5px dashed #cbd5e1;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  color: #475569;
  cursor: pointer;
  transition: all 0.15s;
}
.user-bodega-add-btn:hover {
  background: #f8fafc;
  border-color: #00b8b0;
  color: #00b8b0;
}
.user-bodega-caret {
  transition: transform 0.2s;
}
.user-bodega-caret.is-open {
  transform: rotate(180deg);
}
.user-bodega-panel {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  margin-top: 4px;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  box-shadow: 0 10px 25px -5px rgba(0,0,0,0.1);
  max-height: 200px;
  overflow-y: auto;
  z-index: 50;
  padding: 4px;
}
.user-bodega-panel-msg {
  padding: 12px;
  font-size: 13px;
  color: #64748b;
  text-align: center;
}
.user-bodega-option {
  display: flex;
  flex-direction: column;
  padding: 8px 12px;
  background: transparent;
  border: none;
  border-radius: 6px;
  text-align: left;
  cursor: pointer;
}
.user-bodega-option:hover {
  background: #f0fdfa;
}
.user-bodega-option-code {
  font-family: 'JetBrains Mono', monospace;
  font-size: 13px;
  font-weight: 700;
  color: #0f766e;
}
.user-bodega-option-name {
  font-size: 11px;
  color: #64748b;
}

/* -------- Bodega fetch-error state (NEW) -------- */
.user-bodega-error {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 12.5px;
  font-weight: 600;
  color: #b91c1c;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 6px;
  padding: 4px 10px;
  line-height: 1.4;
  max-width: 100%;
}
.user-bodega-panel-error {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 10px 12px;
  font-size: 12.5px;
  font-weight: 600;
  color: #b91c1c;
  background: #fef2f2;
  border-radius: 6px;
  line-height: 1.4;
}
.user-bodega-retry {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 26px;
  padding: 3px 10px;
  border: 1px solid #b91c1c;
  background: transparent;
  color: #b91c1c;
  border-radius: 6px;
  font-family: inherit;
  font-size: 11.5px;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}
.user-bodega-retry:hover:not(:disabled) {
  background: #b91c1c;
  color: #ffffff;
}
.user-bodega-retry:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* -------- Icons -------- */
.btn-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 1em;
  height: 1em;
  line-height: 1;
}
.btn-icon svg { width: 100%; height: 100%; stroke-width: 2.4; }

.icon-spin { animation: tabUserSpin 0.9s linear infinite; }
@keyframes tabUserSpin { to { transform: rotate(360deg); } }

/* ============================================================
   Responsive ladder: 1024 / 900 / 768 / 640 / 480 / 380
   ============================================================ */

@media (max-width: 1024px) {
  .users-section-title { font-size: 18px; }
  .users-table thead th { padding: 10px 12px; }
  .users-table tbody td { padding: 12px 12px; }
  .user-detail-grid { gap: 14px 18px; }
}

@media (max-width: 900px) {
  .user-modal { max-width: 100%; }
  .user-modal-body { grid-template-columns: 1fr; padding: 18px; gap: 14px; }
  .checkbox-container { grid-column: auto; }
}

@media (max-width: 768px) {
  .users-section-header {
    flex-direction: column;
    align-items: stretch;
    gap: 12px;
  }
  .users-header-actions {
    justify-content: space-between;
    gap: 10px;
  }
  .users-header-actions .ui-btn { flex: 0 1 auto; }
  .users-table .status-badge { font-size: 10px; padding: 3px 8px; }
  .user-role-pill { font-size: 10px; padding: 3px 8px; }
  .user-avatar { width: 34px; height: 34px; font-size: 12px; }
  .user-name { font-size: 13.5px; }
  .user-username { font-size: 12px; }
  .user-row-actions-hint { display: none; }
}

@media (max-width: 640px) {
  .user-search-input {
    font-size: 14px;
    padding: 10px 12px;
  }
  .search-result-count {
    position: static;
    transform: none;
    display: inline-block;
    margin-top: 8px;
    font-size: 11.5px;
  }
  .user-search-container {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
  }

  .user-modal-overlay { padding: 16px 12px; }
  .user-modal-header { padding: 14px 16px; }
  .user-modal-body { padding: 16px 14px; gap: 12px; }
  .user-modal-footer { padding: 12px 16px; }
  .user-modal-footer .ui-btn { flex: 1 1 auto; justify-content: center; }

  .user-actions-bar--kebab { justify-content: flex-end; }

  .user-expand-inner { padding: 16px 14px 18px; gap: 14px; }
  .user-detail-grid { grid-template-columns: 1fr; gap: 12px; }

  .user-th-role, .user-row-role { display: none; }
}

@media (max-width: 480px) {
  .users-table thead th { padding: 10px 10px; font-size: 10.5px; }
  .users-table tbody td { padding: 10px 10px; }
  .user-th-caret, .user-row-caret { width: 32px; }
  .user-avatar { width: 32px; height: 32px; font-size: 11.5px; }
  .user-name { font-size: 13px; }
  .user-username { font-size: 11.5px; }
  .user-online-badge { font-size: 9px; padding: 2px 6px; }
  .user-detail-value { font-size: 13px; }
  .user-detail-label { font-size: 10px; }

  /* Make the bodega picker full width on mobile */
  .user-bodega-add-btn { width: 100%; justify-content: center; }

  /* Error chip and panel stay readable at this width */
  .user-bodega-error,
  .user-bodega-panel-error {
    font-size: 12px;
    padding: 6px 8px;
  }
  .user-bodega-retry {
    min-height: 30px;
    font-size: 11.5px;
    padding: 4px 10px;
  }
}

@media (max-width: 380px) {
  .users-section-title { font-size: 16px; }
  .user-name-block { max-width: 130px; }
  .user-name { font-size: 12.5px; }
  .user-username { font-size: 11px; }
  .stat-badge { font-size: 10.5px; padding: 3px 8px; }
  .user-sts-badge { margin-left: 0; margin-top: 2px; }
  .users-header-actions { flex-direction: column; align-items: stretch; }
  .users-header-actions .ui-btn { width: 100%; justify-content: center; }

  .user-bodega-chip-name { display: none; } /* Hide names on very small screens to save space */

  .user-bodega-error,
  .user-bodega-panel-error {
    font-size: 11.5px;
    gap: 6px;
  }
  .user-bodega-retry {
    width: 100%;
    justify-content: center;
  }
}

/* Ultra-wide */
@media (min-width: 1921px) {
  .users-section-title { font-size: 22px; }
  .user-name { font-size: 15px; }
  .user-username { font-size: 13px; }
  .user-bodega-error,
  .user-bodega-panel-error { font-size: 13px; }
  .user-bodega-retry { font-size: 12.5px; min-height: 28px; padding: 4px 12px; }
}

/* Reduced-motion */
@media (prefers-reduced-motion: reduce) {
  .icon-spin,
  .user-modal-overlay,
  .user-modal,
  .user-expand-inner,
  .user-bodega-caret,
  .user-bodega-add-btn,
  .user-bodega-chip-remove,
  .user-bodega-option,
  .user-bodega-retry {
    animation: none !important;
    transition: none !important;
  }
}
`;