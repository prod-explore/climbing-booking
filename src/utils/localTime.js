/**
 * localTime.js — the server's local wall-clock time as SQLite text.
 *
 * Class start times are stored as local wall-clock text ('2026-10-26T17:00'), the form a datetime-local input sends,
 * and JavaScript reads them in the process's time zone. Comparing them in SQL with this value, both through
 * datetime(), uses the same clock as the JavaScript checks. SQLite's own CURRENT_TIMESTAMP and datetime('now') are UTC.
 */

'use strict';

/** 'YYYY-MM-DD HH:MM:SS' of `date` (default: now) in the process's local time. */
function localDateTime(date = new Date()) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 19).replace('T', ' ');
}

module.exports = { localDateTime };
