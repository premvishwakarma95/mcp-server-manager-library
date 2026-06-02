'use strict';

const { Router } = require('express');
const controller = require('./mcpServer.controller');
const validate = require('../../middlewares/validate');
const v = require('./mcpServer.validator');

/**
 * @swagger
 * tags:
 *   - name: MCP Servers
 *     description: Manage dynamic MCP servers
 */

const router = Router();

/**
 * @swagger
 * /api/v1/admin/servers:
 *   get:
 *     tags: [MCP Servers]
 *     summary: List MCP servers
 *     security: [{ AdminApiKey: [] }]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [active, inactive] }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *     responses:
 *       200: { description: OK }
 *   post:
 *     tags: [MCP Servers]
 *     summary: Create an MCP server
 *     security: [{ AdminApiKey: [] }]
 *     responses:
 *       201: { description: Created }
 */
router.get('/', validate({ query: v.listQuery }), controller.listServers);
router.post('/', validate({ body: v.createSchema }), controller.createServer);

/**
 * @swagger
 * /api/v1/admin/servers/import:
 *   post:
 *     tags: [MCP Servers]
 *     summary: Import a server (and its tools) from an export JSON document
 *     security: [{ AdminApiKey: [] }]
 *     parameters:
 *       - in: query
 *         name: name
 *         schema: { type: string }
 *         description: Override the imported server's name.
 *       - in: query
 *         name: slug
 *         schema: { type: string }
 *         description: Override the imported slug. If omitted and the exported slug is taken, a -copy variant is auto-picked.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: The JSON document produced by GET /:id/export.
 *     responses:
 *       201: { description: Imported }
 *       400: { description: Bad payload }
 *       409: { description: Slug collision when an explicit override was given }
 */
router.post(
  '/import',
  validate({ query: v.importQuery }),
  controller.importServer
);

/**
 * @swagger
 * /api/v1/admin/servers/{id}:
 *   get:
 *     tags: [MCP Servers]
 *     summary: Get a single MCP server by id
 *     security: [{ AdminApiKey: [] }]
 *   patch:
 *     tags: [MCP Servers]
 *     summary: Update an MCP server
 *     security: [{ AdminApiKey: [] }]
 *   delete:
 *     tags: [MCP Servers]
 *     summary: Delete an MCP server (cascades to tools)
 *     security: [{ AdminApiKey: [] }]
 */
router.get('/:id', validate({ params: v.idParam }), controller.getServer);
router.patch(
  '/:id',
  validate({ params: v.idParam, body: v.updateSchema }),
  controller.updateServer
);
router.delete('/:id', validate({ params: v.idParam }), controller.deleteServer);

/**
 * @swagger
 * /api/v1/admin/servers/{id}/duplicate:
 *   post:
 *     tags: [MCP Servers]
 *     summary: Duplicate a server (and all its tools)
 *     security: [{ AdminApiKey: [] }]
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               slug: { type: string }
 *     responses:
 *       201: { description: Duplicated }
 */
router.post(
  '/:id/duplicate',
  validate({ params: v.idParam, body: v.duplicateSchema }),
  controller.duplicateServer
);

/**
 * @swagger
 * /api/v1/admin/servers/{id}/export:
 *   get:
 *     tags: [MCP Servers]
 *     summary: Export server + all its tools as a JSON file
 *     security: [{ AdminApiKey: [] }]
 *     parameters:
 *       - in: query
 *         name: includeSecrets
 *         schema: { type: boolean, default: false }
 *         description: When true, raw secret values are embedded. Default masks them as ***.
 *     responses:
 *       200: { description: JSON file attachment }
 */
router.get(
  '/:id/export',
  validate({ params: v.idParam }),
  controller.exportServer
);

module.exports = router;
