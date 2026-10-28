// src/components/shared/SearchableLocatorSelect.jsx
import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import {
  FiSearch, FiX, FiChevronDown, FiLoader, FiAlertCircle,
} from 'react-icons/fi';
import { locatorsApi } from '../../services/api';

// ============================================================
// SearchableLocatorSelect
//
// Server-side searchable combobox for picking a locator.
//
// Why: warehouses can have thousands of locators. Loading them all
// into a <select> is slow, unsearchable, and caps out (the /locators
// endpoint caps `limit` at 200). This component:
//   • fetches 20 at a time
//   • searches server-side with a 250 ms debounce
//   • infinite-scrolls to load more
//   • filters to Regular locators server-side (excludes Damage)
//   • resolves an externally-set `value` even when it's not on page 1
//
// Props:
//   • warehouseCode     — string, required
//   • value             — string locator_code (controlled)
//   • onChange          — (locatorObject | null) => void
//   • disabled          — boolean
//   • placeholder       — input placeholder
//   • excludeDamage     — default true → locator_type=Regular on server
//   • autoSelectSingle  — default false → auto-select if exactly 1
// ============================================================

const PAGE_SIZE   = 20;
const DEBOUNCE_MS = 250;

const SearchableLocatorSelect = ({
  warehouseCode,
  value,
  onChange,
  disabled = false,
  placeholder = 'Search locator by code or name…',
  excludeDamage = true,
  autoSelectSingle = false,
}) => {
  const [open, setOpen]               = useState(false);
  const [query, setQuery]             = useState('');
  const [items, setItems]             = useState([]);
  const [total, setTotal]             = useState(0);
  const [page, setPage]               = useState(1);
  const [loading, setLoading]         = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError]             = useState('');
  const [highlight, setHighlight]     = useState(0);

  const wrapRef      = useRef(null);
  const listRef      = useRef(null);
  const reqIdRef     = useRef(0);
  const debounceRef  = useRef(null);
  const firstLoadRef = useRef(false);

  // -------- Display text for the currently-selected value --------
  const selectedItem = useMemo(
    () => items.find((it) => it.locator_code === value) || null,
    [items, value]
  );

  const displayText = useMemo(() => {
    if (!value) return '';
    if (selectedItem) {
      return selectedItem.locator_name
        ? `${selectedItem.locator_code} — ${selectedItem.locator_name}`
        : selectedItem.locator_code;
    }
    return value;
  }, [value, selectedItem]);

  // -------- If value is set but not in our list, fetch it once --------
  useEffect(() => {
    if (!value || !warehouseCode) return undefined;
    if (items.some((it) => it.locator_code === value)) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const res = await locatorsApi.list({
          warehouse_code: warehouseCode,
          search:         value,
          page:           1,
          limit:          5,
        });
        if (cancelled || !res.ok) return;
        const list = Array.isArray(res.data) ? res.data : [];
        const match = list.find((l) => l.locator_code === value);
        if (match) {
          setItems((prev) =>
            prev.some((p) => p.locator_code === match.locator_code)
              ? prev
              : [...prev, match]
          );
        }
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, warehouseCode]);

  // -------- Fetch a page from the server --------
  const fetchPage = useCallback(async ({ pageNum, searchTerm, append }) => {
    if (!warehouseCode) return;
    const reqId = ++reqIdRef.current;

    if (append) setLoadingMore(true);
    else        setLoading(true);
    setError('');

    try {
      const res = await locatorsApi.list({
        warehouse_code: warehouseCode,
        search:         searchTerm && String(searchTerm).trim()
                          ? String(searchTerm).trim()
                          : undefined,
        status:         'Active',
        locator_type:   excludeDamage ? 'Regular' : undefined,
        page:           pageNum,
        limit:          PAGE_SIZE,
      });
      if (reqId !== reqIdRef.current) return;   // stale response

      if (!res.ok) {
        setError(res.data?.message || 'Could not load locators.');
        if (!append) { setItems([]); setTotal(0); }
        return;
      }

      const list = Array.isArray(res.data) ? res.data : [];
      setItems((prev) => (append ? [...prev, ...list] : list));
      setTotal(Number(res.total) || list.length);
      setPage(pageNum);
      firstLoadRef.current = true;
    } catch {
      if (reqId !== reqIdRef.current) return;
      setError('Could not load locators.');
      if (!append) { setItems([]); setTotal(0); }
    } finally {
      if (reqId === reqIdRef.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [warehouseCode, excludeDamage]);

  // -------- Fetch when the panel opens or the query changes (debounced) --------
  useEffect(() => {
    if (!open) return undefined;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const delay = query.trim() === '' ? 0 : DEBOUNCE_MS;
    debounceRef.current = setTimeout(() => {
      fetchPage({ pageNum: 1, searchTerm: query, append: false });
    }, delay);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [open, query, fetchPage]);

  // -------- Outside-click close --------
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  // -------- Optional: auto-select if the warehouse has exactly one regular locator --------
  useEffect(() => {
    if (!autoSelectSingle) return;
    if (!firstLoadRef.current) return;
    if (value) return;
    if (query.trim() !== '') return;
    if (loading || loadingMore) return;
    if (items.length === 1 && total === 1) {
      onChange?.(items[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSelectSingle, items, total, loading, loadingMore, value, query]);

  // -------- Handlers --------
  const handleSelect = (item) => {
    onChange?.(item);
    setQuery('');
    setOpen(false);
  };

  const handleClear = (e) => {
    e.stopPropagation();
    onChange?.(null);
    setQuery('');
    setOpen(false);
  };

  const handleKey = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setHighlight((h) => Math.min(h + 1, Math.max(items.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      if (open) {
        e.preventDefault();           // don't submit the surrounding <form>
        if (items[highlight]) handleSelect(items[highlight]);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  const handleScroll = (e) => {
    const el = e.currentTarget;
    if (loading || loadingMore) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    if (atBottom && items.length < total) {
      fetchPage({ pageNum: page + 1, searchTerm: query, append: true });
    }
  };

  const inputValue = open ? query : displayText;

  return (
    <div
      ref={wrapRef}
      className={`sls-wrap${open ? ' is-open' : ''}${disabled ? ' is-disabled' : ''}`}
    >
      <style>{slsCss}</style>

      <div
        className="sls-control"
        onClick={() => { if (!disabled) setOpen(true); }}
      >
        <span className="sls-icon sls-icon--search" aria-hidden="true">
          <FiSearch />
        </span>

        <input
          type="text"
          className="sls-input"
          value={inputValue}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setHighlight(0);
          }}
          onFocus={() => { if (!disabled) setOpen(true); }}
          onKeyDown={handleKey}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete="off"
          spellCheck={false}
          aria-autocomplete="list"
          aria-expanded={open}
          role="combobox"
        />

        {value && !disabled && (
          <button
            type="button"
            className="sls-clear"
            onClick={handleClear}
            aria-label="Clear selection"
            tabIndex={-1}
          >
            <FiX />
          </button>
        )}

        <span className="sls-icon sls-icon--caret" aria-hidden="true">
          <FiChevronDown />
        </span>
      </div>

      {open && !disabled && (
        <div className="sls-panel" role="listbox">
          <div ref={listRef} className="sls-list" onScroll={handleScroll}>
            {loading && items.length === 0 ? (
              <div className="sls-msg">
                <FiLoader className="sls-spin" />
                <span>Loading locators…</span>
              </div>
            ) : error ? (
              <div className="sls-msg sls-msg--error">
                <FiAlertCircle />
                <span>{error}</span>
              </div>
            ) : items.length === 0 ? (
              <div className="sls-msg">
                {query.trim()
                  ? <>No locators match &ldquo;{query.trim()}&rdquo;</>
                  : 'No locators in this warehouse.'}
              </div>
            ) : (
              <>
                {items.map((it, idx) => (
                  <div
                    key={it.locator_code}
                    role="option"
                    aria-selected={it.locator_code === value}
                    className={
                      'sls-option' +
                      (idx === highlight ? ' is-highlighted' : '') +
                      (it.locator_code === value ? ' is-selected' : '')
                    }
                    onMouseDown={(e) => { e.preventDefault(); handleSelect(it); }}
                    onMouseEnter={() => setHighlight(idx)}
                  >
                    <span className="sls-option-code">{it.locator_code}</span>
                    {it.locator_name && (
                      <span className="sls-option-name">{it.locator_name}</span>
                    )}
                  </div>
                ))}

                {loadingMore && (
                  <div className="sls-msg sls-msg--small">
                    <FiLoader className="sls-spin" />
                    <span>Loading more…</span>
                  </div>
                )}

                {!loadingMore && items.length >= total && total > PAGE_SIZE && (
                  <div className="sls-msg sls-msg--small sls-msg--muted">
                    End of list
                  </div>
                )}
              </>
            )}
          </div>

          {total > 0 && (
            <div className="sls-footer">
              <span>
                Showing <strong>{items.length}</strong> of <strong>{total}</strong>{' '}
                locator{total === 1 ? '' : 's'}
              </span>
              {total > PAGE_SIZE && (
                <span className="sls-footer-hint">type to narrow</span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default SearchableLocatorSelect;

// ============================================================
// Component-scoped CSS — prefixes: sls-
// ============================================================
const slsCss = `
.sls-wrap {
  position: relative;
  width: 100%;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}

.sls-control {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 10px 12px;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  background: #ffffff;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
  box-sizing: border-box;
  cursor: text;
}
.sls-wrap.is-open .sls-control {
  border-color: #00b8b0;
  box-shadow: 0 0 0 3px rgba(0, 184, 176, 0.15);
}
.sls-wrap.is-disabled .sls-control {
  background: #f8fafc;
  cursor: not-allowed;
}

.sls-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #94a3b8;
  flex-shrink: 0;
  pointer-events: none;
}
.sls-icon svg { width: 16px; height: 16px; stroke-width: 2.2; }
.sls-icon--caret {
  color: #64748b;
  transition: transform 0.18s ease, color 0.18s ease;
}
.sls-wrap.is-open .sls-icon--caret {
  transform: rotate(180deg);
  color: #00b8b0;
}

.sls-input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  font-size: 14px;
  font-family: inherit;
  color: #0f172a;
  padding: 0;
  line-height: 1.3;
}
.sls-input::placeholder { color: #94a3b8; }
.sls-wrap.is-disabled .sls-input { color: #94a3b8; cursor: not-allowed; }

.sls-clear {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  border-radius: 999px;
  background: #f1f5f9;
  color: #64748b;
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.15s ease, color 0.15s ease;
}
.sls-clear:hover { background: #e2e8f0; color: #0f172a; }
.sls-clear svg { width: 12px; height: 12px; stroke-width: 2.6; }

.sls-panel {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  right: 0;
  z-index: 40;
  background: #ffffff;
  border: 1px solid #cbd5e1;
  border-radius: 10px;
  box-shadow:
    0 12px 28px rgba(15, 23, 42, 0.14),
    0 4px 10px rgba(15, 23, 42, 0.06);
  overflow: hidden;
  animation: slsPanelIn 0.14s ease;
}
@keyframes slsPanelIn {
  from { opacity: 0; transform: translateY(-4px); }
  to   { opacity: 1; transform: translateY(0); }
}

.sls-list {
  max-height: 280px;
  overflow-y: auto;
  padding: 4px;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
}
.sls-list::-webkit-scrollbar { width: 8px; }
.sls-list::-webkit-scrollbar-track { background: #f1f5f9; }
.sls-list::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 4px; }
.sls-list::-webkit-scrollbar-thumb:hover { background: #94a3b8; }

.sls-option {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  line-height: 1.3;
  transition: background 0.1s ease;
}
.sls-option.is-highlighted { background: #f0fdfa; }
.sls-option.is-selected { background: #ccfbf1; }
.sls-option.is-selected.is-highlighted { background: #99f6e4; }

.sls-option-code {
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, Menlo, monospace;
  font-weight: 700;
  font-size: 12.5px;
  color: #4338ca;
  flex-shrink: 0;
  letter-spacing: 0.01em;
}
.sls-option-name {
  color: #475569;
  font-size: 12.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.sls-msg {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 16px 12px;
  font-size: 13px;
  color: #64748b;
  text-align: center;
}
.sls-msg--small { padding: 10px 12px; font-size: 12px; }
.sls-msg--muted { color: #94a3b8; font-style: italic; }
.sls-msg--error { color: #b91c1c; }
.sls-msg--error svg { color: #dc2626; }

.sls-spin { animation: slsSpin 0.8s linear infinite; }
@keyframes slsSpin { to { transform: rotate(360deg); } }

.sls-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 7px 12px;
  background: #f8fafc;
  border-top: 1px solid #e2e8f0;
  font-size: 11.5px;
  color: #64748b;
}
.sls-footer strong { color: #0f172a; font-weight: 700; }
.sls-footer-hint { color: #94a3b8; font-style: italic; }

@media (max-width: 640px) {
  .sls-input { font-size: 16px; }
  .sls-list { max-height: 45vh; }
  .sls-option { padding: 10px 12px; }
  .sls-option-code { font-size: 13px; }
  .sls-option-name { font-size: 13px; }
}

@media (prefers-reduced-motion: reduce) {
  .sls-panel { animation: none !important; }
  .sls-spin { animation: none !important; }
  .sls-icon--caret { transition: none !important; }
}
`;