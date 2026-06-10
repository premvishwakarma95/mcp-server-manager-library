'use strict';

const swaggerJsdoc = require('swagger-jsdoc');
const env = require('./env');

const definition = {
  openapi: '3.0.3',
  info: {
    title: `${env.appName} API`,
    version: '1.0.0',
    description:
      'Dynamic MCP Server Platform. MCP servers and tools are created at runtime from MongoDB; routes are resolved dynamically from slugs.',
  },
  servers: [{ url: `http://localhost:${env.port}` }],
  components: {
    securitySchemes: {
      AdminApiKey: { type: 'apiKey', in: 'header', name: 'x-api-key' },
    },
    schemas: {
      ApiSuccess: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          message: { type: 'string' },
          data: { type: 'object' },
        },
      },
      ApiError: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: false },
          message: { type: 'string' },
          error: { type: 'object' },
        },
      },
    },
  },
};

const options = {
  definition,
  apis: [
    require('path').join(__dirname, '..', 'modules', '**', '*.routes.js'),
    require('path').join(__dirname, '..', 'routes', '*.js'),
  ],
};

const spec = swaggerJsdoc(options);
module.exports = spec;
