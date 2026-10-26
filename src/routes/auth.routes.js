/**
 * auth.routes.js — passwordless sign-in: requesting a login link, confirming it, completing the profile on the first
 * sign-in, and signing out.
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
const { isAdminEmail } = require('../utils/accounts');

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

router.post('/auth/request', magicLinkLimiter, async (req, res) => {
  const { email, website } = req.body;
  const nextUrl = safeNext(req.body.next);

  // `website` is a field hidden from people; a bot that fills it in gets the usual success page and no e-mail is sent.
  if (website) {
    console.warn(`[HONEYPOT] Bot detected from ${req.ip} in login form`);
    return res.render('user/login', {
      title: 'Logowanie',
      next: nextUrl,
      error: null,
      success: `Link logowania wysłany na ${email || 'podany adres'}. Sprawdź skrzynkę!`
    });
  }

  if (!email || !validator.isEmail(email)) {
    return res.render('user/login', {
      title: 'Logowanie',
      next: nextUrl,
      error: 'Podaj prawidłowy adres e-mail.',
      success: null
    });
  }

  const normalizedEmail = validator.normalizeEmail(email);

  // A limit per address, not only per IP: without it someone with many IP addresses could flood another person's inbox.
  // It counts requests, not accounts, so the answer says nothing about whether the address is registered.
  if (!emailRequestLimiter.take(normalizedEmail)) {
    return res.render('user/login', {
      title: 'Logowanie',
      next: nextUrl,
      error: 'Wysłaliśmy już kilka linków na ten adres. Użyj ostatniego z nich albo spróbuj ponownie za godzinę.',
      success: null
    });
  }

  try {
    const { user, isNew } = UserModel.getOrCreate(normalizedEmail);

    MagicTokenModel.cleanExpired();

    const { magicLink } = createMagicLink(user.id);

    // Carry a safe `next` through the e-mail, so the user lands where the sign-in started.
    const safeNextInLink = safeNext(req.body.next, null);
    const finalMagicLink = safeNextInLink
      ? `${magicLink}&next=${encodeURIComponent(safeNextInLink)}`
      : magicLink;

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

// The link in the e-mail only shows a confirmation button and does NOT use the token up: mail scanners and link
// previews open the addresses in a message (GET), which would spend the one-time token before the person does.
// Signing in happens in POST /auth/verify.
router.get('/auth/verify', (req, res) => {
  const { token } = req.query;

  if (typeof token !== 'string' || !token) {
    return res.redirect('/login?error=' + encodeURIComponent('Brak tokenu'));
  }

  if (!MagicTokenModel.findValid(token)) {
    return res.redirect('/login?error=' + encodeURIComponent('Link wygasł lub jest nieprawidłowy. Wygeneruj nowy.'));
  }

  // The URL carries the token: keep this page out of every cache.
  res.set('Cache-Control', 'no-store');
  return res.render('user/verify', {
    title: 'Potwierdź logowanie',
    token,
    next: safeNext(req.query.next)
  });
});

router.post('/auth/verify', (req, res) => {
  const { token } = req.body;
  const nextUrl = safeNext(req.body.next);

  if (typeof token !== 'string' || !token) {
    return res.redirect('/login?error=' + encodeURIComponent('Brak tokenu'));
  }

  try {
    // Checked and spent in one transaction: the token works exactly once.
    const tokenRecord = MagicTokenModel.consume(token);

    if (!tokenRecord) {
      return res.redirect('/login?error=' + encodeURIComponent('Link wygasł lub jest nieprawidłowy. Wygeneruj nowy.'));
    }

    const user = UserModel.findById(tokenRecord.user_id);
    UserModel.updateLastLogin(user.id);

    setAuthCookie(res, user);

    if (isAdminEmail(user.email)) {
      return res.redirect('/admin');
    }

    if (!user.first_name || !user.last_name) {
      return res.redirect('/profile/complete?next=' + encodeURIComponent(nextUrl));
    }

    return res.redirect(nextUrl);
  } catch (err) {
    console.error('Błąd weryfikacji tokenu:', err);
    return res.redirect('/login?error=' + encodeURIComponent('Wystąpił błąd. Spróbuj ponownie.'));
  }
});

router.get('/profile/complete', requireAuth, (req, res) => {
  res.render('user/complete-profile', {
    title: 'Uzupełnij profil',
    next: safeNext(req.query.next),
    error: null
  });
});

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

  // Everyone who can hold an account (16 and over) takes a place from the adult pool when booking; younger children
  // are booked as extra participants by a parent.
  UserModel.updateProfile(
    req.user.id,
    firstName.trim().slice(0, 50),
    lastName.trim().slice(0, 50),
    birthDate,
    marketing_accepted === 'on'
  );

  const updatedUser = UserModel.findById(req.user.id);
  setAuthCookie(res, updatedUser);

  return res.redirect(nextUrl);
});

router.post('/auth/logout', (req, res) => {
  res.clearCookie('authToken');
  res.redirect('/');
});

module.exports = router;
