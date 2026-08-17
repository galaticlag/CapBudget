// @ts-check
'use strict';

const crypto = require('node:crypto');

/**
 * @param {string} [prefix]
 * @returns {string}
 */
function newId(prefix) {
  const uuid = crypto.randomUUID();
  return prefix ? `${prefix}_${uuid}` : uuid;
}

module.exports = { newId };
