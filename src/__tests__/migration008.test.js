/**
 * migration008.test.js — linking existing classes to instructor accounts happens only where the old free-text
 * instructor names exactly one account.
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
  fs.readdirSync(DIR).filter(f => /^00[1-7]_.*\.sql$/.test(f)).sort().forEach(f => db.exec(sql(f)));

  const addInstructor = (email, first) =>
    db.prepare("INSERT INTO users (email, first_name, last_name, is_instructor) VALUES (?, ?, 'Instruktor', 1)").run(email, first).lastInsertRowid;
  addInstructor('jan@example.com', 'Jan');
  addInstructor('janina@example.com', 'Janina');
  addInstructor('anna1@example.com', 'Anna');
  addInstructor('anna2@example.com', 'Anna');
  db.prepare("INSERT INTO users (email, first_name) VALUES ('piotr@example.com', 'Piotr')").run(); // not an instructor

  const addClass = (name, instructor, childInstructor = '') =>
    db.prepare("INSERT INTO classes (name, start_time, max_spots, instructor, child_instructor) VALUES (?, '2030-01-01 10:00', 10, ?, ?)")
      .run(name, instructor, childInstructor);
  addClass('exact', 'Jan');
  addClass('case and spaces', '  janina ');
  addClass('two accounts', 'Anna');
  addClass('substring only', 'Jan K.');
  addClass('not an instructor', 'Piotr');
  addClass('children', 'Jan', 'Janina');
  addClass('empty', '');

  db.exec(sql('008_class_instructor_ids.sql'));
});

const linked = name => db.prepare(`
  SELECT (SELECT email FROM users WHERE id = c.instructor_id) AS main,
         (SELECT email FROM users WHERE id = c.child_instructor_id) AS child
  FROM classes c WHERE c.name = ?`).get(name);

test('links an exact first-name match, ignoring case and surrounding spaces', () => {
  expect(linked('exact').main).toBe('jan@example.com');
  expect(linked('case and spaces').main).toBe('janina@example.com');
});

test('links the children\'s instructor the same way', () => {
  expect(linked('children')).toEqual({ main: 'jan@example.com', child: 'janina@example.com' });
});

test('leaves ambiguous, partial and non-instructor names unlinked, and keeps their text', () => {
  expect(linked('two accounts').main).toBeNull();
  expect(linked('substring only').main).toBeNull();
  expect(linked('not an instructor').main).toBeNull();
  expect(linked('empty').main).toBeNull();
  expect(db.prepare("SELECT instructor FROM classes WHERE name = 'two accounts'").get().instructor).toBe('Anna');
});
