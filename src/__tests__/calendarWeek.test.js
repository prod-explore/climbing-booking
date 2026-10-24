'use strict';

const { parseWeekOffset, getWeekBounds, inWeek, computeGridHours } = require('../utils/calendarWeek');

describe('parseWeekOffset', () => {
  test('reads ?week=, limited to a year either way', () => {
    expect(parseWeekOffset('2')).toBe(2);
    expect(parseWeekOffset('-3')).toBe(-3);
    expect(parseWeekOffset('500')).toBe(52);
    expect(parseWeekOffset('-500')).toBe(-52);
  });

  test('anything else is the current week', () => {
    for (const raw of [undefined, '', 'abc']) expect(parseWeekOffset(raw)).toBe(0);
  });
});

describe('getWeekBounds', () => {
  test('runs from Monday 00:00 to Sunday 23:59:59.999, local time', () => {
    const { weekStart, weekEnd } = getWeekBounds(0);
    expect(weekStart.getDay()).toBe(1);
    expect([weekStart.getHours(), weekStart.getMinutes()]).toEqual([0, 0]);
    expect(weekEnd.getDay()).toBe(0);
    expect([weekEnd.getHours(), weekEnd.getMinutes(), weekEnd.getMilliseconds()]).toEqual([23, 59, 999]);
    expect(weekStart <= new Date() && new Date() <= weekEnd).toBe(true);
  });

  test('an offset moves it by whole weeks', () => {
    const now = getWeekBounds(0).weekStart;
    const next = getWeekBounds(1).weekStart;
    expect(next.getDay()).toBe(1);
    expect(Math.round((next - now) / 864e5)).toBe(7);
  });
});

test('inWeek keeps the classes that start within the bounds', () => {
  const bounds = { weekStart: new Date(2030, 0, 7), weekEnd: new Date(2030, 0, 13, 23, 59, 59, 999) };
  const classes = [{ start_time: '2030-01-06T23:00' }, { start_time: '2030-01-07T00:00' }, { start_time: '2030-01-13T20:00' }, { start_time: '2030-01-14T00:00' }];
  expect(inWeek(classes, bounds).map(c => c.start_time)).toEqual(['2030-01-07T00:00', '2030-01-13T20:00']);
});

describe('computeGridHours', () => {
  test('an empty week shows 8 to 21', () => {
    expect(computeGridHours([])).toEqual({ START_HOUR: 8, END_HOUR: 21, SLOT_MIN: 30 });
  });

  test('an hour of margin around the earliest start and the latest end, within 6 to 23', () => {
    expect(computeGridHours([{ start_time: '2030-01-07T17:00', duration_min: 90 }, { start_time: '2030-01-08T10:30', duration_min: 60 }]))
      .toEqual({ START_HOUR: 9, END_HOUR: 20, SLOT_MIN: 30 });
    expect(computeGridHours([{ start_time: '2030-01-07T06:00', duration_min: 60 }, { start_time: '2030-01-07T22:00', duration_min: 120 }]))
      .toEqual({ START_HOUR: 6, END_HOUR: 23, SLOT_MIN: 30 });
  });
});
