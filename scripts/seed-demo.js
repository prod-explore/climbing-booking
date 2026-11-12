/**
 * seed-demo.js — fills an empty local database with a week of sample classes, a few bookings and the venue
 * settings, so a fresh clone has something to show. Run: npm run seed (uses DB_PATH like the app).
 * It refuses to touch a database that already has classes, and never runs with NODE_ENV=production, except for a
 * demo instance (DEMO_MODE=true), where it adds the richer demo data (see src/services/demoData.js, which holds the
 * sample data and is shared with the demo instance's start-up and nightly reset).
 * Instructor accounts: anna, piotr and ola.instruktor@demo.test (log in at /login, the link is printed).
 */

'use strict';

require('dotenv').config();

const { initDatabase } = require('../src/models/database');
const { seedDemo, assertSeedAllowed } = require('../src/services/demoData');
const { isDemoMode } = require('../src/utils/demoMode');

if (require.main === module) {
  try {
    assertSeedAllowed();
  } catch (err) {
    console.error(`seed-demo: ${err.message}`);
    process.exit(1);
  }
  initDatabase();
  const extended = isDemoMode();
  const result = seedDemo({ extended });
  if (!result.created) {
    console.log(`seed-demo: nothing added (${result.reason}).`);
  } else if (extended) {
    console.log(`seed-demo: added ${result.created} sample classes with bookings, a waiting list and the venue settings. See /calendar`);
  } else {
    console.log(`seed-demo: added ${result.created} sample classes next week, 3 bookings and the venue settings. See /calendar?week=1`);
  }
}

module.exports = { seedDemo };
