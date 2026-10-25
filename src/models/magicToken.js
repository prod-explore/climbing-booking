/**
 * magicToken.js — one-time login tokens (15 minutes, single use).
 */

const { getDb } = require('./connection');

const MagicTokenModel = {
  create: (userId, token, expiresAt) =>
    getDb().prepare(
      'INSERT INTO magic_tokens (user_id, token, expires_at) VALUES (?, ?, ?)'
    ).run(userId, token, expiresAt),

  // expires_at is an ISO string ('2026-10-23T15:41:00.000Z'). Compared as text with CURRENT_TIMESTAMP
  // ('2026-10-23 15:50:00') it would be wrong: 'T' sorts after ' ', so a token would stay valid until midnight UTC
  // of the day it expires. datetime() parses the ISO form, and both sides are compared as dates.
  findValid: (token) =>
    getDb().prepare(`
      SELECT mt.*, u.email, u.first_name, u.last_name
      FROM magic_tokens mt
      JOIN users u ON mt.user_id = u.id
      WHERE mt.token = ? AND mt.used = 0 AND datetime(mt.expires_at) > datetime('now')
    `).get(token),

  /**
   * Uses a token up: returns its record when it was valid and this call is the one that spent it,
   * undefined otherwise (unknown, expired, or already used).
   */
  consume: (token) => {
    const run = getDb().transaction((t) => {
      const record = MagicTokenModel.findValid(t);
      if (!record) return undefined;
      const spent = getDb().prepare('UPDATE magic_tokens SET used = 1 WHERE token = ? AND used = 0').run(t);
      return spent.changes === 1 ? record : undefined;
    });
    return run.immediate(token);
  },

  cleanExpired: () =>
    getDb().prepare(
      "DELETE FROM magic_tokens WHERE datetime(expires_at) < datetime('now') OR used = 1"
    ).run()
};


module.exports = { MagicTokenModel };
