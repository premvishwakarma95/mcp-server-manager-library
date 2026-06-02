'use strict';

const env = require('./config/env');
const logger = require('./utils/logger');
const { buildApp } = require('./app');
const { disconnect: disconnectMongo } = require('./database/mongo');
const { disconnect: disconnectRedis } = require('./database/redis');

let server;

async function main() {
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection', { reason: String(reason) });
  });

  process.on('uncaughtException', (err) => {
    logger.error(`Uncaught exception: ${err.message}`, { stack: err.stack });
    // For uncaught exceptions, terminate after flushing the log line.
    setTimeout(() => process.exit(1), 100).unref();
  });

  const app = await buildApp();

  server = app.listen(env.port, () => {
    logger.info(`${env.appName} listening on port ${env.port} (${env.nodeEnv})`);
    if (env.swagger.enabled) logger.info(`Swagger docs at http://localhost:${env.port}/docs`);
    logger.info(`Admin API: ${env.apiPrefix}/admin`);
  });

  const shutdown = async (signal) => {
    logger.info(`${signal} received, shutting down gracefully`);
    if (server) await new Promise((resolve) => server.close(resolve));
    await disconnectMongo().catch(() => undefined);
    await disconnectRedis().catch(() => undefined);
    logger.info('Shutdown complete');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error(`Failed to start server: ${err.message}`, { stack: err.stack });
  process.exit(1);
});
