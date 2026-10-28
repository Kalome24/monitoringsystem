// middleware/idempotency.js
//
// Session 11 — Fix #4.
//
// Wrap a write endpoint so a retried request with the same
// Idempotency-Key returns the ORIGINAL response instead of
// re-running the business logic.
//
// Why this exists:
//   POST /stock-transfer/:id/receive applies warehouse movements.
//   If the client times out mid-request and the user retries, the
//   inventory is applied twice. With this guard, the retry hits the
//   cached response and skips the handler entirely.
//
// Contract:
//   1. Client sends header  Idempotency-Key: <opaque string>.
//   2. Server treats (user_id, endpoint, key) as the unique tuple.
//   3. First request wins; concurrent duplicate returns 409.
//   4. Response (status + JSON body) is cached for 24h.
//   5. Missing header → pass through with a one-time warning log
//      (so old clients keep working during rollout).
//
// Scope: works only with res.json()-style responses. All write
// handlers in stockTransferController use res.json, so this is a
// safe assumption for the routes we're protecting.

'use strict';
const { sql, pool, poolConnect } = require('../db');

const TTL_HOURS = 24;

// Warn only once per endpoint per process lifetime, so we can see
// during testing that a route is being called without a key — without
// spamming the log on every request.
const _warnedEndpoints = new Set();
const _warnOnce = (endpoint) => {
  if (_warnedEndpoints.has(endpoint)) return;
  _warnedEndpoints.add(endpoint);
  console.warn(
    `⚠️ idempotencyGuard: no Idempotency-Key received on "${endpoint}" — ` +
    `passing through (client should send one; check api.js).`
  );
};

function idempotencyGuard(endpointName) {
  return async function (req, res, next) {
    // ---- 0. Read the key ----
    const rawKey = req.get('Idempotency-Key');
    const userId = req.user?.id;

    // Lenient mode: no key → run normally. This keeps old clients
    // working while we roll out the api.js change.
    if (!rawKey || !String(rawKey).trim()) {
      _warnOnce(endpointName);
      return next();
    }

    // Shouldn't happen (auth runs first), but be defensive.
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Not authenticated.',
      });
    }

    const cleanKey = String(rawKey).trim().slice(0, 64);

    try {
      await poolConnect;

      // ---- 1. Was this key already used? ----
      const lookupReq = pool.request();
      lookupReq.input('key', sql.VarChar(64),  cleanKey);
      lookupReq.input('uid', sql.Int,          userId);
      lookupReq.input('ep',  sql.VarChar(200), endpointName);

      const lookup = await lookupReq.query(`
        SELECT response_status, response_body
          FROM dbo.idempotency_keys
         WHERE idempotency_key = @key
           AND user_id         = @uid
           AND endpoint        = @ep
           AND expires_at      > GETDATE()
      `);

      if (lookup.recordset[0]) {
        const cached = lookup.recordset[0];

        // Placeholder row means another request is currently running
        // with this same key. Tell client to retry shortly.
        if (cached.response_status === 0) {
          return res.status(409).json({
            success: false,
            code: 'DUPLICATE_IN_PROGRESS',
            message: 'A request with this Idempotency-Key is already in progress.',
          });
        }

        // Replay the cached response — no handler, no DB write.
        res.status(cached.response_status);
        if (cached.response_body) {
          res.type('application/json').send(cached.response_body);
        } else {
          res.end();
        }
        return;
      }

      // ---- 2. Reserve the key ----
      // Insert a placeholder row (status 0). If another request just
      // inserted the same key, our INSERT fails on the PK and we return
      // 409 instead of running the handler twice.
      const placeholderReq = pool.request();
      placeholderReq.input('key', sql.VarChar(64),  cleanKey);
      placeholderReq.input('uid', sql.Int,          userId);
      placeholderReq.input('ep',  sql.VarChar(200), endpointName);
      placeholderReq.input('exp', sql.DateTime,
        new Date(Date.now() + TTL_HOURS * 3600 * 1000));

      try {
        await placeholderReq.query(`
          INSERT INTO dbo.idempotency_keys
            (idempotency_key, user_id, endpoint,
             response_status, response_body, expires_at)
          VALUES
            (@key, @uid, @ep, 0, NULL, @exp)
        `);
      } catch (err) {
        const msg    = String(err?.message || '');
        const codeNo = err?.number;
        const isDup  =
          msg.includes('PRIMARY KEY') ||
          msg.includes('duplicate key') ||
          codeNo === 2627 ||
          codeNo === 2601;

        if (isDup) {
          return res.status(409).json({
            success: false,
            code: 'DUPLICATE_IN_PROGRESS',
            message: 'A request with this Idempotency-Key is already in progress.',
          });
        }
        throw err;
      }

      // ---- 3. Capture the outgoing response ----
      // Save asynchronously so the actual response isn't blocked on
      // the cache write.
      const originalJson = res.json.bind(res);
      res.json = function (body) {
        const status = res.statusCode;
        saveResponse(cleanKey, userId, endpointName, status, body)
          .catch((err) =>
            console.error('⚠️ idempotency save failed:', err.message || err)
          );
        return originalJson(body);
      };

      // ---- 4. Run the real handler ----
      next();
    } catch (err) {
      console.error('❌ idempotencyGuard error:', err);
      return res.status(500).json({
        success: false,
        message: 'Idempotency check failed.',
      });
    }
  };
}

async function saveResponse(key, userId, endpoint, status, body) {
  await poolConnect;
  const req = pool.request();
  req.input('key',    sql.VarChar(64),      key);
  req.input('uid',    sql.Int,              userId);
  req.input('ep',     sql.VarChar(200),     endpoint);
  req.input('status', sql.Int,              status || 200);
  req.input('body',   sql.NVarChar(sql.MAX), body != null ? JSON.stringify(body) : null);

  await req.query(`
    UPDATE dbo.idempotency_keys
       SET response_status = @status,
           response_body   = @body
     WHERE idempotency_key = @key
       AND user_id         = @uid
       AND endpoint        = @ep
  `);
}

/**
 * Delete expired keys. Called on boot and hourly from server.js.
 * @returns {Promise<number>} rows deleted
 */
async function sweepExpiredKeys() {
  try {
    await poolConnect;
    const req = pool.request();
    const res = await req.query(`
      DELETE FROM dbo.idempotency_keys
       WHERE expires_at < GETDATE()
    `);
    return res.rowsAffected?.[0] || 0;
  } catch (err) {
    console.error('⚠️ idempotency sweep failed:', err.message || err);
    return 0;
  }
}

module.exports = { idempotencyGuard, sweepExpiredKeys };