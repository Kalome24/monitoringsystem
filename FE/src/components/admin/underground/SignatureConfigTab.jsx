// src/components/admin/underground/SignatureConfigTab.jsx
//
// Admin CRUD for the "Authorized By" signatories used by the issue forms.
// Embedded within the OfflineConfigDashboard tab system.
//
// When used from the Underground Handler's System Updates view, the
// parent passes readOnly={true} — the handler can view the current
// signatory list but cannot edit it (that's the surface admin's job).
// The underground can still receive an updated list via the Sync
// System modal's Import flow.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FiPlus,
  FiX,
  FiEdit2,
  FiTrash2,
  FiCheckCircle,
  FiSlash,
  FiUserCheck,
  FiInfo,
  FiChevronRight,
  FiArchive,
} from 'react-icons/fi';
import { signatureConfigApi } from '../../../services/api';
import { useToast } from '../../shared/ToastProvider';
import ActionsMenu from '../../shared/ActionsMenu';

const ACTIVE_ROLE = 'Authorized By';

const ACTIVE_ROLE_SLOTS = [
  { value: 'Authorized By', label: 'Authorized By' },
];

const LEGACY_ROLE_SLOTS = [
  { value: 'Issued By',   label: 'Issued By'   },
  { value: 'Received By', label: 'Received By' },
  { value: 'Bodega',      label: 'Bodega'      },
  { value: 'Chapa',       label: 'Chapa'       },
];

const ALL_ROLE_SLOTS = [...ACTIVE_ROLE_SLOTS, ...LEGACY_ROLE_SLOTS];

const isLegacyRole = (r) => LEGACY_ROLE_SLOTS.some((s) => s.value === r);

const EMPTY_FORM = {
  full_name: '',
  position_title: '',
  role_slot: ACTIVE_ROLE,
  is_active: true,
  remarks: '',
};

const SignatureConfigTab = ({ readOnly = false }) => {
  const toast = useToast();

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const [legacyOpen, setLegacyOpen] = useState(false);

  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await signatureConfigApi.list({
        include_inactive: statusFilter === 'inactive' ? 1 : undefined,
        is_active: statusFilter === 'active' ? true : undefined,
      });
      if (res.ok) {
        setRows(Array.isArray(res.data) ? res.data : []);
      } else {
        setError(res?.data?.message || 'Failed to load names.');
        setRows([]);
      }
    } catch (err) {
      console.error('Signature config load error:', err);
      setError(err?.message || 'Failed to load names.');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      (r.full_name      || '').toLowerCase().includes(q) ||
      (r.position_title || '').toLowerCase().includes(q) ||
      (r.role_slot      || '').toLowerCase().includes(q) ||
      (r.remarks        || '').toLowerCase().includes(q)
    );
  }, [rows, search]);

  const activeItems = useMemo(
    () => filtered.filter((r) => r.role_slot === ACTIVE_ROLE),
    [filtered]
  );

  const legacyGroups = useMemo(() => {
    const map = {};
    for (const r of filtered) {
      if (!isLegacyRole(r.role_slot)) continue;
      const k = r.role_slot;
      if (!map[k]) map[k] = [];
      map[k].push(r);
    }
    return LEGACY_ROLE_SLOTS
      .map((s) => ({ slot: s.value, items: map[s.value] || [] }))
      .filter((g) => g.items.length > 0);
  }, [filtered]);

  const legacyTotal = useMemo(
    () => legacyGroups.reduce((sum, g) => sum + g.items.length, 0),
    [legacyGroups]
  );

  /* ---------- Write handlers (guarded by readOnly) ---------- */
  const openCreate = () => {
    if (readOnly) return;
    setEditing(null);
    setForm({ ...EMPTY_FORM });
    setFormError('');
    setShowModal(true);
  };

  const openEdit = (row) => {
    if (readOnly) return;
    setEditing(row);
    setForm({
      full_name:      row.full_name || '',
      position_title: row.position_title || '',
      role_slot:      row.role_slot || ACTIVE_ROLE,
      is_active:      row.is_active === 1 || row.is_active === true,
      remarks:        row.remarks || '',
    });
    setFormError('');
    setShowModal(true);
  };

  const closeModal = () => {
    if (saving) return;
    setShowModal(false);
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError('');
  };

  const submit = async () => {
    if (readOnly) return;
    setFormError('');
    if (!form.full_name.trim())      return setFormError('Full name is required.');
    if (!form.position_title.trim()) return setFormError('Position title is required.');
    if (!form.role_slot)             return setFormError('Role slot is required.');

    setSaving(true);
    try {
      const payload = {
        full_name:      form.full_name.trim(),
        position_title: form.position_title.trim(),
        role_slot:      form.role_slot,
        remarks:        form.remarks ? form.remarks.trim() : null,
      };
      if (editing) payload.is_active = form.is_active;

      const res = editing
        ? await signatureConfigApi.update(editing.id, payload)
        : await signatureConfigApi.create(payload);

      if (!res.ok) {
        setFormError(res?.data?.message || 'Failed to save.');
        return;
      }
      toast.success(editing ? 'Record updated.' : 'Record added.');
      setShowModal(false);
      setEditing(null);
      setForm(EMPTY_FORM);
      await load();
    } catch (err) {
      console.error('Signature config save error:', err);
      setFormError(err?.message || 'Unexpected error while saving.');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (row) => {
    if (readOnly) return;
    const isActive = row.is_active === 1 || row.is_active === true;
    const res = await signatureConfigApi.update(row.id, { is_active: !isActive });
    if (res.ok) {
      toast.success(isActive ? 'Deactivated.' : 'Activated.');
      await load();
    } else {
      toast.error(res?.data?.message || 'Could not update status.');
    }
  };

  const removeRow = async (row) => {
    if (readOnly) return;
    if (!window.confirm(
      `Delete "${row.full_name}" from ${row.role_slot}? This cannot be undone.`
    )) return;
    const res = await signatureConfigApi.remove(row.id);
    if (res.ok) {
      toast.success('Record deleted.');
      await load();
    } else {
      toast.error(res?.data?.message || 'Could not delete.');
    }
  };

  /* ---------- Row renderer ---------- */
  const renderRow = (r, variant = 'active') => {
    const isActive = r.is_active === 1 || r.is_active === true;

    const menuItems = readOnly
      ? []
      : [
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
                icon: <FiSlash />,
                onClick: () => toggleActive(r),
                variant: 'muted',
              }
            : {
                key: 'activate',
                label: 'Activate',
                icon: <FiCheckCircle />,
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
      <tr key={r.id} className={`sig-row ${variant === 'legacy' ? 'sig-row--legacy' : ''}`}>
        <td style={td}>
          <div style={{ fontWeight: 700, color: '#0f172a' }}>{r.full_name}</div>
        </td>
        <td style={td}>
          <div style={{ color: '#334155' }}>{r.position_title}</div>
        </td>
        <td style={td}>
          <span
            style={{
              display: 'inline-block',
              padding: '3px 10px',
              borderRadius: 999,
              fontSize: 12,
              fontWeight: 700,
              background: isActive ? '#dcfce7' : '#f1f5f9',
              color: isActive ? '#166534' : '#475569',
              border: isActive ? '1px solid #86efac' : '1px solid #cbd5e1',
            }}
          >
            {isActive ? 'Active' : 'Inactive'}
          </span>
        </td>
        <td style={{ ...td, color: '#64748b', fontSize: 13 }}>
          {r.remarks || '—'}
        </td>
        {!readOnly && (
          <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
            <div style={{ display: 'inline-flex', justifyContent: 'flex-end' }}>
              <ActionsMenu items={menuItems} ariaLabel={`Actions for ${r.full_name}`} />
            </div>
          </td>
        )}
      </tr>
    );
  };

  const renderTableHead = () => (
    <thead>
      <tr>
        <th style={th}>Full Name</th>
        <th style={th}>Position Title</th>
        <th style={{ width: 110, ...th }}>Status</th>
        <th style={th}>Remarks</th>
        {!readOnly && <th style={{ ...th, textAlign: 'right', width: 90 }}>Actions</th>}
      </tr>
    </thead>
  );

  /* ---------- Main render ---------- */
  return (
    <div
      style={{ padding: 24, maxWidth: 1000, margin: '0 auto', width: '100%', boxSizing: 'border-box' }}
      className="sig-root"
    >
      <style>{sigCss}</style>

      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 20,
          gap: 16,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ minWidth: 0 }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: '#0f172a' }}>
            {readOnly ? 'Authorized By Signatories' : 'Authorized By Signatories'}
          </h2>
          <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: 14 }}>
            Signatory names printed on the "Authorized By" line of the issue forms.
          </p>
        </div>

        {!readOnly && (
          <button className="sig-btn sig-btn-primary" onClick={openCreate} type="button">
            <span className="sig-plus"><FiPlus /></span>
            <span>Add Name</span>
          </button>
        )}
      </div>

      {/* Info banner */}
      <div className="sig-note">
        <FiInfo className="sig-note-icon" />
        <div>
          {readOnly ? (
            <>
              This is a <strong>read-only view</strong>. New names are added by the
              surface admin and delivered via <strong>Receive Update</strong>.
            </>
          ) : (
            <>
              Only <strong>Authorized By</strong> records are used by the issue forms.
              Legacy records from other slots are hidden below.
            </>
          )}
        </div>
      </div>

      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <input
          className="sig-input"
          style={{ ...inputBase, maxWidth: 340, flex: '1 1 260px' }}
          placeholder="Search by name, position, or remarks…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="sig-input"
          style={{ ...inputBase, maxWidth: 180, flex: '0 0 auto' }}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">Active + Inactive</option>
          <option value="active">Active only</option>
          <option value="inactive">Inactive only</option>
        </select>
      </div>

      {/* Error */}
      {error && (
        <div style={{ background: '#fee2e2', color: '#991b1b', padding: 12, borderRadius: 8, marginBottom: 12, fontSize: 14 }}>
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div style={{ padding: 40, textAlign: 'center', color: '#64748b', fontSize: 14 }}>
          Loading…
        </div>
      )}

      {/* Empty */}
      {!loading && !error && filtered.length === 0 && (
        <div style={emptyCardStyle}>
          <FiUserCheck style={{ width: 40, height: 40, color: '#cbd5e1' }} />
          <div style={{ fontWeight: 700, color: '#334155', marginTop: 8, fontSize: 15 }}>
            {search || statusFilter ? 'No records match your filters' : 'No names configured yet'}
          </div>
          <div style={{ fontSize: 13, color: '#64748b', marginTop: 4, maxWidth: 400, lineHeight: 1.5 }}>
            {search || statusFilter
              ? 'Try clearing the search or filters.'
              : readOnly
                ? 'The surface admin has not yet configured any Authorized By signatories, or the update has not been applied.'
                : 'Add the Authorized By signatories your warehouse uses — the underground handler will pick from this list.'}
          </div>
        </div>
      )}

      {/* Active section */}
      {!loading && !error && activeItems.length > 0 && (
        <section className="sig-active">
          <header className="sig-active-header">
            <span className="sig-active-rail" />
            <h3 className="sig-active-title">Authorized By</h3>
            <span className="sig-active-count">{activeItems.length}</span>
          </header>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              {renderTableHead()}
              <tbody>{activeItems.map((r) => renderRow(r, 'active'))}</tbody>
            </table>
          </div>
        </section>
      )}

      {/* Legacy section */}
      {!loading && !error && legacyTotal > 0 && (
        <details
          className="sig-legacy"
          open={legacyOpen}
          onToggle={(e) => setLegacyOpen(e.currentTarget.open)}
        >
          <summary className="sig-legacy-summary">
            <FiChevronRight className="sig-legacy-caret" />
            <FiArchive className="sig-legacy-icon" />
            <span className="sig-legacy-title">Legacy slots</span>
            <span className="sig-legacy-count">{legacyTotal}</span>
            <span className="sig-legacy-note">Not used by issue forms</span>
          </summary>

          <div className="sig-legacy-body">
            {legacyGroups.map((g) => (
              <section key={g.slot} className="sig-legacy-group">
                <header className="sig-legacy-group-header">
                  <h4 className="sig-legacy-group-title">{g.slot}</h4>
                  <span className="sig-legacy-group-count">{g.items.length}</span>
                </header>

                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                    {renderTableHead()}
                    <tbody>{g.items.map((r) => renderRow(r, 'legacy'))}</tbody>
                  </table>
                </div>
              </section>
            ))}
          </div>
        </details>
      )}

      {/* Modal (surface only) */}
      {!readOnly && showModal && (
        <div className="sig-overlay" style={overlayStyle} onClick={closeModal}>
          <div className="sig-modal" style={modalStyle} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#0f172a' }}>
                {editing ? `Edit "${editing.full_name}"` : 'Add Name & Position'}
              </h3>
              <button type="button" onClick={closeModal} disabled={saving} aria-label="Close" style={closeBtnStyle}>
                <FiX size={18} />
              </button>
            </div>

            {formError && (
              <div style={{ background: '#fee2e2', color: '#991b1b', padding: 12, borderRadius: 8, marginBottom: 12, fontSize: 14 }}>
                {formError}
              </div>
            )}

            <label style={lbl}>Full Name *</label>
            <input
              className="sig-input"
              style={inputBase}
              value={form.full_name}
              onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
              placeholder="e.g. Juan Dela Cruz"
              maxLength={150}
              disabled={saving}
            />

            <label style={{ ...lbl, marginTop: 14 }}>Position Title *</label>
            <input
              className="sig-input"
              style={inputBase}
              value={form.position_title}
              onChange={(e) => setForm((f) => ({ ...f, position_title: e.target.value }))}
              placeholder="e.g. Warehouse Supervisor"
              maxLength={150}
              disabled={saving}
            />

            <label style={{ ...lbl, marginTop: 14 }}>Role Slot *</label>

            {!editing && (
              <>
                <div className="sig-role-locked">
                  <FiUserCheck className="sig-role-locked-icon" />
                  <span>Authorized By</span>
                  <span className="sig-role-locked-badge">Active slot</span>
                </div>
                <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>
                  New records are always created as Authorized By.
                </div>
              </>
            )}

            {editing && (
              <select
                className="sig-input"
                style={inputBase}
                value={form.role_slot}
                onChange={(e) => setForm((f) => ({ ...f, role_slot: e.target.value }))}
                disabled={saving}
              >
                {ALL_ROLE_SLOTS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.value}{isLegacyRole(s.value) ? ' (legacy)' : ''}
                  </option>
                ))}
              </select>
            )}

            <label style={{ ...lbl, marginTop: 14 }}>
              Remarks <span style={{ fontWeight: 400, color: '#94a3b8' }}>(optional)</span>
            </label>
            <textarea
              className="sig-input"
              style={{ ...inputBase, minHeight: 72, resize: 'vertical' }}
              value={form.remarks}
              onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))}
              placeholder="Any note about when this name applies…"
              maxLength={500}
              disabled={saving}
            />

            {editing && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, fontSize: 15 }}>
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
                  disabled={saving}
                />
                Active
              </label>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 22 }}>
              <button className="sig-btn sig-btn-secondary" onClick={closeModal} disabled={saving} type="button">
                Cancel
              </button>
              <button className="sig-btn sig-btn-primary" onClick={submit} disabled={saving} type="button">
                {saving ? 'Saving…' : editing ? 'Save Changes' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SignatureConfigTab;

/* ============================================================
   Inline style constants
   ============================================================ */
const inputBase = {
  width: '100%',
  padding: '10px 12px',
  border: '1px solid #cbd5e1',
  borderRadius: 8,
  fontSize: 15,
  boxSizing: 'border-box',
  outline: 'none',
  transition: 'border-color 160ms ease, box-shadow 160ms ease',
  fontFamily: 'inherit',
};

const th = {
  padding: '12px 14px',
  textAlign: 'left',
  fontWeight: 700,
  fontSize: 12.5,
  color: '#334155',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  background: '#ffffff',
};

const td = {
  padding: '12px 14px',
  verticalAlign: 'top',
  fontSize: 14,
  color: '#0f172a',
  borderTop: '1px solid #f1f5f9',
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

const overlayStyle = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(15,23,42,0.5)',
  backdropFilter: 'blur(4px)',
  WebkitBackdropFilter: 'blur(4px)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 10000,
  padding: 16,
};

const modalStyle = {
  background: '#fff',
  borderRadius: 14,
  padding: 26,
  width: '100%',
  maxWidth: 540,
  maxHeight: '90vh',
  overflowY: 'auto',
  boxShadow: '0 20px 50px rgba(0,0,0,0.2)',
};

const closeBtnStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 32,
  height: 32,
  borderRadius: 8,
  padding: 0,
  background: 'transparent',
  border: 'none',
  color: '#64748b',
  cursor: 'pointer',
};

const emptyCardStyle = {
  padding: 40,
  textAlign: 'center',
  border: '1px dashed #cbd5e1',
  borderRadius: 12,
  background: '#f8fafc',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
};

/* ============================================================
   Scoped CSS — `sig-` prefix. Responsive breakpoints preserved.
   ============================================================ */
const sigCss = `
@keyframes sigFadeIn { from { opacity: 0 } to { opacity: 1 } }
@keyframes sigModalIn {
  from { opacity: 0; transform: translateY(12px) scale(0.98) }
  to   { opacity: 1; transform: translateY(0)    scale(1)    }
}

.sig-overlay { animation: sigFadeIn 180ms ease; }
.sig-modal   { animation: sigModalIn 220ms cubic-bezier(0.34, 1.3, 0.64, 1); }

.sig-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  padding: 11px 20px;
  font-family: inherit; font-size: 14.5px; font-weight: 700;
  letter-spacing: 0.01em; border-radius: 10px;
  cursor: pointer; position: relative; user-select: none;
  border: 1px solid transparent; border-bottom-width: 2px;
  will-change: transform, box-shadow;
  transition: transform 180ms cubic-bezier(0.34, 1.4, 0.64, 1),
              box-shadow 200ms ease, background 160ms ease,
              border-color 160ms ease, color 160ms ease;
}
.sig-btn:disabled { opacity: 0.5; cursor: not-allowed; transform: none !important; box-shadow: none !important; filter: saturate(0.6); }

.sig-btn-primary {
  background: #00b8b0; color: #ffffff; border-color: #007a72;
  text-shadow: 0 1px 1px rgba(0,0,0,0.18);
  box-shadow: 0 1px 0 rgba(255,255,255,0.32) inset, 0 2px 4px rgba(0, 122, 114, 0.28), 0 6px 16px rgba(0, 184, 176, 0.28);
}
.sig-btn-primary:hover:not(:disabled) {
  transform: translateY(-2px);
  background: #00d4cb;
  border-color: #008a82;
  box-shadow: 0 1px 0 rgba(255,255,255,0.4) inset, 0 4px 10px rgba(0, 122, 114, 0.36), 0 14px 32px rgba(0, 184, 176, 0.48), 0 0 0 4px rgba(0, 184, 176, 0.24);
}
.sig-btn-primary:active:not(:disabled) {
  transform: translateY(0);
  background: #00a29b;
  box-shadow: 0 2px 6px rgba(0, 122, 114, 0.4) inset, 0 1px 2px rgba(0, 122, 114, 0.3);
}

.sig-plus {
  display: inline-flex; align-items: center; justify-content: center;
  width: 22px; height: 22px; border-radius: 7px;
  background: rgba(0, 0, 0, 0.14); font-size: 14px; line-height: 1;
  transition: transform 320ms cubic-bezier(0.34, 1.5, 0.64, 1), background 220ms ease;
}
.sig-plus svg { width: 14px; height: 14px; stroke-width: 2.6; }
.sig-btn-primary:hover:not(:disabled) .sig-plus { transform: rotate(180deg) scale(1.15); background: rgba(0, 0, 0, 0.22); }

.sig-btn-secondary {
  background: #ffffff; color: #1e293b; border-color: #94a3b8;
  box-shadow: 0 1px 0 rgba(255,255,255,0.9) inset, 0 1px 3px rgba(15, 23, 42, 0.1);
}
.sig-btn-secondary:hover:not(:disabled) {
  transform: translateY(-2px);
  background: #f0fdfa; border-color: #00b8b0; color: #007a72;
  box-shadow: 0 1px 0 rgba(255,255,255,1) inset, 0 4px 10px rgba(0, 184, 176, 0.22), 0 14px 32px rgba(0, 184, 176, 0.24), 0 0 0 4px rgba(0, 184, 176, 0.16);
}
.sig-btn-secondary:active:not(:disabled) { transform: translateY(0); background: #e6fffb; }

.sig-input:hover:not(:disabled) { border-color: #94a3b8; }
.sig-input:focus { border-color: #00b8b0; box-shadow: 0 0 0 4px rgba(0, 184, 176, 0.2); }
.sig-input:disabled { background: #f8fafc; color: #94a3b8; cursor: not-allowed; }

.sig-note {
  display: flex; align-items: flex-start; gap: 10px;
  padding: 12px 14px; margin-bottom: 16px;
  background: #eff6ff; border: 1px solid #bfdbfe;
  border-left: 4px solid #3b82f6; border-radius: 10px;
  font-size: 13px; line-height: 1.5; color: #1e40af;
}
.sig-note-icon { width: 18px; height: 18px; flex-shrink: 0; margin-top: 1px; }
.sig-note strong { font-weight: 700; }

.sig-active { margin-bottom: 22px; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; }
.sig-active-header { display: flex; align-items: center; gap: 10px; padding: 12px 16px; background: #f8fafc; border-bottom: 1px solid #e2e8f0; }
.sig-active-rail { display: inline-block; width: 4px; height: 16px; background: linear-gradient(180deg, #00e0d4 0%, #008a82 100%); border-radius: 2px; }
.sig-active-title { margin: 0; font-size: 14px; font-weight: 800; color: #0f172a; letter-spacing: 0.01em; }
.sig-active-count { font-size: 11px; font-weight: 700; color: #0f766e; background: #f0fdfa; border: 1px solid #99f6e4; border-radius: 999px; padding: 2px 10px; }

.sig-row { transition: background 160ms ease, box-shadow 160ms ease; border-left: 3px solid transparent; }
.sig-row:hover { background: linear-gradient(90deg, #f0fdfa 0%, #ecfeff 100%); border-left-color: #00b8b0; box-shadow: 0 1px 4px rgba(0, 184, 176, 0.08); }
.sig-row--legacy:hover { background: linear-gradient(90deg, #f8fafc 0%, #f1f5f9 100%); border-left-color: #94a3b8; box-shadow: 0 1px 4px rgba(15, 23, 42, 0.05); }

.sig-legacy { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; margin-top: 4px; }
.sig-legacy-summary { display: flex; align-items: center; gap: 10px; padding: 12px 16px; cursor: pointer; list-style: none; user-select: none; border-radius: 12px; transition: background 140ms ease; }
.sig-legacy-summary::-webkit-details-marker { display: none; }
.sig-legacy-summary:hover { background: #f1f5f9; }
.sig-legacy-summary:focus-visible { outline: 2px solid #00b8b0; outline-offset: -2px; }
.sig-legacy-caret { width: 14px; height: 14px; flex-shrink: 0; color: #64748b; transition: transform 200ms ease; }
.sig-legacy[open] .sig-legacy-caret { transform: rotate(90deg); }
.sig-legacy-icon { width: 16px; height: 16px; flex-shrink: 0; color: #94a3b8; }
.sig-legacy-title { font-size: 13.5px; font-weight: 800; color: #334155; letter-spacing: 0.01em; }
.sig-legacy-count { font-size: 11px; font-weight: 700; color: #475569; background: #ffffff; border: 1px solid #cbd5e1; border-radius: 999px; padding: 2px 10px; }
.sig-legacy-note { margin-left: auto; font-size: 10.5px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: #94a3b8; }
.sig-legacy-body { padding: 6px 12px 14px; display: flex; flex-direction: column; gap: 16px; }
.sig-legacy-group { background: #ffffff; border: 1px solid #e2e8f0; border-radius: 10px; overflow: hidden; }
.sig-legacy-group-header { display: flex; align-items: center; gap: 8px; padding: 10px 14px; background: #f8fafc; border-bottom: 1px solid #e2e8f0; }
.sig-legacy-group-title { margin: 0; font-size: 12.5px; font-weight: 800; color: #475569; letter-spacing: 0.01em; }
.sig-legacy-group-count { font-size: 10.5px; font-weight: 700; color: #64748b; background: #ffffff; border: 1px solid #cbd5e1; border-radius: 999px; padding: 1px 8px; }

.sig-role-locked {
  display: flex; align-items: center; gap: 10px; padding: 10px 12px;
  background: linear-gradient(135deg, #ecfeff 0%, #f0fdfa 100%);
  border: 1.5px solid #99f6e4; border-radius: 8px;
  font-size: 14px; font-weight: 700; color: #0f172a;
}
.sig-role-locked-icon { width: 16px; height: 16px; flex-shrink: 0; color: #0f766e; }
.sig-role-locked-badge { margin-left: auto; font-size: 9.5px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; color: #0f766e; background: #ffffff; border: 1px solid #99f6e4; border-radius: 999px; padding: 2px 8px; }

/* ============================================================
   Responsive breakpoints — preserved from original
   ============================================================ */
@media (max-width: 640px) {
  .sig-root { padding: 12px !important; }
  .sig-btn { padding: 10px 16px; font-size: 13.5px; }
  .sig-note { font-size: 12.5px; padding: 10px 12px; }
  .sig-legacy-body { padding: 6px 8px 12px; }
  .sig-legacy-note { display: none; }
}
@media (max-width: 400px) {
  .sig-btn { padding: 9px 14px; font-size: 13px; }
  .sig-plus { width: 20px; height: 20px; }
}
@media (prefers-reduced-motion: reduce) {
  .sig-btn, .sig-plus, .sig-overlay, .sig-modal, .sig-row, .sig-legacy-caret {
    animation: none !important; transition: none !important;
  }
  .sig-btn:hover:not(:disabled) { transform: none !important; }
  .sig-btn-primary:hover:not(:disabled) .sig-plus { transform: none !important; }
}
`;