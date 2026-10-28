// src/components/shared/stockTransfer/HybridSelect.jsx
import React, { useEffect, useMemo, useRef, useState } from 'react';

// ============================================================
// HybridSelect — input + dropdown
//
// Lifted verbatim from TabStockTransfer.jsx. Behavior is
// unchanged: typing filters, arrow keys navigate, Enter selects,
// Escape closes, clicking outside closes.
//
// Styling comes from the `tsm-hybrid-*` rules in the shared
// Stock Transfer modal CSS (stockTransferModalCss.js).
//
// Props:
//   • value         — current selected value (string)
//   • displayText   — text to show in the input when a value is set
//   • onChange      — called with the full item on select, or null on edit
//   • items         — array of { value, label, sub?, ... }
//   • loading       — shows "Loading…" in the dropdown
//   • placeholder   — input placeholder
//   • emptyLabel    — dropdown message when filtered.length === 0
//   • disabled      — disables the input and dropdown
//   • onQueryChange — optional side-channel for the typed query
//   • primaryField  — 'value' (default) or 'label' — which field is primary
// ============================================================
const HybridSelect = ({
  value,
  displayText,
  onChange,
  items = [],
  loading = false,
  placeholder = 'Search…',
  emptyLabel = 'No matches',
  disabled = false,
  onQueryChange,
  primaryField = 'value',
}) => {
  const initialText = displayText != null && displayText !== ''
    ? displayText
    : (value || '');

  const [query, setQuery] = useState(initialText);
  const [open, setOpen]   = useState(false);
  const [highlight, setHighlight] = useState(0);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (value) {
      const text = displayText != null && displayText !== '' ? displayText : value;
      setQuery(text);
    }
  }, [value, displayText]);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const filtered = useMemo(() => {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return items.slice(0, 50);
    return items
      .filter((i) =>
        String(i.value || '').toLowerCase().includes(q) ||
        String(i.label || '').toLowerCase().includes(q) ||
        String(i.sub   || '').toLowerCase().includes(q)
      )
      .slice(0, 50);
  }, [items, query]);

  const handleInput = (v) => {
    setQuery(v);
    setOpen(true);
    setHighlight(0);
    onChange(null);
    if (onQueryChange) onQueryChange(v);
  };

  const handleSelect = (item) => {
    const display = primaryField === 'label'
      ? (item.label || item.value || '')
      : (item.value || '');
    setQuery(display);
    setOpen(false);
    onChange(item);
  };

  const handleKey = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault(); setOpen(true);
      setHighlight((h) => Math.min(h + 1, Math.max(filtered.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      if (open && filtered[highlight]) { e.preventDefault(); handleSelect(filtered[highlight]); }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div ref={wrapRef} className="tsm-hybrid">
      <input
        className="tsm-input"
        type="text"
        value={query}
        placeholder={placeholder}
        onChange={(e) => handleInput(e.target.value)}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKey}
        disabled={disabled}
        autoComplete="off"
      />
      {open && !disabled && (
        <div className="tsm-hybrid-dropdown" role="listbox">
          {loading ? (
            <div className="tsm-hybrid-empty">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="tsm-hybrid-empty">{emptyLabel}</div>
          ) : (
            filtered.map((item, idx) => {
              const primary = primaryField === 'label'
                ? (item.label || item.value || '')
                : (item.value || '');
              const secondary = primaryField === 'label'
                ? (item.value || '')
                : (item.label || '');
              return (
                <div
                  key={item.value}
                  role="option"
                  aria-selected={idx === highlight}
                  className={`tsm-hybrid-option${idx === highlight ? ' is-highlighted' : ''}`}
                  onMouseDown={(e) => { e.preventDefault(); handleSelect(item); }}
                  onMouseEnter={() => setHighlight(idx)}
                >
                  <div className="tsm-hybrid-option-value">{primary}</div>
                  {secondary && <div className="tsm-hybrid-option-label">{secondary}</div>}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
};

export default HybridSelect;