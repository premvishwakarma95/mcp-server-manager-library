'use strict';

/**
 * JSON-RPC 2.0 dispatcher implementing the MCP protocol surface needed by
 * Claude (and other MCP clients). The dispatcher is pure: it takes a parsed
 * JSON-RPC message and the resolved MCP server, and returns the JSON-RPC
 * response object (or null for notifications).
 *
 * Supported methods:
 *   - initialize
 *   - notifications/initialized (notification — no response)
 *   - notifications/cancelled   (notification — ignored)
 *   - ping
 *   - tools/list
 *   - tools/call
 *   - prompts/list, resources/list, resources/templates/list (empty results)
 */

const toolService = require('../tool/tool.service');
const { executeTool } = require('../execution/execution.engine');

// Latest MCP protocol version we've validated against. We echo back whatever
// version the client requests if it's >= this, otherwise fall back to ours.
const SERVER_PROTOCOL_VERSION = '2024-11-05';

const RpcErrorCodes = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
};

function rpcResult(id, result) {
  return { jsonrpc: '2.0', id: id ?? null, result };
}

function rpcError(id, code, message, data) {
  const error = { code, message };
  if (data !== undefined) error.data = data;
  return { jsonrpc: '2.0', id: id ?? null, error };
}

function isNotification(message) {
  // A notification per JSON-RPC 2.0: no "id" field present.
  return !Object.prototype.hasOwnProperty.call(message || {}, 'id');
}

function pickProtocolVersion(requested) {
  // Be permissive: echo the client's version if it looks valid (YYYY-MM-DD-ish),
  // otherwise serve ours. This handles older + newer clients gracefully.
  if (typeof requested === 'string' && /^\d{4}-\d{2}-\d{2}/.test(requested)) {
    return requested;
  }
  return SERVER_PROTOCOL_VERSION;
}

function safeStringify(value) {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch (_) {
    return String(value);
  }
}

function formatToolError(err) {
  const status = err && err.statusCode;
  const msg = (err && err.message) || 'Unknown error';
  const details = err && err.details ? `\n${safeStringify(err.details)}` : '';
  if (status === 422) return `Validation error: ${msg}${details}`;
  if (status === 504) return `Tool timed out: ${msg}`;
  if (status === 502) return `Upstream error: ${msg}${details}`;
  if (status === 404) return `Tool not found: ${msg}`;
  return `Tool execution failed: ${msg}${details}`;
}

async function handleInitialize(id, params) {
  return rpcResult(id, {
    protocolVersion: pickProtocolVersion(params && params.protocolVersion),
    capabilities: {
      tools: { listChanged: false },
    },
    serverInfo: {
      name: 'Dynamic MCP Platform',
      version: '1.0.0',
    },
  });
}

async function handleToolsList(id, server) {
  const bundle = await toolService.listEnabledToolsForServerSlug(server.slug);
  const tools = ((bundle && bundle.tools) || []).map((t) => ({
    name: t.name,
    description: t.description || '',
    inputSchema: t.inputSchema && typeof t.inputSchema === 'object'
      ? t.inputSchema
      : { type: 'object', properties: {} },
  }));
  return rpcResult(id, { tools });
}

async function handleToolsCall(id, server, params, requestId, callerHeaders) {
  const toolName = params && params.name;
  const args = (params && params.arguments) || {};

  if (!toolName || typeof toolName !== 'string') {
    return rpcError(id, RpcErrorCodes.INVALID_PARAMS, 'Missing or invalid "name" parameter');
  }

  const bundle = await toolService.getEnabledToolByServerSlugAndName(server.slug, toolName);
  if (!bundle) {
    return rpcResult(id, {
      content: [
        {
          type: 'text',
          text: `Tool "${toolName}" not found or disabled on server "${server.slug}".`,
        },
      ],
      isError: true,
    });
  }

  try {
    const exec = await executeTool({
      server: bundle.server,
      tool: bundle.tool,
      input: args,
      requestId: requestId || null,
      callerHeaders: callerHeaders || {},
    });
    return rpcResult(id, {
      content: [{ type: 'text', text: safeStringify(exec.response) }],
      isError: false,
    });
  } catch (err) {
    return rpcResult(id, {
      content: [{ type: 'text', text: formatToolError(err) }],
      isError: true,
    });
  }
}

async function dispatch({ server, message, requestId, callerHeaders }) {
  if (!message || typeof message !== 'object' || message.jsonrpc !== '2.0') {
    // Only respond for non-notifications; notifications have no id and no response.
    if (isNotification(message)) return null;
    return rpcError(message && message.id, RpcErrorCodes.INVALID_REQUEST, 'Invalid Request');
  }

  const { id, method, params } = message;

  // Notifications: ignore silently (no response).
  if (typeof method === 'string' && method.startsWith('notifications/')) {
    return null;
  }

  try {
    switch (method) {
      case 'initialize':
        return await handleInitialize(id, params);

      case 'ping':
        return rpcResult(id, {});

      case 'tools/list':
        return await handleToolsList(id, server);

      case 'tools/call':
        return await handleToolsCall(id, server, params, requestId, callerHeaders);

      // Advertised-as-empty surfaces. Some clients probe these.
      case 'prompts/list':
        return rpcResult(id, { prompts: [] });
      case 'resources/list':
        return rpcResult(id, { resources: [] });
      case 'resources/templates/list':
        return rpcResult(id, { resourceTemplates: [] });

      case 'logging/setLevel':
        return rpcResult(id, {});

      default:
        return rpcError(
          id,
          RpcErrorCodes.METHOD_NOT_FOUND,
          `Method not found: ${method || '(missing)'}`
        );
    }
  } catch (err) {
    // Defensive: never crash the transport on a handler bug — return Internal Error.
    return rpcError(id, RpcErrorCodes.INTERNAL_ERROR, err.message || 'Internal error');
  }
}

module.exports = { dispatch, RpcErrorCodes, SERVER_PROTOCOL_VERSION };
