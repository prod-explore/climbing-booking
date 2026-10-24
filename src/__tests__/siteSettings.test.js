/**
 * siteSettings.test.js — the operator and venue details come from the admin panel, and every public address
 * (link previews, canonical link) comes from APP_URL: nothing about a particular club is written in a template.
 */

'use strict';

process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-test-secret-test-secret-1234';
process.env.NODE_ENV = 'test';
process.env.APP_URL = 'https://club.example/';
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
const { UserModel, MagicTokenModel, SiteSettingsModel } = require('../models/database');
const { normalize, resolve, isValidNip } = require('../utils/siteSettings');

const FORM = {
  org_name: 'Klub Testowy Jan Nowak',
  org_seat: 'Gliwice',
  org_nip: '123-456-32-18',
  venue_name: 'Hala Testowa',
  venue_street: 'ul. Przykładowa 5',
  venue_city: 'Zabrze - Centrum'
};

let seq = 0;
async function login(email) {
  const user = UserModel.findByEmail(email) || (UserModel.create(email, 'Jan', 'Kowalski'), UserModel.findByEmail(email));
  const token = `set-tok-${++seq}-${Math.random().toString(16).slice(2)}`;
  MagicTokenModel.create(user.id, token, new Date(Date.now() + 10 * 60 * 1000).toISOString());
  const agent = request.agent(app);
  await agent.post('/auth/verify').type('form').send({ token });
  return agent;
}

const meta = (html, property) => (html.match(new RegExp(`<meta property="${property}" content="([^"]*)"`)) || [])[1];

describe('isValidNip', () => {
  test('checks length and the control digit', () => {
    expect(isValidNip('1234563218')).toBe(true);
    expect(isValidNip('1234563219')).toBe(false);
    expect(isValidNip('123456321')).toBe(false);
    expect(isValidNip('abcdefghij')).toBe(false);
  });
});

describe('normalize', () => {
  test('trims, strips separators from the NIP, and ignores unknown fields', () => {
    const { values, errors } = normalize({ ...FORM, org_name: '  Klub  ', evil: 'x' });
    expect(errors).toEqual([]);
    expect(values.org_name).toBe('Klub');
    expect(values.org_nip).toBe('1234563218');
    expect(values).not.toHaveProperty('evil');
  });

  test('reports a bad NIP and an over-long value, and treats non-strings as empty', () => {
    const { values, errors } = normalize({ ...FORM, org_nip: '1234563219', org_seat: 'x'.repeat(200), venue_name: ['a'] });
    expect(errors).toHaveLength(2);
    expect(values.org_seat).toHaveLength(80);
    expect(values.venue_name).toBe('');
  });

  test('replaces control characters instead of storing them', () => {
    expect(normalize({ ...FORM, org_name: 'A\r\nB\u0000C' }).values.org_name).toBe('A  B C');
  });
});

describe('resolve', () => {
  test('shows a placeholder for what is missing and does not invent a map', () => {
    const site = resolve({});
    expect(site.org_name).toBe('[nazwa administratora danych]');
    expect(site.missing).toEqual(expect.arrayContaining(['org_name', 'org_seat', 'venue_name', 'venue_street', 'venue_city']));
    expect(site.hasVenue).toBe(false);
    expect(site.mapEmbedUrl).toBe('');
    expect(site.hasNip).toBe(false);
  });

  test('builds the map addresses from the venue, encoded', () => {
    const site = resolve(normalize(FORM).values);
    expect(site.missing).toEqual([]);
    expect(site.hasVenue).toBe(true);
    expect(site.mapEmbedUrl).toBe(`https://www.google.com/maps?q=${encodeURIComponent('Hala Testowa, ul. Przykładowa 5, Zabrze - Centrum')}&hl=pl&output=embed`);
    expect(site.mapLinkUrl).toContain('https://www.google.com/maps/search/?api=1&query=Hala%20Testowa');
  });
});

describe('link previews and the canonical link use APP_URL', () => {
  test('og:url is the requested path on the configured host, without the query', async () => {
    const home = await request(app).get('/');
    expect(meta(home.text, 'og:url')).toBe('https://club.example/');

    const terms = await request(app).get('/terms?utm_source=messenger');
    expect(meta(terms.text, 'og:url')).toBe('https://club.example/terms');
    expect(terms.text).toContain('<link rel="canonical" href="https://club.example/terms">');
  });

  test('the preview image is an absolute address (Messenger ignores relative ones)', async () => {
    const res = await request(app).get('/');
    expect(meta(res.text, 'og:image')).toBe('https://club.example/images/fw-logo.png');
    expect(res.text).toContain('<meta property="twitter:image" content="https://club.example/images/fw-logo.png">');
  });

  test('every absolute address in the head belongs to the configured host or to a font/maps provider', async () => {
    const res = await request(app).get('/privacy');
    const head = res.text.slice(0, res.text.indexOf('</head>'));
    const hosts = new Set([...head.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map(m => m[1]));
    for (const host of hosts) expect(['club.example', 'fonts.googleapis.com', 'fonts.gstatic.com']).toContain(host);
  });
});

describe('/admin/settings', () => {
  test('is closed to visitors and to ordinary users', async () => {
    expect((await request(app).get('/admin/settings')).status).not.toBe(200);
    expect((await request(app).post('/admin/settings').type('form').send(FORM)).status).not.toBe(200);

    const user = await login('someone@example.com');
    expect((await user.get('/admin/settings')).status).not.toBe(200);
    expect((await user.post('/admin/settings').type('form').send(FORM)).status).not.toBe(200);
    expect(SiteSettingsModel.all()).toEqual({});
  });

  test('an unconfigured site shows placeholders on the public pages and a reminder to the admin', async () => {
    const privacy = await request(app).get('/privacy');
    expect(privacy.text).toContain('[nazwa administratora danych]');
    expect(privacy.text).not.toContain('NIP:');

    const admin = await login('admin@example.com');
    const dashboard = await admin.get('/admin');
    expect(dashboard.status).toBe(200);
    expect(dashboard.text).toContain('Uzupełnij ustawienia');
  });

  test('rejects a bad NIP and saves nothing', async () => {
    const admin = await login('admin@example.com');

    const res = await admin.post('/admin/settings').type('form').send({ ...FORM, org_nip: '1234563219' });

    expect(res.status).toBe(400);
    expect(res.text).toContain('NIP');
    expect(SiteSettingsModel.all()).toEqual({});
  });

  test('saves the settings, and the public pages print them', async () => {
    const admin = await login('admin@example.com');

    const saved = await admin.post('/admin/settings').type('form').send(FORM);
    expect(saved.status).toBe(302);
    expect(saved.headers.location).toMatch(/^\/admin\/settings\?success=/);
    expect(SiteSettingsModel.all().org_nip).toBe('1234563218');

    const form = await admin.get('/admin/settings');
    expect(form.text).toContain('value="Klub Testowy Jan Nowak"');
    expect(form.text).toContain('value="1234563218"');

    const privacy = await request(app).get('/privacy');
    expect(privacy.text).toContain('Klub Testowy Jan Nowak');
    expect(privacy.text).toContain('NIP: 1234563218');
    expect(privacy.text).toContain('Gliwice');
    expect(privacy.text).toContain('club.example');

    const terms = await request(app).get('/terms');
    expect(terms.text).toContain('Regulaminu Obiektu Hala Testowa');

    const home = await request(app).get('/');
    expect(home.text).toContain('ul. Przykładowa 5');
    expect(home.text).toContain('Zabrze - Centrum');
    expect(home.text).toContain('https://www.google.com/maps?q=Hala%20Testowa');

    const dashboard = await admin.get('/admin');
    expect(dashboard.text).not.toContain('Uzupełnij ustawienia');
  });

  test('an empty value removes the setting again', async () => {
    const admin = await login('admin@example.com');
    await admin.post('/admin/settings').type('form').send(FORM);

    await admin.post('/admin/settings').type('form').send({ ...FORM, org_nip: '' });

    expect(SiteSettingsModel.all()).not.toHaveProperty('org_nip');
    expect((await request(app).get('/privacy')).text).not.toContain('NIP:');
  });
});

describe('funding note', () => {
  const FUNDING = /dofinansowan|Unii Europejskiej|unijn|Finansowane z UE|🇪🇺|za darmo|darmow/i;
  const PAGES = ['/', '/login', '/calendar', '/privacy', '/terms'];

  test('is empty by default, and no page mentions funding or free classes', async () => {
    await (await login('admin@example.com')).post('/admin/settings').type('form').send(FORM);
    for (const path of PAGES) {
      const res = await request(app).get(path);
      expect(res.status).toBe(200);
      expect(res.text).not.toMatch(FUNDING);
    }
  });

  test('once filled in, appears on the home and login pages and in the footer, escaped', async () => {
    const admin = await login('admin@example.com');
    const note = 'Projekt dofinansowany ze środków UE <b>2026</b>';
    await admin.post('/admin/settings').type('form').send({ ...FORM, funding_note: note });

    // sanitizeBody strips the tag before it is stored; what is left is printed escaped
    expect(SiteSettingsModel.all().funding_note).toBe('Projekt dofinansowany ze środków UE 2026');
    for (const path of ['/', '/login', '/privacy']) {
      expect((await request(app).get(path)).text).toContain('Projekt dofinansowany ze środków UE 2026');
    }

    await admin.post('/admin/settings').type('form').send({ ...FORM, funding_note: '' });
    expect((await request(app).get('/login')).text).not.toMatch(FUNDING);
  });
});
