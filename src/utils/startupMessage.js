/**
 * startupMessage.js — the line printed when the server starts listening.
 * Deployment-specific wording (who funds the project, the venue) belongs in the site settings, not here.
 */

'use strict';

function startupMessage({ port, url, env }) {
  return `Fantastyczne Wspinanie: listening on port ${port}, public address ${url}, environment ${env}`;
}

module.exports = { startupMessage };
