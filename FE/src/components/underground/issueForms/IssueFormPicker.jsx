// src/components/underground/issueForms/IssueFormPicker.jsx
//
// The four-card form picker. Rendered as a modal on top of the
// Underground shell when the handler clicks "Issue".
//
// Emits onSelect(form_type) with 'MER' | 'MSR' | 'MSF' | 'MSB',
// then the parent opens IssueFormModal with that type.
//
// Reuses the .ugmodal-* shell from undergroundStyles.js for
// visual consistency with the release / seed / close modals.

import React from 'react';
import {
  FiX,
  FiZap,
  FiAnchor,
  FiDroplet,
  FiFileText,
  FiChevronRight,
} from 'react-icons/fi';
import { PICKER_CARDS } from './formTemplates';

/* ============================================================
   Icon map — one Feather icon per template
   ============================================================ */
const ICONS = {
  explosive: <FiZap />,
  rockbolt:  <FiAnchor />,
  fuel:      <FiDroplet />,
  blank:     <FiFileText />,
};

const IssueFormPicker = ({ onSelect, onClose }) => {
  return (
    <div className="ugmodal-overlay" onClick={onClose}>
      <div
        className="ugmodal-card ugmodal-card--wide"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ---------- Header ---------- */}
        <div className="ugmodal-header">
          <div className="ugmodal-header-left">
            <div className="ugmodal-header-icon"><FiFileText /></div>
            <div style={{ minWidth: 0 }}>
              <h3 className="ugmodal-title">Create Issue Form</h3>
              <div className="ugmodal-sub">
                Pick the requisition template to fill out.
              </div>
            </div>
          </div>
          <button
            type="button"
            className="ugmodal-close"
            onClick={onClose}
            aria-label="Close"
          ><FiX /></button>
        </div>

        {/* ---------- Body ---------- */}
        <div className="ugmodal-body">
          <div className="ugifp-grid">
            {PICKER_CARDS.map((c) => (
              <button
                key={c.form_type}
                type="button"
                className={`ugifp-card ugifp-card--${c.accent}`}
                onClick={() => onSelect(c.form_type)}
              >
                <div className="ugifp-card-icon">
                  {ICONS[c.icon] || <FiFileText />}
                </div>

                <div className="ugifp-card-body">
                  <div className="ugifp-card-meta">
                    <span className="ugifp-formno">{c.form_no}</span>
                    <span className="ugifp-rev">rev {c.revision}</span>
                  </div>
                  <div className="ugifp-card-title">{c.title}</div>
                  {c.subtitle && (
                    <div className="ugifp-card-subtitle">{c.subtitle}</div>
                  )}
                  <div className="ugifp-card-blurb">{c.blurb}</div>
                </div>

                <div className="ugifp-card-chevron"><FiChevronRight /></div>
              </button>
            ))}
          </div>
        </div>

        {/* ---------- Footer ---------- */}
        <div className="ugmodal-footer">
          <button
            type="button"
            className="ug-btn ug-btn--secondary"
            onClick={onClose}
          >Cancel</button>
        </div>
      </div>

      <style>{pickerCss}</style>
    </div>
  );
};

export default IssueFormPicker;

/* ============================================================
   Component-scoped CSS — `ugifp-` prefix.
   No backticks inside this string.
   ============================================================ */
const pickerCss = `
.ugifp-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.ugifp-card {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 16px 40px 16px 16px;
  background: #ffffff;
  border: 1.5px solid #e2e8f0;
  border-radius: 12px;
  cursor: pointer;
  text-align: left;
  font-family: inherit;
  transition:
    border-color 160ms ease,
    box-shadow 200ms ease,
    transform 200ms cubic-bezier(0.34, 1.4, 0.64, 1);
  min-height: 118px;
}

.ugifp-card:hover,
.ugifp-card:focus-visible {
  outline: none;
  transform: translateY(-2px);
  box-shadow: 0 12px 30px rgba(15, 23, 42, 0.12);
}

.ugifp-card--amber:hover { border-color: #d97706; }
.ugifp-card--teal:hover  { border-color: #00b8b0; }
.ugifp-card--blue:hover  { border-color: #3b82f6; }
.ugifp-card--slate:hover { border-color: #64748b; }

/* ---------- Icon chip ---------- */
.ugifp-card-icon {
  flex-shrink: 0;
  width: 44px;
  height: 44px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #ffffff;
  background: linear-gradient(135deg, #00e0d4 0%, #008a82 100%);
  box-shadow: 0 4px 12px rgba(0, 200, 190, 0.28);
}
.ugifp-card-icon svg { width: 20px; height: 20px; stroke-width: 2.2; }

.ugifp-card--amber .ugifp-card-icon {
  background: linear-gradient(135deg, #fbbf24 0%, #b45309 100%);
  box-shadow: 0 4px 12px rgba(217, 119, 6, 0.30);
}
.ugifp-card--blue .ugifp-card-icon {
  background: linear-gradient(135deg, #60a5fa 0%, #1e40af 100%);
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.30);
}
.ugifp-card--slate .ugifp-card-icon {
  background: linear-gradient(135deg, #94a3b8 0%, #334155 100%);
  box-shadow: 0 4px 12px rgba(100, 116, 139, 0.30);
}

/* ---------- Card body ---------- */
.ugifp-card-body {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.ugifp-card-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.ugifp-formno {
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-size: 10.5px;
  font-weight: 800;
  letter-spacing: 0.02em;
  padding: 2px 8px;
  border-radius: 999px;
  background: #f1f5f9;
  color: #334155;
  border: 1px solid #cbd5e1;
}
.ugifp-rev {
  font-size: 10.5px;
  font-weight: 700;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.ugifp-card-title {
  font-size: 14px;
  font-weight: 800;
  color: #0f172a;
  line-height: 1.2;
}
.ugifp-card-subtitle {
  font-size: 12.5px;
  font-weight: 700;
  color: #0f766e;
}
.ugifp-card-blurb {
  font-size: 12px;
  color: #64748b;
  line-height: 1.45;
  margin-top: 2px;
}

/* ---------- Chevron ---------- */
.ugifp-card-chevron {
  position: absolute;
  top: 50%;
  right: 14px;
  transform: translateY(-50%);
  color: #cbd5e1;
  transition: color 160ms ease, transform 200ms ease;
}
.ugifp-card-chevron svg {
  width: 18px;
  height: 18px;
  stroke-width: 2.4;
}
.ugifp-card:hover .ugifp-card-chevron,
.ugifp-card:focus-visible .ugifp-card-chevron {
  color: #00b8b0;
  transform: translate(3px, -50%);
}

/* ---------- Responsive ---------- */
@media (max-width: 640px) {
  .ugifp-grid { grid-template-columns: 1fr; gap: 10px; }
  .ugifp-card {
    padding: 14px 36px 14px 14px;
    min-height: 100px;
    gap: 10px;
  }
  .ugifp-card-icon { width: 38px; height: 38px; }
  .ugifp-card-icon svg { width: 18px; height: 18px; }
  .ugifp-card-title { font-size: 13.5px; }
  .ugifp-card-blurb { font-size: 11.5px; }
}

@media (max-width: 400px) {
  .ugifp-card { padding: 12px 30px 12px 12px; gap: 8px; }
  .ugifp-card-icon { width: 34px; height: 34px; border-radius: 8px; }
  .ugifp-card-icon svg { width: 16px; height: 16px; }
  .ugifp-card-title { font-size: 13px; }
  .ugifp-card-subtitle { font-size: 11.5px; }
}

@media (min-width: 1921px) {
  .ugifp-grid { gap: 16px; }
  .ugifp-card { padding: 20px 46px 20px 20px; min-height: 140px; }
  .ugifp-card-icon { width: 52px; height: 52px; }
  .ugifp-card-icon svg { width: 24px; height: 24px; }
  .ugifp-card-title { font-size: 16px; }
  .ugifp-card-blurb { font-size: 13px; }
}

@media (prefers-reduced-motion: reduce) {
  .ugifp-card,
  .ugifp-card-chevron { transition: none !important; }
  .ugifp-card:hover,
  .ugifp-card:focus-visible { transform: none !important; }
  .ugifp-card:hover .ugifp-card-chevron,
  .ugifp-card:focus-visible .ugifp-card-chevron {
    transform: translateY(-50%) !important;
  }
}
`;