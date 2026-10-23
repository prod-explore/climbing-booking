/**
 * auth.routes.js — Endpointy autentykacji
 * Obsługuje: żądanie magic linku, weryfikację tokenu, wylogowanie
 */

const express = require('express');
const router = express.Router();
const validator = require('validator');

const { UserModel, MagicTokenModel } = require('../models/database');
const { sendMagicLink } = require('../services/emailService');
const { createMagicLink, setAuthCookie, requireAuth } = require('../middleware/auth');
const { magicLinkLimiter, emailRequestLimiter } = require('../middleware/security');
const { calculateAge } = require('../utils/age');
const { safeNext } = require('../utils/safeNext');

// ============================================================
// GET /login — Strona logowania
// ============================================================
router.get('/login', (req, res) => {
  const nextUrl = safeNext(req.query.next);

  if (req.user) return res.redirect(nextUrl);

  res.render('user/login', {
    title: 'Logowanie',
    next: nextUrl,
    error: req.query.error || null,
    success: req.query.success || null
  });
});

// ============================================================
// POST /auth/request — Żądanie magic linku
// ============================================================
router.post('/auth/request', magicLinkLimiter, async (req, res) => {
  const { email, website } = req.body;
  const nextUrl = safeNext(req.body.next);

  // Honeypot check
  if (website) {
    console.warn(`[HONEYPOT] Bot detected from ${req.ip} in login form`);
    return res.render('user/login', {
      title: 'Logowanie',
      next: nextUrl,
      error: null,
      success: `Link logowania wysłany na ${email || 'podany adres'}. Sprawdź skrzynkę!`
    });
  }

  // Walidacja e-maila
  if (!email || !validator.isEmail(email)) {
    return res.render('user/login', {
      title: 'Logowanie',
      next: nextUrl,
      error: 'Podaj prawidłowy adres e-mail.',
      success: null
    });
  }

  const normalizedEmail = validator.normalizeEmail(email);

  // Limit na adres, nie tylko na IP: bez niego ktoś z wielu adresów IP mógłby zasypać cudzą skrzynkę linkami.
  // Liczą się żądania, nie konta, więc odpowiedź nic nie mówi o tym, czy adres jest zarejestrowany.
  if (!emailRequestLimiter.take(normalizedEmail)) {
    return res.render('user/login', {
      title: 'Logowanie',
      next: nextUrl,
      error: 'Wysłaliśmy już kilka linków na ten adres. Użyj ostatniego z nich albo spróbuj ponownie za godzinę.',
      success: null
    });
  }

  try {
    // Pobierz lub utwórz użytkownika
    const { user, isNew } = UserModel.getOrCreate(normalizedEmail);

    // Wyczyść stare tokeny
    MagicTokenModel.cleanExpired();

    // Wygeneruj magic link
    const { magicLink } = createMagicLink(user.id);

    // Utrzymaj parametr next w wygenerowanym linku (jeśli jest bezpieczny)
    const safeNextInLink = safeNext(req.body.next, null);
    const finalMagicLink = safeNextInLink
      ? `${magicLink}&next=${encodeURIComponent(safeNextInLink)}`
      : magicLink;

    // Wyślij e-mail
    await sendMagicLink(normalizedEmail, finalMagicLink, isNew);

    return res.render('user/login', {
      title: 'Logowanie',
      next: nextUrl,
      error: null,
      success: `Link logowania wysłany na ${normalizedEmail}. Sprawdź skrzynkę!`
    });
  } catch (err) {
    console.error('Błąd wysyłki magic link:', err);
    return res.render('user/login', {
      title: 'Logowanie',
      next: nextUrl,
      error: 'Nie udało się wysłać e-maila. Spróbuj ponownie.',
      success: null
    });
  }
});

// ============================================================
// GET /auth/verify — Strona potwierdzenia logowania
//
// Link z e-maila tylko pokazuje przycisk i NIE zużywa tokenu: skanery poczty i podglądy linków
// otwierają adresy z wiadomości (GET), co zużywałoby jednorazowy token, zanim zrobi to człowiek.
// Logowanie następuje dopiero w POST /auth/verify.
// ============================================================
router.get('/auth/verify', (req, res) => {
  const { token } = req.query;

  if (typeof token !== 'string' || !token) {
    return res.redirect('/login?error=' + encodeURIComponent('Brak tokenu'));
  }

  if (!MagicTokenModel.findValid(token)) {
    return res.redirect('/login?error=' + encodeURIComponent('Link wygasł lub jest nieprawidłowy. Wygeneruj nowy.'));
  }

  // Adres zawiera token: nie zapisuj tej strony w pamięci podręcznej.
  res.set('Cache-Control', 'no-store');
  return res.render('user/verify', {
    title: 'Potwierdź logowanie',
    token,
    next: safeNext(req.query.next)
  });
});

// ============================================================
// POST /auth/verify — Zużycie tokenu i zalogowanie
// ============================================================
router.post('/auth/verify', (req, res) => {
  const { token } = req.body;
  const nextUrl = safeNext(req.body.next);

  if (typeof token !== 'string' || !token) {
    return res.redirect('/login?error=' + encodeURIComponent('Brak tokenu'));
  }

  try {
    // Sprawdzenie i zużycie w jednej transakcji: token zadziała dokładnie raz.
    const tokenRecord = MagicTokenModel.consume(token);

    if (!tokenRecord) {
      return res.redirect('/login?error=' + encodeURIComponent('Link wygasł lub jest nieprawidłowy. Wygeneruj nowy.'));
    }

    const user = UserModel.findById(tokenRecord.user_id);
    UserModel.updateLastLogin(user.id);

    // Ustaw cookie sesji
    setAuthCookie(res, user);

    // Admin — zawsze do panelu admina
    if (user.is_admin) {
      return res.redirect('/admin');
    }

    // Nowy użytkownik bez profilu — uzupełnienie danych
    if (!user.first_name || !user.last_name) {
      return res.redirect('/profile/complete?next=' + encodeURIComponent(nextUrl));
    }

    return res.redirect(nextUrl);
  } catch (err) {
    console.error('Błąd weryfikacji tokenu:', err);
    return res.redirect('/login?error=' + encodeURIComponent('Wystąpił błąd. Spróbuj ponownie.'));
  }
});

// ============================================================
// GET /profile/complete — Uzupełnienie profilu (pierwsze logowanie)
// ============================================================
router.get('/profile/complete', requireAuth, (req, res) => {
  res.render('user/complete-profile', {
    title: 'Uzupełnij profil',
    next: safeNext(req.query.next),
    error: null
  });
});

// ============================================================
// POST /profile/complete — Zapis danych profilu
// ============================================================
router.post('/profile/complete', requireAuth, (req, res) => {
  const { firstName, lastName, birthDate, marketing_accepted } = req.body;
  const nextUrl = safeNext(req.body.next);

  const termsAccepted = req.body.terms_accepted === 'on';
  if (!termsAccepted) {
    return res.render('user/complete-profile', {
      title: 'Uzupełnij profil',
      next: nextUrl,
      error: 'Musisz zaakceptować regulamin i politykę prywatności.'
    });
  }

  if (!firstName?.trim() || !lastName?.trim() || !birthDate) {
    return res.render('user/complete-profile', {
      title: 'Uzupełnij profil',
      next: nextUrl,
      error: 'Imię, nazwisko i data urodzenia są wymagane.'
    });
  }

  const birthDateObj = new Date(birthDate);
  if (isNaN(birthDateObj.getTime())) {
    return res.render('user/complete-profile', {
      title: 'Uzupełnij profil',
      next: nextUrl,
      error: 'Nieprawidłowa data urodzenia.'
    });
  }
  // Data nie może być w przyszłości ani dawniej niż 120 lat temu
  const now120ago = new Date();
  now120ago.setFullYear(now120ago.getFullYear() - 120);
  if (birthDateObj > new Date() || birthDateObj < now120ago) {
    return res.render('user/complete-profile', {
      title: 'Uzupełnij profil',
      next: nextUrl,
      error: 'Nieprawidłowa data urodzenia. Podaj rzeczywistą datę.'
    });
  }

  const age = calculateAge(birthDate);

  if (age === null || age < 16) {
    return res.render('user/complete-profile', {
      title: 'Uzupełnij profil',
      next: nextUrl,
      error: 'Samodzielne konto mogą założyć osoby od 16 roku życia. Młodszych uczestników rejestrują rodzice ze swojego konta.'
    });
  }

  // Od 16 lat w górę — zawsze kategoria 'adult' (pula miejsc dla dorosłych)
  const ageCategory = 'adult';

  UserModel.updateProfile(
    req.user.id,
    firstName.trim().slice(0, 50),
    lastName.trim().slice(0, 50),
    ageCategory,
    birthDate,
    marketing_accepted === 'on'
  );

  // Odśwież dane w cookie
  const updatedUser = UserModel.findById(req.user.id);
  setAuthCookie(res, updatedUser);

  return res.redirect(nextUrl);
});

// ============================================================
// POST /auth/logout — Wylogowanie
// ============================================================
router.post('/auth/logout', (req, res) => {
  res.clearCookie('authToken');
  res.redirect('/');
});

module.exports = router;
