/**
 * startupMessage.js — the line printed when the server starts listening.
 * Deployment-specific wording (who funds the project, the venue) belongs in the site settings, not here.
 */

'use strict';

/**
 * The time zone the process runs in, as an IANA name with its current UTC offset ('Europe/Warsaw, UTC+01:00').
 * Class start times are local wall-clock text, so this is the zone the cut-offs are computed in.
 */
function effectiveTimeZone(now = new Date()) {
  const name = Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown';
  const offsetMin = -now.getTimezoneOffset();
  const sign = offsetMin < 0 ? '-' : '+';
  const abs = Math.abs(offsetMin);
  const hhmm = `${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
  return `${name}, UTC${sign}${hhmm}`;
}

function startupMessage({ port, url, env, timeZone = effectiveTimeZone() }) {
  return `Fantastyczne Wspinanie: listening on port ${port}, public address ${url}, environment ${env}, time zone ${timeZone}`;
}

module.exports = { startupMessage, effectiveTimeZone };
