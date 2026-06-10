'use strict';

const toolRepo = require('./tool.repository');
const serverRepo = require('../mcpServer/mcpServer.repository');
const ApiError = require('../../utils/ApiError');
const env = require('../../config/env');
const cache = require('../../cache/cache.service');
const { parseOpenApi } = require('../../utils/openApiParser');
const { executeTool } = require('../execution/execution.engine');

const TOOL_CACHE_TTL = 60;

function buildToolCacheKey(serverSlug, toolName) {
  return cache.buildKey('tool', serverSlug, toolName);
}

function buildToolListCacheKey(serverSlug) {
  return cache.buildKey('tools', serverSlug);
}

async function assertServerExists(serverId) {
  const server = await serverRepo.findById(serverId, { lean: true });
  if (!server) throw ApiError.notFound('MCP server not found for serverId');
  return server;
}

async function invalidateToolCache(server) {
  if (!server) return;
  await cache.delByPattern(`mcp:tool:${server.slug}:*`);
  await cache.del(buildToolListCacheKey(server.slug));
}

function validateTimeout(timeout) {
  if (timeout === null || timeout === undefined) return;
  if (timeout > env.exec.maxTimeoutMs) {
    throw ApiError.badRequest(
      `timeout exceeds MAX_TOOL_TIMEOUT_MS (${env.exec.maxTimeoutMs}ms)`,
      { timeout }
    );
  }
}

// Rule: a leading "/" marks the endpoint as a relative path (needs baseUrl
// to resolve); anything else is treated as a full URL by the runtime.
function isRelativePath(s) {
  return typeof s === 'string' && s.trim().startsWith('/');
}

/**
 * Enforce: an HTTP tool's URL must be fully resolvable at save time. Either
 *   (a) the tool's endpoint doesn't start with "/" (a full URL), or
 *   (b) the parent server has a baseUrl (so the relative path can be joined).
 * Otherwise the tool would always 400 at execution time — reject early.
 */
function assertEndpointResolvable(server, endpoint, executionType, toolName) {
  if (executionType && executionType !== 'http') return;
  if (!isRelativePath(endpoint)) return;          // (a) full URL — no baseUrl needed
  if (server && server.baseUrl) return;           // (b) baseUrl available — can join

  throw ApiError.unprocessable(
    `Server "${server.slug}" has no baseUrl, so tool "${toolName}" must use a full URL ` +
    `(e.g. "https://api.example.com/posts"). Either set baseUrl on the server, ` +
    `or remove the leading "/" so the endpoint is treated as a full URL.`,
    { serverSlug: server.slug, endpoint: endpoint || null }
  );
}

async function createTool(input) {
  const server = await assertServerExists(input.serverId);

  const dup = await toolRepo.existsByServerAndName(server._id, input.name);
  if (dup) {
    throw ApiError.conflict(
      `Tool with name "${input.name}" already exists on server "${server.slug}"`
    );
  }

  const execType = input.executionType || 'http';
  if (execType === 'http' && !input.endpoint) {
    throw ApiError.unprocessable(
      `endpoint is required for HTTP tool "${input.name}"`
    );
  }
  assertEndpointResolvable(server, input.endpoint, execType, input.name);

  validateTimeout(input.timeout);

  const created = await toolRepo.create({ ...input, serverId: server._id });
  await invalidateToolCache(server);
  return created;
}

async function getToolById(id) {
  const tool = await toolRepo.findById(id, { lean: true });
  if (!tool) throw ApiError.notFound('Tool not found');
  return tool;
}

async function getEnabledToolByServerSlugAndName(serverSlug, toolName) {
  const key = buildToolCacheKey(serverSlug, toolName);
  const cached = await cache.get(key);
  if (cached) return cached;

  const server = await serverRepo.findBySlug(serverSlug, { lean: true, activeOnly: true });
  if (!server) return null;

  const tool = await toolRepo.findByServerAndName(server._id, toolName, {
    lean: true,
    enabledOnly: true,
  });
  if (!tool) return null;

  const bundle = { server, tool };
  await cache.set(key, bundle, TOOL_CACHE_TTL);
  return bundle;
}

async function listEnabledToolsForServerSlug(serverSlug) {
  const key = buildToolListCacheKey(serverSlug);
  const cached = await cache.get(key);
  if (cached) return cached;

  const server = await serverRepo.findBySlug(serverSlug, { lean: true, activeOnly: true });
  if (!server) return null;

  const tools = await toolRepo.listByServer(server._id, { enabledOnly: true });
  const bundle = { server, tools };
  await cache.set(key, bundle, TOOL_CACHE_TTL);
  return bundle;
}

async function updateTool(id, patch) {
  const before = await toolRepo.findById(id, { lean: true });
  if (!before) throw ApiError.notFound('Tool not found');

  if (patch.name && patch.name !== before.name) {
    const dup = await toolRepo.existsByServerAndName(before.serverId, patch.name);
    if (dup) throw ApiError.conflict(`Tool name "${patch.name}" already exists for this server`);
  }
  if (patch.serverId && String(patch.serverId) !== String(before.serverId)) {
    throw ApiError.badRequest('serverId is immutable on a tool; delete and recreate to move it.');
  }
  validateTimeout(patch.timeout);

  // Re-validate endpoint resolvability against the *post-patch* state, since
  // either the endpoint OR the execution type may have changed.
  const server = await serverRepo.findById(before.serverId, { lean: true });
  const nextEndpoint = patch.endpoint !== undefined ? patch.endpoint : before.endpoint;
  const nextExecType = patch.executionType !== undefined ? patch.executionType : before.executionType;
  assertEndpointResolvable(server, nextEndpoint, nextExecType, patch.name || before.name);

  const updated = await toolRepo.updateById(id, patch);
  await invalidateToolCache(server);
  return updated.toJSON();
}

async function deleteTool(id) {
  const before = await toolRepo.findById(id, { lean: true });
  if (!before) throw ApiError.notFound('Tool not found');
  await toolRepo.deleteById(id);
  const server = await serverRepo.findById(before.serverId, { lean: true });
  await invalidateToolCache(server);
  return { deletedId: String(before._id), name: before.name };
}

async function listTools(query) {
  return toolRepo.list(query);
}

/**
 * Pick a fresh tool name that doesn't collide on the same server. Tries
 * `<name>_copy`, then `<name>_copy_2`, `<name>_copy_3`, ... up to 50 attempts.
 * Tool name regex caps total length at 80, so we trim the base if needed.
 */
async function pickFreeToolName(serverId, baseName) {
  const trim = (n) => n.slice(0, 80);
  const candidates = [trim(`${baseName}_copy`)];
  for (let i = 2; i <= 50; i += 1) candidates.push(trim(`${baseName}_copy_${i}`));
  for (const name of candidates) {
    if (!/^[a-zA-Z][a-zA-Z0-9_.\-]{0,79}$/.test(name)) continue;
    if (!(await toolRepo.existsByServerAndName(serverId, name))) return name;
  }
  throw ApiError.conflict(
    `Could not pick a free tool name derived from "${baseName}" — too many copies?`
  );
}

/**
 * Duplicate a single tool on the same server. The new tool gets an
 * auto-suffixed name (`<name>_copy` / `<name>_copy_2` / ...), and all other
 * fields — including auth, headers, schema, toolAuthType-related override —
 * are copied byte-for-byte so the duplicate is functional from the start.
 *
 * Optional overrides: { name } — must be unique on this server if given.
 */
async function duplicateTool(id, overrides = {}) {
  const original = await toolRepo.findById(id, { lean: true });
  if (!original) throw ApiError.notFound('Tool not found');
  const server = await serverRepo.findById(original.serverId, { lean: true });
  if (!server) throw ApiError.notFound('Parent MCP server not found');

  let newName;
  if (overrides.name) {
    newName = String(overrides.name).trim();
    if (!/^[a-zA-Z][a-zA-Z0-9_.\-]{0,79}$/.test(newName)) {
      throw ApiError.badRequest(
        'Override name is invalid; must start with a letter and only contain letters, digits, _, ., -',
        { name: newName }
      );
    }
    if (await toolRepo.existsByServerAndName(server._id, newName)) {
      throw ApiError.conflict(
        `Tool with name "${newName}" already exists on server "${server.slug}"`
      );
    }
  } else {
    newName = await pickFreeToolName(server._id, original.name);
  }

  const payload = {
    serverId: server._id,
    name: newName,
    description: original.description || '',
    method: original.method,
    endpoint: original.endpoint || null,
    headers: { ...(original.headers || {}) },
    queryParams: { ...(original.queryParams || {}) },
    inputSchema: original.inputSchema || { type: 'object', properties: {} },
    outputSchema: original.outputSchema || null,
    executionType: original.executionType || 'http',
    timeout: original.timeout ?? null,
    retries: typeof original.retries === 'number' ? original.retries : 0,
    enabled: original.enabled !== false,
    auth: original.auth ? { ...original.auth } : { type: 'inherit' },
    disableServerToolAuth: original.disableServerToolAuth === true,
    version: original.version || '1.0.0',
    metadata: { ...(original.metadata || {}) },
  };

  const created = await toolRepo.create(payload);
  await invalidateToolCache(server);
  return {
    tool: created.toJSON ? created.toJSON() : created,
    source: { id: String(original._id), name: original.name },
  };
}

async function bulkImportFromOpenApi(serverId, spec, dryRun = false) {
  let server = await assertServerExists(serverId);
  const tools = parseOpenApi(spec);

  // If the server has no baseUrl but the spec advertises one in `servers[0].url`,
  // adopt it. This makes "create server → import" a one-shot flow instead of
  // forcing the user to PATCH the server before every import.
  let baseUrlAdopted = null;
  if (!server.baseUrl) {
    const specBase = Array.isArray(spec && spec.servers) && spec.servers[0] && spec.servers[0].url;
    if (specBase && /^https?:\/\//i.test(String(specBase).trim())) {
      if (!dryRun) {
        await serverRepo.updateById(server._id, { baseUrl: specBase });
        const fresh = await serverRepo.findById(server._id, { lean: true });
        if (fresh) server = fresh;
      } else {
        server = { ...server, baseUrl: specBase };
      }
      baseUrlAdopted = specBase;
    }
  }

  if (dryRun) {
    return {
      tools,
      server: { _id: server._id, slug: server.slug, name: server.name, baseUrl: server.baseUrl },
      baseUrlAdopted,
    };
  }

  const results = { created: [], skipped: [], errors: [], baseUrlAdopted };
  for (const toolDef of tools) {
    try {
      const dup = await toolRepo.existsByServerAndName(server._id, toolDef.name);
      if (dup) {
        results.skipped.push({ name: toolDef.name, reason: 'already exists' });
        continue;
      }
      // Same guard as createTool — but bypass the dup check (already done) and
      // server lookup (already in hand) to keep the import loop fast.
      assertEndpointResolvable(server, toolDef.endpoint, toolDef.executionType || 'http', toolDef.name);
      const created = await toolRepo.create({ ...toolDef, serverId: server._id });
      results.created.push(created.toJSON ? created.toJSON() : created);
    } catch (e) {
      results.errors.push({ name: toolDef.name, error: e.message });
    }
  }
  await invalidateToolCache(server);
  return results;
}

/**
 * Admin-side "Try It": execute a tool from the admin UI against the configured
 * upstream, bypassing the public `mcpAccessKey` and IP-filter guards (the admin
 * is already authenticated). Caller-supplied headers are passed through so the
 * admin can preview Tool-Auth pass-through behavior without hitting the public
 * URL with a real client.
 *
 * Returns the same shape as executeTool, with the parent server's slug + tool
 * name added so the UI can surface them.
 */
async function tryTool(id, { input = {}, callerHeaders = {} } = {}) {
  const tool = await toolRepo.findById(id, { lean: true });
  if (!tool) throw ApiError.notFound('Tool not found');
  const server = await serverRepo.findById(tool.serverId, { lean: true });
  if (!server) throw ApiError.notFound('Parent MCP server not found');
  if (tool.enabled === false) {
    throw ApiError.badRequest(
      `Tool "${tool.name}" is disabled. Enable it before running a try.`
    );
  }

  const result = await executeTool({
    server,
    tool,
    input: input || {},
    requestId: `admin-try:${Date.now()}`,
    callerHeaders: callerHeaders || {},
  });

  return {
    ...result,
    tool: tool.name,
    server: server.slug,
  };
}

module.exports = {
  createTool,
  getToolById,
  getEnabledToolByServerSlugAndName,
  listEnabledToolsForServerSlug,
  updateTool,
  deleteTool,
  listTools,
  invalidateToolCache,
  bulkImportFromOpenApi,
  duplicateTool,
  tryTool,
};
