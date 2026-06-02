'use strict';

const { z } = require('zod');
const { METHODS, EXEC_TYPES, TOOL_AUTH_TYPES } = require('./tool.model');

const objectId = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid ObjectId');

const jsonSchemaLike = z
  .object({})
  .passthrough()
  .refine((v) => v && typeof v === 'object', 'inputSchema must be a JSON Schema object');

const toolAuthSchema = z
  .object({
    type: z.enum(TOOL_AUTH_TYPES).default('inherit'),
    token: z.string().min(1).optional().nullable(),
    headerName: z.string().min(1).optional().nullable(),
    username: z.string().min(1).optional().nullable(),
    password: z.string().min(1).optional().nullable(),
    secretEnvVar: z.string().min(1).optional().nullable(),
  })
  .strict();

const createSchema = z
  .object({
    serverId: objectId,
    name: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_.\-]{0,79}$/, 'Invalid tool name'),
    description: z.string().max(2000).optional(),
    method: z.enum(METHODS).default('POST'),
    endpoint: z.string().max(2048).optional().nullable(),
    headers: z.record(z.string()).optional(),
    queryParams: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
    inputSchema: jsonSchemaLike.optional(),
    outputSchema: jsonSchemaLike.optional().nullable(),
    executionType: z.enum(EXEC_TYPES).default('http'),
    timeout: z.number().int().min(0).optional().nullable(),
    retries: z.number().int().min(0).max(5).optional(),
    enabled: z.boolean().optional(),
    auth: toolAuthSchema.optional(),
    disableServerToolAuth: z.boolean().optional(),
    version: z.string().max(20).optional(),
    metadata: z.record(z.any()).optional(),
  })
  .strict();

const updateSchema = createSchema.partial().strict().omit({ serverId: true });

const duplicateSchema = z
  .object({
    name: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_.\-]{0,79}$/, 'Invalid tool name').optional(),
  })
  .strict();

const idParam = z.object({ id: objectId });

const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
  enabled: z
    .union([z.literal('true'), z.literal('false'), z.boolean()])
    .transform((v) => v === true || v === 'true')
    .optional(),
  serverId: objectId.optional(),
  sort: z.string().optional(),
});

module.exports = { createSchema, updateSchema, idParam, listQuery, duplicateSchema };
