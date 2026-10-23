/**
 * safeNext.js — the `next` parameter of the login flow, reduced to a local path.
 *
 * Accepts only a path on this site. Besides absolute URLs and `//host`, it refuses `/\host`: browsers (and the
 * WHATWG URL parser) treat a backslash as a slash in http(s) URLs, so `/\evil.example` leads to evil.example.
 * Tabs and newlines are refused too, because URL parsers strip them (`/<TAB>/evil.example` becomes `//evil.example`).
 */

'use strict';

function safeNext(value, fallback = '/dashboard') {
  if (typeof value !== 'string' || value[0] !== '/') return fallback;
  if (value[1] === '/' || value[1] === '\\') return fallback;
  if (/[\\\u0000-\u001f\u007f]/.test(value)) return fallback;
  return value;
}

module.exports = { safeNext };
