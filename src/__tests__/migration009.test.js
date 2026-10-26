/**
 * migration009.test.js — participants.child_age is dropped and every stored age survives in participants.age.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DIR = path.join(__dirname, '../migrations');
const sql = file => fs.readFileSync(path.join(DIR, file), 'utf8');

let db;

beforeAll(() => {
  db = new Database(':memory:');
  fs.readdirSync(DIR).filter(f => /^00[1-8]_.*\.sql$/.test(f)).sort().forEach(f => db.exec(sql(f)));

  const userId = db.prepare("INSERT INTO users (email) VALUES ('a@example.com')").run().lastInsertRowid;
  const classId = db.prepare("INSERT INTO classes (name, start_time, max_spots) VALUES ('c', '2030-01-01T10:00', 10)").run().lastInsertRowid;
  const bookingId = db.prepare('INSERT INTO bookings (class_id, user_id) VALUES (?, ?)').run(classId, userId).lastInsertRowid;
  const add = (name, age, childAge) =>
    db.prepare("INSERT INTO participants (booking_id, first_name, last_name, age, child_age) VALUES (?, ?, 'X', ?, ?)")
      .run(bookingId, name, age, childAge);
  add('both', 9, 9);
  add('child_age only', null, 7);
  add('age only', 30, null);
  add('neither', null, null);

  db.exec(sql('009_drop_participant_child_age.sql'));
});

const ageOf = name => db.prepare('SELECT age FROM participants WHERE first_name = ?').get(name).age;

test('drops the child_age column', () => {
  const columns = db.prepare('PRAGMA table_info(participants)').all().map(c => c.name);
  expect(columns).not.toContain('child_age');
  expect(columns).toContain('age');
});

test('keeps every age, copying child_age where age was empty', () => {
  expect(ageOf('both')).toBe(9);
  expect(ageOf('child_age only')).toBe(7);
  expect(ageOf('age only')).toBe(30);
  expect(ageOf('neither')).toBeNull();
  expect(db.prepare('SELECT COUNT(*) AS n FROM participants').get().n).toBe(4);
});
