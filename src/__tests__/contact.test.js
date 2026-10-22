/**
 * contact.test.js — the club's contact address is configuration (CONTACT_EMAIL), never a literal in the code.
 */

'use strict';

process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-test-secret-test-secret-1234';
process.env.NODE_ENV = 'test';
process.env.ADMIN_EMAILS = 'admin@example.com';
process.env.CONTACT_EMAIL = 'kontakt@club.example';
delete process.env.EMAIL_REPLY;

const sent = [];
jest.mock('resend', () => ({
  Resend: class {
    constructor() {
      this.emails = { send: async (message) => { sent.push(message); return { data: { id: 'test' }, error: null }; } };
    }
  }
}));

process.env.RESEND_API_KEY = 're_test';

const request = require('supertest');
const app = require('../app');
const email = require('../services/emailService');
const { contactEmail, DEFAULT_CONTACT_EMAIL } = require('../utils/contact');

describe('contactEmail', () => {
  test('uses CONTACT_EMAIL, trimmed', () => {
    expect(contactEmail({ CONTACT_EMAIL: '  hello@club.example ' })).toBe('hello@club.example');
  });

  test('falls back to a neutral placeholder when unset or blank', () => {
    expect(contactEmail({})).toBe(DEFAULT_CONTACT_EMAIL);
    expect(contactEmail({ CONTACT_EMAIL: '   ' })).toBe(DEFAULT_CONTACT_EMAIL);
    expect(DEFAULT_CONTACT_EMAIL).toBe('contact@example.com');
  });
});

describe('pages', () => {
  test.each(['/', '/privacy'])('%s shows the configured address', async (path) => {
    const res = await request(app).get(path);
    expect(res.status).toBe(200);
    expect(res.text).toContain('mailto:kontakt@club.example');
  });
});

describe('e-mails', () => {
  beforeEach(() => { sent.length = 0; });

  test('Reply-To defaults to the contact address and the bodies mention it', async () => {
    await email.sendMagicLink('a@example.com', 'https://app.example/auth/verify?t=1', false);
    await email.sendParticipantRemovedEmail('a@example.com', 'Jan Kowalski', 'Wspinaczka', '2026-10-20');
    await email.sendWaitingListPromotedEmail('a@example.com', 'Jan', 'Wspinaczka', '2026-10-20', 'https://app.example/dashboard');

    expect(sent).toHaveLength(3);
    for (const message of sent) expect(message.reply_to).toBe('kontakt@club.example');
    expect(sent[0].text).toContain('kontakt@club.example');
    expect(sent[1].html).toContain('mailto:kontakt@club.example');
    expect(sent[1].text).toContain('kontakt@club.example');
    expect(sent[2].html).toContain('mailto:kontakt@club.example');
    expect(sent[2].text).toContain('kontakt@club.example');
  });
});
