'use strict';

const mongoSanitize = require('express-mongo-sanitize');
const hpp = require('hpp');

// Routes whose request body contains legitimate `$`-prefixed keys (e.g. JSON
// Schema / OpenAPI specs with `$ref`) and therefore must not be Mongo-sanitized.
const SANITIZE_SKIP_PATHS = [
  '/api/v1/admin/tools/import/openapi',
];

function shouldSkip(req) {
  return SANITIZE_SKIP_PATHS.some((p) => req.path === p || req.path.startsWith(`${p}/`));
}

function buildSanitizers() {
  const sanitizer = mongoSanitize({ replaceWith: '_' });
  return [
    (req, res, next) => (shouldSkip(req) ? next() : sanitizer(req, res, next)),
    hpp(),
  ];
}

module.exports = buildSanitizers;
