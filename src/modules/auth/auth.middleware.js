'use strict';

const env = require('../../config/env');
const ApiError = require('../../utils/ApiError');

function extractKey(req) {
  const header = req.headers['x-api-key'];
  if (typeof header === 'string' && header.length > 0) return header;

  const auth = req.headers.authorization;
  if (typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim();
  }
  return null;
}

function adminAuth(req, _res, next) {
  if (!env.admin.authEnabled) return next();

  const provided = extractKey(req);
  if (!provided) {
    return next(ApiError.unauthorized('Missing admin API key'));
  }

  const allowed = env.admin.apiKeys;
  if (allowed.length === 0) {
    return next(ApiError.unauthorized('Admin authentication is not configured'));
  }

  // Constant-time-ish compare: avoid early-exit string === for matching length keys.
  const ok = allowed.some((k) => safeEqual(k, provided));
  if (!ok) return next(ApiError.forbidden('Invalid admin API key'));

  req.admin = { authenticated: true };
  return next();
}

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

module.exports = { adminAuth };
