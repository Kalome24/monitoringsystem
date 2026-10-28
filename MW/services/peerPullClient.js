// services/peerPullClient.js
//
// Session 16 — surface-side HTTP client for reaching a specific underground
// peer. Mirrors services/surfaceSyncClient.js but in the opposite direction:
// the SURFACE initiates, the PEER responds.
//
// Uses node's http/https modules (no fetch dependency). Classifies errors
// into the same vocabulary the controllers use.
//
'use strict';

const http  = require('http');
const https = require('https');
const { URL } = require('url');

const DEFAULT_TIMEOUT_MS = 15000;

class PeerPullError extends Error {
  constructor(message, { status = null, code = null, data = null } = {}) {
    super(message);
    this.name   = 'PeerPullError';
    this.status = status;
    this.code   = code;
    this.data   = data;
  }
}

/**
 * Build the base URL for a peer. Peers are identified by server_id, but
 * we need a host:port to reach them. Convention:
 *   PEER_<SERVER_ID>_URL=http://ug-srv-01:5001
 * e.g. PEER_UG_SRV_01_URL=http://ug-srv-01:5001
 *
 * Falls back to a single PEER_BASE_URL template if a per-peer var isn't set
 * (useful for loopback testing).
 */
const envKeyForPeer = (serverId) => {
  const norm = String(serverId).trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_');
  return `PEER_${norm}_URL`;
};

const getPeerBaseUrl = (serverId) => {
  const key = envKeyForPeer(serverId);
  const direct = String(process.env[key] || '').trim().replace(/\/+$/, '');
  if (direct) return direct;
  const fallback = String(process.env.PEER_BASE_URL || '').trim().replace(/\/+$/, '');
  return fallback || null;
};

const getSyncKey = () => String(process.env.UNDERGROUND_SYNC_KEY || '').trim();

const isPullEnabled = () => {
  // Enabled when the surface has a key to present to peers.
  // Per-peer URLs are resolved lazily; missing URL → clear 404-style error.
  return !!getSyncKey();
};

const rawRequest = (urlString, {
  method = 'GET',
  headers = {},
  body = null,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) => {
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL(urlString); }
    catch { return reject(new PeerPullError(`Invalid peer URL: ${urlString}`)); }

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
      reject(new PeerPullError(`Network error: ${err.message}`, { code: 'NETWORK_ERROR' }));
    });

    req.setTimeout(timeoutMs, () => {
      req.destroy(new PeerPullError(
        `Request to ${parsed.hostname} timed out after ${timeoutMs}ms`,
        { code: 'TIMEOUT' }
      ));
    });

    if (payload) req.write(payload);
    req.end();
  });
};

const classifyHttp = (status, json, fallbackMessage) => {
  const code    = json?.code    || null;
  const message = json?.message || fallbackMessage;
  const data    = json?.data    ?? null;
  if (status >= 200 && status < 300) return { ok: true, status, data, message };
  if (status === 404) return { ok: false, status, code: code || 'NOT_FOUND',     data, message };
  if (status === 409) return { ok: false, status, code: code || 'CONFLICT',      data, message };
  if (status === 401 || status === 403) return { ok: false, status, code: code || 'AUTH_FAILED', data, message };
  if (status === 400) return { ok: false, status, code: code || 'BAD_REQUEST',   data, message };
  return { ok: false, status, code: code || 'PEER_ERROR', data, message };
};

/**
 * GET /api/underground/remote-export/pending?warehouse_code=XXX
 */
const fetchPeerPending = async (serverId, warehouseCode) => {
  const base = getPeerBaseUrl(serverId);
  if (!base) {
    return {
      ok: false, status: 0, code: 'PEER_NOT_CONFIGURED',
      message: `No URL configured for peer ${serverId}. Set ${envKeyForPeer(serverId)} (or PEER_BASE_URL).`,
      data: null,
    };
  }

  const url = `${base}/api/underground/remote-export/pending`
            + (warehouseCode ? `?warehouse_code=${encodeURIComponent(warehouseCode)}` : '');

  let res;
  try {
    res = await rawRequest(url, {
      method: 'GET',
      headers: { 'X-IMS-Sync-Key': getSyncKey(), 'X-IMS-Sync-Source': 'surface' },
      timeoutMs: Math.max(1000, parseInt(process.env.IMS_SYNC_TIMEOUT_MS, 10) || DEFAULT_TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof PeerPullError) throw err;
    throw new PeerPullError(err.message || 'Peer request failed');
  }
  return classifyHttp(res.status, res.json, `Peer responded with HTTP ${res.status}`);
};

/**
 * GET /api/underground/remote-export/shift/:id
 */
const fetchPeerShift = async (serverId, shiftId) => {
  const base = getPeerBaseUrl(serverId);
  if (!base) {
    return {
      ok: false, status: 0, code: 'PEER_NOT_CONFIGURED',
      message: `No URL configured for peer ${serverId}.`,
      data: null,
    };
  }
  const url = `${base}/api/underground/remote-export/shift/${encodeURIComponent(shiftId)}`;
  let res;
  try {
    res = await rawRequest(url, {
      method: 'GET',
      headers: { 'X-IMS-Sync-Key': getSyncKey(), 'X-IMS-Sync-Source': 'surface' },
      timeoutMs: Math.max(1000, parseInt(process.env.IMS_SYNC_TIMEOUT_MS, 10) || DEFAULT_TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof PeerPullError) throw err;
    throw new PeerPullError(err.message || 'Peer request failed');
  }
  return classifyHttp(res.status, res.json, `Peer responded with HTTP ${res.status}`);
};

/**
 * POST /api/underground/remote-export/mark-reconciled
 */
const markPeerReconciled = async (serverId, { shift_id, sync_token }) => {
  const base = getPeerBaseUrl(serverId);
  if (!base) {
    return {
      ok: false, status: 0, code: 'PEER_NOT_CONFIGURED',
      message: `No URL configured for peer ${serverId}.`,
      data: null,
    };
  }
  const url = `${base}/api/underground/remote-export/mark-reconciled`;
  let res;
  try {
    res = await rawRequest(url, {
      method: 'POST',
      headers: { 'X-IMS-Sync-Key': getSyncKey(), 'X-IMS-Sync-Source': 'surface' },
      body: { shift_id, sync_token },
      timeoutMs: Math.max(1000, parseInt(process.env.IMS_SYNC_TIMEOUT_MS, 10) || DEFAULT_TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof PeerPullError) throw err;
    throw new PeerPullError(err.message || 'Peer request failed');
  }
  return classifyHttp(res.status, res.json, `Peer responded with HTTP ${res.status}`);
};

/**
 * GET /api/health — lightweight presence probe. Returns boolean.
 */
const probePeerHealth = async (serverId) => {
  const base = getPeerBaseUrl(serverId);
  if (!base) return { ok: false, code: 'PEER_NOT_CONFIGURED', message: 'No URL configured.' };
  try {
    const res = await rawRequest(`${base}/api/health`, {
      method: 'GET',
      timeoutMs: Math.min(3000, parseInt(process.env.IMS_SYNC_TIMEOUT_MS, 10) || DEFAULT_TIMEOUT_MS),
    });
    return { ok: res.status === 200, status: res.status };
  } catch (err) {
    return { ok: false, code: err.code || 'NETWORK_ERROR', message: err.message };
  }
};

module.exports = {
  PeerPullError,
  isPullEnabled,
  getPeerBaseUrl,
  envKeyForPeer,
  fetchPeerPending,
  fetchPeerShift,
  markPeerReconciled,
  probePeerHealth,
};