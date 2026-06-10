'use strict';

const mongoose = require('mongoose');
const env = require('../config/env');
const logger = require('../utils/logger');

mongoose.set('strictQuery', true);

if (env.mongo.debug) {
  mongoose.set('debug', true);
}

let connectingPromise = null;

async function connect() {
  if (mongoose.connection.readyState === 1) return mongoose.connection;
  if (connectingPromise) return connectingPromise;

  connectingPromise = mongoose
    .connect(env.mongo.uri, {
      autoIndex: env.nodeEnv !== 'production',
      serverSelectionTimeoutMS: 10_000,
      maxPoolSize: 50,
    })
    .then((conn) => {
      logger.info(`MongoDB connected: ${conn.connection.host}/${conn.connection.name}`);
      return conn.connection;
    })
    .catch((err) => {
      connectingPromise = null;
      throw err;
    });

  mongoose.connection.on('disconnected', () => {
    logger.warn('MongoDB disconnected');
  });

  mongoose.connection.on('error', (err) => {
    logger.error(`MongoDB error: ${err.message}`);
  });

  return connectingPromise;
}

async function disconnect() {
  if (mongoose.connection.readyState === 0) return;
  await mongoose.disconnect();
  connectingPromise = null;
  logger.info('MongoDB disconnected (graceful)');
}

function isConnected() {
  return mongoose.connection.readyState === 1;
}

module.exports = { connect, disconnect, isConnected, mongoose };
