// src/components/underground/issueForms/IssueFormPrint.jsx
import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { FiX, FiPrinter } from 'react-icons/fi';
import LepantoLetterhead from './lepantoLetterhead';
import { getTemplate, FOOTER_SLOTS, CHAPA_SLOT } from './formTemplates';

/* ============================================================
   Formatters — 4-DECIMAL STRICT for money
   ============================================================ */
const intFmt = new Intl.NumberFormat('en-PH');
const curFmt = new Intl.NumberFormat('en-PH', {
  style: 'currency', currency: 'PHP',
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,   // ✅ was 2
});
const fmtInt = (n) => intFmt.format(Number(n) || 0);
const fmtCur = (n) => curFmt.format(Number(n) || 0);

const fmtDate = (v) => {
  if (!v) return '';
  try {
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return String(v);
    return d.toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' });
  } catch { return String(v); }
};

/* ============================================================
   Read a footer value from the form data, per slot
   ============================================================ */
const footerValue = (slot, formData) => {
  if (!slot) return '';
  if (slot.key === 'chapa') return formData.chapa_no || '';
  return formData[`${slot.key}_name`] || '';
};

/* ============================================================
   Quantity Formatter — Boxes & Pieces (for print)
   ============================================================ */
const printQty = (l) => {
  const qty = Number(l.qty_issued) || 0;
  const boxes = l.qty_boxes != null ? Number(l.qty_boxes) : null;
  const loose = l.qty_loose_pieces != null ? Number(l.qty_loose_pieces) : null;

  if (boxes != null || loose != null) {
    const parts = [];
    if (boxes > 0) parts.push(`${boxes}B`);
    if (loose > 0) parts.push(`${loose}P`);

    if (parts.length > 0) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', lineHeight: 1.2 }}>
          <span>{parts.join(', ')}</span>
          <span style={{ fontSize: '8px', color: '#475569' }}>({fmtInt(qty)})</span>
        </div>
      );
    }
  }
  return fmtInt(qty);
};

/* ============================================================
   Component
   ============================================================ */
const IssueFormPrint = ({ formData, onClose }) => {
  const tpl = getTemplate(formData.form_type);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!tpl) return null;

  const lines = formData.lines || [];
  const bdmLines = formData.bdm_lines || [];

  const handlePrint = () => window.print();

  const root = (
    <div className="ugifp-overlay" role="dialog" aria-modal="true">
      <style>{printCss}</style>

      <div className="ugifp-controls ugifp-no-print">
        <div className="ugifp-controls-info">
          <div className="ugifp-controls-title">
            Print preview — {tpl.title}
          </div>
          <div className="ugifp-controls-sub">
            {formData.form_document_code} rev {formData.form_revision}
            {formData.form_series_no ? ` · ${formData.form_series_no}` : ''}
          </div>
        </div>
        <div className="ugifp-controls-actions">
          <button
            type="button"
            className="ugifp-btn ugifp-btn--ghost"
            onClick={onClose}
          >
            <FiX /> <span>Close</span>
          </button>
          <button
            type="button"
            className="ugifp-btn ugifp-btn--primary"
            onClick={handlePrint}
          >
            <FiPrinter /> <span>Print</span>
          </button>
        </div>
      </div>

      <div className="ugifp-paper">
        <LepantoLetterhead template={tpl} mode="print" />

        {formData.form_series_no && (
          <div className="ugifp-series">
            <span className="ugifp-series-label">Serial No.</span>
            <span className="ugifp-series-value">{formData.form_series_no}</span>
          </div>
        )}

        <table className="ugifp-header-table">
          <tbody>
            <tr>
              <th>{tpl.id === 'MSB' ? 'Dept' : 'Dept/Section'}</th>
              <td>{formData.dept_section || ''}</td>
              <th>Name of ADH/DH(Initials)</th>
              <td>{formData.adh_dh_initials || ''}</td>
              <th>Activity/CC</th>
              <td>{formData.activity_cc || ''}</td>
              <th>Level</th>
              <td>{formData.level_field || ''}</td>
              <th>Date</th>
              <td>{fmtDate(formData.form_date)}</td>
            </tr>
            <tr>
              <th>Working Place</th>
              <td colSpan={4}>{formData.working_place || ''}</td>
              {formData.lhd_no !== undefined && (
                <>
                  <th>LHD No.</th>
                  <td colSpan={2}>{formData.lhd_no || ''}</td>
                </>
              )}
              <th>Shift</th>
              <td>
                <span className="ugifp-shift">
                  <span className={formData.shift_label === '1st' ? 'is-on' : ''}>1st</span>
                  <span className={formData.shift_label === '2nd' ? 'is-on' : ''}>2nd</span>
                  <span className={formData.shift_label === '3rd' ? 'is-on' : ''}>3rd</span>
                </span>
              </td>
            </tr>
          </tbody>
        </table>

        <table className="ugifp-lines-table">
          <thead>
            <tr>
              <th className="ugifp-col-code">{tpl.line_code_label}</th>
              <th className="ugifp-col-desc">Item Description</th>
              <th className="ugifp-col-unit">Unit</th>
              <th className="ugifp-col-qty" colSpan={2}>Quantity</th>
              <th className="ugifp-col-last">{tpl.last_col_label}</th>
            </tr>
            <tr className="ugifp-subhead">
              <th colSpan={3}></th>
              <th className="ugifp-col-qty">Req&apos;d</th>
              <th className="ugifp-col-qty">Issued</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 ? (
              <tr>
                <td colSpan={6} className="ugifp-empty">(no items)</td>
              </tr>
            ) : (
              lines.map((l, i) => (
                <tr key={`${l.locator_code}-${l.item_code}-${i}`}>
                  <td className="ugifp-col-code">{l.item_code}</td>
                  <td className="ugifp-col-desc">{l.item_name || ''}</td>
                  <td className="ugifp-col-unit">{l.uom || ''}</td>
                  <td className="ugifp-col-qty">
                    {l.qty_required ? fmtInt(l.qty_required) : ''}
                  </td>
                  <td className="ugifp-col-qty">
                    {l.qty_issued ? printQty(l) : ''}
                  </td>
                  <td className="ugifp-col-last">
                    {tpl.last_col === 'amount'
                      ? (Number(l.qty_issued) > 0
                          ? fmtCur((Number(l.qty_issued) || 0) * (Number(l.unit_cost) || 0))
                          : '')
                      : (l.remarks || '')}
                  </td>
                </tr>
              ))
            )}
            {Array.from({ length: Math.max(0, 8 - lines.length) }).map((_, i) => (
              <tr key={`pad-${i}`} className="ugifp-blank">
                <td className="ugifp-col-code">&nbsp;</td>
                <td className="ugifp-col-desc"></td>
                <td className="ugifp-col-unit"></td>
                <td className="ugifp-col-qty"></td>
                <td className="ugifp-col-qty"></td>
                <td className="ugifp-col-last"></td>
              </tr>
            ))}
          </tbody>
        </table>

        {tpl.has_bdm_block && (
          <div className="ugifp-bdm">
            <table className="ugifp-lines-table ugifp-bdm-header">
              <tbody>
                <tr>
                  <th className="ugifp-bdm-tag">FOR BDM ONLY</th>
                  <th>RDM No.</th>
                  <td>{formData.bdm_rdm_no || ''}</td>
                  <th>Shift</th>
                  <td>
                    <span className="ugifp-shift">
                      <span className={formData.bdm_shift_label === '1st' ? 'is-on' : ''}>1st</span>
                      <span className={formData.bdm_shift_label === '2nd' ? 'is-on' : ''}>2nd</span>
                      <span className={formData.bdm_shift_label === '3rd' ? 'is-on' : ''}>3rd</span>
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>

            <table className="ugifp-lines-table">
              <thead>
                <tr>
                  <th className="ugifp-col-code">{tpl.line_code_label}</th>
                  <th className="ugifp-col-desc">Item Description</th>
                  <th className="ugifp-col-unit">Unit</th>
                  <th className="ugifp-col-qty" colSpan={2}>Quantity</th>
                  <th className="ugifp-col-last">{tpl.last_col_label}</th>
                </tr>
                <tr className="ugifp-subhead">
                  <th colSpan={3}></th>
                  <th className="ugifp-col-qty">Req&apos;d</th>
                  <th className="ugifp-col-qty">Issued</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {bdmLines.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="ugifp-empty">(none)</td>
                  </tr>
                ) : (
                  bdmLines.map((l, i) => (
                    <tr key={`bdm-${l.locator_code}-${l.item_code}-${i}`}>
                      <td className="ugifp-col-code">{l.item_code}</td>
                      <td className="ugifp-col-desc">{l.item_name || ''}</td>
                      <td className="ugifp-col-unit">{l.uom || ''}</td>
                      <td className="ugifp-col-qty">
                        {l.qty_required ? fmtInt(l.qty_required) : ''}
                      </td>
                      <td className="ugifp-col-qty">
                        {l.qty_issued ? printQty(l) : ''}
                      </td>
                      <td className="ugifp-col-last">
                        {tpl.last_col === 'amount'
                          ? (Number(l.qty_issued) > 0
                              ? fmtCur((Number(l.qty_issued) || 0) * (Number(l.unit_cost) || 0))
                              : '')
                          : (l.remarks || '')}
                      </td>
                    </tr>
                  ))
                )}
                {Array.from({ length: Math.max(0, 4 - bdmLines.length) }).map((_, i) => (
                  <tr key={`bdm-pad-${i}`} className="ugifp-blank">
                    <td className="ugifp-col-code">&nbsp;</td>
                    <td className="ugifp-col-desc"></td>
                    <td className="ugifp-col-unit"></td>
                    <td className="ugifp-col-qty"></td>
                    <td className="ugifp-col-qty"></td>
                    <td className="ugifp-col-last"></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <table className="ugifp-footer-table">
          <tbody>
            <tr>
              {FOOTER_SLOTS.map((s) => (
                <th key={s.key}>{s.label}:</th>
              ))}
            </tr>
            <tr>
              {FOOTER_SLOTS.map((s) => (
                <td key={s.key}>
                  <div className="ugifp-sig-space"></div>
                  <div className="ugifp-sig-name">
                    {footerValue(s, formData)}
                  </div>
                  <div className="ugifp-sig-label">Printed Name &amp; Signature</div>
                </td>
              ))}
            </tr>
            <tr>
              {FOOTER_SLOTS.map((s) => (
                <th key={`d-${s.key}`} className="ugifp-date-lbl">Date:</th>
              ))}
            </tr>
            <tr className="ugifp-chapa-row">
              {FOOTER_SLOTS.map((s) => (
                <td key={`dt-${s.key}`} className="ugifp-date-line"></td>
              ))}
            </tr>
            <tr>
              <td colSpan={3}></td>
              <th className="ugifp-chapa-lbl">{CHAPA_SLOT.label}</th>
              <td>
                <div className="ugifp-chapa-name">
                  {footerValue(CHAPA_SLOT, formData)}
                </div>
              </td>
            </tr>
          </tbody>
        </table>

        {formData.remarks && (
          <div className="ugifp-remarks">
            <strong>Remarks:</strong> {formData.remarks}
          </div>
        )}

        {formData.attachment_base64 && formData.attachment_mime_type && (
          <div className="ugifp-attach">
            <div className="ugifp-attach-label">
              <strong>Proof picture</strong>
              {formData.attachment_name ? (
                <span className="ugifp-attach-name">
                  {' — '}
                  {formData.attachment_name}
                </span>
              ) : null}
            </div>
            <div className="ugifp-attach-frame">
              <img
                className="ugifp-attach-img"
                alt={formData.attachment_name || 'Proof picture'}
                src={
                  'data:' +
                  formData.attachment_mime_type +
                  ';base64,' +
                  formData.attachment_base64
                }
              />
            </div>
          </div>
        )}

        {formData.form_series_no && (
          <div className="ugifp-series-stamp">
            {formData.form_series_no}
          </div>
        )}
      </div>
    </div>
  );

  if (typeof document === 'undefined') return root;
  return createPortal(root, document.body);
};

export default IssueFormPrint;

const printCss = `
.ugifp-overlay {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.72);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  z-index: 2147483000;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  padding: 16px;
}
.ugifp-controls {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  max-width: 1200px;
  width: 100%;
  margin: 0 auto 12px;
  padding: 12px 16px;
  background: #ffffff;
  border-radius: 12px;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.14);
}
.ugifp-controls-info { min-width: 0; }
.ugifp-controls-title {
  font-size: 15px;
  font-weight: 800;
  color: #0f172a;
  line-height: 1.2;
}
.ugifp-controls-sub {
  font-size: 12px;
  color: #64748b;
  margin-top: 2px;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
}
.ugifp-controls-actions { display: inline-flex; gap: 8px; }
.ugifp-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 10px 16px;
  min-height: 40px;
  font-family: inherit;
  font-size: 13px;
  font-weight: 700;
  border-radius: 8px;
  cursor: pointer;
  border: 1px solid transparent;
  transition: background 140ms ease, border-color 140ms ease, color 140ms ease;
}
.ugifp-btn svg { width: 15px; height: 15px; stroke-width: 2.4; }
.ugifp-btn--ghost {
  background: #ffffff;
  color: #334155;
  border-color: #cbd5e1;
}
.ugifp-btn--ghost:hover { background: #f8fafc; border-color: #94a3b8; }
.ugifp-btn--primary {
  background: #00b8b0;
  color: #ffffff;
  border-color: #007a72;
  box-shadow: 0 4px 12px rgba(0, 184, 176, 0.28);
}
.ugifp-btn--primary:hover { background: #00d4cb; }

.ugifp-paper {
  max-width: 1200px;
  width: 100%;
  margin: 0 auto 40px;
  padding: 22px 26px;
  background: #ffffff;
  border-radius: 12px;
  box-shadow: 0 20px 60px rgba(15, 23, 42, 0.28);
  color: #0f172a;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 11px;
  position: relative;
}
.ugifp-series {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 8px;
  font-size: 11px;
}
.ugifp-series-label {
  font-weight: 700;
  color: #334155;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  font-size: 10px;
}
.ugifp-series-value {
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-weight: 800;
  font-size: 12px;
  color: #008a82;
}
.ugifp-header-table,
.ugifp-lines-table,
.ugifp-footer-table {
  width: 100%;
  border-collapse: collapse;
  margin-top: 8px;
  table-layout: fixed;
}
.ugifp-header-table th,
.ugifp-header-table td,
.ugifp-lines-table th,
.ugifp-lines-table td,
.ugifp-footer-table th,
.ugifp-footer-table td {
  border: 1px solid #0f172a;
  padding: 4px 6px;
  font-size: 10.5px;
  vertical-align: middle;
  line-height: 1.3;
  word-break: break-word;
}
.ugifp-header-table th {
  background: #f8fafc;
  font-weight: 700;
  text-align: left;
  white-space: nowrap;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.02em;
}
.ugifp-header-table td { background: #ffffff; min-height: 20px; }
.ugifp-shift { display: inline-flex; gap: 8px; }
.ugifp-shift > span {
  display: inline-block;
  padding: 1px 6px;
  border: 1px solid #0f172a;
  border-radius: 2px;
  font-size: 10px;
  font-weight: 700;
  min-width: 28px;
  text-align: center;
}
.ugifp-shift > span.is-on { background: #0f172a; color: #ffffff; }
.ugifp-col-code  { width: 16%; font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace; font-size: 10.5px; }
.ugifp-col-desc  { width: 32%; }
.ugifp-col-unit  { width: 8%;  text-align: center; font-size: 10.5px; font-weight: 700; }
.ugifp-col-qty   { width: 10%; text-align: right; font-variant-numeric: tabular-nums; font-size: 10.5px; }
.ugifp-col-last  { width: 24%; text-align: left; font-size: 10.5px; }
.ugifp-lines-table thead th {
  background: #f8fafc;
  font-weight: 800;
  text-align: center;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.ugifp-lines-table thead tr.ugifp-subhead th {
  background: #ffffff;
  font-size: 9.5px;
}
.ugifp-lines-table tbody td {
  height: 22px;
  background: #ffffff;
}
.ugifp-lines-table tbody tr.ugifp-blank td { height: 22px; }
.ugifp-empty {
  text-align: center;
  color: #94a3b8;
  font-style: italic;
  padding: 10px;
}
.ugifp-bdm { margin-top: 10px; }
.ugifp-bdm-header { margin-top: 0; margin-bottom: -1px; }
.ugifp-bdm-header th,
.ugifp-bdm-header td {
  background: #fffdf5;
  text-align: left;
  font-size: 10.5px;
  padding: 4px 6px;
}
.ugifp-bdm-tag {
  background: #fef3c7 !important;
  color: #92400e;
  font-size: 10px;
  letter-spacing: 0.06em;
  width: 20%;
}
.ugifp-footer-table { margin-top: 10px; }
.ugifp-footer-table th {
  background: #f8fafc;
  font-weight: 700;
  font-size: 10px;
  text-align: left;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.ugifp-footer-table td {
  background: #ffffff;
  height: 32px;
  vertical-align: top;
  padding: 4px 6px;
}
.ugifp-sig-space { height: 26px; }
.ugifp-sig-name {
  font-weight: 700;
  font-size: 10.5px;
  color: #0f172a;
  border-bottom: 1px solid #0f172a;
  padding-bottom: 1px;
  text-align: center;
}
.ugifp-sig-label {
  font-size: 8.5px;
  color: #475569;
  text-align: center;
  margin-top: 2px;
  text-transform: uppercase;
  letter-spacing: 0.02em;
}
.ugifp-date-lbl { width: 25%; }
.ugifp-date-line {
  height: 20px;
  border-bottom: 1px solid #0f172a;
}
.ugifp-chapa-row td { height: 14px; }
.ugifp-chapa-lbl {
  text-align: right;
  width: 75%;
  padding-right: 8px;
  font-size: 10px;
}
.ugifp-chapa-name {
  font-weight: 700;
  font-size: 10.5px;
  border-bottom: 1px solid #0f172a;
  padding-bottom: 1px;
  text-align: center;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
}
.ugifp-remarks {
  margin-top: 8px;
  padding: 6px 8px;
  border: 1px dashed #cbd5e1;
  border-radius: 4px;
  font-size: 10.5px;
  color: #334155;
  line-height: 1.4;
}

.ugifp-attach {
  margin-top: 10px;
  page-break-inside: avoid;
  break-inside: avoid;
}
.ugifp-attach-label {
  font-size: 10.5px;
  color: #334155;
  margin-bottom: 4px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.ugifp-attach-label strong {
  font-weight: 800;
  color: #0f172a;
}
.ugifp-attach-name {
  text-transform: none;
  letter-spacing: 0;
  font-weight: 600;
  color: #475569;
}
.ugifp-attach-frame {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 6px;
  border: 1px solid #0f172a;
  background: #ffffff;
  border-radius: 3px;
  overflow: hidden;
}
.ugifp-attach-img {
  display: block;
  max-width: 100%;
  max-height: 320px;
  width: auto;
  height: auto;
  object-fit: contain;
}

.ugifp-series-stamp {
  position: absolute;
  bottom: 18px;
  right: 26px;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-size: 13px;
  font-weight: 800;
  color: #0f172a;
}

@media (max-width: 720px) {
  .ugifp-overlay { padding: 8px; }
  .ugifp-paper {
    padding: 14px 14px;
    font-size: 9.5px;
    border-radius: 8px;
  }
  .ugifp-header-table th,
  .ugifp-header-table td,
  .ugifp-lines-table th,
  .ugifp-lines-table td,
  .ugifp-footer-table th,
  .ugifp-footer-table td { font-size: 9px; padding: 3px 4px; }
  .ugifp-controls { padding: 10px 12px; }
  .ugifp-controls-title { font-size: 13px; }
  .ugifp-controls-sub { font-size: 11px; }
  .ugifp-attach-img { max-height: 240px; }
}

@media (max-width: 480px) {
  .ugifp-paper { padding: 10px; font-size: 9px; }
  .ugifp-attach-img { max-height: 180px; }
  .ugifp-attach-label { font-size: 9.5px; }
}

@media print {
  body * { visibility: hidden !important; }
  .ugifp-overlay,
  .ugifp-overlay * { visibility: visible !important; }
  .ugifp-overlay {
    position: static !important;
    inset: auto !important;
    padding: 0 !important;
    background: #ffffff !important;
    backdrop-filter: none !important;
    -webkit-backdrop-filter: none !important;
    overflow: visible !important;
    z-index: auto !important;
  }
  .ugifp-no-print,
  .ugifp-no-print * { display: none !important; visibility: hidden !important; }
  .ugifp-paper {
    box-shadow: none !important;
    border-radius: 0 !important;
    margin: 0 !important;
    padding: 0 !important;
    max-width: 100% !important;
    width: 100% !important;
    font-size: 10.5px !important;
  }
  .ugifp-header-table th,
  .ugifp-header-table td,
  .ugifp-lines-table th,
  .ugifp-lines-table td,
  .ugifp-footer-table th,
  .ugifp-footer-table td {
    border-color: #000 !important;
    color: #000 !important;
  }
  .ugifp-attach-frame {
    border-color: #000 !important;
    background: #ffffff !important;
  }
  .ugifp-attach-img {
    max-height: 90mm !important;
  }
  @page { size: A4 landscape; margin: 10mm; }
}

@media (prefers-reduced-motion: reduce) {
  .ugifp-btn { transition: none !important; }
}
`;