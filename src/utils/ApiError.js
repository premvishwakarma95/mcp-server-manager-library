'use strict';

class ApiError extends Error {
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR', details = undefined) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = true;
    Error.captureStackTrace?.(this, this.constructor);
  }

  toJSON() {
    return {
      message: this.message,
      code: this.code,
      statusCode: this.statusCode,
      ...(this.details !== undefined ? { details: this.details } : {}),
    };
  }

  static badRequest(message = 'Bad Request', details) {
    return new ApiError(message, 400, 'BAD_REQUEST', details);
  }

  static unauthorized(message = 'Unauthorized', details) {
    return new ApiError(message, 401, 'UNAUTHORIZED', details);
  }

  static forbidden(message = 'Forbidden', details) {
    return new ApiError(message, 403, 'FORBIDDEN', details);
  }

  static notFound(message = 'Resource not found', details) {
    return new ApiError(message, 404, 'NOT_FOUND', details);
  }

  static conflict(message = 'Conflict', details) {
    return new ApiError(message, 409, 'CONFLICT', details);
  }

  static unprocessable(message = 'Validation failed', details) {
    return new ApiError(message, 422, 'VALIDATION_ERROR', details);
  }

  static tooManyRequests(message = 'Too many requests', details) {
    return new ApiError(message, 429, 'RATE_LIMITED', details);
  }

  static internal(message = 'Internal server error', details) {
    return new ApiError(message, 500, 'INTERNAL_ERROR', details);
  }

  static badGateway(message = 'Upstream tool failed', details) {
    return new ApiError(message, 502, 'TOOL_UPSTREAM_ERROR', details);
  }

  static gatewayTimeout(message = 'Upstream tool timed out', details) {
    return new ApiError(message, 504, 'TOOL_TIMEOUT', details);
  }
}

module.exports = ApiError;
