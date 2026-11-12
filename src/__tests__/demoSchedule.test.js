/**
 * demoSchedule.test.js — the data of the demo calendar (services/demoSchedule.js): pure functions, no database.
 */

'use strict';

const { DEMO_DOMAIN, WEEK_OFFSETS, STAFF, PEOPLE, TIMETABLE, staffEmail, asciiSlug, classStart, takenFor, buildSchedule } =
  require('../services/demoSchedule');

// A Thursday, a Monday morning and a Sunday night: the weeks must line up whatever "today" is.
const NOWS = [new Date(2026, 10, 12, 12, 0), new Date(2026, 10, 9, 7, 30), new Date(2026, 10, 15, 23, 45)];

describe('the sample people', () => {
  test('are on a reserved domain, have unique addresses and no real-looking data', () => {
    const emails = PEOPLE.map(p => p.email);
    expect(new Set(emails).size).toBe(emails.length);
    for (const email of [...emails, ...STAFF.map(s => staffEmail(s.firstName))]) {
      expect(email).toMatch(new RegExp(`^[a-z0-9.]+@${DEMO_DOMAIN.replace('.', '\\.')}$`));
      expect(email).not.toMatch(/example|kajdan|futumore/i);
    }
    expect(DEMO_DOMAIN).toMatch(/\.test$/);
  });

  test('have Polish names with matching surname forms', () => {
    expect(PEOPLE.length).toBeGreaterThanOrEqual(30);
    expect(PEOPLE.find(p => p.firstName === 'Katarzyna').lastName).toBe('Zielińska');
    expect(PEOPLE.find(p => p.firstName === 'Tomasz').lastName).toBe('Wiśniewski');
    expect(PEOPLE.find(p => p.firstName === 'Tomasz').kids[0].lastName).toBe('Wiśniewska');
    expect(PEOPLE.find(p => p.firstName === 'Katarzyna').partner.lastName).toBe('Zieliński');
    expect(PEOPLE.filter(p => p.kids.length).length).toBeGreaterThanOrEqual(8);
  });

  test('asciiSlug folds the Polish letters', () => {
    expect(asciiSlug('Zofia Woźniak')).toBe('zofia.wozniak');
    expect(asciiSlug('Łukasz Dąbrowski')).toBe('lukasz.dabrowski');
  });
});

describe('the timetable', () => {
  test('has a few classes on every day, with several instructors, levels and sizes', () => {
    for (let day = 0; day < 7; day++) expect(TIMETABLE.filter(t => t.day === day).length).toBeGreaterThanOrEqual(3);
    expect(new Set(TIMETABLE.map(t => t.instructor)).size).toBeGreaterThanOrEqual(5);
    expect(new Set(TIMETABLE.map(t => t.level)).size).toBeGreaterThanOrEqual(3);
    expect(new Set(TIMETABLE.map(t => t.spots)).size).toBeGreaterThanOrEqual(5);
    expect(new Set(TIMETABLE.map(t => t.time)).size).toBeGreaterThanOrEqual(8);
    const staff = STAFF.map(s => s.firstName);
    for (const t of TIMETABLE) {
      expect(staff).toContain(t.instructor);
      if (t.childInstructor) expect(staff).toContain(t.childInstructor);
      expect(t.fill).toHaveLength(WEEK_OFFSETS.length);
      expect(t.demo).toHaveLength(WEEK_OFFSETS.length);
    }
  });

  test('shows empty, nearly full and full classes in both coming weeks', () => {
    for (const weekIndex of [2, 3]) {
      const fills = TIMETABLE.map(t => t.fill[weekIndex]);
      expect(fills.some(f => f === 0)).toBe(true);
      expect(fills.some(f => f >= 0.8 && f < 1)).toBe(true);
      expect(fills.some(f => f === 1)).toBe(true);
    }
  });
});

describe('classStart', () => {
  test('places a day of a week relative to the given date, in the form the admin form stores', () => {
    const thursday = new Date(2026, 10, 12, 12, 0);
    expect(classStart(0, 0, '17:00', thursday)).toBe('2026-11-09T17:00');
    expect(classStart(1, 6, '09:05', thursday)).toBe('2026-11-22T09:05');
    expect(classStart(-1, 3, '18:00', thursday)).toBe('2026-11-05T18:00');
  });

  test('keeps a Sunday in the week that started on the Monday before', () => {
    expect(classStart(0, 0, '10:00', new Date(2026, 10, 15, 23, 45))).toBe('2026-11-09T10:00');
  });
});

test('takenFor takes at least one place of a class that is not empty', () => {
  expect(takenFor(10, 0)).toBe(0);
  expect(takenFor(8, 0.1)).toBe(1);
  expect(takenFor(12, 0.5)).toBe(6);
  expect(takenFor(4, 1)).toBe(4);
});

describe.each(NOWS.map(now => [now.toString(), now]))('buildSchedule on %s', (_label, now) => {
  const schedule = buildSchedule(now);

  test('covers this week and the next with upcoming classes behind the earliest, in order', () => {
    const times = schedule.map(c => c.startTime);
    expect([...times].sort()).toEqual(times);
    for (const weekOffset of [0, 1]) {
      expect(schedule.filter(c => c.weekOffset === weekOffset).length).toBe(TIMETABLE.filter(t => t.fill[weekOffset + 2] !== null).length);
    }
    expect(schedule.filter(c => c.weekOffset === 1).every(c => new Date(c.startTime) > now)).toBe(true);
    expect(schedule.filter(c => c.weekOffset < 0).every(c => new Date(c.startTime) < now)).toBe(true);
    expect(schedule.filter(c => c.weekOffset === 1).length).toBeGreaterThanOrEqual(20);
  });

  test('plans the places to fill within each class\'s capacity', () => {
    for (const c of schedule) {
      expect(c.adultTarget).toBeLessThanOrEqual(c.spots);
      expect(c.childTarget).toBeLessThanOrEqual(c.type === 'adult_and_child' ? c.child : 0);
      expect(c.full).toBe(c.adultTarget === c.spots);
    }
  });
});
