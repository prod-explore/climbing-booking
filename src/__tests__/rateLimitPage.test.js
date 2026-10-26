/**
 * rateLimitPage.test.js — a browser that hits a rate limit gets an HTML page in the site layout that says when to try
 * again (from Retry-After); a JSON client keeps the JSON answer.
 */

'use strict';

process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-test-secret-test-secret-1234';
process.env.NODE_ENV = 'test';
process.env.ADMIN_EMAILS = 'admin@example.com';
process.env.RATE_LIMIT_MAX_REQUESTS = '20';

jest.mock('../services/emailService', () => ({
  initEmailService: jest.fn().mockResolvedValue(undefined),
  sendMagicLink: jest.fn().mockResolvedValue(undefined),
  sendParticipantRemovedEmail: jest.fn().mockResolvedValue(undefined),
  sendWaitingListPromotedEmail: jest.fn().mockResolvedValue(undefined)
}));

const request = require('supertest');
const app = require('../app');
const { UserModel, MagicTokenModel } = require('../models/database');

const BROWSER_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';

/** Sends `send` until the answer is 429 (at most `max` times) and returns that answer. */
async function untilLimited(send, max) {
  for (let i = 0; i < max; i++) {
    const res = await send();
    if (res.status === 429) return res;
  }
  throw new Error(`no 429 within ${max} requests`);
}

test('the admin login form, posted by a browser, answers with a page in the site layout', async () => {
  const post = () => request(app).post('/admin/login').set('X-Forwarded-For', '198.51.100.1')
    .set('Accept', BROWSER_ACCEPT).type('form').send({ email: 'someone@example.com' });

  const res = await untilLimited(post, 11);

  expect(res.status).toBe(429);
  expect(res.headers['content-type']).toMatch(/^text\/html/);
  expect(res.headers['retry-after']).toBe('900');
  expect(res.text).toContain('Zbyt wiele prób. Spróbuj ponownie za 15 minut.');
  expect(res.text).toContain('class="navbar"');
  expect(res.text).toContain('<footer');
});

test('a JSON client still gets JSON', async () => {
  const post = () => request(app).post('/admin/login').set('X-Forwarded-For', '198.51.100.2')
    .set('Accept', 'application/json').send({ email: 'someone@example.com' });

  const res = await untilLimited(post, 11);

  expect(res.headers['content-type']).toMatch(/^application\/json/);
  expect(res.body).toEqual({ error: expect.stringContaining('Spróbuj za 15 minut') });
});

test('the general limit shows the page too, with the signed-in user\'s navigation', async () => {
  const { user } = UserModel.getOrCreate('busy@example.com');
  MagicTokenModel.create(user.id, 'busy-token', new Date(Date.now() + 600000).toISOString());
  const agent = request.agent(app);
  await agent.post('/auth/verify').set('X-Forwarded-For', '198.51.100.3').type('form').send({ token: 'busy-token' });

  const res = await untilLimited(() => agent.get('/calendar').set('X-Forwarded-For', '198.51.100.3').set('Accept', BROWSER_ACCEPT), 21);

  expect(res.headers['content-type']).toMatch(/^text\/html/);
  expect(res.text).toContain('Zbyt wiele żądań. Spróbuj ponownie za 15 minut.');
  expect(res.text).not.toContain('Zbyt wiele prób');
  expect(res.text).toContain('Wyloguj');
});
