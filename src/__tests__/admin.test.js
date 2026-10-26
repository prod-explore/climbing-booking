/**
 * admin.test.js — the class form and the admin login, over HTTP on the real app and database.
 * Only the e-mail sender is replaced.
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
const { UserModel, MagicTokenModel, ClassModel, BookingModel, WaitingListModel } = require('../models/database');
const { sendMagicLink, sendWaitingListPromotedEmail } = require('../services/emailService');

beforeAll(() => {
  for (const [email, first] of [['anna@example.com', 'Anna'], ['ola@example.com', 'Ola']]) {
    UserModel.grantInstructor(UserModel.create(email, first, 'Instruktor').lastInsertRowid);
  }
});

let seq = 0;
async function loginAsAdmin() {
  const user = UserModel.findByEmail('admin@example.com');
  const token = `adm-tok-${++seq}`;
  MagicTokenModel.create(user.id, token, new Date(Date.now() + 10 * 60 * 1000).toISOString());
  const agent = request.agent(app);
  await agent.post('/auth/verify').type('form').send({ token });
  return agent;
}

const CLASS_FORM = {
  name: 'Wspinaczka',
  startTime: '2030-05-06T18:00',
  endTime: '2030-05-06T19:30',
  classType: 'adult_only',
  maxSpots: '10',
  color: '#336699'
};

describe('POST /admin/classes', () => {
  test('a rejected form is shown again without the submitted colour reaching the markup', async () => {
    const admin = await loginAsAdmin();
    const res = await admin.post('/admin/classes').type('form')
      .send({ ...CLASS_FORM, name: '', color: '" onmouseover="window.pwned=1' });

    expect(res.status).toBe(200);
    expect(res.text).toContain('Wymagana: nazwa zajęć.');
    expect(res.text).not.toContain('onmouseover="window.pwned=1');
    expect(res.text).toContain('background-color: #6366f1;');
  });

  test('a rejected new class is shown again with what was typed (it used to answer 500)', async () => {
    const admin = await loginAsAdmin();
    const res = await admin.post('/admin/classes').type('form').send({ ...CLASS_FORM, maxSpots: '0' });

    expect(res.status).toBe(200);
    expect(res.text).toContain('Maks. uczestników: wartość od 1 do 200.');
    expect(res.text).toContain('action="/admin/classes"');
    expect(res.text).toContain('value="Wspinaczka"');
    expect(res.text).toContain('value="2030-05-06T18:00"');
    expect(res.text).toContain('value="2030-05-06T19:30"');
  });

  test('a rejected edit keeps the class id and shows the typed values', async () => {
    const admin = await loginAsAdmin();
    await admin.post('/admin/classes').type('form').send({ ...CLASS_FORM, name: 'Do edycji' });
    const stored = ClassModel.getAll().find(c => c.name === 'Do edycji');

    const form = await admin.get(`/admin/classes/${stored.id}/edit`);
    expect(form.text).toContain('value="2030-05-06T18:00"');
    expect(form.text).toContain('value="2030-05-06T19:30"');

    const res = await admin.post(`/admin/classes/${stored.id}`).type('form')
      .send({ ...CLASS_FORM, name: 'Nowa nazwa', maxSpots: '500' });
    expect(res.status).toBe(200);
    expect(res.text).toContain(`action="/admin/classes/${stored.id}"`);
    expect(res.text).toContain('value="Nowa nazwa"');
    expect(res.text).toContain('value="500"');
    expect(ClassModel.getById(stored.id).name).toBe('Do edycji');
  });

  test('keeps a description of up to 1000 characters whole', async () => {
    const admin = await loginAsAdmin();
    const description = 'Opis zajęć. '.repeat(70).trim(); // 839 characters
    const res = await admin.post('/admin/classes').type('form').send({ ...CLASS_FORM, name: 'Długi opis', description });

    expect(res.status).toBe(302);
    const saved = ClassModel.getAll().find(c => c.name === 'Długi opis');
    expect(saved.description).toBe(description);
  });
});

describe('raising the limit of a class with a waiting list', () => {
  test('books the waiting people who now fit, in list order, at once', async () => {
    const admin = await loginAsAdmin();
    await admin.post('/admin/classes').type('form').send({ ...CLASS_FORM, name: 'Pełne', maxSpots: '1', waitingListEnabled: 'on' });
    const classId = ClassModel.getAll().find(c => c.name === 'Pełne').id;
    const [booked, first, second, third] = ['b', 'w1', 'w2', 'w3'].map(n =>
      UserModel.create(`${n}.limit@example.com`, n, 'Test').lastInsertRowid);
    BookingModel.book(booked, classId, [{ firstName: 'b', lastName: 'Test', ageCategory: 'adult', isMain: true, age: 30 }]);
    [first, second, third].forEach(id => WaitingListModel.add(id, classId));
    sendWaitingListPromotedEmail.mockClear();

    await admin.post(`/admin/classes/${classId}`).type('form')
      .send({ ...CLASS_FORM, name: 'Pełne', maxSpots: '3', waitingListEnabled: 'on' });

    expect(BookingModel.getSpotCounts(classId).adult_taken).toBe(3);
    expect(BookingModel.findByUserAndClass(first, classId)).toBeDefined();
    expect(BookingModel.findByUserAndClass(second, classId)).toBeDefined();
    expect(WaitingListModel.getByClass(classId).map(e => e.user_id)).toEqual([third]);
    expect(sendWaitingListPromotedEmail.mock.calls.map(c => c[0])).toEqual(['w1.limit@example.com', 'w2.limit@example.com']);
  });
});

describe('instructors in the class form', () => {
  const anna = () => UserModel.findByEmail('anna@example.com');

  test('offers the instructor accounts in a select', async () => {
    const admin = await loginAsAdmin();
    const form = await admin.get('/admin/classes/new');
    expect(form.text).toContain('<select name="instructorId"');
    expect(form.text).toContain(`<option value="${anna().id}"`);
    expect(form.text).not.toContain('list="instructors-list"');
  });

  test('a new class stores the chosen account and shows its first name', async () => {
    const admin = await loginAsAdmin();
    await admin.post('/admin/classes').type('form').send({ ...CLASS_FORM, name: 'Z Anną', instructorId: String(anna().id) });
    const saved = ClassModel.getAll().find(c => c.name === 'Z Anną');
    expect(saved.instructor_id).toBe(anna().id);
    expect(saved.instructor).toBe('Anna');
  });

  test('an id that is not an instructor account is refused', async () => {
    const admin = await loginAsAdmin();
    const adminId = UserModel.findByEmail('admin@example.com').id;
    const res = await admin.post('/admin/classes').type('form').send({ ...CLASS_FORM, name: 'Zły instruktor', instructorId: String(adminId) });
    expect(res.status).toBe(200);
    expect(res.text).toContain('Wybierz instruktora z listy.');
    expect(ClassModel.getAll().find(c => c.name === 'Zły instruktor')).toBeUndefined();
  });

  test('an old free-text instructor without an account can be kept, or replaced by an account', async () => {
    const admin = await loginAsAdmin();
    const id = ClassModel.create({
      name: 'Stara klasa', description: '', startTime: '2030-05-08T18:00', durationMin: 90,
      classType: 'adult_only', maxSpots: 10, instructor: 'Kasia z dawnych czasów'
    }).lastInsertRowid;

    const form = await admin.get(`/admin/classes/${id}/edit`);
    expect(form.text).toContain('<option value="legacy" selected>Kasia z dawnych czasów (bez konta instruktora)</option>');

    await admin.post(`/admin/classes/${id}`).type('form').send({ ...CLASS_FORM, name: 'Stara klasa', instructorId: 'legacy' });
    expect(ClassModel.getById(id)).toMatchObject({ instructor: 'Kasia z dawnych czasów', instructor_id: null });

    await admin.post(`/admin/classes/${id}`).type('form').send({ ...CLASS_FORM, name: 'Stara klasa', instructorId: String(anna().id) });
    expect(ClassModel.getById(id)).toMatchObject({ instructor: 'Anna', instructor_id: anna().id });
  });
});

describe('POST /admin/login', () => {
  beforeEach(() => sendMagicLink.mockClear());

  test('answers an unknown address exactly like an admin address, and sends nothing', async () => {
    const unknown = await request(app).post('/admin/login').type('form').send({ email: 'someone@example.com' });
    expect(sendMagicLink).not.toHaveBeenCalled();

    const known = await request(app).post('/admin/login').type('form').send({ email: 'admin@example.com' });
    expect(sendMagicLink).toHaveBeenCalledTimes(1);
    expect(sendMagicLink.mock.calls[0][0]).toBe('admin@example.com');

    expect(unknown.status).toBe(known.status);
    expect(unknown.text).toBe(known.text);
  });

  test('still rejects a malformed address', async () => {
    const res = await request(app).post('/admin/login').type('form').send({ email: 'not-an-address' });
    expect(res.text).toContain('Podaj prawidłowy adres e-mail.');
    expect(sendMagicLink).not.toHaveBeenCalled();
  });
});
