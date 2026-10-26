/**
 * minorConsent.test.js — a 16- or 17-year-old account books only after an administrator approves parental consent,
 * and then books like any other account: from the adult pool, with the adult booking form.
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
const { getDb, UserModel, MagicTokenModel, ClassModel, BookingModel } = require('../models/database');

let seq = 0;
async function loginAs(email) {
  const { user } = UserModel.getOrCreate(email);
  const token = `minor-tok-${++seq}`;
  MagicTokenModel.create(user.id, token, new Date(Date.now() + 10 * 60 * 1000).toISOString());
  const agent = request.agent(app);
  await agent.post('/auth/verify').type('form').send({ token });
  return { agent, id: user.id };
}

/** A birth date that makes the person 17 today: 17 years and a month ago, as YYYY-MM-DD. */
function birthDateAged17() {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 17);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function makeClass(classType = 'adult_only') {
  return ClassModel.create({
    name: `Zajęcia ${++seq}`, description: '', startTime: '2999-01-01T10:00', durationMin: 90,
    classType, maxSpots: 5, maxChildSpots: classType === 'adult_and_child' ? 5 : 0, instructor: ''
  }).lastInsertRowid;
}

async function seventeenYearOld() {
  const minor = await loginAs(`minor${++seq}@example.com`);
  await minor.agent.post('/profile/complete').type('form')
    .send({ firstName: 'Ola', lastName: 'Nowak', birthDate: birthDateAged17(), terms_accepted: 'on' });
  return minor;
}

async function approve(userId) {
  const admin = await loginAs('admin@example.com');
  await admin.agent.post('/consent/request'); // harmless for the admin: only a minor can ask
  const res = await admin.agent.post(`/admin/consents/${userId}/approve`);
  expect(res.status).toBe(302);
}

test('an unverified 17-year-old cannot book; after the admin approves the consent they can', async () => {
  const minor = await seventeenYearOld();
  const classId = makeClass();
  expect(UserModel.findById(minor.id)).toMatchObject({ is_verified: 0, age_category: 'adult' });

  const page = await minor.agent.get(`/book/${classId}`);
  expect(page.headers.location).toMatch(/^\/dashboard\?error=/);
  const refused = await minor.agent.post(`/book/${classId}`).type('form').send({});
  expect(refused.headers.location).toMatch(/^\/dashboard\?error=/);
  expect(BookingModel.findByUserAndClass(minor.id, classId)).toBeUndefined();

  expect((await minor.agent.post('/consent/request')).headers.location).toMatch(/^\/dashboard\?success=/);
  expect(UserModel.getPendingConsents().map(u => u.id)).toContain(minor.id);
  await approve(minor.id);

  const booked = await minor.agent.post(`/book/${classId}`).type('form').send({});
  expect(booked.headers.location).toMatch(/^\/dashboard\?success=/);
  expect(BookingModel.getSpotCounts(classId).adult_taken).toBe(1);
});

describe('an approved account still marked age_category = child (left from earlier versions)', () => {
  async function legacyChildAccount() {
    const minor = await seventeenYearOld();
    getDb().prepare("UPDATE users SET age_category = 'child' WHERE id = ?").run(minor.id);
    await approve(minor.id);
    return minor;
  }

  test('gets the normal booking form, not a children-group form', async () => {
    const minor = await legacyChildAccount();
    const page = await minor.agent.get(`/book/${makeClass('adult_and_child')}`);
    expect(page.status).toBe(200);
    expect(page.text).toContain('Osoba 1 (Ty)');
    expect(page.text).not.toContain('grupie dziecięcej');
  });

  test('takes an adult place in a family class', async () => {
    const minor = await legacyChildAccount();
    const classId = makeClass('adult_and_child');
    await minor.agent.post(`/book/${classId}`).type('form').send({});
    expect(BookingModel.getSpotCounts(classId)).toEqual({ adult_taken: 1, child_taken: 0 });
  });
});
