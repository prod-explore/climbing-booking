/**
 * seed-demo.js — fills an empty local database with a week of sample classes, a few bookings and the venue
 * settings, so a fresh clone has something to show. Run: npm run seed (uses DB_PATH like the app).
 * It refuses to touch a database that already has classes, and never runs with NODE_ENV=production.
 * Instructor accounts: anna, piotr and ola.instruktor@example.com (log in at /login, the link is printed).
 */

'use strict';

require('dotenv').config();

const { initDatabase, getDb, ClassModel, UserModel, BookingModel, SiteSettingsModel } = require('../src/models/database');

const SAMPLE_CLASSES = [
  { day: 0, time: '17:00', minutes: 90, name: 'Wspinaczka dla początkujących', type: 'adult_only', spots: 12, color: '#2d5a3d', instructor: 'Anna' },
  { day: 1, time: '18:00', minutes: 90, name: 'Technika na przewieszeniu', type: 'adult_only', spots: 8, color: '#6366f1', instructor: 'Piotr' },
  { day: 2, time: '16:00', minutes: 120, name: 'Zajęcia rodzinne', type: 'adult_and_child', spots: 10, child: 8, color: '#f59e0b', instructor: 'Anna', childInstructor: 'Ola' },
  { day: 3, time: '17:30', minutes: 90, name: 'Bouldering', type: 'adult_only', spots: 15, color: '#0ea5e9', instructor: 'Piotr' },
  { day: 5, time: '16:00', minutes: 120, name: 'Sobota na ściance', type: 'adult_and_child', spots: 12, child: 10, color: '#ec4899', instructor: 'Anna', childInstructor: 'Ola' }
];

const SAMPLE_INSTRUCTORS = [
  ['anna.instruktor@example.com', 'Anna'],
  ['piotr.instruktor@example.com', 'Piotr'],
  ['ola.instruktor@example.com', 'Ola']
];

const SAMPLE_PEOPLE = [
  ['ewa.demo@example.com', 'Ewa', 'Nowak'],
  ['tomasz.demo@example.com', 'Tomasz', 'Wiśniewski'],
  ['kasia.demo@example.com', 'Kasia', 'Zielińska']
];

/** Local "YYYY-MM-DDTHH:mm" for the given day of next week (0 = Monday), as the admin form stores it. */
function nextWeek(day, time) {
  const date = new Date();
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7) + 7 + day);
  const [h, m] = time.split(':').map(Number);
  date.setHours(h, m, 0, 0);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function seedDemo() {
  if (getDb().prepare('SELECT COUNT(*) AS n FROM classes').get().n > 0) {
    return { created: 0, reason: 'the database already has classes' };
  }

  // Instructor accounts, as /admin/instructors would create them; classes are linked to them by id.
  const instructorIds = {};
  for (const [email, firstName] of SAMPLE_INSTRUCTORS) {
    const { user } = UserModel.getOrCreate(email);
    getDb().prepare("UPDATE users SET first_name = ?, last_name = 'Instruktor', is_instructor = 1, is_verified = 1, age_category = 'adult' WHERE id = ?")
      .run(firstName, user.id);
    instructorIds[firstName] = user.id;
  }

  const classIds = SAMPLE_CLASSES.map(c => ClassModel.create({
    name: c.name,
    description: 'Przykładowe zajęcia (dane demonstracyjne).',
    startTime: nextWeek(c.day, c.time),
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
  }).lastInsertRowid);

  SAMPLE_PEOPLE.forEach(([email, first, last], i) => {
    const { user } = UserModel.getOrCreate(email);
    UserModel.updateProfile(user.id, first, last, 'adult', '1995-04-12', false);
    BookingModel.book(user.id, classIds[i % classIds.length], [{ firstName: first, lastName: last, ageCategory: 'adult', isMain: true, age: 30 }]);
  });

  SiteSettingsModel.saveAll({
    org_name: 'Przykładowa Szkoła Wspinania',
    org_seat: 'Katowice',
    org_nip: '',
    venue_name: 'Ścianka Przykładowa',
    venue_street: 'ul. Przykładowa 1',
    venue_city: 'Katowice'
  });

  return { created: classIds.length };
}

if (require.main === module) {
  if (process.env.NODE_ENV === 'production') {
    console.error('seed-demo: refusing to run with NODE_ENV=production.');
    process.exit(1);
  }
  initDatabase();
  const result = seedDemo();
  console.log(result.created
    ? `seed-demo: added ${result.created} sample classes next week, 3 bookings and the venue settings. See /calendar?week=1`
    : `seed-demo: nothing added (${result.reason}).`);
}

module.exports = { seedDemo };
