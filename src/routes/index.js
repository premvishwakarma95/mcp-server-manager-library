'use strict';

const { Router } = require('express');
const env = require('../config/env');
const healthRoutes = require('./health.routes');
const adminRoutes = require('./admin.routes');
const dynamicRoutes = require('./dynamic.routes');

const router = Router();

// System routes (unauthenticated): /health, /ready, /metrics
router.use('/', healthRoutes);

// Admin routes: /api/v1/admin/*
router.use(`${env.apiPrefix}/admin`, adminRoutes);

// Dynamic MCP routes: catch-all at the root.
// IMPORTANT: this must be mounted LAST so it does not shadow /health, /metrics,
// /api/v1/admin, /docs, etc.
router.use('/', dynamicRoutes);

module.exports = router;
