// src/components/locator/LocatorFormModal.jsx
import React, { useState } from 'react';
import { FiMapPin, FiX } from 'react-icons/fi';
import { locatorsApi } from '../../services/api';
import ModalBanner from '../shared/ModalBanner';

const LocatorFormModal = ({
  locator,
  warehouseCode,
  purchaseClasses,
  categories,
  onClose,
  onSaved,
}) => {
  const isEdit = !!locator;
  const [form, setForm] = useState({
    locator_code:   locator?.locator_code   || '',
    locator_name:   locator?.locator_name   || locator?.description || '',
    purchase_class: locator?.purchase_class || '',
    category:       locator?.category       || '',
    status:         locator?.status         || 'Active',
  });
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState(null);

  const handleChange = (k) => (e) => {
    setForm({ ...form, [k]: e.target.value });
    if (feedback) setFeedback(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFeedback(null);

    if (!form.locator_code.trim()) {
      setFeedback({
        type: 'warning',
        title: 'Code required',
        message: 'Locator code is required.',
      });
      return;
    }

    setSaving(true);
    try {
      const payload = { ...form, warehouse_code: warehouseCode };
      const res = isEdit
        ? await locatorsApi.update(locator.locator_code, payload)
        : await locatorsApi.create(payload);

      if (!res.ok || res.data?.success === false) {
        setFeedback({
          type: 'error',
          title: isEdit ? 'Update failed' : 'Create failed',
          message: res.data?.message || 'Failed to save locator.',
        });
        return;
      }
      onSaved?.();
      onClose?.();
    } catch (err) {
      console.error(err);
      setFeedback({
        type: 'error',
        title: 'Save failed',
        message: 'Unexpected error while saving.',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <style>{modalCss}</style>

      <div className="lfm-overlay" onClick={saving ? undefined : onClose}>
        <div className="lfm-card" onClick={(e) => e.stopPropagation()}>

          {/* ---------- HEADER ---------- */}
          <div className="lfm-header">
            <div className="lfm-header-left">
              <div className="lfm-header-icon"><FiMapPin /></div>
              <div className="lfm-header-info">
                <h3 className="lfm-header-title">
                  {isEdit ? 'Edit Locator' : 'Add Locator'}
                </h3>
                {warehouseCode && (
                  <div className="lfm-header-sub">
                    Warehouse: <span className="lfm-header-mono">{warehouseCode}</span>
                  </div>
                )}
              </div>
            </div>
            <button
              type="button"
              className="lfm-close"
              onClick={onClose}
              disabled={saving}
              aria-label="Close"
            ><FiX /></button>
          </div>

          {/* ---------- BODY ---------- */}
          <form className="lfm-body" onSubmit={handleSubmit}>
            {feedback && (
              <ModalBanner
                type={feedback.type}
                title={feedback.title}
                message={feedback.message}
                onClose={() => setFeedback(null)}
              />
            )}

            <div className="lfm-field">
              <label className="lfm-label" htmlFor="lfm-code">
                Locator Code <span className="lfm-required">*</span>
              </label>
              <input
                id="lfm-code"
                className="lfm-input"
                value={form.locator_code}
                onChange={handleChange('locator_code')}
                placeholder="e.g. A-01-03"
                disabled={saving || isEdit}
                title={isEdit ? 'Code cannot be changed once set' : ''}
              />
              {isEdit && (
                <small className="lfm-hint">
                  Code cannot be changed once set
                </small>
              )}
            </div>

            <div className="lfm-field">
              <label className="lfm-label" htmlFor="lfm-name">
                Name / Description
              </label>
              <input
                id="lfm-name"
                className="lfm-input"
                value={form.locator_name}
                onChange={handleChange('locator_name')}
                placeholder="e.g. Compressor Left Aisle"
                disabled={saving}
              />
            </div>

            <div className="lfm-field">
              <label className="lfm-label" htmlFor="lfm-pc">
                Purchase Class
              </label>
              <input
                id="lfm-pc"
                className="lfm-input"
                value={form.purchase_class}
                onChange={handleChange('purchase_class')}
                placeholder="e.g. IT Equipment"
                disabled={saving}
                list="lfm-pc-list"
              />
              <datalist id="lfm-pc-list">
                {purchaseClasses.map((pc) => (
                  <option key={pc.value} value={pc.value} />
                ))}
              </datalist>
            </div>

            <div className="lfm-field">
              <label className="lfm-label" htmlFor="lfm-cat">
                Category
              </label>
              <input
                id="lfm-cat"
                className="lfm-input"
                value={form.category}
                onChange={handleChange('category')}
                placeholder="e.g. Consumables"
                disabled={saving}
                list="lfm-cat-list"
              />
              <datalist id="lfm-cat-list">
                {categories.map((c) => (
                  <option key={c.value} value={c.value} />
                ))}
              </datalist>
            </div>

            <div className="lfm-field">
              <label className="lfm-label" htmlFor="lfm-status">
                Status
              </label>
              <select
                id="lfm-status"
                className="lfm-input"
                value={form.status}
                onChange={handleChange('status')}
                disabled={saving}
              >
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
              </select>
            </div>

            <div className="lfm-footer">
              <button
                type="button"
                onClick={onClose}
                className="lfm-btn-ghost"
                disabled={saving}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="lfm-btn-primary"
                disabled={saving}
              >
                {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Locator'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
};

/* ============================================================ */
const modalCss = `
@keyframes lfmFadeIn { from { opacity: 0 } to { opacity: 1 } }
@keyframes lfmSlideUp { from { opacity: 0; transform: translateY(16px) scale(0.98) } to { opacity: 1; transform: translateY(0) scale(1) } }

.lfm-overlay {
  position: fixed; inset: 0;
  background: rgba(15, 23, 42, 0.62);
  backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
  display: flex; align-items: center; justify-content: center;
  z-index: 10000;
  padding: clamp(8px, 2vw, 24px);
  animation: lfmFadeIn 0.18s ease;
}
.lfm-card {
  background: #ffffff;
  border-radius: clamp(12px, 1.5vw, 16px);
  width: 100%;
  max-width: 520px;
  max-height: 92vh;
  max-height: 92dvh;
  display: flex; flex-direction: column;
  overflow: hidden;
  box-shadow: 0 24px 64px rgba(15, 23, 42, 0.28), 0 4px 14px rgba(15, 23, 42, 0.14);
  animation: lfmSlideUp 0.22s cubic-bezier(0.34, 1.3, 0.64, 1);
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}

.lfm-header {
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px;
  padding: clamp(14px, 1.8vw, 20px) clamp(18px, 2.4vw, 22px);
  border-bottom: 1px solid #e5e7eb;
  background: linear-gradient(135deg, #ffffff 0%, #f8fafc 100%);
  flex-shrink: 0;
}
.lfm-header-left { display: flex; align-items: center; gap: 12px; min-width: 0; flex: 1; }
.lfm-header-info { min-width: 0; }
.lfm-header-icon {
  width: 40px; height: 40px; border-radius: 10px;
  background: linear-gradient(135deg, #00e0d4 0%, #008a82 100%);
  color: #fff; display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
  box-shadow: 0 4px 12px rgba(0, 210, 200, 0.32);
}
.lfm-header-icon svg {
  width: 20px; height: 20px; stroke-width: 2.2;
  color: #ffffff;
}
.lfm-header-title {
  margin: 0; font-size: clamp(15px, 1.5vw, 18px); font-weight: 700;
  color: #0f172a; line-height: 1.2;
}
.lfm-header-sub {
  font-size: 12px; color: #64748b; margin-top: 2px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.lfm-header-mono {
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-weight: 700; color: #0f766e;
}
.lfm-close {
  background: transparent; border: none;
  width: 36px; height: 36px; border-radius: 8px; cursor: pointer;
  color: #64748b; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
}
.lfm-close svg { width: 18px; height: 18px; stroke-width: 2.4; }
.lfm-close:hover:not(:disabled) { background: #f1f5f9; color: #0f172a; }
.lfm-close:disabled { opacity: 0.4; cursor: not-allowed; }

.lfm-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: clamp(16px, 2vw, 22px);
  display: flex; flex-direction: column;
  gap: 14px;
  background: #ffffff;
  -webkit-overflow-scrolling: touch;
}
.lfm-body > * { flex-shrink: 0; }

.lfm-body::-webkit-scrollbar { width: 8px; }
.lfm-body::-webkit-scrollbar-track { background: #f1f5f9; border-radius: 4px; }
.lfm-body::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 4px; }
.lfm-body::-webkit-scrollbar-thumb:hover { background: #94a3b8; }

.lfm-field { display: flex; flex-direction: column; gap: 6px; }
.lfm-label { font-size: 13px; font-weight: 600; color: #334155; }
.lfm-required { color: #dc2626; font-weight: 700; }
.lfm-hint { font-size: 11px; color: #94a3b8; margin-top: 2px; }

.lfm-input {
  width: 100%; padding: 10px 12px;
  border: 1px solid #cbd5e1; border-radius: 8px;
  font-size: 14px; font-family: inherit; color: #0f172a; outline: none;
  background: #fff;
  box-sizing: border-box;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.lfm-input:focus {
  border-color: #00b8b0;
  box-shadow: 0 0 0 3px rgba(0, 184, 176, 0.15);
}
.lfm-input:disabled { background: #f8fafc; color: #94a3b8; cursor: not-allowed; }
select.lfm-input { cursor: pointer; }

.lfm-footer {
  display: flex; justify-content: flex-end; gap: 10px;
  margin-top: 4px;
  flex-shrink: 0;
}
.lfm-btn-ghost {
  padding: 10px 18px; background: #fff; border: 1px solid #cbd5e1;
  border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer;
  color: #334155; font-family: inherit;
  transition: background 0.15s ease;
}
.lfm-btn-ghost:hover:not(:disabled) { background: #f8fafc; }
.lfm-btn-ghost:disabled { opacity: 0.5; cursor: not-allowed; }
.lfm-btn-primary {
  padding: 10px 22px;
  background: linear-gradient(135deg, #00e0d4 0%, #00b8b0 45%, #008a82 100%);
  color: #fff; border: none; border-radius: 8px;
  font-size: 14px; font-weight: 700; cursor: pointer; font-family: inherit;
  box-shadow: 0 4px 12px rgba(0, 200, 190, 0.32);
  transition: transform 0.1s ease, box-shadow 0.15s ease;
}
.lfm-btn-primary:hover:not(:disabled) { box-shadow: 0 6px 16px rgba(0, 200, 190, 0.42); }
.lfm-btn-primary:active:not(:disabled) { transform: scale(0.98); }
.lfm-btn-primary:disabled { opacity: 0.5; cursor: not-allowed; box-shadow: none; }

@media (max-width: 900px) {
  .lfm-card { max-width: 96vw; }
}

@media (max-width: 640px) {
  .lfm-overlay { padding: 0; align-items: stretch; }
  .lfm-card {
    max-height: 100vh; max-height: 100dvh;
    width: 100vw; max-width: 100vw;
    height: 100vh; height: 100dvh;
    border-radius: 0;
    animation: none;
  }
  .lfm-header { padding: 12px 14px; }
  .lfm-header-icon { width: 34px; height: 34px; border-radius: 9px; }
  .lfm-header-icon svg { width: 17px; height: 17px; }
  .lfm-header-title { font-size: 15px; }
  .lfm-header-sub { font-size: 11px; }
  .lfm-body { padding: 14px; gap: 12px; }
  .lfm-input { font-size: 16px; }
  .lfm-btn-ghost,
  .lfm-btn-primary { min-height: 44px; font-size: 14px; }
  .lfm-footer { flex-direction: row-reverse; gap: 8px; }
  .lfm-footer > button { flex: 1 1 auto; }
}

@media (max-width: 380px) {
  .lfm-header-icon { width: 30px; height: 30px; }
  .lfm-header-icon svg { width: 15px; height: 15px; }
  .lfm-header-title { font-size: 14px; }
  .lfm-footer { flex-direction: column-reverse; }
  .lfm-footer > button { width: 100%; }
}

@media (max-height: 500px) and (orientation: landscape) {
  .lfm-overlay { padding: 8px; align-items: center; }
  .lfm-card {
    height: auto; max-height: 96vh;
    border-radius: 12px; max-width: 96vw;
  }
  .lfm-header { padding: 8px 14px; }
  .lfm-body   { padding: 10px 14px; gap: 10px; }
}

@media (prefers-reduced-motion: reduce) {
  .lfm-card, .lfm-overlay { animation: none !important; }
  .lfm-btn-primary { transition: none !important; }
}
`;

export default LocatorFormModal;