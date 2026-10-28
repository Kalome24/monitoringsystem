// services/peerCommandHandlers.js
//
// Session 16b — peer-side command dispatcher.
//
// The surface enqueues commands for a peer. The peer's next heartbeat
// receives them in the response body, then calls dispatch() for each.
// The result is reported back via surfaceSyncClient.postPeerCommandResult.
//
// Currently supported commands:
//   • pull_shift        — surface asks "push me the payload for shift N"
//   • pull_all_pending  — surface asks "push me every Closed-but-unreconciled
//                         shift you have" (added Session 16b, for the
//                         surface UI's single-click "Pull" flow)
//   • mark_reconciled   — surface says "I already applied N, mark it done"
//   • noop              — ping / echo, useful for connectivity tests
//
'use strict';

const surfaceSyncClient = require('./surfaceSyncClient');
const UndergroundModel  = require('../models/underground/undergroundModel');
const { query }         = require('../db');

/**
 * Build the outbound body for pushShiftPayload from a local shift + lines.
 */
const buildPushBody = (shift, releaseLines) => ({
  sync_token:       shift.sync_token,
  source_shift_id:  shift.shift_id,
  source_server:    process.env.IMS_SERVER_ID || null,
  warehouse_code:   shift.warehouse_code,
  handler_username: shift.handler_username,
  handler_position: shift.handler_position,
  closed_at:        shift.ended_at,
  totals: {
    beginning_qty:       Number(shift.beginning_qty  || 0),
    beginning_value:     Number(shift.beginning_value || 0),
    released_qty:        Number(shift.released_qty   || 0),
    released_value:      Number(shift.released_value || 0),
    ending_qty:          Number(shift.ending_qty     || 0),
    ending_value:        Number(shift.ending_value   || 0),
    release_line_count:  Number(shift.release_line_count || 0),
  },
  release_lines: releaseLines.map((l) => ({
    locator_code:   l.locator_code,
    locator_name:   l.locator_name,
    item_code:      l.item_code,
    item_name:      l.item_name,
    uom:            l.uom,
    barcode:        l.barcode,
    category:       l.category,
    purchase_class: l.purchase_class,
    gl_class:       l.gl_class,
    qty:            Number(l.qty),
    unit_cost:      Number(l.unit_cost  || 0),
    line_total:     Number(l.line_total || 0),
    destination:    l.destination,
    remarks:        l.remarks,
  })),
});

/* ============================================================
   HANDLERS
   ============================================================ */

const handlePullShift = async (payload) => {
  const shift_id = Number(payload?.shift_id);
  if (!Number.isFinite(shift_id) || shift_id <= 0) {
    return { ok: false, code: 'BAD_PAYLOAD', message: 'pull_shift requires a numeric shift_id.' };
  }

  const p = await UndergroundModel.getShiftPayloadForPush(shift_id);
  if (!p || !p.shift) {
    return { ok: false, code: 'SHIFT_NOT_FOUND', message: `Shift ${shift_id} not found on this peer.` };
  }
  if (!p.release_lines.length) {
    return { ok: false, code: 'NO_RELEASE_LINES', message: `Shift ${shift_id} has no release lines.` };
  }

  let push;
  try {
    push = await surfaceSyncClient.pushShiftPayload(buildPushBody(p.shift, p.release_lines));
  } catch (err) {
    return { ok: false, code: err.code || 'PUSH_NETWORK_ERROR', message: err.message || 'Push failed.' };
  }

  if (!push.ok && push.code !== 'ALREADY_SYNCED') {
    return {
      ok:      false,
      code:    push.code || 'PUSH_FAILED',
      message: push.message || 'Surface rejected the push.',
    };
  }

  try {
    await UndergroundModel.markShiftReconciledLocally({
      shift_id,
      sync_token: p.shift.sync_token || null,
      reconciled_by_username: 'surface-requested-pull',
    });
  } catch (err) {
    console.warn('⚠️  pull_shift: local mark-reconciled failed —', err.message || err);
  }

  return {
    ok:      true,
    code:    push.ok ? 'DONE' : 'ALREADY_SYNCED',
    data: {
      shift_id,
      already_synced: !!(!push.ok && push.code === 'ALREADY_SYNCED'),
      remote_export_id:  push.data?.export_id  || null,
      remote_export_uid: push.data?.export_uid || null,
      reconciled_lines:  push.data?.reconciled_lines || 0,
    },
  };
};

/**
 * Session 16b — pull every pending shift on this peer, sequentially.
 *
 * The surface calls this when it wants to pull a whole batch at once
 * (single "Pull" button on the peer card). We iterate the local
 * Closed-but-unreconciled shifts, push each one, and aggregate the
 * outcome. Failures do not abort the batch; they are reported.
 */
const handlePullAllPending = async (payload) => {
  const limit = Math.min(Math.max(parseInt(payload?.limit, 10) || 100, 1), 200);

  const rows = await query(
    `SELECT TOP (@param0) shift_id, sync_token
       FROM dbo.underground_shift
      WHERE status = 'Closed'
        AND reconciled_at IS NULL
      ORDER BY shift_id ASC`,
    [limit]
  );

  if (rows.length === 0) {
    return {
      ok: true,
      code: 'NO_PENDING',
      message: 'No pending shifts to pull.',
      data: { pulled: 0, failed: 0, shifts: [], failures: [] },
    };
  }

  const pulled   = [];
  const failures = [];

  for (const row of rows) {
    // Sequential on purpose: keeps the surface's apply order deterministic
    // and avoids hammering it with concurrent HTTP requests.
    let result;
    try {
      result = await handlePullShift({ shift_id: row.shift_id });
    } catch (err) {
      result = { ok: false, code: 'HANDLER_THREW', message: err.message || 'Handler threw.' };
    }

    if (result.ok) {
      pulled.push({
        shift_id:          row.shift_id,
        code:              result.code,
        remote_export_uid: result.data?.remote_export_uid || null,
        reconciled_lines:  result.data?.reconciled_lines  || 0,
      });
    } else {
      failures.push({
        shift_id: row.shift_id,
        code:     result.code || 'FAILED',
        message:  result.message || null,
      });
    }
  }

  return {
    ok:      failures.length === 0,
    code:    failures.length === 0 ? 'DONE' : 'PARTIAL',
    message: `Pulled ${pulled.length} shift(s) · ${failures.length} failed.`,
    data: {
      pulled:   pulled.length,
      failed:   failures.length,
      shifts:   pulled,
      failures,
    },
  };
};

const handleMarkReconciled = async (payload) => {
  const shift_id = Number(payload?.shift_id);
  if (!Number.isFinite(shift_id) || shift_id <= 0) {
    return { ok: false, code: 'BAD_PAYLOAD', message: 'mark_reconciled requires a numeric shift_id.' };
  }

  try {
    await UndergroundModel.markShiftReconciledLocally({
      shift_id,
      sync_token: payload?.sync_token || null,
      reconciled_by_username: payload?.by || 'surface-requested',
    });
  } catch (err) {
    return { ok: false, code: 'MARK_FAILED', message: err.message || 'Failed to mark locally.' };
  }
  return { ok: true, code: 'DONE', data: { shift_id } };
};

const handleNoop = async (payload) => {
  return { ok: true, code: 'DONE', data: { echo: payload || null } };
};

/* ============================================================
   DISPATCH
   ============================================================ */

/**
 * Dispatch one command. Returns:
 *   { ok:boolean, code:string, message?:string, data?:object }
 */
const dispatch = async (command) => {
  const commandId = command?.command_id;
  const kind      = String(command?.kind || '').trim();
  const payload   = command?.payload || null;

  if (!commandId) {
    return { ok: false, code: 'BAD_COMMAND', message: 'Command has no command_id.' };
  }

  try {
    switch (kind) {
      case 'pull_shift':       return await handlePullShift(payload);
      case 'pull_all_pending': return await handlePullAllPending(payload);
      case 'mark_reconciled':  return await handleMarkReconciled(payload);
      case 'noop':             return await handleNoop(payload);
      default:
        return { ok: false, code: 'UNKNOWN_KIND', message: `Unknown command kind: ${kind}` };
    }
  } catch (err) {
    console.error(`❌ peerCommandHandlers.dispatch(${kind}):`, err);
    return { ok: false, code: 'HANDLER_THREW', message: err.message || 'Handler threw.' };
  }
};

module.exports = {
  dispatch,
  handlePullShift,
  handlePullAllPending,
  handleMarkReconciled,
  handleNoop,
};