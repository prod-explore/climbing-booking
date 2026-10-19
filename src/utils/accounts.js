/**
 * accounts.js — parsing of the account lists that come from the environment.
 *
 * Personal e-mail addresses are configuration, not source code: they are read from
 * ADMIN_EMAILS and INSTRUCTORS and never committed.
 */

const validator = require('validator');

/**
 * "a@x.pl, b@y.pl" -> ['a@x.pl', 'b@y.pl'] (trimmed, lower-cased, invalid entries dropped).
 */
function parseEmailList(raw) {
  return String(raw || '')
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(e => e && validator.isEmail(e));
}

/**
 * "anna@x.pl:Anna, jan@y.pl:Jan" -> [{ email: 'anna@x.pl', firstName: 'Anna' }, ...]
 * An entry needs both parts; anything else is skipped.
 */
function parseInstructors(raw) {
  const out = [];
  for (const part of String(raw || '').split(',')) {
    const i = part.lastIndexOf(':');
    if (i < 0) continue;
    const email = part.slice(0, i).trim().toLowerCase();
    const firstName = part.slice(i + 1).trim();
    if (email && firstName && validator.isEmail(email)) out.push({ email, firstName });
  }
  return out;
}

module.exports = { parseEmailList, parseInstructors };
