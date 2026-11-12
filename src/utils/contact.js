/**
 * contact.js — the public contact address of the club.
 *
 * It is shown on the site (footer, privacy policy, dashboards) and in outgoing e-mails, and it is the default
 * Reply-To. It is configuration, not code: set CONTACT_EMAIL in the environment.
 */

'use strict';

const { DEMO_CONTACT_EMAIL, isDemoMode } = require('./demoMode');

const DEFAULT_CONTACT_EMAIL = 'contact@example.com';

/** A demo instance always shows its fictitious address: it never exposes the one configured for a real deployment. */
function contactEmail(env = process.env) {
  if (isDemoMode(env)) return DEMO_CONTACT_EMAIL;
  return (env.CONTACT_EMAIL || '').trim() || DEFAULT_CONTACT_EMAIL;
}

module.exports = { contactEmail, DEFAULT_CONTACT_EMAIL };
