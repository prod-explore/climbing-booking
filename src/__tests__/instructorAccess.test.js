/**
 * instructorAccess.test.js — an instructor sees the classes linked to their account and nothing else.
 * Before migration 008 the panel matched the class's instructor text with LIKE '%first name%', so "Jan" also saw
 * "Janina"'s classes and the e-mail addresses of her participants.
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

let seq = 0;
async function loginAs(email) {
  const user = UserModel.findByEmail(email);
  const token = `ins-tok-${++seq}`;
  MagicTokenModel.create(user.id, token, new Date(Date.now() + 10 * 60 * 1000).toISOString());
  const agent = request.agent(app);
  await agent.post('/auth/verify').type('form').send({ token });
  return agent;
}

let janinaClassId;

beforeAll(() => {
  for (const [email, first] of [['jan@example.com', 'Jan'], ['janina@example.com', 'Janina']]) {
    UserModel.grantInstructor(UserModel.create(email, first, 'Instruktor').lastInsertRowid);
  }
  const janina = UserModel.findByEmail('janina@example.com');
  janinaClassId = ClassModel.create({
    name: 'Zajęcia Janiny', description: '', startTime: '2030-05-06T18:00', durationMin: 90,
    classType: 'adult_only', maxSpots: 10, instructor: 'Janina', instructorId: janina.id
  }).lastInsertRowid;

  const participant = UserModel.create('uczestniczka@example.com', 'Ewa', 'Nowak').lastInsertRowid;
  BookingModel.book(participant, janinaClassId, [{ firstName: 'Ewa', lastName: 'Nowak', ageCategory: 'adult', isMain: true, age: 30 }]);
});

test('"Jan" does not see "Janina"\'s classes on his dashboard', async () => {
  const jan = await loginAs('jan@example.com');
  const res = await jan.get('/instructor');
  expect(res.status).toBe(200);
  expect(res.text).not.toContain('Zajęcia Janiny');
});

test('"Jan" cannot open the participant list of "Janina"\'s class, nor read its e-mail addresses', async () => {
  const jan = await loginAs('jan@example.com');
  const res = await jan.get(`/instructor/classes/${janinaClassId}/attendance`);
  expect(res.status).toBe(302);
  expect(res.headers.location).toMatch(/^\/instructor\?error=/);
  expect(res.text).not.toContain('uczestniczka@example.com');
});

test('"Janina" sees her class and its participants', async () => {
  const janina = await loginAs('janina@example.com');
  expect((await janina.get('/instructor')).text).toContain('Zajęcia Janiny');

  const list = await janina.get(`/instructor/classes/${janinaClassId}/attendance`);
  expect(list.status).toBe(200);
  expect(list.text).toContain('uczestniczka@example.com');
});

test('a class with the instructor only as text, not linked to an account, is visible to no instructor', async () => {
  const id = ClassModel.create({
    name: 'Tylko tekst', description: '', startTime: '2030-05-07T18:00', durationMin: 90,
    classType: 'adult_only', maxSpots: 10, instructor: 'Jan'
  }).lastInsertRowid;
  const jan = await loginAs('jan@example.com');
  expect((await jan.get('/instructor')).text).not.toContain('Tylko tekst');
  expect((await jan.get(`/instructor/classes/${id}/attendance`)).status).toBe(302);
});
