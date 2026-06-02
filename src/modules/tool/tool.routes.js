'use strict';

const { Router } = require('express');
const controller = require('./tool.controller');
const validate = require('../../middlewares/validate');
const v = require('./tool.validator');

/**
 * @swagger
 * tags:
 *   - name: Tools
 *     description: Manage tools attached to MCP servers
 */

const router = Router();

/**
 * @swagger
 * /api/v1/admin/tools:
 *   get:
 *     tags: [Tools]
 *     summary: List tools (optionally filtered by serverId)
 *     security: [{ AdminApiKey: [] }]
 *   post:
 *     tags: [Tools]
 *     summary: Create a tool on a server
 *     security: [{ AdminApiKey: [] }]
 */
router.get('/', validate({ query: v.listQuery }), controller.listTools);
router.post('/import/openapi', controller.importFromOpenApi);
router.post('/', validate({ body: v.createSchema }), controller.createTool);

/**
 * @swagger
 * /api/v1/admin/tools/{id}:
 *   get: { tags: [Tools], security: [{ AdminApiKey: [] }], summary: Get tool by id }
 *   patch: { tags: [Tools], security: [{ AdminApiKey: [] }], summary: Update tool }
 *   delete: { tags: [Tools], security: [{ AdminApiKey: [] }], summary: Delete tool }
 */
/**
 * @swagger
 * /api/v1/admin/tools/{id}/duplicate:
 *   post:
 *     tags: [Tools]
 *     summary: Duplicate a tool on the same server (auto-suffixed name)
 *     security: [{ AdminApiKey: [] }]
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema: { type: object, properties: { name: { type: string } } }
 */
router.post(
  '/:id/duplicate',
  validate({ params: v.idParam, body: v.duplicateSchema }),
  controller.duplicateTool
);

/**
 * @swagger
 * /api/v1/admin/tools/{id}/try:
 *   post:
 *     tags: [Tools]
 *     summary: Admin "Try It" — execute the tool with arbitrary input + caller headers
 *     security: [{ AdminApiKey: [] }]
 */
router.post('/:id/try', validate({ params: v.idParam }), controller.tryTool);

router.get('/:id', validate({ params: v.idParam }), controller.getTool);
router.patch('/:id', validate({ params: v.idParam, body: v.updateSchema }), controller.updateTool);
router.delete('/:id', validate({ params: v.idParam }), controller.deleteTool);

module.exports = router;
