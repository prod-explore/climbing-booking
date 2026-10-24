/**
 * redactUrl.js — the access log must not record login links: their query string carries a one-time token that
 * still works until it expires.
 */

'use strict';

function redactUrl(url) {
  return String(url).replace(/([?&]token=)[^&#]*/gi, '$1[redacted]');
}

module.exports = { redactUrl };
