/**
 * waitingList.js — the waiting list of a full class (adults only).
 */

const { getDb } = require('./connection');

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
