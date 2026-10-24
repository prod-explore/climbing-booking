'use strict';

process.env.DB_PATH = ':memory:';
process.env.NODE_ENV = 'test';

const { initDatabase, getDb, SiteSettingsModel } = require('../models/database');
const { seedDemo } = require('../../scripts/seed-demo');

beforeAll(() => initDatabase());

test('fills an empty database with next week\'s sample classes, bookings and venue settings', () => {
  expect(seedDemo()).toEqual({ created: 5 });

  const classes = getDb().prepare('SELECT start_time FROM classes').all();
  expect(classes).toHaveLength(5);
  for (const c of classes) expect(new Date(c.start_time).getTime()).toBeGreaterThan(Date.now());
  expect(getDb().prepare('SELECT COUNT(*) AS n FROM bookings').get().n).toBe(3);
  expect(SiteSettingsModel.all().venue_name).toBe('Ścianka Przykładowa');
});

test('leaves a database that already has classes alone', () => {
  expect(seedDemo()).toEqual({ created: 0, reason: 'the database already has classes' });
  expect(getDb().prepare('SELECT COUNT(*) AS n FROM classes').get().n).toBe(5);
});
