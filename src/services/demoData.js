/**
 * demoData.js — the sample data of `npm run seed` and of the demo instance (DEMO_MODE=true), and the reset that
 * returns a demo database to it.
 *
 * `seedDemo()` is what `npm run seed` runs: five classes next week, three instructors, three bookings and the venue
 * details. `seedDemo({ extended: true })` is the demo instance's data: the same classes in the current week (the ones
 * that have not started yet) as well as next week, a class that is full with a waiting list, more bookings, a pending
 * parental consent, and the three fixed accounts a visitor enters as (utils/demoMode.js), each with a complete profile.
 *
 * Nothing here runs unless it is called: the app calls `resetDemoData()` at start-up and `startNightlyReset()` only
 * in demo mode, and both refuse to run otherwise.
 */

'use strict';

const { getDb, ClassModel, UserModel, BookingModel, WaitingListModel, SiteSettingsModel } = require('../models/database');
const { adminEmails } = require('../utils/accounts');
const { DEMO_ACCOUNTS, isDemoMode } = require('../utils/demoMode');

/** The local hour at which a demo instance restores the sample data. */
const RESET_HOUR = 3;

const SAMPLE_CLASSES = [
  { day: 0, time: '17:00', minutes: 90, name: 'Wspinaczka dla początkujących', type: 'adult_only', spots: 12, color: '#2d5a3d', instructor: 'Anna' },
  { day: 1, time: '18:00', minutes: 90, name: 'Technika na przewieszeniu', type: 'adult_only', spots: 8, color: '#6366f1', instructor: 'Piotr' },
  { day: 2, time: '16:00', minutes: 120, name: 'Zajęcia rodzinne', type: 'adult_and_child', spots: 10, child: 8, color: '#f59e0b', instructor: 'Anna', childInstructor: 'Ola' },
  { day: 3, time: '17:30', minutes: 90, name: 'Bouldering', type: 'adult_only', spots: 15, color: '#0ea5e9', instructor: 'Piotr' },
  { day: 5, time: '16:00', minutes: 120, name: 'Sobota na ściance', type: 'adult_and_child', spots: 12, child: 10, color: '#ec4899', instructor: 'Anna', childInstructor: 'Ola' }
];

// A class with four places that the demo bookings fill, so that the waiting list has something to show.
const FULL_CLASS = { day: 4, time: '18:00', minutes: 90, name: 'Trening techniki (komplet)', type: 'adult_only', spots: 4, color: '#8b5cf6', instructor: 'Piotr' };

const SAMPLE_INSTRUCTORS = [
  ['anna.instruktor@example.com', 'Anna'],
  ['piotr.instruktor@example.com', 'Piotr'],
  ['ola.instruktor@example.com', 'Ola']
];

// In the demo, the instructor a visitor enters as is Anna, who teaches most of the classes.
const DEMO_INSTRUCTOR = 'Anna';

const SAMPLE_PEOPLE = [
  ['ewa.demo@example.com', 'Ewa', 'Nowak'],
  ['tomasz.demo@example.com', 'Tomasz', 'Wiśniewski'],
  ['kasia.demo@example.com', 'Kasia', 'Zielińska']
];

const adult = (firstName, lastName, age = 30) => ({ firstName, lastName, ageCategory: 'adult', isMain: false, age });
const child = (firstName, lastName, age) => ({ firstName, lastName, ageCategory: 'child', isMain: false, age });

// Who books which class: `who` is the key of a person (ewa, tomasz, kasia from SAMPLE_PEOPLE in order, or demo),
// `with` the people booked together with them. Every class of that name gets the booking.
const BASE_BOOKINGS = [
  { cls: 'Wspinaczka dla początkujących', who: 'ewa' },
  { cls: 'Technika na przewieszeniu', who: 'tomasz' },
  { cls: 'Zajęcia rodzinne', who: 'kasia' }
];

const DEMO_BOOKINGS = [
  { cls: 'Wspinaczka dla początkujących', who: 'tomasz', with: [adult('Marta', 'Wiśniewska', 31)] },
  { cls: 'Technika na przewieszeniu', who: 'kasia' },
  { cls: 'Zajęcia rodzinne', who: 'demo', with: [child('Staś', 'Demo', 8)] },
  { cls: 'Bouldering', who: 'ewa', with: [adult('Piotr', 'Nowak', 34)] },
  { cls: 'Sobota na ściance', who: 'kasia', with: [child('Zosia', 'Zielińska', 7)] },
  { cls: FULL_CLASS.name, who: 'ewa', with: [adult('Anna', 'Nowak', 33)] },
  { cls: FULL_CLASS.name, who: 'tomasz', with: [adult('Jan', 'Wiśniewski', 36)] }
];

// Waiting for the full class, in this order.
const DEMO_WAITING_LIST = ['demo', 'kasia'];

/** Local "YYYY-MM-DDTHH:mm" for the given day of the week `weekOffset` weeks from now (0 = Monday), as the admin form stores it. */
function classStart(weekOffset, day, time) {
  const date = new Date();
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7) + weekOffset * 7 + day);
  const [h, m] = time.split(':').map(Number);
  date.setHours(h, m, 0, 0);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

/** A birth date that makes the person 16 years and a month old, as YYYY-MM-DD. */
function birthDateAged16() {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 16);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Throws unless the sample data may be written: with NODE_ENV=production only a demo instance may. */
function assertSeedAllowed(env = process.env) {
  if (env.NODE_ENV === 'production' && !isDemoMode(env)) {
    throw new Error('Refusing to seed sample data with NODE_ENV=production (only a demo instance, DEMO_MODE=true, may).');
  }
}

/** Throws unless demo mode is on: whatever wipes the database must never be reachable on a real instance. */
function assertDemoMode(action, env = process.env) {
  if (!isDemoMode(env)) throw new Error(`Refusing to ${action}: DEMO_MODE is not on.`);
}

/** A verified account with a complete profile (names, birth date, accepted terms), so that no profile form interrupts. */
function completeAccount(email, firstName, lastName, birthDate) {
  const { user } = UserModel.getOrCreate(email);
  UserModel.updateProfile(user.id, firstName, lastName, birthDate, false);
  return user.id;
}

/**
 * Fills an empty database with the sample data described at the top of this file. Returns `{ created }`, the number
 * of classes added, or `{ created: 0, reason }` when the database already has classes. Runs in one transaction.
 * @param {{ extended?: boolean, env?: object }} [options]
 */
function seedDemo({ extended = false, env = process.env } = {}) {
  assertSeedAllowed(env);

  if (getDb().prepare('SELECT COUNT(*) AS n FROM classes').get().n > 0) {
    return { created: 0, reason: 'the database already has classes' };
  }

  return getDb().transaction(() => {
    // Instructor accounts, as /admin/instructors would create them; classes are linked to them by id.
    const instructorIds = {};
    for (const [sampleEmail, firstName] of SAMPLE_INSTRUCTORS) {
      const email = extended && firstName === DEMO_INSTRUCTOR ? DEMO_ACCOUNTS.instructor : sampleEmail;
      const { user } = UserModel.getOrCreate(email);
      getDb().prepare("UPDATE users SET first_name = ?, last_name = 'Instruktor', is_instructor = 1, is_verified = 1 WHERE id = ?")
        .run(firstName, user.id);
      if (extended) UserModel.updateProfile(user.id, firstName, 'Instruktor', '1990-01-01', false);
      instructorIds[firstName] = user.id;
    }

    // The week offsets of the classes: next week; in the demo also the current one, where only classes that have not
    // started yet are of any use (the calendars list upcoming classes only).
    const specs = extended ? [...SAMPLE_CLASSES, FULL_CLASS] : SAMPLE_CLASSES;
    const classIdsByName = new Map();
    let created = 0;
    for (const weekOffset of extended ? [0, 1] : [1]) {
      for (const c of specs) {
        const startTime = classStart(weekOffset, c.day, c.time);
        if (new Date(startTime) <= new Date()) continue;

        const id = ClassModel.create({
          name: c.name,
          description: 'Przykładowe zajęcia (dane demonstracyjne).',
          startTime,
          durationMin: c.minutes,
          classType: c.type,
          maxSpots: c.spots,
          maxChildSpots: c.child || 0,
          instructor: c.instructor,
          childInstructor: c.childInstructor || '',
          instructorId: instructorIds[c.instructor],
          childInstructorId: c.childInstructor ? instructorIds[c.childInstructor] : null,
          category: c.type === 'adult_and_child' ? 'mixed' : 'adults',
          color: c.color,
          waitingListEnabled: true,
          maxWaitingSpots: 15
        }).lastInsertRowid;
        classIdsByName.set(c.name, [...(classIdsByName.get(c.name) || []), id]);
        created++;
      }
    }

    const people = {};
    SAMPLE_PEOPLE.forEach(([email, first, last]) => {
      const { user } = UserModel.getOrCreate(email);
      UserModel.updateProfile(user.id, first, last, '1995-04-12', false);
      people[first.toLowerCase()] = { id: user.id, firstName: first, lastName: last };
    });
    if (extended) {
      people.demo = { id: completeAccount(DEMO_ACCOUNTS.participant, 'Demo', 'Uczestnik', '1992-06-15'), firstName: 'Demo', lastName: 'Uczestnik' };
    }

    for (const booking of extended ? [...BASE_BOOKINGS, ...DEMO_BOOKINGS] : BASE_BOOKINGS) {
      const who = people[booking.who];
      const main = { firstName: who.firstName, lastName: who.lastName, ageCategory: 'adult', isMain: true, age: 30 };
      for (const classId of classIdsByName.get(booking.cls) || []) {
        BookingModel.book(who.id, classId, [main, ...(booking.with || [])]);
      }
    }

    if (extended) {
      for (const classId of classIdsByName.get(FULL_CLASS.name) || []) {
        DEMO_WAITING_LIST.forEach(key => WaitingListModel.add(people[key].id, classId));
      }

      // A 16-year-old whose parental consent waits for an administrator (/admin/consents).
      const minorId = completeAccount('julia.demo@example.com', 'Julia', 'Kowalczyk', birthDateAged16());
      UserModel.requestConsent(minorId);

      completeAccount(DEMO_ACCOUNTS.admin, 'Demo', 'Administrator', '1988-03-02');
      UserModel.syncAdminFlags(adminEmails(env));
    }

    SiteSettingsModel.saveAll({
      org_name: 'Przykładowa Szkoła Wspinania',
      org_seat: 'Katowice',
      org_nip: '',
      venue_name: 'Ścianka Przykładowa',
      venue_street: 'ul. Przykładowa 1',
      venue_city: 'Katowice'
    });

    return { created };
  })();
}

/**
 * Returns a demo database to the sample data: empties every table except the migrations record, then seeds it again,
 * all in one transaction, so a failure leaves the data as it was. Foreign keys stay on; their checks wait for the
 * commit, so the order of the deletes does not matter. Throws when demo mode is off.
 */
function resetDemoData({ env = process.env } = {}) {
  assertDemoMode('reset the database', env);

  const db = getDb();
  db.transaction(() => {
    db.pragma('defer_foreign_keys = ON');
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'schema_migrations'"
    ).all();
    for (const { name } of tables) db.prepare(`DELETE FROM "${name}"`).run();
    // Row ids start from 1 again, as in a fresh database; schema_migrations keeps its own.
    db.prepare("DELETE FROM sqlite_sequence WHERE name <> 'schema_migrations'").run();
    seedDemo({ extended: true, env });
  })();
  console.log('[demo] database reset to the sample data.');
}

/** Milliseconds from `now` to the next RESET_HOUR:00 in local time. */
function msUntilNextReset(now = new Date()) {
  const next = new Date(now);
  next.setHours(RESET_HOUR, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next - now;
}

/**
 * Resets the demo database every night at RESET_HOUR (local time). The timer is re-armed after each run, so the hour
 * holds across daylight saving changes, and it is unref'ed: it never keeps the process alive. Returns `{ stop }`.
 * Throws when demo mode is off.
 */
function startNightlyReset({ env = process.env } = {}) {
  assertDemoMode('schedule the nightly reset', env);

  let timer;
  const arm = () => {
    timer = setTimeout(() => {
      try {
        resetDemoData({ env });
      } catch (err) {
        console.error('Błąd resetu danych demonstracyjnych:', err);
      }
      arm();
    }, msUntilNextReset());
    timer.unref();
  };
  arm();

  return { stop: () => clearTimeout(timer) };
}

module.exports = { seedDemo, resetDemoData, startNightlyReset, msUntilNextReset, assertSeedAllowed, RESET_HOUR };
