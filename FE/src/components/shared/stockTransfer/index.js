// src/components/shared/stockTransfer/index.js

// ============================================================
// Barrel export for the shared Stock Transfer primitives.
//
// After Steps 1g/1h the two tabs import everything they need
// from a single path:
//
//   import {
//     formatDate,
//     formatDateTime,
//     whPrimary,
//     whSecondary,
//     StatusBadge,
//     HybridSelect,
//     SkeletonTable,
//     SkeletonCards,
//     exportSTSCsv,
//     buildStockTransferModalCss,
//     buildStockTransferTabCss,
//     MODAL_THEME_INDIGO,
//     TAB_THEME_APPROVAL,
//   } from '../shared/stockTransfer';
//
// Everything a tab needs is re-exported here — no deep paths.
// ============================================================

// ---- Formatters (pure JS) ----
export {
  formatDate,
  formatDateTime,
  whPrimary,
  whSecondary,
} from './formatters';

// ---- Status badge ----
export {
  stsStatusBadgeStyle,
  StatusBadge,
} from './statusBadge';

// ---- HybridSelect ----
export { default as HybridSelect } from './HybridSelect';

// ---- Skeleton placeholders (Tier 2 Step 2) ----
export {
  SkeletonTable,
  SkeletonCards,
} from './SkeletonRows';

// ---- CSV export helpers (Tier 3 Step 5c) ----
export {
  buildCsv,
  downloadCsv,
  buildSTSCsv,
  exportSTSCsv,
  formatCsvDateTime,
  filenameTimestamp,
} from './csv';

// ---- Modal CSS builder + presets ----
export {
  buildStockTransferModalCss,
  MODAL_THEME_TEAL,
  MODAL_THEME_INDIGO,
} from './stockTransferModalCss';

// ---- Tab CSS builder + presets ----
export {
  buildStockTransferTabCss,
  TAB_THEME_APPROVAL,
  TAB_THEME_HANDLER,
} from './stockTransferTabCss';