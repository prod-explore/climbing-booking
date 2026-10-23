/**
 * appUrl.js — the public base URL of the site (links in e-mails).
 *
 * In production APP_URL is required: guessing a host would send people links that lead somewhere else.
 * Outside production it falls back to localhost so the app runs without any setup.
 */

'use strict';

function appUrl(env = process.env) {
  const raw = (env.APP_URL || '').trim();

  if (!raw) {
    if (env.NODE_ENV === 'production') {
      throw new Error('FATAL: APP_URL is not set (required in production: links in e-mails are built from it)');
    }
    return `http://localhost:${env.PORT || 3000}`;
  }

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`FATAL: APP_URL is not a valid URL: ${raw}`);
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`FATAL: APP_URL must start with https:// or http://: ${raw}`);
  }
  return raw.replace(/\/+$/, '');
}

module.exports = { appUrl };
