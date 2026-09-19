// src/components/registrar/ReceivePoModal.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { importPoApi, itemMasterApi } from '../../services/api';
import ItemImageThumb from '../shared/ItemImageThumb';

const CURRENCIES = ['PHP', 'USD', 'AUD', 'JPY'];

// ============================================================
// Modal width per step — keeps the layout balanced regardless
// of how little content a step has.
// ============================================================
const MODAL_WIDTH = {
  mode:    760,   // mode picker
  entry:  1180,   // line-entry table
  saved:   580,   // confirmation / what-next
};

const ReceivePoModal = ({
  po,
  warehouseLabel,
  lines,
  onClose,
  onSaved,
  onSendToHandler,
}) => {
  const [mode, setMode]                         = useState(null); // null | 'complete' | 'partial' | 'saved'
  const [editable, setEditable]                 = useState([]);
  const [saving, setSaving]                     = useState(false);
  const [images, setImages]                     = useState({});
  const [currentLines, setCurrentLines]         = useState(lines || []);
  const [savedSummary, setSavedSummary]         = useState(null);
  const [postActionBusy, setPostActionBusy]     = useState(false);
  const [postActionError, setPostActionError]   = useState('');

  // Sync when the parent passes fresh lines (e.g., modal reopen)
  useEffect(() => {
    setCurrentLines(lines || []);
  }, [lines]);

  // Fetch item images when lines change
  useEffect(() => {
    const codes = [...new Set((currentLines || []).map((l) => l.item_code).filter(Boolean))];
    if (codes.length === 0) return;

    let cancelled = false;
    (async () => {
      try {
        const res = await itemMasterApi.getImagesByCodes(codes);
        if (!cancelled && res.ok && res.data?.images) {
          setImages(res.data.images);
        }
      } catch (err) {
        console.warn('Could not load item images:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [currentLines]);

  // ============================================================
  // Step 1 — pick mode
  // ============================================================
  const handleChooseMode = (chosen) => {
    setMode(chosen);
    setEditable(
      currentLines.map((l) => {
        const ordered   = Number(l.qty)          || 0;
        const received  = Number(l.received_qty) || 0;
        const damaged   = Number(l.damaged_qty)  || 0;
        const remaining = Math.max(0, ordered - received - damaged);

        return {
          id:               l.id,
          item_code:        l.item_code,
          item_name:        l.item_name || '',
          uom:              l.uom || '',
          ordered_qty:      ordered,
          already_received: received,
          already_damaged:  damaged,
          remaining,
          incoming_received: chosen === 'complete' ? remaining : 0,
          incoming_damaged:  0,
          damage_reason:     '',
          unit_price:        l.unit_price ?? '',
          currency:          l.currency || 'PHP',
          line_status:       l.status,
        };
      })
    );
  };

  // ============================================================
  // Line edits — Damage drives Receive
  // ============================================================
  const handleChange = (id, field, value) => {
    setEditable((prev) =>
      prev.map((l) => {
        if (l.id !== id) return l;
        const max = l.remaining;

        if (field === 'incoming_damaged') {
          if (value === '' || value === null || value === undefined) {
            return { ...l, incoming_damaged: '' };
          }
          const d = Math.max(0, Math.min(parseInt(value, 10) || 0, max));
          return {
            ...l,
            incoming_damaged:  d,
            incoming_received: Math.max(0, max - d),
          };
        }

        if (field === 'incoming_received') {
          if (value === '' || value === null || value === undefined) {
            return { ...l, incoming_received: '' };
          }
          const r = Math.max(0, Math.min(parseInt(value, 10) || 0, max));
          const d = parseInt(l.incoming_damaged, 10) || 0;
          const newDamaged = (r + d > max) ? Math.max(0, max - r) : d;
          return {
            ...l,
            incoming_received: r,
            incoming_damaged:  newDamaged,
          };
        }

        return { ...l, [field]: value };
      })
    );
  };

  // ============================================================
  // Save → post-save step
  // ============================================================
  const handleSave = async () => {
    const items = editable
      .map((l) => ({
        id:            l.id,
        received_qty:  Number(l.incoming_received) || 0,
        damaged_qty:   Number(l.incoming_damaged)  || 0,
        damage_reason: l.incoming_damaged > 0 ? (l.damage_reason || '').trim() : null,
        unit_price:    l.unit_price === '' || l.unit_price === null
                         ? null
                         : Number(l.unit_price),
        currency:      l.currency || null,
      }))
      .filter((it) => it.received_qty > 0 || it.damaged_qty > 0);

    if (items.length === 0) {
      alert('Please enter at least one received or damaged quantity.');
      return;
    }

    const missingReason = editable.find(
      (l) => l.incoming_damaged > 0 && !l.damage_reason.trim()
    );
    if (missingReason) {
      alert(`Please enter a damage reason for ${missingReason.item_code}.`);
      return;
    }

    const modeLabel = mode === 'complete' ? 'COMPLETE' : 'PARTIAL';
    const confirmMsg =
      `📦 Submit ${modeLabel} receive?\n\n` +
      `PO No.:    ${po.po_no}\n` +
      `Warehouse: ${warehouseLabel}\n` +
      `Lines:     ${items.length}\n\n` +
      `Proceed?`;
    if (!window.confirm(confirmMsg)) return;

    setSaving(true);
    try {
      const res = await importPoApi.receivePO(po.po_no, items);
      if (!res.ok) {
        alert('❌ ' + (res.data?.message || 'Failed to save receipt.'));
        return;
      }

      const totalGood = items.reduce((s, it) => s + (Number(it.received_qty) || 0), 0);
      const totalDmg  = items.reduce((s, it) => s + (Number(it.damaged_qty)  || 0), 0);

      setSavedSummary({ linesCount: items.length, totalGood, totalDmg });
      setMode('saved');
      setPostActionError('');
    } catch (err) {
      console.error(err);
      alert('❌ Error saving receipt.');
    } finally {
      setSaving(false);
    }
  };

  // ============================================================
  // Post-save actions
  // ============================================================
  const handleEditAfterSave = async () => {
    setPostActionBusy(true);
    setPostActionError('');
    try {
      const res = await importPoApi.getPODetail(po.po_no);
      if (!res.ok || !Array.isArray(res.data)) {
        setPostActionError('Could not reload PO data. Close and reopen the modal.');
        return;
      }
      setCurrentLines(res.data);
      setEditable([]);
      setMode(null);
      setSavedSummary(null);
    } catch (err) {
      console.error(err);
      setPostActionError('Error reloading PO. Close and reopen the modal.');
    } finally {
      setPostActionBusy(false);
    }
  };

  const handleSendAfterSave = async () => {
    if (!onSendToHandler) {
      onSaved?.();
      onClose();
      return;
    }

    const ok = window.confirm(
      `📤 Send this PO's received lines to the Stock Handler?\n\n` +
      `PO No.: ${po.po_no}\n\n` +
      `You will not be able to edit the receipt after this. ` +
      `The lines will move to the Handler's queue.\n\n` +
      `Proceed?`
    );
    if (!ok) return;

    setPostActionBusy(true);
    setPostActionError('');
    try {
      const success = await onSendToHandler(po.po_no);
      if (success) {
        onSaved?.();
        onClose();
      }
    } finally {
      setPostActionBusy(false);
    }
  };

  // ============================================================
  // Summary counts
  // ============================================================
  const summary = useMemo(() => {
    if (editable.length === 0) return { total: 0, received: 0, damaged: 0 };
    let received = 0, damaged = 0;
    for (const l of editable) {
      received += Number(l.incoming_received) || 0;
      damaged  += Number(l.incoming_damaged)  || 0;
    }
    return { total: editable.length, received, damaged };
  }, [editable]);

  // ============================================================
  // Render: Mode-selection step
  // ============================================================
  const renderModeStep = () => (
    <>
      <p style={styles.modeIntro}>
        How do you want to receive{' '}
        <strong style={styles.modePoNo}>{po.po_no}</strong>?
      </p>

      <div className="rpm-mode-grid" style={styles.modeGrid}>
        <button
          type="button"
          onClick={() => handleChooseMode('complete')}
          className="rpm-mode-card rpm-mode-complete"
          style={{ ...styles.modeCard, ...styles.modeCardComplete }}
        >
          <div style={styles.modeEmoji}>✅</div>
          <div style={{ ...styles.modeTitle, color: '#065f46' }}>
            Complete Receive
          </div>
          <div style={styles.modeDesc}>Receive all remaining items in full</div>
        </button>

        <button
          type="button"
          onClick={() => handleChooseMode('partial')}
          className="rpm-mode-card rpm-mode-partial"
          style={{ ...styles.modeCard, ...styles.modeCardPartial }}
        >
          <div style={styles.modeEmoji}>📦</div>
          <div style={{ ...styles.modeTitle, color: '#92400e' }}>
            Partial Receive
          </div>
          <div style={styles.modeDesc}>Enter custom quantities per line</div>
        </button>
      </div>
    </>
  );

  // ============================================================
  // Render: Line-entry step
  // ============================================================
  const renderEntryStep = () => (
    <>
      <div className="rpm-badges" style={styles.badges}>
        <span
          style={{
            ...styles.modeBadge,
            background: mode === 'complete' ? '#dcfce7' : '#fef3c7',
            color:      mode === 'complete' ? '#065f46' : '#92400e',
          }}
        >
          {mode === 'complete' ? '✅ Complete Receive' : '📦 Partial Receive'}
        </span>

        <div style={styles.summaryStats}>
          <span style={styles.summaryStat}>
            <strong style={styles.summaryValue}>{summary.total}</strong> lines
          </span>
          <span style={styles.summaryStat}>
            <strong style={{ ...styles.summaryValue, color: '#059669' }}>
              {summary.received}
            </strong>{' '}
            receive
          </span>
          {summary.damaged > 0 && (
            <span style={styles.summaryStat}>
              <strong style={{ ...styles.summaryValue, color: '#dc2626' }}>
                {summary.damaged}
              </strong>{' '}
              damaged
            </span>
          )}
        </div>

        <button
          type="button"
          className="cancel-btn"
          onClick={() => { setMode(null); setEditable([]); }}
          style={{ marginLeft: 'auto', padding: '6px 14px', fontSize: 13 }}
        >
          ← Change Mode
        </button>
      </div>

      <div style={styles.tableWrap}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Item</th>
              <th style={{ ...styles.th, textAlign: 'center' }}>UOM</th>
              <th style={{ ...styles.th, textAlign: 'center' }}>Ordered</th>
              <th style={{ ...styles.th, textAlign: 'center' }}>Remaining</th>
              <th style={styles.th}>Receive</th>
              <th style={styles.th}>Damage</th>
              <th style={styles.th}>Reason</th>
              <th style={styles.th}>Price</th>
              <th style={{ ...styles.th, textAlign: 'center' }}>Curr</th>
            </tr>
          </thead>
          <tbody>
            {editable.map((l) => {
              const totalEntered =
                (parseInt(l.incoming_received, 10) || 0) +
                (parseInt(l.incoming_damaged,  10) || 0);
              const full = totalEntered >= l.remaining && l.remaining > 0;

              return (
                <tr key={l.id} style={full ? styles.rowComplete : styles.row}>
                  <td style={styles.tdItem}>
                    <div style={styles.itemCell}>
                      <ItemImageThumb
                        src={images[l.item_code]}
                        alt={l.item_code}
                        size={44}
                      />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={styles.itemCode}>{l.item_code}</div>
                        <div style={styles.itemName} title={l.item_name}>
                          {l.item_name || '—'}
                        </div>
                      </div>
                    </div>
                  </td>

                  <td style={{ ...styles.td, textAlign: 'center' }}>
                    <span style={styles.uomTag}>{l.uom || '—'}</span>
                  </td>

                  <td style={{ ...styles.td, textAlign: 'center', fontWeight: 600 }}>
                    {l.ordered_qty}
                  </td>

                  <td style={{ ...styles.td, textAlign: 'center' }}>
                    <strong
                      style={{
                        color: l.remaining > 0 ? '#dc2626' : '#059669',
                        fontSize: 15,
                      }}
                    >
                      {l.remaining}
                    </strong>
                  </td>

                  <td style={styles.td}>
                    <input
                      type="number"
                      min="0"
                      max={l.remaining}
                      value={l.incoming_received}
                      onChange={(e) =>
                        handleChange(l.id, 'incoming_received', e.target.value)
                      }
                      disabled={l.remaining === 0 || saving}
                      style={{ ...styles.numInput, borderColor: '#10b981' }}
                    />
                  </td>

                  <td style={styles.td}>
                    <input
                      type="number"
                      min="0"
                      max={l.remaining}
                      value={l.incoming_damaged}
                      onChange={(e) =>
                        handleChange(l.id, 'incoming_damaged', e.target.value)
                      }
                      disabled={l.remaining === 0 || saving}
                      style={{ ...styles.numInput, borderColor: '#ef4444' }}
                    />
                  </td>

                  <td style={styles.td}>
                    <input
                      type="text"
                      value={l.damage_reason}
                      onChange={(e) =>
                        handleChange(l.id, 'damage_reason', e.target.value)
                      }
                      disabled={l.incoming_damaged === 0 || saving}
                      placeholder={l.incoming_damaged > 0 ? 'Required' : '—'}
                      style={{
                        ...styles.textInput,
                        background:
                          l.incoming_damaged > 0 ? '#fef2f2' : '#f8fafc',
                        borderColor:
                          l.incoming_damaged > 0 ? '#fca5a5' : '#e2e8f0',
                      }}
                    />
                  </td>

                  <td style={styles.td}>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={l.unit_price}
                      onChange={(e) =>
                        handleChange(l.id, 'unit_price', e.target.value)
                      }
                      disabled={saving}
                      placeholder="0.00"
                      style={styles.numInput}
                    />
                  </td>

                  <td style={{ ...styles.td, textAlign: 'center' }}>
                    <select
                      value={l.currency}
                      onChange={(e) =>
                        handleChange(l.id, 'currency', e.target.value)
                      }
                      disabled={saving}
                      style={styles.currSelect}
                    >
                      {CURRENCIES.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={styles.noteBlock}>
        <span style={styles.noteIcon}>ℹ️</span>
        <span>
          Total (Receive + Damage) per line cannot exceed the Remaining
          quantity. Entering a <strong>Damage</strong> count automatically fills
          <strong> Receive</strong> with <strong>Remaining − Damage</strong>. You
          can still type Receive directly — Damage will adjust if needed.
        </span>
      </div>
    </>
  );

  // ============================================================
  // Render: Post-save step — balanced for the 580px modal
  // ============================================================
  const renderSavedStep = () => (
    <div style={styles.savedWrap}>
      {/* Compact status strip */}
      <div style={styles.savedStrip}>
        <div style={styles.savedStripIcon}>✅</div>
        <div style={styles.savedStripText}>
          <div style={styles.savedStripTitle}>Receipt Saved</div>
          <div style={styles.savedStripMeta}>
            <strong>{savedSummary?.linesCount ?? 0}</strong> line
            {(savedSummary?.linesCount ?? 0) === 1 ? '' : 's'}
            {' · '}
            <strong style={{ color: '#059669' }}>
              {savedSummary?.totalGood ?? 0}
            </strong>{' '}
            good
            {(savedSummary?.totalDmg ?? 0) > 0 && (
              <>
                {' · '}
                <strong style={{ color: '#dc2626' }}>
                  {savedSummary.totalDmg}
                </strong>{' '}
                damaged
              </>
            )}
          </div>
        </div>
      </div>

      {postActionError && (
        <div style={styles.errorBox}>
          <span style={styles.errorIcon}>⚠️</span>
          <span>{postActionError}</span>
        </div>
      )}

      {/* Stacked choices — better rhythm at 580px than side-by-side */}
      <div style={styles.savedActions}>
        <button
          type="button"
          className="save-btn"
          onClick={handleSendAfterSave}
          disabled={postActionBusy}
          style={styles.savedPrimaryBtn}
          title="Send this warehouse's lines to the Stock Handler"
        >
          {postActionBusy ? 'Working…' : '📤 Send to Handler'}
        </button>

        <button
          type="button"
          className="cancel-btn"
          onClick={handleEditAfterSave}
          disabled={postActionBusy}
          style={styles.savedSecondaryBtn}
          title="Go back and correct the quantities before sending"
        >
          ✏️ Edit Receipt
        </button>
      </div>

      <div style={styles.savedHint}>
        <strong>Edit Receipt</strong> if you need to fix quantities. Once sent,
        the lines move to the Handler and can no longer be edited here.
      </div>
    </div>
  );

  // ============================================================
  // Render
  // ============================================================
  const isSaved = mode === 'saved';

  const cardMaxWidth = isSaved
    ? MODAL_WIDTH.saved
    : mode === null
      ? MODAL_WIDTH.mode
      : MODAL_WIDTH.entry;

  return (
    <>
      <style>{responsiveCss}</style>

      <div
        className="rpm-overlay"
        style={styles.overlay}
        onClick={saving || postActionBusy ? undefined : onClose}
      >
        <div
          className="rpm-card"
          style={{ ...styles.card, maxWidth: cardMaxWidth }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* ---------- HEADER ---------- */}
          <div
            className="rpm-header"
            style={{
              ...styles.header,
              ...(isSaved ? styles.headerCompact : null),
            }}
          >
            <div style={styles.headerLeft}>
              <div
                style={{
                  ...styles.headerIcon,
                  ...(isSaved ? styles.headerIconCompact : null),
                }}
              >
                📦
              </div>
              <div style={{ minWidth: 0 }}>
                <h3
                  style={{
                    ...styles.headerTitle,
                    ...(isSaved ? styles.headerTitleCompact : null),
                  }}
                >
                  {isSaved ? 'Receipt Saved' : 'Receive Purchase Order'}
                </h3>
                <div style={styles.headerSub}>
                  <span style={styles.headerPoNo}>{po.po_no}</span>
                  <span style={styles.headerDot}>·</span>
                  <span>{warehouseLabel || 'Not assigned'}</span>
                </div>
              </div>
            </div>

            <button
              type="button"
              className="rpm-close"
              onClick={onClose}
              disabled={saving || postActionBusy}
              style={styles.closeBtn}
              title="Close"
            >
              ✕
            </button>
          </div>

          {/* ---------- BODY ---------- */}
          <div
            className="rpm-body"
            style={{
              ...styles.body,
              ...(isSaved ? styles.bodyCompact : null),
            }}
          >
            {mode === 'saved'
              ? renderSavedStep()
              : mode === null
                ? renderModeStep()
                : renderEntryStep()}
          </div>

          {/* ---------- FOOTER (hidden in saved mode) ---------- */}
          {!isSaved && (
            <div className="rpm-footer" style={styles.footer}>
              <button
                type="button"
                className="cancel-btn"
                onClick={onClose}
                disabled={saving}
              >
                Cancel
              </button>

              {mode !== null && (
                <button
                  type="button"
                  className="save-btn"
                  onClick={handleSave}
                  disabled={saving}
                >
                  {saving ? 'Saving…' : '✅ Save Receipt'}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
};

// ============================================================
// INLINE STYLES
// ============================================================
const styles = {
  // ---- Overlay / Card ----
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(15, 23, 42, 0.62)',
    backdropFilter: 'blur(6px)',
    WebkitBackdropFilter: 'blur(6px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10000,
    padding: 'clamp(8px, 2vw, 24px)',
    animation: 'rpmFadeIn 0.18s ease',
  },
  card: {
    background: '#ffffff',
    borderRadius: 'clamp(12px, 1.5vw, 18px)',
    width: '100%',
    // maxWidth is set inline per step — see MODAL_WIDTH
    maxHeight: '92vh',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    boxShadow:
      '0 24px 64px rgba(15, 23, 42, 0.28), 0 4px 14px rgba(15, 23, 42, 0.14)',
    fontFamily:
      "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    animation: 'rpmSlideUp 0.22s cubic-bezier(0.34, 1.3, 0.64, 1)',
    transition: 'max-width 0.22s ease',
  },

  // ---- Header ----
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    padding: '18px 24px',
    borderBottom: '1px solid #e5e7eb',
    background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)',
    flexShrink: 0,
  },
  headerCompact: {
    padding: '14px 20px',
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    flex: 1,
    minWidth: 0,
  },
  headerIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    background: 'linear-gradient(135deg, #00e0d4 0%, #008a82 100%)',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 22,
    boxShadow: '0 4px 12px rgba(0, 210, 200, 0.32)',
    flexShrink: 0,
  },
  headerIconCompact: {
    width: 38,
    height: 38,
    borderRadius: 10,
    fontSize: 18,
  },
  headerTitle: {
    margin: 0,
    fontSize: 18,
    fontWeight: 700,
    color: '#0f172a',
    letterSpacing: '-0.01em',
    lineHeight: 1.2,
  },
  headerTitleCompact: {
    fontSize: 16,
  },
  headerSub: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 3,
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
  },
  headerPoNo: {
    fontFamily: "'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace",
    fontWeight: 700,
    color: '#0f766e',
  },
  headerDot: { color: '#cbd5e1' },
  closeBtn: {
    background: 'transparent',
    border: 'none',
    width: 36,
    height: 36,
    borderRadius: 8,
    cursor: 'pointer',
    fontSize: 18,
    color: '#64748b',
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ---- Body / Footer ----
  body: {
    flex: 1,
    overflowY: 'auto',
    padding: '22px 24px',
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
    background: '#ffffff',
  },
  bodyCompact: {
    padding: '20px 22px',
    gap: 14,
  },
  footer: {
    display: 'flex',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 10,
    padding: '14px 24px',
    borderTop: '1px solid #e5e7eb',
    background: '#f8fafc',
    flexShrink: 0,
    flexWrap: 'wrap',
  },

  // ---- Mode step ----
  modeIntro: {
    margin: 0,
    textAlign: 'center',
    color: '#475569',
    fontSize: 15,
    padding: '4px 0 8px',
  },
  modePoNo: {
    color: '#0f766e',
    fontFamily: "'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace",
  },
  modeGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 18,
  },
  modeCard: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '32px 22px',
    border: '2px solid',
    borderRadius: 14,
    cursor: 'pointer',
    textAlign: 'center',
    fontFamily: 'inherit',
    transition: 'transform 0.18s ease, box-shadow 0.18s ease',
    background: '#fff',
  },
  modeCardComplete: {
    borderColor: '#10b981',
    background: 'linear-gradient(135deg, #f0fdf4 0%, #ecfdf5 100%)',
    boxShadow: '0 4px 16px rgba(16, 185, 129, 0.12)',
  },
  modeCardPartial: {
    borderColor: '#f59e0b',
    background: 'linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%)',
    boxShadow: '0 4px 16px rgba(245, 158, 11, 0.12)',
  },
  modeEmoji: { fontSize: 42, marginBottom: 12, lineHeight: 1 },
  modeTitle: {
    fontSize: 16,
    fontWeight: 700,
    marginBottom: 6,
    letterSpacing: '-0.01em',
  },
  modeDesc: {
    fontSize: 12.5,
    color: '#64748b',
    lineHeight: 1.45,
  },

  // ---- Entry step ----
  badges: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 12,
    padding: '12px 16px',
    background: '#f8fafc',
    border: '1px solid #e2e8f0',
    borderRadius: 10,
  },
  modeBadge: {
    display: 'inline-block',
    padding: '5px 12px',
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: '0.02em',
  },
  summaryStats: {
    display: 'flex',
    gap: 14,
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  summaryStat: { fontSize: 13, color: '#475569' },
  summaryValue: {
    fontWeight: 700,
    color: '#0f172a',
    marginRight: 2,
  },

  tableWrap: {
    overflow: 'auto',
    maxHeight: '52vh',
    border: '1px solid #e2e8f0',
    borderRadius: 10,
    background: '#fff',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    minWidth: 1020,
    fontSize: 13,
  },
  th: {
    padding: '11px 12px',
    textAlign: 'left',
    fontSize: 11,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    color: '#64748b',
    background: '#f8fafc',
    borderBottom: '1px solid #e2e8f0',
    position: 'sticky',
    top: 0,
    zIndex: 1,
    whiteSpace: 'nowrap',
  },
  row: {
    borderBottom: '1px solid #f1f5f9',
  },
  rowComplete: {
    borderBottom: '1px solid #f1f5f9',
    background: 'rgba(16, 185, 129, 0.06)',
  },
  td: {
    padding: '10px 12px',
    color: '#0f172a',
    fontSize: 13,
    verticalAlign: 'middle',
  },
  tdItem: {
    padding: '10px 12px',
    verticalAlign: 'middle',
    minWidth: 200,
  },

  itemCell: {
    display: 'flex',
    alignItems: 'center',
    gap: 11,
    minWidth: 0,
  },
  itemCode: {
    fontWeight: 700,
    fontSize: 13,
    fontFamily: "'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace",
    color: '#0f766e',
    letterSpacing: '0.02em',
    lineHeight: 1.2,
  },
  itemName: {
    fontSize: 11.5,
    color: '#475569',
    marginTop: 2,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    lineHeight: 1.3,
  },
  uomTag: {
    display: 'inline-block',
    padding: '3px 9px',
    background: '#f1f5f9',
    color: '#334155',
    borderRadius: 6,
    fontSize: 11,
    fontWeight: 600,
    fontFamily: "'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace",
  },

  numInput: {
    width: '100%',
    minWidth: 68,
    maxWidth: 92,
    padding: '7px 10px',
    fontSize: 13,
    border: '1.5px solid #cbd5e1',
    borderRadius: 7,
    background: '#fff',
    color: '#0f172a',
    fontFamily: 'inherit',
    textAlign: 'center',
    transition: 'border-color 0.15s ease',
    outline: 'none',
  },
  textInput: {
    width: '100%',
    minWidth: 130,
    padding: '7px 10px',
    fontSize: 13,
    border: '1.5px solid #e2e8f0',
    borderRadius: 7,
    color: '#0f172a',
    fontFamily: 'inherit',
    transition: 'border-color 0.15s ease',
    outline: 'none',
  },
  currSelect: {
    padding: '7px 8px',
    fontSize: 12,
    fontWeight: 600,
    border: '1.5px solid #cbd5e1',
    borderRadius: 7,
    background: '#fff',
    color: '#0f172a',
    fontFamily: "'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace",
    cursor: 'pointer',
    outline: 'none',
  },

  noteBlock: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 8,
    padding: '11px 14px',
    background: '#f0f9ff',
    border: '1px solid #bae6fd',
    borderRadius: 8,
    fontSize: 12,
    color: '#075985',
    lineHeight: 1.5,
  },
  noteIcon: { fontSize: 14, flexShrink: 0 },

  // ---- Post-save step ----
  savedWrap: {
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
    width: '100%',
  },
  savedStrip: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '14px 16px',
    background: 'linear-gradient(135deg, #f0fdfa 0%, #ecfeff 100%)',
    border: '1.5px solid #99f6e4',
    borderRadius: 12,
  },
  savedStripIcon: {
    fontSize: 30,
    lineHeight: 1,
    flexShrink: 0,
  },
  savedStripText: {
    display: 'flex',
    flexDirection: 'column',
    gap: 3,
    minWidth: 0,
    textAlign: 'left',
  },
  savedStripTitle: {
    fontSize: 15,
    fontWeight: 700,
    color: '#0f766e',
    letterSpacing: '-0.01em',
    lineHeight: 1.2,
  },
  savedStripMeta: {
    fontSize: 12.5,
    color: '#475569',
    lineHeight: 1.4,
  },
  savedActions: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  savedPrimaryBtn: {
    padding: '14px 18px',
    fontSize: 14,
    fontWeight: 700,
    minHeight: 48,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    whiteSpace: 'nowrap',
  },
  savedSecondaryBtn: {
    padding: '12px 18px',
    fontSize: 13.5,
    fontWeight: 700,
    minHeight: 44,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    whiteSpace: 'nowrap',
  },
  savedHint: {
    padding: '10px 14px',
    background: '#fffbeb',
    border: '1px solid #fde68a',
    borderRadius: 8,
    fontSize: 12,
    color: '#78350f',
    lineHeight: 1.5,
    textAlign: 'left',
  },
  errorBox: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 8,
    padding: '10px 14px',
    background: '#fef2f2',
    border: '1px solid #fecaca',
    borderRadius: 8,
    fontSize: 13,
    color: '#991b1b',
    textAlign: 'left',
  },
  errorIcon: { fontSize: 16, lineHeight: 1, flexShrink: 0 },
};

// ============================================================
// RESPONSIVE CSS
// ============================================================
const responsiveCss = `
@keyframes rpmFadeIn {
  from { opacity: 0; }
  to   { opacity: 1; }
}
@keyframes rpmSlideUp {
  from { opacity: 0; transform: translateY(16px) scale(0.98); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}

.rpm-close:hover:not(:disabled) {
  background: #f1f5f9;
  color: #0f172a;
}
.rpm-close:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.rpm-body::-webkit-scrollbar { width: 8px; }
.rpm-body::-webkit-scrollbar-track {
  background: #f1f5f9;
  border-radius: 4px;
}
.rpm-body::-webkit-scrollbar-thumb {
  background: #cbd5e1;
  border-radius: 4px;
}
.rpm-body::-webkit-scrollbar-thumb:hover {
  background: #94a3b8;
}

.rpm-mode-card:hover:not(:disabled) {
  transform: translateY(-3px);
}
.rpm-mode-complete:hover {
  box-shadow: 0 8px 24px rgba(16, 185, 129, 0.22) !important;
}
.rpm-mode-partial:hover {
  box-shadow: 0 8px 24px rgba(245, 158, 11, 0.22) !important;
}
.rpm-mode-card:active {
  transform: translateY(-1px) scale(0.99);
}

@media (max-width: 900px) {
  .rpm-body { padding: 16px; }
  .rpm-header { padding: 14px 18px; }
  .rpm-footer { padding: 12px 16px; }
}

@media (max-width: 640px) {
  .rpm-mode-grid { grid-template-columns: 1fr !important; }
  .rpm-badges {
    flex-direction: column;
    align-items: stretch !important;
  }
  .rpm-badges > button {
    margin-left: 0 !important;
  }
  .rpm-footer button { flex: 1 1 auto; }
}

@media (max-width: 400px) {
  .rpm-overlay { padding: 0; }
  .rpm-card {
    max-height: 100vh;
    border-radius: 0;
    width: 100vw;
    height: 100vh;
    max-width: 100vw !important;
  }
}

@media (prefers-reduced-motion: reduce) {
  .rpm-card, .rpm-overlay {
    animation: none !important;
    transition: none !important;
  }
  .rpm-mode-card {
    transition: none !important;
  }
}
`;

export default ReceivePoModal;