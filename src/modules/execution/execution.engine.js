'use strict';

const { URL } = require('url');
const ApiError = require('../../utils/ApiError');
const env = require('../../config/env');
const logger = require('../../utils/logger');
const { jsonSchemaToZod, formatZodIssues } = require('../../utils/zodFromJsonSchema');
const { requestWithRetry } = require('../../utils/httpClient');
const { applyAuth } = require('./auth.injector');
const executionRepo = require('./execution.repository');

/**
 * Resolve a tool's endpoint into a fully-qualified URL.
 *
 * Rule (simple, leading-slash discriminator):
 *  - If endpoint starts with `/` → relative path. Join onto server.baseUrl.
 *  - Otherwise                  → treat the endpoint as the full URL verbatim.
 *
 * Path templating (`{placeholder}`) is applied first, so a `{base}` token in an
 * absolute URL or a `{id}` in a relative path both work the same way.
 */
function resolveUrl(server, tool, input) {
  let endpoint = tool.endpoint || '';
  if (!endpoint && server.baseUrl) endpoint = '/';

  endpoint = templateString(endpoint, input);

  if (!endpoint.startsWith('/')) return endpoint; // full URL — use verbatim

  if (!server.baseUrl) {
    throw ApiError.badRequest(
      `Tool "${tool.name}" uses a relative endpoint (starts with "/") but server "${server.slug}" has no baseUrl`
    );
  }
  // Safe join — drop trailing slash on base so we don't end up with "//".
  const base = server.baseUrl.replace(/\/+$/, '');
  return `${base}${endpoint}`;
}

function templateString(str, input) {
  if (!str || typeof str !== 'string') return str;
  return str.replace(/\{([a-zA-Z0-9_]+)\}/g, (m, key) => {
    if (input && input[key] !== undefined && input[key] !== null) return String(input[key]);
    return m;
  });
}

function resolveTimeout(tool) {
  const t = tool.timeout && tool.timeout > 0 ? tool.timeout : env.exec.defaultTimeoutMs;
  return Math.min(t, env.exec.maxTimeoutMs);
}

function resolveRetries(tool) {
  if (typeof tool.retries === 'number' && tool.retries >= 0) return tool.retries;
  return env.exec.defaultRetries;
}

function mergeHeaders(...sources) {
  const out = {};
  for (const src of sources) {
    if (!src) continue;
    for (const [k, v] of Object.entries(src)) {
      if (v !== undefined && v !== null) out[k] = String(v);
    }
  }
  return out;
}

function safeTruncateForLog(body) {
  const maxBytes = env.logging.executionLogBodyBytes;
  if (maxBytes <= 0) return { value: null, truncated: false };
  try {
    const str = typeof body === 'string' ? body : JSON.stringify(body);
    if (!str) return { value: body, truncated: false };
    if (Buffer.byteLength(str, 'utf8') <= maxBytes) {
      return { value: body, truncated: false };
    }
    return { value: str.slice(0, maxBytes), truncated: true };
  } catch (_) {
    return { value: '[unserializable]', truncated: true };
  }
}

function redactHeaders(headers = {}) {
  const redacted = {};
  const sensitive = new Set(['authorization', 'x-api-key', 'proxy-authorization', 'cookie']);
  for (const [k, v] of Object.entries(headers)) {
    redacted[k] = sensitive.has(k.toLowerCase()) ? '***' : v;
  }
  return redacted;
}

/**
 * Validate the request input against the tool's stored JSON Schema (input).
 */
function validateInput(tool, input) {
  const schema = tool.inputSchema;
  if (!schema || typeof schema !== 'object' || Object.keys(schema).length === 0) {
    return input ?? {};
  }
  const zodSchema = jsonSchemaToZod(schema);
  const result = zodSchema.safeParse(input ?? {});
  if (!result.success) {
    throw ApiError.unprocessable('Tool input validation failed', {
      issues: formatZodIssues(result.error),
    });
  }
  return result.data;
}

/**
 * Execute a tool. Returns:
 *   { status, response, durationMs, attempts, error? }
 *
 * Always records an execution log (best-effort).
 */
async function executeTool({ server, tool, input = {}, requestId = null, headersOverride = {}, callerHeaders = {} }) {
  const started = Date.now();

  // 1) Validate input
  let validated;
  try {
    validated = validateInput(tool, input);
  } catch (err) {
    await executionRepo.record({
      serverId: server._id,
      toolId: tool._id,
      serverSlug: server.slug,
      toolName: tool.name,
      requestId,
      request: { method: tool.method, url: null, headers: null, query: null, body: input },
      status: 'validation_error',
      attempts: 0,
      durationMs: Date.now() - started,
      error: { message: err.message, code: err.code, details: err.details || null },
    });
    throw err;
  }

  // 2) Short-circuit: echo executor (testing/local tools)
  if (tool.executionType === 'echo') {
    const response = {
      tool: tool.name,
      server: server.slug,
      echoed: validated,
      receivedAt: new Date().toISOString(),
    };
    const durationMs = Date.now() - started;
    await executionRepo.record({
      serverId: server._id,
      toolId: tool._id,
      serverSlug: server.slug,
      toolName: tool.name,
      requestId,
      request: { method: 'ECHO', url: null, headers: null, query: null, body: validated },
      response: { status: 200, headers: null, body: response, bodyTruncated: false },
      status: 'success',
      attempts: 1,
      durationMs,
    });
    return { status: 'success', response, durationMs, attempts: 1 };
  }

  // 3) HTTP execution path
  const url = resolveUrl(server, tool, validated);
  const method = (tool.method || 'POST').toUpperCase();
  const timeout = resolveTimeout(tool);
  const retries = resolveRetries(tool);

  const baseHeaders = mergeHeaders(
    { 'Content-Type': 'application/json', Accept: 'application/json' },
    server.defaultHeaders,
    tool.headers,
    headersOverride,
    requestId ? { 'X-Request-Id': requestId } : null
  );

  let bodyForRequest;
  let paramsForRequest;
  if (method === 'GET' || method === 'DELETE') {
    paramsForRequest = { ...(tool.queryParams || {}), ...(validated || {}) };
  } else {
    bodyForRequest = validated;
    paramsForRequest = { ...(tool.queryParams || {}) };
  }

  // If the tool/server explicitly asks for form-urlencoded (some upstream APIs
  // like Freelancer's messaging endpoint require it), serialize the body as
  // x-www-form-urlencoded BEFORE handing it to axios. Without this we'd send
  // JSON and the upstream would reject it.
  if (bodyForRequest && typeof bodyForRequest === 'object') {
    const ct = baseHeaders['Content-Type'] || baseHeaders['content-type'] || '';
    if (/application\/x-www-form-urlencoded/i.test(ct)) {
      const usp = new URLSearchParams();
      for (const [k, v] of Object.entries(bodyForRequest)) {
        if (v === undefined || v === null) continue;
        if (Array.isArray(v)) for (const item of v) usp.append(k, item);
        else usp.append(k, v);
      }
      bodyForRequest = usp.toString();
    }
  }

  // Sanity-check URL
  try {
    // eslint-disable-next-line no-new
    new URL(url);
  } catch (_) {
    throw ApiError.badRequest(`Resolved tool URL is invalid: ${url}`);
  }

  let axiosConfig;
  try {
    axiosConfig = applyAuth(
      {
        method,
        url,
        headers: baseHeaders,
        params: paramsForRequest,
        data: bodyForRequest,
        timeout,
      },
      server,
      tool,
      callerHeaders
    );
  } catch (err) {
    // Pass-through misconfig (missing inbound header) lands here. Record the
    // failed attempt so the admin can see it in Logs, then re-throw.
    await executionRepo.record({
      serverId: server._id,
      toolId: tool._id,
      serverSlug: server.slug,
      toolName: tool.name,
      requestId,
      request: { method, url, headers: redactHeaders(baseHeaders), query: paramsForRequest, body: null },
      status: 'validation_error',
      attempts: 0,
      durationMs: Date.now() - started,
      error: { message: err.message, code: err.code || 'TOOL_AUTH_MISSING', details: err.details || null },
    });
    throw err;
  }

  try {
    const { response, attempts, duration } = await requestWithRetry(axiosConfig, {
      retries,
      retryDelayMs: 300,
    });

    const truncated = safeTruncateForLog(response.data);
    const isUpstreamError = response.status >= 400;
    const logStatus = isUpstreamError ? 'upstream_error' : 'success';

    await executionRepo.record({
      serverId: server._id,
      toolId: tool._id,
      serverSlug: server.slug,
      toolName: tool.name,
      requestId,
      request: {
        method,
        url,
        headers: redactHeaders(baseHeaders),
        query: paramsForRequest,
        body: safeTruncateForLog(bodyForRequest).value,
      },
      response: {
        status: response.status,
        headers: redactHeaders(response.headers || {}),
        body: truncated.value,
        bodyTruncated: truncated.truncated,
      },
      status: logStatus,
      attempts,
      durationMs: duration,
      error: isUpstreamError
        ? {
            message: `Upstream returned HTTP ${response.status}`,
            code: 'UPSTREAM_HTTP_ERROR',
            details: { status: response.status },
          }
        : undefined,
    });

    if (isUpstreamError) {
      throw ApiError.badGateway(`Upstream tool returned HTTP ${response.status}`, {
        upstreamStatus: response.status,
        upstreamBody: truncated.value,
      });
    }

    return {
      status: 'success',
      response: response.data,
      statusCode: response.status,
      durationMs: duration,
      attempts,
    };
  } catch (err) {
    const isTimeout = err.code === 'ECONNABORTED' || /timeout/i.test(err.message || '');
    const status = isTimeout ? 'timeout' : err instanceof ApiError ? 'upstream_error' : 'internal_error';

    if (!(err instanceof ApiError)) {
      // Only log here if we did not already log inside the success branch
      await executionRepo.record({
        serverId: server._id,
        toolId: tool._id,
        serverSlug: server.slug,
        toolName: tool.name,
        requestId,
        request: {
          method,
          url,
          headers: redactHeaders(baseHeaders),
          query: paramsForRequest,
          body: safeTruncateForLog(bodyForRequest).value,
        },
        status,
        attempts: err.attempts || 1,
        durationMs: err.duration ?? Date.now() - started,
        error: {
          message: err.message,
          code: err.code || 'UNKNOWN',
          details: { stack: env.nodeEnv === 'production' ? undefined : err.stack },
        },
      });
    }

    if (err instanceof ApiError) throw err;
    if (isTimeout) {
      throw ApiError.gatewayTimeout(`Tool "${tool.name}" timed out after ${timeout}ms`);
    }
    logger.error(`Tool execution failed (${server.slug}/${tool.name}): ${err.message}`);
    throw ApiError.badGateway(`Tool execution failed: ${err.message}`);
  }
}

module.exports = { executeTool };
