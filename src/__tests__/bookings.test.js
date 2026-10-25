/**
 * bookings.test.js — the migration runner and the schema's booking rules (separate pools, one booking per user and
 * class, cascading deletes), with plain SQL on a fresh in-memory database per test. The models' own capacity logic is
 * tested in capacity.test.js.
 */

'use strict';

const Database = require('better-sqlite3');

process.env.DB_PATH = ':memory:';

const { runMigrations } = require('../migrations/runner');

function createTestDb() {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

/** Minimal SQL helpers on the given database, independent of src/models. */
function makeModels(db) {
  const createUser = (email) =>
    db.prepare('INSERT INTO users (email) VALUES (?)').run(email);

  const createClass = ({ name, startTime, maxSpots, maxChildSpots = 0, classType = 'adult_only' }) =>
    db.prepare(
      'INSERT INTO classes (name, start_time, max_spots, max_child_spots, class_type) VALUES (?,?,?,?,?)'
    ).run(name, startTime, maxSpots, maxChildSpots, classType);

  const countAdults = (classId) =>
    db.prepare(`
      SELECT COUNT(*) as cnt FROM participants p
      JOIN bookings b ON p.booking_id = b.id
      WHERE b.class_id = ? AND p.age_category = 'adult'
    `).get(classId).cnt;

  const countChildren = (classId) =>
    db.prepare(`
      SELECT COUNT(*) as cnt FROM participants p
      JOIN bookings b ON p.booking_id = b.id
      WHERE b.class_id = ? AND p.age_category = 'child'
    `).get(classId).cnt;

  const bookWithParticipants = (userId, classId, participants) => {
    return db.transaction(() => {
      const booking = db.prepare(
        'INSERT INTO bookings (class_id, user_id) VALUES (?, ?)'
      ).run(classId, userId);

      const bookingId = booking.lastInsertRowid;

      const insertP = db.prepare(
        'INSERT INTO participants (booking_id, first_name, last_name, age_category, is_main) VALUES (?,?,?,?,?)'
      );
      for (const p of participants) {
        insertP.run(bookingId, p.firstName, p.lastName, p.ageCategory || 'adult', p.isMain ? 1 : 0);
      }
      return bookingId;
    })();
  };

  return { createUser, createClass, countAdults, countChildren, bookWithParticipants };
}

describe('Migration runner', () => {
  test('creates the schema_migrations table', () => {
    const db = createTestDb();
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get();
    expect(row).toBeDefined();
  });

  test('records the migration files it applied', () => {
    const db = createTestDb();
    const applied = db.prepare('SELECT filename FROM schema_migrations ORDER BY filename').all();
    expect(applied.length).toBeGreaterThanOrEqual(5);
    expect(applied[0].filename).toBe('001_init_schema.sql');
  });

  test('a second run records no migration twice', () => {
    const db = createTestDb();
    runMigrations(db);
    const count = db.prepare('SELECT COUNT(*) as cnt FROM schema_migrations').get().cnt;
    const applied = db.prepare('SELECT filename FROM schema_migrations').all();
    const unique = new Set(applied.map(r => r.filename)).size;
    expect(unique).toBe(count);
  });
});

describe('bookings in the schema', () => {
  let db, m;

  beforeEach(() => {
    db = createTestDb();
    m = makeModels(db);
  });

  test('stores a booking with its participants', () => {
    const userId = m.createUser('test@example.com').lastInsertRowid;
    const classId = m.createClass({ name: 'Wspinaczka', startTime: '2027-01-01 10:00:00', maxSpots: 10 }).lastInsertRowid;

    const bookingId = m.bookWithParticipants(userId, classId, [
      { firstName: 'Jan', lastName: 'Kowalski', isMain: true }
    ]);

    expect(bookingId).toBeGreaterThan(0);

    const participants = db.prepare('SELECT * FROM participants WHERE booking_id = ?').all(bookingId);
    expect(participants).toHaveLength(1);
    expect(participants[0].first_name).toBe('Jan');
  });

  test('counts adults and children separately', () => {
    const userId = m.createUser('rodzic@example.com').lastInsertRowid;
    const classId = m.createClass({
      name: 'Rodzinne', startTime: '2027-01-01 10:00:00',
      maxSpots: 10, maxChildSpots: 5, classType: 'adult_and_child'
    }).lastInsertRowid;

    m.bookWithParticipants(userId, classId, [
      { firstName: 'Anna', lastName: 'Nowak', ageCategory: 'adult', isMain: true },
      { firstName: 'Kacper', lastName: 'Nowak', ageCategory: 'child', isMain: false }
    ]);

    expect(m.countAdults(classId)).toBe(1);
    expect(m.countChildren(classId)).toBe(1);
  });

  test('refuses a second booking of the same class by the same user (UNIQUE)', () => {
    const userId = m.createUser('dup@example.com').lastInsertRowid;
    const classId = m.createClass({ name: 'Yoga', startTime: '2027-02-01 09:00:00', maxSpots: 5 }).lastInsertRowid;

    m.bookWithParticipants(userId, classId, [
      { firstName: 'X', lastName: 'Y', isMain: true }
    ]);

    expect(() => {
      m.bookWithParticipants(userId, classId, [
        { firstName: 'X', lastName: 'Y', isMain: true }
      ]);
    }).toThrow();
  });

  test('deleting a booking deletes its participants', () => {
    const userId = m.createUser('del@example.com').lastInsertRowid;
    const classId = m.createClass({ name: 'Bouldering', startTime: '2027-03-01 12:00:00', maxSpots: 8 }).lastInsertRowid;

    const bookingId = m.bookWithParticipants(userId, classId, [
      { firstName: 'A', lastName: 'B', isMain: true }
    ]);

    db.prepare('DELETE FROM bookings WHERE id = ?').run(bookingId);

    const remaining = db.prepare('SELECT * FROM participants WHERE booking_id = ?').all(bookingId);
    expect(remaining).toHaveLength(0);
  });
});
