/**
 * calendarWeek.js — the week shown by the calendars (public, participant, admin) and the hours its grid spans.
 */

'use strict';

/** `?week=` as an offset from the current week, limited to a year either way; anything else is 0. */
function parseWeekOffset(raw) {
  const offset = parseInt(raw || '0', 10);
  if (isNaN(offset)) return 0;
  return Math.max(-52, Math.min(52, offset));
}

/** Monday 00:00 and Sunday 23:59:59.999 (local time) of the week `weekOffset` weeks from now. */
function getWeekBounds(weekOffset) {
  const today = new Date();
  const dow = (today.getDay() + 6) % 7;
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - dow + (weekOffset || 0) * 7);
  weekStart.setHours(0, 0, 0, 0);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  weekEnd.setHours(23, 59, 59, 999);
  return { weekStart, weekEnd };
}

/** Classes whose start falls within [weekStart, weekEnd]. */
function inWeek(classes, { weekStart, weekEnd }) {
  return classes.filter(c => {
    const st = new Date(c.start_time);
    return st >= weekStart && st <= weekEnd;
  });
}

/** Grid hours: one hour before the earliest start to one hour after the latest end (8–21 for an empty week). */
function computeGridHours(weekClasses) {
  if (!weekClasses || !weekClasses.length) return { START_HOUR: 8, END_HOUR: 21, SLOT_MIN: 30 };
  let minH = 23, maxH = 0;
  weekClasses.forEach(c => {
    const st = new Date(c.start_time);
    const etMin = st.getHours() * 60 + st.getMinutes() + (c.duration_min || 60);
    const etH = Math.ceil(etMin / 60);
    if (st.getHours() < minH) minH = st.getHours();
    if (etH > maxH) maxH = etH;
  });
  return {
    START_HOUR: Math.max(6, minH - 1),
    END_HOUR:   Math.min(23, maxH + 1),
    SLOT_MIN:   30
  };
}

module.exports = { parseWeekOffset, getWeekBounds, inWeek, computeGridHours };
