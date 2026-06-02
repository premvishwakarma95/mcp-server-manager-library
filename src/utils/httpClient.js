'use strict';

const axios = require('axios');
const env = require('../config/env');
const logger = require('./logger');

const DEFAULT_USER_AGENT = `${env.appName.replace(/\s+/g, '-')}/1.0`;

function createClient() {
  const instance = axios.create({
    timeout: env.exec.defaultTimeoutMs,
    maxRedirects: 5,
    validateStatus: () => true, // we inspect status manually
    headers: { 'User-Agent': DEFAULT_USER_AGENT },
  });

  return instance;
}

const httpClient = createClient();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute an HTTP request with retry + exponential backoff.
 *
 * Retries are attempted on:
 *  - Network errors (ECONNRESET, ETIMEDOUT, ENOTFOUND, etc.)
 *  - HTTP 5xx
 *  - HTTP 408, 425, 429
 *
 * Does NOT retry on 4xx (other than the above) — those are client errors and
 * retrying will not change the result.
 */
async function requestWithRetry(config, { retries = 0, retryDelayMs = 300 } = {}) {
  let attempt = 0;
  let lastError;

  // attempts = retries + 1
  while (attempt <= retries) {
    const started = Date.now();
    try {
      const response = await httpClient.request(config);
      const duration = Date.now() - started;
      const retryable = isRetryableStatus(response.status);

      if (retryable && attempt < retries) {
        const delay = retryDelayMs * 2 ** attempt;
        logger.debug(
          `Tool HTTP retryable status ${response.status} (attempt ${attempt + 1}/${retries + 1}), retrying in ${delay}ms`
        );
        await sleep(delay);
        attempt += 1;
        continue;
      }

      return { response, attempts: attempt + 1, duration };
    } catch (err) {
      lastError = err;
      const duration = Date.now() - started;
      if (attempt >= retries || !isRetryableError(err)) {
        // exhausted or non-retryable
        err.attempts = attempt + 1;
        err.duration = duration;
        throw err;
      }
      const delay = retryDelayMs * 2 ** attempt;
      logger.debug(
        `Tool HTTP error ${err.code || err.message} (attempt ${attempt + 1}/${retries + 1}), retrying in ${delay}ms`
      );
      await sleep(delay);
      attempt += 1;
    }
  }

  // Should be unreachable, but keep defensive return
  throw lastError || new Error('Tool execution failed');
}

function isRetryableStatus(status) {
  if (status >= 500) return true;
  if (status === 408 || status === 425 || status === 429) return true;
  return false;
}

function isRetryableError(err) {
  if (!err || !err.code) return false;
  const codes = new Set([
    'ECONNABORTED',
    'ECONNRESET',
    'ECONNREFUSED',
    'ETIMEDOUT',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'ENOTFOUND',
    'EAI_AGAIN',
  ]);
  return codes.has(err.code);
}

module.exports = { httpClient, requestWithRetry };
