// services/surfaceSyncClient.js
//
// Session 16 — outbound HTTP client for pushing a closed underground
// shift's release lines to a remote surface server.
//
// Session 16b — added heartbeat + command-result methods.
//
// Config-sync (this version) — added fetchConfigFromSurface() so
// the underground backend can PULL the latest offline-config payload
// from the surface over HTTP. Reuses the same rawRequest helper and
// X-IMS-Sync-Key auth the other methods use.
//
// Design notes:
//   • Uses node's http/https modules (not fetch) so we don't depend on
//     Node 18+. Same shape on Node 14/16/18/20.
//   • Classifies errors into the same { code } vocabulary the rest of
//     the codebase uses (ALREADY_SYNCED, AUTH_FAILED, ...) so the
//     controller can surface them without re-parsing HTTP codes.
//   • Never throws on 4xx/5xx — returns { ok: false, code, message }.
//     Only network/timeout errors throw SurfaceSyncError.
//
'use strict';

const http  = require('http');
const https = require('https');
const { URL } = require('url');

const DEFAULT_TIMEOUT_MS = 15000;

class SurfaceSyncError extends Error {
  constructor(message, { status = null, code = null, data = null } = {}) {
    super(message);
    this.name   = 'SurfaceSyncError';
    this.status = status;
    this.code   = code;
    this.data   = data;
  }
}

/**
 * Remote mode is enabled when BOTH SURFACE_BASE_URL and SURFACE_SYNC_KEY
 * are non-empty. If either is missing, the caller falls back to the
 * legacy local (shared-DB) behaviour.
 */
const isRemoteSyncEnabled = () => {
  const url = String(process.env.SURFACE_BASE_URL || '').trim();
  const key = String(process.env.SURFACE_SYNC_KEY  || '').trim();
  return !!url && !!key;
};

const getSyncConfig = () => {
  const baseUrl   = String(process.env.SURFACE_BASE_URL || '').trim().replace(/\/+$/, '');
  const key       = String(process.env.SURFACE_SYNC_KEY  || '').trim();
  const timeoutMs = Math.max(
    1000,
    parseInt(process.env.IMS_SYNC_TIMEOUT_MS, 10) || DEFAULT_TIMEOUT_MS
  );
  const serverId  = String(process.env.IMS_SERVER_ID || '').trim() || null;
  return { baseUrl, key, timeoutMs, serverId };
};

/**
 * Raw HTTP request — returns { status, raw, json }.
 * On network/timeout failure, rejects with SurfaceSyncError.
 */
const rawRequest = (urlString, {
  method = 'POST',
  headers = {},
  body = null,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) => {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(urlString);
    } catch {
      return reject(new SurfaceSyncError(`Invalid SURFACE_BASE_URL: ${urlString}`));
    }

    const lib = parsed.protocol === 'https:' ? https : http;
    const payload = body ? JSON.stringify(body) : null;

    const req = lib.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path:     parsed.pathname + parsed.search,
        method,
        headers: {
          Accept: 'application/json',
          ...(payload
            ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
            : {}),
          ...headers,
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try { json = raw ? JSON.parse(raw) : null; } catch { /* leave null */ }
          resolve({ status: res.statusCode, raw, json });
        });
      }
    );

    req.on('error', (err) => {
      reject(new SurfaceSyncError(`Network error: ${err.message}`, { code: 'NETWORK_ERROR' }));
    });

    req.setTimeout(timeoutMs, () => {
      req.destroy(new SurfaceSyncError(
        `Request to ${parsed.hostname} timed out after ${timeoutMs}ms`,
        { code: 'TIMEOUT' }
      ));
    });

    if (payload) req.write(payload);
    req.end();
  });
};

/* ============================================================
   PUSH SHIFT PAYLOAD (underground → surface)
   ============================================================ */

/**
 * Push a shift payload to the remote surface server.
 *
 * @param {object} payload  Built by UndergroundModel.getShiftPayloadForPush
 * @returns {Promise<{ ok:boolean, status:number, code?:string, data?:object, message?:string }>}
 */
const pushShiftPayload = async (payload) => {
  const { baseUrl, key, timeoutMs } = getSyncConfig();
  if (!baseUrl) throw new SurfaceSyncError('SURFACE_BASE_URL is not configured.');
  if (!key)     throw new SurfaceSyncError('SURFACE_SYNC_KEY is not configured.');

  const url = `${baseUrl}/api/underground/receive-online-sync`;

  let res;
  try {
    res = await rawRequest(url, {
      method: 'POST',
      headers: {
        'X-IMS-Sync-Key':    key,
        'X-IMS-Sync-Source': process.env.IMS_SERVER_ID || 'underground',
      },
      body: payload,
      timeoutMs,
    });
  } catch (err) {
    if (err instanceof SurfaceSyncError) throw err;
    throw new SurfaceSyncError(err.message || 'Push failed');
  }

  const { status, json } = res;
  const data    = json?.data    ?? null;
  const message = json?.message ?? null;

  if (status >= 200 && status < 300) {
    return { ok: true, status, data, message };
  }
  if (status === 409) {
    return {
      ok: false, status, code: json?.code || 'ALREADY_SYNCED',
      data, message: message || 'This shift is already synced on the surface.',
    };
  }
  if (status === 401 || status === 403) {
    return {
      ok: false, status, code: json?.code || 'AUTH_FAILED',
      data, message: message || 'The surface server rejected the sync key.',
    };
  }
  if (status === 400) {
    return {
      ok: false, status, code: json?.code || 'BAD_REQUEST',
      data, message: message || 'The surface server rejected the payload.',
    };
  }
  return {
    ok: false, status, code: json?.code || 'SURFACE_ERROR',
    data, message: message || `Surface responded with HTTP ${status}.`,
  };
};

/* ============================================================
   HEARTBEAT (peer → surface)
   ------------------------------------------------------------
   The response carries any pending commands. Callers parse
   r.data.commands and dispatch them.
   ============================================================ */

/**
 * @param {object} body  { server_id, warehouse_code, pending_count, ... }
 * @returns {Promise<{ ok:boolean, status:number, code?:string, data?:object, message?:string }>}
 */
const postPeerHeartbeat = async (body) => {
  const { baseUrl, key, timeoutMs } = getSyncConfig();
  if (!baseUrl) return { ok: false, status: 0, code: 'NOT_CONFIGURED', message: 'SURFACE_BASE_URL is not set.' };
  if (!key)     return { ok: false, status: 0, code: 'NOT_CONFIGURED', message: 'SURFACE_SYNC_KEY is not set.' };

  const url = `${baseUrl}/api/underground/peer-heartbeat`;

  let res;
  try {
    res = await rawRequest(url, {
      method: 'POST',
      headers: {
        'X-IMS-Sync-Key':    key,
        'X-IMS-Sync-Source': process.env.IMS_SERVER_ID || 'underground',
      },
      body,
      timeoutMs,
    });
  } catch (err) {
    if (err instanceof SurfaceSyncError) throw err;
    throw new SurfaceSyncError(err.message || 'Heartbeat failed');
  }

  const { status, json } = res;
  if (status >= 200 && status < 300) {
    return {
      ok:      true,
      status,
      data:    json?.data ?? null,
      message: json?.message ?? null,
    };
  }
  return {
    ok:      false,
    status,
    code:    json?.code || 'SURFACE_ERROR',
    message: json?.message || `Surface responded with HTTP ${status}.`,
    data:    json?.data ?? null,
  };
};

/* ============================================================
   COMMAND RESULT (peer → surface)
   ============================================================ */

/**
 * @param {object} body  { command_id, status, code?, message?, data? }
 */
const postPeerCommandResult = async (body) => {
  const { baseUrl, key, timeoutMs } = getSyncConfig();
  if (!baseUrl) return { ok: false, status: 0, code: 'NOT_CONFIGURED', message: 'SURFACE_BASE_URL is not set.' };
  if (!key)     return { ok: false, status: 0, code: 'NOT_CONFIGURED', message: 'SURFACE_SYNC_KEY is not set.' };

  const url = `${baseUrl}/api/underground/peer-command-result`;

  let res;
  try {
    res = await rawRequest(url, {
      method: 'POST',
      headers: {
        'X-IMS-Sync-Key':    key,
        'X-IMS-Sync-Source': process.env.IMS_SERVER_ID || 'underground',
      },
      body,
      timeoutMs,
    });
  } catch (err) {
    if (err instanceof SurfaceSyncError) throw err;
    throw new SurfaceSyncError(err.message || 'Command result report failed');
  }

  const { status, json } = res;
  if (status >= 200 && status < 300) {
    return { ok: true,  status, data: json?.data ?? null, message: json?.message ?? null };
  }
  return {
    ok:      false,
    status,
    code:    json?.code || 'SURFACE_ERROR',
    message: json?.message || `Surface responded with HTTP ${status}.`,
    data:    json?.data ?? null,
  };
};

/* ============================================================
   CONFIG PULL (underground backend → surface backend)
   ------------------------------------------------------------
   Fetches the latest offline-config payload from the surface's
   /api/offline-config/sync/peer-export endpoint. That endpoint
   is authenticated with X-IMS-Sync-Key (syncKeyAuth), NOT a user
   JWT — because the caller is another server, not a browser.

   Returns { ok, status, payload, meta, message }. Throws only on
   network/timeout errors.

   Timeout is longer than the default because config payloads can
   be large (hundreds of item codes + locators). A 30s minimum
   gives slow links room without breaking the "pull" semantics.

   The endpoint itself is idempotent — multiple pulls return the
   same current surface state. Safe to retry on transient errors.
   ============================================================ */
const fetchConfigFromSurface = async () => {
  const { baseUrl, key, timeoutMs } = getSyncConfig();
  if (!baseUrl) {
    throw new SurfaceSyncError('SURFACE_BASE_URL is not configured on this device.', {
      code: 'NOT_CONFIGURED',
    });
  }
  if (!key) {
    throw new SurfaceSyncError('SURFACE_SYNC_KEY is not configured on this device.', {
      code: 'NOT_CONFIGURED',
    });
  }

  const url = `${baseUrl}/api/offline-config/sync/peer-export`;

  // 30s floor for config payloads even if IMS_SYNC_TIMEOUT_MS is
  // tuned lower for heartbeat speed.
  const configTimeoutMs = Math.max(timeoutMs, 30000);

  let res;
  try {
    res = await rawRequest(url, {
      method: 'GET',
      headers: {
        'X-IMS-Sync-Key':    key,
        'X-IMS-Sync-Source': process.env.IMS_SERVER_ID || 'underground',
      },
      timeoutMs: configTimeoutMs,
    });
  } catch (err) {
    if (err instanceof SurfaceSyncError) throw err;
    throw new SurfaceSyncError(err.message || 'Config pull failed');
  }

  const { status, json } = res;

  if (status >= 200 && status < 300) {
    return {
      ok:      true,
      status,
      payload: json?.data ?? null,
      meta:    json?.meta ?? {},
      message: json?.message ?? null,
    };
  }

  if (status === 401 || status === 403) {
    return {
      ok:      false,
      status,
      code:    json?.code || 'AUTH_FAILED',
      payload: null,
      meta:    {},
      message: json?.message || 'The surface server rejected the sync key.',
    };
  }
  if (status === 404) {
    return {
      ok:      false,
      status,
      code:    json?.code || 'ENDPOINT_NOT_FOUND',
      payload: null,
      meta:    {},
      message: json?.message ||
        'The surface server does not expose the config-sync endpoint. ' +
        'The surface may be running an older version — update it and retry.',
    };
  }
  if (status === 400) {
    return {
      ok:      false,
      status,
      code:    json?.code || 'BAD_REQUEST',
      payload: null,
      meta:    {},
      message: json?.message || 'The surface server rejected the request.',
    };
  }
  return {
    ok:      false,
    status,
    code:    json?.code || 'SURFACE_ERROR',
    payload: null,
    meta:    {},
    message: json?.message || `Surface responded with HTTP ${status}.`,
  };
};

module.exports = {
  SurfaceSyncError,
  isRemoteSyncEnabled,
  getSyncConfig,
  pushShiftPayload,
  postPeerHeartbeat,
  postPeerCommandResult,
  fetchConfigFromSurface,   // ← new
};