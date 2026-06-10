'use strict';

const winston = require('winston');
const env = require('../config/env');

const { combine, timestamp, printf, colorize, errors, splat, json } = winston.format;

const devFormat = printf(({ level, message, timestamp: ts, stack, ...meta }) => {
  const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
  return `${ts} [${level}] ${stack || message}${metaStr}`;
});

const logger = winston.createLogger({
  level: env.logging.level,
  format:
    env.nodeEnv === 'production'
      ? combine(timestamp(), errors({ stack: true }), splat(), json())
      : combine(colorize(), timestamp({ format: 'HH:mm:ss' }), errors({ stack: true }), splat(), devFormat),
  transports: [new winston.transports.Console()],
  exitOnError: false,
});

module.exports = logger;
