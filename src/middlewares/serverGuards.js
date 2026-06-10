'use strict';

/**
 * Per-server access guards for any public `/:serverSlug/...` route.
 *
 * Chain (applied in order):
 *   1. resolveServer  — slug → active server doc, attached as req.mcpServer
 *   2. ipFilter       — if server.mcpIpFilterEnabled, check client IP vs allowlist
 *   3. mcpAuth        — if server.mcpAccessKey set, require matching header/query
 *
 * Reuse via `guardServer` (returns the array, so each route gets its own
 * handlers and Express won't share state).
 */

const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');
const { isValidSlug } = require('../utils/slugify');
const serverService = require('../modules/mcpServer/mcpServer.service');

function extractIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return String(forwarded).split(',')[0].trim();
  return req.socket.remoteAddress;
}

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const resolveServer = asyncHandler(async (req, _res, next) => {
  const { serverSlug } = req.params;
  if (!isValidSlug(serverSlug)) throw ApiError.badRequest(`Invalid server slug: ${serverSlug}`);
  const server = await serverService.getServerBySlug(serverSlug, { activeOnly: true });
  if (!server) throw ApiError.notFound(`MCP server "${serverSlug}" not found or inactive`);
  req.mcpServer = server;
  next();
});

function ipFilter(req, res, next) {
  const server = req.mcpServer;
  if (!server || !server.mcpIpFilterEnabled) return next();

  const allowed = Array.isArray(server.mcpAllowedIps) ? server.mcpAllowedIps : [];
  const ip = extractIp(req);

  if (allowed.length === 0) {
    logger.warn(`[serverGuards.ipFilter] server="${server.slug}" enabled with empty allowlist — blocking all`);
    return res.status(403).json({ error: 'Forbidden' });
  }
  if (!allowed.includes(ip)) {
    logger.warn(`[serverGuards.ipFilter] server="${server.slug}" blocked IP ${ip}`);
    return res.status(403).json({ error: 'Forbidden' });
  }
  return next();
}

// Resolve the inbound gate config in priority order:
//   1. Dedicated fields: server.mcpAccessKey + server.mcpAccessKeyHeader.
//   2. Fallback to the server-level "Auth credentials" section
//      (authType + auth.token + auth.headerName). This lets a single UI
//      section configure inbound gating — when authType is bearer/apiKey
//      and a token is set, the token doubles as the required inbound key.
//      Upstream auth is handled separately via toolAuthType pass-through.
function resolveInboundGate(server) {
  if (!server) return null;
  if (server.mcpAccessKey) {
    return {
      key: server.mcpAccessKey,
      header: (server.mcpAccessKeyHeader || 'x-mcp-key').toLowerCase(),
    };
  }
  const auth = server.auth;
  if (server.authType && server.authType !== 'none' && auth && auth.token) {
    if (server.authType === 'bearer') {
      return { key: auth.token, header: 'authorization' };
    }
    if (server.authType === 'apiKey' && auth.headerName) {
      return { key: auth.token, header: auth.headerName.toLowerCase() };
    }
  }
  return null;
}

function mcpAuth(req, res, next) {
  const server = req.mcpServer;
  const gate = resolveInboundGate(server);
  if (!gate) return next();   // no key configured → endpoint is public

  let key = req.headers[gate.header] || req.query.mcp_key;

  // Bearer mode: when the configured header is `authorization`, accept the
  // standard `Authorization: Bearer <token>` form by stripping the prefix.
  // Without this, the admin would have to store the literal "Bearer <token>"
  // string, which is non-obvious and breaks normal HTTP client conventions.
  if (typeof key === 'string' && gate.header === 'authorization') {
    const m = key.match(/^Bearer\s+(.+)$/i);
    if (m) key = m[1].trim();
  }

  if (!key) {
    logger.warn(`[serverGuards.mcpAuth] server="${server.slug}" missing access key`);
    return res.status(401).json({ error: 'Unauthorized: missing MCP key' });
  }
  if (!safeEqual(gate.key, String(key))) {
    logger.warn(`[serverGuards.mcpAuth] server="${server.slug}" invalid access key`);
    return res.status(403).json({ error: 'Forbidden: invalid MCP key' });
  }
  return next();
}

// Helper that returns a fresh array each call so Express can mount it on
// multiple routes without sharing state.
function guardServer() {
  return [resolveServer, ipFilter, mcpAuth];
}

module.exports = {
  resolveServer,
  ipFilter,
  mcpAuth,
  guardServer,
  extractIp,
  safeEqual,
  resolveInboundGate,
};
