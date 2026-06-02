'use strict';

function sanitizeToolName(str) {
  let name = str.replace(/[^a-zA-Z0-9_.\-]/g, '_');
  if (!/^[a-zA-Z]/.test(name)) name = 'op_' + name;
  return name.slice(0, 80);
}

function generateOperationId(method, path) {
  const pathPart = path
    .replace(/\{[^}]+\}/g, (m) => m.slice(1, -1))
    .replace(/[^a-zA-Z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  return `${method.toLowerCase()}_${pathPart}`.slice(0, 80);
}

function resolveRef(spec, ref) {
  if (!ref || !ref.startsWith('#/')) return null;
  const parts = ref.slice(2).split('/');
  let obj = spec;
  for (const part of parts) {
    if (obj == null) return null;
    obj = obj[part.replace(/~1/g, '/').replace(/~0/g, '~')];
  }
  return obj || null;
}

function resolveSchema(spec, schema) {
  if (!schema) return null;
  if (schema.$ref) return resolveRef(spec, schema.$ref) || schema;
  return schema;
}

function buildInputSchema(spec, inputParams, requestBodySchema) {
  const properties = {};
  const required = [];

  for (const param of inputParams) {
    if (!param || !param.name) continue;
    const pSchema = resolveSchema(spec, param.schema) || { type: 'string' };
    const prop = Object.assign({}, pSchema);
    if (param.description && !prop.description) prop.description = param.description;
    delete prop.$ref;
    properties[param.name] = prop;
    if (param.required) required.push(param.name);
  }

  if (requestBodySchema) {
    const resolved = resolveSchema(spec, requestBodySchema);
    if (resolved && resolved.type === 'object' && resolved.properties) {
      for (const [key, val] of Object.entries(resolved.properties)) {
        properties[key] = val;
      }
      if (Array.isArray(resolved.required)) {
        for (const r of resolved.required) {
          if (!required.includes(r)) required.push(r);
        }
      }
    } else if (resolved && !resolved.$ref) {
      properties['body'] = resolved;
    }
  }

  const schema = { type: 'object', properties, additionalProperties: false };
  if (required.length) schema.required = required;
  return schema;
}

function parseOpenApi(spec) {
  if (!spec || typeof spec !== 'object') {
    throw new Error('Invalid spec: expected a JSON object');
  }
  const isV3 = typeof spec.openapi === 'string' && spec.openapi.startsWith('3');
  const isV2 = typeof spec.swagger === 'string' && spec.swagger.startsWith('2');
  if (!isV3 && !isV2) {
    throw new Error('Unsupported format — expected "openapi": "3.x.x" or "swagger": "2.x"');
  }

  const paths = spec.paths || {};
  const tools = [];
  const httpMethods = ['get', 'post', 'put', 'patch', 'delete'];

  for (const [path, pathItem] of Object.entries(paths)) {
    if (!pathItem || typeof pathItem !== 'object') continue;

    const sharedParams = (pathItem.parameters || []).map((p) =>
      p && p.$ref ? resolveRef(spec, p.$ref) || p : p
    ).filter(Boolean);

    for (const method of httpMethods) {
      const op = pathItem[method];
      if (!op || typeof op !== 'object') continue;

      const opParams = (op.parameters || []).map((p) =>
        p && p.$ref ? resolveRef(spec, p.$ref) || p : p
      ).filter(Boolean);

      // Op-level params override path-level params with same name
      const paramMap = new Map();
      for (const p of sharedParams) if (p.name) paramMap.set(`${p.in}:${p.name}`, p);
      for (const p of opParams) if (p.name) paramMap.set(`${p.in}:${p.name}`, p);

      const allParams = [...paramMap.values()];
      const inputParams = allParams.filter((p) => p.in === 'path' || p.in === 'query');

      let bodySchema = null;
      if (isV3 && op.requestBody) {
        const content = op.requestBody.content || {};
        const entry = content['application/json'] || content['*/*'] || Object.values(content)[0];
        if (entry && entry.schema) bodySchema = entry.schema;
      }
      if (isV2) {
        const bodyParam = allParams.find((p) => p.in === 'body');
        if (bodyParam && bodyParam.schema) bodySchema = bodyParam.schema;
        inputParams.push(...allParams.filter((p) => p.in === 'formData'));
      }

      const rawId = op.operationId || generateOperationId(method, path);
      const name = sanitizeToolName(rawId);
      const description = ((op.summary || op.description || '')).slice(0, 2000);
      const inputSchema = buildInputSchema(spec, inputParams, bodySchema);

      tools.push({
        name,
        description,
        method: method.toUpperCase(),
        endpoint: path,
        inputSchema,
        executionType: 'http',
        enabled: true,
        retries: 0,
        auth: { type: 'inherit' },
      });
    }
  }

  return tools;
}

module.exports = { parseOpenApi };
