/**
 * emailEscaping.test.js — names and class names typed by people are text in the HTML e-mails, never markup.
 */

'use strict';

process.env.NODE_ENV = 'test';
process.env.RESEND_API_KEY = 're_test_key';
process.env.APP_URL = 'https://booking.example.com';

const mockSend = jest.fn().mockResolvedValue({ data: { id: 'sent' }, error: null });
jest.mock('resend', () => ({ Resend: jest.fn().mockImplementation(() => ({ emails: { send: mockSend } })) }));

const { sendParticipantRemovedEmail, sendWaitingListPromotedEmail, sendMagicLink } = require('../services/emailService');

const HOSTILE_NAME = '<img src=x onerror=alert(1)> "Jan" & Co';
const HOSTILE_CLASS = '<a href="https://evil.example">Wspinaczka</a>';
const lastMessage = () => mockSend.mock.calls.at(-1)[0];

beforeEach(() => mockSend.mockClear());

test('the participant-removed e-mail escapes the participant and class names', async () => {
  await sendParticipantRemovedEmail('booker@example.com', HOSTILE_NAME, HOSTILE_CLASS, 'poniedziałek, 6 maja 2030 18:00');
  const { html, text } = lastMessage();

  expect(html).not.toContain('<img src=x');
  expect(html).not.toContain('<a href="https://evil.example">');
  expect(html).toContain('&lt;img src=x onerror=alert(1)&gt; &quot;Jan&quot; &amp; Co');
  expect(html).toContain('&lt;a href=&quot;https://evil.example&quot;&gt;Wspinaczka&lt;/a&gt;');
  expect(text).toContain(HOSTILE_NAME); // the plain-text part stays verbatim
});

test('the waiting-list e-mail escapes the first name and the class name', async () => {
  await sendWaitingListPromotedEmail('waiting@example.com', HOSTILE_NAME, HOSTILE_CLASS, '<b>date</b>', 'https://booking.example.com/dashboard');
  const { html } = lastMessage();

  expect(html).not.toContain('<img src=x');
  expect(html).not.toContain('<a href="https://evil.example">');
  expect(html).not.toContain('<b>date</b>');
  expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
});

test('the login link stays a working link in the HTML', async () => {
  await sendMagicLink('someone@example.com', 'https://booking.example.com/auth/verify?token=abc&next=%2Fcalendar');
  const { html } = lastMessage();
  expect(html).toContain('href="https://booking.example.com/auth/verify?token=abc&amp;next=%2Fcalendar"');
});
