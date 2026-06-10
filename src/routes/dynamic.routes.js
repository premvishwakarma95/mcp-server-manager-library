'use strict';

const { Router } = require('express');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { success } = require('../utils/ApiResponse');
const toolService = require('../modules/tool/tool.service');
const { executeTool } = require('../modules/execution/execution.engine');
const { buildManifest } = require('../modules/execution/mcpManifest');
const { executionLimiter } = require('../middlewares/rateLimiter');
const { guardServer } = require('../middlewares/serverGuards');
const mcpRoutes = require('../modules/mcp/mcp.routes');

const router = Router();

// MCP JSON-RPC transport endpoint. Mounted FIRST so the more-specific
// /:serverSlug/mcp path is matched before /:serverSlug or /:serverSlug/tools.
router.use('/:serverSlug/mcp', mcpRoutes);

function buildPublicBaseUrl(req) {
  const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'http').toString().split(',')[0];
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  if (!host) return '';
  return `${proto}://${host}`;
}

/**
 * GET /:serverSlug
 * Returns an MCP-compatible manifest for the server (all enabled tools).
 *
 * @swagger
 * /{serverSlug}:
 *   get:
 *     tags: [Dynamic MCP]
 *     summary: Get the MCP manifest for a server (list of tools)
 *     parameters:
 *       - in: path
 *         name: serverSlug
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: MCP manifest }
 *       404: { description: Server not found or inactive }
 */
router.get(
  '/:serverSlug',
  ...guardServer(),
  asyncHandler(async (req, res) => {
    const bundle = await toolService.listEnabledToolsForServerSlug(req.mcpServer.slug);
    if (!bundle) throw ApiError.notFound(`MCP server "${req.mcpServer.slug}" not found or inactive`);
    const manifest = buildManifest(bundle.server, bundle.tools, buildPublicBaseUrl(req));
    return success(res, manifest, 'OK');
  })
);

/**
 * GET /:serverSlug/tools
 * Convenience alias to list just the tools array of the manifest.
 *
 * @swagger
 * /{serverSlug}/tools:
 *   get:
 *     tags: [Dynamic MCP]
 *     summary: List enabled tools for a server
 *     parameters:
 *       - in: path
 *         name: serverSlug
 *         required: true
 *         schema: { type: string }
 */
router.get(
  '/:serverSlug/tools',
  ...guardServer(),
  asyncHandler(async (req, res) => {
    const bundle = await toolService.listEnabledToolsForServerSlug(req.mcpServer.slug);
    if (!bundle) throw ApiError.notFound(`MCP server "${req.mcpServer.slug}" not found or inactive`);
    const manifest = buildManifest(bundle.server, bundle.tools, buildPublicBaseUrl(req));
    return success(res, { tools: manifest.tools }, 'OK');
  })
);

/**
 * POST /:serverSlug/tools/:toolName
 * Execute a tool dynamically. The body is validated against the tool's stored
 * JSON Schema, then forwarded (for HTTP tools) to the configured upstream.
 *
 * @swagger
 * /{serverSlug}/tools/{toolName}:
 *   post:
 *     tags: [Dynamic MCP]
 *     summary: Execute a tool dynamically
 *     parameters:
 *       - in: path
 *         name: serverSlug
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: toolName
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema: { type: object }
 *     responses:
 *       200: { description: Tool result }
 *       404: { description: Server or tool not found }
 *       422: { description: Validation error }
 *       502: { description: Upstream tool error }
 *       504: { description: Upstream tool timeout }
 */
router.post(
  '/:serverSlug/tools/:toolName',
  executionLimiter,
  ...guardServer(),
  asyncHandler(async (req, res) => {
    const { toolName } = req.params;
    if (typeof toolName !== 'string' || toolName.length === 0 || toolName.length > 80) {
      throw ApiError.badRequest('Invalid tool name');
    }
    const bundle = await toolService.getEnabledToolByServerSlugAndName(req.mcpServer.slug, toolName);
    if (!bundle) {
      throw ApiError.notFound(
        `Tool "${toolName}" not found on MCP server "${req.mcpServer.slug}" (or one of them is inactive)`
      );
    }

    const result = await executeTool({
      server: bundle.server,
      tool: bundle.tool,
      input: req.body || {},
      requestId: req.id || null,
      callerHeaders: req.headers,
    });

    return success(
      res,
      {
        tool: bundle.tool.name,
        server: bundle.server.slug,
        result: result.response,
        durationMs: result.durationMs,
        attempts: result.attempts,
        upstreamStatus: result.statusCode,
      },
      'OK'
    );
  })
);

/**
 * POST /:serverSlug/tools/:toolName/test
 * Tool testing endpoint — same as execution but the body is annotated with a
 * `dryRun` flag and the executor records the log with a `test` request id prefix.
 * Useful for the admin UI's "Try It" flow.
 *
 * @swagger
 * /{serverSlug}/tools/{toolName}/test:
 *   post:
 *     tags: [Dynamic MCP]
 *     summary: Test a tool (records the execution log with a test marker)
 */
router.post(
  '/:serverSlug/tools/:toolName/test',
  executionLimiter,
  ...guardServer(),
  asyncHandler(async (req, res) => {
    const { toolName } = req.params;
    const bundle = await toolService.getEnabledToolByServerSlugAndName(req.mcpServer.slug, toolName);
    if (!bundle) throw ApiError.notFound('Server or tool not found');

    const result = await executeTool({
      server: bundle.server,
      tool: bundle.tool,
      input: req.body || {},
      requestId: `test:${req.id || ''}`,
      callerHeaders: req.headers,
    });
    return success(res, { ...result, mode: 'test' }, 'OK');
  })
);

module.exports = router;
