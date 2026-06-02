'use strict';

const { z } = require('zod');
const asyncHandler = require('../../utils/asyncHandler');
const { success, paginated } = require('../../utils/ApiResponse');
const repo = require('../execution/execution.repository');
const ApiError = require('../../utils/ApiError');
const { STATUS } = require('../execution/execution.log.model');

const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  serverId: z.string().regex(/^[a-f0-9]{24}$/i).optional(),
  toolId: z.string().regex(/^[a-f0-9]{24}$/i).optional(),
  status: z.enum(STATUS).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});

const idParam = z.object({ id: z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id') });

const listLogs = asyncHandler(async (req, res) => {
  const query = listQuery.parse(req.query);
  const { items, pagination } = await repo.list(query);
  return paginated(res, items, pagination, 'OK');
});

const getLog = asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  const log = await repo.findById(id);
  if (!log) throw ApiError.notFound('Execution log not found');
  return success(res, log, 'OK');
});

module.exports = { listLogs, getLog };
