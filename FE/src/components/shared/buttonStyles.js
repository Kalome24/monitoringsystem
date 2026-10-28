// src/components/shared/buttonStyles.js
//
// Shared button CSS for all Configuration sections (Item Masters,
// Master Data, Warehouse, Users, Locked Items).
//
// Usage in a tab:
//   import { buttonCss } from '../shared/buttonStyles';
//   ...
//   <div className="items-section">
//     <style>{buttonCss}</style>
//     <button className="ui-btn ui-btn-primary">…</button>
//   </div>
//
export const buttonCss = `
/* ============================================================
   UI BUTTON SYSTEM
   Solid, saturated, unmistakably clickable.
   ============================================================ */

@keyframes uiFadeIn { from { opacity: 0 } to { opacity: 1 } }

/* ---------- Base ---------- */
.ui-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 11px 20px;
  font-family: inherit;
  font-size: 14.5px;
  font-weight: 700;
  letter-spacing: 0.01em;
  border-radius: 10px;
  border: 1px solid transparent;
  border-bottom-width: 2px;
  cursor: pointer;
  user-select: none;
  position: relative;
  isolation: isolate;
  line-height: 1.2;
  white-space: nowrap;
  transition:
    transform 180ms cubic-bezier(0.34, 1.4, 0.64, 1),
    box-shadow 200ms ease,
    background 160ms ease,
    border-color 160ms ease,
    color 160ms ease;
}

.ui-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none !important;
  box-shadow: none !important;
  filter: saturate(0.6);
}

.ui-btn:focus-visible {
  outline: none;
  box-shadow: 0 0 0 4px rgba(0, 184, 176, 0.24);
}

/* ---------- Size: small (row actions, pagination) ---------- */
.ui-btn-sm {
  padding: 8px 14px;
  font-size: 13px;
  border-radius: 8px;
  gap: 6px;
}

/* ---------- Size: extra-small (inline "Add" buttons) ---------- */
.ui-btn-xs {
  padding: 4px 10px;
  font-size: 11px;
  border-radius: 6px;
  border-bottom-width: 1px;
  gap: 4px;
}

/* ============================================================
   PRIMARY — solid brand teal
   ============================================================ */
.ui-btn-primary {
  background: #00b8b0;
  color: #ffffff;
  border-color: #007a72;
  text-shadow: 0 1px 1px rgba(0,0,0,0.18);
  box-shadow:
    0 1px 0 rgba(255,255,255,0.32) inset,
    0 2px 4px rgba(0, 122, 114, 0.28),
    0 6px 16px rgba(0, 184, 176, 0.28);
}
.ui-btn-primary:hover:not(:disabled) {
  transform: translateY(-2px);
  background: #00d4cb;
  border-color: #008a82;
  box-shadow:
    0 1px 0 rgba(255,255,255,0.4) inset,
    0 4px 10px rgba(0, 122, 114, 0.36),
    0 14px 32px rgba(0, 184, 176, 0.48),
    0 0 0 4px rgba(0, 184, 176, 0.24);
}
.ui-btn-primary:active:not(:disabled) {
  transform: translateY(0);
  background: #00a29b;
  box-shadow:
    0 2px 6px rgba(0, 122, 114, 0.4) inset,
    0 1px 2px rgba(0, 122, 114, 0.3);
}

/* ============================================================
   SECONDARY — clean white with thick border
   ============================================================ */
.ui-btn-secondary {
  background: #ffffff;
  color: #1e293b;
  border-color: #94a3b8;
  box-shadow:
    0 1px 0 rgba(255,255,255,0.9) inset,
    0 1px 3px rgba(15, 23, 42, 0.1);
}
.ui-btn-secondary:hover:not(:disabled) {
  transform: translateY(-2px);
  background: #f0fdfa;
  border-color: #00b8b0;
  color: #007a72;
  box-shadow:
    0 1px 0 rgba(255,255,255,1) inset,
    0 4px 10px rgba(0, 184, 176, 0.22),
    0 14px 32px rgba(0, 184, 176, 0.24),
    0 0 0 4px rgba(0, 184, 176, 0.16);
}
.ui-btn-secondary:active:not(:disabled) {
  transform: translateY(0);
  background: #e6fffb;
}

/* ============================================================
   EDIT — calm blue
   ============================================================ */
.ui-btn-edit {
  background: #3b82f6;
  color: #ffffff;
  border-color: #1d4ed8;
  text-shadow: 0 1px 1px rgba(0,0,0,0.18);
  box-shadow:
    0 1px 0 rgba(255,255,255,0.28) inset,
    0 2px 4px rgba(29, 78, 216, 0.28),
    0 6px 16px rgba(59, 130, 246, 0.28);
}
.ui-btn-edit:hover:not(:disabled) {
  transform: translateY(-2px);
  background: #60a5fa;
  border-color: #1d4ed8;
  box-shadow:
    0 1px 0 rgba(255,255,255,0.36) inset,
    0 4px 10px rgba(29, 78, 216, 0.36),
    0 14px 32px rgba(59, 130, 246, 0.48),
    0 0 0 4px rgba(59, 130, 246, 0.24);
}

/* ============================================================
   SUCCESS — solid green (Activate)
   ============================================================ */
.ui-btn-success {
  background: #10b981;
  color: #ffffff;
  border-color: #047857;
  text-shadow: 0 1px 1px rgba(0,0,0,0.18);
  box-shadow:
    0 1px 0 rgba(255,255,255,0.28) inset,
    0 2px 4px rgba(4, 120, 87, 0.28),
    0 6px 16px rgba(16, 185, 129, 0.28);
}
.ui-btn-success:hover:not(:disabled) {
  transform: translateY(-2px);
  background: #34d399;
  border-color: #047857;
  box-shadow:
    0 1px 0 rgba(255,255,255,0.36) inset,
    0 4px 10px rgba(4, 120, 87, 0.36),
    0 14px 32px rgba(16, 185, 129, 0.48),
    0 0 0 4px rgba(16, 185, 129, 0.24);
}

/* ============================================================
   DANGER — solid red (Deactivate)
   ============================================================ */
.ui-btn-danger {
  background: #dc2626;
  color: #ffffff;
  border-color: #991b1b;
  text-shadow: 0 1px 1px rgba(0,0,0,0.18);
  box-shadow:
    0 1px 0 rgba(255,255,255,0.24) inset,
    0 2px 4px rgba(153, 27, 27, 0.28),
    0 6px 16px rgba(220, 38, 38, 0.24);
}
.ui-btn-danger:hover:not(:disabled) {
  transform: translateY(-2px);
  background: #ef4444;
  border-color: #991b1b;
  box-shadow:
    0 1px 0 rgba(255,255,255,0.32) inset,
    0 4px 10px rgba(153, 27, 27, 0.36),
    0 14px 32px rgba(220, 38, 38, 0.42),
    0 0 0 4px rgba(220, 38, 38, 0.22);
}

/* ============================================================
   DELETE — deep red (permanent)
   ============================================================ */
.ui-btn-delete {
  background: #7f1d1d;
  color: #ffffff;
  border-color: #450a0a;
  text-shadow: 0 1px 1px rgba(0,0,0,0.24);
  box-shadow:
    0 1px 0 rgba(255,255,255,0.18) inset,
    0 2px 4px rgba(69, 10, 10, 0.32),
    0 6px 16px rgba(127, 29, 29, 0.28);
}
.ui-btn-delete:hover:not(:disabled) {
  transform: translateY(-2px);
  background: #991b1b;
  border-color: #450a0a;
  box-shadow:
    0 1px 0 rgba(255,255,255,0.24) inset,
    0 4px 10px rgba(69, 10, 10, 0.4),
    0 14px 32px rgba(127, 29, 29, 0.48),
    0 0 0 4px rgba(153, 27, 27, 0.22);
}

/* ============================================================
   MUTED — solid slate
   ============================================================ */
.ui-btn-muted {
  background: #475569;
  color: #ffffff;
  border-color: #1e293b;
  text-shadow: 0 1px 1px rgba(0,0,0,0.18);
  box-shadow:
    0 1px 0 rgba(255,255,255,0.18) inset,
    0 2px 4px rgba(15, 23, 42, 0.24),
    0 6px 16px rgba(71, 85, 105, 0.24);
}
.ui-btn-muted:hover:not(:disabled) {
  transform: translateY(-2px);
  background: #64748b;
  border-color: #1e293b;
  box-shadow:
    0 1px 0 rgba(255,255,255,0.26) inset,
    0 4px 10px rgba(15, 23, 42, 0.32),
    0 14px 32px rgba(71, 85, 105, 0.4),
    0 0 0 4px rgba(100, 116, 139, 0.22);
}

/* ============================================================
   "+" BADGE — rotated on primary hover
   ============================================================ */
.ui-plus {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 7px;
  background: rgba(0, 0, 0, 0.14);
  font-size: 16px;
  font-weight: 800;
  line-height: 1;
  transition:
    transform 320ms cubic-bezier(0.34, 1.5, 0.64, 1),
    background 220ms ease;
}
.ui-btn-primary:hover:not(:disabled) .ui-plus {
  transform: rotate(180deg) scale(1.15);
  background: rgba(0, 0, 0, 0.22);
}

/* ============================================================
   Accessible reduced-motion
   ============================================================ */
@media (prefers-reduced-motion: reduce) {
  .ui-btn,
  .ui-plus {
    transition: none !important;
    animation: none !important;
  }
  .ui-btn:hover:not(:disabled) { transform: none !important; }
  .ui-btn-primary:hover:not(:disabled) .ui-plus { transform: none !important; }
}
`;

export default buttonCss;