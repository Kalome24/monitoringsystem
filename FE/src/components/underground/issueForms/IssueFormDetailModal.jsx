// src/components/underground/issueForms/IssueFormDetailModal.jsx
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FiX,
  FiPrinter,
  FiLoader,
  FiAlertTriangle,
  FiFileText,
  FiPaperclip,
} from 'react-icons/fi';
import { issueFormApi } from '../../../services/api';
import LepantoLetterhead from './lepantoLetterhead';
import IssueFormPrint from './IssueFormPrint';
import { getTemplate } from './formTemplates';

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

const fmtDateTime = (value) => {
  if (!value) return '—';
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' });
  } catch { return '—'; }
};

const fmtDateOnly = (value) => {
  if (!value) return '';
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' });
  } catch { return String(value); }
};

/* ============================================================
   Quantity Formatter — Boxes & Pieces
   ============================================================ */
const formatIssuedQty = (l) => {
  const qty = Number(l.qty_issued) || 0;
  const boxes = l.qty_boxes != null ? Number(l.qty_boxes) : null;
  const loose = l.qty_loose_pieces != null ? Number(l.qty_loose_pieces) : null;

  if (boxes != null || loose != null) {
    const parts = [];
    if (boxes > 0) parts.push(`${boxes} Box${boxes === 1 ? '' : 'es'}`);
    if (loose > 0) parts.push(`${loose} Pc${loose === 1 ? '' : 's'}`);

    if (parts.length > 0) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', alignItems: 'flex-end' }}>
          <span style={{ fontWeight: 700, color: '#0f172a' }}>{parts.join(', ')}</span>
          <span style={{ fontSize: '10px', color: '#64748b' }}>({fmtInt(qty)} total)</span>
        </div>
      );
    }
  }
  return <span className="ugifd-num--strong">{fmtInt(qty)}</span>;
};

/* ============================================================
   Component
   ============================================================ */
const IssueFormDetailModal = ({ formId, onClose }) => {
  const [form, setForm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [printOpen, setPrintOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await issueFormApi.getById(formId);
        if (cancelled) return;
        if (res.ok && res.data) {
          setForm(res.data);
        } else {
          setError(res?.data?.message || 'Failed to load issue form.');
        }
      } catch (err) {
        if (!cancelled) {
          console.error('Issue form detail load error:', err);
          setError(err?.message || 'Failed to load issue form.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [formId]);

  const tpl = useMemo(
    () => (form ? getTemplate(form.form_type) : null),
    [form]
  );

  const handlePrint = useCallback(() => setPrintOpen(true), []);

  const renderLineTable = (lines, kind = 'regular') => {
    if (!lines || lines.length === 0) {
      return (
        <div className="ugifd-empty">
          No {kind === 'bdm' ? 'BDM ' : ''}lines recorded.
        </div>
      );
    }
    return (
      <div className="ugifd-table-wrap">
        <table className="ugifd-table">
          <thead>
            <tr>
              <th>{tpl.line_code_label}</th>
              <th>Item Description</th>
              <th className="ugifd-center">Unit</th>
              <th className="ugifd-num">Req&apos;d</th>
              <th className="ugifd-num">Issued</th>
              <th>{tpl.last_col_label}</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const issued = Number(l.qty_issued) || 0;
              const cost = Number(l.unit_cost) || 0;
              return (
                <tr key={l.line_id || `${l.item_code}-${i}`}>
                  <td className="ugifd-code">{l.item_code}</td>
                  <td>{l.item_name || '—'}</td>
                  <td className="ugifd-center">{l.uom || '—'}</td>
                  <td className="ugifd-num">
                    {l.qty_required != null && l.qty_required !== ''
                      ? fmtInt(l.qty_required)
                      : '—'}
                  </td>
                  <td className="ugifd-num">
                    {formatIssuedQty(l)}
                  </td>
                  <td>
                    {tpl.last_col === 'amount'
                      ? (issued > 0
                          ? <span className="ugifd-amount">{fmtCur(issued * cost)}</span>
                          : '—')
                      : (l.remarks || '—')}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <>
      <div className="ugmodal-overlay" onClick={onClose}>
        <div
          className="ugmodal-card ugifd-modal"
          onClick={(e) => e.stopPropagation()}
        >
          <style>{detailCss}</style>

          <div className="ugmodal-header">
            <div className="ugmodal-header-left">
              <div className="ugmodal-header-icon"><FiFileText /></div>
              <div style={{ minWidth: 0 }}>
                <h3 className="ugmodal-title">
                  {form?.form_series_no || 'Issue Form'}
                </h3>
                <div className="ugmodal-sub">
                  {form
                    ? `${form.form_document_code || '—'} rev ${form.form_revision || '—'} · ${fmtDateTime(form.issued_at)}`
                    : 'Loading…'}
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

          <div className="ugmodal-body">
            {loading && (
              <div className="ug-loading">
                <FiLoader className="ug-spin" />
                <span>Loading issue form…</span>
              </div>
            )}

            {error && (
              <div className="ugmodal-feedback ugmodal-feedback--error">
                <FiAlertTriangle />
                <span>{error}</span>
              </div>
            )}

            {!loading && form && tpl && (
              <>
                <div className="ugifd-letterhead">
                  <LepantoLetterhead template={tpl} mode="screen" />
                </div>

                <div className="ugifd-meta">
                  <div className="ugifd-meta-item">
                    <span className="ugifd-meta-label">Issued at</span>
                    <span className="ugifd-meta-value">{fmtDateTime(form.issued_at)}</span>
                  </div>
                  <div className="ugifd-meta-item">
                    <span className="ugifd-meta-label">Issued by</span>
                    <span className="ugifd-meta-value">
                      {form.issued_by_username || '—'}
                      {form.issued_by_position ? ` · ${form.issued_by_position}` : ''}
                    </span>
                  </div>
                  <div className="ugifd-meta-item">
                    <span className="ugifd-meta-label">Warehouse</span>
                    <span className="ugifd-meta-value">{form.warehouse_code || '—'}</span>
                  </div>
                  <div className="ugifd-meta-item">
                    <span className="ugifd-meta-label">Total amount</span>
                    <span className="ugifd-meta-value ugifd-meta-value--cur">
                      {fmtCur(form.total_amount || 0)}
                    </span>
                  </div>
                </div>

                <section className="ugifd-section">
                  <h4 className="ugifd-section-title">Header</h4>
                  <div className="ugifd-header-grid">
                    {tpl.id !== 'MSB' && (
                      <div className="ugifd-field">
                        <span className="ugifd-label">Dept/Section</span>
                        <span className="ugifd-value">{form.dept_section || '—'}</span>
                      </div>
                    )}
                    {tpl.id === 'MSB' && (
                      <div className="ugifd-field">
                        <span className="ugifd-label">Dept</span>
                        <span className="ugifd-value">{form.dept_section || '—'}</span>
                      </div>
                    )}
                    <div className="ugifd-field">
                      <span className="ugifd-label">Name of ADH/DH (Initials)</span>
                      <span className="ugifd-value">{form.adh_dh_initials || '—'}</span>
                    </div>
                    <div className="ugifd-field">
                      <span className="ugifd-label">Activity/CC</span>
                      <span className="ugifd-value">{form.activity_cc || '—'}</span>
                    </div>
                    <div className="ugifd-field">
                      <span className="ugifd-label">Level</span>
                      <span className="ugifd-value">{form.level_field || '—'}</span>
                    </div>
                    <div className="ugifd-field">
                      <span className="ugifd-label">Date</span>
                      <span className="ugifd-value">{fmtDateOnly(form.form_date) || '—'}</span>
                    </div>
                    <div className="ugifd-field ugifd-field--wide">
                      <span className="ugifd-label">Working Place</span>
                      <span className="ugifd-value">{form.working_place || '—'}</span>
                    </div>
                    {tpl.id !== 'MER' && (
                      <div className="ugifd-field">
                        <span className="ugifd-label">LHD No.</span>
                        <span className="ugifd-value">{form.lhd_no || '—'}</span>
                      </div>
                    )}
                    <div className="ugifd-field">
                      <span className="ugifd-label">Shift</span>
                      <span className="ugifd-value">{form.shift_label || '—'}</span>
                    </div>
                  </div>
                </section>

                <section className="ugifd-section">
                  <h4 className="ugifd-section-title">
                    Line items
                    <span className="ugifd-count">
                      {fmtInt((form.lines || []).length)}
                    </span>
                  </h4>
                  {renderLineTable(form.lines || [], 'regular')}
                </section>

                {tpl.has_bdm_block && (
                  <section className="ugifd-section ugifd-section--bdm">
                    <h4 className="ugifd-section-title ugifd-section-title--bdm">
                      FOR BDM ONLY
                    </h4>

                    <div className="ugifd-header-grid">
                      <div className="ugifd-field">
                        <span className="ugifd-label">RDM No.</span>
                        <span className="ugifd-value">{form.bdm_rdm_no || '—'}</span>
                      </div>
                      <div className="ugifd-field">
                        <span className="ugifd-label">Shift</span>
                        <span className="ugifd-value">{form.bdm_shift_label || '—'}</span>
                      </div>
                    </div>

                    {renderLineTable(form.bdm_lines || [], 'bdm')}
                  </section>
                )}

                <section className="ugifd-section">
                  <h4 className="ugifd-section-title">Signatures</h4>
                  <div className="ugifd-sig-grid">
                    <div className="ugifd-sig-cell">
                      <span className="ugifd-label">Authorized by</span>
                      <span className="ugifd-value ugifd-value--sig">
                        {form.authorized_name || '—'}
                      </span>
                      {form.authorized_position && (
                        <span className="ugifd-pos">{form.authorized_position}</span>
                      )}
                    </div>

                    <div className="ugifd-sig-cell">
                      <span className="ugifd-label">Issued by</span>
                      <span className="ugifd-value ugifd-value--sig">
                        {form.issued_name || '—'}
                      </span>
                      {form.issued_position && (
                        <span className="ugifd-pos">{form.issued_position}</span>
                      )}
                    </div>

                    <div className="ugifd-sig-cell">
                      <span className="ugifd-label">Received by</span>
                      <span className="ugifd-value ugifd-value--sig">
                        {form.received_name || '—'}
                      </span>
                    </div>

                    <div className="ugifd-sig-cell">
                      <span className="ugifd-label">Bodega (Locator)</span>
                      <span className="ugifd-value ugifd-value--sig ugifd-value--mono">
                        {form.bodega_name || '—'}
                      </span>
                    </div>

                    <div className="ugifd-sig-cell ugifd-sig-cell--chapa">
                      <span className="ugifd-label">Chapa (Employee No.)</span>
                      <span className="ugifd-value ugifd-value--sig ugifd-value--mono">
                        {form.chapa_no || '—'}
                      </span>
                    </div>
                  </div>
                </section>

                {form.remarks && (
                  <section className="ugifd-section">
                    <div className="ugifd-remarks">
                      <strong>Remarks:</strong> {form.remarks}
                    </div>
                  </section>
                )}

                {form.attachment_base64 && form.attachment_mime_type && (
                  <section className="ugifd-section">
                    <h4 className="ugifd-section-title">
                      <FiPaperclip
                        style={{
                          width: 13,
                          height: 13,
                          marginRight: 6,
                          strokeWidth: 2.4,
                          color: '#0f766e',
                        }}
                      />
                      Proof picture
                      <span className="ugifd-count">
                        {form.attachment_name ? form.attachment_name : 'Attached'}
                      </span>
                    </h4>
                    <div className="ugifd-attach-wrap">
                      <img
                        className="ugifd-attach-img"
                        alt={form.attachment_name || 'Proof picture'}
                        src={
                          'data:' +
                          form.attachment_mime_type +
                          ';base64,' +
                          form.attachment_base64
                        }
                      />
                    </div>
                  </section>
                )}
              </>
            )}
          </div>

          <div className="ugmodal-footer">
            <button
              type="button"
              className="ug-btn ug-btn--secondary"
              onClick={onClose}
            >Close</button>
            <button
              type="button"
              className="ug-btn ug-btn--primary"
              onClick={handlePrint}
              disabled={!form || !tpl}
            >
              <FiPrinter />
              <span>Print</span>
            </button>
          </div>
        </div>
      </div>

      {printOpen && form && tpl && (
        <IssueFormPrint
          formData={form}
          onClose={() => setPrintOpen(false)}
        />
      )}
    </>
  );
};

export default IssueFormDetailModal;

const detailCss = `
.ugifd-modal { max-width: min(1120px, 98vw); }

.ugifd-letterhead {
  padding: 4px 0 8px;
  border-bottom: 1px solid #e2e8f0;
}

.ugifd-meta {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  padding: 12px 14px;
  background: linear-gradient(135deg, #f0fdfa 0%, #ecfeff 100%);
  border: 1px solid #99f6e4;
  border-radius: 10px;
}
.ugifd-meta-item { min-width: 0; }
.ugifd-meta-label {
  display: block;
  font-size: 10px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #0f766e;
  margin-bottom: 2px;
}
.ugifd-meta-value {
  display: block;
  font-size: 13px;
  font-weight: 600;
  color: #0f172a;
  word-break: break-word;
}
.ugifd-meta-value--cur { color: #065f46; font-weight: 800; }

.ugifd-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 16px;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
}
.ugifd-section--bdm {
  background: linear-gradient(180deg, #fffdf5 0%, #fffefb 100%);
  border-color: #fcd34d;
}
.ugifd-section-title {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #0f766e;
  padding-bottom: 8px;
  border-bottom: 1px dashed #e2e8f0;
}
.ugifd-section-title::before {
  content: '';
  display: inline-block;
  width: 4px;
  height: 14px;
  background: linear-gradient(180deg, #00e0d4 0%, #008a82 100%);
  border-radius: 2px;
}
.ugifd-section-title--bdm { color: #92400e; }
.ugifd-section-title--bdm::before {
  background: linear-gradient(180deg, #fbbf24 0%, #b45309 100%);
}
.ugifd-count {
  margin-left: auto;
  font-size: 11px;
  font-weight: 700;
  color: #0f766e;
  background: #f0fdfa;
  border: 1px solid #99f6e4;
  border-radius: 999px;
  padding: 2px 10px;
  letter-spacing: 0.02em;
  text-transform: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 260px;
}

.ugifd-header-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px 14px;
}
.ugifd-field--wide { grid-column: span 2; }

.ugifd-field,
.ugifd-sig-cell {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.ugifd-label {
  font-size: 10px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #64748b;
}
.ugifd-value {
  font-size: 13px;
  font-weight: 600;
  color: #0f172a;
  word-break: break-word;
}
.ugifd-value--sig {
  font-weight: 700;
  border-bottom: 1px solid #cbd5e1;
  padding-bottom: 2px;
}
.ugifd-value--mono {
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-size: 12.5px;
  letter-spacing: 0.01em;
}
.ugifd-pos {
  font-size: 11px;
  color: #64748b;
  margin-top: 2px;
}

.ugifd-table-wrap {
  overflow-x: auto;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  background: #ffffff;
  -webkit-overflow-scrolling: touch;
}
.ugifd-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;
  min-width: 640px;
}
.ugifd-table thead th {
  text-align: left;
  padding: 10px 12px;
  font-size: 10.5px;
  font-weight: 800;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: #475569;
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
  white-space: nowrap;
}
.ugifd-table tbody td {
  padding: 10px 12px;
  border-bottom: 1px solid #f1f5f9;
  color: #0f172a;
  vertical-align: middle;
}
.ugifd-table tbody tr:last-child td { border-bottom: none; }
.ugifd-num { text-align: right; font-variant-numeric: tabular-nums; }
.ugifd-num--strong { font-weight: 700; color: #0f172a; }
.ugifd-center { text-align: center; }
.ugifd-code {
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-weight: 700;
  font-size: 12px;
  color: #008a82;
  white-space: nowrap;
}
.ugifd-amount {
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-weight: 700;
  color: #065f46;
}
.ugifd-empty {
  padding: 16px;
  text-align: center;
  font-size: 12.5px;
  color: #94a3b8;
  background: #f8fafc;
  border: 1px dashed #cbd5e1;
  border-radius: 10px;
}

.ugifd-sig-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px 14px;
}
.ugifd-sig-cell--chapa { grid-column: span 1; }

.ugifd-remarks {
  padding: 10px 12px;
  background: #f8fafc;
  border: 1px dashed #cbd5e1;
  border-radius: 8px;
  font-size: 12.5px;
  color: #334155;
  line-height: 1.5;
}

.ugifd-attach-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 10px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  overflow: hidden;
}
.ugifd-attach-img {
  display: block;
  max-width: 100%;
  max-height: 420px;
  width: auto;
  height: auto;
  border-radius: 6px;
  border: 1px solid #cbd5e1;
  background: #ffffff;
  object-fit: contain;
}

@media (max-width: 900px) {
  .ugifd-meta { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .ugifd-header-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .ugifd-sig-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 640px) {
  .ugifd-attach-img { max-height: 300px; }
  .ugifd-count { max-width: 180px; }
}
@media (max-width: 480px) {
  .ugifd-meta { grid-template-columns: 1fr; }
  .ugifd-header-grid,
  .ugifd-sig-grid { grid-template-columns: 1fr; }
  .ugifd-field--wide { grid-column: span 1; }
  .ugifd-section { padding: 12px; }
  .ugifd-attach-img { max-height: 220px; }
  .ugifd-attach-wrap { padding: 8px; }
  .ugifd-count { max-width: 140px; font-size: 10.5px; }
}
@media (max-width: 360px) {
  .ugifd-section { padding: 10px; }
  .ugifd-attach-img { max-height: 180px; }
  .ugifd-count { max-width: 110px; }
}
@media (min-width: 1921px) {
  .ugifd-table { font-size: 13.5px; }
  .ugifd-value { font-size: 14px; }
  .ugifd-section { padding: 18px 20px; }
  .ugifd-attach-img { max-height: 560px; }
}

@media (prefers-reduced-motion: reduce) {
  .ugifd-meta,
  .ugifd-section { transition: none !important; }
}
`;