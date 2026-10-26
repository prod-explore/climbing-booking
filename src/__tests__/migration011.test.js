/**
 * migration011.test.js — users.terms_accepted is added, set for the accounts that went through the profile form (they
 * have a birth date) and left unset for the rest, such as the administrator and instructor accounts.
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
  db.prepare("INSERT INTO users (email, first_name, last_name, birth_date) VALUES ('p@example.com', 'Ala', 'Nowak', '1990-01-01')").run();
  db.prepare("INSERT INTO users (email, first_name, last_name, is_verified) VALUES ('admin@example.com', 'Admin', 'Zajęcia', 1)").run();
  db.exec(sql('011_user_terms_accepted.sql'));
});

const accepted = email => db.prepare('SELECT terms_accepted FROM users WHERE email = ?').get(email).terms_accepted;

test('an account with a birth date has accepted the terms', () => {
  expect(accepted('p@example.com')).toBe(1);
});

test('an account given names without the profile form has not', () => {
  expect(accepted('admin@example.com')).toBe(0);
});
