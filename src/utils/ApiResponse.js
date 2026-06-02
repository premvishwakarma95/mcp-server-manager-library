'use strict';

function success(res, data = {}, message = 'OK', statusCode = 200, meta = undefined) {
  const payload = { success: true, message, data };
  if (meta !== undefined) payload.meta = meta;
  return res.status(statusCode).json(payload);
}

function created(res, data, message = 'Created') {
  return success(res, data, message, 201);
}

function noContent(res) {
  return res.status(204).end();
}

function paginated(res, items, pagination, message = 'OK') {
  return success(res, { items }, message, 200, { pagination });
}

function fail(res, message = 'Error', statusCode = 500, error = undefined) {
  const payload = { success: false, message };
  if (error !== undefined) payload.error = error;
  return res.status(statusCode).json(payload);
}

module.exports = { success, created, noContent, paginated, fail };
