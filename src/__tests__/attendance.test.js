'use strict';

process.env.DB_PATH = ':memory:';
process.env.NODE_ENV = 'test';

const { initDatabase, getDb, ClassModel, UserModel, BookingModel } = require('../models/database');
const { attendanceList, bookingsWithParticipants } = require('../services/attendance');

beforeAll(() => initDatabase());

test('lists adults first, then children, each in booking order, with the booker\'s e-mail', () => {
  const classId = ClassModel.create({ name: 'Rodzinne', description: '', startTime: '2030-05-06T16:00', durationMin: 90,
    classType: 'adult_and_child', maxSpots: 10, maxChildSpots: 10, instructor: '' }).lastInsertRowid;
  const first = UserModel.create('first@example.com', 'Ala', 'A').lastInsertRowid;
  const second = UserModel.create('second@example.com', 'Bartek', 'B').lastInsertRowid;
  BookingModel.book(first, classId, [
    { firstName: 'Ala', lastName: 'A', ageCategory: 'adult', isMain: true, age: 40 },
    { firstName: 'Ola', lastName: 'A', ageCategory: 'child', isMain: false, age: 8 }
  ]);
  BookingModel.book(second, classId, [{ firstName: 'Bartek', lastName: 'B', ageCategory: 'adult', isMain: true, age: 35 }]);
  // make the booking order unambiguous
  getDb().prepare("UPDATE bookings SET created_at = '2030-01-01 10:00:00' WHERE user_id = ?").run(first);
  getDb().prepare("UPDATE bookings SET created_at = '2030-01-01 11:00:00' WHERE user_id = ?").run(second);

  const { bookings, allParticipants } = attendanceList(classId);
  expect(bookings).toHaveLength(2);
  expect(bookingsWithParticipants(classId).map(b => b.participants.length).sort()).toEqual([1, 2]);
  expect(allParticipants.map(p => [p.first_name, p.age_category, p.bookerEmail])).toEqual([
    ['Ala', 'adult', 'first@example.com'],
    ['Bartek', 'adult', 'second@example.com'],
    ['Ola', 'child', 'first@example.com']
  ]);
});
