/**
 * upcoming.test.js — a class stops being upcoming when it starts, not at the next midnight UTC.
 *
 * Start times are local wall-clock text ('2026-10-26T17:00'). Compared as text with SQLite's CURRENT_TIMESTAMP
 * ('2026-10-26 15:50:00', UTC) every class of the current UTC day sorted after it ('T' > ' '), so a class that had
 * started stayed on the calendars and open on the waiting-list views until midnight UTC.
 */

'use strict';

process.env.DB_PATH = ':memory:';
process.env.NODE_ENV = 'test';

const { initDatabase, UserModel, ClassModel, WaitingListModel } = require('../models/database');

/** Local 'YYYY-MM-DDTHH:mm', as the class form stores a start time, `minutes` from now. */
function localStart(minutes) {
  const d = new Date(Date.now() + minutes * 60000);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

const makeClass = (name, minutes) => ClassModel.create({
  name, description: '', startTime: localStart(minutes), durationMin: 90, classType: 'adult_only',
  maxSpots: 5, instructor: '', waitingListEnabled: true
}).lastInsertRowid;

let started, later;

beforeAll(() => {
  initDatabase();
  started = makeClass('started a minute ago', -1);
  later = makeClass('starts in an hour', 60);
});

test('getUpcoming leaves out a class that has started', () => {
  const ids = ClassModel.getUpcoming().map(c => c.id);
  expect(ids).toContain(later);
  expect(ids).not.toContain(started);
});

test('the waiting lists on the dashboard leave out a class that has started', () => {
  const userId = UserModel.create('waiting@example.com', 'Ewa', 'Nowak').lastInsertRowid;
  WaitingListModel.add(userId, started);
  WaitingListModel.add(userId, later);
  expect(WaitingListModel.getUserWaitlistBookings(userId).map(c => c.class_id)).toEqual([later]);
});
