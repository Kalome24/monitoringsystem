// src/hooks/useSessionState.js
import { useEffect, useRef, useState } from 'react';

// ============================================================
// useSessionState — useState with sessionStorage persistence.
//
// Reads the initial value once on mount from sessionStorage[key].
// Writes back to sessionStorage[key] on every subsequent change.
//
// sessionStorage is:
//   • per-origin, per-browser-tab
//   • cleared when the tab is closed
//   • not shared with other tabs
//
// Safe under SSR (returns initialValue), JSON parse errors
// (falls back to initialValue), and disabled/quota-exceeded
// storage (silent no-op write).
//
// Usage:
//   const [segment, setSegment] =
//     useSessionState('sts:deptHead:segment', 'pending');
// ============================================================
export const useSessionState = (key, initialValue) => {
  const [value, setValue] = useState(() => {
    if (!key || typeof window === 'undefined') return initialValue;
    try {
      const raw = window.sessionStorage.getItem(key);
      if (raw === null) return initialValue;
      return JSON.parse(raw);
    } catch {
      return initialValue;
    }
  });

  // Skip the first write — we just read from storage on mount,
  // and if nothing was stored there's nothing meaningful to write
  // back yet. Once the value changes for the first time, we start
  // persisting.
  const firstWriteRef = useRef(true);
  useEffect(() => {
    if (firstWriteRef.current) {
      firstWriteRef.current = false;
      return;
    }
    if (!key || typeof window === 'undefined') return;
    try {
      window.sessionStorage.setItem(key, JSON.stringify(value));
    } catch { /* quota exceeded or storage disabled — ignore */ }
  }, [key, value]);

  return [value, setValue];
};

export default useSessionState;