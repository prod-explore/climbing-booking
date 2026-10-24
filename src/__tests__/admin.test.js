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
const { UserModel, MagicTokenModel, ClassModel } = require('../models/database');
const { sendMagicLink } = require('../services/emailService');

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
});
