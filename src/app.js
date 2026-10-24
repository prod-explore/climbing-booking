/**
 * app.js — Główny plik aplikacji Express
 * Fantastyczne Wspinanie — System Rejestracji na Zajęcia Wspinaczkowe
 */

require('dotenv').config();

const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');
const compression = require('compression');

const { initDatabase, ClassModel, SiteSettingsModel, getDb } = require('./models/database');
const { initEmailService } = require('./services/emailService');
const { loadUser } = require('./middleware/auth');
const { generalLimiter, helmetConfig, sanitizeBody } = require('./middleware/security');
const { requireSameOrigin } = require('./middleware/sameOrigin');
const { safeJson } = require('./utils/safeJson');
const { contactEmail } = require('./utils/contact');
const { appUrl } = require('./utils/appUrl');
const siteSettings = require('./utils/siteSettings');
const { startupMessage } = require('./utils/startupMessage');

// Fail at startup, not at the first e-mail, when the public URL is missing in production.
const BASE_URL = appUrl();

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================================
// Inicjalizacja bazy danych i e-maila
// ============================================================
initDatabase();
initEmailService().catch(err => console.warn('Email init warning:', err.message));

const authRoutes = require('./routes/auth.routes');
const userRoutes = require('./routes/user.routes');
const adminRoutes = require('./routes/admin.routes');
const instructorRoutes = require('./routes/instructor.routes');

// ============================================================
// Middleware globalny
// ============================================================
app.set('trust proxy', 1);

// Available to every template, also when a view is rendered outside a request.
app.locals.contactEmail = contactEmail();
app.locals.baseUrl = BASE_URL;
app.locals.canonicalUrl = `${BASE_URL}/`;
app.locals.site = siteSettings.resolve({});

// Liveness probe: registered before the rate limiter so health checks never use up a client's quota.
app.get('/healthz', (req, res) => {
  try {
    getDb().prepare('SELECT 1').get();
    res.type('text/plain').send('ok');
  } catch (err) {
    console.error('Health check failed:', err);
    res.status(503).type('text/plain').send('database unavailable');
  }
});

app.use(helmetConfig);
app.use(compression());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));
app.use(cookieParser());
app.use(requireSameOrigin);
app.use(sanitizeBody);
app.use(generalLimiter);

// Pliki statyczne
app.use(express.static(path.join(__dirname, '../public'), {
  maxAge: process.env.NODE_ENV === 'production' ? '7d' : 0
}));

// ============================================================
// Silnik szablonów EJS
// ============================================================
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));

// Zmienne globalne dla wszystkich szablonów
app.use((req, res, next) => {
  res.locals.appName = 'Fantastyczne Wspinanie';
  res.locals.currentYear = new Date().getFullYear();
  res.locals.safeJson = safeJson;
  // The address that link previews (Messenger, Facebook) and search engines should use for this page. It comes
  // from APP_URL and the path actually requested, never from a literal in a template.
  res.locals.canonicalUrl = `${BASE_URL}${req.path}`;
  // Operator and venue details, as configured in the admin panel.
  res.locals.site = siteSettings.resolve(SiteSettingsModel.all());
  next();
});

// ============================================================
// Ładowanie użytkownika z cookie (nie blokuje)
// ============================================================
app.use(loadUser);

// ============================================================
// Routing
// ============================================================
app.use('/', authRoutes);
app.use('/', userRoutes);
app.use('/', adminRoutes);
app.use('/', instructorRoutes);

// ============================================================
// Obsługa błędów 404
// ============================================================
app.use((req, res) => {
  res.status(404).render('user/error', {
    title: '404 — Nie znaleziono',
    code: 404,
    message: 'Strona nie istnieje.',
    user: req.user
  });
});

// ============================================================
// Globalny handler błędów
// ============================================================
// Express recognises an error handler by its four parameters, so `_next` stays although it is unused.
app.use((err, req, res, _next) => {
  console.error('Błąd aplikacji:', err);

  // Nie ujawniaj szczegółów błędów w produkcji
  const message = process.env.NODE_ENV === 'production'
    ? 'Wystąpił błąd serwera.'
    : err.message;

  res.status(err.status || 500).render('user/error', {
    title: 'Błąd serwera',
    code: err.status || 500,
    message,
    user: req.user
  });
});

// ============================================================
// Start serwera — tylko gdy plik uruchomiono bezpośrednio (node src/app.js).
// Testy importują `app` bez otwierania portu.
// ============================================================
function start() {
  // ============================================================
  // Uruchomienie automatycznego archiwizowania zajęć w tle
  // ============================================================
  const archiveCron = setInterval(() => {
    try {
      ClassModel.archivePastWeek();
    } catch (err) {
      console.error('Błąd podczas archiwizacji (cron):', err);
    }
  }, 1000 * 60 * 60 * 24); // co 24 godziny

  // ============================================================
  // Start serwera
  // ============================================================
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(startupMessage({ port: PORT, url: BASE_URL, env: process.env.NODE_ENV || 'development' }));
  });

  // ============================================================
  // Graceful shutdown — sprzątanie przy zatrzymaniu procesu
  // ============================================================
  function shutdown(signal) {
    console.log(`\n[${signal}] Zamykanie serwera...`);
    clearInterval(archiveCron);
    server.close(() => {
      console.log('Serwer zamknięty.');
      process.exit(0);
    });
    // Force-exit po 10s jeśli coś się zawiesiło
    setTimeout(() => process.exit(1), 10_000).unref();
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
}

if (require.main === module) start();

module.exports = app;
