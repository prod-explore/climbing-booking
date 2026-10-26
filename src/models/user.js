/**
 * user.js — accounts: participants, instructors and administrators.
 */

const { getDb } = require('./connection');
const { calculateAge } = require('../utils/age');

const UserModel = {
  findByEmail: (email) =>
    getDb().prepare('SELECT * FROM users WHERE email = ?').get(email),

  findById: (id) =>
    getDb().prepare('SELECT * FROM users WHERE id = ?').get(id),

  create: (email, firstName, lastName) =>
    getDb().prepare(
      'INSERT INTO users (email, first_name, last_name) VALUES (?, ?, ?)'
    ).run(email, firstName, lastName),

  /** Adults (18 and over) are verified at once; a younger user stays unverified until an admin confirms consent. */
  updateProfile: (id, firstName, lastName, ageCategory, birthDate, marketingConsent) => {
    const age = calculateAge(birthDate);
    const isVerified = (age !== null && age >= 18) ? 1 : 0;
    const marketingVal = marketingConsent ? 1 : 0;
    getDb().prepare(
      'UPDATE users SET first_name = ?, last_name = ?, age_category = ?, birth_date = ?, is_verified = ?, marketing_consent = ? WHERE id = ?'
    ).run(firstName, lastName, ageCategory, birthDate, isVerified, marketingVal, id);
  },

  updateLastLogin: (id) =>
    getDb().prepare(
      'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?'
    ).run(id),

  getOrCreate: (email) => {
    const existing = UserModel.findByEmail(email);
    if (existing) return { user: existing, isNew: false };
    const result = UserModel.create(email, null, null);
    return { user: UserModel.findById(result.lastInsertRowid), isNew: true };
  },

  // Parental consent for 16- and 17-year-olds: the user asks, an administrator approves or rejects.
  requestConsent: (id) =>
    getDb().prepare(
      'UPDATE users SET consent_requested = 1 WHERE id = ?'
    ).run(id),

  approveConsent: (id) =>
    getDb().prepare(
      'UPDATE users SET is_verified = 1, consent_requested = 0 WHERE id = ?'
    ).run(id),

  rejectConsent: (id) =>
    getDb().prepare(
      'UPDATE users SET consent_requested = 0 WHERE id = ?'
    ).run(id),

  getPendingConsents: () =>
    getDb().prepare(
      "SELECT * FROM users WHERE consent_requested = 1 AND is_verified = 0 ORDER BY created_at DESC"
    ).all(),

  getAllUsers: () =>
    getDb().prepare(
      'SELECT * FROM users WHERE is_admin = 0 ORDER BY created_at DESC'
    ).all(),

  /** Sets users.is_admin to 1 for exactly the given (normalised) addresses and to 0 for everyone else. */
  syncAdminFlags: (emails) => {
    const db = getDb();
    db.transaction(() => {
      db.prepare('UPDATE users SET is_admin = 0 WHERE is_admin <> 0').run();
      const grant = db.prepare('UPDATE users SET is_admin = 1 WHERE email = ?');
      emails.forEach(email => grant.run(email));
    })();
  },

  getInstructors: () =>
    getDb().prepare(
      'SELECT * FROM users WHERE is_instructor = 1 ORDER BY first_name ASC'
    ).all()
};


module.exports = { UserModel };
