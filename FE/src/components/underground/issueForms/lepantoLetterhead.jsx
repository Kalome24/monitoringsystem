// src/components/underground/issueForms/lepantoLetterhead.jsx
//
// Shared letterhead for every issue form. Rendered identically in
// the on-screen modal and the print replica so what the underground
// handler sees is what the surface handler receives.
//
// Offline-safe: the logo is loaded from /lepantologo.svg, which
// Vite serves same-origin from /public. No CDN, no external font.
//
// Layout (matches the real printed LMC requisition header):
//
//   ┌──────────┬───────────────────────────────────┬─────────────────────┐
//   │  LQ logo │ LEPANTO CONSOLIDATED MINING COMPANY│ Form No. : …        │
//   │          │ Lepanto Mine Division              │ Revision No. : 03   │
//   │          │ Mankayan, Benguet                  │ Date Effective : … │
//   └──────────┴───────────────────────────────────┴─────────────────────┘
//                     MINE EXPLOSIVES REQUISITION
//                              (MER)

import React from 'react';

/**
 * @param {object} props
 * @param {object} props.template  — a form template from formTemplates.js
 * @param {'screen'|'print'} [props.mode='screen']
 *   screen: scaled for the modal header (compact, teal accent)
 *   print:  full-size for a printed A4 landscape page (black on white)
 */
const LepantoLetterhead = ({ template, mode = 'screen' }) => {
  if (!template) return null;

  const isPrint = mode === 'print';
  const rootClass = isPrint
    ? 'lq-lh lq-lh--print'
    : 'lq-lh lq-lh--screen';

  return (
    <div className={rootClass} role="banner">
      <style>{letterheadCss}</style>

      <div className="lq-lh-top">
        <div className="lq-lh-brand">
          <img
            className="lq-lh-logo"
            src="/lepantologo.svg"
            alt="Lepanto Consolidated Mining Company"
            draggable="false"
          />
          <div className="lq-lh-brand-text">
            <div className="lq-lh-company">LEPANTO CONSOLIDATED MINING COMPANY</div>
            <div className="lq-lh-division">Lepanto Mine Division</div>
            <div className="lq-lh-location">Mankayan, Benguet</div>
          </div>
        </div>

        <div className="lq-lh-meta">
          <div className="lq-lh-meta-row">
            <span className="lq-lh-meta-label">Form No.</span>
            <span className="lq-lh-meta-colon">:</span>
            <span className="lq-lh-meta-value">{template.form_document_code}</span>
          </div>
          <div className="lq-lh-meta-row">
            <span className="lq-lh-meta-label">Revision No.</span>
            <span className="lq-lh-meta-colon">:</span>
            <span className="lq-lh-meta-value">{template.form_revision}</span>
          </div>
          <div className="lq-lh-meta-row">
            <span className="lq-lh-meta-label">Date Effective</span>
            <span className="lq-lh-meta-colon">:</span>
            <span className="lq-lh-meta-value">{template.date_effective}</span>
          </div>
        </div>
      </div>

      <div className="lq-lh-title-block">
        <h1 className="lq-lh-title">{template.title}</h1>
        {template.subtitle && (
          <h2 className="lq-lh-subtitle">{template.subtitle}</h2>
        )}
      </div>
    </div>
  );
};

export default LepantoLetterhead;

/* ============================================================
   Letterhead CSS — scoped to .lq-lh, works in both modes.
   No backticks inside this string.
   ============================================================ */
const letterheadCss = `
.lq-lh {
  width: 100%;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  color: #0f172a;
  box-sizing: border-box;
}

.lq-lh * { box-sizing: border-box; }

/* ---------- Top row: brand | meta box ---------- */
.lq-lh-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.lq-lh-brand {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  flex: 1 1 auto;
}

.lq-lh-logo {
  flex-shrink: 0;
  width: 48px;
  height: 48px;
  object-fit: contain;
  user-select: none;
  -webkit-user-drag: none;
}

.lq-lh-brand-text {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.lq-lh-company {
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.02em;
  color: #0f172a;
  line-height: 1.15;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.lq-lh-division {
  font-size: 11px;
  font-weight: 500;
  color: #334155;
  line-height: 1.2;
}

.lq-lh-location {
  font-size: 11px;
  font-weight: 500;
  color: #334155;
  line-height: 1.2;
}

/* ---------- Meta box (Form No. / Revision / Date Effective) ---------- */
.lq-lh-meta {
  flex: 0 0 auto;
  min-width: 220px;
  max-width: 100%;
  padding: 6px 10px;
  border: 1px solid #0f172a;
  border-radius: 3px;
  background: #ffffff;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.lq-lh-meta-row {
  display: grid;
  grid-template-columns: 88px 10px 1fr;
  align-items: baseline;
  gap: 2px;
  font-size: 11px;
  line-height: 1.3;
}

.lq-lh-meta-label {
  font-weight: 700;
  color: #0f172a;
  text-align: left;
}
.lq-lh-meta-colon {
  text-align: center;
  color: #0f172a;
  font-weight: 700;
}
.lq-lh-meta-value {
  font-weight: 500;
  color: #0f172a;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  word-break: break-all;
}

/* ---------- Title block ---------- */
.lq-lh-title-block {
  margin-top: 10px;
  text-align: center;
  border-bottom: 1px solid #0f172a;
  padding-bottom: 6px;
}

.lq-lh-title {
  margin: 0;
  font-size: 15px;
  font-weight: 800;
  letter-spacing: 0.03em;
  color: #0f172a;
  line-height: 1.2;
  text-transform: uppercase;
}

.lq-lh-subtitle {
  margin: 2px 0 0;
  font-size: 12px;
  font-weight: 700;
  color: #0f172a;
  line-height: 1.2;
}

/* ============================================================
   PRINT MODE — larger type, tighter to the printed reality
   ============================================================ */
.lq-lh--print .lq-lh-logo {
  width: 56px;
  height: 56px;
}
.lq-lh--print .lq-lh-company   { font-size: 13px; }
.lq-lh--print .lq-lh-division  { font-size: 12px; }
.lq-lh--print .lq-lh-location  { font-size: 12px; }

.lq-lh--print .lq-lh-meta {
  min-width: 240px;
  padding: 7px 12px;
}
.lq-lh--print .lq-lh-meta-row {
  grid-template-columns: 96px 10px 1fr;
  font-size: 12px;
}

.lq-lh--print .lq-lh-title    { font-size: 17px; letter-spacing: 0.04em; }
.lq-lh--print .lq-lh-subtitle { font-size: 13px; }

/* ============================================================
   Responsive — screen mode shrinks gracefully
   ============================================================ */
@media (max-width: 640px) {
  .lq-lh--screen .lq-lh-top {
    flex-direction: column;
    align-items: stretch;
  }
  .lq-lh--screen .lq-lh-meta {
    min-width: 0;
    width: 100%;
  }
  .lq-lh--screen .lq-lh-company {
    font-size: 11px;
    white-space: normal;
    overflow: visible;
    text-overflow: clip;
    line-height: 1.2;
  }
  .lq-lh--screen .lq-lh-logo { width: 40px; height: 40px; }
  .lq-lh--screen .lq-lh-title { font-size: 13.5px; }
  .lq-lh--screen .lq-lh-subtitle { font-size: 11.5px; }
}

@media (max-width: 400px) {
  .lq-lh--screen .lq-lh-meta-row {
    grid-template-columns: 78px 10px 1fr;
    font-size: 10.5px;
  }
  .lq-lh--screen .lq-lh-company { font-size: 10.5px; }
  .lq-lh--screen .lq-lh-division,
  .lq-lh--screen .lq-lh-location { font-size: 10px; }
}

@media (min-width: 1921px) {
  .lq-lh--screen .lq-lh-logo { width: 60px; height: 60px; }
  .lq-lh--screen .lq-lh-company  { font-size: 14px; }
  .lq-lh--screen .lq-lh-division,
  .lq-lh--screen .lq-lh-location { font-size: 12.5px; }
  .lq-lh--screen .lq-lh-title    { font-size: 18px; }
  .lq-lh--screen .lq-lh-subtitle { font-size: 14px; }
}
`;