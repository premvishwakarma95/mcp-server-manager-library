'use strict';

const env = require('../config/env');
const logger = require('../utils/logger');

let client = null;
let connecting = false;

function getClient() {
  if (!env.redis.enabled) return null;
  if (client) return client;
  if (connecting) return client;

  try {
    // Lazy require so the dep is only loaded when enabled.
    // eslint-disable-next-line global-require
    const Redis = require('ioredis');
    connecting = true;
    client = new Redis(env.redis.url, {
      lazyConnect: false,
      maxRetriesPerRequest: 2,
      enableOfflineQueue: false,
    });

    client.on('connect', () => logger.info('Redis connected'));
    client.on('error', (err) => logger.warn(`Redis error: ${err.message}`));
    client.on('end', () => {
      logger.warn('Redis connection ended');
      client = null;
      connecting = false;
    });
  } catch (err) {
    logger.warn(`Redis not available: ${err.message}`);
    client = null;
  }

  return client;
}

async function disconnect() {
  if (!client) return;
  try {
    await client.quit();
  } catch (_) {
    // ignore
  }
  client = null;
}

module.exports = { getClient, disconnect };
