// src/components/shared/ActionsMenu.jsx
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FiMoreHorizontal } from 'react-icons/fi';

/* ============================================================
   ActionsMenu — horizontal kebab (⋯) dropdown for row actions.

   Usage:
     <ActionsMenu
       items={[
         { key: 'edit',   label: 'Edit',       icon: <FiEdit2 />, onClick: () => {} },
         { key: 'toggle', label: 'Deactivate', icon: <FiLock />,  onClick: () => {}, variant: 'muted' },
         { key: 'del',    label: 'Delete',     icon: <FiTrash2 />, onClick: () => {},
           variant: 'danger', dividerBefore: true },
       ]}
     />

   Item shape:
     {
       key?:            string,             // React key (falls back to index)
       label:           string | node,      // Required. The action text.
       icon?:           node,               // Optional React icon
       onClick?:        () => void,         // Required to do anything
       variant?:        'default' | 'muted' | 'success' | 'warning' | 'danger',
       disabled?:       boolean,
       hidden?:         boolean,            // Filtered out entirely
       dividerBefore?:  boolean,            // Draws a thin separator above this item
     }

   Props:
     items         array     — see above
     ariaLabel     string    — button + menu label for screen readers
     align         'end' | 'start'  — which side to anchor the menu to
     size          'sm' | 'md' | 'lg'
     disabled      bool      — disables the trigger entirely
     buttonClassName string  — extra class(es) on the trigger button

   Behavior:
     - Trigger click toggles the menu.
     - Outside click / Esc / Tab closes it (focus returns to trigger on Esc).
     - Arrow keys move the highlighted item; Enter activates; Home/End jump.
     - Menu is portal-rendered into document.body so table overflow never clips it.
     - Auto-flips above the trigger when the space below is too small.
     - On small screens the panel widens but stays inside the viewport.
   ============================================================ */

const MENU_GAP = 6;
const VIEWPORT_PAD = 8;

const ActionsMenu = ({
  items = [],
  ariaLabel = 'Row actions',
  align = 'end',
  size = 'md',
  disabled = false,
  buttonClassName = '',
}) => {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, placement: 'bottom' });
  const [highlight, setHighlight] = useState(-1);

  const triggerRef = useRef(null);
  const menuRef = useRef(null);

  const enabledItems = items.filter((i) => i && !i.hidden);
  const actionableItems = enabledItems.filter((i) => !i.disabled);

  /* ---- position the panel ---- */
  useLayoutEffect(() => {
    if (!open) return;

    const computePosition = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;

      const rect = trigger.getBoundingClientRect();
      const menuEl = menuRef.current;
      const menuHeight = menuEl ? menuEl.offsetHeight : 240;
      const menuWidth  = menuEl ? menuEl.offsetWidth  : 220;

      const vw = window.innerWidth;
      const vh = window.innerHeight;

      // Horizontal
      let left =
        align === 'end'
          ? rect.right - menuWidth
          : rect.left;
      left = Math.max(
        VIEWPORT_PAD,
        Math.min(left, vw - menuWidth - VIEWPORT_PAD)
      );

      // Vertical — prefer below, flip above if needed
      const spaceBelow = vh - rect.bottom - MENU_GAP - VIEWPORT_PAD;
      const spaceAbove = rect.top - MENU_GAP - VIEWPORT_PAD;

      let top;
      let placement = 'bottom';

      if (menuHeight <= spaceBelow) {
        top = rect.bottom + MENU_GAP;
        placement = 'bottom';
      } else if (menuHeight <= spaceAbove) {
        top = rect.top - menuHeight - MENU_GAP;
        placement = 'top';
      } else if (spaceBelow >= spaceAbove) {
        top = Math.max(VIEWPORT_PAD, rect.bottom + MENU_GAP);
        placement = 'bottom';
      } else {
        top = Math.max(VIEWPORT_PAD, rect.top - menuHeight - MENU_GAP);
        placement = 'top';
      }

      setPos({ top, left, placement });
    };

    computePosition();
    const raf = requestAnimationFrame(computePosition);

    const onScrollOrResize = () => computePosition();
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [open, align]);

  /* ---- outside click, Esc, keyboard nav ---- */
  useEffect(() => {
    if (!open) return;

    const onDocClick = (e) => {
      const t = triggerRef.current;
      const m = menuRef.current;
      if (t && t.contains(e.target)) return;
      if (m && m.contains(e.target)) return;
      setOpen(false);
    };

    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
        return;
      }
      if (e.key === 'Tab') { setOpen(false); return; }
      if (actionableItems.length === 0) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlight((h) => (h < 0 ? 0 : Math.min(h + 1, actionableItems.length - 1)));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlight((h) => (h <= 0 ? actionableItems.length - 1 : h - 1));
      } else if (e.key === 'Home') {
        e.preventDefault();
        setHighlight(0);
      } else if (e.key === 'End') {
        e.preventDefault();
        setHighlight(actionableItems.length - 1);
      } else if (e.key === 'Enter' || e.key === ' ') {
        const item = actionableItems[highlight];
        if (item) {
          e.preventDefault();
          runItem(item);
        }
      }
    };

    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, actionableItems, highlight]);

  /* ---- reset highlight when closed, focus first when opened ---- */
  useEffect(() => {
    if (!open) {
      setHighlight(-1);
      return;
    }
    const t = setTimeout(() => {
      setHighlight(actionableItems.length > 0 ? 0 : -1);
    }, 20);
    return () => clearTimeout(t);
  }, [open, actionableItems.length]);

  const toggle = (e) => {
    e.stopPropagation();
    e.preventDefault();
    if (disabled) return;
    setOpen((o) => !o);
  };

  const runItem = (item) => {
    if (item.disabled) return;
    setOpen(false);
    // Defer so the menu unmounts before the action (which may open a modal) runs.
    setTimeout(() => item.onClick?.(), 0);
  };

  if (enabledItems.length === 0) return null;

  const sizeClass =
    size === 'sm' ? 'am-trigger--sm'
    : size === 'lg' ? 'am-trigger--lg'
    : '';

  const menu =
    open && typeof document !== 'undefined'
      ? createPortal(
          <div
            ref={menuRef}
            className={`am-menu am-menu--${pos.placement}`}
            style={{ top: pos.top, left: pos.left }}
            role="menu"
            aria-label={ariaLabel}
          >
            <ul className="am-menu-list">
              {enabledItems.map((item, idx) => {
                const actionableIdx = actionableItems.indexOf(item);
                const isHighlighted = actionableIdx >= 0 && actionableIdx === highlight;
                return (
                  <li
                    key={item.key || idx}
                    role="none"
                    className={`am-menu-item-wrap${
                      item.dividerBefore ? ' am-menu-item-wrap--divider' : ''
                    }`}
                  >
                    <button
                      type="button"
                      role="menuitem"
                      tabIndex={-1}
                      className={`am-menu-item am-menu-item--${item.variant || 'default'}${
                        item.disabled ? ' is-disabled' : ''
                      }${isHighlighted ? ' is-highlighted' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        runItem(item);
                      }}
                      onMouseEnter={() => {
                        if (actionableIdx >= 0) setHighlight(actionableIdx);
                      }}
                      disabled={item.disabled}
                    >
                      {item.icon && (
                        <span className="am-menu-item-icon" aria-hidden="true">
                          {item.icon}
                        </span>
                      )}
                      <span className="am-menu-item-label">{item.label}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>,
          document.body
        )
      : null;

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        className={`am-trigger ${sizeClass} ${open ? 'is-open' : ''} ${buttonClassName}`.trim()}
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
        disabled={disabled}
      >
        <FiMoreHorizontal aria-hidden="true" />
      </button>
      {menu}
    </>
  );
};

export default ActionsMenu;

/* ============================================================
   Styles — injected once at module load
   ============================================================ */
const ACTIONS_MENU_CSS = `
/* ============================================================
   TRIGGER — the ⋯ button
   ------------------------------------------------------------
   Sized and colored to be unmistakably clickable:
     • 40×40 default (finger-friendly; grows to 46 at 4K)
     • Solid light-slate background so it reads as a button,
       not a floating icon
     • 1.5px border in a mid-tone grey (visible at a glance)
     • Dark icon color by default
     • Hover / open state: brand teal — border, bg, icon all shift
   ============================================================ */
.am-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  padding: 0;
  border: 1.5px solid #94a3b8;
  border-radius: 10px;
  background: #f8fafc;
  color: #334155;
  cursor: pointer;
  font-family: inherit;
  flex-shrink: 0;
  line-height: 1;
  transition:
    background 0.15s ease,
    border-color 0.15s ease,
    color 0.15s ease,
    box-shadow 0.15s ease,
    transform 0.12s ease;
}
.am-trigger svg {
  width: 22px;
  height: 22px;
  stroke-width: 2.6;
  display: block;
}
.am-trigger:hover:not(:disabled) {
  border-color: #00b8b0;
  color: #0f766e;
  background: #f0fdfa;
  transform: translateY(-1px);
  box-shadow: 0 2px 6px rgba(0, 184, 176, 0.2);
}
.am-trigger.is-open {
  border-color: #00b8b0;
  color: #0f766e;
  background: #ccfbf1;
  box-shadow:
    0 0 0 3px rgba(0, 184, 176, 0.22),
    0 2px 6px rgba(0, 184, 176, 0.24);
}
.am-trigger:active:not(:disabled) {
  transform: translateY(0);
}
.am-trigger:focus-visible {
  outline: 2px solid #00b8b0;
  outline-offset: 2px;
}
.am-trigger:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.am-trigger--sm {
  width: 34px;
  height: 34px;
  border-radius: 8px;
}
.am-trigger--sm svg { width: 18px; height: 18px; }

.am-trigger--lg {
  width: 46px;
  height: 46px;
  border-radius: 12px;
}
.am-trigger--lg svg { width: 26px; height: 26px; }

/* ============================================================
   PANEL — the dropdown
   ============================================================ */
.am-menu {
  position: fixed;
  z-index: 20000;
  min-width: 200px;
  max-width: min(280px, calc(100vw - 16px));
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  box-shadow:
    0 16px 40px rgba(15, 23, 42, 0.16),
    0 4px 12px rgba(15, 23, 42, 0.08),
    0 0 0 1px rgba(15, 23, 42, 0.02);
  padding: 6px;
  animation: am-menu-in 0.14s cubic-bezier(0.2, 0.9, 0.3, 1);
}

@keyframes am-menu-in {
  from { opacity: 0; transform: translateY(-4px) scale(0.97); }
  to   { opacity: 1; transform: translateY(0)   scale(1);    }
}

.am-menu-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}

.am-menu-item-wrap--divider {
  margin-top: 4px;
  padding-top: 5px;
  border-top: 1px solid #e2e8f0;
}

.am-menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 9px 12px;
  background: transparent;
  border: none;
  border-radius: 8px;
  font-family: inherit;
  font-size: 14px;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
  color: #1e293b;
  min-height: 38px;
  transition: background 0.12s ease, color 0.12s ease;
}
.am-menu-item:focus-visible {
  outline: 2px solid #00b8b0;
  outline-offset: -2px;
}
.am-menu-item:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.am-menu-item-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}
.am-menu-item-icon svg {
  width: 100%;
  height: 100%;
  stroke-width: 2.4;
}
.am-menu-item-label {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ---- Variants ---- */
.am-menu-item--default { color: #1e293b; }
.am-menu-item--default:hover:not(:disabled),
.am-menu-item--default.is-highlighted:not(:disabled) {
  background: #f1f5f9;
  color: #0f172a;
}

.am-menu-item--muted { color: #475569; }
.am-menu-item--muted:hover:not(:disabled),
.am-menu-item--muted.is-highlighted:not(:disabled) {
  background: #f1f5f9;
  color: #1e293b;
}

.am-menu-item--success { color: #047857; }
.am-menu-item--success:hover:not(:disabled),
.am-menu-item--success.is-highlighted:not(:disabled) {
  background: #f0fdf4;
  color: #065f46;
}

.am-menu-item--warning { color: #b45309; }
.am-menu-item--warning:hover:not(:disabled),
.am-menu-item--warning.is-highlighted:not(:disabled) {
  background: #fffbeb;
  color: #92400e;
}

.am-menu-item--danger { color: #dc2626; }
.am-menu-item--danger:hover:not(:disabled),
.am-menu-item--danger.is-highlighted:not(:disabled) {
  background: #fef2f2;
  color: #b91c1c;
}

/* ============================================================
   Responsive
   ============================================================ */
@media (max-width: 480px) {
  /* Touch-first sizing: bigger tap target on phones */
  .am-trigger {
    width: 42px;
    height: 42px;
  }
  .am-trigger svg { width: 22px; height: 22px; }

  .am-menu {
    min-width: 200px;
    max-width: calc(100vw - 20px);
  }
  .am-menu-item {
    font-size: 14.5px;
    padding: 11px 12px;
    min-height: 44px;
  }
}

@media (max-width: 360px) {
  .am-trigger {
    width: 38px;
    height: 38px;
  }
  .am-trigger svg { width: 20px; height: 20px; }

  .am-menu {
    min-width: 180px;
  }
}

/* Ultra-wide / 4K: everything scales up */
@media (min-width: 1921px) {
  .am-trigger {
    width: 46px;
    height: 46px;
    border-radius: 12px;
  }
  .am-trigger svg { width: 26px; height: 26px; }

  .am-menu {
    min-width: 240px;
    max-width: 320px;
    border-radius: 14px;
    padding: 8px;
  }
  .am-menu-item {
    font-size: 15px;
    padding: 11px 14px;
    min-height: 46px;
    gap: 12px;
  }
  .am-menu-item-icon { width: 18px; height: 18px; }
}

/* ============================================================
   Accessibility
   ============================================================ */
@media (prefers-reduced-motion: reduce) {
  .am-menu,
  .am-trigger,
  .am-menu-item { animation: none !important; transition: none !important; }
  .am-trigger:hover:not(:disabled) { transform: none; }
}

@media (prefers-contrast: high) {
  .am-trigger {
    border-color: #0f172a;
    border-width: 2px;
    background: #ffffff;
    color: #0f172a;
  }
  .am-trigger:hover:not(:disabled),
  .am-trigger.is-open {
    background: #00d2c8;
    color: #000000;
  }
  .am-menu {
    border: 2px solid #0f172a;
  }
  .am-menu-item:focus-visible {
    outline-width: 3px;
  }
}
`;

/* ============================================================
   Inject the stylesheet once, at module load.

   IMPORTANT: this MUST come after `ACTIONS_MENU_CSS` is declared.
   `const` declarations are not hoisted the way `var` is — if this
   call were placed above the const, we'd hit a Temporal Dead Zone
   error ("Cannot access 'ACTIONS_MENU_CSS' before initialization").
   ============================================================ */
const injectAmStyles = () => {
  if (typeof document === 'undefined') return;
  if (document.getElementById('actions-menu-styles')) return;
  const el = document.createElement('style');
  el.id = 'actions-menu-styles';
  el.textContent = ACTIONS_MENU_CSS;
  document.head.appendChild(el);
};

injectAmStyles();