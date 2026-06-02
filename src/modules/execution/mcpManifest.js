'use strict';

/**
 * Build an MCP-compatible manifest from a server + its enabled tools.
 *
 * The format here is intentionally close to the MCP "list_tools" shape so
 * standard MCP clients can introspect a server.
 */
function buildManifest(server, tools, baseUrl) {
  const baseUrlClean = baseUrl ? baseUrl.replace(/\/+$/, '') : '';

  return {
    protocol: 'mcp',
    protocolVersion: '2024-11-05',
    server: {
      id: String(server._id),
      name: server.name,
      slug: server.slug,
      description: server.description || '',
      version: server.version || '1.0.0',
      status: server.status,
      metadata: server.metadata || {},
    },
    endpoints: {
      mcp: baseUrlClean ? `${baseUrlClean}/${server.slug}/mcp` : `/${server.slug}/mcp`,
      manifest: baseUrlClean ? `${baseUrlClean}/${server.slug}` : `/${server.slug}`,
    },
    capabilities: {
      tools: { listChanged: false },
    },
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description || '',
      inputSchema: t.inputSchema || {
        type: 'object',
        properties: {},
        additionalProperties: true,
      },
      outputSchema: t.outputSchema || undefined,
      method: t.method,
      version: t.version || '1.0.0',
      invokeUrl: baseUrlClean
        ? `${baseUrlClean}/${server.slug}/tools/${t.name}`
        : `/${server.slug}/tools/${t.name}`,
    })),
  };
}

module.exports = { buildManifest };
