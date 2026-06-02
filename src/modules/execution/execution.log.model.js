'use strict';

const { Schema, model } = require('mongoose');

const STATUS = ['success', 'validation_error', 'upstream_error', 'timeout', 'internal_error'];

const ExecutionLogSchema = new Schema(
  {
    serverId: { type: Schema.Types.ObjectId, ref: 'McpServer', required: true, index: true },
    toolId: { type: Schema.Types.ObjectId, ref: 'McpTool', required: true, index: true },
    serverSlug: { type: String, required: true, index: true },
    toolName: { type: String, required: true },

    requestId: { type: String, default: null, index: true },

    request: {
      method: { type: String, default: null },
      url: { type: String, default: null },
      headers: { type: Schema.Types.Mixed, default: null },
      query: { type: Schema.Types.Mixed, default: null },
      body: { type: Schema.Types.Mixed, default: null },
    },

    response: {
      status: { type: Number, default: null },
      headers: { type: Schema.Types.Mixed, default: null },
      body: { type: Schema.Types.Mixed, default: null },
      bodyTruncated: { type: Boolean, default: false },
    },

    status: { type: String, enum: STATUS, required: true, index: true },
    attempts: { type: Number, default: 1 },
    durationMs: { type: Number, default: 0 },
    error: {
      message: { type: String, default: null },
      code: { type: String, default: null },
      details: { type: Schema.Types.Mixed, default: null },
    },
  },
  {
    timestamps: { createdAt: 'createdAt', updatedAt: false },
    collection: 'tool_execution_logs',
  }
);

ExecutionLogSchema.index({ createdAt: -1 });
ExecutionLogSchema.index({ serverId: 1, createdAt: -1 });
ExecutionLogSchema.index({ toolId: 1, createdAt: -1 });
ExecutionLogSchema.index({ status: 1, createdAt: -1 });

module.exports = { ExecutionLog: model('ExecutionLog', ExecutionLogSchema), STATUS };
