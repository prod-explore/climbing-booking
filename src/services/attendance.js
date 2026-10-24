/**
 * attendance.js — a class's participant list, as the admin and the instructor attendance pages show it.
 */

'use strict';

const { BookingModel } = require('../models/database');

/** Each booking of the class with its participants. */
function bookingsWithParticipants(classId) {
  return BookingModel.getByClass(classId).map(b => ({
    ...b,
    participants: BookingModel.getParticipantsByBooking(b.booking_id)
  }));
}

/**
 * The bookings, and every participant with the booker's e-mail and the booking time:
 * adults first, then children, each group in booking order.
 */
function attendanceList(classId) {
  const bookings = bookingsWithParticipants(classId);
  const allParticipants = bookings.flatMap(b =>
    b.participants.map(p => ({ ...p, bookerEmail: b.email, bookedAt: b.created_at }))
  );
  allParticipants.sort((a, b) => {
    if (a.age_category !== b.age_category) return a.age_category === 'adult' ? -1 : 1;
    return new Date(a.bookedAt) - new Date(b.bookedAt);
  });
  return { bookings, allParticipants };
}

module.exports = { bookingsWithParticipants, attendanceList };
