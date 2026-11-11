/**
 * demoMode.js — the switch for the public demo instance (DEMO_MODE) and the fixed accounts it signs visitors in as.
 *
 * Demo mode is off unless DEMO_MODE=true. It is meant for a throw-away instance with sample data (see
 * services/demoData.js): no e-mail is sent, visitors enter as one of three accounts with a click, and the database is
 * reset every night. The accounts are fixed, so that the administrator can be added to the administrator list without
 * the operator configuring it.
 */

'use strict';

/** The role a visitor can enter as -> the address of its account. Addresses on example.com cannot receive mail. */
const DEMO_ACCOUNTS = Object.freeze({
  participant: 'demo.uczestnik@example.com',
  instructor: 'demo.instruktor@example.com',
  admin: 'demo.admin@example.com'
});

/** Where each role lands after entering. */
const DEMO_LANDING = Object.freeze({
  participant: '/dashboard',
  instructor: '/instructor',
  admin: '/admin'
});

/** Shown instead of sending a login link, on both the participant and the administrator login forms. */
const DEMO_EMAIL_LOGIN_MESSAGE =
  'To jest wersja demonstracyjna: logowanie linkiem e-mail jest wyłączone i żadna wiadomość nie zostanie wysłana. ' +
  'Wejdź jako uczestnik, instruktor lub administrator przyciskami poniżej.';

/**
 * Whether demo mode is on. DEMO_MODE accepts only `true` or `false` (an unset or empty value is `false`); anything
 * else is an error, so that a typo cannot leave a production instance one character away from signing everybody in.
 */
function isDemoMode(env = process.env) {
  const raw = (env.DEMO_MODE || '').trim().toLowerCase();
  if (raw === '' || raw === 'false') return false;
  if (raw === 'true') return true;
  throw new Error(`FATAL: DEMO_MODE must be "true" or "false": ${env.DEMO_MODE}`);
}

module.exports = { DEMO_ACCOUNTS, DEMO_LANDING, DEMO_EMAIL_LOGIN_MESSAGE, isDemoMode };
