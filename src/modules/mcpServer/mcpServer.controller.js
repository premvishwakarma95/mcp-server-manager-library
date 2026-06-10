'use strict';

const service = require('./mcpServer.service');
const { success, created, paginated } = require('../../utils/ApiResponse');
const asyncHandler = require('../../utils/asyncHandler');

const createServer = asyncHandler(async (req, res) => {
  const server = await service.createServer(req.body);
  return created(res, server.toJSON ? server.toJSON() : server, 'MCP server created');
});

const getServer = asyncHandler(async (req, res) => {
  const server = await service.getServerById(req.params.id);
  return success(res, server, 'OK');
});

const updateServer = asyncHandler(async (req, res) => {
  const server = await service.updateServer(req.params.id, req.body);
  return success(res, server, 'MCP server updated');
});

const deleteServer = asyncHandler(async (req, res) => {
  const result = await service.deleteServer(req.params.id);
  return success(res, result, 'MCP server deleted');
});

const listServers = asyncHandler(async (req, res) => {
  const { items, pagination } = await service.listServers(req.query);
  return paginated(res, items, pagination, 'OK');
});

const duplicateServer = asyncHandler(async (req, res) => {
  const result = await service.duplicateServer(req.params.id, req.body || {});
  const msg = `Duplicated "${result.source.slug}" → "${result.server.slug}" with ${result.toolsCloned} tool(s)`;
  return created(res, result, msg);
});

const exportServer = asyncHandler(async (req, res) => {
  const includeSecrets = String(req.query.includeSecrets || '').toLowerCase() === 'true';
  const exported = await service.exportServer(req.params.id, { includeSecrets });
  // Send as a downloadable file. Frontend can also just fetch + reuse the JSON body.
  res.set('Content-Disposition', `attachment; filename="${exported.server.slug}.mcp-server.json"`);
  res.type('application/json');
  return res.status(200).send(JSON.stringify(exported, null, 2));
});

const importServer = asyncHandler(async (req, res) => {
  const overrides = { name: req.query.name, slug: req.query.slug };
  const result = await service.importServer(req.body, overrides);
  const msg = `Imported "${result.source.slug}" → "${result.server.slug}" with ${result.toolsImported} tool(s)`;
  return created(res, result, msg);
});

module.exports = {
  createServer,
  getServer,
  updateServer,
  deleteServer,
  listServers,
  duplicateServer,
  exportServer,
  importServer,
};
