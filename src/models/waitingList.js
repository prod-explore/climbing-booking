/**
 * waitingList.js — the waiting list of a full class (adults only).
 */

const { getDb } = require('./connection');
const { BookingModel, SpotsError } = require('./booking');

const WaitingListModel = {
  add: (userId, classId) =>
    getDb().prepare(
      'INSERT OR IGNORE INTO waiting_list (class_id, user_id) VALUES (?, ?)'
    ).run(classId, userId),

  remove: (userId, classId) =>
    getDb().prepare(
      'DELETE FROM waiting_list WHERE user_id = ? AND class_id = ?'
    ).run(userId, classId),

  findByUserAndClass: (userId, classId) =>
    getDb().prepare(
      'SELECT * FROM waiting_list WHERE user_id = ? AND class_id = ?'
    ).get(userId, classId),

  getFirst: (classId) =>
    getDb().prepare(
      'SELECT wl.*, u.email, u.first_name, u.last_name FROM waiting_list wl JOIN users u ON wl.user_id = u.id WHERE wl.class_id = ? ORDER BY wl.created_at ASC, wl.id ASC LIMIT 1'
    ).get(classId),

  getByClass: (classId) =>
    getDb().prepare(`
      SELECT wl.id, wl.created_at, u.email, u.first_name, u.last_name, u.id as user_id
      FROM waiting_list wl
      JOIN users u ON wl.user_id = u.id
      WHERE wl.class_id = ?
      ORDER BY wl.created_at ASC, wl.id ASC
    `).all(classId),

  /**
   * Books the first person on the class's list as one adult and takes them off it, in one write transaction.
   * An entry whose user already has a booking of the class is dropped and the next one tried, so a stale entry can
   * neither fail on bookings' UNIQUE(class_id, user_id) nor block the people behind it.
   * Returns the promoted entry (with e-mail and name), or null when the list is empty or the adult pool is full.
   */
  promoteNext: (classId) => {
    const run = getDb().transaction(() => {
      for (let entry = WaitingListModel.getFirst(classId); entry; entry = WaitingListModel.getFirst(classId)) {
        if (BookingModel.findByUserAndClass(entry.user_id, classId)) {
          WaitingListModel.remove(entry.user_id, classId);
          continue;
        }
        try {
          // Also takes the entry off the list.
          BookingModel.book(entry.user_id, classId, [{
            firstName: entry.first_name, lastName: entry.last_name, ageCategory: 'adult', isMain: true, age: null
          }]);
        } catch (err) {
          if (err instanceof SpotsError) return null; // still full: nobody to promote yet
          throw err;
        }
        return entry;
      }
      return null;
    });
    return run.immediate();
  },

  countByClass: (classId) =>
    getDb().prepare('SELECT COUNT(*) as cnt FROM waiting_list WHERE class_id = ?').get(classId).cnt,

  getUserWaitlistBookings: (userId) =>
    getDb().prepare(`
      SELECT wl.*, c.name, c.start_time, c.duration_min, c.instructor, c.category, c.class_type, c.color
      FROM waiting_list wl
      JOIN classes c ON wl.class_id = c.id
      WHERE wl.user_id = ? AND c.start_time > CURRENT_TIMESTAMP AND c.is_cancelled = 0 AND c.is_archived = 0
      ORDER BY c.start_time ASC
    `).all(userId)
};


module.exports = { WaitingListModel };
