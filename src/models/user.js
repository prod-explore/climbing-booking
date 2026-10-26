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

  /**
   * Saves the profile form, which is only submitted with the terms accepted, so it also records when they were
   * accepted (terms_accepted_at, UTC ISO text).
   * Adults (18 and over) are verified at once; a younger user stays unverified until an admin confirms consent.
   */
  updateProfile: (id, firstName, lastName, birthDate, marketingConsent) => {
    const age = calculateAge(birthDate);
    const isVerified = (age !== null && age >= 18) ? 1 : 0;
    const marketingVal = marketingConsent ? 1 : 0;
    getDb().prepare(
      'UPDATE users SET first_name = ?, last_name = ?, birth_date = ?, is_verified = ?, marketing_consent = ?, terms_accepted_at = ? WHERE id = ?'
    ).run(firstName, lastName, birthDate, isVerified, marketingVal, new Date().toISOString(), id);
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

  /**
   * Gives the account the instructor role. A name it lacks is filled from `firstName`/`lastName`; like the
   * administrators, an instructor is verified (and, as every account holder, books an adult place).
   */
  grantInstructor: (id, { firstName = null, lastName = null } = {}) =>
    getDb().prepare(`
      UPDATE users SET is_instructor = 1, is_verified = 1,
        first_name = COALESCE(first_name, ?), last_name = COALESCE(last_name, ?)
      WHERE id = ?
    `).run(firstName || null, lastName || null, id),

  /**
   * Takes the instructor role away and unlinks the account from its classes in the same transaction. The classes keep
   * the name as text, which the class form offers to keep or replace (as for classes from before migration 008).
   */
  revokeInstructor: (id) => {
    const db = getDb();
    db.transaction(() => {
      db.prepare('UPDATE users SET is_instructor = 0 WHERE id = ?').run(id);
      db.prepare('UPDATE classes SET instructor_id = NULL WHERE instructor_id = ?').run(id);
      db.prepare('UPDATE classes SET child_instructor_id = NULL WHERE child_instructor_id = ?').run(id);
    })();
  },

  getInstructors: () =>
    getDb().prepare(
      'SELECT * FROM users WHERE is_instructor = 1 ORDER BY first_name ASC'
    ).all()
};


module.exports = { UserModel };
