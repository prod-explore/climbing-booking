/**
 * archive.test.js — the weekly archive takes the classes that started before this week's Monday 00:00 (local time),
 * whichever of the two forms SQLite reads as a date-time the start time is stored in ('T' or a space).
 */

'use strict';

process.env.DB_PATH = ':memory:';
process.env.NODE_ENV = 'test';

const { initDatabase, getDb, ClassModel } = require('../models/database');

/** This week's Monday plus `days` days, as local 'YYYY-MM-DD'. */
function mondayPlus(days) {
  const d = new Date();
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function makeClass(startTime) {
  return ClassModel.create({ name: `Zajęcia ${startTime}`, description: '', startTime, maxSpots: 5, instructor: '' })
    .lastInsertRowid;
}

const isArchived = id => getDb().prepare('SELECT is_archived FROM classes WHERE id = ?').get(id).is_archived;

beforeAll(() => initDatabase());

describe.each([['T'], [' ']])("start time stored with '%s' between date and time", (sep) => {
  test('a class of last week is archived', () => {
    const id = makeClass(`${mondayPlus(-1)}${sep}23:30`);
    ClassModel.archivePastWeek();
    expect(isArchived(id)).toBe(1);
  });

  test('a class at Monday 00:00 of this week stays', () => {
    // Compared as text, '... 00:00' sorts before '... 00:00:00' and the class was archived on its own day.
    const id = makeClass(`${mondayPlus(0)}${sep}00:00`);
    ClassModel.archivePastWeek();
    expect(isArchived(id)).toBe(0);
  });

  test('a class later this week stays', () => {
    const id = makeClass(`${mondayPlus(2)}${sep}17:00`);
    ClassModel.archivePastWeek();
    expect(isArchived(id)).toBe(0);
  });
});
