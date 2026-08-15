'use strict';

const crypto = require('node:crypto');

function newId(prefix) {
  const uuid = crypto.randomUUID();
  return prefix ? `${prefix}_${uuid}` : uuid;
}

module.exports = { newId };
