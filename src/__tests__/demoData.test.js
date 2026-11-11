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
