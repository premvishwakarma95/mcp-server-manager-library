'use strict';

const { McpServer } = require('./mcpServer.model');

async function create(payload) {
  return McpServer.create(payload);
}

async function findById(id, { lean = false } = {}) {
  const q = McpServer.findById(id);
  return lean ? q.lean({ virtuals: true }) : q;
}

async function findBySlug(slug, { lean = false, activeOnly = false } = {}) {
  const filter = { slug };
  if (activeOnly) filter.status = 'active';
  const q = McpServer.findOne(filter);
  return lean ? q.lean({ virtuals: true }) : q;
}

async function existsBySlug(slug) {
  return McpServer.exists({ slug });
}

async function updateById(id, patch) {
  return McpServer.findByIdAndUpdate(id, patch, { new: true, runValidators: true });
}

async function deleteById(id) {
  return McpServer.findByIdAndDelete(id);
}

async function list({ page = 1, limit = 20, search, status, sort = '-createdAt' } = {}) {
  const filter = {};
  if (status) filter.status = status;
  if (search) {
    filter.$or = [
      { name: { $regex: search, $options: 'i' } },
      { slug: { $regex: search, $options: 'i' } },
    ];
  }
  const skip = (page - 1) * limit;
  const [items, total] = await Promise.all([
    McpServer.find(filter).sort(sort).skip(skip).limit(limit).lean({ virtuals: true }),
    McpServer.countDocuments(filter),
  ]);
  return {
    items,
    pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
  };
}

module.exports = {
  create,
  findById,
  findBySlug,
  existsBySlug,
  updateById,
  deleteById,
  list,
};
