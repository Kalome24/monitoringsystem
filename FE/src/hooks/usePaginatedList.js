// src/hooks/usePaginatedList.js
import { useCallback, useEffect, useRef, useState } from 'react';

// ============================================================
// usePaginatedList
//
// Encapsulates the state + effects that both Stock Transfer tabs
// (and any future list view) need:
//
//   • rows / loading / total / totalPages / page
//   • search text + a 300ms-debounced mirror
//   • arbitrary filters object (status / date range / …)
//   • request-ordering guard via an internal requestId ref
//   • server-side page clamp mirror (res.page wins)
//   • atomic page reset when search or filters change
//   • optional sessionStorage persistence of { search, filters }
//   • fetchAll(limit) — the full filtered set, for CSV export
//
// Usage:
//
//   const loader = useCallback(async ({ page, limit, search, ...filters }) => {
//     return someApi.list({
//       page,
//       limit,
//       search: search || undefined,
//       ...filters,
//     });
//   }, []);
//
//   const list = usePaginatedList({
//     loader,
//     initialFilters: { status: 'All', startDate: '', endDate: '' },
//     pageSize: 50,
//     debounceMs: 300,
//     storageKey: 'sts:deptHead:history',   // optional
//   });
//
//   list.rows          // array from res.data
//   list.loading       // boolean
//   list.total         // number from res.total
//   list.page          // current page (mirrored from res.page)
//   list.totalPages    // number from res.totalPages
//   list.search        // controlled input value
//   list.setSearch     // setter — debounced internally
//   list.filters       // { status, startDate, … }
//   list.setFilter     // (key, value) — resets page to 1
//   list.reload        // re-fetch the current page
//   list.nextPage / list.prevPage / list.goToPage(n)
//   list.clearAll      // resets search + filters + page to 1
//   list.showingStart / list.showingEnd   // for "Showing X–Y of Z"
//   list.fetchAll      // async (limit = 500) → rows[]   (for export)
//
// Persistence contract:
//   • When storageKey is provided, only { search, filters } is
//     persisted to sessionStorage. `page` is NOT persisted — every
//     mount starts on page 1. This avoids "restored to page 4 of a
//     dataset that shifted overnight".
//   • Restored filters are merged over initialFilters, so any field
//     the caller added to initialFilters after the storage was
//     written gets a fresh default rather than coming back undefined.
//   • Every failure mode (storage disabled, quota, corrupt JSON) is
//     silent — persistence is a nicety, never a blocker.
//
// Contract:
//   • `loader` MUST be stable across renders (wrap in useCallback
//     with an empty or trivially-stable dep array). If it isn't,
//     the internal reload effect will fire every render.
//   • `initialFilters` should be a module-level constant (or any
//     object whose identity you don't change) — the hook captures
//     it once for clearAll().
// ============================================================
export const usePaginatedList = ({
  loader,
  initialFilters = {},
  pageSize = 50,
  debounceMs = 300,
  storageKey = null,
}) => {
  // ---- Read persisted { search, filters } once, synchronously ----
  // Done via a ref so the read happens exactly once per hook
  // instance and cannot re-run on re-renders.
  const persistedRef = useRef(null);
  if (persistedRef.current === null) {
    let stored = null;
    if (storageKey && typeof window !== 'undefined') {
      try {
        const raw = window.sessionStorage.getItem(storageKey);
        if (raw) stored = JSON.parse(raw);
      } catch { /* corrupt JSON — ignore, use defaults */ }
    }
    persistedRef.current = stored && typeof stored === 'object' ? stored : {};
  }

  const storedSearch = typeof persistedRef.current.search === 'string'
    ? persistedRef.current.search
    : '';

  const storedFilters =
    persistedRef.current.filters && typeof persistedRef.current.filters === 'object'
      ? persistedRef.current.filters
      : {};

  // ---- Result state ----
  const [rows, setRows]             = useState([]);
  const [loading, setLoading]       = useState(false);
  const [total, setTotal]           = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage]             = useState(1);

  // ---- Search state (input text + debounced mirror) ----
  // Both are seeded from storage so the very first reload fires
  // with the restored search text — no wasted empty-search pass.
  const [search, setSearch]                   = useState(storedSearch);
  const [debouncedSearch, setDebouncedSearch] = useState(storedSearch);

  // ---- Arbitrary filter bag (status / date range / …) ----
  // Restored filters are merged OVER initialFilters, so any new
  // field the caller adds later gets its default value rather
  // than resurrecting as undefined from old storage.
  const [filters, setFiltersState] = useState(() => ({
    ...initialFilters,
    ...storedFilters,
  }));

  // Captured once, so clearAll is stable even if the caller passes
  // an inline object literal for initialFilters.
  const initialFiltersRef = useRef(initialFilters);

  // Request-ordering guard (Step 2 pattern, per hook instance).
  const reqIdRef = useRef(0);

  // ---- Debounce search text and reset page in the SAME update ----
  // Doing both together means the loader effect fires exactly once
  // per debounced change, not twice (once for debouncedSearch, once
  // for the page reset).
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, debounceMs);
    return () => clearTimeout(t);
  }, [search, debounceMs]);

  // ---- Persist { search, filters } to sessionStorage on change ----
  // `page` is deliberately NOT persisted — see header comment.
  // Runs on every search keystroke and every filter change so a
  // mid-debounce navigation still keeps the raw typed text.
  useEffect(() => {
    if (!storageKey || typeof window === 'undefined') return;
    try {
      window.sessionStorage.setItem(
        storageKey,
        JSON.stringify({ search, filters })
      );
    } catch { /* quota exceeded / storage disabled — ignore */ }
  }, [storageKey, search, filters]);

  // ---- Loader (order-safe) ----
  const reload = useCallback(async () => {
    const reqId = ++reqIdRef.current;
    const isStale = () => reqId !== reqIdRef.current;

    setLoading(true);
    try {
      const res = await loader({
        page,
        limit: pageSize,
        search: debouncedSearch,
        ...filters,
      });
      if (isStale()) return;

      if (res && res.ok) {
        setRows(res.data || []);
        setTotal(Number(res.total) || 0);
        setTotalPages(Math.max(Number(res.totalPages) || 1, 1));

        // Server clamps the requested page against totalPages —
        // mirror whatever it returned so the footer stays truthful.
        const clamped = Number(res.page) || 1;
        if (clamped !== page) setPage(clamped);
      } else {
        setRows([]);
        setTotal(0);
        setTotalPages(1);
      }
    } catch (err) {
      if (isStale()) return;
      console.error('usePaginatedList loader error:', err);
      setRows([]);
      setTotal(0);
      setTotalPages(1);
    } finally {
      if (!isStale()) setLoading(false);
    }
  }, [loader, page, pageSize, debouncedSearch, filters]);

  // Fire on mount and whenever reload's identity changes.
  // reload's identity changes when page / debouncedSearch / filters
  // change — i.e. exactly when we want to re-fetch.
  useEffect(() => {
    reload();
  }, [reload]);

  // ---- Setters that reset to page 1 atomically ----
  const setFilter = useCallback((key, value) => {
    setFiltersState((prev) => ({ ...prev, [key]: value }));
    setPage(1);
  }, []);

  const setFilters = useCallback((partial) => {
    setFiltersState((prev) => ({ ...prev, ...partial }));
    setPage(1);
  }, []);

  // ---- Pagination helpers ----
  const goToPage = useCallback((n) => {
    setPage((prev) => {
      const next = typeof n === 'function' ? n(prev) : n;
      return Math.max(1, Math.min(totalPages, next));
    });
  }, [totalPages]);

  const nextPage = useCallback(() => {
    setPage((p) => Math.min(totalPages, p + 1));
  }, [totalPages]);

  const prevPage = useCallback(() => {
    setPage((p) => Math.max(1, p - 1));
  }, []);

  // ---- Clear everything back to the initial state ----
  // Persistence effect will re-write storage with the cleared
  // values on the next render — no explicit storage clear needed.
  const clearAll = useCallback(() => {
    setSearch('');
    setDebouncedSearch('');
    setFiltersState(initialFiltersRef.current);
    setPage(1);
  }, []);

  // ---- Full-set fetch for CSV export ----
  // Uses the current debounced search + filters, always page 1.
  // Does NOT touch any state — safe to call while the list is
  // rendered. Caller is responsible for handling a short return
  // (e.g. when total > limit).
  const fetchAll = useCallback(async (limit = 500) => {
    try {
      const res = await loader({
        page: 1,
        limit,
        search: debouncedSearch,
        ...filters,
      });
      if (res && res.ok) return res.data || [];
      return [];
    } catch (err) {
      console.error('usePaginatedList fetchAll error:', err);
      return [];
    }
  }, [loader, debouncedSearch, filters]);

  // ---- Derived pagination bounds ----
  const showingStart = total === 0 ? 0 : ((page - 1) * pageSize) + 1;
  const showingEnd   = Math.min(page * pageSize, total);

  return {
    rows, loading, total, totalPages, page,
    search, setSearch,
    filters, setFilter, setFilters,
    reload,
    goToPage, nextPage, prevPage,
    clearAll,
    showingStart, showingEnd,
    fetchAll,
  };
};

export default usePaginatedList;