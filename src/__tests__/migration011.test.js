/**
 * migration011.test.js — users.terms_accepted_at is added. Accounts that went through the profile form (they have a
 * birth date) get their creation time as an approximate acceptance time; the rest, such as the administrator and
 * instructor accounts, stay NULL.
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
  fs.readdirSync(DIR).filter(f => /^(00\d|010)_.*\.sql$/.test(f)).sort().forEach(f => db.exec(sql(f)));
  db.prepare(`INSERT INTO users (email, first_name, last_name, birth_date, created_at)
    VALUES ('p@example.com', 'Ala', 'Nowak', '1990-01-01', '2025-03-04 05:06:07')`).run();
  db.prepare("INSERT INTO users (email, first_name, last_name, is_verified) VALUES ('admin@example.com', 'Admin', 'Zajęcia', 1)").run();
  db.exec(sql('011_user_terms_accepted.sql'));
});

const acceptedAt = email => db.prepare('SELECT terms_accepted_at FROM users WHERE email = ?').get(email).terms_accepted_at;

test('an account with a birth date gets its creation time, as UTC ISO text', () => {
  expect(acceptedAt('p@example.com')).toBe('2025-03-04T05:06:07.000Z');
  expect(new Date(acceptedAt('p@example.com')).toISOString()).toBe(acceptedAt('p@example.com'));
});

test('an account given names without the profile form has no acceptance', () => {
  expect(acceptedAt('admin@example.com')).toBeNull();
});
