'use strict';

const { Schema, model } = require('mongoose');
const { SLUG_REGEX } = require('../../utils/slugify');

const AUTH_TYPES = ['none', 'bearer', 'apiKey', 'basic'];
const STATUS = ['active', 'inactive'];
// Server-level "tool auth" — a flag that controls how the caller's inbound
// credential gets relayed to upstream when any tool under this server runs.
// No value is stored; the value comes from the caller's request headers.
const TOOL_AUTH_TYPES = ['none', 'bearer', 'apiKey'];

/**
 * Server-level auth config. Tools may override this individually.
 *
 * NOTE: Secrets stored here should be considered sensitive. In production, prefer
 * referencing environment variables via the `secretEnvVar` field rather than
 * persisting raw credentials.
 */
const AuthConfigSchema = new Schema(
  {
    type: { type: String, enum: AUTH_TYPES, default: 'none' },
    token: { type: String, default: null }, // bearer or apiKey value
    headerName: { type: String, default: null }, // for apiKey
    username: { type: String, default: null }, // for basic
    password: { type: String, default: null }, // for basic
    secretEnvVar: { type: String, default: null }, // resolve secret from process.env at runtime
  },
  { _id: false }
);

const McpServerSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 120,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: SLUG_REGEX,
      maxlength: 120,
    },
    description: {
      type: String,
      default: '',
      maxlength: 2000,
    },
    status: {
      type: String,
      enum: STATUS,
      default: 'active',
      index: true,
    },
    authType: {
      type: String,
      enum: AUTH_TYPES,
      default: 'none',
    },
    auth: {
      type: AuthConfigSchema,
      default: () => ({ type: 'none' }),
    },
    baseUrl: {
      type: String,
      default: null,
      trim: true,
    },
    defaultHeaders: {
      type: Schema.Types.Mixed,
      default: () => ({}),
    },
    mcpAccessKey: {
      type: String,
      default: null,
    },
    mcpAccessKeyHeader: {
      type: String,
      default: 'x-mcp-key',
    },
    mcpIpFilterEnabled: {
      type: Boolean,
      default: false,
    },
    mcpAllowedIps: {
      type: [String],
      default: () => [],
    },
    toolAuthType: {
      type: String,
      enum: TOOL_AUTH_TYPES,
      default: 'none',
    },
    toolAuthHeaderName: {
      type: String,
      default: 'x-api-key',
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: () => ({}),
    },
    version: {
      type: String,
      default: '1.0.0',
    },
  },
  {
    timestamps: true,
    collection: 'mcp_servers',
    toJSON: {
      virtuals: true,
      transform: (_doc, ret) => {
        delete ret.__v;
        // Never leak secrets in JSON responses
        if (ret.auth) {
          if (ret.auth.token) ret.auth.token = '***';
          if (ret.auth.password) ret.auth.password = '***';
        }
        if (ret.mcpAccessKey) ret.mcpAccessKey = '***';
        return ret;
      },
    },
    toObject: { virtuals: true },
  }
);

McpServerSchema.index({ status: 1, slug: 1 });
McpServerSchema.index({ name: 'text', description: 'text' });

McpServerSchema.virtual('tools', {
  ref: 'McpTool',
  localField: '_id',
  foreignField: 'serverId',
});

McpServerSchema.pre('save', function syncAuthType(next) {
  // Keep top-level authType and nested auth.type in sync if either changed.
  if (this.isModified('auth') && this.auth && this.auth.type) {
    this.authType = this.auth.type;
  } else if (this.isModified('authType')) {
    if (!this.auth) this.auth = { type: this.authType };
    else this.auth.type = this.authType;
  }
  next();
});

module.exports = {
  McpServer: model('McpServer', McpServerSchema),
  AUTH_TYPES,
  STATUS,
  TOOL_AUTH_TYPES,
};
