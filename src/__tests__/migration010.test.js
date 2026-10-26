/**
 * migration010.test.js — users.age_category is dropped; the accounts and the participants' own category stay.
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
  fs.readdirSync(DIR).filter(f => /^00\d_.*\.sql$/.test(f)).sort().forEach(f => db.exec(sql(f)));
  db.prepare("INSERT INTO users (email, first_name, last_name, age_category, is_verified) VALUES ('a@example.com', 'Ala', 'Nowak', 'child', 1)").run();
  db.exec(sql('010_drop_user_age_category.sql'));
});

test('drops users.age_category and keeps the accounts', () => {
  expect(db.prepare('PRAGMA table_info(users)').all().map(c => c.name)).not.toContain('age_category');
  expect(db.prepare("SELECT first_name, last_name, is_verified FROM users WHERE email = 'a@example.com'").get())
    .toEqual({ first_name: 'Ala', last_name: 'Nowak', is_verified: 1 });
});

test('leaves participants.age_category in place', () => {
  expect(db.prepare('PRAGMA table_info(participants)').all().map(c => c.name)).toContain('age_category');
});
