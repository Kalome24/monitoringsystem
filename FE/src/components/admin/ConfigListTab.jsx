// src/components/admin/ConfigListTab.jsx
import React, { useEffect, useState } from 'react';
import {
  FiPlus, FiTrash2, FiEdit2, FiCheck, FiX, FiLoader, FiInfo,
  FiChevronLeft, FiChevronRight, FiChevronsLeft, FiChevronsRight,
} from 'react-icons/fi';
import { offlineConfigApi } from '../../services/api';
import { useToast } from '../shared/ToastProvider';
import { usePermissions } from '../../permissions/usePermissions'; // <-- ADDED

const NUMERIC_CATEGORIES = ['ACTIVITY_CC', 'LEVEL', 'LHD_NO'];

const ConfigListTab = ({
  category,
  label,
  configs,
  onRefresh,
  readOnly = false,
  page = 1,
  totalPages = 1,
  totalCount = 0,
  onPageChange,
}) => {
  const toast = useToast();
  const { can } = usePermissions(); // <-- ADDED
  
  const [newValue, setNewValue] = useState('');
  const [newDescription, setNewDescription] = useState('');

  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [editDescription, setEditDescription] = useState('');

  const isNumeric = NUMERIC_CATEGORIES.includes(category);
  
  // Check if user has permissions to manage this specific master data
  let canManageMaster = true;
  if (category === 'ACTIVITY_CC') {
    canManageMaster = can('costcenter.create') || can('costcenter.edit');
  } else if (category === 'LHD_NO') {
    canManageMaster = can('equipmentmasters.create') || can('equipmentmasters.edit');
  }

  // Locked if parent says readOnly, OR if user is a Handler lacking master data permissions
  const isLocked = readOnly || !canManageMaster;
  const isMasterDataCategory = category === 'ACTIVITY_CC' || category === 'LHD_NO';

  // Clear edit state whenever the underlying list changes (page nav, refresh, search)
  useEffect(() => {
    setEditingId(null);
    setEditValue('');
    setEditDescription('');
  }, [configs]);

  /* ---------- CRUD handlers ---------- */
  const handleAdd = async (e) => {
    e.preventDefault();
    if (isLocked) return;
    if (!newValue.trim()) return;

    if (isNumeric && isNaN(Number(newValue))) {
      toast.error('This field only accepts numbers.');
      return;
    }

    setSaving(true);
    try {
      const res = await offlineConfigApi.createItem({
        category,
        item_value: newValue.trim(),
        description: newDescription.trim() || null,
      });
      if (res.ok) {
        toast.success(`${label} added.`);
        setNewValue('');
        setNewDescription('');
        onRefresh?.();
      } else {
        toast.error(res.data?.message || 'Failed to add.');
      }
    } catch {
      toast.error('Network error.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (isLocked) return;
    if (!window.confirm(`Remove this option from ${label}?`)) return;
    try {
      const res = await offlineConfigApi.deleteItem(id);
      if (res.ok) {
        toast.success('Option removed.');
        onRefresh?.();
      } else {
        toast.error(res.data?.message || 'Failed to remove.');
      }
    } catch {
      toast.error('Network error.');
    }
  };

  const startEdit = (item) => {
    if (isLocked) return;
    setEditingId(item.config_id);
    setEditValue(item.item_value);
    setEditDescription(item.description || '');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditValue('');
    setEditDescription('');
  };

  const saveEdit = async (item) => {
    if (isLocked) return;
    if (!editValue.trim()) return;

    if (isNumeric && isNaN(Number(editValue))) {
      toast.error('This field only accepts numbers.');
      return;
    }

    try {
      const res = await offlineConfigApi.updateItem(item.config_id, {
        item_value: editValue.trim(),
        description: editDescription.trim() || null,
        is_active: item.is_active,
        category,
      });
      if (res.ok) {
        toast.success('Updated successfully.');
        setEditingId(null);
        onRefresh?.();
      } else {
        toast.error(res.data?.message || 'Failed to update.');
      }
    } catch {
      toast.error('Network error.');
    }
  };

  /* ---------- Pagination helpers ---------- */
  const pageSize = configs.length === 0 ? 0 : Math.ceil(totalCount / totalPages);
  const showingStart = totalCount === 0 ? 0 : (page - 1) * (pageSize || 0) + 1;
  const showingEnd = totalCount === 0 ? 0 : Math.min(page * (pageSize || 0), totalCount);

  const goTo = (target) => {
    if (!onPageChange) return;
    const next = Math.max(1, Math.min(totalPages, target));
    if (next !== page) onPageChange(next);
  };

  /* ---------- Render ---------- */
  const headerTitle = isLocked ? label : `Manage ${label}`;
  
  let subtitle = '';
  if (isMasterDataCategory && isLocked) {
    subtitle = `Read-only view. These options are securely managed by the Admin in the ${category === 'ACTIVITY_CC' ? 'Cost Center' : 'Equipment Master'} tab.`;
  } else if (readOnly) {
    subtitle = `These options are currently available in the "${label}" dropdown of the offline forms.`;
  } else {
    subtitle = `These options will appear in the corresponding dropdown fields for the offline forms.`;
  }

  return (
    <div className="clt-root">
      <style>{css}</style>

      {/* Header */}
      <div className="clt-header">
        <h3 className="clt-title">{headerTitle}</h3>
        <p className="clt-sub">{subtitle}</p>
        
        {isNumeric && !isLocked && (
          <div className="clt-alert">
            <FiInfo /> <span>This configuration strictly accepts <strong>numbers only</strong> for the value.</span>
          </div>
        )}
        
        {isLocked && (
          <div className="clt-alert clt-alert--readonly">
            <FiInfo /> 
            <span>
              {isMasterDataCategory 
                ? `Read-only. Please use the dedicated ${category === 'ACTIVITY_CC' ? 'Cost Center' : 'Equipment Master'} tab to make changes.`
                : 'Read-only — changes are managed by the surface admin.'}
            </span>
          </div>
        )}
        
        {totalCount > 0 && (
          <div className="clt-count">
            <strong>{totalCount.toLocaleString()}</strong>{' '}
            {totalCount === 1 ? 'option' : 'options'} total
          </div>
        )}
      </div>

      {/* Add form (surface only & not locked) */}
      {!isLocked && (
        <form className="clt-add-form" onSubmit={handleAdd}>
          <input
            type={isNumeric ? 'number' : 'text'}
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            placeholder={`Add new ${String(label || '').toLowerCase()} option...`}
            className="clt-input"
            disabled={saving}
            maxLength={100}
            style={{ flex: '1 1 140px' }}
          />
          <input
            type="text"
            value={newDescription}
            onChange={(e) => setNewDescription(e.target.value)}
            placeholder="Description (Optional)..."
            className="clt-input"
            disabled={saving}
            maxLength={100}
            style={{ flex: '1 1 140px' }}
          />
          <button type="submit" className="clt-btn clt-btn--primary" disabled={!newValue.trim() || saving}>
            {saving ? <FiLoader className="clt-spin" /> : <FiPlus />} Add Option
          </button>
        </form>
      )}

      {/* List */}
      <div className="clt-list">
        {configs.length === 0 ? (
          <div className="clt-empty">
            {readOnly || isMasterDataCategory
              ? 'No options have been received from the surface yet. Use "Receive Update" above to apply the configuration.'
              : 'No options match the current filter. Add one above, or clear your search to see all.'}
          </div>
        ) : (
          configs.map((item) => (
            <div key={item.config_id} className="clt-item">
              {!isLocked && editingId === item.config_id ? (
                <div className="clt-edit-row">
                  <input
                    type={isNumeric ? 'number' : 'text'}
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    className="clt-input clt-input--sm"
                    autoFocus
                    style={{ flex: '1 1 120px' }}
                  />
                  <input
                    type="text"
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    className="clt-input clt-input--sm"
                    placeholder="Description"
                    style={{ flex: '1 1 120px' }}
                  />
                  <button type="button" className="clt-icon-btn clt-icon-btn--success" onClick={() => saveEdit(item)} title="Save">
                    <FiCheck />
                  </button>
                  <button type="button" className="clt-icon-btn" onClick={cancelEdit} title="Cancel">
                    <FiX />
                  </button>
                </div>
              ) : (
                <>
                  <div className="clt-item-info">
                    <span className="clt-value">{item.item_value}</span>
                    {item.description && (
                      <span className="clt-desc">{item.description}</span>
                    )}
                  </div>
                  {!isLocked && (
                    <div className="clt-actions">
                      <button type="button" className="clt-icon-btn" onClick={() => startEdit(item)} title="Edit">
                        <FiEdit2 />
                      </button>
                      <button type="button" className="clt-icon-btn clt-icon-btn--danger" onClick={() => handleDelete(item.config_id)} title="Delete">
                        <FiTrash2 />
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          ))
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <nav className="clt-pagination" aria-label="Configuration pagination">
          <div className="clt-pagination-info">
            Showing <strong>{showingStart}</strong>–<strong>{showingEnd}</strong> of{' '}
            <strong>{totalCount.toLocaleString()}</strong>
          </div>
          <div className="clt-pagination-controls">
            <button
              type="button"
              className="clt-page-btn"
              onClick={() => goTo(1)}
              disabled={page <= 1}
              aria-label="First page"
              title="First page"
            >
              <FiChevronsLeft />
              <span className="clt-page-btn-text">First</span>
            </button>
            <button
              type="button"
              className="clt-page-btn"
              onClick={() => goTo(page - 1)}
              disabled={page <= 1}
              aria-label="Previous page"
              title="Previous page"
            >
              <FiChevronLeft />
              <span className="clt-page-btn-text">Prev</span>
            </button>
            <span className="clt-page-indicator">
              {page} / {totalPages}
            </span>
            <button
              type="button"
              className="clt-page-btn"
              onClick={() => goTo(page + 1)}
              disabled={page >= totalPages}
              aria-label="Next page"
              title="Next page"
            >
              <span className="clt-page-btn-text">Next</span>
              <FiChevronRight />
            </button>
            <button
              type="button"
              className="clt-page-btn"
              onClick={() => goTo(totalPages)}
              disabled={page >= totalPages}
              aria-label="Last page"
              title="Last page"
            >
              <span className="clt-page-btn-text">Last</span>
              <FiChevronsRight />
            </button>
          </div>
        </nav>
      )}
    </div>
  );
};

export default ConfigListTab;

/* ============================================================ */
const css = `
.clt-root {
  padding: 24px; max-width: 900px; margin: 0 auto; width: 100%;
  box-sizing: border-box;
}
.clt-root *, .clt-root *::before, .clt-root *::after { box-sizing: border-box; }

/* ---------- Header ---------- */
.clt-header { margin-bottom: 24px; }
.clt-title { font-size: 20px; font-weight: 800; color: #0f172a; margin: 0 0 6px; line-height: 1.2; }
.clt-sub { font-size: 14px; color: #64748b; margin: 0; line-height: 1.45; max-width: 70ch; }

.clt-alert {
  display: flex; align-items: flex-start; gap: 8px;
  margin-top: 12px; padding: 10px 14px;
  background: #eff6ff; border: 1px solid #bfdbfe;
  border-radius: 8px; color: #1e40af;
  font-size: 13px; line-height: 1.45;
}
.clt-alert svg { width: 16px; height: 16px; flex-shrink: 0; margin-top: 1px; }
.clt-alert--readonly {
  background: #f8fafc; border-color: #cbd5e1; color: #475569;
}

.clt-count {
  margin-top: 10px;
  font-size: 13px;
  color: #475569;
  font-weight: 500;
}
.clt-count strong { color: #0f766e; font-weight: 800; }

/* ---------- Add form ---------- */
.clt-add-form {
  display: flex; gap: 12px; margin-bottom: 24px; align-items: stretch;
  flex-wrap: wrap;
}
.clt-input {
  flex: 1; min-width: 0;
  padding: 12px 16px;
  border: 1.5px solid #cbd5e1; border-radius: 8px;
  font: inherit; font-size: 15px;
  outline: none; background: #fff; color: #0f172a;
  transition: border-color 0.15s, box-shadow 0.15s, background 0.15s;
}
.clt-input:focus {
  border-color: #00b8b0;
  box-shadow: 0 0 0 3px rgba(0,184,176,0.15);
}
.clt-input--sm { padding: 8px 12px; font-size: 14px; }

.clt-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  padding: 0 20px;
  border-radius: 8px;
  font: inherit; font-size: 14px; font-weight: 700;
  cursor: pointer; border: none;
  transition: background 0.15s, transform 0.1s, box-shadow 0.15s;
  white-space: nowrap; flex-shrink: 0;
}
.clt-btn--primary { background: #00b8b0; color: #fff; }
.clt-btn--primary:hover:not(:disabled) {
  background: #00d4cb;
  transform: translateY(-1px);
  box-shadow: 0 4px 10px rgba(0, 184, 176, 0.28);
}
.clt-btn:disabled { opacity: 0.6; cursor: not-allowed; }

/* ---------- List ---------- */
.clt-list { display: flex; flex-direction: column; gap: 8px; }
.clt-item {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 16px;
  background: #fff; border: 1px solid #e2e8f0; border-radius: 8px;
  box-shadow: 0 1px 2px rgba(0,0,0,0.02);
  transition: border-color 0.15s, box-shadow 0.15s;
  gap: 12px;
}
.clt-item:hover {
  border-color: #cbd5e1;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.06);
}

.clt-item-info { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.clt-value {
  font-size: 15px; font-weight: 600; color: #0f172a;
  word-break: break-word;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
}
.clt-desc {
  font-size: 13px; color: #64748b;
  word-break: break-word;
}

.clt-actions { display: flex; gap: 4px; flex-shrink: 0; margin-left: auto; }
.clt-edit-row { display: flex; align-items: center; gap: 8px; width: 100%; }

.clt-icon-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 32px; height: 32px; border-radius: 6px;
  background: none; border: none; color: #64748b;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.clt-icon-btn:hover { background: #f1f5f9; color: #0f172a; }
.clt-icon-btn--danger:hover { background: #fee2e2; color: #dc2626; }
.clt-icon-btn--success:hover { background: #dcfce7; color: #16a34a; }
.clt-icon-btn svg { width: 15px; height: 15px; }

.clt-empty {
  text-align: center; padding: 40px 20px;
  color: #94a3b8; border: 1px dashed #cbd5e1; border-radius: 8px;
  font-size: 14px; line-height: 1.5;
}
.clt-spin { animation: cltSpin 1s linear infinite; }
@keyframes cltSpin { 100% { transform: rotate(360deg); } }

/* ---------- Pagination ---------- */
.clt-pagination {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  margin-top: 20px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
}
.clt-pagination-info {
  font-size: 13px;
  color: #475569;
  line-height: 1.45;
}
.clt-pagination-info strong {
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-weight: 800;
  color: #0f172a;
}
.clt-pagination-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.clt-page-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-height: 36px;
  padding: 8px 12px;
  font-size: 13px;
  font-weight: 600;
  border-radius: 8px;
  border: 1px solid #cbd5e1;
  background: #ffffff;
  color: #334155;
  font-family: inherit;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
  white-space: nowrap;
}
.clt-page-btn:hover:not(:disabled) {
  background: #f1f5f9;
  border-color: #94a3b8;
}
.clt-page-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.clt-page-btn svg {
  width: 14px;
  height: 14px;
  stroke-width: 2.6;
  flex-shrink: 0;
}
.clt-page-indicator {
  font-size: 12.5px;
  font-weight: 700;
  color: #334155;
  padding: 0 10px;
  min-width: 60px;
  text-align: center;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-variant-numeric: tabular-nums;
}

/* ============================================================
   RESPONSIVE — Small Tablet (≤ 768px)
   ============================================================ */
@media (max-width: 768px) {
  .clt-root { padding: 16px; }

  .clt-pagination {
    flex-direction: column;
    align-items: stretch;
    gap: 10px;
  }
  .clt-pagination-info { text-align: center; }
  .clt-pagination-controls { justify-content: center; }
}

/* ============================================================
   RESPONSIVE — Phone (≤ 640px)
   ============================================================ */
@media (max-width: 640px) {
  .clt-root { padding: 16px; }
  .clt-add-form { flex-direction: column; }
  .clt-btn { padding: 12px 20px; width: 100%; }
  .clt-item { padding: 10px 12px; }
  .clt-value { font-size: 14px; }
  .clt-edit-row { flex-wrap: wrap; }
  .clt-edit-row .clt-input { flex: 1 1 100%; }

  .clt-page-btn { flex: 1 1 auto; min-width: 80px; padding: 8px 10px; font-size: 12.5px; }
  .clt-page-indicator { padding: 0 6px; min-width: 56px; font-size: 12px; }
  .clt-pagination-info { font-size: 12.5px; }
}

/* ============================================================
   RESPONSIVE — Small Phone (≤ 480px)
   ============================================================ */
@media (max-width: 480px) {
  .clt-page-btn-text { display: none; }
  .clt-page-btn {
    flex: 1 1 0;
    min-width: 0;
    padding: 8px 6px;
  }
  .clt-page-btn svg { width: 16px; height: 16px; }
}

/* ============================================================
   RESPONSIVE — Very Small Phone (≤ 380px)
   ============================================================ */
@media (max-width: 380px) {
  .clt-root { padding: 12px; }
  .clt-title { font-size: 16px; }
  .clt-icon-btn { width: 28px; height: 28px; }

  .clt-page-btn { padding: 6px 4px; }
  .clt-page-indicator { padding: 0 4px; min-width: 48px; font-size: 11.5px; }
}

/* ============================================================
   RESPONSIVE — Ultrawide (≥ 1921px)
   ============================================================ */
@media (min-width: 1921px) {
  .clt-root { padding: 32px; max-width: 1100px; }
  .clt-title { font-size: 22px; }
  .clt-sub { font-size: 15px; }
  .clt-value { font-size: 16px; }
  .clt-desc { font-size: 14px; }
  .clt-pagination { padding: 16px 20px; }
  .clt-page-btn { min-height: 40px; padding: 10px 16px; font-size: 14px; }
  .clt-page-indicator { font-size: 14px; min-width: 84px; }
  .clt-pagination-info { font-size: 14px; }
}

/* ============================================================
   Accessibility
   ============================================================ */
@media (prefers-reduced-motion: reduce) {
  .clt-btn { transition: none; }
  .clt-spin { animation: none; }
  .clt-item { transition: none; }
  .clt-page-btn { transition: none; }
}
`;