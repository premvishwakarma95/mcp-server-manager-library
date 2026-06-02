'use strict';

const service = require('./tool.service');
const asyncHandler = require('../../utils/asyncHandler');
const { success, created, paginated } = require('../../utils/ApiResponse');
const ApiError = require('../../utils/ApiError');

const createTool = asyncHandler(async (req, res) => {
  const tool = await service.createTool(req.body);
  return created(res, tool.toJSON ? tool.toJSON() : tool, 'Tool created');
});

const getTool = asyncHandler(async (req, res) => {
  const tool = await service.getToolById(req.params.id);
  return success(res, tool, 'OK');
});

const updateTool = asyncHandler(async (req, res) => {
  const tool = await service.updateTool(req.params.id, req.body);
  return success(res, tool, 'Tool updated');
});

const deleteTool = asyncHandler(async (req, res) => {
  const result = await service.deleteTool(req.params.id);
  return success(res, result, 'Tool deleted');
});

const listTools = asyncHandler(async (req, res) => {
  const { items, pagination } = await service.listTools(req.query);
  return paginated(res, items, pagination, 'OK');
});

const importFromOpenApi = asyncHandler(async (req, res) => {
  const { serverId, spec, dryRun = false } = req.body;
  if (!serverId) throw ApiError.badRequest('serverId is required');
  if (!spec || typeof spec !== 'object') {
    throw ApiError.badRequest('spec must be a JSON object (OpenAPI 3.x or Swagger 2.x)');
  }

  const results = await service.bulkImportFromOpenApi(serverId, spec, Boolean(dryRun));

  if (dryRun) {
    return success(res, results, `Preview: ${results.tools.length} tool(s) found`);
  }
  const msg = `Import complete: ${results.created.length} created, ${results.skipped.length} skipped, ${results.errors.length} errors`;
  return success(res, results, msg);
});

const duplicateTool = asyncHandler(async (req, res) => {
  const result = await service.duplicateTool(req.params.id, req.body || {});
  const msg = `Duplicated "${result.source.name}" → "${result.tool.name}"`;
  return created(res, result, msg);
});

// Admin "Try It". Body: { input?: object, callerHeaders?: object }. We wrap
// ApiError so the admin UI gets a structured payload to render instead of a
// raw HTTP error — successful 4xx/5xx upstream responses still surface their
// status, duration, and body.
const tryTool = asyncHandler(async (req, res) => {
  const body = req.body || {};
  try {
    const result = await service.tryTool(req.params.id, {
      input: body.input || {},
      callerHeaders: body.callerHeaders || {},
    });
    return success(res, { ok: true, ...result }, 'OK');
  } catch (err) {
    if (err instanceof ApiError) {
      return success(
        res,
        {
          ok: false,
          status: 'error',
          error: {
            message: err.message,
            code: err.code || null,
            httpStatus: err.statusCode || null,
            details: err.details || null,
          },
        },
        'Try failed'
      );
    }
    throw err;
  }
});

module.exports = { createTool, getTool, updateTool, deleteTool, listTools, importFromOpenApi, duplicateTool, tryTool };
