    'use strict';

const { Router } = require('express');
const controller = require('./logs.controller');

/**
 * @swagger
 * tags:
 *   - name: Logs
 *     description: Tool execution logs
 */
const router = Router();

/**
 * @swagger
 * /api/v1/admin/logs:
 *   get:
 *     tags: [Logs]
 *     summary: List execution logs
 *     security: [{ AdminApiKey: [] }]
 *     parameters:
 *       - in: query
 *         name: serverId
 *         schema: { type: string }
 *       - in: query
 *         name: toolId
 *         schema: { type: string }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [success, validation_error, upstream_error, timeout, internal_error] }
 */
router.get('/', controller.listLogs);

/**
 * @swagger
 * /api/v1/admin/logs/{id}:
 *   get:
 *     tags: [Logs]
 *     summary: Get a single execution log
 *     security: [{ AdminApiKey: [] }]
 */
router.get('/:id', controller.getLog);

module.exports = router;
