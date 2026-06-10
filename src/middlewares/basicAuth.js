'use strict';

const crypto = require('crypto');

/**
 * HTTP Basic Auth gate, used as an "htaccess-style" password in front of the
 * /admin UI static page. Separate from the admin API key (which protects the
 * JSON endpoints); the two layers are intentional defense-in-depth.
 *
 * Behavior:
 *   - If both `user` and `pass` are empty/undefined → middleware no-ops, so
 *     local dev keeps working without configuring credentials.
 *   - Otherwise the browser is forced to send Authorization: Basic <b64>.
 *     Wrong/missing credentials → 401 with a WWW-Authenticate header so the
 *     browser pops up its native login prompt.
 *   - Comparison is constant-time to avoid timing side-channels on the secret.
 */
function basicAuth({ user, pass, realm = 'Admin UI' } = {}) {
  const enabled = Boolean(user) && Boolean(pass);

  return function basicAuthMiddleware(req, res, next) {
    if (!enabled) return next();

    const header = req.headers.authorization || '';
    const m = header.match(/^Basic\s+(.+)$/i);
    if (!m) return unauthorized(res, realm);

    let decoded;
    try {
      decoded = Buffer.from(m[1], 'base64').toString('utf8');
    } catch (_) {
      return unauthorized(res, realm);
    }
    const idx = decoded.indexOf(':');
    if (idx < 0) return unauthorized(res, realm);
    const providedUser = decoded.slice(0, idx);
    const providedPass = decoded.slice(idx + 1);

    if (!safeEqual(providedUser, user) || !safeEqual(providedPass, pass)) {
      return unauthorized(res, realm);
    }
    return next();
  };
}

function unauthorized(res, realm) {
  res.set('WWW-Authenticate', `Basic realm="${realm.replace(/"/g, '')}", charset="UTF-8"`);
  res.status(401).type('text/plain').send('Authentication required');
}

// Length-padded constant-time compare. Same-length inputs use timingSafeEqual
// directly; different-length inputs still take roughly the same time.
function safeEqual(a, b) {
  const aBuf = Buffer.from(String(a), 'utf8');
  const bBuf = Buffer.from(String(b), 'utf8');
  if (aBuf.length !== bBuf.length) {
    // Burn the same work as a real compare so length differences aren't a leak.
    crypto.timingSafeEqual(aBuf, aBuf);
    return false;
  }
  return crypto.timingSafeEqual(aBuf, bBuf);
}

module.exports = basicAuth;
