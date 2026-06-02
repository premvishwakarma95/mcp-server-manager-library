'use strict';

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const swaggerUi = require('swagger-ui-express');

const env = require('../config/env');
const swaggerSpec = require('../config/swagger');

const sanitize = require('../middlewares/sanitize');
const { httpLogger, requestId } = require('../middlewares/requestLogger');
const { globalLimiter } = require('../middlewares/rateLimiter');
const errorHandler = require('../middlewares/errorHandler');
const notFound = require('../middlewares/notFound');

const routes = require('../routes');
const { success } = require('../utils/ApiResponse');

module.exports = function expressLoader(app) {
  app.disable('x-powered-by');
  // We are commonly behind a single reverse proxy in production. Trust it for IPs.
  app.set('trust proxy', 1);

  // Security. CSP is disabled because the bundled /admin UI is a single inline-
  // script HTML file. Re-enable with a tightened policy if you serve assets
  // elsewhere or remove the admin UI.
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    })
  );

  // CORS
  const origins = env.security.corsOrigins;
  app.use(
    cors({
      origin: origins.includes('*') ? true : origins,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    })
  );

  // Body parsing
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // Compression
  app.use(compression());

  // Sanitization
  for (const mw of sanitize()) app.use(mw);

  // Request id + access log
  app.use(requestId);
  app.use(httpLogger);

  // Global rate limit. Applied before routes so even /health is loosely protected.
  app.use(globalLimiter);

  // Root info endpoint — quick sanity check that the platform is up.
  app.get('/', (_req, res) =>
    success(
      res,
      {
        name: env.appName,
        version: '1.0.0',
        env: env.nodeEnv,
        docs: env.swagger.enabled ? '/docs' : null,
        adminUi: '/admin',
        adminApi: `${env.apiPrefix}/admin`,
        hint: 'Dynamic MCP routes are served at /{serverSlug} and /{serverSlug}/tools/{toolName}',
      },
      'OK'
    )
  );

  // Admin UI — single-file static page at /admin. Mounted BEFORE the dynamic
  // catch-all so /admin is not interpreted as a serverSlug.
  const adminUiDir = path.join(__dirname, '..', 'public', 'admin');
  app.use('/admin', express.static(adminUiDir, { index: 'index.html' }));

  // Swagger UI (optional)
  if (env.swagger.enabled) {
    app.use(
      '/docs',
      swaggerUi.serve,
      swaggerUi.setup(swaggerSpec, { customSiteTitle: `${env.appName} API` })
    );
    app.get('/openapi.json', (_req, res) => res.json(swaggerSpec));
  }

  // Mount all application routes
  app.use(routes);

  // 404 + centralized error handler
  app.use(notFound);
  app.use(errorHandler);

  return app;
};
