/**
 * instructorsAdmin.test.js — instructors are managed at /admin/instructors; the is_instructor flag on the account is
 * the only source of the role, and the INSTRUCTORS variable no longer creates or restores anyone.
 */

'use strict';

process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-test-secret-test-secret-1234';
process.env.NODE_ENV = 'test';
process.env.ADMIN_EMAILS = 'admin@example.com';
process.env.INSTRUCTORS = 'from.env@example.com:Env';

jest.mock('../services/emailService', () => ({
  initEmailService: jest.fn().mockResolvedValue(undefined),
  sendMagicLink: jest.fn().mockResolvedValue(undefined),
  sendParticipantRemovedEmail: jest.fn().mockResolvedValue(undefined),
  sendWaitingListPromotedEmail: jest.fn().mockResolvedValue(undefined)
}));

const request = require('supertest');
const app = require('../app');
const { UserModel, MagicTokenModel, ClassModel } = require('../models/database');

let seq = 0;
async function loginAs(email) {
  const { user } = UserModel.getOrCreate(email);
  const token = `instr-tok-${++seq}`;
  MagicTokenModel.create(user.id, token, new Date(Date.now() + 10 * 60 * 1000).toISOString());
  const agent = request.agent(app);
  await agent.post('/auth/verify').type('form').send({ token });
  return agent;
}

test('INSTRUCTORS creates no account', () => {
  expect(UserModel.findByEmail('from.env@example.com')).toBeUndefined();
});

test('an administrator adds an instructor by e-mail; the new account can open the instructor panel', async () => {
  const admin = await loginAs('admin@example.com');
  const res = await admin.post('/admin/instructors').type('form')
    .send({ email: 'Kasia@Example.com', firstName: 'Kasia', lastName: 'Lis' });
  expect(res.status).toBe(302);
  expect(res.headers.location).toMatch(/^\/admin\/instructors\?success=/);

  const kasia = UserModel.findByEmail('kasia@example.com');
  expect(kasia).toMatchObject({ is_instructor: 1, first_name: 'Kasia', last_name: 'Lis' });

  const list = await admin.get('/admin/instructors');
  expect(list.status).toBe(200);
  expect(list.text).toContain('kasia@example.com');
  expect((await admin.get('/admin/classes/new')).text).toContain(`<option value="${kasia.id}"`);

  const panel = await (await loginAs('kasia@example.com')).get('/instructor');
  expect(panel.status).toBe(200);
});

test('an existing account keeps its name when it becomes an instructor', async () => {
  const id = UserModel.create('existing@example.com', 'Marek', 'Wójcik').lastInsertRowid;
  const admin = await loginAs('admin@example.com');
  await admin.post('/admin/instructors').type('form').send({ email: 'existing@example.com', firstName: '', lastName: '' });
  expect(UserModel.findById(id)).toMatchObject({ is_instructor: 1, first_name: 'Marek', last_name: 'Wójcik' });
});

test('a new account needs a first and a last name, and the address must be valid', async () => {
  const admin = await loginAs('admin@example.com');

  const noName = await admin.post('/admin/instructors').type('form').send({ email: 'noname@example.com' });
  expect(noName.status).toBe(400);
  expect(noName.text).toContain('Podaj imię i nazwisko');
  expect(UserModel.findByEmail('noname@example.com')).toBeUndefined();

  const bad = await admin.post('/admin/instructors').type('form').send({ email: 'not-an-address', firstName: 'A', lastName: 'B' });
  expect(bad.status).toBe(400);
  expect(bad.text).toContain('Podaj prawidłowy adres e-mail');
});

test('removing an instructor revokes the panel at once and unlinks their classes, keeping the name as text', async () => {
  const admin = await loginAs('admin@example.com');
  await admin.post('/admin/instructors').type('form').send({ email: 'piotr@example.com', firstName: 'Piotr', lastName: 'Nowak' });
  const piotr = UserModel.findByEmail('piotr@example.com');
  const classId = ClassModel.create({
    name: 'Zajęcia Piotra', description: '', startTime: '2999-01-01T10:00', durationMin: 90,
    classType: 'adult_and_child', maxSpots: 5, maxChildSpots: 5,
    instructor: 'Piotr', instructorId: piotr.id, childInstructor: 'Piotr', childInstructorId: piotr.id
  }).lastInsertRowid;

  const piotrSession = await loginAs('piotr@example.com');
  expect((await piotrSession.get('/instructor')).status).toBe(200);

  const res = await admin.post(`/admin/instructors/${piotr.id}/remove`);
  expect(res.headers.location).toMatch(/^\/admin\/instructors\?success=/);

  expect(UserModel.findById(piotr.id).is_instructor).toBe(0);
  expect((await piotrSession.get('/instructor')).status).toBe(302);
  expect(ClassModel.getById(classId)).toMatchObject({
    instructor: 'Piotr', instructor_id: null, child_instructor: 'Piotr', child_instructor_id: null
  });
});

test('only an administrator can manage instructors', async () => {
  const participant = await loginAs('someone@example.com');
  expect((await participant.get('/admin/instructors')).headers.location).toBe('/admin/login');
  const res = await participant.post('/admin/instructors').type('form').send({ email: 'x@example.com', firstName: 'X', lastName: 'Y' });
  expect(res.headers.location).toBe('/admin/login');
  expect(UserModel.findByEmail('x@example.com')).toBeUndefined();
});
