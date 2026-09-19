// models/poActivityLogModel.js
const { sql, pool, poolConnect } = require('../db');

/**
 * Append-only activity log for Purchase Orders.
 *
 * Every state-changing action on a PO writes one row here so we can
 * render a chronological timeline in the UI:
 *   Imported → Received → Forwarded → TransferSubmitted →
 *   TransferApproved / TransferRejected / TransferCancelled →
 *   TransferCompleted
 *
 * Logging must NEVER break the main business flow, so all errors are
 * swallowed and only console.warn'd.
 */
class PoActivityLogModel {
  static async log({
    po_no,
    event_type,
    event_summary = null,
    event_detail  = null,
    ref_sts_id    = null,
    actor         = null,
  } = {}) {
    if (!po_no || !event_type) return;
    try {
      await poolConnect;
      const request = pool.request();
      request.input('po_no',         sql.VarChar(50),       po_no);
      request.input('event_type',    sql.VarChar(50),       event_type);
      request.input('event_summary', sql.NVarChar(500),     event_summary);
      request.input('event_detail',  sql.NVarChar(sql.MAX), event_detail);
      request.input('ref_sts_id',    sql.BigInt,            ref_sts_id);
      request.input('actor',         sql.NVarChar(100),     actor);

      await request.query(`
        INSERT INTO po_activity_log
          (po_no, event_type, event_summary, event_detail, ref_sts_id, actor, acted_at)
        VALUES
          (@po_no, @event_type, @event_summary, @event_detail, @ref_sts_id, @actor, GETDATE())
      `);
    } catch (err) {
      console.warn('⚠️ po_activity_log write failed:', err.message);
    }
  }

  static async listByPO(poNo) {
    await poolConnect;
    const request = pool.request();
    request.input('po_no', sql.VarChar(50), poNo);

    const result = await request.query(`
      SELECT log_id, po_no, event_type, event_summary, event_detail,
             ref_sts_id, actor, acted_at
        FROM po_activity_log
       WHERE po_no = @po_no
       ORDER BY acted_at ASC, log_id ASC
    `);
    return result.recordset;
  }
}

module.exports = PoActivityLogModel;