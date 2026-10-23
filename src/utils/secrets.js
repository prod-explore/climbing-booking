/**
 * secrets.js — startup check for secrets that sign sessions.
 *
 * `.env.example` ships an obvious placeholder, and a copied example would otherwise start happily with a secret
 * everybody can read in the repository. This refuses placeholders, short values and values made of a few repeated
 * characters. `ALLOW_WEAK_SECRETS=true` turns the refusal into a warning (local development only).
 */

'use strict';

const MIN_SECRET_LENGTH = 32;

const PLACEHOLDER = /^(change[-_ ]?me|zmien[-_ ].*|your[-_ ].*|.*[-_ ]here|secret|password|token|test|example|todo|x+)$/i;

/** Why a secret is unacceptable, or null when it is fine. */
function weakSecretReason(value) {
  if (PLACEHOLDER.test(value.trim())) return 'it is a placeholder from .env.example';
  if (value.length < MIN_SECRET_LENGTH) return `it is shorter than ${MIN_SECRET_LENGTH} characters`;
  if (new Set(value).size < 8) return 'it has too few distinct characters';
  return null;
}

/**
 * Throws when `value` is a weak secret (warns instead when ALLOW_WEAK_SECRETS is set).
 * An unset value is left to the caller: "required" is a different error.
 */
function assertStrongSecret(name, value, env = process.env) {
  if (!value) return;
  const reason = weakSecretReason(value);
  if (!reason) return;
  const message = `${name} is too weak: ${reason}. Generate one with: openssl rand -hex 32`;
  if (/^(1|true|yes|on)$/i.test(env.ALLOW_WEAK_SECRETS || '')) {
    console.warn(`[secrets] ${message} (allowed by ALLOW_WEAK_SECRETS)`);
    return;
  }
  throw new Error(`FATAL: ${message}`);
}

module.exports = { MIN_SECRET_LENGTH, weakSecretReason, assertStrongSecret };
