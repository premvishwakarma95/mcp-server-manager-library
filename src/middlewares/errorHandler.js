'use strict';

const { ZodError } = require('zod');
const mongoose = require('mongoose');
const ApiError = require('../utils/ApiError');
const { fail } = require('../utils/ApiResponse');
const logger = require('../utils/logger');
const env = require('../config/env');

function normalize(err) {
  if (err instanceof ApiError) return err;

  if (err instanceof ZodError) {
    return ApiError.unprocessable('Validation failed', {
      issues: err.issues.map((i) => ({
        path: i.path.join('.'),
        code: i.code,
        message: i.message,
      })),
    });
  }

  if (err instanceof mongoose.Error.ValidationError) {
    const details = Object.entries(err.errors).map(([path, e]) => ({
      path,
      message: e.message,
      kind: e.kind,
    }));
    return ApiError.unprocessable('Database validation failed', { issues: details });
  }

  if (err instanceof mongoose.Error.CastError) {
    return ApiError.badRequest(`Invalid ${err.path}: ${err.value}`, { path: err.path });
  }

  if (err && err.code === 11000) {
    const keys = Object.keys(err.keyValue || {});
    return ApiError.conflict(`Duplicate value for ${keys.join(', ') || 'unique key'}`, {
      keyValue: err.keyValue,
    });
  }

  if (err && err.type === 'entity.parse.failed') {
    return ApiError.badRequest('Malformed JSON body');
  }

  return new ApiError(
    err.message || 'Internal server error',
    err.statusCode || 500,
    err.code || 'INTERNAL_ERROR'
  );
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const apiErr = normalize(err);

  // Log 5xx with stack, 4xx as warn
  if (apiErr.statusCode >= 500) {
    logger.error(`[${req.method} ${req.originalUrl}] ${apiErr.message}`, {
      stack: err.stack,
      code: apiErr.code,
    });
  } else {
    logger.warn(`[${req.method} ${req.originalUrl}] ${apiErr.statusCode} ${apiErr.message}`);
  }

  const errorPayload = apiErr.toJSON();
  if (env.nodeEnv !== 'production' && apiErr.statusCode >= 500 && err.stack) {
    errorPayload.stack = err.stack.split('\n').slice(0, 5);
  }

  return fail(res, apiErr.message, apiErr.statusCode, errorPayload);
}

module.exports = errorHandler;
