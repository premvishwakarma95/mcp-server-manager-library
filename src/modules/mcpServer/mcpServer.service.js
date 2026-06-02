'use strict';

const repo = require('./mcpServer.repository');
const toolRepo = require('../tool/tool.repository');
const ApiError = require('../../utils/ApiError');
const { slugify, isValidSlug } = require('../../utils/slugify');
const cache = require('../../cache/cache.service');
const logger = require('../../utils/logger');

const SERVER_CACHE_TTL = 60; // seconds

function buildSlugCacheKey(slug) {
  return cache.buildKey('server', 'slug', slug);
}

async function invalidateServerCache(server) {
  if (!server) return;
  await cache.del(buildSlugCacheKey(server.slug));
}

async function createServer(input) {
  const slug = input.slug ? slugify(input.slug) : slugify(input.name);
  if (!isValidSlug(slug)) {
    throw ApiError.badRequest('slug is invalid; must match /^[a-z0-9]+(-[a-z0-9]+)*$/', { slug });
  }

  const existing = await repo.existsBySlug(slug);
  if (existing) throw ApiError.conflict(`MCP server with slug "${slug}" already exists`);

  const created = await repo.create({ ...input, slug });
  await invalidateServerCache(created);
  return created;
}

async function getServerById(id) {
  const server = await repo.findById(id, { lean: true });
  if (!server) throw ApiError.notFound('MCP server not found');
  return server;
}

async function getServerBySlug(slug, { activeOnly = false, useCache = true } = {}) {
  const cacheKey = buildSlugCacheKey(slug);
  if (useCache) {
    const cached = await cache.get(cacheKey);
    if (cached) {
      if (activeOnly && cached.status !== 'active') return null;
      return cached;
    }
  }
  const server = await repo.findBySlug(slug, { lean: true });
  if (server) await cache.set(cacheKey, server, SERVER_CACHE_TTL);
  if (!server) return null;
  if (activeOnly && server.status !== 'active') return null;
  return server;
}

async function updateServer(id, patch) {
  const before = await repo.findById(id, { lean: true });
  if (!before) throw ApiError.notFound('MCP server not found');

  if (patch.slug && patch.slug !== before.slug) {
    const slug = slugify(patch.slug);
    if (!isValidSlug(slug)) throw ApiError.badRequest('slug is invalid', { slug });
    const dup = await repo.existsBySlug(slug);
    if (dup) throw ApiError.conflict(`MCP server with slug "${slug}" already exists`);
    patch.slug = slug;
  }

  const updated = await repo.updateById(id, patch);
  await invalidateServerCache(before);
  if (updated && updated.slug !== before.slug) await invalidateServerCache(updated.toObject());
  return updated.toJSON();
}

async function deleteServer(id) {
  const before = await repo.findById(id, { lean: true });
  if (!before) throw ApiError.notFound('MCP server not found');

  // Cascade: delete all tools owned by this server.
  await toolRepo.deleteManyByServerId(before._id);
  await repo.deleteById(id);
  await invalidateServerCache(before);
  return { deletedId: String(before._id), slug: before.slug };
}

async function listServers(query) {
  return repo.list(query);
}

/**
 * Pick a fresh slug that doesn't collide. Tries `<base>-copy`, then
 * `<base>-copy-2`, `<base>-copy-3`, ... up to 50 attempts.
 */
async function pickFreeSlug(baseSlug) {
  const candidates = [`${baseSlug}-copy`];
  for (let i = 2; i <= 50; i += 1) candidates.push(`${baseSlug}-copy-${i}`);
  for (const candidate of candidates) {
    const slug = slugify(candidate);
    if (!isValidSlug(slug)) continue;
    if (!(await repo.existsBySlug(slug))) return slug;
  }
  throw ApiError.conflict(`Could not pick a free slug derived from "${baseSlug}" — too many copies?`);
}

/**
 * Duplicate a server AND all its tools. Returns the new server plus a summary
 * of how many tools were cloned / skipped.
 *
 * Optional overrides: { name, slug } — slug is auto-suffixed if not provided.
 * Secrets (auth.token, auth.password, mcpAccessKey) are copied byte-for-byte
 * so the duplicate is fully functional from the start.
 */
async function duplicateServer(id, overrides = {}) {
  const original = await repo.findById(id, { lean: true });
  if (!original) throw ApiError.notFound('MCP server not found');

  const newSlug = overrides.slug
    ? (() => {
        const s = slugify(overrides.slug);
        if (!isValidSlug(s)) throw ApiError.badRequest('Override slug is invalid', { slug: s });
        return s;
      })()
    : await pickFreeSlug(original.slug);

  if (await repo.existsBySlug(newSlug)) {
    throw ApiError.conflict(`MCP server with slug "${newSlug}" already exists`);
  }

  const newName = (overrides.name || `${original.name} (Copy)`).slice(0, 120);

  const payload = {
    name: newName,
    slug: newSlug,
    description: original.description || '',
    status: original.status,
    authType: original.authType,
    auth: original.auth ? { ...original.auth } : { type: 'none' },
    baseUrl: original.baseUrl || null,
    defaultHeaders: { ...(original.defaultHeaders || {}) },
    mcpAccessKey: original.mcpAccessKey || null,
    mcpAccessKeyHeader: original.mcpAccessKeyHeader || 'x-mcp-key',
    mcpIpFilterEnabled: !!original.mcpIpFilterEnabled,
    mcpAllowedIps: Array.isArray(original.mcpAllowedIps) ? [...original.mcpAllowedIps] : [],
    toolAuthType: original.toolAuthType || 'none',
    toolAuthHeaderName: original.toolAuthHeaderName || 'x-api-key',
    metadata: { ...(original.metadata || {}) },
    version: original.version || '1.0.0',
  };

  const createdServer = await repo.create(payload);
  await invalidateServerCache(createdServer);

  // Clone every tool (enabled + disabled). Per-tool create runs in the loop so
  // a single bad tool doesn't poison the rest; errors are surfaced in the summary.
  const sourceTools = await toolRepo.listByServer(original._id, { enabledOnly: false });
  const cloned = [];
  const errors = [];
  for (const tool of sourceTools) {
    try {
      const toolPayload = {
        serverId: createdServer._id,
        name: tool.name,
        description: tool.description || '',
        method: tool.method,
        endpoint: tool.endpoint || null,
        headers: { ...(tool.headers || {}) },
        queryParams: { ...(tool.queryParams || {}) },
        inputSchema: tool.inputSchema || { type: 'object', properties: {} },
        outputSchema: tool.outputSchema || null,
        executionType: tool.executionType || 'http',
        timeout: tool.timeout ?? null,
        retries: typeof tool.retries === 'number' ? tool.retries : 0,
        enabled: tool.enabled !== false,
        auth: tool.auth ? { ...tool.auth } : { type: 'inherit' },
        disableServerToolAuth: tool.disableServerToolAuth === true,
        version: tool.version || '1.0.0',
        metadata: { ...(tool.metadata || {}) },
      };
      const createdTool = await toolRepo.create(toolPayload);
      cloned.push({ name: createdTool.name, id: String(createdTool._id) });
    } catch (e) {
      logger.warn(`[duplicateServer] failed to clone tool "${tool.name}": ${e.message}`);
      errors.push({ name: tool.name, error: e.message });
    }
  }

  return {
    server: createdServer.toJSON ? createdServer.toJSON() : createdServer,
    toolsCloned: cloned.length,
    toolsSkipped: errors.length,
    errors,
    source: { id: String(original._id), slug: original.slug, name: original.name },
  };
}

/**
 * Snapshot a server + all its tools as a portable JSON document.
 *
 * Secrets (auth.token, auth.password, mcpAccessKey) are stripped by default and
 * replaced with the marker "***". Pass `includeSecrets: true` to embed raw
 * values — only for trusted, encrypted transports.
 */
async function exportServer(id, { includeSecrets = false } = {}) {
  const server = await repo.findById(id, { lean: true });
  if (!server) throw ApiError.notFound('MCP server not found');
  const tools = await toolRepo.listByServer(server._id, { enabledOnly: false });

  const maskSecret = (v) => (includeSecrets ? v : (v ? '***' : v));
  const cleanAuth = (a) => {
    if (!a) return a;
    return {
      type: a.type,
      token: maskSecret(a.token),
      headerName: a.headerName,
      username: a.username,
      password: maskSecret(a.password),
      secretEnvVar: a.secretEnvVar,
    };
  };

  return {
    format: 'mcp-server-export',
    version: '1.0',
    exportedAt: new Date().toISOString(),
    secretsIncluded: !!includeSecrets,
    server: {
      name: server.name,
      slug: server.slug,
      description: server.description || '',
      status: server.status,
      authType: server.authType,
      auth: cleanAuth(server.auth),
      baseUrl: server.baseUrl || null,
      defaultHeaders: server.defaultHeaders || {},
      mcpAccessKey: maskSecret(server.mcpAccessKey || null),
      mcpAccessKeyHeader: server.mcpAccessKeyHeader || 'x-mcp-key',
      mcpIpFilterEnabled: !!server.mcpIpFilterEnabled,
      mcpAllowedIps: Array.isArray(server.mcpAllowedIps) ? server.mcpAllowedIps : [],
      toolAuthType: server.toolAuthType || 'none',
      toolAuthHeaderName: server.toolAuthHeaderName || 'x-api-key',
      metadata: server.metadata || {},
      version: server.version || '1.0.0',
    },
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description || '',
      method: t.method,
      endpoint: t.endpoint || null,
      headers: t.headers || {},
      queryParams: t.queryParams || {},
      inputSchema: t.inputSchema || { type: 'object', properties: {} },
      outputSchema: t.outputSchema || null,
      executionType: t.executionType || 'http',
      timeout: t.timeout ?? null,
      retries: typeof t.retries === 'number' ? t.retries : 0,
      enabled: t.enabled !== false,
      auth: cleanAuth(t.auth),
      disableServerToolAuth: t.disableServerToolAuth === true,
      version: t.version || '1.0.0',
      metadata: t.metadata || {},
    })),
  };
}

/**
 * Inverse of exportServer: take a JSON document previously produced by
 * exportServer (or hand-authored to that shape) and materialize a server +
 * tools from it.
 *
 * Slug handling mirrors duplicateServer: if `overrides.slug` is given, use it
 * (must be free); otherwise prefer the exported slug, falling back to an
 * auto-suffixed `-copy` variant on collision so re-importing on the same
 * instance never fails.
 *
 * Secrets that appear as the literal mask "***" are dropped to null — those
 * are sentinel values from `exportServer({ includeSecrets:false })`, not real
 * credentials, and persisting them would create a confusingly "configured"
 * server that can't actually authenticate.
 */
async function importServer(payload, overrides = {}) {
  if (!payload || typeof payload !== 'object') {
    throw ApiError.badRequest('Import payload must be a JSON object');
  }
  if (payload.format !== 'mcp-server-export') {
    throw ApiError.badRequest(
      'Unrecognized import format — expected "mcp-server-export"',
      { format: payload.format || null }
    );
  }
  const src = payload.server || {};
  const srcTools = Array.isArray(payload.tools) ? payload.tools : [];
  if (!src.name || !src.slug) {
    throw ApiError.badRequest('Import payload missing server.name or server.slug');
  }

  let targetSlug;
  if (overrides.slug) {
    const s = slugify(overrides.slug);
    if (!isValidSlug(s)) throw ApiError.badRequest('Override slug is invalid', { slug: s });
    if (await repo.existsBySlug(s)) throw ApiError.conflict(`Slug "${s}" already exists`);
    targetSlug = s;
  } else {
    const original = slugify(src.slug);
    if (!isValidSlug(original)) {
      throw ApiError.badRequest('Imported slug is invalid', { slug: src.slug });
    }
    targetSlug = (await repo.existsBySlug(original)) ? await pickFreeSlug(original) : original;
  }

  const targetName = String(overrides.name || src.name).slice(0, 120);

  const unmask = (v) => (v === '***' ? null : v);
  const cleanAuth = (a) => {
    if (!a) return { type: 'none' };
    return {
      type: a.type || 'none',
      token: unmask(a.token),
      headerName: a.headerName || null,
      username: a.username || null,
      password: unmask(a.password),
      secretEnvVar: a.secretEnvVar || null,
    };
  };

  const serverPayload = {
    name: targetName,
    slug: targetSlug,
    description: src.description || '',
    status: src.status || 'active',
    authType: src.authType || 'none',
    auth: cleanAuth(src.auth),
    baseUrl: src.baseUrl || null,
    defaultHeaders: src.defaultHeaders || {},
    mcpAccessKey: unmask(src.mcpAccessKey),
    mcpAccessKeyHeader: src.mcpAccessKeyHeader || 'x-mcp-key',
    mcpIpFilterEnabled: !!src.mcpIpFilterEnabled,
    mcpAllowedIps: Array.isArray(src.mcpAllowedIps) ? src.mcpAllowedIps : [],
    toolAuthType: src.toolAuthType || 'none',
    toolAuthHeaderName: src.toolAuthHeaderName || 'x-api-key',
    metadata: src.metadata || {},
    version: src.version || '1.0.0',
  };

  const createdServer = await repo.create(serverPayload);
  await invalidateServerCache(createdServer);

  const imported = [];
  const errors = [];
  for (const t of srcTools) {
    try {
      const toolPayload = {
        serverId: createdServer._id,
        name: t.name,
        description: t.description || '',
        method: t.method,
        endpoint: t.endpoint || null,
        headers: { ...(t.headers || {}) },
        queryParams: { ...(t.queryParams || {}) },
        inputSchema: t.inputSchema || { type: 'object', properties: {} },
        outputSchema: t.outputSchema || null,
        executionType: t.executionType || 'http',
        timeout: t.timeout ?? null,
        retries: typeof t.retries === 'number' ? t.retries : 0,
        enabled: t.enabled !== false,
        auth: cleanAuth(t.auth),
        disableServerToolAuth: t.disableServerToolAuth === true,
        version: t.version || '1.0.0',
        metadata: { ...(t.metadata || {}) },
      };
      const createdTool = await toolRepo.create(toolPayload);
      imported.push({ name: createdTool.name, id: String(createdTool._id) });
    } catch (e) {
      logger.warn(`[importServer] failed to import tool "${t.name}": ${e.message}`);
      errors.push({ name: t.name || '(unnamed)', error: e.message });
    }
  }

  return {
    server: createdServer.toJSON ? createdServer.toJSON() : createdServer,
    toolsImported: imported.length,
    toolsSkipped: errors.length,
    errors,
    secretsIncluded: !!payload.secretsIncluded,
    source: { slug: src.slug, name: src.name },
  };
}

module.exports = {
  createServer,
  getServerById,
  getServerBySlug,
  updateServer,
  deleteServer,
  listServers,
  duplicateServer,
  exportServer,
  importServer,
  invalidateServerCache,
};
