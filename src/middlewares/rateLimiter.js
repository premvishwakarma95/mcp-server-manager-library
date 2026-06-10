'use strict';

const rateLimit = require('express-rate-limit');
const env = require('../config/env');

function buildLimiter({ windowMs, max, keyGenerator, message } = {}) {
  return rateLimit({
    windowMs: windowMs ?? env.security.rateLimitWindowMs,
    max: max ?? env.security.rateLimitMax,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator,
    handler: (req, res /* next, options */) => {
      res.status(429).json({
        success: false,
        message: message || 'Too many requests, please slow down.',
        error: { code: 'RATE_LIMITED', statusCode: 429 },
      });
    },
  });
}

const globalLimiter = buildLimiter();

const executionLimiter = buildLimiter({
  windowMs: env.security.rateLimitWindowMs,
  max: env.security.execRateLimitMax,
  message: 'Tool execution rate limit exceeded.',
});

module.exports = { globalLimiter, executionLimiter, buildLimiter };
