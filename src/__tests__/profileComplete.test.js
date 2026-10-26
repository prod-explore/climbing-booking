/**
 * profileComplete.test.js — booking needs a complete profile: first and last name, birth date and the accepted terms.
 * The names that administrator and instructor accounts are created with do not count, also after losing the role;
 * the admin and instructor panels keep working without a profile.
 */

'use strict';

process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-test-secret-test-secret-1234';
process.env.NODE_ENV = 'test';
process.env.ADMIN_EMAILS = 'owner@example.com, leaving@example.com';

jest.mock('../services/emailService', () => ({
  initEmailService: jest.fn().mockResolvedValue(undefined),
  sendMagicLink: jest.fn().mockResolvedValue(undefined),
  sendParticipantRemovedEmail: jest.fn().mockResolvedValue(undefined),
  sendWaitingListPromotedEmail: jest.fn().mockResolvedValue(undefined)
}));

const request = require('supertest');
const app = require('../app');
const { getDb, UserModel, MagicTokenModel, ClassModel } = require('../models/database');

const LISTED = process.env.ADMIN_EMAILS;
let seq = 0;
let classId;

async function loginAs(email) {
  const { user } = UserModel.getOrCreate(email);
  const token = `profile-tok-${++seq}`;
  MagicTokenModel.create(user.id, token, new Date(Date.now() + 10 * 60 * 1000).toISOString());
  const agent = request.agent(app);
  const res = await agent.post('/auth/verify').type('form').send({ token });
  return { agent, res, id: user.id };
}

const sentToProfile = res => res.status === 302 && res.headers.location.startsWith('/profile/complete');

beforeAll(() => {
  classId = ClassModel.create({
    name: 'Wspinaczka', description: '', startTime: '2999-01-01T10:00', maxSpots: 5, instructor: ''
  }).lastInsertRowid;
});

afterEach(() => {
  process.env.ADMIN_EMAILS = LISTED;
});

test('a former administrator is asked for the profile before booking', async () => {
  const { agent } = await loginAs('leaving@example.com');
  expect((await agent.get('/admin')).status).toBe(200);

  process.env.ADMIN_EMAILS = 'owner@example.com';

  expect(sentToProfile(await agent.get(`/book/${classId}`))).toBe(true);
  expect(sentToProfile(await agent.post(`/book/${classId}`).type('form').send({}))).toBe(true);
});

test('a former instructor is asked for the profile before booking', async () => {
  const admin = await loginAs('owner@example.com');
  await admin.agent.post('/admin/instructors').type('form')
    .send({ email: 'ex.instructor@example.com', firstName: 'Ewa', lastName: 'Lis' });
  const id = UserModel.findByEmail('ex.instructor@example.com').id;
  await admin.agent.post(`/admin/instructors/${id}/remove`);

  const { agent } = await loginAs('ex.instructor@example.com');
  expect(sentToProfile(await agent.get(`/book/${classId}`))).toBe(true);
});

test('names and a birth date without the accepted terms are not a complete profile', async () => {
  const { id } = await loginAs('no.terms@example.com');
  getDb().prepare("UPDATE users SET first_name = 'Jan', last_name = 'Nowak', birth_date = '1990-01-01', is_verified = 1 WHERE id = ?")
    .run(id);

  const { agent } = await loginAs('no.terms@example.com');
  expect(sentToProfile(await agent.get(`/book/${classId}`))).toBe(true);
});

test('the profile form completes the profile', async () => {
  const { agent, res } = await loginAs('participant@example.com');
  expect(sentToProfile(res)).toBe(true);

  await agent.post('/profile/complete').type('form')
    .send({ firstName: 'Ala', lastName: 'Kot', birthDate: '1990-05-05', terms_accepted: 'on' });

  expect((await agent.get(`/book/${classId}`)).status).toBe(200);
});

test('an administrator without a profile keeps the admin panel', async () => {
  const { agent, res } = await loginAs('owner@example.com');
  expect(res.headers.location).toBe('/admin');
  expect((await agent.get('/admin')).status).toBe(200);
});

test('an instructor without a profile signs in to the instructor panel', async () => {
  const admin = await loginAs('owner@example.com');
  await admin.agent.post('/admin/instructors').type('form')
    .send({ email: 'instructor@example.com', firstName: 'Piotr', lastName: 'Wolny' });

  const { agent, res } = await loginAs('instructor@example.com');
  expect(res.headers.location).toBe('/instructor');
  expect((await agent.get('/instructor')).status).toBe(200);
  expect(sentToProfile(await agent.get(`/book/${classId}`))).toBe(true);
});
