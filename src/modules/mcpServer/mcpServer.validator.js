'use strict';

const { z } = require('zod');
const { AUTH_TYPES, STATUS, TOOL_AUTH_TYPES } = require('./mcpServer.model');
const { SLUG_REGEX } = require('../../utils/slugify');

const authConfigSchema = z
  .object({
    type: z.enum(AUTH_TYPES).default('none'),
    token: z.string().min(1).optional().nullable(),
    headerName: z.string().min(1).optional().nullable(),
    username: z.string().min(1).optional().nullable(),
    password: z.string().min(1).optional().nullable(),
    secretEnvVar: z.string().min(1).optional().nullable(),
  })
  .strict();

const createSchema = z
  .object({
    name: z.string().min(2).max(120),
    slug: z.string().regex(SLUG_REGEX).max(120).optional(),
    description: z.string().max(2000).optional(),
    status: z.enum(STATUS).optional(),
    authType: z.enum(AUTH_TYPES).optional(),
    auth: authConfigSchema.optional(),
    baseUrl: z.string().url().optional().nullable(),
    defaultHeaders: z.record(z.string()).optional(),
    mcpAccessKey: z.string().min(1).optional().nullable(),
    mcpAccessKeyHeader: z.string().min(1).optional(),
    mcpIpFilterEnabled: z.boolean().optional(),
    mcpAllowedIps: z.array(z.string().min(1)).optional(),
    toolAuthType: z.enum(TOOL_AUTH_TYPES).optional(),
    toolAuthHeaderName: z.string().min(1).max(80).optional(),
    metadata: z.record(z.any()).optional(),
    version: z.string().max(20).optional(),
  })
  .strict();

const updateSchema = createSchema.partial().strict();

const idParam = z.object({ id: z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id') });

const duplicateSchema = z
  .object({
    name: z.string().min(2).max(120).optional(),
    slug: z.string().regex(SLUG_REGEX).max(120).optional(),
  })
  .strict();

const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
  status: z.enum(STATUS).optional(),
  sort: z.string().optional(),
});

const importQuery = z
  .object({
    name: z.string().min(2).max(120).optional(),
    slug: z.string().regex(SLUG_REGEX).max(120).optional(),
  })
  .strict();

module.exports = {
  createSchema,
  updateSchema,
  idParam,
  listQuery,
  duplicateSchema,
  importQuery,
};
