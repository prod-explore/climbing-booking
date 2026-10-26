/**
 * adminRoles.test.js — administrator rights follow ADMIN_EMAILS as it is when each request is handled, not a flag
 * stored when the account was created: an address taken off the list loses the panel at once, open session included.
 */

'use strict';

process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-test-secret-test-secret-1234';
process.env.NODE_ENV = 'test';
process.env.ADMIN_EMAILS = 'owner@example.com, boss@example.com';

jest.mock('../services/emailService', () => ({
  initEmailService: jest.fn().mockResolvedValue(undefined),
  sendMagicLink: jest.fn().mockResolvedValue(undefined),
  sendParticipantRemovedEmail: jest.fn().mockResolvedValue(undefined),
  sendWaitingListPromotedEmail: jest.fn().mockResolvedValue(undefined)
}));

const request = require('supertest');
const app = require('../app');
const { getDb, UserModel, MagicTokenModel } = require('../models/database');
const { sendMagicLink } = require('../services/emailService');

const LISTED = process.env.ADMIN_EMAILS;
let seq = 0;

async function loginAs(email) {
  const { user } = UserModel.getOrCreate(email);
  const token = `role-tok-${++seq}`;
  MagicTokenModel.create(user.id, token, new Date(Date.now() + 10 * 60 * 1000).toISOString());
  const agent = request.agent(app);
  const res = await agent.post('/auth/verify').type('form').send({ token });
  return { agent, res };
}

afterEach(() => {
  process.env.ADMIN_EMAILS = LISTED;
  sendMagicLink.mockClear();
});

test('a listed address signs in to the panel', async () => {
  const { agent, res } = await loginAs('owner@example.com');
  expect(res.headers.location).toBe('/admin');
  expect((await agent.get('/admin')).status).toBe(200);
});

test('taking an address off the list revokes the open session at the next request', async () => {
  const { agent } = await loginAs('boss@example.com');
  expect((await agent.get('/admin')).status).toBe(200);

  process.env.ADMIN_EMAILS = 'owner@example.com';

  const res = await agent.get('/admin');
  expect(res.status).toBe(302);
  expect(res.headers.location).toBe('/admin/login');
  expect((await agent.post('/admin/classes/1/cancel')).headers.location).toBe('/admin/login');
});

test('an address off the list is not sent an admin login link', async () => {
  process.env.ADMIN_EMAILS = 'owner@example.com';
  await request(app).post('/admin/login').type('form').send({ email: 'boss@example.com' });
  expect(sendMagicLink).not.toHaveBeenCalled();
});

test('an admin flag left in the database grants nothing', async () => {
  const { user } = UserModel.getOrCreate('former@example.com');
  getDb().prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(user.id);

  const { agent, res } = await loginAs('former@example.com');
  expect(res.headers.location).not.toBe('/admin');
  expect((await agent.get('/admin')).headers.location).toBe('/admin/login');
});

test('an address added to the list gets the panel', async () => {
  const { agent } = await loginAs('new.admin@example.com');
  expect((await agent.get('/admin')).status).toBe(302);

  process.env.ADMIN_EMAILS = `${LISTED}, New.Admin@example.com`;
  expect((await agent.get('/admin')).status).toBe(200);
});
