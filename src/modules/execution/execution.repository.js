'use strict';

const { ExecutionLog } = require('./execution.log.model');

async function record(entry) {
  // Fire-and-forget callers can still await — but we never let log persistence
  // failures crash a successful tool execution.
  try {
    return await ExecutionLog.create(entry);
  } catch (err) {
    // eslint-disable-next-line global-require
    require('../../utils/logger').warn(`Failed to record execution log: ${err.message}`);
    return null;
  }
}

async function list({ page = 1, limit = 20, serverId, toolId, status, from, to } = {}) {
  const filter = {};
  if (serverId) filter.serverId = serverId;
  if (toolId) filter.toolId = toolId;
  if (status) filter.status = status;
  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = new Date(from);
    if (to) filter.createdAt.$lte = new Date(to);
  }
  const skip = (page - 1) * limit;
  const [items, total] = await Promise.all([
    ExecutionLog.find(filter).sort('-createdAt').skip(skip).limit(limit).lean(),
    ExecutionLog.countDocuments(filter),
  ]);
  return {
    items,
    pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
  };
}

async function findById(id) {
  return ExecutionLog.findById(id).lean();
}

module.exports = { record, list, findById };
