/**
 * capacity.test.js — the places of a class, tested on the real models (not on a copy of their logic).
 *
 * BookingModel.book counts the places inside the write transaction, so these tests go through it and check
 * that a refused booking leaves nothing behind. The waiting list is promoted through the real service,
 * with only the e-mail sender replaced.
 */

'use strict';

process.env.DB_PATH = ':memory:';
process.env.NODE_ENV = 'test';

jest.mock('../services/emailService', () => ({
  sendWaitingListPromotedEmail: jest.fn().mockResolvedValue(undefined)
}));

const {
  initDatabase, getDb, SpotsError, UserModel, ClassModel, BookingModel, WaitingListModel
} = require('../models/database');
const { sendWaitingListPromotedEmail } = require('../services/emailService');
const { checkAndPromoteWaitingList } = require('../services/waitingList');

const adult = (n, isMain = false) => ({ firstName: `A${n}`, lastName: 'Test', ageCategory: 'adult', isMain, age: 30 });
const child = (n) => ({ firstName: `C${n}`, lastName: 'Test', ageCategory: 'child', isMain: false, age: 9 });

let seq = 0;
function makeUser(first = 'Jan') {
  const email = `user${++seq}@example.com`;
  const id = UserModel.create(email, first, 'Kowalski').lastInsertRowid;
  return { id, email };
}

function makeClass(overrides = {}) {
  return ClassModel.create({
    name: 'Wspinaczka',
    description: '',
    startTime: '2999-01-01 10:00:00',
    classType: 'adult_only',
    maxSpots: 2,
    maxChildSpots: 0,
    instructor: 'Ala',
    ...overrides
  }).lastInsertRowid;
}

const bookingCount = (classId) =>
  getDb().prepare('SELECT COUNT(*) AS n FROM bookings WHERE class_id = ?').get(classId).n;

beforeAll(() => initDatabase());
beforeEach(() => sendWaitingListPromotedEmail.mockClear());

describe('BookingModel.book', () => {
  test('books while there are places', () => {
    const classId = makeClass({ maxSpots: 2 });
    const u = makeUser();

    BookingModel.book(u.id, classId, [adult(1, true), adult(2)]);

    expect(BookingModel.getSpotCounts(classId).adult_taken).toBe(2);
  });

  test('refuses a booking over the limit and leaves nothing behind', () => {
    const classId = makeClass({ maxSpots: 2 });
    const first = makeUser();
    const second = makeUser();
    BookingModel.book(first.id, classId, [adult(1, true)]);

    // One place left, a group of two asks for two: the whole group is refused, not just its second person.
    expect(() => BookingModel.book(second.id, classId, [adult(2, true), adult(3)])).toThrow(SpotsError);

    expect(bookingCount(classId)).toBe(1);
    expect(BookingModel.getSpotCounts(classId).adult_taken).toBe(1);
  });

  test('reports which pool is short', () => {
    const classId = makeClass({ classType: 'adult_and_child', maxSpots: 3, maxChildSpots: 1 });
    const u = makeUser();

    let error;
    try {
      BookingModel.book(u.id, classId, [adult(1, true), child(1), child(2)]);
    } catch (err) {
      error = err;
    }

    expect(error).toBeInstanceOf(SpotsError);
    expect(error.code).toBe('NO_CHILD_SPOTS');
    expect(error.adultSpotsLeft).toBe(3);
    expect(error.childSpotsLeft).toBe(1);
    expect(bookingCount(classId)).toBe(0);
  });

  test('keeps the adult and child pools apart', () => {
    const classId = makeClass({ classType: 'adult_and_child', maxSpots: 1, maxChildSpots: 2 });
    const u = makeUser();

    BookingModel.book(u.id, classId, [adult(1, true), child(1), child(2)]);

    const counts = BookingModel.getSpotCounts(classId);
    expect(counts.adult_taken).toBe(1);
    expect(counts.child_taken).toBe(2);
  });

  test('an adult-only class has no places for children', () => {
    const classId = makeClass({ classType: 'adult_only', maxSpots: 5 });
    const u = makeUser();

    expect(() => BookingModel.book(u.id, classId, [adult(1, true), child(1)])).toThrow(
      expect.objectContaining({ code: 'NO_CHILD_SPOTS' })
    );
    expect(bookingCount(classId)).toBe(0);
  });

  test('a second booking by the same user is refused and uses no places', () => {
    const classId = makeClass({ maxSpots: 3 });
    const u = makeUser();
    BookingModel.book(u.id, classId, [adult(1, true)]);

    expect(() => BookingModel.book(u.id, classId, [adult(1, true)])).toThrow();

    expect(BookingModel.getSpotCounts(classId).adult_taken).toBe(1);
  });

  test('an unknown class is refused', () => {
    const u = makeUser();
    expect(() => BookingModel.book(u.id, 999999, [adult(1, true)])).toThrow(
      expect.objectContaining({ code: 'NO_CLASS' })
    );
  });
});

describe('waiting list', () => {
  test('promotes the first person when a place is free', async () => {
    const classId = makeClass({ maxSpots: 1, waitingListEnabled: true });
    const booked = makeUser('Anna');
    const waiting = makeUser('Basia');
    BookingModel.book(booked.id, classId, [adult(1, true)]);
    WaitingListModel.add(waiting.id, classId);

    BookingModel.cancelByUser(booked.id, classId);
    await checkAndPromoteWaitingList(classId);

    expect(BookingModel.findByUserAndClass(waiting.id, classId)).toBeDefined();
    expect(WaitingListModel.findByUserAndClass(waiting.id, classId)).toBeUndefined();
    expect(sendWaitingListPromotedEmail).toHaveBeenCalledTimes(1);
    expect(sendWaitingListPromotedEmail.mock.calls[0][0]).toBe(waiting.email);
  });

  test('promotes nobody while the class is still full', async () => {
    const classId = makeClass({ maxSpots: 1, waitingListEnabled: true });
    const booked = makeUser();
    const waiting = makeUser();
    BookingModel.book(booked.id, classId, [adult(1, true)]);
    WaitingListModel.add(waiting.id, classId);

    await checkAndPromoteWaitingList(classId);

    expect(BookingModel.findByUserAndClass(waiting.id, classId)).toBeUndefined();
    expect(WaitingListModel.findByUserAndClass(waiting.id, classId)).toBeDefined();
    expect(sendWaitingListPromotedEmail).not.toHaveBeenCalled();
  });

  test('skips and drops a person on the list who already has a booking, and promotes the next one', async () => {
    const classId = makeClass({ maxSpots: 2, waitingListEnabled: true });
    const leaving = makeUser();
    const bookedAndWaiting = makeUser();
    const next = makeUser('Celina');
    BookingModel.book(leaving.id, classId, [adult(1, true)]);
    BookingModel.book(bookedAndWaiting.id, classId, [adult(2, true)]);
    // An entry left over from before a booking took people off the list.
    WaitingListModel.add(bookedAndWaiting.id, classId);
    WaitingListModel.add(next.id, classId);

    BookingModel.cancelByUser(leaving.id, classId);
    await checkAndPromoteWaitingList(classId);

    expect(BookingModel.findByUserAndClass(next.id, classId)).toBeDefined();
    expect(WaitingListModel.countByClass(classId)).toBe(0);
    expect(sendWaitingListPromotedEmail).toHaveBeenCalledTimes(1);
    expect(sendWaitingListPromotedEmail.mock.calls[0][0]).toBe(next.email);
  });

  test('booking a class takes the person off its waiting list', () => {
    const classId = makeClass({ maxSpots: 1, waitingListEnabled: true });
    const u = makeUser();
    WaitingListModel.add(u.id, classId);

    BookingModel.book(u.id, classId, [adult(1, true)]);

    expect(WaitingListModel.findByUserAndClass(u.id, classId)).toBeUndefined();
  });

  test('keeps the order of the list when two people joined in the same second', () => {
    const classId = makeClass({ maxSpots: 1, waitingListEnabled: true });
    const first = makeUser();
    const second = makeUser();
    WaitingListModel.add(first.id, classId);
    WaitingListModel.add(second.id, classId);
    // Same timestamp for both: only the id can tell them apart.
    getDb().prepare("UPDATE waiting_list SET created_at = '2030-01-01 10:00:00' WHERE class_id = ?").run(classId);

    expect(WaitingListModel.getFirst(classId).user_id).toBe(first.id);
    expect(WaitingListModel.getByClass(classId).map(r => r.user_id)).toEqual([first.id, second.id]);
  });
});
