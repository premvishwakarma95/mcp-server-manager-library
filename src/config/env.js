'use strict';

const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const toBool = (v, def = false) => {
  if (v === undefined || v === null || v === '') return def;
  return String(v).toLowerCase() === 'true' || v === '1';
};

const toInt = (v, def) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
};

const toList = (v, def = []) => {
  if (!v) return def;
  return String(v)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
};

const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: toInt(process.env.PORT, 4000),
  apiPrefix: process.env.API_PREFIX || '/api/v1',
  appName: process.env.APP_NAME || 'Dynamic MCP Platform',

  mongo: {
    uri: process.env.MONGO_URI || 'mongodb://localhost:27017/dynamic_mcp',
    debug: toBool(process.env.MONGO_DEBUG, false),
  },

  redis: {
    enabled: toBool(process.env.REDIS_ENABLED, false),
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    cacheTtlSeconds: toInt(process.env.CACHE_TTL_SECONDS, 60),
  },

  security: {
    corsOrigins: toList(process.env.CORS_ORIGINS, ['*']),
    rateLimitWindowMs: toInt(process.env.RATE_LIMIT_WINDOW_MS, 60_000),
    rateLimitMax: toInt(process.env.RATE_LIMIT_MAX, 300),
    execRateLimitMax: toInt(process.env.EXEC_RATE_LIMIT_MAX, 60),
  },

  admin: {
    apiKeys: toList(process.env.ADMIN_API_KEYS, []),
    authEnabled: toBool(process.env.ADMIN_AUTH_ENABLED, true),
    // "htaccess-style" HTTP Basic Auth gate in front of the /admin UI page.
    // If either is blank, the gate is OFF (local dev convenience).
    uiUser: process.env.ADMIN_UI_USER || '',
    uiPass: process.env.ADMIN_UI_PASSWORD || '',
  },

  exec: {
    defaultTimeoutMs: toInt(process.env.DEFAULT_TOOL_TIMEOUT_MS, 15_000),
    defaultRetries: toInt(process.env.DEFAULT_TOOL_RETRIES, 0),
    maxTimeoutMs: toInt(process.env.MAX_TOOL_TIMEOUT_MS, 120_000),
  },

  logging: {
    level: process.env.LOG_LEVEL || 'info',
    executionLogBodyBytes: toInt(process.env.EXECUTION_LOG_BODY_BYTES, 8192),
  },

  swagger: {
    enabled: toBool(process.env.SWAGGER_ENABLED, true),
  },
};

const isProd = env.nodeEnv === 'production';
if (isProd && env.admin.authEnabled && env.admin.apiKeys.length === 0) {
  // Fail fast: production must not run with admin endpoints unprotected.
  // eslint-disable-next-line no-console
  console.error('[FATAL] ADMIN_AUTH_ENABLED=true but ADMIN_API_KEYS is empty in production.');
  process.exit(1);
}

module.exports = env;
