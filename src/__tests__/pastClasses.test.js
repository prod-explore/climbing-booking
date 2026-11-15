/**
 * pastClasses.test.js — the classes of the current week that are over stay on the calendars, greyed out and without a
 * way to book them, and the server refuses a booking of one.
 */

'use strict';

process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-test-secret-test-secret-1234';
process.env.NODE_ENV = 'test';
process.env.ADMIN_EMAILS = 'admin@example.com';

jest.mock('../services/emailService', () => ({
  initEmailService: jest.fn().mockResolvedValue(undefined),
  sendMagicLink: jest.fn().mockResolvedValue(undefined),
  sendParticipantRemovedEmail: jest.fn().mockResolvedValue(undefined),
  sendWaitingListPromotedEmail: jest.fn().mockResolvedValue(undefined)
}));

const request = require('supertest');
const app = require('../app');
const { UserModel, MagicTokenModel, ClassModel, BookingModel } = require('../models/database');
const { localDateTime } = require('../utils/localTime');
const { toCalendarEntries } = require('../utils/calendarWeek');

/** Local 'YYYY-MM-DDTHH:mm', as the class form stores a start time, `minutes` from now. */
const localStart = minutes => localDateTime(new Date(Date.now() + minutes * 60000)).slice(0, 16).replace(' ', 'T');

const makeClass = (name, minutes) => ClassModel.create({
  name, description: '', startTime: localStart(minutes), durationMin: 60, classType: 'adult_only',
  maxSpots: 5, instructor: ''
}).lastInsertRowid;

let seq = 0;
async function participant() {
  const { user } = UserModel.getOrCreate(`past${++seq}@example.com`);
  const token = `past-tok-${seq}`;
  MagicTokenModel.create(user.id, token, new Date(Date.now() + 10 * 60 * 1000).toISOString());
  const agent = request.agent(app);
  await agent.post('/auth/verify').type('form').send({ token });
  await agent.post('/profile/complete').type('form')
    .send({ firstName: 'Ewa', lastName: 'Nowak', birthDate: '1990-05-17', terms_accepted: 'on' });
  return { agent, id: user.id };
}

let over, ahead;

beforeAll(() => {
  require('../models/database').initDatabase();
  over = makeClass('Zajęcia sprzed chwili', -30);
  ahead = makeClass('Zajęcia za chwilę', 30);
});

/** The calendar entry (`kcal-ev` element) of a class on a rendered page. */
const entryOf = (html, name) => html.split('<div').find(chunk => chunk.includes('kcal-ev') && chunk.includes(`data-name="${name}"`));

describe('toCalendarEntries', () => {
  test('marks the classes that have started as past', () => {
    const entries = toCalendarEntries([ClassModel.getById(over), ClassModel.getById(ahead)]);
    expect(entries.map(e => e.isPast)).toEqual([true, false]);
  });
});

describe.each(['/', '/calendar'])('GET %s', path => {
  test('shows a class that is over greyed out, labelled and without a booking link', async () => {
    const html = (await request(app).get(path)).text;

    expect(entryOf(html, 'Zajęcia sprzed chwili')).toMatch(/kcal-ev--past/);
    expect(entryOf(html, 'Zajęcia sprzed chwili')).toContain('data-past="1"');
    expect(entryOf(html, 'Zajęcia sprzed chwili')).toContain('aria-label="Zajęcia sprzed chwili (zakończone)"');
    expect(entryOf(html, 'Zajęcia sprzed chwili')).toContain('Zakończone');
    expect(entryOf(html, 'Zajęcia za chwilę')).not.toMatch(/kcal-ev--past/);
    expect(entryOf(html, 'Zajęcia za chwilę')).toContain('data-past="0"');
  });
});

describe('the participant dashboard', () => {
  test('keeps a class that is over on the calendar, marked as past', async () => {
    const { agent } = await participant();
    const html = (await agent.get('/dashboard')).text;

    expect(entryOf(html, 'Zajęcia sprzed chwili')).toMatch(/kcal-ev--past/);
    expect(entryOf(html, 'Zajęcia za chwilę')).not.toMatch(/kcal-ev--past/);
  });

  test('still lists only the upcoming classes in its class list', async () => {
    expect(ClassModel.getUpcoming().map(c => c.id)).toEqual(expect.arrayContaining([ahead]));
    expect(ClassModel.getUpcoming().map(c => c.id)).not.toContain(over);
  });
});

describe('booking a class that is over', () => {
  test('the form and the POST are refused, and nothing is booked', async () => {
    const { agent, id } = await participant();

    const form = await agent.get(`/book/${over}`);
    expect(form.headers.location).toMatch(/^\/calendar\?error=/);

    const res = await agent.post(`/book/${over}`).type('form').send({});
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^\/calendar\?error=/);
    expect(BookingModel.findByUserAndClass(id, over)).toBeUndefined();
  });

  test('a class ahead can still be booked', async () => {
    const { agent, id } = await participant();
    const res = await agent.post(`/book/${ahead}`).type('form').send({});
    expect(res.headers.location).toMatch(/^\/dashboard\?success=/);
    expect(BookingModel.findByUserAndClass(id, ahead)).toBeDefined();
  });
});
