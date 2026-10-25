/**
 * user.routes.js — the public pages (home, calendar, legal pages, the leaflet QR link) and everything a participant
 * does: the dashboard, booking with extra adults and children, cancelling, the waiting list, and asking for
 * parental-consent verification.
 */

const express = require('express');
const router = express.Router();

const { ClassModel, BookingModel, UserModel, QrScanModel, WaitingListModel, SpotsError } = require('../models/database');
const { requireAuth, requireProfile } = require('../middleware/auth');
const { checkAndPromoteWaitingList } = require('../services/waitingList');
const { apiLimiter } = require('../middleware/security');
const { calculateAge } = require('../utils/age');
const { parseWeekOffset, getWeekBounds, inWeek, computeGridHours } = require('../utils/calendarWeek');

/** Booking stays open until the class starts: there is no "opens N days before" window. */
function isBookingOpen(startTime) {
  const classDate = new Date(startTime);
  return classDate > new Date();
}

router.get('/', (req, res) => {
  const { weekStart, weekEnd } = getWeekBounds(0);

  const weekClasses = inWeek(ClassModel.getUpcoming(), { weekStart, weekEnd })
    .map(c => ({ ...c, adult_taken: c.adult_taken || 0, child_taken: c.child_taken || 0 }));

  const { START_HOUR, END_HOUR, SLOT_MIN } = computeGridHours(weekClasses);

  res.render('user/index', {
    title: 'Panel Uczestnika — Fantastyczne Wspinanie',
    weekClasses, weekStart, weekEnd, weekOffset: 0,
    START_HOUR, END_HOUR, SLOT_MIN,
    user: req.user
  });
});

router.get('/calendar', (req, res) => {
  const weekOffset = parseWeekOffset(req.query.week);
  const { weekStart, weekEnd } = getWeekBounds(weekOffset);

  const weekClasses = inWeek(ClassModel.getUpcoming(), { weekStart, weekEnd })
    .map(c => ({ ...c, adult_taken: c.adult_taken || 0, child_taken: c.child_taken || 0 }));

  const { START_HOUR, END_HOUR, SLOT_MIN } = computeGridHours(weekClasses);

  res.render('user/calendar', {
    title: 'Kalendarz zajęć',
    classes: weekClasses,
    weekStart, weekEnd, weekOffset,
    START_HOUR, END_HOUR, SLOT_MIN,
    user: req.user
  });
});

// A 16- or 17-year-old asks an administrator to confirm parental consent; until then the account cannot book.
router.post('/consent/request', requireAuth, (req, res) => {
  const age = calculateAge(req.user.birth_date);
  if (age === null || age >= 18) {
    return res.redirect('/dashboard?error=Ta+akcja+dotyczy+tylko+osób+niepełnoletnich');
  }
  if (req.user.is_verified) {
    return res.redirect('/dashboard?info=Twoje+konto+jest+już+zweryfikowane');
  }
  if (req.user.consent_requested) {
    return res.redirect('/dashboard?info=Prośba+o+weryfikację+została+już+wysłana');
  }

  UserModel.requestConsent(req.user.id);
  res.redirect('/dashboard?success=Prośba+o+weryfikację+zgody+została+wysłana.+Poczekaj+na+zatwierdzenie+przez+administratora.');
});

router.get('/dashboard', requireAuth, requireProfile, (req, res) => {
  const weekOffset = parseWeekOffset(req.query.week);
  const { weekStart, weekEnd } = getWeekBounds(weekOffset);

  const allUpcoming = ClassModel.getUpcoming();
  const userBookings = BookingModel.getUserBookings(req.user.id);
  const bookingsWithParticipants = userBookings.map(b => ({
    ...b,
    participants: BookingModel.getParticipantsByBooking(b.id)
  }));

  const classesWithStatus = allUpcoming.map(c => ({
    ...c,
    adultSpotsLeft: c.max_spots - (c.adult_taken || 0),
    childSpotsLeft: c.class_type === 'adult_and_child' ? (c.max_child_spots - (c.child_taken || 0)) : 0,
    isFull: (c.adult_taken || 0) >= c.max_spots,
    userBooked: userBookings.some(b => b.class_id === c.id)
  }));

  // The grid hours come from every class of the week, booked or not, so the grid spans the same hours as on the
  // home page.
  const allWeekClasses = inWeek(allUpcoming, { weekStart, weekEnd });
  const { START_HOUR, END_HOUR, SLOT_MIN } = computeGridHours(allWeekClasses);

  // The calendar offers only the classes the user has not booked yet.
  const weekClasses = allUpcoming
    .filter(c => {
      const st = new Date(c.start_time);
      return st >= weekStart && st <= weekEnd && !userBookings.some(b => b.class_id === c.id);
    })
    .map(c => ({ ...c, adult_taken: c.adult_taken || 0, child_taken: c.child_taken || 0 }));

  const userAge = calculateAge(req.user.birth_date);
  const isMinor = userAge !== null && userAge < 18;

  const waitlistBookings = WaitingListModel.getUserWaitlistBookings(req.user.id);

  res.render('user/dashboard', {
    title: 'Mój panel',
    user: req.user,
    isMinor,
    classes: classesWithStatus,
    bookings: bookingsWithParticipants,
    waitlistBookings,
    weekClasses, weekStart, weekEnd, weekOffset,
    START_HOUR, END_HOUR, SLOT_MIN
  });
});

router.get('/book/:classId', requireAuth, requireProfile, (req, res) => {
  // An account completed by someone under 18 stays unverified, and cannot book, until an administrator confirms
  // parental consent.
  if (!req.user.is_verified) {
    return res.redirect('/dashboard?error=Twoje+konto+wymaga+weryfikacji+zgody+rodzica+przed+zapisami');
  }

  const classId = parseInt(req.params.classId, 10);
  if (!Number.isInteger(classId) || classId < 1) {
    return res.redirect('/calendar?error=Nieprawidłowe+ID+zajęć');
  }
  const classData = ClassModel.getById(classId);

  if (!classData) {
    return res.redirect('/calendar?error=Zajęcia+nie+istnieją');
  }

  if (classData.is_cancelled) {
    return res.redirect('/calendar?error=Zajęcia+zostały+odwołane');
  }

  if (!isBookingOpen(classData.start_time)) {
    return res.redirect('/calendar?error=Te+zajęcia+już+się+odbyły+lub+nie+można+na+nie+zapisać');
  }

  const adultSpotsLeft = classData.max_spots - (classData.adult_taken || 0);
  const childSpotsLeft = (classData.class_type === 'adult_and_child')
    ? (classData.max_child_spots - (classData.child_taken || 0))
    : 0;

  // A full adult pool turns the page into the waiting-list offer (when the class has one).
  if (adultSpotsLeft <= 0) {
    const waitingListEnabled = !!classData.waiting_list_enabled;
    const waitingCount = waitingListEnabled ? WaitingListModel.countByClass(classData.id) : 0;
    const waitingSpotsLeft = waitingListEnabled ? ((classData.max_waiting_spots || 10) - waitingCount) : 0;
    const userOnWaitlist = waitingListEnabled ? !!WaitingListModel.findByUserAndClass(req.user.id, classData.id) : false;

    return res.render('user/book', {
      title: 'Zapis na zajęcia', classData, user: req.user,
      error: null, notOpen: false, full: true,
      waitingListEnabled, waitingSpotsLeft, userOnWaitlist,
      waitingCount, adultSpotsLeft: 0, childSpotsLeft
    });
  }

  const existingBooking = BookingModel.findByUserAndClass(req.user.id, classData.id);
  if (existingBooking) {
    return res.redirect('/dashboard?info=Jesteś+już+zapisany+na+te+zajęcia');
  }

  res.render('user/book', {
    title: `Zapis: ${classData.name}`,
    classData,
    adultSpotsLeft,
    childSpotsLeft,
    user: req.user,
    error: null,
    notOpen: false,
    full: false,
    waitingListEnabled: !!classData.waiting_list_enabled,
    waitingSpotsLeft: 0,
    userOnWaitlist: false,
    waitingCount: WaitingListModel.countByClass(classData.id)
  });
});

/**
 * Books the user and up to four extra participants, or (action=waitlist) puts the user on the waiting list.
 * Each participant takes a place from the adult pool (16 and over) or, in an adult_and_child class, the child pool.
 */
router.post('/book/:classId', requireAuth, requireProfile, apiLimiter, async (req, res) => {
  if (!req.user.is_verified) {
    return res.redirect('/dashboard?error=Konto+wymaga+weryfikacji');
  }

  const classId = parseInt(req.params.classId, 10);
  if (!Number.isInteger(classId) || classId < 1) {
    return res.redirect('/calendar?error=Nieprawid\u0142owe+ID+zaj\u0119\u0107');
  }
  const classData = ClassModel.getById(classId);

  if (!classData || classData.is_cancelled) {
    return res.redirect('/calendar?error=Nieprawid\u0142owe+zaj\u0119cia');
  }

  if (!isBookingOpen(classData.start_time)) {
    return res.redirect('/calendar?error=Te+zajęcia+nie+są+już+dostępne+do+zapisu');
  }

  const existingBooking = BookingModel.findByUserAndClass(req.user.id, classData.id);
  if (existingBooking) {
    return res.redirect('/dashboard?info=Jesteś+już+zapisany');
  }

  const action = typeof req.body.action === 'string' ? req.body.action : '';
  if (action === 'waitlist') {
    if (!classData.waiting_list_enabled) {
      return res.redirect(`/book/${classData.id}?error=Lista+rezerwowa+nie+jest+włączona`);
    }
    const alreadyOnWaitlist = WaitingListModel.findByUserAndClass(req.user.id, classData.id);
    if (alreadyOnWaitlist) {
      return res.redirect('/dashboard?info=Jesteś+już+na+liście+rezerwowej+tych+zajęć');
    }
    const waitingCount = WaitingListModel.countByClass(classData.id);
    if (waitingCount >= classData.max_waiting_spots) {
      return res.redirect(`/book/${classData.id}?error=Lista+rezerwowa+jest+pełna`);
    }
    // A place may have freed up since the page was shown: then send the user to the normal booking form instead.
    const freshSpots = BookingModel.getSpotCounts(classData.id);
    if (classData.max_spots - freshSpots.adult_taken > 0) {
      return res.redirect(`/book/${classData.id}`);
    }
    WaitingListModel.add(req.user.id, classData.id);
    return res.redirect('/dashboard?success=Zapisano+na+listę+rezerwową.+Poinformujemy+Cię+gdy+zwolni+się+miejsce.');
  }

  const renderBookError = (errorMsg) => {
    const spots = BookingModel.getSpotCounts(classData.id);
    const adultSpotsLeft = classData.max_spots - spots.adult_taken;
    const childSpotsLeft = classData.class_type === 'adult_and_child'
      ? (classData.max_child_spots - spots.child_taken) : 0;
    return res.render('user/book', {
      title: `Zapis: ${classData.name}`,
      classData,
      user: req.user,
      error: errorMsg,
      notOpen: false,
      full: false,
      adultSpotsLeft,
      childSpotsLeft
    });
  };

  const mainUserAge = calculateAge(req.user.birth_date);

  const participants = [];

  let mainAgeCategory = req.user.age_category;
  if (classData.class_type === 'adult_only') {
    mainAgeCategory = 'adult';
    if (mainUserAge !== null && mainUserAge < 16) {
      return renderBookError('Osoby poniżej 16 roku życia nie mogą brać udziału w tych zajęciach.');
    }
  }

  participants.push({
    firstName: req.user.first_name,
    lastName: req.user.last_name,
    ageCategory: mainAgeCategory,
    isMain: true,
    age: mainUserAge
  });

  const extraFirstNames = [].concat(req.body.extraFirstName || []);
  const extraLastNames = [].concat(req.body.extraLastName || []);
  const extraAges = [].concat(req.body.extraAge || []);

  if (extraFirstNames.length > 4) {
    return renderBookError('Możesz zapisać maksymalnie 4 dodatkowe osoby na raz.');
  }

  for (let i = 0; i < extraFirstNames.length; i++) {
    const fn = String(extraFirstNames[i] || '').trim().slice(0, 50);
    const ln = String(extraLastNames[i] || '').trim().slice(0, 50);
    const rawAge = extraAges[i];
    if (fn && ln) {
      if (rawAge === undefined || rawAge === null || String(rawAge).trim() === '') {
        return renderBookError('Podaj wiek (w latach) dla każdej dopisywanej osoby.');
      }
      const ageVal = parseInt(String(rawAge).trim(), 10);
      if (!Number.isInteger(ageVal) || ageVal < 1 || ageVal > 120) {
        return renderBookError('Wiek dopisywanej osoby musi być prawidłową liczbą lat.');
      }

      let ac;
      if (classData.class_type === 'adult_only') {
        if (ageVal < 16) {
          return renderBookError(`Osoba dopisywana (${fn}) jest za młoda na te zajęcia (wymagane min. 16 lat).`);
        }
        ac = 'adult';
      } else {
        ac = ageVal >= 16 ? 'adult' : 'child';
      }

      participants.push({
        firstName: fn,
        lastName: ln,
        ageCategory: ac,
        isMain: false,
        age: ageVal
      });
    }
  }

  const adultsNeeded = participants.filter(p => p.ageCategory === 'adult').length;
  const childrenNeeded = participants.filter(p => p.ageCategory === 'child').length;

  const spots = BookingModel.getSpotCounts(classData.id);
  const adultSpotsLeft = classData.max_spots - spots.adult_taken;
  const childSpotsLeft = (classData.class_type === 'adult_and_child')
    ? (classData.max_child_spots - spots.child_taken) : 0;

  if (adultsNeeded > adultSpotsLeft) {
    return res.render('user/book', {
      title: `Zapis: ${classData.name}`, classData,
      adultSpotsLeft, childSpotsLeft,
      user: req.user,
      error: `Niewystarczająca liczba miejsc dla dorosłych. Dostępne: ${adultSpotsLeft}, potrzebujesz: ${adultsNeeded}.`,
      notOpen: false, full: false
    });
  }

  if (childrenNeeded > 0 && classData.class_type !== 'adult_and_child') {
    return res.render('user/book', {
      title: `Zapis: ${classData.name}`, classData,
      adultSpotsLeft, childSpotsLeft,
      user: req.user,
      error: 'Te zajęcia nie mają puli miejsc dla dzieci.',
      notOpen: false, full: false
    });
  }

  if (childrenNeeded > childSpotsLeft) {
    return res.render('user/book', {
      title: `Zapis: ${classData.name}`, classData,
      adultSpotsLeft, childSpotsLeft,
      user: req.user,
      error: `Niewystarczająca liczba miejsc dla dzieci. Dostępne: ${childSpotsLeft}, potrzebujesz: ${childrenNeeded}.`,
      notOpen: false, full: false
    });
  }

  // A child is never booked without the adult who brings them: an adult booking children takes a place too.
  if (childrenNeeded > 0 && adultsNeeded === 0 && req.user.age_category === 'adult') {
    return res.render('user/book', {
      title: `Zapis: ${classData.name}`, classData,
      adultSpotsLeft, childSpotsLeft,
      user: req.user,
      error: 'Aby zapisać dziecko, musisz również zapisać siebie jako dorosłego uczestnika (opiekuna).',
      notOpen: false, full: false
    });
  }

  try {
    // The places are counted again inside the booking transaction, which decides; the checks above only give a
    // clearer message.
    BookingModel.book(req.user.id, classData.id, participants);

    return res.redirect('/dashboard?success=Zapisano+pomyślnie!');
  } catch (err) {
    if (err instanceof SpotsError) {
      return renderBookError(
        err.code === 'NO_CHILD_SPOTS'
          ? 'Miejsca dla dzieci właśnie się zapełniły. Odśwież stronę i sprawdź dostępność.'
          : 'Miejsca właśnie się zapełniły. Odśwież stronę i sprawdź dostępność.'
      );
    }
    console.error('Błąd zapisu na zajęcia:', err);
    return res.render('user/book', {
      title: `Zapis: ${classData.name}`, classData,
      adultSpotsLeft, childSpotsLeft,
      user: req.user,
      error: 'Błąd podczas zapisu. Spróbuj ponownie.',
      notOpen: false, full: false
    });
  }
});

router.post('/cancel/:classId', requireAuth, (req, res) => {
  const classId = parseInt(req.params.classId, 10);
  if (!Number.isInteger(classId) || classId < 1) {
    return res.redirect('/dashboard?error=Nieprawidłowe+ID+zajęć');
  }
  const classData = ClassModel.getById(classId);

  if (!classData) {
    return res.redirect('/dashboard?error=Zajęcia+nie+istnieją');
  }

  // No cancellations in the last two hours before the class.
  const classDate = new Date(classData.start_time);
  const hoursLeft = (classDate - new Date()) / (1000 * 60 * 60);
  if (hoursLeft < 2) {
    return res.redirect('/dashboard?error=Nie+można+odwołać+zapisu+na+mniej+niż+2+godziny+przed+zajęciami');
  }

  BookingModel.cancelByUser(req.user.id, classData.id);

  // Not awaited: the promotion itself is synchronous, only its e-mail outlives the response; the service logs failures.
  checkAndPromoteWaitingList(classData.id);

  res.redirect('/dashboard?success=Zapis+odwołany');
});

// Cancels one participant of the user's booking; the booking goes when its last participant does.
router.post('/cancel/:classId/participants/:participantId', requireAuth, (req, res) => {
  const classId       = parseInt(req.params.classId, 10);
  const participantId = parseInt(req.params.participantId, 10);
  if (!Number.isInteger(classId) || classId < 1 || !Number.isInteger(participantId) || participantId < 1) {
    return res.redirect('/dashboard?error=Nieprawidłowe+parametry+żądania');
  }
  const classData = ClassModel.getById(classId);

  if (!classData) {
    return res.redirect('/dashboard?error=Zajęcia+nie+istnieją');
  }

  // No cancellations in the last two hours before the class.
  const classDate = new Date(classData.start_time);
  const hoursLeft = (classDate - new Date()) / (1000 * 60 * 60);
  if (hoursLeft < 2) {
    return res.redirect('/dashboard?error=Nie+można+odwołać+zapisu+na+mniej+niż+2+godziny+przed+zajęciami');
  }

  const participant = BookingModel.getParticipantWithContext(participantId);
  if (!participant || participant.class_id !== classId || participant.user_id !== req.user.id) {
    return res.redirect('/dashboard?error=Nieprawidłowy+uczestnik');
  }

  const bookingId = participant.booking_id;
  BookingModel.removeParticipant(participantId);

  const remaining = BookingModel.countParticipantsByBooking(bookingId);
  if (remaining === 0) {
    BookingModel.deleteBooking(bookingId);
  }

  // Not awaited: the promotion itself is synchronous, only its e-mail outlives the response; the service logs failures.
  checkAndPromoteWaitingList(classId);

  res.redirect(`/dashboard?success=Uczestnik+${encodeURIComponent(participant.first_name + ' ' + participant.last_name)}+został+wypisany`);
});

router.post('/waitlist/cancel/:classId', requireAuth, (req, res) => {
  const classId = parseInt(req.params.classId, 10);
  if (!Number.isInteger(classId) || classId < 1) {
    return res.redirect('/dashboard?error=Nieprawidłowe+ID+zajęć');
  }
  const classData = ClassModel.getById(classId);
  if (!classData) {
    return res.redirect('/dashboard?error=Zajęcia+nie+istnieją');
  }

  const onWaitlist = WaitingListModel.findByUserAndClass(req.user.id, classData.id);
  if (!onWaitlist) {
    return res.redirect('/dashboard?error=Nie+jesteś+na+liście+rezerwowej+tych+zajęć');
  }

  WaitingListModel.remove(req.user.id, classData.id);
  res.redirect('/dashboard?success=Wypisano+z+listy+rezerwowej');
});

router.get('/privacy', (req, res) => {
  res.render('user/privacy', {
    title: 'Polityka Prywatności',
    user: req.user
  });
});

router.get('/terms', (req, res) => {
  res.render('user/terms', {
    title: 'Regulamin',
    user: req.user
  });
});

router.get('/cookies', (req, res) => {
  res.render('user/cookies', {
    title: 'Polityka Cookies',
    user: req.user
  });
});

// The address printed as a QR code on the leaflet: counts the visit (with a hashed IP, see utils/ipHash.js) and
// opens the calendar. A failure to record never blocks the redirect.
router.get('/qr', (req, res) => {
  try {
    QrScanModel.record(req.ip, req.get('user-agent'));
  } catch (e) {
    console.error('Błąd zapisu skanu QR:', e);
  }
  res.redirect('/calendar');
});

module.exports = router;
