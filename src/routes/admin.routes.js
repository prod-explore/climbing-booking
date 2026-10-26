/**
 * admin.routes.js — the admin panel: sign-in by login link (only for addresses in ADMIN_EMAILS), classes and their
 * participants, the weekly calendar and cloning, the archive, parental consents, instructors and the site settings.
 *
 * Loading this module creates the accounts listed in ADMIN_EMAILS, so it has to be required after the database is
 * initialised.
 */

const express = require('express');
const router = express.Router();
const validator = require('validator');
const { normalizedEmail, adminEmails, isAdminEmail } = require('../utils/accounts');

const { ClassModel, BookingModel, UserModel, MagicTokenModel, QrScanModel, WaitingListModel, SiteSettingsModel, getDb } = require('../models/database');
const { requireAdmin, createMagicLink } = require('../middleware/auth');
const { adminLoginLimiter } = require('../middleware/security');
const { sendMagicLink, sendParticipantRemovedEmail } = require('../services/emailService');
const { checkAndPromoteWaitingList } = require('../services/waitingList');
const { calculateAge } = require('../utils/age');
const siteSettings = require('../utils/siteSettings');
const { parseWeekOffset, getWeekBounds, inWeek, computeGridHours } = require('../utils/calendarWeek');
const { attendanceList, bookingsWithParticipants } = require('../services/attendance');

/**
 * Returns the account for an ADMIN_EMAILS address, creating it as needed. The account is verified and counts as an
 * adult; its admin rights come from the list itself (utils/accounts.js), checked on every request.
 */
function ensureAdminAccount(rawEmail) {
  const email = normalizedEmail(rawEmail);
  UserModel.getOrCreate(email);
  getDb().prepare(
    "UPDATE users SET is_verified = 1, age_category = COALESCE(age_category, 'adult'), first_name = COALESCE(first_name, 'Admin'), last_name = COALESCE(last_name, 'Zajęcia') WHERE email = ?"
  ).run(email);
  return UserModel.findByEmail(email);
}

const startupAdmins = adminEmails();
if (!startupAdmins.length && process.env.NODE_ENV !== 'test') {
  console.warn('ADMIN_EMAILS is empty: nobody can sign in to the admin panel.');
}
startupAdmins.forEach(ensureAdminAccount);
// users.is_admin mirrors the list for queries and for anyone reading the database; it grants nothing by itself.
UserModel.syncAdminFlags(startupAdmins);

// Instructors are managed at /admin/instructors and stored only as users.is_instructor. INSTRUCTORS used to create
// them at every start, which would bring back anyone removed in the panel, so it is no longer read.
if (process.env.INSTRUCTORS) {
  console.warn('INSTRUCTORS is no longer read: manage instructors at /admin/instructors. Existing instructors are kept.');
}

router.get('/admin/login', (req, res) => {
  if (req.user?.is_admin) return res.redirect('/admin');
  res.render('admin/login', { title: 'Panel Admina — Logowanie', error: null, success: null });
});

router.post('/admin/login', adminLoginLimiter, async (req, res) => {
  const { email, website } = req.body;
  const render = (extra) => res.render('admin/login', { title: 'Panel Admina — Logowanie', error: null, success: null, ...extra });
  // The same answer whether or not the address belongs to an administrator: the form does not tell who the admins are.
  const SENT = 'Jeśli to adres administratora, wysłaliśmy na niego link logowania. Sprawdź skrzynkę!';

  // `website` is a field hidden from people (see auth.routes.js).
  if (website) {
    console.warn(`[HONEYPOT] Bot detected from ${req.ip} in admin login form`);
    return render({ success: SENT });
  }

  if (typeof email !== 'string' || !validator.isEmail(email)) {
    return render({ error: 'Podaj prawidłowy adres e-mail.' });
  }

  const address = normalizedEmail(email);
  if (!isAdminEmail(address)) {
    console.warn(`Admin login requested for an address that is not an admin, from ${req.ip}`);
    return render({ success: SENT });
  }

  try {
    const adminUser = ensureAdminAccount(address);
    MagicTokenModel.cleanExpired();
    const { magicLink } = createMagicLink(adminUser.id);
    await sendMagicLink(address, magicLink, false);
    return render({ success: SENT });
  } catch (err) {
    console.error('Błąd wysyłki magic link (admin):', err);
    return render({ error: 'Nie udało się wysłać e-maila. Spróbuj ponownie.' });
  }
});

router.get('/admin', requireAdmin, (req, res) => {
  const classes = ClassModel.getAll();
  const totalClasses = classes.length;
  const totalParticipants = classes.reduce((s, c) => s + (c.adult_taken || 0) + (c.child_taken || 0), 0);
  const upcomingCount = classes.filter(c => new Date(c.start_time) > new Date() && !c.is_cancelled).length;
  const pendingConsents = UserModel.getPendingConsents().length;
  const qrScans = QrScanModel.getCount();

  res.render('admin/dashboard', {
    title: 'Panel Administracyjny',
    classes,
    stats: { totalClasses, totalParticipants, upcomingCount, qrScans },
    pendingConsents,
    user: req.user,
    success: req.query.success || null,
    error: req.query.error || null
  });
});

// The operator and venue details (data controller, NIP, venue address) that the footer, the privacy policy, the terms
// and the map section print. See utils/siteSettings.js.
function renderSettings(res, user, values, extra = {}) {
  res.render('admin/settings', {
    title: 'Ustawienia',
    user,
    fields: siteSettings.FIELDS,
    values,
    success: null,
    error: null,
    ...extra
  });
}

router.get('/admin/settings', requireAdmin, (req, res) => {
  renderSettings(res, req.user, SiteSettingsModel.all(), {
    success: typeof req.query.success === 'string' ? req.query.success : null
  });
});

router.post('/admin/settings', requireAdmin, (req, res) => {
  const { values, errors } = siteSettings.normalize(req.body);

  if (errors.length) {
    res.status(400);
    return renderSettings(res, req.user, values, { error: errors.join(' ') });
  }

  SiteSettingsModel.saveAll(values);
  return res.redirect('/admin/settings?success=' + encodeURIComponent('Zapisano ustawienia.'));
});

router.get('/admin/calendar', requireAdmin, (req, res) => {
  const weekOffset = parseWeekOffset(req.query.week);
  const { weekStart, weekEnd } = getWeekBounds(weekOffset);
  const pendingConsents = UserModel.getPendingConsents().length;

  const weekClasses = inWeek(ClassModel.getAll(), { weekStart, weekEnd })
    .map(c => ({ ...c, adult_taken: c.adult_taken || 0, child_taken: c.child_taken || 0 }));

  const { START_HOUR, END_HOUR } = computeGridHours(weekClasses);

  res.render('admin/calendar', {
    title: 'Kalendarz — Admin',
    classes: weekClasses,
    weekStart, weekEnd, weekOffset,
    START_HOUR, END_HOUR,
    pendingConsents,
    user: req.user,
    success: req.query.success || null,
    error: req.query.error || null
  });
});

/**
 * What the instructor select sends: an instructor account id, '' for nobody, or 'legacy' to keep a class's old
 * free-text instructor that migration 008 could not link to an account unambiguously.
 * Returns the stored pair { id, name } or { error } when the id is not an instructor account.
 */
function resolveInstructor(raw, legacyName, instructors) {
  if (raw === undefined || raw === '') return { id: null, name: '' };
  if (raw === 'legacy') return { id: null, name: legacyName || '' };
  const user = instructors.find(u => String(u.id) === String(raw));
  if (!user) return { error: 'Wybierz instruktora z listy.' };
  return { id: user.id, name: user.first_name };
}

/** The `${column}` / `${column}_id` pair the class form shows after a failed submit. */
function submittedInstructor(column, raw, base) {
  if (typeof raw !== 'string') return { [column]: base[column] || '', [`${column}_id`]: base[`${column}_id`] || null };
  if (raw === 'legacy') return { [column]: base[column] || '', [`${column}_id`]: null };
  const id = parseInt(raw, 10);
  return { [column]: '', [`${column}_id`]: Number.isInteger(id) ? id : null };
}

/**
 * The class form reads database columns (start_time, max_spots...). After a failed submit it is shown again with what
 * was typed, so the submitted body is mapped to that shape. `base` is the class being edited (it keeps its id).
 */
function submittedClass(body, base = {}) {
  const text = (value, fallback) => (typeof value === 'string' ? value : fallback);
  const start = text(body.startTime, '') || base.start_time || '';
  const startMs = new Date(start).getTime();
  const endMs = new Date(text(body.endTime, '')).getTime();
  return {
    ...base,
    name: text(body.name, base.name || ''),
    description: text(body.description, base.description || ''),
    start_time: start,
    duration_min: Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs
      ? Math.round((endMs - startMs) / 60000)
      : base.duration_min || 0,
    class_type: text(body.classType, base.class_type || 'adult_only'),
    max_spots: text(body.maxSpots, base.max_spots ?? ''),
    max_child_spots: text(body.maxChildSpots, base.max_child_spots ?? ''),
    ...submittedInstructor('instructor', body.instructorId, base),
    ...submittedInstructor('child_instructor', body.childInstructorId, base),
    color: text(body.color, base.color || ''),
    waiting_list_enabled: body.waitingListEnabled ? 1 : 0
  };
}

router.get('/admin/classes/new', requireAdmin, (req, res) => {
  const instructors = UserModel.getInstructors();
  res.render('admin/class-form', { title: 'Nowe zajęcia', classData: null, user: req.user, error: null, instructors });
});

router.post('/admin/classes', requireAdmin, (req, res) => {
  const { name, description, startTime, endTime, classType, maxSpots, maxChildSpots, instructorId, childInstructorId, color, waitingListEnabled } = req.body;

  const instructors = UserModel.getInstructors();
  const renderErr = (msg) => res.render('admin/class-form', {
    title: 'Nowe zajęcia', classData: submittedClass(req.body), user: req.user, error: msg, instructors
  });

  const nameTrimmed = String(name || '').trim().slice(0, 120);
  if (!nameTrimmed) return renderErr('Wymagana: nazwa zajęć.');

  const startDate = new Date(startTime);
  const endDate   = new Date(endTime);
  if (!startTime || isNaN(startDate.getTime())) return renderErr('Nieprawidłowa data/godzina startu.');
  if (endTime && isNaN(endDate.getTime()))       return renderErr('Nieprawidłowa data/godzina końca.');
  if (endTime && endDate <= startDate)            return renderErr('Czas końca musi być po czasie startu.');
  const durationMin = endTime ? Math.round((endDate - startDate) / 60000) : 90;
  if (durationMin < 15 || durationMin > 480)     return renderErr('Czas trwania musi wynosić 15 min – 8 godzin.');

  const maxSpotsVal = parseInt(maxSpots, 10);
  if (!Number.isInteger(maxSpotsVal) || maxSpotsVal < 1 || maxSpotsVal > 200)
    return renderErr('Maks. uczestników: wartość od 1 do 200.');

  const ct = classType || 'adult_only';
  const maxChildVal = ct === 'adult_and_child' ? (parseInt(maxChildSpots, 10) || 0) : 0;
  if (ct === 'adult_and_child' && (maxChildVal < 1 || maxChildVal > 200))
    return renderErr('Maks. dzieci: wartość od 1 do 200.');

  const colorVal = /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#6366f1';

  // A new class has no old free-text instructor to keep, so 'legacy' means nobody.
  const mainInstructor = resolveInstructor(instructorId === 'legacy' ? '' : instructorId, '', instructors);
  const childInstructor = ct === 'adult_and_child'
    ? resolveInstructor(childInstructorId === 'legacy' ? '' : childInstructorId, '', instructors)
    : { id: null, name: '' };
  if (mainInstructor.error || childInstructor.error) return renderErr(mainInstructor.error || childInstructor.error);

  ClassModel.create({
    name: nameTrimmed,
    description: String(description || '').trim().slice(0, 1000),
    startTime,
    durationMin,
    classType: ct,
    maxSpots: maxSpotsVal,
    maxChildSpots: maxChildVal,
    instructor: mainInstructor.name,
    childInstructor: childInstructor.name,
    instructorId: mainInstructor.id,
    childInstructorId: childInstructor.id,
    category: ct === 'adult_and_child' ? 'mixed' : 'adults',
    color: colorVal,
    waitingListEnabled: !!waitingListEnabled,
    maxWaitingSpots: 15
  });

  return res.redirect('/admin?success=Zajęcia+dodane+pomyślnie');
});

router.get('/admin/classes/:id/edit', requireAdmin, (req, res) => {
  const classData = ClassModel.getById(req.params.id);
  if (!classData) return res.redirect('/admin?error=Nie+znaleziono+zajęć');
  const instructors = UserModel.getInstructors();
  res.render('admin/class-form', { title: `Edytuj: ${classData.name}`, classData, user: req.user, error: null, instructors });
});

// Fields left empty keep the class's current name, start and duration.
router.post('/admin/classes/:id', requireAdmin, (req, res) => {
  const { name, description, startTime, endTime, classType, maxSpots, maxChildSpots, instructorId, childInstructorId, color, waitingListEnabled } = req.body;
  const classId = parseInt(req.params.id, 10);
  if (!Number.isInteger(classId) || classId < 1) return res.redirect('/admin?error=Nieprawidłowe+ID+zajęć');
  const classData = ClassModel.getById(classId);
  if (!classData) return res.redirect('/admin?error=Nie+znaleziono+zajęć');
  const instructors = UserModel.getInstructors();

  const renderErr = (msg) => res.render('admin/class-form', {
    title: `Edytuj: ${classData.name}`, classData: submittedClass(req.body, classData), user: req.user, error: msg, instructors
  });

  const nameTrimmed = String(name || '').trim().slice(0, 120) || classData.name;

  const effectiveStart = startTime || classData.start_time;
  const startDate = new Date(effectiveStart);
  if (isNaN(startDate.getTime())) return renderErr('Nieprawidłowa data/godzina startu.');

  let newDurationMin = classData.duration_min;
  if (endTime) {
    const endDate = new Date(endTime);
    if (isNaN(endDate.getTime()))  return renderErr('Nieprawidłowa data/godzina końca.');
    if (endDate <= startDate)      return renderErr('Czas końca musi być po czasie startu.');
    newDurationMin = Math.round((endDate - startDate) / 60000);
    if (newDurationMin < 15 || newDurationMin > 480) return renderErr('Czas trwania musi wynosić 15 min – 8 godzin.');
  }

  const maxSpotsRaw = parseInt(maxSpots, 10);
  const maxSpotsVal = (Number.isInteger(maxSpotsRaw) && maxSpotsRaw >= 1 && maxSpotsRaw <= 200)
    ? maxSpotsRaw : classData.max_spots;
  if (!Number.isInteger(maxSpotsRaw) || maxSpotsRaw < 1 || maxSpotsRaw > 200)
    return renderErr('Maks. uczestników: wartość od 1 do 200.');

  const ct = classType || classData.class_type;
  const maxChildRaw = parseInt(maxChildSpots, 10);
  const maxChildVal = ct === 'adult_and_child'
    ? (Number.isInteger(maxChildRaw) && maxChildRaw >= 1 && maxChildRaw <= 200 ? maxChildRaw : (classData.max_child_spots || 0))
    : 0;
  if (ct === 'adult_and_child' && (maxChildVal < 1 || maxChildVal > 200))
    return renderErr('Maks. dzieci: wartość od 1 do 200.');

  const colorVal = /^#[0-9a-fA-F]{6}$/.test(color) ? color : (classData.color || '#6366f1');

  const mainInstructor = resolveInstructor(instructorId, classData.instructor, instructors);
  const childInstructor = ct === 'adult_and_child'
    ? resolveInstructor(childInstructorId, classData.child_instructor, instructors)
    : { id: null, name: '' };
  if (mainInstructor.error || childInstructor.error) return renderErr(mainInstructor.error || childInstructor.error);

  ClassModel.update(classId, {
    name: nameTrimmed,
    description: String(description || '').trim().slice(0, 1000),
    startTime: effectiveStart,
    durationMin: newDurationMin,
    classType: ct,
    maxSpots: maxSpotsVal,
    maxChildSpots: maxChildVal,
    instructor: mainInstructor.name,
    childInstructor: childInstructor.name,
    instructorId: mainInstructor.id,
    childInstructorId: childInstructor.id,
    category: ct === 'adult_and_child' ? 'mixed' : 'adults',
    color: colorVal,
    waitingListEnabled: !!waitingListEnabled,
    maxWaitingSpots: classData.max_waiting_spots || 15
  });

  // A higher limit (or a waiting list switched on with free places) books the waiting people who now fit. Not
  // awaited: the bookings are made before the service's first await, only the e-mails outlive the response.
  checkAndPromoteWaitingList(classId);

  return res.redirect('/admin?success=Zajęcia+zaktualizowane');
});

router.post('/admin/classes/:id/cancel', requireAdmin, (req, res) => {
  const classId = parseInt(req.params.id, 10);
  if (!Number.isInteger(classId) || classId < 1) return res.redirect('/admin?error=Nieprawidłowe+ID');
  ClassModel.cancel(classId);
  res.redirect('/admin?success=Zajęcia+odwołane');
});

router.post('/admin/classes/:id/uncancel', requireAdmin, (req, res) => {
  const classId = parseInt(req.params.id, 10);
  if (!Number.isInteger(classId) || classId < 1) return res.redirect('/admin?error=Nieprawidłowe+ID');
  ClassModel.uncancel(classId);
  res.redirect('/admin?success=Zajęcia+przywrócone+z+odwołanych');
});

router.post('/admin/classes/:id/archive', requireAdmin, (req, res) => {
  const classId = parseInt(req.params.id, 10);
  if (!Number.isInteger(classId) || classId < 1) return res.redirect('/admin?error=Nieprawidłowe+ID');
  ClassModel.archive(classId);
  res.redirect('/admin?success=Zajęcia+zarchiwizowane');
});

router.get('/admin/archive', requireAdmin, (req, res) => {
  const classes = ClassModel.getArchived();
  res.render('admin/archive', {
    title: 'Archiwum zajęć',
    classes,
    user: req.user,
    success: req.query.success || null,
    error: req.query.error || null
  });
});

router.post('/admin/classes/:id/restore', requireAdmin, (req, res) => {
  ClassModel.restore(req.params.id);
  res.redirect('/admin/archive?success=Zajęcia+przywrócone');
});

router.get('/admin/classes/:id/attendance', requireAdmin, (req, res) => {
  const classData = ClassModel.getById(req.params.id);
  if (!classData) return res.redirect('/admin?error=Nie+znaleziono+zajęć');

  const { bookings, allParticipants } = attendanceList(classData.id);

  res.render('admin/attendance', {
    title: `Lista: ${classData.name}`,
    classData, bookings, allParticipants, user: req.user,
    waitingList: WaitingListModel.getByClass(classData.id),
    waitingCount: WaitingListModel.countByClass(classData.id),
    success: req.query.success || null,
    error: req.query.error || null
  });
});

// Instructors: any account can be given the role by e-mail, and losing it unlinks the account from its classes.
function renderInstructors(res, user, extra = {}) {
  res.render('admin/instructors', {
    title: 'Instruktorzy',
    instructors: UserModel.getInstructors(),
    user,
    form: {},
    success: null,
    error: null,
    ...extra
  });
}

router.get('/admin/instructors', requireAdmin, (req, res) => {
  renderInstructors(res, req.user, {
    success: typeof req.query.success === 'string' ? req.query.success : null,
    error: typeof req.query.error === 'string' ? req.query.error : null
  });
});

router.post('/admin/instructors', requireAdmin, (req, res) => {
  const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
  const form = {
    email: text(req.body.email, 254),
    firstName: text(req.body.firstName, 50),
    lastName: text(req.body.lastName, 50)
  };
  const refuse = error => {
    res.status(400);
    renderInstructors(res, req.user, { form, error });
  };

  if (!validator.isEmail(form.email)) return refuse('Podaj prawidłowy adres e-mail.');
  const email = normalizedEmail(form.email);

  const existing = UserModel.findByEmail(email);
  if (existing?.is_instructor) {
    return res.redirect('/admin/instructors?success=' + encodeURIComponent(`${email} jest już instruktorem.`));
  }
  // The first name is what classes show for their instructor, so an account without a name gets one here.
  if (!(existing?.first_name && existing?.last_name) && !(form.firstName && form.lastName)) {
    return refuse('Podaj imię i nazwisko: to konto nie ma ich jeszcze w profilu.');
  }

  const id = existing ? existing.id : UserModel.create(email, form.firstName, form.lastName).lastInsertRowid;
  UserModel.grantInstructor(id, form);
  return res.redirect('/admin/instructors?success=' + encodeURIComponent(`Dodano instruktora: ${email}`));
});

router.post('/admin/instructors/:id/remove', requireAdmin, (req, res) => {
  const target = UserModel.findById(req.params.id);
  if (!target?.is_instructor) return res.redirect('/admin/instructors?error=' + encodeURIComponent('Nie znaleziono instruktora.'));

  UserModel.revokeInstructor(target.id);
  return res.redirect('/admin/instructors?success=' + encodeURIComponent(`Odebrano rolę instruktora: ${target.email}`));
});

// Accounts waiting for parental-consent confirmation, and the minors already confirmed.
router.get('/admin/consents', requireAdmin, (req, res) => {
  const pendingUsers = UserModel.getPendingConsents().map(u => ({
    ...u,
    age: calculateAge(u.birth_date)
  }));
  
  const allUsers = UserModel.getAllUsers();
  const verifiedChildren = allUsers
    .filter(u => {
      const age = calculateAge(u.birth_date);
      return age !== null && age < 18 && u.is_verified;
    })
    .map(u => ({
      ...u,
      age: calculateAge(u.birth_date)
    }));

  res.render('admin/consents', {
    title: 'Zarządzanie zgodami',
    pendingUsers,
    verifiedChildren,
    user: req.user,
    success: req.query.success || null,
    error: req.query.error || null
  });
});

router.post('/admin/consents/:id/approve', requireAdmin, (req, res) => {
  const targetUser = UserModel.findById(req.params.id);
  if (!targetUser) return res.redirect('/admin/consents?error=Nie+znaleziono+użytkownika');

  UserModel.approveConsent(targetUser.id);
  res.redirect('/admin/consents?success=Zgoda+zatwierdzona+dla+' + encodeURIComponent(targetUser.first_name + ' ' + targetUser.last_name));
});

router.post('/admin/consents/:id/reject', requireAdmin, (req, res) => {
  const targetUser = UserModel.findById(req.params.id);
  if (!targetUser) return res.redirect('/admin/consents?error=Nie+znaleziono+użytkownika');

  UserModel.rejectConsent(targetUser.id);
  res.redirect('/admin/consents?success=Prośba+odrzucona');
});

// Removes one participant (and the booking, when it was the last one) and tells the person who booked by e-mail.
router.post('/admin/classes/:classId/participants/:participantId/remove', requireAdmin, async (req, res) => {
  const { classId, participantId } = req.params;
  const classData = ClassModel.getById(classId);
  if (!classData) return res.redirect('/admin?error=Nie+znaleziono+zajęć');

  const participant = BookingModel.getParticipantWithContext(participantId);
  if (!participant || participant.class_id !== parseInt(classId)) {
    return res.redirect(`/admin/classes/${classId}/attendance?error=Nie+znaleziono+uczestnika`);
  }

  const participantName = `${participant.first_name} ${participant.last_name}`;
  const bookerEmail = participant.booker_email;
  const bookingId = participant.booking_id;

  BookingModel.removeParticipant(participantId);

  const remaining = BookingModel.countParticipantsByBooking(bookingId);
  if (remaining === 0) {
    BookingModel.deleteBooking(bookingId);
  }

  try {
    const date = new Date(classData.start_time);
    const classDateStr = date.toLocaleDateString('pl-PL', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
    await sendParticipantRemovedEmail(bookerEmail, participantName, classData.name, classDateStr);
  } catch (emailErr) {
    // The participant is already removed: a failed notification is logged, not reported as a failed removal.
    console.error('Błąd wysyłki e-mail o wypisaniu:', emailErr);
  }

  // Not awaited: see the same call in user.routes.js.
  checkAndPromoteWaitingList(classId);

  return res.redirect(`/admin/classes/${classId}/attendance?success=Usunięto+uczestnika:+${encodeURIComponent(participantName)}`);
});

// Copies this week's classes (not the cancelled or archived ones) `weeksAhead` weeks forward, without bookings.
// A copy whose name and start time already exist is skipped, so cloning the same week twice adds nothing.
router.post('/admin/clone-week', requireAdmin, (req, res) => {
  let weeksAhead = parseInt(req.body.weeksAhead, 10);
  if (!Number.isInteger(weeksAhead) || weeksAhead < 1 || weeksAhead > 52) weeksAhead = 1;
  const daysToAdd = weeksAhead * 7;

  // This week as [Monday 00:00, next Monday 00:00) in local time, formatted like the stored start_time values.
  const now = new Date();
  const dayOfWeek = now.getDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;

  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() + mondayOffset);
  weekStart.setHours(0, 0, 0, 0);

  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 7);

  const tzOffsetStart = weekStart.getTimezoneOffset() * 60000;
  const weekStartStr = (new Date(weekStart.getTime() - tzOffsetStart)).toISOString().slice(0, 16);

  const tzOffsetEnd = weekEnd.getTimezoneOffset() * 60000;
  const weekEndStr = (new Date(weekEnd.getTime() - tzOffsetEnd)).toISOString().slice(0, 16);

  const thisWeekClasses = ClassModel.getByWeek(weekStartStr, weekEndStr);

  if (thisWeekClasses.length === 0) {
    return res.redirect('/admin?error=Brak+zajęć+w+bieżącym+tygodniu+do+sklonowania');
  }

  let clonedCount = 0;
  for (const c of thisWeekClasses) {
    // Adding days in local time keeps the hour across a DST change.
    const originalStart = new Date(c.start_time);
    originalStart.setDate(originalStart.getDate() + daysToAdd);
    
    // Back to local 'YYYY-MM-DDTHH:mm', the format the class form stores.
    const tzOff = originalStart.getTimezoneOffset() * 60000;
    const newStartLocal = (new Date(originalStart.getTime() - tzOff)).toISOString().slice(0, 16);

    if (ClassModel.existsByNameAndTime(c.name, newStartLocal)) {
      continue;
    }

    ClassModel.create({
      name: c.name,
      description: c.description || '',
      startTime: newStartLocal,
      durationMin: c.duration_min,
      classType: c.class_type,
      maxSpots: c.max_spots,
      maxChildSpots: c.max_child_spots || 0,
      instructor: c.instructor || '',
      childInstructor: c.child_instructor || '',
      instructorId: c.instructor_id,
      childInstructorId: c.child_instructor_id,
      category: c.category || 'adults',
      color: /^#[0-9a-fA-F]{6}$/.test(c.color) ? c.color : '#6366f1',
      waitingListEnabled: c.waiting_list_enabled || 0,
      maxWaitingSpots: 15
    });
    clonedCount++;
  }

  if (clonedCount === 0) {
    return res.redirect('/admin?info=Wszystkie+zajęcia+z+bieżącego+tygodnia+już+istnieją+w+wybranym+tygodniu');
  }

  const weekText = weeksAhead === 1 ? 'następny tydzień' : `za ${weeksAhead} tygodnie/tygodni`;
  return res.redirect(`/admin?success=Sklonowano+${clonedCount}+zajęć+${encodeURIComponent(weekText)}`);
});

router.get('/admin/classes/:id/waiting-list', requireAdmin, (req, res) => {
  const classData = ClassModel.getById(req.params.id);
  if (!classData) return res.redirect('/admin?error=Nie+znaleziono+zajęć');

  const waitingList = WaitingListModel.getByClass(classData.id);
  const waitingCount = waitingList.length;

  res.render('admin/attendance', {
    title: `Lista rezerwowa: ${classData.name}`,
    classData,
    bookings: bookingsWithParticipants(classData.id),
    allParticipants: [],
    waitingList,
    waitingCount,
    user: req.user,
    success: req.query.success || null,
    error: req.query.error || null
  });
});

module.exports = router;
