// models/stockTransferActivityLogModel.js
'use strict';

/**
 * stock_transfer_activity_log — chronological event stream for
 * Stock Transfer Slip (STS) lifecycle.
 *
 *   Flow A (po_activity_log)              → import → store
 *   Flow B (stock_transfer_activity_log)  → request → approve
 *                                           → ship → receive → store
 *
 * Both warehouse anchors are recorded on every row, so you can
 * query "as source" or "as destination" without joining the header.
 *
 * Actual declared column types:
 *   log_id               bigint IDENTITY PK
 *   sts_id               bigint         NOT NULL  FK → stock_transfer_slips
 *   sts_no               varchar(20)    NULL
 *   sts_line_id          bigint         NULL      FK → stock_transfer_slip_lines
 *   event_type           nvarchar(40)   NOT NULL
 *   stage                nvarchar(20)   NOT NULL
 *   from_warehouse_code  nvarchar(20)   NULL
 *   to_warehouse_code    nvarchar(20)   NULL
 *   item_code            nvarchar(50)   NULL
 *   item_name            nvarchar(400)  NULL
 *   uom                  nvarchar(50)   NULL
 *   qty_before           decimal(18,4)  NULL
 *   qty_after            decimal(18,4)  NULL
 *   qty_change           decimal(18,4)  NULL
 *   locator_code         nvarchar(50)   NULL
 *   actor                nvarchar(100)  NOT NULL
 *   actor_role           nvarchar(100)  NULL
 *   acted_at             datetime       NOT NULL  DEFAULT GETDATE()
 *   remarks              nvarchar(1000) NULL
 *   event_detail         nvarchar(MAX)  NULL
 *
 * chk_stsal_stage allows:
 *   'REQUEST' | 'APPROVE' | 'SHIP' | 'TRANSIT'
 *   | 'RECEIVE' | 'STORE' | 'COMPLETE' | 'CANCEL'
 */

const { sql, pool, poolConnect, query } = require('../db');

const EVENT_TYPES = Object.freeze({
  REQUEST_SUBMITTED: { stage: 'REQUEST',  summary: 'STS request submitted' },
  QTY_ADJUSTED:      { stage: 'APPROVE',  summary: 'Line qty adjusted by approver' },
  APPROVED:          { stage: 'APPROVE',  summary: 'STS approved' },
  REJECTED:          { stage: 'APPROVE',  summary: 'STS rejected' },
  CANCELLED:         { stage: 'CANCEL',   summary: 'STS cancelled' },
  SHIPPED:           { stage: 'SHIP',     summary: 'STS shipped' },
  ARRIVED:           { stage: 'TRANSIT',  summary: 'STS arrived at destination' },
  RECEIVED:          { stage: 'RECEIVE',  summary: 'STS received' },
  STORE_LINE:        { stage: 'STORE',    summary: 'STS line stored to locator' },
  COMPLETED:         { stage: 'COMPLETE', summary: 'STS completed' },
});

const VALID_STAGES = Object.freeze([
  'REQUEST', 'APPROVE', 'SHIP', 'TRANSIT', 'RECEIVE', 'STORE', 'COMPLETE', 'CANCEL',
]);

/* ---- Sanitizers ---- */
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
  if (typeof v === 'object') { try { return JSON.stringify(v); } catch { return String(v); } }
  return String(v);
};

const _buildRow = ({
  sts_id,
  event_type,
  actor,
  sts_no               = null,
  sts_line_id          = null,
  from_warehouse_code  = null,
  to_warehouse_code    = null,
  item_code            = null,
  item_name            = null,
  uom                  = null,
  qty_before           = null,
  qty_after            = null,
  qty_change           = null,
  locator_code         = null,
  actor_role           = null,
  acted_at             = null,
  remarks              = null,
  event_detail         = null,
  stage                = null,
}) => {
  const sid = _int(sts_id);
  if (!sid || sid <= 0) throw new Error('sts_id is required (positive integer).');

  const evt = _str(event_type, 40);
  if (!evt) throw new Error('event_type is required.');

  const act = _str(actor, 100);
  if (!act) throw new Error('actor is required.');

  const meta = EVENT_TYPES[evt] || null;
  const finalStage = _str(stage || meta?.stage, 20);
  if (!finalStage || !VALID_STAGES.includes(finalStage)) {
    throw new Error(
      `stage must be one of ${VALID_STAGES.join(', ')} ` +
      `(event_type="${evt}", stage="${finalStage}").`
    );
  }

  return {
    sts_id:               sid,
    sts_no:               _str(sts_no, 20),
    sts_line_id:          _int(sts_line_id),
    event_type:           evt,
    stage:                finalStage,
    from_warehouse_code:  _str(from_warehouse_code, 20),
    to_warehouse_code:    _str(to_warehouse_code, 20),
    item_code:            _str(item_code, 50),
    item_name:            _str(item_name, 400),
    uom:                  _str(uom, 50),
    qty_before:           _num(qty_before),
    qty_after:            _num(qty_after),
    qty_change:           _num(qty_change),
    locator_code:         _str(locator_code, 50),
    actor:                act,
    actor_role:           _str(actor_role, 100),
    acted_at:             acted_at ? new Date(acted_at) : null,
    remarks:              _str(remarks, 1000),
    event_detail:         _jsonish(event_detail),
  };
};

const _bind = (req, r) => {
  req.input('sts_id',              sql.BigInt,        r.sts_id);
  req.input('sts_no',              sql.VarChar(20),   r.sts_no);
  req.input('sts_line_id',         sql.BigInt,        r.sts_line_id);
  req.input('event_type',          sql.NVarChar(40),  r.event_type);
  req.input('stage',               sql.NVarChar(20),  r.stage);
  req.input('from_warehouse_code', sql.NVarChar(20),  r.from_warehouse_code);
  req.input('to_warehouse_code',   sql.NVarChar(20),  r.to_warehouse_code);
  req.input('item_code',           sql.NVarChar(50),  r.item_code);
  req.input('item_name',           sql.NVarChar(400), r.item_name);
  req.input('uom',                 sql.NVarChar(50),  r.uom);
  req.input('qty_before',          sql.Decimal(18,4), r.qty_before);
  req.input('qty_after',           sql.Decimal(18,4), r.qty_after);
  req.input('qty_change',          sql.Decimal(18,4), r.qty_change);
  req.input('locator_code',        sql.NVarChar(50),  r.locator_code);
  req.input('actor',               sql.NVarChar(100), r.actor);
  req.input('actor_role',          sql.NVarChar(100), r.actor_role);
  req.input('acted_at',            sql.DateTime,      r.acted_at);
  req.input('remarks',             sql.NVarChar(1000), r.remarks);
  req.input('event_detail',        sql.NVarChar(sql.MAX), r.event_detail);
};

const INSERT_SQL = `
  INSERT INTO dbo.stock_transfer_activity_log
    (sts_id, sts_no, sts_line_id,
     event_type, stage,
     from_warehouse_code, to_warehouse_code,
     item_code, item_name, uom,
     qty_before, qty_after, qty_change,
     locator_code,
     actor, actor_role, acted_at,
     remarks, event_detail)
  OUTPUT INSERTED.log_id, INSERTED.acted_at
  VALUES
    (@sts_id, @sts_no, @sts_line_id,
     @event_type, @stage,
     @from_warehouse_code, @to_warehouse_code,
     @item_code, @item_name, @uom,
     @qty_before, @qty_after, @qty_change,
     @locator_code,
     @actor, @actor_role, COALESCE(@acted_at, GETDATE()),
     @remarks, @event_detail)
`;

const StockTransferActivityLogModel = {
  EVENT_TYPES,
  VALID_STAGES,

  createEventInTx: async (tx, data) => {
    const r = _buildRow(data);
    const req = new sql.Request(tx);
    _bind(req, r);
    const res = await req.query(INSERT_SQL);
    return res.recordset[0];
  },

  createEvent: async (data) => {
    await poolConnect;
    const r = _buildRow(data);
    const req = pool.request();
    _bind(req, r);
    const res = await req.query(INSERT_SQL);
    return res.recordset[0];
  },

  createMany: async (events = []) => {
    if (!Array.isArray(events) || events.length === 0) return [];
    const out = [];
    for (const e of events) out.push(await StockTransferActivityLogModel.createEvent(e));
    return out;
  },

  listForSts: async ({ sts_id, limit = 1000 } = {}) => {
    const sid = _int(sts_id);
    if (!sid) throw new Error('sts_id is required.');
    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 1000, 1), 5000);

    return query(
      `SELECT TOP (${safeLimit})
         log_id, sts_id, sts_no, sts_line_id,
         event_type, stage,
         from_warehouse_code, to_warehouse_code,
         item_code, item_name, uom,
         qty_before, qty_after, qty_change,
         locator_code,
         actor, actor_role, acted_at,
         remarks, event_detail
       FROM dbo.stock_transfer_activity_log
       WHERE sts_id = @param0
       ORDER BY acted_at ASC, log_id ASC`,
      [sid]
    );
  },

  /* ----------------------------------------------------------
     LIST FOR WAREHOUSE — chronological feed, filtered by
     source / destination / both. Newest first.

     Session 9 (F5) — accepts an optional `q` free-text search
     so filters apply to the WHOLE dataset server-side, not just
     the current page. `q` matches item_code, item_name, actor,
     sts_no, and remarks.

     Returns { rows, total, page, limit, totalPages }.
     Always ORDER BY acted_at DESC, log_id DESC — newest first.
     ---------------------------------------------------------- */
  listForWarehouse: async ({
    warehouse_code, side = 'both', stage = null,
    q = null,
    start_date = null, end_date = null,
    page = 1, limit = 200,
  } = {}) => {
    const wh = _str(warehouse_code, 20);
    if (!wh) throw new Error('warehouse_code is required.');

    const params = [wh];
    const whCond =
      side === 'from' ? 'from_warehouse_code = @param0' :
      side === 'to'   ? 'to_warehouse_code = @param0' :
                        '(from_warehouse_code = @param0 OR to_warehouse_code = @param0)';
    const conds = [whCond];

    if (stage) {
      params.push(_str(stage, 20));
      conds.push(`stage = @param${params.length - 1}`);
    }
    if (q) {
      const like = `%${_str(q, 200)}%`;
      params.push(like);
      const idx = params.length - 1;
      conds.push(
        `(item_code LIKE @param${idx} ` +
        `OR item_name LIKE @param${idx} ` +
        `OR actor LIKE @param${idx} ` +
        `OR sts_no LIKE @param${idx} ` +
        `OR remarks LIKE @param${idx})`
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
      `SELECT COUNT(*) AS total FROM dbo.stock_transfer_activity_log ${where}`,
      params
    );
    const total = Number(countRows[0]?.total) || 0;

    const listParams = [...params, offset, safeLimit];
    const offIdx = listParams.length - 2;
    const limIdx = listParams.length - 1;

    const rows = await query(
      `SELECT
         log_id, sts_id, sts_no, sts_line_id,
         event_type, stage,
         from_warehouse_code, to_warehouse_code,
         item_code, item_name, uom,
         qty_before, qty_after, qty_change,
         locator_code,
         actor, actor_role, acted_at,
         remarks
       FROM dbo.stock_transfer_activity_log
       ${where}
       ORDER BY acted_at DESC, log_id DESC
       OFFSET @param${offIdx} ROWS FETCH NEXT @param${limIdx} ROWS ONLY`,
      listParams
    );

    const totalPages = Math.max(Math.ceil(total / safeLimit), 1);
    return { rows, total, page: safePage, limit: safeLimit, totalPages };
  },

  listRecent: async ({ limit = 100 } = {}) => {
    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 500);
    return query(
      `SELECT TOP (${safeLimit})
         log_id, sts_id, sts_no, sts_line_id,
         event_type, stage,
         from_warehouse_code, to_warehouse_code,
         item_code,
         qty_before, qty_after, qty_change,
         locator_code,
         actor, actor_role, acted_at
       FROM dbo.stock_transfer_activity_log
       ORDER BY acted_at DESC, log_id DESC`
    );
  },
};

module.exports = StockTransferActivityLogModel;