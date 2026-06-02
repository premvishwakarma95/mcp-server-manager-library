'use strict';

const { ZodError } = require('zod');
const ApiError = require('../utils/ApiError');

/**
 * Validate any combination of req.body, req.query, req.params against Zod schemas.
 * Usage: validate({ body: schema, query: schema, params: schema })
 *
 * On success, the parsed (and stripped/coerced) values are written back onto req.
 */
function validate(schemas = {}) {
  return (req, _res, next) => {
    try {
      if (schemas.body) req.body = schemas.body.parse(req.body);
      if (schemas.query) req.query = schemas.query.parse(req.query);
      if (schemas.params) req.params = schemas.params.parse(req.params);
      return next();
    } catch (err) {
      if (err instanceof ZodError) {
        return next(
          ApiError.unprocessable('Validation failed', {
            issues: err.issues.map((i) => ({
              path: i.path.join('.'),
              code: i.code,
              message: i.message,
            })),
          })
        );
      }
      return next(err);
    }
  };
}

module.exports = validate;
