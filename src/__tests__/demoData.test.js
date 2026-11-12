/**
 * demoData.test.js — the guards and the reset of the demo instance (services/demoData.js, utils/demoMode.js), on an
 * in-memory database and without the app. Demo mode is passed in as `env`, so the process itself is never in it.
 */

'use strict';

process.env.DB_PATH = ':memory:';
process.env.NODE_ENV = 'test';
delete process.env.DEMO_MODE;

const { initDatabase, getDb } = require('../models/database');
const { seedDemo, resetDemoData, startNightlyReset, msUntilNextReset, assertSeedAllowed, RESET_HOUR } = require('../services/demoData');
const { isDemoMode, DEMO_ACCOUNTS } = require('../utils/demoMode');

const DEMO = { DEMO_MODE: 'true', NODE_ENV: 'production' };
const count = table => getDb().prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;

beforeAll(() => {
  initDatabase();
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

describe('DEMO_MODE', () => {
  test.each([[undefined, false], ['', false], ['false', false], ['FALSE', false], ['true', true], [' True ', true]])(
    '%p is %p',
    (value, expected) => expect(isDemoMode({ DEMO_MODE: value })).toBe(expected)
  );

  test.each(['1', 'yes', 'on', 'ture'])('%p stops the start instead of being guessed', (value) => {
    expect(() => isDemoMode({ DEMO_MODE: value })).toThrow(/DEMO_MODE must be "true" or "false"/);
  });
});

describe('seeding with NODE_ENV=production', () => {
  test('is refused on a real instance', () => {
    expect(() => assertSeedAllowed({ NODE_ENV: 'production' })).toThrow(/Refusing to seed/);
    expect(() => seedDemo({ env: { NODE_ENV: 'production' } })).toThrow(/Refusing to seed/);
    expect(count('classes')).toBe(0);
  });

  test('is allowed on a demo instance', () => {
    expect(() => assertSeedAllowed(DEMO)).not.toThrow();
  });
});

describe('resetDemoData', () => {
  test('is refused when demo mode is off, and touches nothing', () => {
    getDb().prepare("INSERT INTO users (email) VALUES ('real.person@example.com')").run();

    expect(() => resetDemoData({ env: {} })).toThrow(/DEMO_MODE is not on/);
    expect(() => resetDemoData({ env: { DEMO_MODE: 'false', NODE_ENV: 'production' } })).toThrow(/DEMO_MODE is not on/);
    expect(getDb().prepare("SELECT COUNT(*) AS n FROM users WHERE email = 'real.person@example.com'").get().n).toBe(1);
  });

  test('returns a changed database to the sample data and keeps the migrations record', () => {
    const migrations = count('schema_migrations');

    resetDemoData({ env: DEMO });
    const seeded = { users: count('users'), classes: count('classes'), bookings: count('bookings'), waiting: count('waiting_list') };
    expect(seeded.classes).toBeGreaterThan(0);
    expect(seeded.waiting).toBeGreaterThan(0);
    for (const email of Object.values(DEMO_ACCOUNTS)) {
      expect(getDb().prepare('SELECT COUNT(*) AS n FROM users WHERE email = ?').get(email).n).toBe(1);
    }

    // What a visitor might do: cancel everything, delete the classes, add an account.
    getDb().prepare('DELETE FROM waiting_list').run();
    getDb().prepare('DELETE FROM bookings').run();
    getDb().prepare('DELETE FROM classes').run();
    getDb().prepare("INSERT INTO users (email) VALUES ('visitor@example.com')").run();

    resetDemoData({ env: DEMO });
    expect({ users: count('users'), classes: count('classes'), bookings: count('bookings'), waiting: count('waiting_list') })
      .toEqual(seeded);
    expect(getDb().prepare("SELECT COUNT(*) AS n FROM users WHERE email = 'visitor@example.com'").get().n).toBe(0);
    expect(count('schema_migrations')).toBe(migrations);
    expect(getDb().pragma('foreign_key_check')).toEqual([]);
  });
});

describe('the nightly reset', () => {
  test('is refused when demo mode is off', () => {
    expect(() => startNightlyReset({ env: {} })).toThrow(/DEMO_MODE is not on/);
  });

  test('waits until the next reset hour, today or tomorrow', () => {
    const before = new Date(2026, 0, 10, RESET_HOUR - 1, 30);
    const after = new Date(2026, 0, 10, RESET_HOUR, 0, 1);

    expect(msUntilNextReset(before)).toBe(30 * 60 * 1000);
    expect(msUntilNextReset(after)).toBe(24 * 60 * 60 * 1000 - 1000);
  });

  test('resets at that hour, arms itself again, and stops when told to', () => {
    jest.useFakeTimers({ now: new Date(2026, 0, 10, RESET_HOUR - 1, 0) });
    try {
      const reset = startNightlyReset({ env: DEMO });
      getDb().prepare("INSERT INTO users (email) VALUES ('night.visitor@example.com')").run();
      const visitors = () => getDb().prepare("SELECT COUNT(*) AS n FROM users WHERE email = 'night.visitor@example.com'").get().n;

      jest.advanceTimersByTime(59 * 60 * 1000);
      expect(visitors()).toBe(1);
      jest.advanceTimersByTime(60 * 1000);
      expect(visitors()).toBe(0);
      expect(jest.getTimerCount()).toBe(1);

      reset.stop();
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('the demo calendar', () => {
  const NOWS = [new Date(2026, 10, 12, 12, 0), new Date(2026, 10, 9, 7, 30), new Date(2026, 10, 15, 23, 45)];
  const classRows = () => getDb().prepare(`
    SELECT c.*,
      (SELECT COUNT(*) FROM participants p JOIN bookings b ON p.booking_id = b.id WHERE b.class_id = c.id AND p.age_category = 'adult') AS adults,
      (SELECT COUNT(*) FROM waiting_list w WHERE w.class_id = c.id) AS waiting
    FROM classes c ORDER BY c.start_time`).all();
  const demoId = () => getDb().prepare('SELECT id FROM users WHERE email = ?').get(DEMO_ACCOUNTS.participant).id;

  test.each(NOWS.map(now => [now.toString(), now]))('is filled relative to today, and the reset repeats it (%s)', (_label, now) => {
    jest.useFakeTimers({ now });
    try {
      resetDemoData({ env: DEMO });
      const first = { classes: count('classes'), bookings: count('bookings'), participants: count('participants'), waiting: count('waiting_list'), users: count('users') };
      resetDemoData({ env: DEMO });
      expect({ classes: count('classes'), bookings: count('bookings'), participants: count('participants'), waiting: count('waiting_list'), users: count('users') }).toEqual(first);
      expect(getDb().pragma('foreign_key_check')).toEqual([]);

      const upcoming = classRows().filter(c => new Date(c.start_time) > now && !c.is_archived);
      expect(upcoming.length).toBeGreaterThanOrEqual(20);

      // Both coming weeks are full of classes, on every day of the next one.
      const nextMonday = new Date(now);
      nextMonday.setDate(now.getDate() - ((now.getDay() + 6) % 7) + 7);
      nextMonday.setHours(0, 0, 0, 0);
      const nextWeek = upcoming.filter(c => new Date(c.start_time) >= nextMonday && new Date(c.start_time) < new Date(nextMonday.getTime() + 7 * 86400000 + 3600000));
      expect(nextWeek.length).toBeGreaterThanOrEqual(20);
      expect(new Set(nextWeek.map(c => new Date(c.start_time).getDay())).size).toBe(7);
      expect(new Set(nextWeek.map(c => c.instructor)).size).toBeGreaterThanOrEqual(4);

      // Realistic fill levels: some empty, some nearly full, one full with people waiting.
      expect(nextWeek.some(c => c.adults === 0)).toBe(true);
      expect(nextWeek.some(c => c.adults >= 0.8 * c.max_spots && c.adults < c.max_spots)).toBe(true);
      expect(nextWeek.some(c => c.adults === c.max_spots && c.waiting > 0)).toBe(true);
      expect(nextWeek.some(c => c.adults > 0 && c.adults <= 0.4 * c.max_spots)).toBe(true);
      for (const c of upcoming) expect(c.adults).toBeLessThanOrEqual(c.max_spots);

      // The participant has upcoming bookings, past ones and a place on a waiting list.
      const bookings = getDb().prepare('SELECT c.start_time FROM bookings b JOIN classes c ON c.id = b.class_id WHERE b.user_id = ?').all(demoId());
      expect(bookings.filter(b => new Date(b.start_time) > now).length).toBeGreaterThanOrEqual(3);
      expect(bookings.filter(b => new Date(b.start_time) < now).length).toBeGreaterThanOrEqual(3);
      expect(getDb().prepare('SELECT COUNT(*) AS n FROM waiting_list WHERE user_id = ?').get(demoId()).n).toBeGreaterThanOrEqual(1);

      // The weeks behind are in the archive.
      expect(classRows().some(c => c.is_archived && new Date(c.start_time) < now)).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  test('uses only fictitious addresses on a reserved domain and no real-looking data', () => {
    resetDemoData({ env: DEMO });

    for (const { email } of getDb().prepare('SELECT email FROM users').all()) expect(email).toMatch(/@demo\.test$/);
    const text = JSON.stringify([
      getDb().prepare('SELECT first_name, last_name, email FROM users').all(),
      getDb().prepare('SELECT first_name, last_name FROM participants').all(),
      getDb().prepare('SELECT name, description, instructor, child_instructor FROM classes').all()
    ]);
    expect(text).not.toMatch(/example|kajdan|futumore|gmail|wp\.pl/i);
    expect(Object.values(DEMO_ACCOUNTS).every(email => email.endsWith('@demo.test'))).toBe(true);
  });

  test('has a demo instructor who teaches classes and an administrator account', () => {
    resetDemoData({ env: DEMO });

    const instructor = getDb().prepare('SELECT * FROM users WHERE email = ?').get(DEMO_ACCOUNTS.instructor);
    expect(instructor.is_instructor).toBe(1);
    expect(getDb().prepare('SELECT COUNT(*) AS n FROM classes WHERE instructor_id = ?').get(instructor.id).n).toBeGreaterThanOrEqual(10);
    expect(getDb().prepare('SELECT COUNT(*) AS n FROM users WHERE email = ?').get(DEMO_ACCOUNTS.admin).n).toBe(1);
    expect(getDb().prepare('SELECT COUNT(*) AS n FROM users WHERE is_instructor = 1').get().n).toBe(5);
  });

  test('npm run seed (no demo mode) still adds only the five classes of next week', () => {
    resetDemoData({ env: DEMO });
    getDb().prepare('DELETE FROM classes').run();

    expect(seedDemo({ env: {} })).toEqual({ created: 5 });
    expect(count('classes')).toBe(5);
    expect(count('waiting_list')).toBe(0);
  });
});
