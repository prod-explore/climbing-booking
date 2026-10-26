/**
 * class.js — classes: schedule, capacity, instructors, cancellation and archive.
 */

const { getDb, getMondayStr } = require('./connection');
const { localDateTime } = require('../utils/localTime');

const ClassModel = {
  getAll: () =>
    getDb().prepare(`
      SELECT c.*,
        (SELECT COUNT(DISTINCT b.id) FROM bookings b WHERE b.class_id = c.id) as booking_count,
        (SELECT COUNT(*) FROM participants p
          JOIN bookings b2 ON p.booking_id = b2.id
          WHERE b2.class_id = c.id AND p.age_category = 'adult') as adult_taken,
        (SELECT COUNT(*) FROM participants p
          JOIN bookings b2 ON p.booking_id = b2.id
          WHERE b2.class_id = c.id AND p.age_category = 'child') as child_taken
      FROM classes c
      WHERE c.is_archived = 0
      ORDER BY c.start_time ASC
    `).all(),

  getArchived: () =>
    getDb().prepare(`
      SELECT c.*,
        (SELECT COUNT(DISTINCT b.id) FROM bookings b WHERE b.class_id = c.id) as booking_count,
        (SELECT COUNT(*) FROM participants p
          JOIN bookings b2 ON p.booking_id = b2.id
          WHERE b2.class_id = c.id AND p.age_category = 'adult') as adult_taken,
        (SELECT COUNT(*) FROM participants p
          JOIN bookings b2 ON p.booking_id = b2.id
          WHERE b2.class_id = c.id AND p.age_category = 'child') as child_taken
      FROM classes c
      WHERE c.is_archived = 1
      ORDER BY c.start_time DESC
    `).all(),

  /** Classes that have not started yet (by their local start time, see utils/localTime.js), not cancelled or archived. */
  getUpcoming: () =>
    getDb().prepare(`
      SELECT c.*,
        (SELECT COUNT(*) FROM participants p
          JOIN bookings b ON p.booking_id = b.id
          WHERE b.class_id = c.id AND p.age_category = 'adult') as adult_taken,
        (SELECT COUNT(*) FROM participants p
          JOIN bookings b ON p.booking_id = b.id
          WHERE b.class_id = c.id AND p.age_category = 'child') as child_taken
      FROM classes c
      WHERE datetime(c.start_time) > datetime(?) AND c.is_cancelled = 0 AND c.is_archived = 0
      ORDER BY c.start_time ASC
    `).all(localDateTime()),

  getById: (id) =>
    getDb().prepare(`
      SELECT c.*,
        (SELECT COUNT(*) FROM participants p
          JOIN bookings b ON p.booking_id = b.id
          WHERE b.class_id = c.id AND p.age_category = 'adult') as adult_taken,
        (SELECT COUNT(*) FROM participants p
          JOIN bookings b ON p.booking_id = b.id
          WHERE b.class_id = c.id AND p.age_category = 'child') as child_taken
      FROM classes c WHERE c.id = ?
    `).get(id),

  create: (data) =>
    getDb().prepare(`
      INSERT INTO classes (name, description, start_time, duration_min, class_type, max_spots, max_child_spots, instructor, child_instructor, instructor_id, child_instructor_id, category, color, waiting_list_enabled, max_waiting_spots)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(data.name, data.description, data.startTime, data.durationMin || 90,
           data.classType || 'adult_only', data.maxSpots, data.maxChildSpots || 0,
           data.instructor, data.childInstructor || '',
           data.instructorId || null, data.childInstructorId || null, data.category || 'adults',
           data.color || '#6366f1',
           data.waitingListEnabled ? 1 : 0,
           data.maxWaitingSpots || 10),

  update: (id, data) =>
    getDb().prepare(`
      UPDATE classes SET name=?, description=?, start_time=?, duration_min=?,
        class_type=?, max_spots=?, max_child_spots=?, instructor=?, child_instructor=?,
        instructor_id=?, child_instructor_id=?, category=?, color=?,
        waiting_list_enabled=?, max_waiting_spots=? WHERE id=?
    `).run(data.name, data.description, data.startTime, data.durationMin,
           data.classType, data.maxSpots, data.maxChildSpots || 0,
           data.instructor, data.childInstructor || '',
           data.instructorId || null, data.childInstructorId || null, data.category,
           data.color || '#6366f1',
           data.waitingListEnabled ? 1 : 0,
           data.maxWaitingSpots || 10,
           id),

  cancel: (id) =>
    getDb().prepare('UPDATE classes SET is_cancelled = 1 WHERE id = ?').run(id),

  uncancel: (id) =>
    getDb().prepare('UPDATE classes SET is_cancelled = 0 WHERE id = ?').run(id),

  archive: (id) =>
    getDb().prepare('UPDATE classes SET is_archived = 1 WHERE id = ?').run(id),

  restore: (id) =>
    getDb().prepare('UPDATE classes SET is_archived = 0 WHERE id = ?').run(id),

  hardDelete: (id) =>
    getDb().prepare('DELETE FROM classes WHERE id = ?').run(id),

  archivePastWeek: () => {
    const result = getDb().prepare(
      "UPDATE classes SET is_archived = 1 WHERE start_time < ? AND is_archived = 0"
    ).run(getMondayStr());
    
    if (result.changes > 0) {
      console.log(`  ↳ Automatyczne archiwizowanie: przeniesiono ${result.changes} zajęć ze starszych tygodni.`);
    }
    return result.changes;
  },

  getByWeek: (weekStart, weekEnd) =>
    getDb().prepare(`
      SELECT * FROM classes
      WHERE datetime(start_time) >= datetime(?) AND datetime(start_time) < datetime(?) AND is_cancelled = 0 AND is_archived = 0
      ORDER BY datetime(start_time) ASC
    `).all(weekStart, weekEnd),

  existsByNameAndTime: (name, startTime) =>
    !!getDb().prepare(
      'SELECT 1 FROM classes WHERE name = ? AND start_time = ?'
    ).get(name, startTime),

  /** Classes where the account is the main or the children's instructor (classes.instructor_id, migration 008). */
  getByInstructorId: (userId) =>
    getDb().prepare(`
      SELECT c.*,
        (SELECT COUNT(*) FROM participants p
          JOIN bookings b ON p.booking_id = b.id
          WHERE b.class_id = c.id AND p.age_category = 'adult') as adult_taken,
        (SELECT COUNT(*) FROM participants p
          JOIN bookings b ON p.booking_id = b.id
          WHERE b.class_id = c.id AND p.age_category = 'child') as child_taken
      FROM classes c
      WHERE c.instructor_id = ? OR c.child_instructor_id = ?
      ORDER BY start_time DESC
    `).all(userId, userId)
};


module.exports = { ClassModel };
