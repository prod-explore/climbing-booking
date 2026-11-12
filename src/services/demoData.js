/**
 * demoData.js — the sample data of `npm run seed` and of the demo instance (DEMO_MODE=true), and the reset that
 * returns a demo database to it.
 *
 * `seedDemo()` is what `npm run seed` runs: five classes next week, three instructors, three bookings and the venue
 * details. `seedDemo({ extended: true })` is the demo instance's data, built from services/demoSchedule.js relative to
 * today: a full timetable for the current and the next week (and two weeks of history), five instructors, about
 * forty fictitious participants who fill the classes to different degrees (some empty, some nearly full, some full
 * with a waiting list), the three fixed accounts a visitor enters as (utils/demoMode.js) with upcoming and past
 * bookings for the participant, and a pending parental consent.
 *
 * Nothing here runs unless it is called: the app calls `resetDemoData()` at start-up and `startNightlyReset()` only
 * in demo mode, and both refuse to run otherwise.
 */

'use strict';

const { getDb, ClassModel, UserModel, BookingModel, WaitingListModel, SiteSettingsModel } = require('../models/database');
const { adminEmails } = require('../utils/accounts');
const { DEMO_ACCOUNTS, isDemoMode } = require('../utils/demoMode');
const { DEMO_DOMAIN, STAFF, PEOPLE, staffEmail, buildSchedule } = require('./demoSchedule');

/** The local hour at which a demo instance restores the sample data. */
const RESET_HOUR = 3;

const SAMPLE_CLASSES = [
  { day: 0, time: '17:00', minutes: 90, name: 'Wspinaczka dla początkujących', type: 'adult_only', spots: 12, color: '#2d5a3d', instructor: 'Anna' },
  { day: 1, time: '18:00', minutes: 90, name: 'Technika na przewieszeniu', type: 'adult_only', spots: 8, color: '#6366f1', instructor: 'Piotr' },
  { day: 2, time: '16:00', minutes: 120, name: 'Zajęcia rodzinne', type: 'adult_and_child', spots: 10, child: 8, color: '#f59e0b', instructor: 'Anna', childInstructor: 'Ola' },
  { day: 3, time: '17:30', minutes: 90, name: 'Bouldering', type: 'adult_only', spots: 15, color: '#0ea5e9', instructor: 'Piotr' },
  { day: 5, time: '16:00', minutes: 120, name: 'Sobota na ściance', type: 'adult_and_child', spots: 12, child: 10, color: '#ec4899', instructor: 'Anna', childInstructor: 'Ola' }
];

const SAMPLE_INSTRUCTORS = [
  [`anna.instruktor@${DEMO_DOMAIN}`, 'Anna'],
  [`piotr.instruktor@${DEMO_DOMAIN}`, 'Piotr'],
  [`ola.instruktor@${DEMO_DOMAIN}`, 'Ola']
];

const SAMPLE_PEOPLE = [
  [`ewa.nowak@${DEMO_DOMAIN}`, 'Ewa', 'Nowak'],
  [`tomasz.wisniewski@${DEMO_DOMAIN}`, 'Tomasz', 'Wiśniewski'],
  [`katarzyna.zielinska@${DEMO_DOMAIN}`, 'Katarzyna', 'Zielińska']
];

// In the demo, the instructor a visitor enters as is Anna, who teaches most of the classes.
const DEMO_INSTRUCTOR = 'Anna';

const adult = (firstName, lastName, age = 30) => ({ firstName, lastName, ageCategory: 'adult', isMain: false, age });
const child = (firstName, lastName, age) => ({ firstName, lastName, ageCategory: 'child', isMain: false, age });

// Who books which class of `npm run seed`: the key of a person (ewa, tomasz, katarzyna from SAMPLE_PEOPLE in order).
const BASE_BOOKINGS = [
  { cls: 'Wspinaczka dla początkujących', who: 'ewa' },
  { cls: 'Technika na przewieszeniu', who: 'tomasz' },
  { cls: 'Zajęcia rodzinne', who: 'katarzyna' }
];

// The demo participant's companion on the family classes.
const DEMO_CHILD = child('Staś', 'Uczestnik', 8);

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

/** The settings the public pages print: a fictitious operator and venue. */
function saveSiteSettings() {
  SiteSettingsModel.saveAll({
    org_name: 'Przykładowa Szkoła Wspinania',
    org_seat: 'Katowice',
    org_nip: '',
    venue_name: 'Ścianka Przykładowa',
    venue_street: 'ul. Przykładowa 1',
    venue_city: 'Katowice'
  });
}

/** The class row of a timetable entry, as ClassModel.create takes it. */
function classData(c, instructorIds, startTime) {
  return {
    name: c.name,
    description: c.level ? `Poziom: ${c.level}. Sprzęt można wypożyczyć na miejscu. Dane demonstracyjne.` : 'Przykładowe zajęcia (dane demonstracyjne).',
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
  };
}

/** `npm run seed`: five classes next week, three instructors and three bookings. */
function seedBasic() {
  const instructorIds = {};
  for (const [email, firstName] of SAMPLE_INSTRUCTORS) {
    const { user } = UserModel.getOrCreate(email);
    getDb().prepare("UPDATE users SET first_name = ?, last_name = 'Instruktor', is_instructor = 1, is_verified = 1 WHERE id = ?")
      .run(firstName, user.id);
    instructorIds[firstName] = user.id;
  }

  const classIdsByName = new Map();
  for (const c of SAMPLE_CLASSES) {
    const startTime = classStart(1, c.day, c.time);
    const id = ClassModel.create(classData(c, instructorIds, startTime)).lastInsertRowid;
    classIdsByName.set(c.name, id);
  }

  const people = {};
  SAMPLE_PEOPLE.forEach(([email, first, last]) => {
    const { user } = UserModel.getOrCreate(email);
    UserModel.updateProfile(user.id, first, last, '1995-04-12', false);
    people[first.toLowerCase()] = { id: user.id, firstName: first, lastName: last };
  });
  for (const booking of BASE_BOOKINGS) {
    const who = people[booking.who];
    const main = { firstName: who.firstName, lastName: who.lastName, ageCategory: 'adult', isMain: true, age: 30 };
    BookingModel.book(who.id, classIdsByName.get(booking.cls), [main]);
  }

  saveSiteSettings();
  return { created: SAMPLE_CLASSES.length };
}

/**
 * Books `person` (a sample participant with the account id) into a class with the people who come along, and returns
 * how many adults and children that took. `room` is what is still to fill: { adults, children }.
 */
function bookPerson(classId, person, c, room, withPartner) {
  const participants = [{ firstName: person.firstName, lastName: person.lastName, ageCategory: 'adult', isMain: true, age: person.age }];
  if (withPartner && person.partner && room.adults >= 2) {
    participants.push(adult(person.partner.firstName, person.partner.lastName, person.age + 1));
  }
  let children = 0;
  if (c.type === 'adult_and_child') {
    for (const kid of person.kids) {
      if (children >= room.children) break;
      participants.push(child(kid.firstName, kid.lastName, kid.age));
      children++;
    }
  }
  BookingModel.book(person.id, classId, participants);
  return { adults: participants.length - children, children };
}

/**
 * The demo instance: the timetable of services/demoSchedule.js for two weeks of history, this week and next, each
 * class filled to its planned level by the sample participants, who are taken in turn so that everybody has a few
 * bookings. The classes of the past weeks are archived like the real ones would be.
 */
function seedInstance(env) {
  const now = new Date();
  const db = getDb();

  const instructorIds = {};
  for (const staff of STAFF) {
    const email = staff.firstName === DEMO_INSTRUCTOR ? DEMO_ACCOUNTS.instructor : staffEmail(staff.firstName);
    const { user } = UserModel.getOrCreate(email);
    db.prepare('UPDATE users SET is_instructor = 1 WHERE id = ?').run(user.id);
    UserModel.updateProfile(user.id, staff.firstName, staff.lastName, '1990-01-01', false);
    instructorIds[staff.firstName] = user.id;
  }

  // Birth years between 1975 and 1999, so that the ages (and the sample participants) are not all alike.
  const people = PEOPLE.map((p, i) => {
    const birthYear = 1975 + ((i * 7) % 25);
    return { ...p, id: completeAccount(p.email, p.firstName, p.lastName, `${birthYear}-0${1 + (i % 9)}-1${i % 10}`), age: now.getFullYear() - birthYear };
  });
  const parents = people.filter(p => p.kids.length);
  const others = people.filter(p => !p.kids.length);
  const demo = {
    id: completeAccount(DEMO_ACCOUNTS.participant, 'Demo', 'Uczestnik', '1992-06-15'),
    firstName: 'Demo', lastName: 'Uczestnik', age: now.getFullYear() - 1992, partner: null, kids: [DEMO_CHILD]
  };

  const schedule = buildSchedule(now);
  const hasStarted = c => new Date(c.startTime) <= now;
  schedule.forEach((c, seq) => {
    const classId = ClassModel.create(classData(c, instructorIds, c.startTime)).lastInsertRowid;
    const room = { adults: c.adultTarget, children: c.childTarget };
    const booked = new Set();
    const take = (person, withPartner) => {
      const took = bookPerson(classId, person, c, room, withPartner);
      room.adults -= took.adults;
      room.children -= took.children;
      booked.add(person.id);
    };

    if (c.demo === 'b') take(demo, false);

    // Every class starts at a different person; a family class takes the parents (they bring the children) first.
    const turn = (list, from) => list.map((_, k) => list[(from + k) % list.length]);
    const rotation = c.type === 'adult_and_child'
      ? [...turn(parents, seq), ...turn(others, seq)]
      : turn(people, seq * 11);
    rotation.forEach((person, k) => {
      if (room.adults > 0) take(person, (seq + k) % 3 === 0);
    });

    // Somebody waits for a full class that is still ahead; the demo participant is second in the queue.
    if (c.full && !hasStarted(c)) {
      const waiting = rotation.filter(p => !booked.has(p.id)).slice(0, 3).map(p => p.id);
      if (c.demo === 'w') waiting.splice(1, 0, demo.id);
      waiting.forEach(userId => WaitingListModel.add(userId, classId));
    }
  });

  // A 16-year-old whose parental consent waits for an administrator (/admin/consents).
  const minorId = completeAccount(`julia.kowalczyk@${DEMO_DOMAIN}`, 'Julia', 'Kowalczyk', birthDateAged16());
  UserModel.requestConsent(minorId);

  completeAccount(DEMO_ACCOUNTS.admin, 'Demo', 'Administrator', '1988-03-02');
  UserModel.syncAdminFlags(adminEmails(env));

  // The classes of the weeks behind us go to the archive, as the daily clean-up would do it.
  ClassModel.archivePastWeek();

  saveSiteSettings();
  return { created: schedule.length };
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

  return getDb().transaction(() => (extended ? seedInstance(env) : seedBasic()))();
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
