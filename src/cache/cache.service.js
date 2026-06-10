'use strict';

const env = require('../config/env');
const { getClient } = require('../database/redis');
const logger = require('../utils/logger');

const NAMESPACE = 'mcp';

function key(parts) {
  return [NAMESPACE, ...parts.filter(Boolean)].join(':');
}

async function get(k) {
  const client = getClient();
  if (!client) return null;
  try {
    const raw = await client.get(k);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (err) {
    logger.warn(`cache.get failed for ${k}: ${err.message}`);
    return null;
  }
}

async function set(k, value, ttlSeconds = env.redis.cacheTtlSeconds) {
  const client = getClient();
  if (!client) return;
  try {
    const raw = JSON.stringify(value);
    if (ttlSeconds > 0) await client.set(k, raw, 'EX', ttlSeconds);
    else await client.set(k, raw);
  } catch (err) {
    logger.warn(`cache.set failed for ${k}: ${err.message}`);
  }
}

async function del(k) {
  const client = getClient();
  if (!client) return;
  try {
    if (Array.isArray(k)) await client.del(...k);
    else await client.del(k);
  } catch (err) {
    logger.warn(`cache.del failed: ${err.message}`);
  }
}

async function delByPattern(pattern) {
  const client = getClient();
  if (!client) return;
  try {
    const stream = client.scanStream({ match: pattern, count: 100 });
    const pipeline = client.pipeline();
    let queued = 0;
    await new Promise((resolve, reject) => {
      stream.on('data', (keys) => {
        for (const k of keys) {
          pipeline.del(k);
          queued += 1;
        }
      });
      stream.on('end', resolve);
      stream.on('error', reject);
    });
    if (queued > 0) await pipeline.exec();
  } catch (err) {
    logger.warn(`cache.delByPattern failed for ${pattern}: ${err.message}`);
  }
}

function buildKey(...parts) {
  return key(parts);
}

module.exports = { get, set, del, delByPattern, buildKey };
