/**
 * accounts.js — the account lists that come from the environment, and the administrator role they grant.
 *
 * Personal e-mail addresses are configuration, not source code: they are read from ADMIN_EMAILS and never committed.
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

/** The same address in the form the accounts store it (validator.normalizeEmail, as at sign-in). */
function normalizedEmail(email) {
  return validator.normalizeEmail(String(email || '')) || String(email || '').toLowerCase();
}

/** The administrator addresses from ADMIN_EMAILS (ADMIN_EMAIL, singular, is the older name), normalised. */
function adminEmails(env = process.env) {
  return parseEmailList(env.ADMIN_EMAILS || env.ADMIN_EMAIL).map(normalizedEmail);
}

/**
 * Whether the address is an administrator's. Read from the environment on every call, so the rights follow the list
 * the process runs with and never a flag stored in the database.
 */
function isAdminEmail(email, env = process.env) {
  return Boolean(email) && adminEmails(env).includes(normalizedEmail(email));
}

/** The account with `is_admin` set from ADMIN_EMAILS. */
function withRoles(user) {
  return user && { ...user, is_admin: isAdminEmail(user.email) ? 1 : 0 };
}

module.exports = { parseEmailList, parseInstructors, normalizedEmail, adminEmails, isAdminEmail, withRoles };
