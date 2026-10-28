// src/components/admin/TabUomConversion.jsx
// Responsive UOM Conversions tab.
// - Super Admin + Registrar + Handler → view-only (no CRUD actions rendered).
// - Admin                             → full configure (create/edit/delete).
// Uses inline styles so it works regardless of the surrounding CSS file,
// and adapts cleanly across phone / tablet / laptop / monitor sizes.
import React, { useEffect, useRef, useState } from 'react';
import {
  FiPlus,
  FiSearch,
  FiEdit2,
  FiTrash2,
  FiChevronLeft,
  FiChevronRight,
  FiX,
  FiCheck,
  FiPackage,
  FiRefreshCw,
} from 'react-icons/fi';
import { getUser } from '../../secure/auth';
import { ROLES, normalizeRole } from '../../permissions/roles';
import { roleCan } from '../../permissions/permissions';

// ---------------------------------------------------------------------------
// Reusable searchable dropdown (built inline so this tab is self-contained)
// ---------------------------------------------------------------------------
const SearchableSelect = ({
  options = [],
  value,
  onChange,
  placeholder = 'Select…',
  disabled = false,
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef(null);

  useEffect(() => {
    const onDocClick = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const selected = options.find((o) => o.value === value);
  const q = query.trim().toLowerCase();
  const filtered = q
    ? options.filter(
        (o) =>
          o.value.toLowerCase().includes(q) ||
          (o.label || '').toLowerCase().includes(q)
      )
    : options;

  return (
    <div ref={rootRef} style={{ position: 'relative', width: '100%' }}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((o) => !o)}
        style={{
          width: '100%',
          padding: '8px 12px',
          border: '1px solid #cbd5e1',
          borderRadius: 6,
          background: disabled ? '#f1f5f9' : '#ffffff',
          cursor: disabled ? 'not-allowed' : 'pointer',
          textAlign: 'left',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          minHeight: 38,
          fontSize: 13,
          color: selected ? '#0f172a' : '#94a3b8',
        }}
      >
        <span
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {selected
            ? `${selected.value}${selected.label ? ` — ${selected.label}` : ''}`
            : placeholder}
        </span>
        <span style={{ color: '#64748b', fontSize: 11, flexShrink: 0 }}>▾</span>
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            zIndex: 60,
            top: 'calc(100% + 4px)',
            left: 0,
            right: 0,
            background: '#ffffff',
            border: '1px solid #cbd5e1',
            borderRadius: 6,
            boxShadow: '0 12px 32px rgba(15, 23, 42, 0.16)',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            maxHeight: 280,
          }}
        >
          <div style={{ padding: 8, borderBottom: '1px solid #e2e8f0' }}>
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search item code…"
              style={{
                width: '100%',
                padding: '6px 8px',
                border: '1px solid #cbd5e1',
                borderRadius: 4,
                fontSize: 12,
                boxSizing: 'border-box',
              }}
            />
          </div>
          <div style={{ overflowY: 'auto', maxHeight: 220 }}>
            {filtered.length === 0 && (
              <div
                style={{
                  padding: 12,
                  fontSize: 12,
                  color: '#94a3b8',
                  textAlign: 'center',
                }}
              >
                No matches
              </div>
            )}
            {filtered.slice(0, 200).map((opt) => {
              const isSel = opt.value === value;
              return (
                <div
                  key={opt.value}
                  onClick={() => {
                    onChange(opt.value);
                    setOpen(false);
                    setQuery('');
                  }}
                  style={{
                    padding: '8px 10px',
                    cursor: 'pointer',
                    background: isSel ? '#eff6ff' : '#ffffff',
                    borderBottom: '1px solid #f1f5f9',
                    fontSize: 12,
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = '#f8fafc')}
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = isSel ? '#eff6ff' : '#ffffff')
                  }
                >
                  <div style={{ fontWeight: 600, color: '#0f172a' }}>{opt.value}</div>
                  {opt.label && (
                    <div style={{ color: '#64748b', fontSize: 11, marginTop: 2 }}>
                      {opt.label}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------
const formatDate = (d) => {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleString();
  } catch {
    return '—';
  }
};

// ---------------------------------------------------------------------------
// Create / Edit Modal
// ---------------------------------------------------------------------------
const UomConversionModal = ({
  isEdit,
  itemOptions,
  value,
  onChange,
  onSave,
  onClose,
  saving,
}) => {
  const items = Array.isArray(itemOptions) ? itemOptions : [];

  const setField = (field, v) => onChange({ ...value, [field]: v });

  const pieces = parseInt(value.pieces_per_box, 10);
  const valid =
    Boolean(value.box_item_code) &&
    Boolean(value.piece_item_code) &&
    Number.isFinite(pieces) &&
    pieces > 0 &&
    value.box_item_code !== value.piece_item_code;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 23, 42, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        zIndex: 1000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#ffffff',
          borderRadius: 10,
          width: '100%',
          maxWidth: 520,
          maxHeight: '92vh',
          overflowY: 'auto',
          boxShadow: '0 24px 60px rgba(15, 23, 42, 0.35)',
        }}
      >
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid #e2e8f0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#0f172a' }}>
            {isEdit ? 'Edit UOM Conversion' : 'Add UOM Conversion'}
          </h3>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: '#64748b',
              padding: 4,
            }}
          >
            <FiX size={18} />
          </button>
        </div>

        <div
          style={{
            padding: 20,
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
          }}
        >
          <div>
            <label style={labelStyle}>Box Item Code *</label>
            <SearchableSelect
              options={items.map((i) => ({
                value: i.Item_Code,
                label: i.Item_Description,
              }))}
              value={value.box_item_code}
              onChange={(v) => setField('box_item_code', v)}
              placeholder="Select box item code…"
            />
          </div>

          <div>
            <label style={labelStyle}>Piece Item Code *</label>
            <SearchableSelect
              options={items.map((i) => ({
                value: i.Item_Code,
                label: i.Item_Description,
              }))}
              value={value.piece_item_code}
              onChange={(v) => setField('piece_item_code', v)}
              placeholder="Select piece item code…"
            />
          </div>

          <div>
            <label style={labelStyle}>Pieces per Box *</label>
            <input
              type="number"
              min="1"
              step="1"
              value={value.pieces_per_box}
              onChange={(e) => setField('pieces_per_box', e.target.value)}
              style={inputStyle}
            />
            {Number.isFinite(pieces) && pieces > 0 && (
              <div
                style={{
                  marginTop: 6,
                  fontSize: 11,
                  color: '#475569',
                }}
              >
                1 Box = {pieces.toLocaleString()} piece
                {pieces === 1 ? '' : 's'}
              </div>
            )}
          </div>

          <div>
            <label style={labelStyle}>Status</label>
            <select
              value={value.Status || 'Active'}
              onChange={(e) => setField('Status', e.target.value)}
              style={inputStyle}
            >
              <option value="Active">Active</option>
              <option value="Inactive">Inactive</option>
            </select>
          </div>

          {value.box_item_code && value.piece_item_code && value.box_item_code === value.piece_item_code && (
            <div style={{ fontSize: 12, color: '#b91c1c', fontWeight: 600 }}>
              Box and Piece item codes must be different.
            </div>
          )}
        </div>

        <div
          style={{
            padding: '12px 20px',
            borderTop: '1px solid #e2e8f0',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          <button
            onClick={onClose}
            disabled={saving}
            style={{
              padding: '8px 14px',
              borderRadius: 6,
              border: '1px solid #cbd5e1',
              background: '#ffffff',
              color: '#0f172a',
              fontWeight: 600,
              fontSize: 13,
              cursor: saving ? 'not-allowed' : 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            disabled={!valid || saving}
            onClick={onSave}
            style={{
              padding: '8px 14px',
              borderRadius: 6,
              border: 'none',
              background: valid && !saving ? '#2563eb' : '#94a3b8',
              color: '#ffffff',
              fontWeight: 600,
              fontSize: 13,
              cursor: valid && !saving ? 'pointer' : 'not-allowed',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <FiCheck size={14} />
            {saving ? 'Saving…' : isEdit ? 'Update' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
};

const labelStyle = {
  display: 'block',
  fontSize: 12,
  fontWeight: 600,
  color: '#334155',
  marginBottom: 6,
};
const inputStyle = {
  width: '100%',
  padding: '8px 10px',
  border: '1px solid #cbd5e1',
  borderRadius: 6,
  fontSize: 13,
  boxSizing: 'border-box',
};

// ---------------------------------------------------------------------------
// Main Tab
// ---------------------------------------------------------------------------
const TabUomConversion = ({ adminData }) => {
  const currentUser = getUser();
  const role = normalizeRole(currentUser);
  const isSuperAdmin = role === ROLES.SUPER_ADMIN;

  // Super Admin is view-only by design; every other role follows its capability list.
  const canCreate = !isSuperAdmin && roleCan(role, 'uomconversions.create');
  const canEdit   = !isSuperAdmin && roleCan(role, 'uomconversions.edit');
  const canDelete = !isSuperAdmin && roleCan(role, 'uomconversions.delete');
  const canConfigure = canCreate || canEdit || canDelete;

  const {
    uomConversionRecords,
    uomConversionLoading,
    uomConversionCurrentPage,
    setUomConversionCurrentPage,
    uomConversionTotalPages,
    uomConversionTotalCount,
    uomConversionSearchTerm,
    setUomConversionSearchTerm,
    uomConversionItemOptions,
    showCreateUomConversionForm,
    setShowCreateUomConversionForm,
    newUomConversion,
    setNewUomConversion,
    showEditUomConversionModal,
    setShowEditUomConversionModal,
    editUomConversionData,
    setEditUomConversionData,
    fetchUomConversions,
    fetchUomConversionItemOptions,
    handleSaveUomConversion,
    handleEditUomConversion,
    handleUpdateUomConversion,
    handleDeleteUomConversion,
    handleCloseUomConversionForm,
    handleCloseEditUomConversionModal,
  } = adminData;

  const [localSearch, setLocalSearch] = useState(uomConversionSearchTerm || '');
  const [saving, setSaving] = useState(false);

  // Fetch on mount
  useEffect(() => {
    fetchUomConversions(1);
    fetchUomConversionItemOptions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSearchSubmit = (e) => {
    if (e) e.preventDefault();
    setUomConversionSearchTerm(localSearch);
    fetchUomConversions(1);
  };

  const handleClearSearch = () => {
    setLocalSearch('');
    setUomConversionSearchTerm('');
    fetchUomConversions(1);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (showEditUomConversionModal) {
        await handleUpdateUomConversion();
      } else {
        await handleSaveUomConversion();
      }
    } finally {
      setSaving(false);
    }
  };

  const handleManualRefresh = () => {
    fetchUomConversions(uomConversionCurrentPage);
  };

  const showPager = uomConversionTotalPages > 1;

  return (
    <div
      style={{
        padding: '16px 12px 40px',
        maxWidth: '100%',
        overflowX: 'hidden',
        boxSizing: 'border-box',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 12,
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 16,
        }}
      >
        <div style={{ minWidth: 0, flex: '1 1 240px' }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#0f172a' }}>
            UOM Conversions
          </h2>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: '#64748b' }}>
            Define Box → Pieces conversion rules. Total pieces = Boxes × Pieces per Box.
          </p>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            onClick={handleManualRefresh}
            disabled={uomConversionLoading}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 12px',
              borderRadius: 6,
              border: '1px solid #cbd5e1',
              background: '#ffffff',
              color: '#0f172a',
              fontWeight: 600,
              fontSize: 13,
              cursor: uomConversionLoading ? 'not-allowed' : 'pointer',
            }}
          >
            <FiRefreshCw size={14} /> Refresh
          </button>

          {canConfigure && (
            <button
              onClick={() => setShowCreateUomConversionForm(true)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 14px',
                borderRadius: 6,
                border: 'none',
                background: '#2563eb',
                color: '#ffffff',
                fontWeight: 600,
                fontSize: 13,
                cursor: 'pointer',
                boxShadow: '0 1px 3px rgba(37, 99, 235, 0.4)',
              }}
            >
              <FiPlus size={16} /> Add Conversion
            </button>
          )}
        </div>
      </div>

      {/* Search bar */}
      <form
        onSubmit={handleSearchSubmit}
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 8,
          marginBottom: 16,
          maxWidth: 560,
        }}
      >
        <div style={{ position: 'relative', flex: '1 1 240px', minWidth: 0 }}>
          <FiSearch
            style={{
              position: 'absolute',
              left: 10,
              top: '50%',
              transform: 'translateY(-50%)',
              color: '#94a3b8',
              pointerEvents: 'none',
            }}
          />
          <input
            value={localSearch}
            onChange={(e) => setLocalSearch(e.target.value)}
            placeholder="Search by item code or description…"
            style={{
              width: '100%',
              padding: '9px 12px 9px 34px',
              border: '1px solid #cbd5e1',
              borderRadius: 6,
              fontSize: 13,
              boxSizing: 'border-box',
            }}
          />
          {localSearch && (
            <button
              type="button"
              onClick={handleClearSearch}
              title="Clear"
              style={{
                position: 'absolute',
                right: 8,
                top: '50%',
                transform: 'translateY(-50%)',
                border: 'none',
                background: 'transparent',
                color: '#94a3b8',
                cursor: 'pointer',
                padding: 4,
              }}
            >
              <FiX size={14} />
            </button>
          )}
        </div>
        <button
          type="submit"
          style={{
            padding: '9px 16px',
            borderRadius: 6,
            border: 'none',
            background: '#0f172a',
            color: '#ffffff',
            fontWeight: 600,
            fontSize: 13,
            cursor: 'pointer',
          }}
        >
          Search
        </button>
      </form>

      {/* Table card */}
      <div
        style={{
          background: '#ffffff',
          borderRadius: 8,
          border: '1px solid #e2e8f0',
          overflow: 'hidden',
          boxShadow: '0 1px 3px rgba(15, 23, 42, 0.05)',
        }}
      >
        <div style={{ overflowX: 'auto' }}>
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              minWidth: 720,
            }}
          >
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                <th style={th}>Box Item Code</th>
                <th style={th}>Box Description</th>
                <th style={th}>Piece Item Code</th>
                <th style={th}>Piece Description</th>
                <th style={{ ...th, textAlign: 'right' }}>Pieces / Box</th>
                <th style={th}>Status</th>
                <th style={th}>Updated</th>
                {canConfigure && <th style={{ ...th, textAlign: 'right' }}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {uomConversionLoading && (
                <tr>
                  <td
                    colSpan={canConfigure ? 8 : 7}
                    style={{
                      ...td,
                      textAlign: 'center',
                      color: '#64748b',
                      padding: 32,
                    }}
                  >
                    Loading…
                  </td>
                </tr>
              )}

              {!uomConversionLoading && uomConversionRecords.length === 0 && (
                <tr>
                  <td
                    colSpan={canConfigure ? 8 : 7}
                    style={{
                      ...td,
                      textAlign: 'center',
                      color: '#94a3b8',
                      padding: 48,
                    }}
                  >
                    <FiPackage size={28} style={{ marginBottom: 8, opacity: 0.5 }} />
                    <div style={{ fontSize: 13 }}>
                      {uomConversionSearchTerm
                        ? 'No conversions match your search.'
                        : 'No UOM conversions configured yet.'}
                    </div>
                  </td>
                </tr>
              )}

              {!uomConversionLoading &&
                uomConversionRecords.map((row) => (
                  <tr
                    key={row.conversion_id}
                    style={{ borderBottom: '1px solid #f1f5f9' }}
                  >
                    <td style={{ ...td, fontWeight: 600, whiteSpace: 'nowrap' }}>
                      {row.box_item_code}
                    </td>
                    <td style={{ ...td, minWidth: 180 }}>{row.box_description || '—'}</td>
                    <td style={{ ...td, fontWeight: 600, whiteSpace: 'nowrap' }}>
                      {row.piece_item_code}
                    </td>
                    <td style={{ ...td, minWidth: 180 }}>{row.piece_description || '—'}</td>
                    <td
                      style={{
                        ...td,
                        textAlign: 'right',
                        fontVariantNumeric: 'tabular-nums',
                        fontWeight: 600,
                      }}
                    >
                      {Number(row.pieces_per_box).toLocaleString()}
                    </td>
                    <td style={td}>
                      <span
                        style={{
                          display: 'inline-block',
                          padding: '2px 8px',
                          borderRadius: 999,
                          fontSize: 11,
                          fontWeight: 600,
                          background:
                            row.Status === 'Active' ? '#dcfce7' : '#fee2e2',
                          color:
                            row.Status === 'Active' ? '#166534' : '#991b1b',
                        }}
                      >
                        {row.Status || 'Active'}
                      </span>
                    </td>
                    <td
                      style={{
                        ...td,
                        color: '#64748b',
                        fontSize: 12,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {formatDate(row.Updated_At || row.Created_At)}
                    </td>
                    {canConfigure && (
                      <td
                        style={{
                          ...td,
                          textAlign: 'right',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {canEdit && (
                          <button
                            onClick={() => handleEditUomConversion(row)}
                            style={iconBtn}
                            title="Edit"
                          >
                            <FiEdit2 size={14} />
                          </button>
                        )}
                        {canDelete && (
                          <button
                            onClick={() => handleDeleteUomConversion(row)}
                            style={{ ...iconBtn, color: '#dc2626' }}
                            title="Delete"
                          >
                            <FiTrash2 size={14} />
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 8,
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 14px',
            background: '#f8fafc',
            borderTop: '1px solid #e2e8f0',
            fontSize: 12,
            color: '#475569',
          }}
        >
          <div>
            {uomConversionTotalCount} conversion
            {uomConversionTotalCount === 1 ? '' : 's'}
            {showPager &&
              ` • Page ${uomConversionCurrentPage} of ${uomConversionTotalPages}`}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              disabled={uomConversionCurrentPage <= 1 || uomConversionLoading}
              onClick={() => {
                const p = uomConversionCurrentPage - 1;
                setUomConversionCurrentPage(p);
                fetchUomConversions(p);
              }}
              style={pagerBtn(
                uomConversionCurrentPage <= 1 || uomConversionLoading
              )}
            >
              <FiChevronLeft size={14} /> Prev
            </button>
            <button
              disabled={
                uomConversionCurrentPage >= uomConversionTotalPages ||
                uomConversionLoading
              }
              onClick={() => {
                const p = uomConversionCurrentPage + 1;
                setUomConversionCurrentPage(p);
                fetchUomConversions(p);
              }}
              style={pagerBtn(
                uomConversionCurrentPage >= uomConversionTotalPages ||
                  uomConversionLoading
              )}
            >
              Next <FiChevronRight size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* Modals */}
      {(showCreateUomConversionForm || showEditUomConversionModal) && (
        <UomConversionModal
          isEdit={showEditUomConversionModal}
          itemOptions={uomConversionItemOptions}
          value={
            showEditUomConversionModal ? editUomConversionData : newUomConversion
          }
          onChange={
            showEditUomConversionModal
              ? setEditUomConversionData
              : setNewUomConversion
          }
          onSave={handleSave}
          onClose={
            showEditUomConversionModal
              ? handleCloseEditUomConversionModal
              : handleCloseUomConversionForm
          }
          saving={saving}
        />
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Shared small styles
// ---------------------------------------------------------------------------
const th = {
  textAlign: 'left',
  padding: '10px 12px',
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: '#475569',
  fontWeight: 700,
  whiteSpace: 'nowrap',
};

const td = {
  padding: '10px 12px',
  fontSize: 13,
  color: '#0f172a',
  verticalAlign: 'middle',
};

const iconBtn = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 30,
  height: 30,
  borderRadius: 6,
  border: '1px solid #e2e8f0',
  background: '#ffffff',
  color: '#2563eb',
  cursor: 'pointer',
  marginLeft: 6,
};

const pagerBtn = (disabled) => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '6px 10px',
  borderRadius: 6,
  border: '1px solid #cbd5e1',
  background: disabled ? '#f1f5f9' : '#ffffff',
  color: disabled ? '#94a3b8' : '#0f172a',
  cursor: disabled ? 'not-allowed' : 'pointer',
  fontSize: 12,
  fontWeight: 600,
});

export default TabUomConversion;