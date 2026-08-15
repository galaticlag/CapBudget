'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'capbudget-test-'));
process.env.APP_DATA_DIR = tmpDir;

const { app, buildApp } = require('../server');

before(async () => {
  await buildApp();
});

after(async () => {
  await app.close();
  // Best-effort cleanup only: on Windows, open sqlite WAL/SHM file handles may
  // still be releasing right after close(), which can make rmSync throw EPERM
  // even with retries. That is an OS-level timing quirk, not a test failure —
  // the OS temp directory will be cleaned up eventually regardless.
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    // ignore
  }
});

let adminToken;
let memberToken;
let householdId;

test('first-run gating: setup status reports needsSetup before any account exists', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/setup/status' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().needsSetup, true);
});

test('first-run gating: creates the initial admin account', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/setup/admin',
    payload: { login: 'admin', password: 'adminpass123' }
  });
  assert.equal(res.statusCode, 200);
});

test('first-run gating: setup status reports needsSetup=false after admin creation', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/setup/status' });
  assert.equal(res.json().needsSetup, false);
});

test('first-run gating: a second admin-setup attempt is rejected (403)', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/setup/admin',
    payload: { login: 'someone-else', password: 'whatever123' }
  });
  assert.equal(res.statusCode, 403);
});

test('unauthenticated requests to protected routes are rejected (401)', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/me' });
  assert.equal(res.statusCode, 401);
});

test('admin can log in', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { login: 'admin', password: 'adminpass123' }
  });
  assert.equal(res.statusCode, 200);
  adminToken = res.json().token;
  assert.ok(adminToken);
});

test('ADMIN role is blocked (403) from household financial routes', async () => {
  const res = await app.inject({
    method: 'GET',
    url: '/api/dashboard/summary',
    headers: { authorization: `Bearer ${adminToken}`, 'x-household-id': 'does-not-matter' }
  });
  assert.equal(res.statusCode, 403);
});

test('admin creates a household', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/households',
    headers: { authorization: `Bearer ${adminToken}` },
    payload: { name: 'Foyer Test' }
  });
  assert.equal(res.statusCode, 201);
  householdId = res.json().id;
  assert.ok(householdId);
});

test('admin creates a member user attached to the household', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/admin/users',
    headers: { authorization: `Bearer ${adminToken}` },
    payload: { login: 'member1', password: 'memberpass123', role: 'MEMBER', householdIds: [householdId] }
  });
  assert.equal(res.statusCode, 201);
});

test('member can log in', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { login: 'member1', password: 'memberpass123' }
  });
  assert.equal(res.statusCode, 200);
  memberToken = res.json().token;
  assert.ok(memberToken);
});

test('household path is never client-supplied: missing householdId is rejected (400)', async () => {
  const res = await app.inject({
    method: 'GET',
    url: '/api/dashboard/summary',
    headers: { authorization: `Bearer ${memberToken}` }
  });
  assert.equal(res.statusCode, 400);
});

test('household path is never client-supplied: an unrelated householdId is rejected (403)', async () => {
  const res = await app.inject({
    method: 'GET',
    url: '/api/dashboard/summary',
    headers: { authorization: `Bearer ${memberToken}`, 'x-household-id': 'some-other-household-id' }
  });
  assert.equal(res.statusCode, 403);
});

test('member can access their own household dashboard summary (200)', async () => {
  const res = await app.inject({
    method: 'GET',
    url: '/api/dashboard/summary',
    headers: { authorization: `Bearer ${memberToken}`, 'x-household-id': householdId }
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.ok(body.totals);
});

test('login is rate-limited after repeated failed attempts', async () => {
  let sawRateLimited = false;
  for (let i = 0; i < 15; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { login: 'member1', password: 'wrong-password' }
    });
    if (res.statusCode === 429) {
      sawRateLimited = true;
      break;
    }
  }
  assert.equal(sawRateLimited, true);
});
