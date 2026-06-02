'use strict';

const { Router } = require('express');
const mongoose = require('mongoose');
const { getClient } = require('../database/redis');
const { success } = require('../utils/ApiResponse');
const env = require('../config/env');

const router = Router();

/**
 * @swagger
 * /health:
 *   get:
 *     tags: [System]
 *     summary: Liveness probe
 *     responses:
 *       200: { description: OK }
 */
router.get('/health', (_req, res) => {
  return success(res, { status: 'ok', uptime: process.uptime() }, 'OK');
});

/**
 * @swagger
 * /ready:
 *   get:
 *     tags: [System]
 *     summary: Readiness probe (checks DB and optional Redis)
 */
router.get('/ready', async (_req, res) => {
  const mongoOk = mongoose.connection.readyState === 1;
  let redisOk = true;
  if (env.redis.enabled) {
    const c = getClient();
    redisOk = c ? c.status === 'ready' || c.status === 'connect' : false;
  }
  const ok = mongoOk && redisOk;
  const payload = { mongo: mongoOk, redis: env.redis.enabled ? redisOk : 'disabled' };
  return res.status(ok ? 200 : 503).json({
    success: ok,
    message: ok ? 'ready' : 'not ready',
    data: payload,
  });
});

/**
 * @swagger
 * /metrics:
 *   get:
 *     tags: [System]
 *     summary: Lightweight process metrics
 */
router.get('/metrics', (_req, res) => {
  const mem = process.memoryUsage();
  return success(
    res,
    {
      uptimeSeconds: process.uptime(),
      memory: {
        rss: mem.rss,
        heapTotal: mem.heapTotal,
        heapUsed: mem.heapUsed,
        external: mem.external,
      },
      pid: process.pid,
      node: process.version,
      env: env.nodeEnv,
    },
    'OK'
  );
});

module.exports = router;
