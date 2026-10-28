// models/poActivityLogModel.js
'use strict';

/**
 * po_activity_log — chronological event stream for PO lines.
 *
 * Every row is ONE event on ONE PO line. `warehouse_code` is the
 * anchor — every event is scoped to exactly one warehouse.
 *
 * Actual declared column types (verified against sys.columns; remember
 * nvarchar max_length in sys.columns is BYTES, divide by 2 for chars):
 *
 *   log_id           bigint IDENTITY PK
 *   po_no            varchar(50)     NOT NULL
 *   event_type       varchar(50)     NOT NULL
 *   event_summary    nvarchar(500)   NULL
 *   event_detail     nvarchar(MAX)   NULL
 *   ref_sts_id       bigint          NULL
 *   actor            nvarchar(100)   NULL
 *   acted_at         datetime        NOT NULL  DEFAULT GETDATE()
 *   item_code        nvarchar(50)    NULL
 *   warehouse_code   nvarchar(20)    NOT NULL  ← Migration 3
 *   warehouse_id     int             NULL      ← Migration 3
 *   locator_code     nvarchar(50)    NULL      ← Migration 3
 *   stage            nvarchar(20)    NULL      ← Migration 3
 *   qty_change       decimal(18,4)   NULL      ← Migration 3
 *   prev_qty         decimal(18,4)   NULL      ← Migration 3
 *   new_qty          decimal(18,4)   NULL      ← Migration 3
 *
 * stage is constrained by chk_pal_stage to:
 *   'IMPORT' | 'RECEIVE' | 'STORE' | 'TRANSFER' | 'RELEASE'
 *
 * Session 13 (I1) — PO vs PR distinguisher
 *   `po_activity_log` itself has no way to know whether a given
 *   po_no value came from a real PO (has_po = 1) or from a PR-based
 *   import (has_po = 0). listForWarehouse now resolves that on the
 *   fly with a correlated subquery against import_po, so every row
 *   in the feed carries a `has_po` flag. The frontend turns this
 *   into 'PO' or 'PR' labelling (activityStyles.js + DocumentRow).
 */

const { sql, pool, poolConnect, query } = require('../db');

/* ============================================================
   EVENT TAXONOMY
   ============================================================ */
const EVENT_TYPES = Object.freeze({
  /* ---- Flow A: PO lifecycle ---- */
  IMPORT_PO_LINE:       { stage: 'IMPORT',   summary: 'PO line imported' },
  RECEIVE_PO_LINE:      { stage: 'RECEIVE',  summary: 'PO line received' },
  MARK_PO_LINE_DAMAGED: { stage: 'RECEIVE',  summary: 'PO line marked damaged' },
  STORE_PO_LINE:        { stage: 'STORE',    summary: 'PO line stored to locator' },
  DAMAGE_PO_LINE:       { stage: 'STORE',    summary: 'PO line stored to damage locator' },
  RELEASE_PO_LINE:      { stage: 'RELEASE',  summary: 'PO line released' },
  TRANSFER_PO_LINE_OUT: { stage: 'TRANSFER', summary: 'PO line shipped via STS' },
  TRANSFER_PO_LINE_IN:  { stage: 'TRANSFER', summary: 'PO line received via STS' },

  /* ---- Legacy event_type values already in the DB ---- */
  Imported:             { stage: 'IMPORT',   summary: 'Imported' },
  Received:             { stage: 'RECEIVE',  summary: 'Received' },
  Stored:               { stage: 'STORE',    summary: 'Stored' },
  Released:             { stage: 'RELEASE',  summary: 'Released' },
  Forwarded:            { stage: 'TRANSFER', summary: 'Forwarded to handler' },
  TransferSubmitted:    { stage: 'TRANSFER', summary: 'Transfer submitted' },
  TransferResubmitted:  { stage: 'TRANSFER', summary: 'Transfer resubmitted' },
  TransferApproved:     { stage: 'TRANSFER', summary: 'Transfer approved' },
  TransferRejected:     { stage: 'TRANSFER', summary: 'Transfer rejected' },
  TransferCancelled:    { stage: 'TRANSFER', summary: 'Transfer cancelled' },
  TransferInTransit:    { stage: 'TRANSFER', summary: 'Transfer shipped' },
  TransferReceived:     { stage: 'TRANSFER', summary: 'Transfer received' },
  TransferCompleted:    { stage: 'TRANSFER', summary: 'Transfer completed' },
});

const VALID_STAGES = Object.freeze([
  'IMPORT', 'RECEIVE', 'STORE', 'TRANSFER', 'RELEASE',
]);

/* ============================================================
   SANITIZERS
   ============================================================ */
const _str = (v, max) => {
  if (v === undefined || v === null) return null;
  const t = String(v).trim();
  if (!t) return null;
  return max && t.length > max ? t.slice(0, max) : t;
};

const _num = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};

const _int = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const x = parseInt(v, 10);
  return Number.isFinite(x) ? x : null;
};

const _jsonish = (v) => {
  if (v == null) return null;
  if (typeof v === 'object') {
    try { return JSON.stringify(v); } catch { return String(v); }
  }
  return String(v);
};

/* ============================================================
   _buildRow — used by both insert paths
   ============================================================ */
const _buildRow = ({
  po_no,
  event_type,
  warehouse_code,
  item_code     = null,
  event_summary = null,
  event_detail  = null,
  ref_sts_id    = null,
  actor         = null,
  warehouse_id  = null,
  locator_code  = null,
  stage         = null,
  qty_change    = null,
  prev_qty      = null,
  new_qty       = null,
  acted_at      = null,
}) => {
  const poNo = _str(po_no, 50);
  if (!poNo) throw new Error('po_no is required.');

  const evt = _str(event_type, 50);
  if (!evt) throw new Error('event_type is required.');

  const wh = _str(warehouse_code, 20);
  if (!wh) throw new Error('warehouse_code is required.');

  const meta = EVENT_TYPES[evt] || null;
  const finalStage = _str(stage || meta?.stage, 20);
  if (!finalStage || !VALID_STAGES.includes(finalStage)) {
    throw new Error(
      `stage must be one of ${VALID_STAGES.join(', ')} ` +
      `(event_type="${evt}", stage="${finalStage}").`
    );
  }

  return {
    po_no:         poNo,
    event_type:    evt,
    event_summary: _str(event_summary || meta?.summary, 500),
    event_detail:  _jsonish(event_detail),
    ref_sts_id:    _int(ref_sts_id),
    actor:         _str(actor, 100),
    acted_at:      acted_at ? new Date(acted_at) : null,
    item_code:     _str(item_code, 50),
    warehouse_code: wh,
    warehouse_id:  _int(warehouse_id),
    locator_code:  _str(locator_code, 50),
    stage:         finalStage,
    qty_change:    _num(qty_change),
    prev_qty:      _num(prev_qty),
    new_qty:       _num(new_qty),
  };
};

/* ============================================================
   MODEL
   ============================================================ */
const PoActivityLogModel = {
  EVENT_TYPES,
  VALID_STAGES,

  createEventInTx: async (tx, data) => {
    const r = _buildRow(data);
    const req = new sql.Request(tx);

    req.input('po_no',         sql.VarChar(50),       r.po_no);
    req.input('event_type',    sql.VarChar(50),       r.event_type);
    req.input('event_summary', sql.NVarChar(500),     r.event_summary);
    req.input('event_detail',  sql.NVarChar(sql.MAX), r.event_detail);
    req.input('ref_sts_id',    sql.BigInt,            r.ref_sts_id);
    req.input('actor',         sql.NVarChar(100),     r.actor);
    req.input('acted_at',      sql.DateTime,          r.acted_at);
    req.input('item_code',     sql.NVarChar(50),      r.item_code);
    req.input('warehouse_code', sql.NVarChar(20),     r.warehouse_code);
    req.input('warehouse_id',  sql.Int,               r.warehouse_id);
    req.input('locator_code',  sql.NVarChar(50),      r.locator_code);
    req.input('stage',         sql.NVarChar(20),      r.stage);
    req.input('qty_change',    sql.Decimal(18,4),     r.qty_change);
    req.input('prev_qty',      sql.Decimal(18,4),     r.prev_qty);
    req.input('new_qty',       sql.Decimal(18,4),     r.new_qty);

    const res = await req.query(`
      INSERT INTO dbo.po_activity_log
        (po_no, event_type, event_summary, event_detail, ref_sts_id,
         actor, acted_at, item_code,
         warehouse_code, warehouse_id, locator_code, stage,
         qty_change, prev_qty, new_qty)
      OUTPUT INSERTED.log_id, INSERTED.acted_at
      VALUES
        (@po_no, @event_type, @event_summary, @event_detail, @ref_sts_id,
         @actor, COALESCE(@acted_at, GETDATE()), @item_code,
         @warehouse_code, @warehouse_id, @locator_code, @stage,
         @qty_change, @prev_qty, @new_qty)
    `);
    return res.recordset[0];
  },

  createEvent: async (data) => {
    await poolConnect;
    const r = _buildRow(data);
    const req = pool.request();

    req.input('po_no',         sql.VarChar(50),       r.po_no);
    req.input('event_type',    sql.VarChar(50),       r.event_type);
    req.input('event_summary', sql.NVarChar(500),     r.event_summary);
    req.input('event_detail',  sql.NVarChar(sql.MAX), r.event_detail);
    req.input('ref_sts_id',    sql.BigInt,            r.ref_sts_id);
    req.input('actor',         sql.NVarChar(100),     r.actor);
    req.input('acted_at',      sql.DateTime,          r.acted_at);
    req.input('item_code',     sql.NVarChar(50),      r.item_code);
    req.input('warehouse_code', sql.NVarChar(20),     r.warehouse_code);
    req.input('warehouse_id',  sql.Int,               r.warehouse_id);
    req.input('locator_code',  sql.NVarChar(50),      r.locator_code);
    req.input('stage',         sql.NVarChar(20),      r.stage);
    req.input('qty_change',    sql.Decimal(18,4),     r.qty_change);
    req.input('prev_qty',      sql.Decimal(18,4),     r.prev_qty);
    req.input('new_qty',       sql.Decimal(18,4),     r.new_qty);

    const res = await req.query(`
      INSERT INTO dbo.po_activity_log
        (po_no, event_type, event_summary, event_detail, ref_sts_id,
         actor, acted_at, item_code,
         warehouse_code, warehouse_id, locator_code, stage,
         qty_change, prev_qty, new_qty)
      OUTPUT INSERTED.log_id, INSERTED.acted_at
      VALUES
        (@po_no, @event_type, @event_summary, @event_detail, @ref_sts_id,
         @actor, COALESCE(@acted_at, GETDATE()), @item_code,
         @warehouse_code, @warehouse_id, @locator_code, @stage,
         @qty_change, @prev_qty, @new_qty)
    `);
    return res.recordset[0];
  },

  /* BACKWARD COMPAT */
  log: async ({ po_no, item_code = null, event_type, event_summary = null,
                event_detail = null, ref_sts_id = null, actor = null,
                warehouse_code = null, warehouse_id = null,
                locator_code = null, stage = null,
                qty_change = null, prev_qty = null, new_qty = null } = {}) => {
    try {
      await PoActivityLogModel.createEvent({
        po_no, event_type, item_code, event_summary, event_detail,
        ref_sts_id, actor, warehouse_code, warehouse_id,
        locator_code, stage, qty_change, prev_qty, new_qty,
      });
    } catch (err) {
      console.warn('⚠️ po_activity_log write failed:', err.message);
    }
  },

  /* ----------------------------------------------------------
     LIST FOR WAREHOUSE — the primary chronological feed.

     Session 9 (F5) — accepts an optional `q` free-text search
     so filters apply to the WHOLE dataset server-side, not just
     the current page. `q` matches event_summary, event_detail,
     item_code, actor, and po_no.

     Wildcards pass through unescaped — the LIKE clause is bound
     as a parameter so there's no injection risk, but a user
     typing "%" would widen the match. Acceptable UX.

     Session 13 (I1) — carries `has_po` alongside every row so
     the frontend can label PO-based rows differently from
     PR-based rows. We do NOT use a JOIN because `import_po` may
     hold multiple rows per po_no (one per line item); a
     correlated subquery guarantees exactly one has_po value per
     event row, and defaults to 1 (PO) if the source import_po
     row has been deleted.

     Returns { rows, total, page, limit, totalPages }.
     Always ORDER BY acted_at DESC, log_id DESC — newest first.
     ---------------------------------------------------------- */
  listForWarehouse: async ({
    warehouse_code, stage = null, item_code = null, po_no = null,
    q = null,
    start_date = null, end_date = null,
    page = 1, limit = 200,
  } = {}) => {
    const wh = _str(warehouse_code, 20);
    if (!wh) throw new Error('warehouse_code is required.');

    const params = [wh];
    const conds = ['warehouse_code = @param0'];

    if (stage) {
      params.push(_str(stage, 20));
      conds.push(`stage = @param${params.length - 1}`);
    }
    if (item_code) {
      params.push(_str(item_code, 50));
      conds.push(`item_code = @param${params.length - 1}`);
    }
    if (po_no) {
      params.push(_str(po_no, 50));
      conds.push(`po_no = @param${params.length - 1}`);
    }
    if (q) {
      const like = `%${_str(q, 200)}%`;
      params.push(like);
      const idx = params.length - 1;
      conds.push(
        `(event_summary LIKE @param${idx} ` +
        `OR event_detail LIKE @param${idx} ` +
        `OR item_code LIKE @param${idx} ` +
        `OR actor LIKE @param${idx} ` +
        `OR po_no LIKE @param${idx})`
      );
    }
    if (start_date) {
      params.push(new Date(start_date));
      conds.push(`acted_at >= @param${params.length - 1}`);
    }
    if (end_date) {
      params.push(new Date(end_date));
      conds.push(`acted_at <= @param${params.length - 1}`);
    }

    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 200, 1), 2000);
    const safePage  = Math.max(parseInt(page, 10) || 1, 1);
    const offset    = (safePage - 1) * safeLimit;
    const where     = `WHERE ${conds.join(' AND ')}`;

    const countRows = await query(
      `SELECT COUNT(*) AS total FROM dbo.po_activity_log ${where}`,
      params
    );
    const total = Number(countRows[0]?.total) || 0;

    const listParams = [...params, offset, safeLimit];
    const offIdx = listParams.length - 2;
    const limIdx = listParams.length - 1;

    /* --------------------------------------------------------
       Session 13 (I1): resolve has_po via correlated subquery.
       A PO imported with a PO No. has has_po = 1; a PR-based
       import has has_po = 0 (the importer stored po_no = pr_no
       for those rows). No matching import_po row (deleted line
       or legacy data) falls back to 1 (treated as PO).
       -------------------------------------------------------- */
    const rows = await query(
      `SELECT
         log_id, po_no, event_type, stage, event_summary,
         item_code, warehouse_code, warehouse_id, locator_code,
         qty_change, prev_qty, new_qty,
         actor, acted_at, ref_sts_id, event_detail,
         ISNULL((
           SELECT TOP 1 CAST(has_po AS INT)
             FROM dbo.import_po
            WHERE import_po.po_no = dbo.po_activity_log.po_no
         ), 1) AS has_po
       FROM dbo.po_activity_log
       ${where}
       ORDER BY acted_at DESC, log_id DESC
       OFFSET @param${offIdx} ROWS FETCH NEXT @param${limIdx} ROWS ONLY`,
      listParams
    );

    const totalPages = Math.max(Math.ceil(total / safeLimit), 1);
    return { rows, total, page: safePage, limit: safeLimit, totalPages };
  },

  listForPo: async ({ po_no, warehouse_code = null, item_code = null, limit = 1000 } = {}) => {
    const poNo = _str(po_no, 50);
    if (!poNo) throw new Error('po_no is required.');

    const params = [poNo];
    const conds  = ['po_no = @param0'];

    if (warehouse_code) {
      params.push(_str(warehouse_code, 20));
      conds.push(`warehouse_code = @param${params.length - 1}`);
    }
    if (item_code) {
      params.push(_str(item_code, 50));
      conds.push(`item_code = @param${params.length - 1}`);
    }

    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 1000, 1), 5000);

    return query(
      `SELECT TOP (${safeLimit})
         log_id, po_no, event_type, stage, event_summary,
         item_code, warehouse_code, warehouse_id, locator_code,
         qty_change, prev_qty, new_qty,
         actor, acted_at, ref_sts_id, event_detail
       FROM dbo.po_activity_log
       WHERE ${conds.join(' AND ')}
       ORDER BY acted_at ASC, log_id ASC`,
      params
    );
  },

  listByPO: async (poNo, itemCode = null) => {
    const po = _str(poNo, 50);
    if (!po) throw new Error('po_no is required.');

    const params = [po];
    let sqlText = `
      SELECT log_id, po_no, item_code, event_type, event_summary, event_detail,
             ref_sts_id, actor, acted_at,
             warehouse_code, warehouse_id, locator_code, stage,
             qty_change, prev_qty, new_qty
        FROM dbo.po_activity_log
       WHERE po_no = @param0
    `;

    if (itemCode && String(itemCode).trim()) {
      params.push(String(itemCode).trim());
      sqlText += ` AND (item_code = @param1 OR item_code IS NULL)`;
    }
    sqlText += ` ORDER BY acted_at ASC, log_id ASC`;
    return query(sqlText, params);
  },

  listForItem: async ({
    item_code, warehouse_code = null,
    start_date = null, end_date = null, limit = 500,
  } = {}) => {
    const it = _str(item_code, 50);
    if (!it) throw new Error('item_code is required.');

    const params = [it];
    const conds  = ['item_code = @param0'];

    if (warehouse_code) {
      params.push(_str(warehouse_code, 20));
      conds.push(`warehouse_code = @param${params.length - 1}`);
    }
    if (start_date) {
      params.push(new Date(start_date));
      conds.push(`acted_at >= @param${params.length - 1}`);
    }
    if (end_date) {
      params.push(new Date(end_date));
      conds.push(`acted_at <= @param${params.length - 1}`);
    }

    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 500, 1), 5000);

    return query(
      `SELECT TOP (${safeLimit})
         log_id, po_no, event_type, stage, event_summary,
         item_code, warehouse_code, locator_code,
         qty_change, prev_qty, new_qty,
         actor, acted_at
       FROM dbo.po_activity_log
       WHERE ${conds.join(' AND ')}
       ORDER BY acted_at DESC, log_id DESC`,
      params
    );
  },

  listRecent: async ({ limit = 100 } = {}) => {
    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 500);
    return query(
      `SELECT TOP (${safeLimit})
         log_id, po_no, event_type, stage, event_summary,
         item_code, warehouse_code, locator_code,
         qty_change, prev_qty, new_qty,
         actor, acted_at
       FROM dbo.po_activity_log
       ORDER BY acted_at DESC, log_id DESC`
    );
  },

  summarizeForWarehouse: async ({ warehouse_code, start_date = null, end_date = null } = {}) => {
    const wh = _str(warehouse_code, 20);
    if (!wh) throw new Error('warehouse_code is required.');

    const params = [wh];
    const conds  = ['warehouse_code = @param0'];

    if (start_date) {
      params.push(new Date(start_date));
      conds.push(`acted_at >= @param${params.length - 1}`);
    }
    if (end_date) {
      params.push(new Date(end_date));
      conds.push(`acted_at <= @param${params.length - 1}`);
    }

    const where = `WHERE ${conds.join(' AND ')}`;

    const byStage = await query(
      `SELECT
         stage,
         COUNT(*)                        AS event_count,
         COUNT(DISTINCT po_no)           AS po_count,
         COUNT(DISTINCT item_code)       AS item_count,
         ISNULL(SUM(qty_change), 0)      AS total_qty_change,
         MIN(acted_at)                   AS first_event_at,
         MAX(acted_at)                   AS last_event_at
       FROM dbo.po_activity_log
       ${where}
       GROUP BY stage
       ORDER BY stage`,
      params
    );

    const totals = await query(
      `SELECT
         COUNT(*)                   AS total_events,
         COUNT(DISTINCT po_no)      AS total_pos,
         COUNT(DISTINCT item_code)  AS total_items
       FROM dbo.po_activity_log
       ${where}`,
      params
    );

    return {
      by_stage: byStage,
      total:    totals[0] || { total_events: 0, total_pos: 0, total_items: 0 },
    };
  },
};

module.exports = PoActivityLogModel;