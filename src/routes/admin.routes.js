'use strict';

const { Router } = require('express');
const { adminAuth } = require('../modules/auth/auth.middleware');
const serverRoutes = require('../modules/mcpServer/mcpServer.routes');
const toolRoutes = require('../modules/tool/tool.routes');
const logsRoutes = require('../modules/logs/logs.routes');

const router = Router();

router.use(adminAuth);

router.use('/servers', serverRoutes);
router.use('/tools', toolRoutes);
router.use('/logs', logsRoutes);

module.exports = router;
