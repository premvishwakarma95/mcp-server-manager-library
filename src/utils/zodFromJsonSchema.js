'use strict';

const { z } = require('zod');

/**
 * Convert a (small) subset of JSON Schema into a Zod schema at runtime.
 *
 * Supports:
 *  - type: string | number | integer | boolean | array | object | null
 *  - enum
 *  - const
 *  - required, properties, additionalProperties (for object)
 *  - items (for array)
 *  - minLength/maxLength, minimum/maximum, minItems/maxItems
 *  - format: email, uri/url, uuid, date-time
 *  - anyOf, oneOf, allOf (best-effort)
 *  - nullable: true
 *  - default
 *  - description
 */
function jsonSchemaToZod(schema) {
  if (schema === undefined || schema === null) return z.any();
  if (typeof schema !== 'object') return z.any();

  // anyOf / oneOf — treat as union
  if (Array.isArray(schema.anyOf) && schema.anyOf.length > 0) {
    return applyMeta(z.union(schema.anyOf.map(jsonSchemaToZod)), schema);
  }
  if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) {
    return applyMeta(z.union(schema.oneOf.map(jsonSchemaToZod)), schema);
  }
  if (Array.isArray(schema.allOf) && schema.allOf.length > 0) {
    // Best-effort intersection
    const parts = schema.allOf.map(jsonSchemaToZod);
    let combined = parts[0];
    for (let i = 1; i < parts.length; i += 1) combined = z.intersection(combined, parts[i]);
    return applyMeta(combined, schema);
  }

  if (schema.enum && Array.isArray(schema.enum)) {
    const literals = schema.enum.map((v) => z.literal(v));
    if (literals.length === 1) return applyMeta(literals[0], schema);
    return applyMeta(z.union(literals), schema);
  }

  if (Object.prototype.hasOwnProperty.call(schema, 'const')) {
    return applyMeta(z.literal(schema.const), schema);
  }

  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;

  let base;
  switch (type) {
    case 'string':
      base = buildString(schema);
      break;
    case 'integer':
      base = buildInteger(schema);
      break;
    case 'number':
      base = buildNumber(schema);
      break;
    case 'boolean':
      base = z.boolean();
      break;
    case 'array':
      base = buildArray(schema);
      break;
    case 'object':
      base = buildObject(schema);
      break;
    case 'null':
      base = z.null();
      break;
    default:
      // Untyped or unknown — fall back to object if "properties" present, else any
      if (schema.properties) base = buildObject({ ...schema, type: 'object' });
      else base = z.any();
  }

  if (schema.nullable === true) base = base.nullable();
  if (Object.prototype.hasOwnProperty.call(schema, 'default')) base = base.default(schema.default);

  return applyMeta(base, schema);
}

function applyMeta(zodSchema, schema) {
  if (schema && typeof schema.description === 'string' && schema.description.length > 0) {
    return zodSchema.describe(schema.description);
  }
  return zodSchema;
}

function buildString(schema) {
  let s = z.string();
  if (typeof schema.minLength === 'number') s = s.min(schema.minLength);
  if (typeof schema.maxLength === 'number') s = s.max(schema.maxLength);
  if (typeof schema.pattern === 'string') {
    try {
      s = s.regex(new RegExp(schema.pattern));
    } catch (_) {
      /* ignore bad regex */
    }
  }
  switch (schema.format) {
    case 'email':
      s = s.email();
      break;
    case 'uuid':
      s = s.uuid();
      break;
    case 'uri':
    case 'url':
      s = s.url();
      break;
    case 'date-time':
      s = s.datetime({ offset: true });
      break;
    default:
      break;
  }
  return s;
}

function buildInteger(schema) {
  let n = z.number().int();
  if (typeof schema.minimum === 'number') n = n.min(schema.minimum);
  if (typeof schema.maximum === 'number') n = n.max(schema.maximum);
  return n;
}

function buildNumber(schema) {
  let n = z.number();
  if (typeof schema.minimum === 'number') n = n.min(schema.minimum);
  if (typeof schema.maximum === 'number') n = n.max(schema.maximum);
  return n;
}

function buildArray(schema) {
  const itemSchema = schema.items ? jsonSchemaToZod(schema.items) : z.any();
  let arr = z.array(itemSchema);
  if (typeof schema.minItems === 'number') arr = arr.min(schema.minItems);
  if (typeof schema.maxItems === 'number') arr = arr.max(schema.maxItems);
  return arr;
}

function buildObject(schema) {
  const shape = {};
  const props = schema.properties || {};
  const required = new Set(Array.isArray(schema.required) ? schema.required : []);

  for (const [key, propSchema] of Object.entries(props)) {
    const child = jsonSchemaToZod(propSchema);
    shape[key] = required.has(key) ? child : child.optional();
  }

  let obj = z.object(shape);

  // additionalProperties: false → strict; missing or true → passthrough
  if (schema.additionalProperties === false) {
    obj = obj.strict();
  } else if (
    schema.additionalProperties === true ||
    schema.additionalProperties === undefined
  ) {
    obj = obj.passthrough();
  } else if (typeof schema.additionalProperties === 'object') {
    // catchall-style: allow extra keys validated by this sub-schema
    obj = obj.catchall(jsonSchemaToZod(schema.additionalProperties));
  }

  return obj;
}

function safeParse(zodSchema, value) {
  try {
    return zodSchema.safeParse(value);
  } catch (err) {
    return { success: false, error: err };
  }
}

function formatZodIssues(error) {
  if (!error || !Array.isArray(error.issues)) return [];
  return error.issues.map((i) => ({
    path: i.path.join('.'),
    code: i.code,
    message: i.message,
  }));
}

module.exports = { jsonSchemaToZod, safeParse, formatZodIssues };
