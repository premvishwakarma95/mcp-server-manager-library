'use strict';

const expressLoader = require('./express');
const mongooseLoader = require('./mongoose');

module.exports = async function loadAll(app) {
  await mongooseLoader();
  expressLoader(app);
  return app;
};
