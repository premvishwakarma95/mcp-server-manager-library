'use strict';

const { McpTool } = require('./tool.model');

async function create(payload) {
  return McpTool.create(payload);
}

async function findById(id, { lean = false } = {}) {
  const q = McpTool.findById(id);
  return lean ? q.lean({ virtuals: true }) : q;
}

async function findByServerAndName(serverId, name, { lean = false, enabledOnly = false } = {}) {
  const filter = { serverId, name };
  if (enabledOnly) filter.enabled = true;
  const q = McpTool.findOne(filter);
  return lean ? q.lean({ virtuals: true }) : q;
}

async function listByServer(serverId, { enabledOnly = false } = {}) {
  const filter = { serverId };
  if (enabledOnly) filter.enabled = true;
  return McpTool.find(filter).sort({ name: 1 }).lean({ virtuals: true });
}

async function list({ serverId, page = 1, limit = 20, search, enabled, sort = 'name' } = {}) {
  const filter = {};
  if (serverId) filter.serverId = serverId;
  if (enabled !== undefined) filter.enabled = enabled;
  if (search) {
    filter.$or = [
      { name: { $regex: search, $options: 'i' } },
      { description: { $regex: search, $options: 'i' } },
    ];
  }
  const skip = (page - 1) * limit;
  const [items, total] = await Promise.all([
    McpTool.find(filter).sort(sort).skip(skip).limit(limit).lean({ virtuals: true }),
    McpTool.countDocuments(filter),
  ]);
  return {
    items,
    pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
  };
}

async function updateById(id, patch) {
  return McpTool.findByIdAndUpdate(id, patch, { new: true, runValidators: true });
}

async function deleteById(id) {
  return McpTool.findByIdAndDelete(id);
}

async function deleteManyByServerId(serverId) {
  return McpTool.deleteMany({ serverId });
}

async function existsByServerAndName(serverId, name) {
  return McpTool.exists({ serverId, name });
}

module.exports = {
  create,
  findById,
  findByServerAndName,
  listByServer,
  list,
  updateById,
  deleteById,
  deleteManyByServerId,
  existsByServerAndName,
};
