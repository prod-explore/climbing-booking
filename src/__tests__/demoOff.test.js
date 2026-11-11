/**
 * demoOff.test.js — an ordinary instance (DEMO_MODE unset) has none of the demo: no sign-in route, no banner, no
 * robots header.
 */

'use strict';

process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-test-secret-test-secret-1234';
process.env.NODE_ENV = 'test';
process.env.ADMIN_EMAILS = 'admin@example.com';
delete process.env.DEMO_MODE;

const request = require('supertest');
const app = require('../app');
const { UserModel } = require('../models/database');
const { adminEmails } = require('../utils/accounts');
const { DEMO_ACCOUNTS } = require('../utils/demoMode');

test.each(['participant', 'instructor', 'admin'])('POST /demo/login as %s does not exist', async (role) => {
  const res = await request(app).post('/demo/login').type('form').send({ role });

  expect(res.status).toBe(404);
  expect(res.headers['set-cookie']).toBeUndefined();
});

test('the demo accounts do not exist and the demo administrator is not an administrator', () => {
  for (const email of Object.values(DEMO_ACCOUNTS)) expect(UserModel.findByEmail(email)).toBeFalsy();
  expect(adminEmails()).toEqual(['admin@example.com']);
});

test.each(['/', '/calendar', '/login', '/admin/login'])('%s has no banner and no robots header', async (path) => {
  const res = await request(app).get(path);

  expect(res.status).toBe(200);
  expect(res.text).not.toContain('Wersja demonstracyjna');
  expect(res.text).not.toContain('/demo/login');
  expect(res.headers['x-robots-tag']).toBeUndefined();
});
