/**
 * instructor.routes.js — Panel instruktora
 * Pozwala instruktorom na podgląd ich zajęć i list obecności.
 */

const express = require('express');
const router = express.Router();
const { ClassModel, BookingModel } = require('../models/database');
const { requireInstructor } = require('../middleware/auth');

// ============================================================
// GET /instructor — Dashboard (lista przypisanych zajęć)
// ============================================================
router.get('/instructor', requireInstructor, (req, res) => {
  let fullName = req.user.first_name;
  if (req.user.last_name) {
    fullName += ' ' + req.user.last_name;
  }

  // Classes linked to this account (classes.instructor_id / child_instructor_id), never matched by name.
  const classes = ClassModel.getByInstructorId(req.user.id);

  res.render('instructor/dashboard', {
    title: 'Panel Instruktora',
    classes,
    user: req.user,
    fullName
  });
});

// ============================================================
// GET /instructor/classes/:id/attendance — Lista obecności
// ============================================================
router.get('/instructor/classes/:id/attendance', requireInstructor, (req, res) => {
  const classData = ClassModel.getById(req.params.id);
  if (!classData) return res.redirect('/instructor?error=Nie+znaleziono+zajęć');

  // Only the instructors linked to this class (or an admin) may see its participants.
  const isAssigned = classData.instructor_id === req.user.id || classData.child_instructor_id === req.user.id;

  if (!isAssigned && !req.user.is_admin) {
    return res.redirect('/instructor?error=Brak dostępu do tych zajęć');
  }

  const bookings = BookingModel.getByClass(classData.id);
  const bookingsWithParticipants = bookings.map(b => ({
    ...b,
    participants: BookingModel.getParticipantsByBooking(b.booking_id)
  }));
  const allParticipants = bookingsWithParticipants.flatMap(b =>
    b.participants.map(p => ({ ...p, bookerEmail: b.email, bookedAt: b.created_at }))
  );

  // Sort: adults ('adult') first, then children ('child')
  allParticipants.sort((a, b) => {
    if (a.age_category !== b.age_category) {
      return a.age_category === 'adult' ? -1 : 1;
    }
    // secondary sort: booking date ascending
    return new Date(a.bookedAt) - new Date(b.bookedAt);
  });

  res.render('instructor/attendance', {
    title: `Lista: ${classData.name}`,
    classData, bookings: bookingsWithParticipants, allParticipants, user: req.user
  });
});

module.exports = router;
