/**
 * contact.js — the public contact address of the club.
 *
 * It is shown on the site (footer, privacy policy, dashboards) and in outgoing e-mails, and it is the default
 * Reply-To. It is configuration, not code: set CONTACT_EMAIL in the environment.
 */

'use strict';

const DEFAULT_CONTACT_EMAIL = 'contact@example.com';

function contactEmail(env = process.env) {
  return (env.CONTACT_EMAIL || '').trim() || DEFAULT_CONTACT_EMAIL;
}

module.exports = { contactEmail, DEFAULT_CONTACT_EMAIL };
