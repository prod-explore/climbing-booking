/**
 * app.js — the Express application: configuration checks, the middleware chain, the routers and the error pages.
 * Running the file starts the server; requiring it (as the tests do) only builds `app` and opens no port.
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
const { redactUrl } = require('./utils/redactUrl');
const { assertStrongSecret } = require('./utils/secrets');

// Fail at startup, not at the first e-mail, when the public URL is missing in production.
const BASE_URL = appUrl();
// Optional: the key for hashing QR visitors' IP addresses (utils/ipHash.js). Checked like JWT_SECRET when set.
assertStrongSecret('IP_HASH_SECRET', process.env.IP_HASH_SECRET);

const app = express();
const PORT = process.env.PORT || 3000;

initDatabase();
initEmailService().catch(err => console.warn('Email init warning:', err.message));

// Required only now: admin.routes creates the configured admin and instructor accounts as it loads, which needs the
// database to be open.
const authRoutes = require('./routes/auth.routes');
const userRoutes = require('./routes/user.routes');
const adminRoutes = require('./routes/admin.routes');
const instructorRoutes = require('./routes/instructor.routes');

// The app runs behind one reverse proxy (docker-compose.yml): trusting one hop of X-Forwarded-For makes req.ip the
// client's address, which the rate limits and the QR-visit hash use, instead of the proxy's.
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
// The access log prints login links without their one-time token, and stays quiet under the test runner.
morgan.token('url', req => redactUrl(req.originalUrl || req.url));
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
}
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));
app.use(cookieParser());
app.use(requireSameOrigin);
app.use(sanitizeBody);
app.use(generalLimiter);

app.use(express.static(path.join(__dirname, '../public'), {
  maxAge: process.env.NODE_ENV === 'production' ? '7d' : 0
}));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));

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

app.use(loadUser);

app.use('/', authRoutes);
app.use('/', userRoutes);
app.use('/', adminRoutes);
app.use('/', instructorRoutes);

app.use((req, res) => {
  res.status(404).render('user/error', {
    title: '404 — Nie znaleziono',
    code: 404,
    message: 'Strona nie istnieje.',
    user: req.user
  });
});

// Express recognises an error handler by its four parameters, so `_next` stays although it is unused.
app.use((err, req, res, _next) => {
  console.error('Błąd aplikacji:', err);

  // In production the page says only that something failed: error messages can name files, queries or settings.
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

/** Starts the server, the daily archiving of past weeks' classes, and a clean shutdown on SIGTERM/SIGINT. */
function start() {
  const archiveCron = setInterval(() => {
    try {
      ClassModel.archivePastWeek();
    } catch (err) {
      console.error('Błąd podczas archiwizacji (cron):', err);
    }
  }, 1000 * 60 * 60 * 24);

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(startupMessage({ port: PORT, url: BASE_URL, env: process.env.NODE_ENV || 'development' }));
  });

  function shutdown(signal) {
    console.log(`\n[${signal}] Zamykanie serwera...`);
    clearInterval(archiveCron);
    server.close(() => {
      console.log('Serwer zamknięty.');
      process.exit(0);
    });
    // server.close() waits for open connections; a client holding one open must not keep the process alive.
    setTimeout(() => process.exit(1), 10_000).unref();
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
}

if (require.main === module) start();

module.exports = app;
