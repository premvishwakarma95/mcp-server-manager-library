'use strict';

const morgan = require('morgan');
const { randomUUID } = require('crypto');
const logger = require('../utils/logger');
const env = require('../config/env');

function requestId(req, _res, next) {
  const incoming = req.headers['x-request-id'];
  req.id = (typeof incoming === 'string' && incoming.length < 128 && incoming) || randomUUID();
  next();
}

morgan.token('id', (req) => req.id);

const stream = {
  write: (line) => logger.http ? logger.http(line.trim()) : logger.info(line.trim()),
};

const format =
  env.nodeEnv === 'production'
    ? ':id :remote-addr :method :url :status :res[content-length] - :response-time ms'
    : ':id :method :url :status :response-time ms - :res[content-length]';

const httpLogger = morgan(format, { stream });

module.exports = { requestId, httpLogger };
