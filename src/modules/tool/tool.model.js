'use strict';

const { Schema, model } = require('mongoose');

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const EXEC_TYPES = ['http', 'echo']; // 'echo' = no upstream call, for testing
const AUTH_TYPES = ['inherit', 'none', 'bearer', 'apiKey', 'basic'];

const ToolAuthSchema = new Schema(
  {
    type: { type: String, enum: AUTH_TYPES, default: 'inherit' },
    token: { type: String, default: null },
    headerName: { type: String, default: null },
    username: { type: String, default: null },
    password: { type: String, default: null },
    secretEnvVar: { type: String, default: null },
  },
  { _id: false }
);

const ToolSchema = new Schema(
  {
    serverId: {
      type: Schema.Types.ObjectId,
      ref: 'McpServer',
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 80,
      // MCP tool names typically use snake_case; we allow snake/kebab/dot.
      match: /^[a-zA-Z][a-zA-Z0-9_.\-]{0,79}$/,
    },
    description: {
      type: String,
      default: '',
      maxlength: 2000,
    },
    method: {
      type: String,
      enum: METHODS,
      default: 'POST',
    },
    endpoint: {
      // Either a full URL OR a path that joins onto McpServer.baseUrl.
      // For executionType='echo' this may be empty.
      type: String,
      default: null,
      trim: true,
    },
    headers: {
      type: Schema.Types.Mixed,
      default: () => ({}),
    },
    queryParams: {
      type: Schema.Types.Mixed,
      default: () => ({}),
    },
    inputSchema: {
      // JSON Schema (object) describing the tool's input
      type: Schema.Types.Mixed,
      default: () => ({ type: 'object', properties: {}, additionalProperties: true }),
    },
    outputSchema: {
      // JSON Schema describing the upstream response (optional, advisory)
      type: Schema.Types.Mixed,
      default: null,
    },
    executionType: {
      type: String,
      enum: EXEC_TYPES,
      default: 'http',
    },
    timeout: {
      type: Number,
      default: null, // null → server default
      min: 0,
    },
    retries: {
      type: Number,
      default: 0,
      min: 0,
      max: 5,
    },
    enabled: {
      type: Boolean,
      default: true,
      index: true,
    },
    auth: {
      type: ToolAuthSchema,
      default: () => ({ type: 'inherit' }),
    },
    // Per-tool opt-out for the server-level Tool Auth Type pass-through.
    // When `true`, the executor skips forwarding the caller's inbound credential
    // for this specific tool — useful when one tool on an otherwise-authenticated
    // server is a public API and should fire un-authenticated.
    disableServerToolAuth: {
      type: Boolean,
      default: false,
    },
    version: {
      type: String,
      default: '1.0.0',
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: () => ({}),
    },
  },
  {
    timestamps: true,
    collection: 'mcp_tools',
    toJSON: {
      virtuals: true,
      transform: (_doc, ret) => {
        delete ret.__v;
        if (ret.auth) {
          if (ret.auth.token) ret.auth.token = '***';
          if (ret.auth.password) ret.auth.password = '***';
        }
        return ret;
      },
    },
    toObject: { virtuals: true },
  }
);

ToolSchema.index({ serverId: 1, name: 1 }, { unique: true });
ToolSchema.index({ serverId: 1, enabled: 1 });

module.exports = {
  McpTool: model('McpTool', ToolSchema),
  METHODS,
  EXEC_TYPES,
  TOOL_AUTH_TYPES: AUTH_TYPES,
};
