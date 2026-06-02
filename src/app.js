'use strict';

const express = require('express');
const loadAll = require('./loaders');

async function buildApp() {
  const app = express();
  await loadAll(app);
  return app;
}

module.exports = { buildApp };
