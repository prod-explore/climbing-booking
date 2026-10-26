/**
 * accounts.js — the administrator list that comes from the environment, and the role it grants.
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

module.exports = { parseEmailList, normalizedEmail, adminEmails, isAdminEmail, withRoles };
