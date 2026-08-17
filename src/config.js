// @ts-check
'use strict';

const path = require('node:path');

const appDir = __dirname ? path.join(__dirname, '..') : process.cwd();
const dataDir = process.env.APP_DATA_DIR || path.join(appDir, 'data');
const householdsDir = path.join(dataDir, 'households');
const coreDbPath = path.join(dataDir, 'core.sqlite');
const backupsDir = path.join(dataDir, 'backups');

module.exports = {
  appDir,
  dataDir,
  householdsDir,
  coreDbPath,
  backupsDir,
  // reject household DB restores above this size
  maxRestoreBytes: 64 * 1024 * 1024,
  // sliding session expiration window
  sessionTtlMs: 30 * 24 * 60 * 60 * 1000,
  // reject CSV uploads above this size before parsing
  maxCsvBytes: 5 * 1024 * 1024,
  loginRateLimit: {
    max: 10,
    timeWindow: '1 minute'
  }
};
