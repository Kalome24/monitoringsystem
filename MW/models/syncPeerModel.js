// models/syncPeerModel.js
//
// Session 16 — Cross-DB peer registry.
//
// A "peer" is a standalone underground server (UG-SRV-01, LUMB-SRV-02, ...)
// that periodically heartbeats to this surface server. This model is the
// surface's view of every peer it has ever heard from.
//
// On underground servers, this model is imported but never called —
// they are the peers, not the registry.
//
// Session 16b — added the peer command channel:
//   Surface enqueues commands (e.g. "pull shift 5 from me") into
//   peer_commands. The peer's next heartbeat picks them up, executes,
//   and reports results back. This is how the surface initiates a pull
//   over WAN where the peer's IP is not directly reachable.
//
// Freshness contract:
//   online   — last heartbeat ≤ 90s ago
//   degraded — last heartbeat 90s–5min ago
//   offline  — last heartbeat > 5min ago
//
'use strict';

const { query } = require('../db');

const ONLINE_THRESHOLD_SEC   = 90;
const DEGRADED_THRESHOLD_SEC = 300;

const classifyStatus = (lastHeartbeatAt) => {
  if (!lastHeartbeatAt) return 'unknown';
  const ts   = new Date(lastHeartbeatAt).getTime();
  if (Number.isNaN(ts)) return 'unknown';
  const ageS = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (ageS <= ONLINE_THRESHOLD_SEC)   return 'online';
  if (ageS <= DEGRADED_THRESHOLD_SEC) return 'degraded';
  return 'offline';
};

const SyncPeerModel = {
  ONLINE_THRESHOLD_SEC,
  DEGRADED_THRESHOLD_SEC,
  classifyStatus,

  /* ============================================================
     PEER REGISTRY
     ============================================================ */

  /**
   * Upsert a peer from a heartbeat payload.
   * Idempotent — repeated heartbeats simply bump last_heartbeat_at.
   */
  upsertFromHeartbeat: async ({
    server_id,
    display_name        = null,
    warehouse_code,
    device_hostname     = null,
    version             = null,
    pending_count       = 0,
    has_open_shift      = false,
    active_shift_id     = null,
    active_warehouse_id = null,
    last_ip_address     = null,
    last_port           = null,
    last_user_agent     = null,
  }) => {
    if (!server_id)      throw new Error('server_id is required.');
    if (!warehouse_code) throw new Error('warehouse_code is required.');

    const safePort = Number.isFinite(Number(last_port)) && Number(last_port) > 0
      ? Number(last_port)
      : null;

    await query(
      `MERGE dbo.sync_peers AS target
       USING (SELECT @param0 AS server_id) AS source
          ON target.server_id = source.server_id
       WHEN MATCHED THEN
         UPDATE SET
           display_name        = COALESCE(@param1, target.display_name),
           warehouse_code      = @param2,
           device_hostname     = COALESCE(@param3, target.device_hostname),
           version             = COALESCE(@param4, target.version),
           last_heartbeat_at   = SYSUTCDATETIME(),
           pending_count       = @param5,
           has_open_shift      = @param6,
           active_shift_id     = @param7,
           active_warehouse_id = @param8,
           last_ip_address     = COALESCE(@param9,  target.last_ip_address),
           last_port           = COALESCE(@param10, target.last_port),
           last_user_agent     = COALESCE(@param11, target.last_user_agent)
       WHEN NOT MATCHED THEN
         INSERT (server_id, display_name, warehouse_code, device_hostname, version,
                 last_heartbeat_at, pending_count, has_open_shift,
                 active_shift_id, active_warehouse_id,
                 last_ip_address, last_port, last_user_agent)
         VALUES (@param0, @param1, @param2, @param3, @param4,
                 SYSUTCDATETIME(), @param5, @param6,
                 @param7, @param8,
                 @param9, @param10, @param11);`,
      [
        String(server_id).trim(),
        display_name,
        String(warehouse_code).trim().toUpperCase(),
        device_hostname,
        version,
        Math.max(0, parseInt(pending_count, 10) || 0),
        has_open_shift ? 1 : 0,
        active_shift_id,
        active_warehouse_id,
        last_ip_address,
        safePort,
        last_user_agent,
      ]
    );
  },

  /**
   * List every peer known to this surface, optionally scoped by warehouse.
   * Always sorted: online first, then most-recent heartbeat.
   */
  listPeers: async ({ warehouse_code = null } = {}) => {
    const params = [];
    let where = '';
    if (warehouse_code) {
      params.push(String(warehouse_code).trim().toUpperCase());
      where = `WHERE warehouse_code = @param${params.length - 1}`;
    }
    const rows = await query(
      `SELECT server_id, display_name, warehouse_code, device_hostname, version,
              last_heartbeat_at, last_synced_at, first_seen_at,
              pending_count, has_open_shift, active_shift_id, active_warehouse_id,
              last_ip_address, last_port, notes
         FROM dbo.sync_peers
         ${where}
         ORDER BY last_heartbeat_at DESC`,
      params
    );
    return rows.map((r) => ({
      ...r,
      status: SyncPeerModel.classifyStatus(r.last_heartbeat_at),
    }));
  },

  /**
   * Fetch a single peer by server_id. Returns null if unknown.
   */
  getPeer: async (server_id) => {
    if (!server_id) return null;
    const rows = await query(
      `SELECT server_id, display_name, warehouse_code, device_hostname, version,
              last_heartbeat_at, last_synced_at, first_seen_at,
              pending_count, has_open_shift, active_shift_id, active_warehouse_id,
              last_ip_address, last_port, notes
         FROM dbo.sync_peers
        WHERE server_id = @param0`,
      [String(server_id).trim()]
    );
    const r = rows[0] || null;
    if (!r) return null;
    return { ...r, status: SyncPeerModel.classifyStatus(r.last_heartbeat_at) };
  },

  /**
   * Called after a successful pull to bump last_synced_at.
   */
  markSynced: async (server_id) => {
    if (!server_id) return;
    await query(
      `UPDATE dbo.sync_peers
          SET last_synced_at = SYSUTCDATETIME()
        WHERE server_id = @param0`,
      [String(server_id).trim()]
    );
  },

  /**
   * Sweep very old peers (optional housekeeping).
   */
  deletePeer: async (server_id) => {
    if (!server_id) return;
    await query(
      `DELETE FROM dbo.sync_peers WHERE server_id = @param0`,
      [String(server_id).trim()]
    );
  },

  /* ============================================================
     COMMAND CHANNEL (Session 16b)
     ------------------------------------------------------------
     Commands flow surface → peer. The surface writes a row here,
     the peer's next heartbeat picks it up, executes, and reports
     back via /api/underground/peer-command-result.
     ============================================================ */

  /**
   * Enqueue a command for a peer.
   * Returns { command_id }.
   */
  enqueueCommand: async ({ server_id, kind, payload = null, created_by = null }) => {
    if (!server_id) throw new Error('server_id is required.');
    if (!kind)      throw new Error('kind is required.');

    const payloadJson = payload == null ? null : JSON.stringify(payload);

    const rows = await query(
      `INSERT INTO dbo.peer_commands
         (server_id, kind, payload_json, status, created_at, created_by)
       OUTPUT INSERTED.command_id
       VALUES (@param0, @param1, @param2, 'pending', SYSUTCDATETIME(), @param3);`,
      [String(server_id).trim(), String(kind).trim(), payloadJson, created_by]
    );
    return { command_id: rows[0]?.command_id || null };
  },

  /**
   * Pick up pending commands for a peer, atomically marking them
   * 'in_flight' so a second concurrent heartbeat doesn't double-dispatch.
   *
   * Re-dispatch rule: an 'in_flight' command older than 2 minutes is
   * retried. This covers the case where the peer crashed mid-execution.
   * Attempts are incremented each dispatch; callers can later expire
   * commands stuck past N attempts.
   */
  fetchPendingForPeer: async (server_id, { limit = 20 } = {}) => {
    if (!server_id) throw new Error('server_id is required.');
    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);

    const rows = await query(
      `DECLARE @ids TABLE (command_id BIGINT);

       INSERT INTO @ids (command_id)
       SELECT TOP (${safeLimit}) command_id
         FROM dbo.peer_commands
        WHERE server_id = @param0
          AND (
                status = 'pending'
             OR (status = 'in_flight'
                 AND dispatched_at IS NOT NULL
                 AND dispatched_at < DATEADD(MINUTE, -2, SYSUTCDATETIME()))
          )
        ORDER BY command_id ASC;

       UPDATE dbo.peer_commands
          SET status        = 'in_flight',
              dispatched_at = SYSUTCDATETIME(),
              attempts      = attempts + 1
        OUTPUT INSERTED.command_id,
               INSERTED.kind,
               INSERTED.payload_json,
               INSERTED.attempts,
               INSERTED.created_at
        WHERE command_id IN (SELECT command_id FROM @ids);`,
      [String(server_id).trim()]
    );

    return rows.map((r) => {
      let payload = null;
      try { payload = r.payload_json ? JSON.parse(r.payload_json) : null; } catch { /* leave null */ }
      return {
        command_id: r.command_id,
        kind:       r.kind,
        payload,
        attempts:   r.attempts,
        created_at: r.created_at,
      };
    });
  },

  /**
   * Mark a command done. Called by the surface controller when the peer
   * reports success.
   */
  markCommandDone: async ({ command_id, result_code = 'OK', result_message = null, result = null }) => {
    if (!command_id) throw new Error('command_id is required.');
    const resultJson = result == null ? null : JSON.stringify(result);
    await query(
      `UPDATE dbo.peer_commands
          SET status         = 'done',
              fulfilled_at   = SYSUTCDATETIME(),
              result_code    = @param0,
              result_message = @param1,
              result_json    = @param2
        WHERE command_id = @param3`,
      [result_code, result_message, resultJson, command_id]
    );
  },

  /**
   * Mark a command failed. Called by the surface controller when the peer
   * reports failure, OR when the surface decides to expire it.
   */
  markCommandFailed: async ({ command_id, result_code = 'FAILED', result_message = null, result = null }) => {
    if (!command_id) throw new Error('command_id is required.');
    const resultJson = result == null ? null : JSON.stringify(result);
    await query(
      `UPDATE dbo.peer_commands
          SET status         = 'failed',
              fulfilled_at   = SYSUTCDATETIME(),
              result_code    = @param0,
              result_message = @param1,
              result_json    = @param2
        WHERE command_id = @param3`,
      [result_code, result_message, resultJson, command_id]
    );
  },

  /**
   * List recent commands for a peer. Used by the surface's UI to show
   * "pull requested · waiting for peer" or "done · export IMP-00042".
   */
  listCommandsForPeer: async (server_id, { limit = 20 } = {}) => {
    if (!server_id) throw new Error('server_id is required.');
    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const rows = await query(
      `SELECT TOP (@param1)
         command_id, server_id, kind, status,
         created_at, dispatched_at, fulfilled_at,
         attempts, result_code, result_message, result_json
       FROM dbo.peer_commands
       WHERE server_id = @param0
       ORDER BY command_id DESC`,
      [String(server_id).trim(), safeLimit]
    );
    return rows.map((r) => {
      let result = null;
      try { result = r.result_json ? JSON.parse(r.result_json) : null; } catch { /* leave null */ }
      return { ...r, result };
    });
  },

  /**
   * Expire commands that have been pending/in-flight for more than N
   * minutes without ever being fulfilled. Safe to call periodically.
   */
  expireStaleCommands: async ({ olderThanMinutes = 15 } = {}) => {
    const safe = Math.min(Math.max(parseInt(olderThanMinutes, 10) || 15, 1), 24 * 60);
    await query(
      `UPDATE dbo.peer_commands
          SET status         = 'expired',
              fulfilled_at   = SYSUTCDATETIME(),
              result_code    = 'EXPIRED',
              result_message = 'Command expired without being fulfilled.'
        WHERE status IN ('pending', 'in_flight')
          AND created_at < DATEADD(MINUTE, -${safe}, SYSUTCDATETIME())`
    );
  },
};

module.exports = SyncPeerModel;