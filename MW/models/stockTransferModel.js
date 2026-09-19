// models/stockTransferModel.js
const { sql, pool, poolConnect } = require('../db');

class StockTransferModel {
  /* ============================================================
     HELPERS
     ============================================================ */

  static async getNextStsNo() {
    await poolConnect;
    const request = pool.request();
    const result = await request.query(`
      SELECT NEXT VALUE FOR seq_sts_no AS next_no
    `);
    const nextNo = result.recordset[0]?.next_no;
    if (nextNo == null) throw new Error('Could not fetch next STS number.');
    return `STS-${String(nextNo).padStart(6, '0')}`;
  }

  /* ============================================================
     CREATE
     ============================================================ */

  static async createSTS(data) {
    await poolConnect;

    const {
      from_warehouse_id,
      to_warehouse_id,
      transfer_date,
      po_no = null,
      remarks = null,
      submitted_by,
      lines = [],
    } = data;

    if (!Array.isArray(lines) || lines.length === 0) {
      throw new Error('At least one line is required to create an STS.');
    }

    // ---- PER-ITEM GUARD ----
    // Only items that already have a PENDING STS on this PO are blocked.
    // The rest pass through, so each item can be transferred independently.
    let finalLines = lines;
    const skippedItems = [];

    if (po_no) {
      const pendingItemCodes = await StockTransferModel.getPendingItemCodesForPO(po_no);

      if (pendingItemCodes.size > 0) {
        finalLines = [];
        for (const line of lines) {
          if (pendingItemCodes.has(line.item_code)) {
            skippedItems.push(line.item_code);
          } else {
            finalLines.push(line);
          }
        }

        if (finalLines.length === 0) {
          const err = new Error(
            `All selected items on PO "${po_no}" already have a stock transfer awaiting Department Head approval.`
          );
          err.code = 'PO_HAS_ACTIVE_STS';
          err.blockedItems = skippedItems;
          throw err;
        }
      }
    }

    const sts_no = await StockTransferModel.getNextStsNo();

    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    try {
      const headerReq = new sql.Request(transaction);
      headerReq.input('sts_no',            sql.VarChar(20),   sts_no);
      headerReq.input('from_warehouse_id', sql.Int,           from_warehouse_id);
      headerReq.input('to_warehouse_id',   sql.Int,           to_warehouse_id);
      headerReq.input('transfer_date',     sql.Date,          transfer_date);
      headerReq.input('po_no',             sql.VarChar(50),   po_no);
      headerReq.input('status',            sql.VarChar(20),   'Pending');
      headerReq.input('remarks',           sql.NVarChar(500), remarks);
      headerReq.input('submitted_by',      sql.NVarChar(100), submitted_by);

      const headerResult = await headerReq.query(`
        INSERT INTO stock_transfer_slips
          (sts_no, from_warehouse_id, to_warehouse_id, transfer_date,
           po_no, status, remarks, submitted_by, submitted_at)
        VALUES
          (@sts_no, @from_warehouse_id, @to_warehouse_id, @transfer_date,
           @po_no, @status, @remarks, @submitted_by, GETDATE());

        SELECT SCOPE_IDENTITY() AS sts_id;
      `);

      const sts_id = headerResult.recordset[0]?.sts_id;
      if (!sts_id) throw new Error('Failed to insert STS header.');

      let lineNo = 0;
      for (const line of finalLines) {
        lineNo += 1;

        const lineReq = new sql.Request(transaction);
        lineReq.input('sts_id',     sql.BigInt,        sts_id);
        lineReq.input('line_no',    sql.Int,           lineNo);
        lineReq.input('item_code',  sql.NVarChar(50),  line.item_code);
        lineReq.input('item_name',  sql.NVarChar(400), line.item_name || null);
        lineReq.input('uom',        sql.NVarChar(50),  line.uom || null);
        lineReq.input('qty',        sql.Decimal(18,4), Number(line.qty) || 0);
        lineReq.input('unit_price', sql.Decimal(18,6),
                      line.unit_price == null || line.unit_price === ''
                        ? null
                        : Number(line.unit_price));
        lineReq.input('currency',   sql.NVarChar(3),   line.currency || null);
        lineReq.input('remarks',    sql.NVarChar(300), line.remarks || null);

        await lineReq.query(`
          INSERT INTO stock_transfer_slip_lines
            (sts_id, line_no, item_code, item_name, uom,
             qty, unit_price, currency, remarks)
          VALUES
            (@sts_id, @line_no, @item_code, @item_name, @uom,
             @qty, @unit_price, @currency, @remarks)
        `);
      }

      await transaction.commit();

      if (po_no) {
        await StockTransferModel.syncPOTransferStatus(po_no);
      }

      return {
        sts_id,
        sts_no,
        skippedItems,
        createdLineCount: finalLines.length,
      };

    } catch (err) {
      try { await transaction.rollback(); } catch { /* ignore */ }
      throw err;
    }
  }

  /* ============================================================
     READ
     ============================================================ */

  static async listSTSs({
    status,
    from_warehouse_id,
    to_warehouse_id,
    search,
    start_date,
    end_date,
    submitted_by,
    approved_by,
    limit = 500,
  } = {}) {
    await poolConnect;
    const request = pool.request();
    const conditions = [];

    if (status && status !== 'All') {
      request.input('status', sql.VarChar(20), status);
      conditions.push('s.status = @status');
    }
    if (from_warehouse_id) {
      request.input('from_warehouse_id', sql.Int, Number(from_warehouse_id));
      conditions.push('s.from_warehouse_id = @from_warehouse_id');
    }
    if (to_warehouse_id) {
      request.input('to_warehouse_id', sql.Int, Number(to_warehouse_id));
      conditions.push('s.to_warehouse_id = @to_warehouse_id');
    }
    if (search && String(search).trim()) {
      request.input('search', sql.NVarChar(100), `%${String(search).trim()}%`);
      conditions.push('(s.sts_no LIKE @search OR s.po_no LIKE @search)');
    }
    if (start_date) {
      request.input('start_date', sql.Date, start_date);
      conditions.push('s.transfer_date >= @start_date');
    }
    if (end_date) {
      request.input('end_date', sql.Date, end_date);
      conditions.push('s.transfer_date <= @end_date');
    }
    if (submitted_by) {
      request.input('submitted_by', sql.NVarChar(100), submitted_by);
      conditions.push('s.submitted_by = @submitted_by');
    }
    if (approved_by) {
      request.input('approved_by', sql.NVarChar(100), approved_by);
      conditions.push('s.approved_by = @approved_by');
    }

    request.input('limit', sql.Int, Number(limit) || 500);

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await request.query(`
      SELECT TOP (@limit)
             s.sts_id,
             s.sts_no,
             s.from_warehouse_id,
             s.to_warehouse_id,
             s.transfer_date,
             s.po_no,
             s.status,
             s.remarks,
             s.rejection_reason,
             s.submitted_by,
             s.submitted_at,
             s.approved_by,
             s.approved_at,
             s.rejected_by,
             s.rejected_at,
             s.completed_by,
             s.completed_at,
             s.received_by,
             s.received_at,
             s.receive_remarks,
             s.created_at,
             s.updated_at,
             fw.warehouse_code AS from_warehouse_code,
             fw.warehouse_name AS from_warehouse_name,
             tw.warehouse_code AS to_warehouse_code,
             tw.warehouse_name AS to_warehouse_name,
             (SELECT COUNT(*) FROM stock_transfer_slip_lines l
               WHERE l.sts_id = s.sts_id) AS line_count,
             (SELECT ISNULL(SUM(l.qty), 0) FROM stock_transfer_slip_lines l
               WHERE l.sts_id = s.sts_id) AS total_qty
        FROM stock_transfer_slips s
        LEFT JOIN warehouse_table fw ON fw.warehouse_id = s.from_warehouse_id
        LEFT JOIN warehouse_table tw ON tw.warehouse_id = s.to_warehouse_id
        ${where}
       ORDER BY s.submitted_at DESC
    `);

    return result.recordset;
  }

  static async listIncoming({
    to_warehouse_id,
    status,
    search,
    limit = 500,
  } = {}) {
    await poolConnect;
    const request = pool.request();
    const conditions = [];

    if (to_warehouse_id) {
      request.input('to_warehouse_id', sql.Int, Number(to_warehouse_id));
      conditions.push('s.to_warehouse_id = @to_warehouse_id');
    }

    if (status === 'All') {
      conditions.push("s.status IN ('Approved', 'Received')");
    } else if (status) {
      request.input('status', sql.VarChar(20), status);
      conditions.push('s.status = @status');
    } else {
      conditions.push("s.status = 'Approved'");
    }

    if (search && String(search).trim()) {
      request.input('search', sql.NVarChar(100), `%${String(search).trim()}%`);
      conditions.push('(s.sts_no LIKE @search OR s.po_no LIKE @search)');
    }

    request.input('limit', sql.Int, Number(limit) || 500);

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await request.query(`
      SELECT TOP (@limit)
             s.sts_id,
             s.sts_no,
             s.from_warehouse_id,
             s.to_warehouse_id,
             s.transfer_date,
             s.po_no,
             s.status,
             s.remarks,
             s.submitted_by,
             s.submitted_at,
             s.approved_by,
             s.approved_at,
             s.received_by,
             s.received_at,
             s.receive_remarks,
             fw.warehouse_code AS from_warehouse_code,
             fw.warehouse_name AS from_warehouse_name,
             tw.warehouse_code AS to_warehouse_code,
             tw.warehouse_name AS to_warehouse_name,
             (SELECT COUNT(*) FROM stock_transfer_slip_lines l
               WHERE l.sts_id = s.sts_id) AS line_count,
             (SELECT ISNULL(SUM(l.qty), 0) FROM stock_transfer_slip_lines l
               WHERE l.sts_id = s.sts_id) AS total_qty
        FROM stock_transfer_slips s
        LEFT JOIN warehouse_table fw ON fw.warehouse_id = s.from_warehouse_id
        LEFT JOIN warehouse_table tw ON tw.warehouse_id = s.to_warehouse_id
        ${where}
       ORDER BY s.approved_at DESC, s.submitted_at DESC
    `);

    return result.recordset;
  }

  static async getIncomingCounts({ to_warehouse_id } = {}) {
    await poolConnect;
    if (!to_warehouse_id) {
      return { approved: 0, received: 0, total: 0 };
    }

    const request = pool.request();
    request.input('to_warehouse_id', sql.Int, Number(to_warehouse_id));

    const result = await request.query(`
      SELECT
        SUM(CASE WHEN status = 'Approved' THEN 1 ELSE 0 END) AS approved,
        SUM(CASE WHEN status = 'Received' THEN 1 ELSE 0 END) AS received,
        COUNT(*) AS total
        FROM stock_transfer_slips
       WHERE to_warehouse_id = @to_warehouse_id
         AND status IN ('Approved', 'Received')
    `);

    return result.recordset[0] || { approved: 0, received: 0, total: 0 };
  }

  static async getSTSById(stsId) {
    await poolConnect;
    const request = pool.request();
    request.input('sts_id', sql.BigInt, stsId);

    const result = await request.query(`
      SELECT s.*,
             fw.warehouse_code AS from_warehouse_code,
             fw.warehouse_name AS from_warehouse_name,
             tw.warehouse_code AS to_warehouse_code,
             tw.warehouse_name AS to_warehouse_name
        FROM stock_transfer_slips s
        LEFT JOIN warehouse_table fw ON fw.warehouse_id = s.from_warehouse_id
        LEFT JOIN warehouse_table tw ON tw.warehouse_id = s.to_warehouse_id
       WHERE s.sts_id = @sts_id
    `);

    return result.recordset[0] || null;
  }

  static async getSTSLines(stsId) {
    await poolConnect;
    const request = pool.request();
    request.input('sts_id', sql.BigInt, stsId);

    const result = await request.query(`
      SELECT sts_line_id, sts_id, line_no,
             item_code, item_name, uom,
             qty, unit_price, currency, remarks, created_at
        FROM stock_transfer_slip_lines
       WHERE sts_id = @sts_id
       ORDER BY line_no
    `);

    return result.recordset;
  }

  static async getSTSDetail(stsId) {
    const header = await StockTransferModel.getSTSById(stsId);
    if (!header) return null;
    const lines = await StockTransferModel.getSTSLines(stsId);
    return { ...header, lines };
  }

  /* ============================================================
     PER-ITEM PO LOCK HELPERS
     ============================================================ */

  /**
   * Return the set of item_codes on a PO that currently have a
   * PENDING STS. Empty set ⇒ no items are blocked.
   */
  static async getPendingItemCodesForPO(poNo, excludeStsId = null) {
    await poolConnect;
    if (!poNo) return new Set();

    const request = pool.request();
    request.input('po_no', sql.VarChar(50), poNo);

    let sqlText = `
      SELECT DISTINCT l.item_code
        FROM stock_transfer_slip_lines l
        INNER JOIN stock_transfer_slips s ON s.sts_id = l.sts_id
       WHERE s.po_no = @po_no
         AND s.status = 'Pending'
    `;
    if (excludeStsId != null) {
      request.input('exclude_sts_id', sql.BigInt, excludeStsId);
      sqlText += ' AND s.sts_id <> @exclude_sts_id';
    }

    const result = await request.query(sqlText);
    return new Set(result.recordset.map((r) => r.item_code));
  }

  /**
   * Convenience wrapper: does the PO have any pending STS?
   */
  static async hasActiveSTSForPO(poNo, excludeStsId = null) {
    const codes = await StockTransferModel.getPendingItemCodesForPO(poNo, excludeStsId);
    return codes.size > 0;
  }

  /**
   * Recompute the import_po status for the given PO — PER ITEM.
   *
   * Two steps:
   *   1) Lock ONLY items that have a PENDING STS → 'Pending Transfer'
   *   2) Recompute the status of every OTHER actionable line
   *      (including ones whose pending STS was just cleared)
   *
   * Called after every STS state change that can affect the PO:
   *   createSTS, approveSTS, rejectSTS, cancelSTS, completeSTS.
   */
  static async syncPOTransferStatus(poNo) {
    await poolConnect;
    if (!poNo) return;

    const pendingItemCodes = await StockTransferModel.getPendingItemCodesForPO(poNo);

    // ---- STEP 1: lock items that are on a pending STS ----
    if (pendingItemCodes.size > 0) {
      const lockReq = pool.request();
      lockReq.input('po_no', sql.VarChar(50), poNo);

      const lockPlaceholders = [];
      let lockIdx = 0;
      for (const code of pendingItemCodes) {
        const pName = `lockItem${lockIdx++}`;
        lockReq.input(pName, sql.NVarChar(50), code);
        lockPlaceholders.push(`@${pName}`);
      }

      await lockReq.query(`
        UPDATE import_po
           SET status = 'Pending Transfer'
         WHERE po_no = @po_no
           AND status IN ('With Handler', 'Partial With Handler')
           AND item_code IN (${lockPlaceholders.join(',')})
      `);
    }

    // ---- STEP 2: recompute every line NOT currently pending ----
    const req = pool.request();
    req.input('po_no', sql.VarChar(50), poNo);

    let excludeClause = '';
    if (pendingItemCodes.size > 0) {
      const excludePlaceholders = [];
      let excludeIdx = 0;
      for (const code of pendingItemCodes) {
        const pName = `excludeItem${excludeIdx++}`;
        req.input(pName, sql.NVarChar(50), code);
        excludePlaceholders.push(`@${pName}`);
      }
      excludeClause = `AND p.item_code NOT IN (${excludePlaceholders.join(',')})`;
    }

    await req.query(`
      UPDATE p
         SET p.status = CASE
               WHEN (p.received_qty + p.damaged_qty) >= p.qty
                    AND p.received_qty > 0
                    AND ISNULL(t.moved_qty, 0) >= p.received_qty
                 THEN 'Transferred'
               WHEN (p.received_qty + p.damaged_qty) >= p.qty
                 THEN 'With Handler'
               ELSE 'Partial With Handler'
             END
        FROM import_po p
        OUTER APPLY (
          SELECT ISNULL(SUM(l.qty), 0) AS moved_qty
            FROM stock_transfer_slip_lines l
            INNER JOIN stock_transfer_slips s ON s.sts_id = l.sts_id
           WHERE s.po_no = p.po_no
             AND l.item_code = p.item_code
             AND s.status IN ('Approved', 'Completed', 'Received')
        ) AS t
       WHERE p.po_no = @po_no
         AND p.status IN ('With Handler', 'Partial With Handler', 'Pending Transfer')
         ${excludeClause}
    `);
  }

  /* ============================================================
     Transferred quantity lookup
     ============================================================ */

  static async getTransferredQtyForPO(poNo) {
    await poolConnect;
    const map = {};
    if (!poNo) return map;

    const request = pool.request();
    request.input('po_no', sql.VarChar(50), poNo);

    const result = await request.query(`
      SELECT l.item_code,
             ISNULL(SUM(l.qty), 0) AS total_transferred
        FROM stock_transfer_slip_lines l
        INNER JOIN stock_transfer_slips s ON s.sts_id = l.sts_id
       WHERE s.po_no = @po_no
         AND s.status IN ('Approved', 'Completed', 'Received')
       GROUP BY l.item_code
    `);

    for (const row of result.recordset) {
      map[row.item_code] = Number(row.total_transferred) || 0;
    }
    return map;
  }

  /* ============================================================
     STATUS TRANSITIONS
     ============================================================ */

  static async approveSTS(stsId, username) {
    await poolConnect;

    const header = await StockTransferModel.getSTSById(stsId);
    if (!header) return 0;

    const request = pool.request();
    request.input('sts_id',      sql.BigInt,       stsId);
    request.input('approved_by', sql.NVarChar(100), username || 'System');

    const result = await request.query(`
      UPDATE stock_transfer_slips
         SET status      = 'Approved',
             approved_by = @approved_by,
             approved_at = GETDATE()
       WHERE sts_id = @sts_id
         AND status = 'Pending'
    `);

    const affected = result.rowsAffected[0] || 0;

    if (affected > 0 && header.po_no) {
      await StockTransferModel.syncPOTransferStatus(header.po_no);
    }

    return affected;
  }

  static async rejectSTS(stsId, username, reason) {
    await poolConnect;

    const header = await StockTransferModel.getSTSById(stsId);
    if (!header) return 0;

    const request = pool.request();
    request.input('sts_id',           sql.BigInt,        stsId);
    request.input('rejected_by',      sql.NVarChar(100), username || 'System');
    request.input('rejection_reason', sql.NVarChar(500), reason || null);

    const result = await request.query(`
      UPDATE stock_transfer_slips
         SET status           = 'Rejected',
             rejected_by      = @rejected_by,
             rejected_at      = GETDATE(),
             rejection_reason = @rejection_reason
       WHERE sts_id = @sts_id
         AND status = 'Pending'
    `);

    const affected = result.rowsAffected[0] || 0;

    if (affected > 0 && header.po_no) {
      await StockTransferModel.syncPOTransferStatus(header.po_no);
    }

    return affected;
  }

  static async cancelSTS(stsId, username) {
    await poolConnect;

    const header = await StockTransferModel.getSTSById(stsId);
    if (!header) return 0;

    const request = pool.request();
    request.input('sts_id',       sql.BigInt,        stsId);
    request.input('submitted_by', sql.NVarChar(100), username);

    const result = await request.query(`
      UPDATE stock_transfer_slips
         SET status = 'Cancelled'
       WHERE sts_id = @sts_id
         AND status = 'Pending'
         AND submitted_by = @submitted_by
    `);

    const affected = result.rowsAffected[0] || 0;

    if (affected > 0 && header.po_no) {
      await StockTransferModel.syncPOTransferStatus(header.po_no);
    }

    return affected;
  }

  static async completeSTS(stsId, username) {
    await poolConnect;

    const stsReq = pool.request();
    stsReq.input('sts_id',       sql.BigInt,        stsId);
    stsReq.input('completed_by', sql.NVarChar(100), username || 'System');

    const stsResult = await stsReq.query(`
      UPDATE stock_transfer_slips
         SET status       = 'Completed',
             completed_by = @completed_by,
             completed_at = GETDATE()
       WHERE sts_id = @sts_id
         AND status = 'Approved'
    `);

    const affected = stsResult.rowsAffected[0] || 0;
    if (affected === 0) return 0;

    const header = await StockTransferModel.getSTSById(stsId);
    if (header?.po_no) {
      await StockTransferModel.syncPOTransferStatus(header.po_no);
    }

    return affected;
  }

  /* ============================================================
     RECEIVE — target warehouse registrar confirms arrival
     ============================================================ */

  static async receiveSTS(stsId, username, remarks) {
    await poolConnect;

    const request = pool.request();
    request.input('sts_id',          sql.BigInt,        stsId);
    request.input('received_by',     sql.NVarChar(100), username || 'System');
    request.input('receive_remarks', sql.NVarChar(500), remarks || null);

    const result = await request.query(`
      UPDATE stock_transfer_slips
         SET status          = 'Received',
             received_by     = @received_by,
             received_at     = GETDATE(),
             receive_remarks = @receive_remarks
       WHERE sts_id = @sts_id
         AND status = 'Approved'
    `);

    return result.rowsAffected[0] || 0;
  }

  /* ============================================================
     DASHBOARD COUNTS
     ============================================================ */

  static async getSummaryCounts({ submitted_by, warehouse_id } = {}) {
    await poolConnect;
    const request = pool.request();
    const conditions = [];

    if (submitted_by) {
      request.input('submitted_by', sql.NVarChar(100), submitted_by);
      conditions.push('submitted_by = @submitted_by');
    }
    if (warehouse_id) {
      request.input('warehouse_id', sql.Int, Number(warehouse_id));
      conditions.push('(from_warehouse_id = @warehouse_id OR to_warehouse_id = @warehouse_id)');
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await request.query(`
      SELECT
        SUM(CASE WHEN status = 'Pending'   THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN status = 'Approved'  THEN 1 ELSE 0 END) AS approved,
        SUM(CASE WHEN status = 'Rejected'  THEN 1 ELSE 0 END) AS rejected,
        SUM(CASE WHEN status = 'Completed' THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN status = 'Cancelled' THEN 1 ELSE 0 END) AS cancelled,
        SUM(CASE WHEN status = 'Received'  THEN 1 ELSE 0 END) AS received,
        COUNT(*) AS total
      FROM stock_transfer_slips
      ${where}
    `);

    return result.recordset[0] || {
      pending: 0, approved: 0, rejected: 0,
      completed: 0, cancelled: 0, received: 0, total: 0,
    };
  }
}

module.exports = StockTransferModel;