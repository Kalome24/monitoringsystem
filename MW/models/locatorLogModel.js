// models/locatorLogModel.js
//
// Unified model for the locator activity log.
// Currently records manual exports. Will also record sync imports
// once the underground-handler workflow is built — hence the generic
// "LocatorLog" name. Table names (locator_export_log / _items) are
// unchanged and remain shared by both flows.
//
// Session 15 (S1++++) — both listLogs and getLogById now surface the
// linked underground shift's context (if the log belongs to one) via
// an OUTER APPLY. This lets the History detail modal on the surface
// side display the shift's beginning / released / ending totals for
// accurate cross-checking against the log totals.
//
// Session 16 (cross-DB) — createLog now accepts an optional
// externalTx so callers can co-commit the log insert with sibling
// writes (e.g. warehouse_inventory movements) inside ONE atomic
// transaction. When externalTx is provided, createLog does NOT
// begin/commit/rollback — that's the caller's responsibility.
// The header insert also accepts `sync_token`, which the
// cross-DB receiver uses as its idempotency key.
//
// Precision Fix — updated decimals for qty, unit_cost, and line_total
// to prevent truncation of moving averages during export.
//
// BCP Nullability Fix — the live schema has `unit_cost` and
// `line_total` as NULL-able columns (col 13 & 14), while `qty` is
// NOT NULL (col 12). The bulk-insert metadata now matches that
// exactly. A mismatch on either nullable flag causes tedious to send
// TDS type 0x6C (non-nullable NUMERIC) which SQL Server rejects with
// error 4816 "Invalid column type from bcp client for colid N".
//
// LINE KIND ADDITION — Added `line_kind` to the bulk insert and select
// queries so the Surface Handler can distinguish between Issued,
// Damaged, and Transferred items when viewing History.
//
const { query, ensurePool, sql } = require('../db');

const LocatorLogModel = {
  /* ============================================================
     WRITE — create a new header + bulk-insert its item lines
     ============================================================ */

  /**
   * Create one log entry (export or, later, import) with all its
   * item lines in a single SQL transaction.
   *
   * @param {object} header
   * @param {Array<object>} lines
   * @param {sql.Transaction|null} externalTx
   *        Session 16 — optional. When supplied, the caller owns
   *        begin/commit/rollback. When null, createLog runs its own
   *        transaction (legacy behaviour).
   * @returns {Promise<{ export_id:number, export_uid:string }>}
   */
  createLog: async (header, lines = [], externalTx = null) => {
    const {
      direction,
      action_type,
      export_format,
      source_warehouse_code,
      source_warehouse_name,
      target_warehouse_code,
      target_warehouse_name,
      performed_by_id,
      performed_by_username,
      performed_by_role,
      performed_by_position,
      locator_count,
      item_row_count,
      total_qty,
      total_value,
      filename,
      file_hash,
      file_size_bytes,
      notes,
      linked_export_id,
      sync_token,                  // ← Session 16
    } = header;

    const clean = (v) => (v === undefined ? null : v);

    const ownTx = !externalTx;
    const pool  = await ensurePool();
    const tx    = externalTx || pool.transaction();
    if (ownTx) await tx.begin();

    try {
      // ---- 1. Header insert (OUTPUT returns export_id) ----
      // export_uid is written as a placeholder, replaced in step 2.
      const headerReq = new sql.Request(tx)
        .input('direction',        sql.NVarChar(20),   direction)
        .input('action_type',      sql.NVarChar(60),   action_type)
        .input('export_format',    sql.NVarChar(20),   clean(export_format))
        .input('src_code',         sql.NVarChar(40),   source_warehouse_code)
        .input('src_name',         sql.NVarChar(200),  clean(source_warehouse_name))
        .input('dst_code',         sql.NVarChar(40),   clean(target_warehouse_code))
        .input('dst_name',         sql.NVarChar(200),  clean(target_warehouse_name))
        .input('by_id',            sql.Int,            clean(performed_by_id))
        .input('by_username',      sql.NVarChar(100),  performed_by_username)
        .input('by_role',          sql.NVarChar(100),  clean(performed_by_role))
        .input('by_position',      sql.NVarChar(200),  clean(performed_by_position))
        .input('locator_count',    sql.Int,            locator_count || 0)
        .input('item_row_count',   sql.Int,            item_row_count || 0)
        .input('total_qty',        sql.Decimal(18, 4), total_qty || 0)
        .input('total_value',      sql.Decimal(18, 4), total_value || 0)
        .input('filename',         sql.NVarChar(510),  clean(filename))
        .input('file_hash',        sql.NVarChar(200),  clean(file_hash))
        .input('file_size_bytes',  sql.BigInt,         clean(file_size_bytes))
        .input('notes',            sql.NVarChar(1000), clean(notes))
        .input('linked_export_id', sql.Int,            clean(linked_export_id))
        .input('sync_token',       sql.UniqueIdentifier, clean(sync_token));

      const headerRes = await headerReq.query(`
        INSERT INTO dbo.locator_export_log (
          export_uid,
          direction, action_type, export_format,
          source_warehouse_code, source_warehouse_name,
          target_warehouse_code, target_warehouse_name,
          performed_by_id, performed_by_username,
          performed_by_role, performed_by_position,
          locator_count, item_row_count, total_qty, total_value,
          filename, file_hash, file_size_bytes, notes, linked_export_id,
          sync_token
        )
        OUTPUT INSERTED.export_id, INSERTED.performed_at
        VALUES (
          LEFT('TMP-' + REPLACE(CONVERT(VARCHAR(36), NEWID()), '-', ''), 30),
          @direction, @action_type, @export_format,
          @src_code, @src_name,
          @dst_code, @dst_name,
          @by_id, @by_username,
          @by_role, @by_position,
          @locator_count, @item_row_count, @total_qty, @total_value,
          @filename, @file_hash, @file_size_bytes, @notes, @linked_export_id,
          @sync_token
        );
      `);

      const row = headerRes.recordset?.[0] || {};
      const exportId = row.export_id;
      if (!exportId) throw new Error('Header insert did not return an ID.');

      // ---- 2. Compose the human ID (EXP-00001 / IMP-00001) ----
      const seq = String(exportId).padStart(5, '0');
      const exportUid = `${direction === 'Import' ? 'IMP' : 'EXP'}-${seq}`;

      await new sql.Request(tx)
        .input('uid', sql.NVarChar(60), exportUid)
        .input('id',  sql.Int,          exportId)
        .query(`
          UPDATE dbo.locator_export_log
          SET export_uid = @uid
          WHERE export_id = @id AND export_uid LIKE 'TMP-%';
        `);

      // ---- 3. Bulk insert item lines (if any) ----
      if (Array.isArray(lines) && lines.length > 0) {
        const table = new sql.Table('dbo.locator_export_log_items');
        table.create = false;
        table.columns.add('export_id',      sql.Int,            { nullable: false });
        table.columns.add('line_kind',      sql.NVarChar(20),   { nullable: true  }); // ✅ Added
        table.columns.add('locator_code',   sql.NVarChar(100),  { nullable: false });
        table.columns.add('locator_name',   sql.NVarChar(400),  { nullable: true  });
        table.columns.add('item_code',      sql.NVarChar(100),  { nullable: false });
        table.columns.add('item_name',      sql.NVarChar(400),  { nullable: true  });
        table.columns.add('barcode',        sql.NVarChar(100),  { nullable: true  });
        table.columns.add('uom',            sql.NVarChar(40),   { nullable: true  });
        table.columns.add('category',       sql.NVarChar(200),  { nullable: true  });
        table.columns.add('purchase_class', sql.NVarChar(200),  { nullable: true  });
        table.columns.add('gl_class',       sql.NVarChar(40),   { nullable: true  });
        table.columns.add('qty',            sql.Decimal(18, 4), { nullable: false }); // DB col 12 · NOT NULL
        table.columns.add('unit_cost',      sql.Decimal(18, 6), { nullable: true  }); // DB col 13 · NULL
        table.columns.add('line_total',     sql.Decimal(18, 4), { nullable: true  }); // DB col 14 · NULL

        for (const ln of lines) {
          table.rows.add(
            exportId,
            ln.line_kind      || null, // ✅ Added
            ln.locator_code   || '',
            ln.locator_name   || null,
            ln.item_code      || '',
            ln.item_name      || null,
            ln.barcode        || null,
            ln.uom            || null,
            ln.category       || null,
            ln.purchase_class || null,
            ln.gl_class       || null,
            Number(ln.qty)        || 0,
            Number(ln.unit_cost)  || 0,
            Number(ln.line_total) || 0
          );
        }

        await new sql.Request(tx).bulk(table);
      }

      if (ownTx) await tx.commit();
      return { export_id: exportId, export_uid: exportUid };
    } catch (err) {
      if (ownTx) try { await tx.rollback(); } catch { /* noop */ }
      console.error('❌ Error in LocatorLogModel.createLog (rolled back):', err);
      throw err;
    }
  },

  /* ============================================================
     READ — paginated header listing
     ============================================================ */
  listLogs: async ({
    page = 1,
    limit = 50,
    direction,
    action_type,
    export_format,
    warehouse_code,
    performed_by,
    search,
    start_date,
    end_date,
  } = {}) => {
    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
    const safePage  = Math.max(parseInt(page, 10) || 1, 1);
    const offset    = (safePage - 1) * safeLimit;

    const where  = [];
    const params = [];

    if (direction)     { params.push(direction);     where.push(`l.direction = @param${params.length - 1}`); }
    if (action_type)   { params.push(action_type);   where.push(`l.action_type = @param${params.length - 1}`); }
    if (export_format) { params.push(export_format); where.push(`l.export_format = @param${params.length - 1}`); }

    if (warehouse_code) {
      params.push(warehouse_code);
      const i1 = params.length - 1;
      params.push(warehouse_code);
      const i2 = params.length - 1;
      where.push(`(l.source_warehouse_code = @param${i1} OR l.target_warehouse_code = @param${i2})`);
    }
    if (performed_by)  { params.push(performed_by);  where.push(`l.performed_by_username = @param${params.length - 1}`); }
    if (start_date)    { params.push(start_date);    where.push(`CAST(l.performed_at AS DATE) >= @param${params.length - 1}`); }
    if (end_date)      { params.push(end_date);      where.push(`CAST(l.performed_at AS DATE) <= @param${params.length - 1}`); }

    if (search) {
      params.push(`%${search}%`);
      const si = params.length - 1;
      where.push(`(
        l.export_uid LIKE @param${si}
        OR l.performed_by_username LIKE @param${si}
        OR l.filename LIKE @param${si}
        OR l.source_warehouse_code LIKE @param${si}
        OR l.source_warehouse_name LIKE @param${si}
      )`);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const countRows = await query(
      `SELECT COUNT(*) AS total FROM dbo.locator_export_log l ${whereSql}`,
      params
    );
    const total = countRows[0]?.total || 0;

    const listParams = [...params, offset, safeLimit];
    const offsetIdx  = listParams.length - 2;
    const limitIdx   = listParams.length - 1;

    const rows = await query(
      `SELECT
          l.export_id,
          l.export_uid,
          l.direction,
          l.action_type,
          l.export_format,
          l.source_warehouse_code,
          l.source_warehouse_name,
          l.target_warehouse_code,
          l.target_warehouse_name,
          l.performed_by_id,
          l.performed_by_username,
          l.performed_by_role,
          l.performed_by_position,
          l.performed_at,
          l.locator_count,
          l.item_row_count,
          l.total_qty,
          l.total_value,
          l.filename,
          l.file_hash,
          l.file_size_bytes,
          l.notes,
          l.linked_export_id,
          l.sync_token,
          ll.export_uid AS linked_export_uid,
          sh.shift_id                AS linked_shift_id,
          sh.status                  AS linked_shift_status,
          sh.warehouse_code          AS linked_shift_warehouse_code,
          sh.handler_username        AS linked_shift_handler_username,
          sh.started_at              AS linked_shift_started_at,
          sh.ended_at                AS linked_shift_ended_at,
          sh.reconciled_at           AS linked_shift_reconciled_at,
          sh.beginning_locator_count AS linked_beginning_locator_count,
          sh.beginning_item_count    AS linked_beginning_item_count,
          sh.beginning_qty           AS linked_beginning_qty,
          sh.beginning_value         AS linked_beginning_value,
          sh.release_line_count      AS linked_release_line_count,
          sh.released_qty            AS linked_released_qty,
          sh.released_value          AS linked_released_value,
          sh.ending_qty              AS linked_ending_qty,
          sh.ending_value            AS linked_ending_value
       FROM dbo.locator_export_log l
       LEFT JOIN dbo.locator_export_log ll ON ll.export_id = l.linked_export_id
       OUTER APPLY (
         SELECT TOP 1
           s.shift_id,
           s.status,
           s.warehouse_code,
           s.handler_username,
           s.started_at,
           s.ended_at,
           s.reconciled_at,
           s.beginning_locator_count,
           s.beginning_item_count,
           s.beginning_qty,
           s.beginning_value,
           s.release_line_count,
           s.released_qty,
           s.released_value,
           s.ending_qty,
           s.ending_value
         FROM dbo.underground_shift s
         WHERE s.seed_log_id           = l.export_id
            OR s.closing_log_id        = l.export_id
            OR s.reconciliation_log_id = l.export_id
         ORDER BY s.shift_id DESC
       ) sh
       ${whereSql}
       ORDER BY l.performed_at DESC, l.export_id DESC
       OFFSET @param${offsetIdx} ROWS
       FETCH NEXT @param${limitIdx} ROWS ONLY`,
      listParams
    );

    const totalPages = Math.max(Math.ceil(total / safeLimit), 1);
    return { rows, total, page: safePage, limit: safeLimit, totalPages };
  },

  /* ============================================================
     READ — single header + paginated item lines
     ============================================================ */

  getLogById: async (exportId) => {
    const rows = await query(
      `SELECT
          l.*,
          sh.shift_id                AS linked_shift_id,
          sh.status                  AS linked_shift_status,
          sh.warehouse_code          AS linked_shift_warehouse_code,
          sh.handler_username        AS linked_shift_handler_username,
          sh.started_at              AS linked_shift_started_at,
          sh.ended_at                AS linked_shift_ended_at,
          sh.reconciled_at           AS linked_shift_reconciled_at,
          sh.beginning_locator_count AS linked_beginning_locator_count,
          sh.beginning_item_count    AS linked_beginning_item_count,
          sh.beginning_qty           AS linked_beginning_qty,
          sh.beginning_value         AS linked_beginning_value,
          sh.release_line_count      AS linked_release_line_count,
          sh.released_qty            AS linked_released_qty,
          sh.released_value          AS linked_released_value,
          sh.ending_qty              AS linked_ending_qty,
          sh.ending_value            AS linked_ending_value
       FROM dbo.locator_export_log l
       OUTER APPLY (
         SELECT TOP 1
           s.shift_id,
           s.status,
           s.warehouse_code,
           s.handler_username,
           s.started_at,
           s.ended_at,
           s.reconciled_at,
           s.beginning_locator_count,
           s.beginning_item_count,
           s.beginning_qty,
           s.beginning_value,
           s.release_line_count,
           s.released_qty,
           s.released_value,
           s.ending_qty,
           s.ending_value
         FROM dbo.underground_shift s
         WHERE s.seed_log_id           = l.export_id
            OR s.closing_log_id        = l.export_id
            OR s.reconciliation_log_id = l.export_id
         ORDER BY s.shift_id DESC
       ) sh
       WHERE l.export_id = @param0`,
      [exportId]
    );
    return rows[0] || null;
  },

  /**
   * Session 16 — idempotency lookup for the cross-DB receiver.
   * Returns the existing log row if this sync_token has already landed.
   */
  getLogBySyncToken: async (sync_token) => {
    if (!sync_token) return null;
    const rows = await query(
      `SELECT TOP 1 export_id, export_uid, performed_at, performed_by_username
         FROM dbo.locator_export_log
        WHERE sync_token = @param0`,
      [String(sync_token).trim()]
    );
    return rows[0] || null;
  },

  getLogLines: async (exportId, { page = 1, limit = 50 } = {}) => {
    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
    const safePage  = Math.max(parseInt(page, 10) || 1, 1);
    const offset    = (safePage - 1) * safeLimit;

    const countRows = await query(
      `SELECT COUNT(*) AS total
       FROM dbo.locator_export_log_items
       WHERE export_id = @param0`,
      [exportId]
    );
    const total = countRows[0]?.total || 0;

    const rows = await query(
      `SELECT
          line_id, 
          line_kind, -- ✅ Added
          locator_code, locator_name,
          item_code, item_name, barcode, uom,
          category, purchase_class, gl_class,
          qty, unit_cost, line_total
       FROM dbo.locator_export_log_items
       WHERE export_id = @param0
       ORDER BY line_id
       OFFSET @param1 ROWS FETCH NEXT @param2 ROWS ONLY`,
      [exportId, offset, safeLimit]
    );

    const totalPages = Math.max(Math.ceil(total / safeLimit), 1);
    return { rows, total, page: safePage, limit: safeLimit, totalPages };
  },
};

module.exports = LocatorLogModel;