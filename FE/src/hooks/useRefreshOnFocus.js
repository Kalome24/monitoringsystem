// src/hooks/useRefreshOnFocus.js
//
// Silently re-run a fetch callback when:
//   • The browser tab becomes visible again (visibilitychange)
//   • The window regains focus (alt-tab back)
//   • A registered custom app event fires (e.g. a sibling tab
//     mutates data and dispatches a "data changed" signal)
//
// Focus/visibility are deduped with a short window (default 1.5s)
// so the paired visibilitychange + focus events that fire together
// don't cause two refetches.
//
// Custom events are NOT deduped — they're explicit "data changed"
// signals and always run immediately. Their `event.detail` is
// forwarded to the callback so callers can react to context.
//
// Also exports:
//   emitAppEvent(name, detail)  — small helper for producers
//   UG_DATA_CHANGED             — canonical event name (underground)
//   INV_DATA_CHANGED            — canonical event name (surface inventory)
//
// Usage:
//   // Focus/visibility only:
//   useRefreshOnFocus(load);
//
//   // Also react to sibling events:
//   useRefreshOnFocus(load, { events: [UG_DATA_CHANGED] });
//
//   // Producer:
//   emitAppEvent(UG_DATA_CHANGED, { source: 'issue-form' });

import { useEffect, useMemo, useRef } from 'react';

/* ============================================================
   Canonical event names
   ------------------------------------------------------------
   One place to look for "what events exist in the app". Add a
   new constant here when a new cross-tab refresh signal is
   introduced; never string-literal an event name at a call site.
   ============================================================ */
export const UG_DATA_CHANGED  = 'ug:dataChanged';
export const INV_DATA_CHANGED = 'inv:dataChanged';

/* ============================================================
   Producer helper
   ------------------------------------------------------------
   Safe to call from anywhere. No-ops in non-browser environments
   and swallows errors from browsers without CustomEvent support.
   Always stamps `at: Date.now()` onto the detail so listeners can
   reason about recency if needed.
   ============================================================ */
export const emitAppEvent = (name, detail) => {
  if (typeof window === 'undefined') return;
  if (!name || typeof name !== 'string') return;
  try {
    window.dispatchEvent(
      new CustomEvent(name, {
        detail: { at: Date.now(), ...(detail || {}) },
      })
    );
  } catch {
    /* ignore — no CustomEvent support */
  }
};

/* ============================================================
   Hook
   ============================================================ */
export const useRefreshOnFocus = (
  callback,
  {
    dedupeMs = 1500,
    enabled = true,
    events = [],
  } = {}
) => {
  // Focus/visibility dedupe timestamp — one window across both
  // signals so a paired fire doesn't double-refetch.
  const lastFocusRefreshRef = useRef(0);

  // Keep the latest callback in a ref so we never re-register
  // listeners because the callback identity changed between renders.
  const cbRef = useRef(callback);
  useEffect(() => {
    cbRef.current = callback;
  }, [callback]);

  /* ------------------------------------------------------------
     Normalize the events array into a stable key.
     An inline array literal — `{ events: [UG_DATA_CHANGED] }` —
     produces a new array identity every render. We don't want
     that to churn listener registration, so we compute a sorted,
     deduped string key and use it as the effect dep.
     ------------------------------------------------------------ */
  const eventsKey = useMemo(() => {
    if (!Array.isArray(events) || events.length === 0) return '';
    const cleaned = events.filter((e) => typeof e === 'string' && e);
    if (cleaned.length === 0) return '';
    return Array.from(new Set(cleaned)).sort().join('|');
  }, [events]);

  /* ============================================================
     1) Focus + visibility — deduped, no event detail.
     ============================================================ */
  useEffect(() => {
    if (!enabled) return undefined;

    const maybeRefresh = () => {
      const now = Date.now();
      if (now - lastFocusRefreshRef.current < dedupeMs) return;
      lastFocusRefreshRef.current = now;
      try {
        cbRef.current?.();
      } catch (err) {
        // Silent — a background refresh must never crash the tab.
        console.warn('useRefreshOnFocus callback failed:', err);
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') maybeRefresh();
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('focus', maybeRefresh);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('focus', maybeRefresh);
    };
  }, [dedupeMs, enabled]);

  /* ============================================================
     2) Custom events — not deduped, receive event.detail.
     ============================================================ */
  useEffect(() => {
    if (!enabled || !eventsKey) return undefined;

    const names = eventsKey.split('|');
    const handlers = names.map((name) => {
      const handler = (e) => {
        try {
          cbRef.current?.(e?.detail);
        } catch (err) {
          console.warn(`useRefreshOnFocus[${name}] callback failed:`, err);
        }
      };
      window.addEventListener(name, handler);
      return [name, handler];
    });

    return () => {
      for (const [name, handler] of handlers) {
        window.removeEventListener(name, handler);
      }
    };
  }, [enabled, eventsKey]);
};

export default useRefreshOnFocus;