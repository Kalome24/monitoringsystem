// services/peerHeartbeat.js
//
// Session 16 — underground-side heartbeat sender.
//
// Every HEARTBEAT_INTERVAL_MS, POST to the surface's /api/underground/peer-heartbeat
// with this server's identity + live state. The surface's peer registry uses
// this to answer "is UG-SRV-01 online right now?".
//
// Session 16b — heartbeat response now carries pending commands. Each
// command is dispatched via peerCommandHandlers, and the result is POSTed
// back to /api/underground/peer-command-result.
//
// Design rules:
//   • Fire-and-forget: a failed heartbeat is retried next tick. Never blocks.
//   • Bounded concurrency: only one in-flight heartbeat at a time.
//   • Only runs when SURFACE_BASE_URL + SURFACE_SYNC_KEY are configured.
//     On a surface server, this service starts, sees config is empty, and
//     silently no-ops.
//   • Safe to call start() twice — second call is a no-op.
//
'use strict';

const surfaceSyncClient  = require('./surfaceSyncClient');
const peerCommandHandlers = require('./peerCommandHandlers');
const { query }          = require('../db');

const HEARTBEAT_INTERVAL_MS = 30000;
const DEFAULT_SERVER_ID     = 'UG-SRV-UNNAMED';
const DEFAULT_LISTEN_PORT   = 5001;

let timer      = null;
let running    = false;
let inFlight   = false;
let lastResult = null;   // { ok, at, status, message, commands_dispatched }

const getServerId = () => {
  return String(process.env.IMS_SERVER_ID || '').trim() || DEFAULT_SERVER_ID;
};

const getWarehouseCode = () => {
  return String(process.env.IMS_WAREHOUSE_CODE || '').trim().toUpperCase() || null;
};

const getDisplayName = () => {
  return String(process.env.IMS_DISPLAY_NAME || '').trim() || null;
};

const getListenPort = () => {
  const p = parseInt(process.env.PORT, 10);
  return Number.isFinite(p) && p > 0 ? p : DEFAULT_LISTEN_PORT;
};

/**
 * Gather the state we want to broadcast.
 * Must never throw — a heartbeat with missing data still beats.
 */
const gatherState = async () => {
  const whCode = getWarehouseCode();
  const state = {
    pending_count:       0,
    has_open_shift:      false,
    active_shift_id:     null,
    active_warehouse_id: null,
  };

  try {
    if (whCode) {
      const pendingRows = await query(
        `SELECT COUNT(*) AS c
           FROM dbo.underground_shift
          WHERE status = 'Closed'
            AND reconciled_at IS NULL`
      );
      state.pending_count = Number(pendingRows[0]?.c) || 0;

      const openRows = await query(
        `SELECT TOP 1 shift_id, warehouse_id
           FROM dbo.underground_shift
          WHERE status = 'Open'
          ORDER BY shift_id DESC`
      );
      if (openRows[0]) {
        state.has_open_shift      = true;
        state.active_shift_id     = openRows[0].shift_id;
        state.active_warehouse_id = openRows[0].warehouse_id;
      }
    }
  } catch (err) {
    // DB unavailable — send a minimal heartbeat anyway so the surface
    // knows this peer exists.
    console.warn('⚠️  peerHeartbeat: state gather failed —', err.message || err);
  }
  return state;
};

/**
 * Execute any commands returned by the surface, and report each result.
 * Fire-and-forget per command; never blocks the next heartbeat.
 */
const runCommands = async (commands) => {
  if (!Array.isArray(commands) || commands.length === 0) return 0;

  let dispatched = 0;

  for (const cmd of commands) {
    dispatched += 1;
    // Execute sequentially to keep the peer's push behaviour predictable
    // under heavy backlogs (no concurrent pushes to the same surface).
    // A single slow command cannot stall the whole queue for long, since
    // each command's network call has its own timeout.
    let result;
    try {
      result = await peerCommandHandlers.dispatch(cmd);
    } catch (err) {
      result = { ok: false, code: 'DISPATCH_THREW', message: err.message || 'Dispatch threw.' };
    }

    // Report back to the surface. Fire-and-forget at this level — a
    // failed report just means the surface re-dispatches later.
    surfaceSyncClient.postPeerCommandResult({
      command_id: cmd.command_id,
      status:     result.ok ? 'done' : 'failed',
      code:       result.code || null,
      message:    result.message || null,
      data:       result.data || null,
    }).catch((err) => {
      console.warn(`⚠️  peerHeartbeat: report for command ${cmd.command_id} failed —`, err.message || err);
    });
  }

  return dispatched;
};

/**
 * Post one heartbeat.
 */
const sendOnce = async () => {
  if (inFlight) return lastResult;
  inFlight = true;
  try {
    const state = await gatherState();

    const body = {
      server_id:           getServerId(),
      display_name:        getDisplayName(),
      warehouse_code:      getWarehouseCode(),
      device_hostname:     (() => { try { return require('os').hostname(); } catch { return null; } })(),
      version:             '1.0.0',
      listen_port:         getListenPort(),
      pending_count:       state.pending_count,
      has_open_shift:      state.has_open_shift,
      active_shift_id:     state.active_shift_id,
      active_warehouse_id: state.active_warehouse_id,
    };

    if (!body.warehouse_code) {
      // Without a warehouse code we're unidentifiable. Log once, skip.
      lastResult = { ok: false, at: new Date().toISOString(), code: 'NO_WAREHOUSE_CODE',
                     message: 'IMS_WAREHOUSE_CODE is not set — heartbeat skipped.' };
      return lastResult;
    }

    const r = await surfaceSyncClient.postPeerHeartbeat(body);
    lastResult = {
      ok:                 !!r.ok,
      at:                 new Date().toISOString(),
      status:             r.status,
      message:            r.message,
      commands_dispatched:0,
    };

    if (!r.ok) {
      console.warn(`⚠️  peerHeartbeat: surface rejected (${r.code || r.status || 'ERR'}) — ${r.message || ''}`);
      return lastResult;
    }

    // Session 16b — pick up and execute any pending commands.
    const commands = Array.isArray(r.data?.commands) ? r.data.commands : [];
    if (commands.length) {
      const n = await runCommands(commands);
      lastResult.commands_dispatched = n;
      console.log(`📨 peerHeartbeat: dispatched ${n} command(s) from surface.`);
    }

    return lastResult;
  } catch (err) {
    lastResult = { ok: false, at: new Date().toISOString(), code: err.code || 'NETWORK_ERROR',
                   message: err.message || 'Heartbeat failed' };
    return lastResult;
  } finally {
    inFlight = false;
  }
};

const start = () => {
  if (running) return { started: false, reason: 'already_running' };

  if (!surfaceSyncClient.isRemoteSyncEnabled()) {
    console.log('ℹ️  peerHeartbeat: SURFACE_BASE_URL/SURFACE_SYNC_KEY not set — heartbeat disabled.');
    return { started: false, reason: 'not_configured' };
  }
  if (!getWarehouseCode()) {
    console.log('ℹ️  peerHeartbeat: IMS_WAREHOUSE_CODE not set — heartbeat disabled.');
    return { started: false, reason: 'no_warehouse_code' };
  }

  running = true;
  // Fire immediately, then on interval.
  sendOnce().catch(() => {});
  timer = setInterval(() => { sendOnce().catch(() => {}); }, HEARTBEAT_INTERVAL_MS);
  if (timer.unref) timer.unref();

  console.log(`💓 peerHeartbeat started · id=${getServerId()} · wh=${getWarehouseCode()} · port=${getListenPort()} · every ${HEARTBEAT_INTERVAL_MS / 1000}s`);
  return { started: true };
};

const stop = () => {
  if (timer) { clearInterval(timer); timer = null; }
  running = false;
  return { stopped: true };
};

const status = () => ({
  running,
  inFlight,
  lastResult,
  interval_ms: HEARTBEAT_INTERVAL_MS,
  server_id:   getServerId(),
  warehouse_code: getWarehouseCode(),
  listen_port: getListenPort(),
});

/**
 * Trigger an immediate heartbeat — used after a closeShift so the
 * surface's pending_count updates within a second, not up to 30.
 */
const pulse = () => sendOnce();

module.exports = { start, stop, status, pulse, sendOnce };