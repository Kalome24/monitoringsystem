// src/components/admin/AdminLockedItemsTab.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FiPlus, FiX, FiEdit2, FiLock, FiUnlock, FiTrash2 } from 'react-icons/fi';
import { lockedItemsApi, locatorsApi, warehouseApi, itemMasterApi } from '../../services/api';
import ActionsMenu from '../shared/ActionsMenu';

const PAGE_SIZE = 25;

const inputStyle = {
  width: '100%',
  padding: '10px 12px',
  border: '1px solid #cbd5e1',
  borderRadius: 8,
  fontSize: 15,
  boxSizing: 'border-box',
  outline: 'none',
  transition: 'border-color 160ms ease, box-shadow 160ms ease, background 160ms ease',
};

// ============================================================
// Item Code Autocomplete
// ============================================================
const ItemCodeAutocomplete = ({ value, onPick, disabled, placeholder }) => {
  const [query, setQuery] = useState(value || '');
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const wrapRef = useRef(null);
  const debounceRef = useRef(null);

  useEffect(() => {
    setQuery(value || '');
  }, [value]);

  useEffect(() => {
    if (disabled) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const term = query.trim();
    if (term.length === 0) {
      setResults([]);
      setLoading(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await itemMasterApi.getAllItemMasters({ search: term, limit: 20 });
        let list = [];
        if (res.ok && res.data) {
          if (Array.isArray(res.data)) list = res.data;
          else if (Array.isArray(res.data.data)) list = res.data.data;
          else if (Array.isArray(res.data.items)) list = res.data.items;
        }
        setResults(list);
        setHighlight(0);
      } catch (e) {
        console.warn('Item code search failed:', e);
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, disabled]);

  useEffect(() => {
    const onDoc = (e) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const pick = (item) => {
    setQuery(item.Item_Code || '');
    onPick(item.Item_Code || '', item);
    setOpen(false);
  };

  const handleKey = (e) => {
    if (!open) return;
    if (results.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      if (results[highlight]) {
        e.preventDefault();
        pick(results[highlight]);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  const showDropdown = open && !disabled && query.trim().length > 0;

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <input
        style={inputStyle}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          onPick(e.target.value, null);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKey}
        disabled={disabled}
        placeholder={placeholder || 'Search item code…'}
        autoComplete="off"
      />

      {showDropdown && (
        <div style={dropStyles.panel}>
          {loading ? (
            <div style={dropStyles.msg}>Searching item master…</div>
          ) : results.length === 0 ? (
            <div style={dropStyles.msg}>
              No item codes match "{query.trim()}"
            </div>
          ) : (
            results.map((item, idx) => (
              <div
                key={item.Item_Code}
                onMouseEnter={() => setHighlight(idx)}
                onMouseDown={(e) => { e.preventDefault(); pick(item); }}
                style={{
                  ...dropStyles.item,
                  background: idx === highlight ? 'linear-gradient(90deg, #ecfeff 0%, #f0fdfa 100%)' : '#fff',
                  borderLeft: idx === highlight ? '3px solid #00b8b0' : '3px solid transparent',
                }}
              >
                <div style={dropStyles.code}>{item.Item_Code}</div>
                <div style={dropStyles.name}>{item.Item_Description || '—'}</div>
                <div style={dropStyles.chips}>
                  {item.Uom_Code && <span style={dropStyles.chip}>{item.Uom_Code}</span>}
                  {item.Category && <span style={dropStyles.chipCat}>{item.Category}</span>}
                  {item.Purchase_Class && <span style={dropStyles.chipPc}>{item.Purchase_Class}</span>}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};

// ============================================================
// Main Tab
// ============================================================
const AdminLockedItemsTab = () => {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [search, setSearch] = useState('');
  const [warehouseFilter, setWarehouseFilter] = useState('');
  const [activeFilter, setActiveFilter] = useState('');

  const [warehouses, setWarehouses] = useState([]);
  const [locators, setLocators] = useState([]);

  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({
    item_code: '',
    warehouse_code: '',
    locator_code: '',
    remarks: '',
    is_active: true,
  });
  const [selectedMaster, setSelectedMaster] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const loadWarehouses = useCallback(async () => {
    const res = await warehouseApi.getAllWarehouses();
    if (res.ok && Array.isArray(res.data)) {
      setWarehouses(res.data.filter((w) => w.status === 'Active'));
    }
  }, []);

  const loadLocators = useCallback(async (warehouseCode) => {
    if (!warehouseCode) {
      setLocators([]);
      return;
    }
    const res = await locatorsApi.list({ warehouse_code: warehouseCode, limit: 2000 });
    if (res.ok) setLocators(res.data || []);
  }, []);

  const loadRows = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await lockedItemsApi.list({
        warehouse_code: warehouseFilter || undefined,
        search: search || undefined,
        is_active: activeFilter === '' ? undefined : activeFilter === '1',
        page,
        limit: PAGE_SIZE,
      });
      if (res.ok) {
        setRows(res.data || []);
        setTotal(res.total || 0);
      } else {
        setError(res.data?.message || 'Failed to load locked items.');
      }
    } finally {
      setLoading(false);
    }
  }, [warehouseFilter, search, activeFilter, page]);

  useEffect(() => { loadWarehouses(); }, [loadWarehouses]);
  useEffect(() => { loadRows(); }, [loadRows]);

  useEffect(() => { setPage(1); }, [warehouseFilter, search, activeFilter]);

  const openCreate = () => {
    setEditing(null);
    setForm({ item_code: '', warehouse_code: '', locator_code: '', remarks: '', is_active: true });
    setSelectedMaster(null);
    setFormError('');
    setLocators([]);
    setShowModal(true);
  };

  const openEdit = async (row) => {
    setEditing(row);
    setForm({
      item_code: row.item_code,
      warehouse_code: row.warehouse_code,
      locator_code: row.locator_code || '',
      remarks: row.remarks || '',
      is_active: row.is_active === 1 || row.is_active === true,
    });
    setSelectedMaster(
      row.Item_Description
        ? { Item_Code: row.item_code, Item_Description: row.Item_Description }
        : null
    );
    setFormError('');
    await loadLocators(row.warehouse_code);
    setShowModal(true);
  };

  const onWarehouseChange = async (code) => {
    setForm((f) => ({ ...f, warehouse_code: code, locator_code: '' }));
    await loadLocators(code);
  };

  const handleItemPick = (code, master) => {
    setForm((f) => ({ ...f, item_code: code }));
    setSelectedMaster(master || null);
  };

  const submitForm = async () => {
    setFormError('');
    if (!form.item_code.trim()) return setFormError('Item code is required.');
    if (!form.warehouse_code) return setFormError('Warehouse is required.');

    setSaving(true);
    try {
      const payload = {
        warehouse_code: form.warehouse_code,
        locator_code: form.locator_code || null,
        remarks: form.remarks || null,
      };

      let res;
      if (editing) {
        res = await lockedItemsApi.update(editing.id, { ...payload, is_active: form.is_active });
      } else {
        res = await lockedItemsApi.create({ ...payload, item_code: form.item_code.trim() });
      }

      if (!res.ok) {
        setFormError(res.data?.message || 'Failed to save.');
        return;
      }
      setShowModal(false);
      await loadRows();
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (row) => {
    const isActive = row.is_active === 1 || row.is_active === true;
    const res = await lockedItemsApi.update(row.id, {
      warehouse_code: row.warehouse_code,
      locator_code: row.locator_code || null,
      remarks: row.remarks || null,
      is_active: !isActive,
    });
    if (res.ok) await loadRows();
  };

  const removeRow = async (row) => {
    if (!window.confirm(`Delete locked item "${row.item_code}"? This cannot be undone.`)) return;
    const res = await lockedItemsApi.remove(row.id);
    if (res.ok) await loadRows();
  };

  const filteredLocators = useMemo(() => locators, [locators]);

  return (
    <div style={{ padding: 20 }} className="ali-root">
      <style>{aliCss}</style>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, gap: 16 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: '#0f172a', letterSpacing: '-0.01em' }}>
            Locked Items
          </h2>
          <p style={{ margin: '6px 0 0', color: '#64748b', fontSize: 14 }}>
            Items in this list are auto-routed to a specific warehouse + locator on PO import.
          </p>
        </div>

        <button className="ali-btn ali-btn-primary" onClick={openCreate} type="button">
          <span className="ali-plus"><FiPlus /></span>
          <span>Lock an Item</span>
        </button>
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
        <input
          className="ali-input"
          style={{ ...inputStyle, maxWidth: 340 }}
          placeholder="Search item code / description / warehouse…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="ali-input"
          style={{ ...inputStyle, maxWidth: 260 }}
          value={warehouseFilter}
          onChange={(e) => setWarehouseFilter(e.target.value)}
        >
          <option value="">All warehouses</option>
          {warehouses.map((w) => (
            <option key={w.warehouse_code} value={w.warehouse_code}>
              {w.warehouse_code} — {w.warehouse_name}
            </option>
          ))}
        </select>
        <select
          className="ali-input"
          style={{ ...inputStyle, maxWidth: 180 }}
          value={activeFilter}
          onChange={(e) => setActiveFilter(e.target.value)}
        >
          <option value="">All status</option>
          <option value="1">Active</option>
          <option value="0">Inactive</option>
        </select>
      </div>

      {error && (
        <div style={{ background: '#fee2e2', color: '#991b1b', padding: 12, borderRadius: 8, marginBottom: 12, fontSize: 14 }}>
          {error}
        </div>
      )}

      <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: 10 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead style={{ background: '#f8fafc' }}>
            <tr>
              <th style={th}>Item Code</th>
              <th style={th}>Description</th>
              <th style={th}>Warehouse</th>
              <th style={th}>Locator</th>
              <th style={th}>Status</th>
              <th style={th}>Remarks</th>
              <th style={{ ...th, textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={7} style={{ padding: 24, textAlign: 'center', color: '#64748b', fontSize: 14 }}>Loading…</td></tr>
            )}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={7} style={{ padding: 24, textAlign: 'center', color: '#64748b', fontSize: 14 }}>No locked items found.</td></tr>
            )}
            {!loading && rows.map((r) => {
              const isActive = r.is_active === 1 || r.is_active === true;

              const menuItems = [
                {
                  key: 'edit',
                  label: 'Edit',
                  icon: <FiEdit2 />,
                  onClick: () => openEdit(r),
                },
                isActive
                  ? {
                      key: 'deactivate',
                      label: 'Deactivate',
                      icon: <FiLock />,
                      onClick: () => toggleActive(r),
                      variant: 'muted',
                    }
                  : {
                      key: 'activate',
                      label: 'Activate',
                      icon: <FiUnlock />,
                      onClick: () => toggleActive(r),
                      variant: 'success',
                    },
                {
                  key: 'delete',
                  label: 'Delete',
                  icon: <FiTrash2 />,
                  onClick: () => removeRow(r),
                  variant: 'danger',
                  dividerBefore: true,
                },
              ];

              return (
                <tr key={r.id} className="ali-row">
                  <td style={td}>
                    <span style={codeCell}>{r.item_code}</span>
                  </td>
                  <td style={td}>{r.Item_Description || '—'}</td>
                  <td style={td}>{r.warehouse_code}{r.warehouse_name ? ` — ${r.warehouse_name}` : ''}</td>
                  <td style={td}>{r.locator_code || '—'}{r.locator_description ? ` — ${r.locator_description}` : ''}</td>
                  <td style={td}>
                    <span style={{
                      display: 'inline-block', padding: '3px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700,
                      background: isActive ? '#dcfce7' : '#f1f5f9',
                      color: isActive ? '#166534' : '#475569',
                      border: isActive ? '1px solid #86efac' : '1px solid #cbd5e1',
                    }}>
                      {isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td style={td}>{r.remarks || '—'}</td>
                  <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <div style={{ display: 'inline-flex', justifyContent: 'flex-end' }}>
                      <ActionsMenu
                        items={menuItems}
                        ariaLabel={`Actions for ${r.item_code}`}
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14, fontSize: 14 }}>
        <span style={{ color: '#64748b' }}>
          {total} total — page {page} of {totalPages}
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="ali-btn ali-btn-secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} type="button">
            Prev
          </button>
          <button className="ali-btn ali-btn-secondary" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} type="button">
            Next
          </button>
        </div>
      </div>

      {showModal && (
        <div className="ali-overlay" style={overlay} onClick={saving ? undefined : () => setShowModal(false)}>
          <div className="ali-modal" style={modal} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <h3 style={{ marginTop: 0, fontSize: 20, fontWeight: 700, color: '#0f172a' }}>
                {editing ? `Edit "${editing.item_code}"` : 'Add Locked Item'}
              </h3>
              <button
                type="button"
                onClick={() => !saving && setShowModal(false)}
                aria-label="Close"
                style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  width: 32, height: 32, borderRadius: 8, padding: 0,
                  background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer',
                }}
              >
                <FiX size={18} />
              </button>
            </div>

            {formError && (
              <div style={{ background: '#fee2e2', color: '#991b1b', padding: 12, borderRadius: 8, marginBottom: 12, fontSize: 14 }}>
                {formError}
              </div>
            )}

            <label style={lbl}>Item Code</label>
            <ItemCodeAutocomplete
              value={form.item_code}
              onPick={handleItemPick}
              disabled={!!editing}
              placeholder="Search item code (e.g. ABSB, CAPS-0233)…"
            />

            {selectedMaster && (
              <div style={previewCard}>
                <div style={previewRow}>
                  <span style={previewLabel}>Item</span>
                  <span style={previewCode}>{selectedMaster.Item_Code}</span>
                </div>
                <div style={previewRow}>
                  <span style={previewLabel}>Description</span>
                  <span style={previewValue} title={selectedMaster.Item_Description}>
                    {selectedMaster.Item_Description || '—'}
                  </span>
                </div>
                <div style={previewChips}>
                  {selectedMaster.Uom_Code && (
                    <span style={previewChip}>
                      {selectedMaster.Uom_Code}
                      {selectedMaster.Uom_Description && selectedMaster.Uom_Description !== selectedMaster.Uom_Code
                        ? ` · ${selectedMaster.Uom_Description}`
                        : ''}
                    </span>
                  )}
                  {selectedMaster.Category && (
                    <span style={previewChipCat}>{selectedMaster.Category}</span>
                  )}
                  {selectedMaster.Purchase_Class && (
                    <span style={previewChipPc}>{selectedMaster.Purchase_Class}</span>
                  )}
                  {selectedMaster.Gl_Class != null && (
                    <span style={previewChipGl}>GL {selectedMaster.Gl_Class}</span>
                  )}
                </div>
              </div>
            )}

            <label style={{ ...lbl, marginTop: 14 }}>Warehouse</label>
            <select
              className="ali-input"
              style={inputStyle}
              value={form.warehouse_code}
              onChange={(e) => onWarehouseChange(e.target.value)}
            >
              <option value="">Select warehouse…</option>
              {warehouses.map((w) => (
                <option key={w.warehouse_code} value={w.warehouse_code}>
                  {w.warehouse_code} — {w.warehouse_name}
                </option>
              ))}
            </select>

            <label style={{ ...lbl, marginTop: 14 }}>Locator (optional)</label>
            <select
              className="ali-input"
              style={inputStyle}
              value={form.locator_code}
              onChange={(e) => setForm((f) => ({ ...f, locator_code: e.target.value }))}
              disabled={!form.warehouse_code}
            >
              <option value="">— none —</option>
              {filteredLocators.map((l) => (
                <option key={l.locator_code} value={l.locator_code}>
                  {l.locator_code} {l.description ? `— ${l.description}` : ''}
                </option>
              ))}
            </select>

            <label style={{ ...lbl, marginTop: 14 }}>Remarks (optional)</label>
            <input
              className="ali-input"
              style={inputStyle}
              value={form.remarks}
              onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))}
              placeholder="e.g. locked per mine ops request"
            />

            {editing && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, fontSize: 15 }}>
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
                />
                Active
              </label>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 22 }}>
              <button className="ali-btn ali-btn-secondary" onClick={() => setShowModal(false)} disabled={saving} type="button">
                Cancel
              </button>
              <button className="ali-btn ali-btn-primary" onClick={submitForm} disabled={saving} type="button">
                {saving ? 'Saving…' : (editing ? 'Save Changes' : 'Create')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ============================================================
// Styles
// ============================================================
const th = {
  padding: '12px 14px',
  textAlign: 'left',
  fontWeight: 700,
  fontSize: 12.5,
  color: '#334155',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};
const td = { padding: '12px 14px', verticalAlign: 'top', fontSize: 14, color: '#0f172a' };
const codeCell = {
  fontFamily: "'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace",
  fontWeight: 700,
  fontSize: 13.5,
  color: '#008a82',
  letterSpacing: '0.01em',
};
const lbl = {
  display: 'block',
  fontSize: 13,
  fontWeight: 700,
  color: '#334155',
  marginBottom: 6,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};
const overlay = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(15,23,42,0.5)',
  backdropFilter: 'blur(4px)',
  WebkitBackdropFilter: 'blur(4px)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
};
const modal = {
  background: '#fff',
  borderRadius: 14,
  padding: 26,
  width: '100%',
  maxWidth: 540,
  maxHeight: '90vh',
  overflowY: 'auto',
  boxShadow: '0 20px 50px rgba(0,0,0,0.2)',
};

// ============================================================
// CSS — solid, saturated buttons that clearly read as buttons
// ============================================================
const aliCss = `
@keyframes aliFadeIn { from { opacity: 0 } to { opacity: 1 } }
@keyframes aliModalIn {
  from { opacity: 0; transform: translateY(12px) scale(0.98) }
  to   { opacity: 1; transform: translateY(0)    scale(1)    }
}

.ali-overlay { animation: aliFadeIn 180ms ease; }
.ali-modal   { animation: aliModalIn 220ms cubic-bezier(0.34, 1.3, 0.64, 1); }

/* ============================================================
   Base button — solid, physical, unmistakably clickable
   ============================================================ */
.ali-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 11px 20px;
  font-family: inherit;
  font-size: 14.5px;
  font-weight: 700;
  letter-spacing: 0.01em;
  border-radius: 10px;
  cursor: pointer;
  position: relative;
  user-select: none;
  border: 1px solid transparent;
  border-bottom-width: 2px;
  will-change: transform, box-shadow;
  transition:
    transform 180ms cubic-bezier(0.34, 1.4, 0.64, 1),
    box-shadow 200ms ease,
    background 160ms ease,
    border-color 160ms ease,
    color 160ms ease;
}
.ali-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none !important;
  box-shadow: none !important;
  filter: saturate(0.6);
}

/* ============================================================
   PRIMARY — solid brand teal
   ============================================================ */
.ali-btn-primary {
  background: #00b8b0;
  color: #ffffff;
  border-color: #007a72;
  text-shadow: 0 1px 1px rgba(0,0,0,0.18);
  box-shadow:
    0 1px 0 rgba(255,255,255,0.32) inset,
    0 2px 4px rgba(0, 122, 114, 0.28),
    0 6px 16px rgba(0, 184, 176, 0.28);
}
.ali-btn-primary:hover:not(:disabled) {
  transform: translateY(-2px);
  background: #00d4cb;
  border-color: #008a82;
  box-shadow:
    0 1px 0 rgba(255,255,255,0.4) inset,
    0 4px 10px rgba(0, 122, 114, 0.36),
    0 14px 32px rgba(0, 184, 176, 0.48),
    0 0 0 4px rgba(0, 184, 176, 0.24);
}
.ali-btn-primary:active:not(:disabled) {
  transform: translateY(0);
  background: #00a29b;
  box-shadow:
    0 2px 6px rgba(0, 122, 114, 0.4) inset,
    0 1px 2px rgba(0, 122, 114, 0.3);
}

.ali-plus {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 7px;
  background: rgba(0, 0, 0, 0.14);
  font-size: 14px;
  line-height: 1;
  transition:
    transform 320ms cubic-bezier(0.34, 1.5, 0.64, 1),
    background 220ms ease;
}
.ali-plus svg {
  width: 14px;
  height: 14px;
  stroke-width: 2.6;
}
.ali-btn-primary:hover:not(:disabled) .ali-plus {
  transform: rotate(180deg) scale(1.15);
  background: rgba(0, 0, 0, 0.22);
}

/* ============================================================
   SECONDARY — solid white, thick border, clearly a button
   ============================================================ */
.ali-btn-secondary {
  background: #ffffff;
  color: #1e293b;
  border: 1px solid #94a3b8;
  border-bottom-width: 2px;
  box-shadow:
    0 1px 0 rgba(255,255,255,0.9) inset,
    0 1px 3px rgba(15, 23, 42, 0.1);
}
.ali-btn-secondary:hover:not(:disabled) {
  transform: translateY(-2px);
  background: #f0fdfa;
  border-color: #00b8b0;
  color: #007a72;
  box-shadow:
    0 1px 0 rgba(255,255,255,1) inset,
    0 4px 10px rgba(0, 184, 176, 0.22),
    0 14px 32px rgba(0, 184, 176, 0.24),
    0 0 0 4px rgba(0, 184, 176, 0.16);
}
.ali-btn-secondary:active:not(:disabled) {
  transform: translateY(0);
  background: #e6fffb;
}

/* ============================================================
   SUCCESS — solid green (Activate)
   ============================================================ */
.ali-btn-success {
  background: #10b981;
  color: #ffffff;
  border-color: #047857;
  text-shadow: 0 1px 1px rgba(0,0,0,0.18);
  box-shadow:
    0 1px 0 rgba(255,255,255,0.28) inset,
    0 2px 4px rgba(4, 120, 87, 0.28),
    0 6px 16px rgba(16, 185, 129, 0.28);
}
.ali-btn-success:hover:not(:disabled) {
  transform: translateY(-2px);
  background: #34d399;
  border-color: #047857;
  box-shadow:
    0 1px 0 rgba(255,255,255,0.36) inset,
    0 4px 10px rgba(4, 120, 87, 0.36),
    0 14px 32px rgba(16, 185, 129, 0.48),
    0 0 0 4px rgba(16, 185, 129, 0.24);
}

/* ============================================================
   DANGER — solid red (Delete). Filled, not outline.
   ============================================================ */
.ali-btn-danger {
  background: #dc2626;
  color: #ffffff;
  border-color: #991b1b;
  text-shadow: 0 1px 1px rgba(0,0,0,0.18);
  box-shadow:
    0 1px 0 rgba(255,255,255,0.24) inset,
    0 2px 4px rgba(153, 27, 27, 0.28),
    0 6px 16px rgba(220, 38, 38, 0.24);
}
.ali-btn-danger:hover:not(:disabled) {
  transform: translateY(-2px);
  background: #ef4444;
  border-color: #991b1b;
  box-shadow:
    0 1px 0 rgba(255,255,255,0.32) inset,
    0 4px 10px rgba(153, 27, 27, 0.36),
    0 14px 32px rgba(220, 38, 38, 0.42),
    0 0 0 4px rgba(220, 38, 38, 0.22);
}
.ali-btn-danger:active:not(:disabled) {
  transform: translateY(0);
  background: #b91c1c;
}

/* ============================================================
   MUTED — solid slate (Deactivate)
   ============================================================ */
.ali-btn-muted {
  background: #475569;
  color: #ffffff;
  border-color: #1e293b;
  text-shadow: 0 1px 1px rgba(0,0,0,0.18);
  box-shadow:
    0 1px 0 rgba(255,255,255,0.18) inset,
    0 2px 4px rgba(15, 23, 42, 0.24),
    0 6px 16px rgba(71, 85, 105, 0.24);
}
.ali-btn-muted:hover:not(:disabled) {
  transform: translateY(-2px);
  background: #64748b;
  border-color: #1e293b;
  box-shadow:
    0 1px 0 rgba(255,255,255,0.26) inset,
    0 4px 10px rgba(15, 23, 42, 0.32),
    0 14px 32px rgba(71, 85, 105, 0.4),
    0 0 0 4px rgba(100, 116, 139, 0.22);
}

/* ============================================================
   Inputs — teal focus ring
   ============================================================ */
.ali-input:hover:not(:disabled) {
  border-color: #94a3b8;
}
.ali-input:focus {
  border-color: #00b8b0;
  box-shadow: 0 0 0 4px rgba(0, 184, 176, 0.2);
}

/* ============================================================
   Table rows — soft teal hover with left rail
   ============================================================ */
.ali-row {
  transition: background 160ms ease, box-shadow 160ms ease;
  border-left: 3px solid transparent;
}
.ali-row:hover {
  background: linear-gradient(90deg, #f0fdfa 0%, #ecfeff 100%);
  border-left-color: #00b8b0;
  box-shadow: 0 1px 4px rgba(0, 184, 176, 0.08);
}

/* ============================================================
   Reduced motion
   ============================================================ */
@media (prefers-reduced-motion: reduce) {
  .ali-btn,
  .ali-plus,
  .ali-overlay,
  .ali-modal,
  .ali-row {
    animation: none !important;
    transition: none !important;
  }
  .ali-btn:hover:not(:disabled) { transform: none !important; }
  .ali-btn-primary:hover:not(:disabled) .ali-plus { transform: none !important; }
}
`;

// ============================================================
// Dropdown styles
// ============================================================
const dropStyles = {
  panel: {
    position: 'absolute',
    top: 'calc(100% + 6px)',
    left: 0,
    right: 0,
    maxHeight: 280,
    overflowY: 'auto',
    background: '#fff',
    border: '1px solid #cbd5e1',
    borderRadius: 10,
    boxShadow: '0 12px 32px rgba(15,23,42,0.18), 0 4px 12px rgba(0, 184, 176, 0.08)',
    zIndex: 1100,
    padding: 4,
  },
  item: {
    padding: '10px 12px 10px 10px',
    borderRadius: 8,
    cursor: 'pointer',
    display: 'flex',
    flexDirection: 'column',
    gap: 3,
    userSelect: 'none',
    transition: 'background 140ms ease, border-color 140ms ease',
  },
  code: {
    fontFamily: "'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace",
    fontWeight: 700,
    fontSize: 14,
    color: '#008a82',
    lineHeight: 1.2,
  },
  name: {
    fontSize: 13,
    color: '#475569',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  chips: { display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 3 },
  chip: {
    display: 'inline-block', padding: '2px 8px',
    background: '#f1f5f9', color: '#334155',
    border: '1px solid #cbd5e1', borderRadius: 999,
    fontSize: 11, fontWeight: 700,
    fontFamily: "'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace",
  },
  chipCat: {
    display: 'inline-block', padding: '2px 8px',
    background: '#f0fdfa', color: '#0f766e',
    border: '1px solid #99f6e4', borderRadius: 999,
    fontSize: 11, fontWeight: 700,
  },
  chipPc: {
    display: 'inline-block', padding: '2px 8px',
    background: '#eef2ff', color: '#4338ca',
    border: '1px solid #c7d2fe', borderRadius: 999,
    fontSize: 11, fontWeight: 700,
  },
  msg: {
    padding: '12px 14px',
    fontSize: 13,
    color: '#64748b',
    textAlign: 'center',
  },
};

// ============================================================
// Preview card styles
// ============================================================
const previewCard = {
  marginTop: 10,
  padding: '12px 14px',
  background: 'linear-gradient(135deg, #f0fdfa 0%, #ecfeff 100%)',
  border: '1px solid #99f6e4',
  borderRadius: 10,
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};
const previewRow = { display: 'flex', gap: 10, alignItems: 'baseline', minWidth: 0 };
const previewLabel = {
  fontSize: 11, fontWeight: 700, color: '#0f766e',
  textTransform: 'uppercase', letterSpacing: '0.06em',
  width: 82, flexShrink: 0,
};
const previewCode = {
  fontSize: 14, fontWeight: 700, color: '#008a82',
  fontFamily: "'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace",
  overflow: 'hidden', textOverflow: 'ellipsis',
};
const previewValue = {
  fontSize: 14, color: '#0f172a', fontWeight: 600,
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
};
const previewChips = { display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 3 };
const previewChip = {
  display: 'inline-block', padding: '3px 10px',
  background: '#ffffff', color: '#334155',
  border: '1px solid #cbd5e1', borderRadius: 999,
  fontSize: 11, fontWeight: 700,
  fontFamily: "'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace",
};
const previewChipCat = {
  display: 'inline-block', padding: '3px 10px',
  background: '#ffffff', color: '#0f766e',
  border: '1px solid #99f6e4', borderRadius: 999,
  fontSize: 11, fontWeight: 700,
};
const previewChipPc = {
  display: 'inline-block', padding: '3px 10px',
  background: '#ffffff', color: '#4338ca',
  border: '1px solid #c7d2fe', borderRadius: 999,
  fontSize: 11, fontWeight: 700,
};
const previewChipGl = {
  display: 'inline-block', padding: '3px 10px',
  background: '#ffffff', color: '#92400e',
  border: '1px solid #fcd34d', borderRadius: 999,
  fontSize: 11, fontWeight: 700,
  fontFamily: "'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace",
};

export default AdminLockedItemsTab;