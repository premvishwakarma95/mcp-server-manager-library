'use strict';

const { connect } = require('../database/mongo');

module.exports = async function mongooseLoader() {
  await connect();
};
