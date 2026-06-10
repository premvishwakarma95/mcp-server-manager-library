'use strict';

/**
 * Idempotent seed script. Creates a sample MCP server ("cloak-browser-mcp") and a
 * handful of tools so the platform can be exercised end-to-end immediately.
 *
 * Run with:  npm run seed
 *
 * The seeded tools point at httpbin.org by default so they actually return
 * something. Override server.baseUrl after seeding to wire them to a real backend.
 */

const { connect, disconnect } = require('../database/mongo');
const { McpServer } = require('../modules/mcpServer/mcpServer.model');
const { McpTool } = require('../modules/tool/tool.model');
const logger = require('../utils/logger');

const SERVER_SPEC = {
  name: 'Cloak Browser MCP',
  slug: 'cloak-browser-mcp',
  description: 'Demo MCP server that exposes stealth-browser style tools dynamically.',
  status: 'active',
  authType: 'none',
  baseUrl: 'https://httpbin.org',
  defaultHeaders: { 'X-Mcp-Server': 'cloak-browser-mcp' },
  metadata: { tags: ['demo', 'browser'] },
  version: '1.0.0',
};

const TOOLS = [
  {
    name: 'create_profile',
    description: 'Create a new browser profile with a given user agent and locale.',
    method: 'POST',
    endpoint: '/anything/create_profile',
    executionType: 'http',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', minLength: 1, maxLength: 64, description: 'Profile name' },
        userAgent: { type: 'string', description: 'Optional custom User-Agent' },
        locale: { type: 'string', default: 'en-US' },
        proxy: { type: 'string', format: 'uri', description: 'Optional upstream proxy URL' },
      },
      required: ['name'],
      additionalProperties: false,
    },
    timeout: 15000,
    enabled: true,
  },
  {
    name: 'start_browser',
    description: 'Start a stealth browser session using a profile.',
    method: 'POST',
    endpoint: '/anything/start_browser',
    executionType: 'http',
    inputSchema: {
      type: 'object',
      properties: {
        profileId: { type: 'string', description: 'Profile id returned by create_profile' },
        headless: { type: 'boolean', default: true },
      },
      required: ['profileId'],
      additionalProperties: false,
    },
    enabled: true,
  },
  {
    name: 'stop_browser',
    description: 'Stop an active browser session.',
    method: 'POST',
    endpoint: '/anything/stop_browser',
    executionType: 'http',
    inputSchema: {
      type: 'object',
      properties: { sessionId: { type: 'string' } },
      required: ['sessionId'],
      additionalProperties: false,
    },
    enabled: true,
  },
  {
    name: 'echo',
    description: 'Local echo tool — bounces input back. Useful for testing without any upstream.',
    method: 'POST',
    executionType: 'echo',
    inputSchema: {
      type: 'object',
      properties: { message: { type: 'string' } },
      additionalProperties: true,
    },
    enabled: true,
  },
];

async function upsertServer() {
  const existing = await McpServer.findOne({ slug: SERVER_SPEC.slug });
  if (existing) {
    Object.assign(existing, SERVER_SPEC);
    await existing.save();
    logger.info(`Updated existing MCP server: ${existing.slug}`);
    return existing;
  }
  const created = await McpServer.create(SERVER_SPEC);
  logger.info(`Created MCP server: ${created.slug}`);
  return created;
}

async function upsertTool(server, spec) {
  const existing = await McpTool.findOne({ serverId: server._id, name: spec.name });
  if (existing) {
    Object.assign(existing, spec);
    await existing.save();
    logger.info(`Updated tool: ${server.slug}/${spec.name}`);
    return existing;
  }
  const created = await McpTool.create({ ...spec, serverId: server._id });
  logger.info(`Created tool: ${server.slug}/${spec.name}`);
  return created;
}

async function main() {
  await connect();
  const server = await upsertServer();
  for (const tool of TOOLS) {
    // eslint-disable-next-line no-await-in-loop
    await upsertTool(server, tool);
  }
  logger.info('Seed complete.');
  logger.info(`Manifest URL:  GET /${server.slug}`);
  logger.info(`Example exec:  POST /${server.slug}/tools/echo  body={"message":"hi"}`);
  await disconnect();
}

main().catch(async (err) => {
  logger.error(`Seed failed: ${err.message}`, { stack: err.stack });
  try {
    await disconnect();
  } catch (_) {
    /* ignore */
  }
  process.exit(1);
});
