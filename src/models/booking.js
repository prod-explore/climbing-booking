/**
 * booking.js — bookings and their participants; the capacity of each pool is checked inside the transaction.
 */

const { getDb } = require('./connection');

/**
 * Thrown by BookingModel.book when the class does not exist or a pool lacks places.
 * `code`: NO_CLASS | NO_ADULT_SPOTS | NO_CHILD_SPOTS; the counts are the places left when the check ran.
 */
class SpotsError extends Error {
  constructor(code, adultSpotsLeft, childSpotsLeft) {
    super(code);
    this.name = 'SpotsError';
    this.code = code;
    this.adultSpotsLeft = adultSpotsLeft;
    this.childSpotsLeft = childSpotsLeft;
  }
}

const BookingModel = {
  findByUserAndClass: (userId, classId) =>
    getDb().prepare(
      'SELECT * FROM bookings WHERE user_id = ? AND class_id = ?'
    ).get(userId, classId),

  getSpotCounts: (classId) => {
    const row = getDb().prepare(`
      SELECT
        COALESCE((SELECT COUNT(*) FROM participants p JOIN bookings b ON p.booking_id = b.id
          WHERE b.class_id = ? AND p.age_category = 'adult'), 0) as adult_taken,
        COALESCE((SELECT COUNT(*) FROM participants p JOIN bookings b ON p.booking_id = b.id
          WHERE b.class_id = ? AND p.age_category = 'child'), 0) as child_taken
    `).get(classId, classId);
    return row || { adult_taken: 0, child_taken: 0 };
  },

  /** Inserts a booking and its participants in one transaction, without a capacity check: use `book` for that. */
  createWithParticipants: (userId, classId, participants) => {
    const insert = getDb().transaction(() => {
      const booking = getDb().prepare(
        'INSERT INTO bookings (class_id, user_id) VALUES (?, ?)'
      ).run(classId, userId);

      const bookingId = booking.lastInsertRowid;

      const insertParticipant = getDb().prepare(
        'INSERT INTO participants (booking_id, first_name, last_name, age_category, is_main, child_age, age) VALUES (?, ?, ?, ?, ?, ?, ?)'
      );

      for (let i = 0; i < participants.length; i++) {
        const ag = participants[i].age;
        // The main participant's age is a number (computed from birth_date); an extra participant's is form text.
        let ageVal = null;
        if (ag !== undefined && ag !== null && String(ag).trim() !== '') {
          ageVal = parseInt(String(ag).trim(), 10);
          if (isNaN(ageVal)) ageVal = null;
        }

        insertParticipant.run(
          bookingId,
          participants[i].firstName,
          participants[i].lastName,
          participants[i].ageCategory || 'adult',
          participants[i].isMain ? 1 : 0,
          ageVal, // child_age
          ageVal  // age
        );
      }

      return bookingId;
    });
    return insert();
  },

  /**
   * Books the participants and checks the free places in the same write transaction.
   * BEGIN IMMEDIATE takes the write lock before the places are counted, so the limit does not depend on the caller
   * having no `await` between its own check and the insert (nor on there being a single process).
   * Throws SpotsError when a pool lacks places.
   */
  book: (userId, classId, participants) => {
    const run = getDb().transaction(() => {
      const cls = getDb().prepare(
        'SELECT max_spots, max_child_spots, class_type FROM classes WHERE id = ?'
      ).get(classId);
      if (!cls) throw new SpotsError('NO_CLASS', 0, 0);

      const taken = BookingModel.getSpotCounts(classId);
      const adultSpotsLeft = cls.max_spots - taken.adult_taken;
      const childSpotsLeft = cls.class_type === 'adult_and_child'
        ? cls.max_child_spots - taken.child_taken
        : 0;

      const adultsNeeded = participants.filter(p => (p.ageCategory || 'adult') === 'adult').length;
      const childrenNeeded = participants.filter(p => p.ageCategory === 'child').length;

      if (adultsNeeded > adultSpotsLeft) throw new SpotsError('NO_ADULT_SPOTS', adultSpotsLeft, childSpotsLeft);
      if (childrenNeeded > childSpotsLeft) throw new SpotsError('NO_CHILD_SPOTS', adultSpotsLeft, childSpotsLeft);

      return BookingModel.createWithParticipants(userId, classId, participants);
    });
    return run.immediate();
  },

  getByClass: (classId) =>
    getDb().prepare(`
      SELECT b.id as booking_id, b.created_at, u.email, u.first_name as user_first, u.last_name as user_last
      FROM bookings b
      JOIN users u ON b.user_id = u.id
      WHERE b.class_id = ?
      ORDER BY b.created_at ASC
    `).all(classId),

  getParticipantsByBooking: (bookingId) =>
    getDb().prepare(
      'SELECT * FROM participants WHERE booking_id = ? ORDER BY is_main DESC'
    ).all(bookingId),

  cancelByUser: (userId, classId) =>
    getDb().prepare(
      'DELETE FROM bookings WHERE user_id = ? AND class_id = ?'
    ).run(userId, classId),

  getUserBookings: (userId) =>
    getDb().prepare(`
      SELECT b.*, c.name, c.start_time, c.duration_min, c.instructor, c.category, c.class_type, c.child_instructor
      FROM bookings b
      JOIN classes c ON b.class_id = c.id
      WHERE b.user_id = ?
      ORDER BY c.start_time ASC
    `).all(userId),

  getParticipantWithContext: (participantId) =>
    getDb().prepare(`
      SELECT p.*, b.id as booking_id, b.user_id, b.class_id,
             u.email as booker_email, u.first_name as booker_first, u.last_name as booker_last
      FROM participants p
      JOIN bookings b ON p.booking_id = b.id
      JOIN users u ON b.user_id = u.id
      WHERE p.id = ?
    `).get(participantId),

  removeParticipant: (participantId) =>
    getDb().prepare('DELETE FROM participants WHERE id = ?').run(participantId),

  countParticipantsByBooking: (bookingId) =>
    getDb().prepare('SELECT COUNT(*) as cnt FROM participants WHERE booking_id = ?').get(bookingId).cnt,

  deleteBooking: (bookingId) =>
    getDb().prepare('DELETE FROM bookings WHERE id = ?').run(bookingId)
};


module.exports = { BookingModel, SpotsError };
