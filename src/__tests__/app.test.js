/**
 * app.test.js — HTTP-level tests of the Express app (no port is opened).
 */

'use strict';

process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-test-secret-test-secret-1234';
process.env.NODE_ENV = 'test';
process.env.ADMIN_EMAILS = 'admin@example.com';

const request = require('supertest');
const app = require('../app');

describe('health check', () => {
  test('GET /healthz answers ok and is not rate limited', async () => {
    for (let i = 0; i < 5; i++) {
      const res = await request(app).get('/healthz');
      expect(res.status).toBe(200);
      expect(res.text).toBe('ok');
    }
  });
});

describe('unknown routes', () => {
  test('GET /nope renders the 404 page', async () => {
    const res = await request(app).get('/nope');
    expect(res.status).toBe(404);
  });
});

describe('same-origin check', () => {
  test('a cross-origin POST is rejected before any route runs', async () => {
    const res = await request(app)
      .post('/auth/logout')
      .set('Host', 'booking.example.com')
      .set('Origin', 'https://evil.example.net');
    expect(res.status).toBe(403);
  });

  test('a same-origin POST goes through', async () => {
    const res = await request(app)
      .post('/auth/logout')
      .set('Host', 'booking.example.com')
      .set('Origin', 'https://booking.example.com');
    expect(res.status).not.toBe(403);
  });

  test('a POST without Origin or Referer (non-browser client) goes through', async () => {
    const res = await request(app).post('/auth/logout');
    expect(res.status).not.toBe(403);
  });

  test('the Referer is used when Origin is absent', async () => {
    const res = await request(app)
      .post('/auth/logout')
      .set('Host', 'booking.example.com')
      .set('Referer', 'https://evil.example.net/page');
    expect(res.status).toBe(403);
  });

  test('Origin: null (sandboxed frame, or a page served with no-referrer) is rejected', async () => {
    const res = await request(app)
      .post('/auth/logout')
      .set('Host', 'booking.example.com')
      .set('Origin', 'null');
    expect(res.status).toBe(403);
  });

  test('GET requests are never checked', async () => {
    const res = await request(app).get('/healthz').set('Origin', 'https://evil.example.net');
    expect(res.status).toBe(200);
  });
});

describe('protected pages', () => {
  test('the admin panel sends anonymous visitors to the admin login', async () => {
    const res = await request(app).get('/admin');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/admin/login');
  });
});

describe('security headers', () => {
  test('responses carry a content security policy and no X-Powered-By', async () => {
    const res = await request(app).get('/nope');
    expect(res.headers['content-security-policy']).toBeDefined();
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  test('the referrer policy lets browsers send a real Origin on same-site form posts', async () => {
    // Under `no-referrer` (helmet's default) browsers send `Origin: null` on every form POST,
    // which the same-origin check refuses: no form on the site would work.
    const res = await request(app).get('/nope');
    expect(res.headers['referrer-policy']).toBe('same-origin');
  });
});
