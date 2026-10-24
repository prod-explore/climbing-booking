/**
 * instructor.routes.js — Panel instruktora
 * Pozwala instruktorom na podgląd ich zajęć i list obecności.
 */

const express = require('express');
const router = express.Router();
const { ClassModel } = require('../models/database');
const { attendanceList } = require('../services/attendance');
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

  const { bookings, allParticipants } = attendanceList(classData.id);

  res.render('instructor/attendance', {
    title: `Lista: ${classData.name}`,
    classData, bookings, allParticipants, user: req.user
  });
});

module.exports = router;
