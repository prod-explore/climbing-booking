/**
 * ipHash.js — QR scans are counted with a keyed hash of the visitor's IP address, never the address itself.
 *
 * HMAC-SHA-256 with a server-side key: the same address gives the same value (so repeat visits can be told apart),
 * and without the key the value cannot be turned back into an address by trying all 2^32 IPv4 addresses.
 * The key is IP_HASH_SECRET, or when that is not set, a key derived from JWT_SECRET (no extra setup needed).
 */

'use strict';

const crypto = require('crypto');

const HASH_PATTERN = /^[0-9a-f]{64}$/;

/** The HMAC key, or null when neither IP_HASH_SECRET nor JWT_SECRET is set. */
function ipHashKey(env = process.env) {
  if (env.IP_HASH_SECRET) return env.IP_HASH_SECRET;
  if (env.JWT_SECRET) return crypto.createHmac('sha256', env.JWT_SECRET).update('qr-scan-ip').digest();
  return null;
}

/** 64 hex characters; '' for a missing address. Throws when there is no key, rather than storing the address. */
function hashIp(ip, env = process.env) {
  if (!ip) return '';
  const key = ipHashKey(env);
  if (!key) throw new Error('hashIp: set IP_HASH_SECRET or JWT_SECRET');
  return crypto.createHmac('sha256', key).update(String(ip)).digest('hex');
}

const isHashedIp = value => HASH_PATTERN.test(value);

module.exports = { hashIp, ipHashKey, isHashedIp };
