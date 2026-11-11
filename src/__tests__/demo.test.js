/**
 * demo.test.js — the demo instance (DEMO_MODE=true) over HTTP, on the real app and an in-memory database that the
 * app has filled with the sample data at start-up. Only the Resend client is replaced, with a key set so that a
 * message that was sent anyway would reach it.
 */

'use strict';

process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-test-secret-test-secret-1234';
process.env.NODE_ENV = 'test';
process.env.ADMIN_EMAILS = 'admin@example.com';
process.env.DEMO_MODE = 'true';
process.env.RESEND_API_KEY = 're_test_key';
process.env.RATE_LIMIT_MAX_REQUESTS = '1000';
process.env.MAGIC_LINK_RATE_LIMIT_MAX = '1000';

const mockSend = jest.fn().mockResolvedValue({ data: { id: 'real' }, error: null });
jest.mock('resend', () => ({ Resend: jest.fn(() => ({ emails: { send: mockSend } })) }));

const request = require('supertest');
const { Resend } = require('resend');
const app = require('../app');
const { getDb, UserModel } = require('../models/database');
const { DEMO_ACCOUNTS } = require('../utils/demoMode');

/** An agent signed in through the demo button of the given role. */
async function enterAs(role) {
  const agent = request.agent(app);
  const res = await agent.post('/demo/login').type('form').send({ role });
  return { agent, res };
}

describe('POST /demo/login', () => {
  test.each([
    ['participant', '/dashboard'],
    ['instructor', '/instructor'],
    ['admin', '/admin']
  ])('%s enters with one click and reaches the panel with the normal session cookie', async (role, landing) => {
    const { agent, res } = await enterAs(role);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(landing);
    expect(res.headers['set-cookie'].join(';')).toMatch(/authToken=.+HttpOnly.+SameSite=Lax/);

    const panel = await agent.get(landing);
    expect(panel.status).toBe(200);
  });

  test('the participant has a complete profile, so the profile form never stops the visitor', async () => {
    const { agent } = await enterAs('participant');

    const res = await agent.get('/book/' + getDb().prepare('SELECT id FROM classes ORDER BY id LIMIT 1').get().id);
    expect(res.headers.location || '').not.toMatch(/profile\/complete/);
    expect((await agent.get('/dashboard')).status).toBe(200);
  });

  test('the instructor sees the classes linked to the account, the administrator the consent waiting for approval', async () => {
    const instructor = await enterAs('instructor');
    expect((await instructor.agent.get('/instructor')).text).toContain('Wspinaczka dla początkujących');

    const admin = await enterAs('admin');
    const consents = await admin.agent.get('/admin/consents');
    expect(consents.status).toBe(200);
    expect(consents.text).toContain('Julia');
  });

  test('the demo administrator is an administrator without being listed in ADMIN_EMAILS', async () => {
    expect(process.env.ADMIN_EMAILS).not.toContain(DEMO_ACCOUNTS.admin);

    const { agent } = await enterAs('admin');
    const res = await agent.get('/admin/instructors');
    expect(res.status).toBe(200);
    expect(UserModel.findByEmail(DEMO_ACCOUNTS.admin).is_admin).toBe(1);
  });

  test('a participant is not an administrator', async () => {
    const { agent } = await enterAs('participant');
    const res = await agent.get('/admin');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/admin/login');
  });

  test.each([undefined, '', 'superuser', '__proto__', 'constructor', ['admin', 'admin']])(
    'refuses an unknown role (%j) and signs nobody in',
    async (role) => {
      const res = await request(app).post('/demo/login').type('form').send({ role });

      expect(res.status).toBe(400);
      expect(res.headers['set-cookie']).toBeUndefined();
    }
  );

  test('is protected by the same-origin check like every other POST', async () => {
    const res = await request(app)
      .post('/demo/login')
      .set('Host', 'cb-demo.example.com')
      .set('Origin', 'https://evil.example.net')
      .type('form')
      .send({ role: 'admin' });

    expect(res.status).toBe(403);
    expect(res.headers['set-cookie']).toBeUndefined();

    const sameOrigin = await request(app)
      .post('/demo/login')
      .set('Host', 'cb-demo.example.com')
      .set('Origin', 'https://cb-demo.example.com')
      .type('form')
      .send({ role: 'admin' });
    expect(sameOrigin.status).toBe(302);
  });
});

describe('the public calendar', () => {
  test('lists classes without choosing a week: this week\'s upcoming classes are seeded, and next week\'s', async () => {
    const week1 = await request(app).get('/calendar?week=1');
    expect(week1.text).toContain('Wspinaczka dla początkujących');

    // Seeded classes of the current week are the ones that have not started yet, so on Saturday evening there are none.
    const { getWeekBounds, inWeek } = require('../utils/calendarWeek');
    const { ClassModel } = require('../models/database');
    const thisWeek = inWeek(ClassModel.getUpcoming(), getWeekBounds(0));
    const week0 = await request(app).get('/calendar');
    for (const c of thisWeek) expect(week0.text).toContain(c.name);
  });
});

describe('the banner', () => {
  test.each(['/', '/calendar', '/login', '/admin/login', '/terms', '/no-such-page'])('is on %s', async (path) => {
    const res = await request(app).get(path);

    expect(res.text).toContain('Wersja demonstracyjna');
    expect(res.text).toContain('co noc');
    expect(res.text).toMatch(/<form action="\/demo\/login" method="POST"/);
    for (const [role, label] of [['participant', 'Uczestnik'], ['instructor', 'Instruktor'], ['admin', 'Administrator']]) {
      expect(res.text).toMatch(new RegExp(`name="role" value="${role}"[^>]*>${label}</button>`));
    }
  });

  test.each([['participant', '/dashboard'], ['instructor', '/instructor'], ['admin', '/admin']])(
    'is on the %s panel',
    async (role, path) => {
      const { agent } = await enterAs(role);
      expect((await agent.get(path)).text).toContain('Wersja demonstracyjna');
    }
  );

  test('the login pages point to the buttons', async () => {
    for (const path of ['/login', '/admin/login']) {
      const res = await request(app).get(path);
      expect(res.text).toContain('logowanie linkiem e-mail jest tu wyłączone');
    }
  });
});

describe('X-Robots-Tag', () => {
  test.each(['/', '/healthz', '/css/main.css', '/no-such-page', '/login'])('is sent with %s', async (path) => {
    const res = await request(app).get(path);
    expect(res.headers['x-robots-tag']).toBe('noindex, nofollow');
  });
});

describe('e-mail', () => {
  test('the participant login form sends nothing, creates no account and tells the visitor to use the buttons', async () => {
    const res = await request(app).post('/auth/request').type('form').send({ email: 'visitor@example.com' });

    expect(res.status).toBe(200);
    expect(res.text).toContain('logowanie linkiem e-mail jest wyłączone');
    expect(res.text).not.toContain('Link wysłany');
    expect(UserModel.findByEmail('visitor@example.com')).toBeUndefined();
    expect(getDb().prepare('SELECT COUNT(*) AS n FROM magic_tokens').get().n).toBe(0);
    expect(Resend).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });

  test('the administrator login form sends nothing, not even to the demo administrator', async () => {
    for (const email of [DEMO_ACCOUNTS.admin, 'admin@example.com']) {
      const res = await request(app).post('/admin/login').type('form').send({ email });

      expect(res.status).toBe(200);
      expect(res.text).toContain('logowanie linkiem e-mail jest wyłączone');
      expect(res.text).not.toContain('Link wysłany');
    }
    expect(getDb().prepare('SELECT COUNT(*) AS n FROM magic_tokens').get().n).toBe(0);
    expect(Resend).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });
});
