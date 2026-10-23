/**
 * auth.test.js — the magic-link flow over HTTP (no port is opened), on the real app and database.
 * Only the e-mail sender is replaced.
 */

'use strict';

process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-test-secret-test-secret-1234';
process.env.NODE_ENV = 'test';
process.env.ADMIN_EMAILS = 'admin@example.com';
process.env.MAGIC_LINK_RATE_LIMIT_MAX = '1000';

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
const { safeNext } = require('../utils/safeNext');
const { createWindowLimiter } = require('../middleware/security');

let seq = 0;
function makeUser({ withProfile = true } = {}) {
  const email = `auth${++seq}@example.com`;
  const id = UserModel.create(email, withProfile ? 'Jan' : null, withProfile ? 'Kowalski' : null).lastInsertRowid;
  return { id, email };
}

function makeToken(userId, minutes = 15) {
  const token = `tok-${++seq}-${Math.random().toString(16).slice(2)}`;
  MagicTokenModel.create(userId, token, new Date(Date.now() + minutes * 60 * 1000).toISOString());
  return token;
}

const isUsed = (token) => getDb().prepare('SELECT used FROM magic_tokens WHERE token = ?').get(token).used;

beforeEach(() => sendMagicLink.mockClear());

describe('GET /auth/verify (the link in the e-mail)', () => {
  test('shows a confirmation page and does not use the token up', async () => {
    const token = makeToken(makeUser().id);

    const res = await request(app).get(`/auth/verify?token=${token}`);

    expect(res.status).toBe(200);
    expect(res.text).toContain('action="/auth/verify"');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(isUsed(token)).toBe(0);

    // A mail scanner opening the link twice changes nothing.
    const again = await request(app).get(`/auth/verify?token=${token}`);
    expect(again.status).toBe(200);
    expect(isUsed(token)).toBe(0);
  });

  test('sends an expired or unknown token back to the login page', async () => {
    const expired = makeToken(makeUser().id, -1);

    for (const token of [expired, 'no-such-token']) {
      const res = await request(app).get(`/auth/verify?token=${token}`);
      expect(res.status).toBe(302);
      expect(res.headers.location).toMatch(/^\/login\?error=/);
    }
  });

  test('a token given twice in the query string does not crash the server', async () => {
    const res = await request(app).get('/auth/verify?token=a&token=b');
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^\/login\?error=/);
  });
});

describe('POST /auth/verify', () => {
  test('logs in once', async () => {
    const user = makeUser();
    const token = makeToken(user.id);

    const first = await request(app).post('/auth/verify').type('form').send({ token });
    expect(first.status).toBe(302);
    expect(first.headers.location).toBe('/dashboard');
    expect(first.headers['set-cookie'].join(';')).toMatch(/authToken=.+HttpOnly/);
    expect(isUsed(token)).toBe(1);

    const second = await request(app).post('/auth/verify').type('form').send({ token });
    expect(second.status).toBe(302);
    expect(second.headers.location).toMatch(/^\/login\?error=/);
    expect(second.headers['set-cookie']).toBeUndefined();
  });

  test('a new user without a profile is sent to complete it', async () => {
    const token = makeToken(makeUser({ withProfile: false }).id);

    const res = await request(app).post('/auth/verify').type('form').send({ token, next: '/calendar' });

    expect(res.headers.location).toBe('/profile/complete?next=%2Fcalendar');
  });

  test('refuses an expired token', async () => {
    const token = makeToken(makeUser().id, -1);

    const res = await request(app).post('/auth/verify').type('form').send({ token });

    expect(res.headers.location).toMatch(/^\/login\?error=/);
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  test.each(['//evil.example', '/\\evil.example', 'https://evil.example', '/\t/evil.example'])(
    'does not redirect to another site (next=%j)',
    async (next) => {
      const token = makeToken(makeUser().id);

      const res = await request(app).post('/auth/verify').type('form').send({ token, next });

      expect(res.headers.location).toBe('/dashboard');
    }
  );

  test('keeps a local next', async () => {
    const token = makeToken(makeUser().id);

    const res = await request(app).post('/auth/verify').type('form').send({ token, next: '/book/7?x=1' });

    expect(res.headers.location).toBe('/book/7?x=1');
  });
});

describe('POST /auth/request', () => {
  test('sends a link with a safe next, and drops an unsafe one', async () => {
    const safe = await request(app).post('/auth/request').type('form').send({ email: 'safe@example.com', next: '/calendar' });
    expect(safe.status).toBe(200);
    expect(sendMagicLink.mock.calls[0][1]).toMatch(/\/auth\/verify\?token=[0-9a-f]{64}&next=%2Fcalendar$/);

    sendMagicLink.mockClear();
    await request(app).post('/auth/request').type('form').send({ email: 'unsafe@example.com', next: '/\\evil.example' });
    expect(sendMagicLink.mock.calls[0][1]).not.toContain('next=');
  });

  test('stops after a few links to the same address, whatever the IP', async () => {
    const send = () => request(app).post('/auth/request').type('form').send({ email: 'victim@example.com' });

    for (let i = 0; i < 3; i++) await send();
    const fourth = await send();

    expect(sendMagicLink).toHaveBeenCalledTimes(3);
    expect(fourth.text).toContain('Wysłaliśmy już kilka linków');
  });
});

describe('GET /login', () => {
  test('ignores an unsafe or malformed next', async () => {
    for (const query of ['next=/%5Cevil.example', 'next[]=/x', 'next[a]=/x']) {
      const res = await request(app).get(`/login?${query}`);
      expect(res.status).toBe(200);
      expect(res.text).not.toContain('evil.example');
    }
  });
});

describe('safeNext', () => {
  test('accepts local paths only', () => {
    expect(safeNext('/calendar')).toBe('/calendar');
    expect(safeNext('/book/3?error=x#top')).toBe('/book/3?error=x#top');
    for (const bad of [undefined, null, '', 'calendar', '//host', '/\\host', 'https://host', 'javascript:alert(1)', ['/a'], { a: 1 }]) {
      expect(safeNext(bad)).toBe('/dashboard');
    }
  });

  test('uses the fallback it is given', () => {
    expect(safeNext('//host', null)).toBeNull();
  });

  test('nothing it accepts leaves the host (WHATWG parser, as browsers do)', () => {
    for (const candidate of ['/a', '/a/b?c=d', '/\\evil.example', '//evil.example', '/\t/evil.example', '/\n/evil.example']) {
      const accepted = safeNext(candidate, null);
      if (accepted) expect(new URL(accepted, 'https://site.example').host).toBe('site.example');
    }
  });
});

describe('createWindowLimiter', () => {
  test('allows `max` events per window and frees places as the window slides', () => {
    let t = 0;
    const limiter = createWindowLimiter({ max: 2, windowMs: 1000, now: () => t });

    expect(limiter.take('a')).toBe(true);
    expect(limiter.take('a')).toBe(true);
    expect(limiter.take('a')).toBe(false);
    expect(limiter.take('b')).toBe(true); // other keys are independent

    t = 1001;
    expect(limiter.take('a')).toBe(true);
  });
});
