/**
 * security.js — rate limits, the HTTP security headers (helmet, CSP) and the stripping of HTML tags from form input.
 *
 * Every limiter keeps its counters in process memory: they reset on restart and are not shared between processes.
 */

const rateLimit = require('express-rate-limit');
const helmet = require('helmet');

/** Every request after the health check, per client IP; tunable through RATE_LIMIT_WINDOW_MS / _MAX_REQUESTS. */
const generalLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Zbyt wiele żądań. Spróbuj ponownie za kilka minut.' }
});

/** Login-link requests per IP and hour: each one sends an e-mail, so this caps the mail one client can trigger. */
const magicLinkLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: parseInt(process.env.MAGIC_LINK_RATE_LIMIT_MAX) || 5,
  message: { error: 'Wysłano już kilka linków. Sprawdź skrzynkę lub spróbuj za godzinę.' },
  standardHeaders: true,
  legacyHeaders: false
});

/**
 * An in-memory sliding window: at most `max` events per key within `windowMs`.
 * `take(key)` records an event and returns true, or returns false when the key has used up its window.
 * The state is lost on restart, which is acceptable for an hourly limit per e-mail address.
 */
function createWindowLimiter({ max, windowMs, now = () => Date.now() }) {
  const hits = new Map();

  function recent(key, t) {
    const list = (hits.get(key) || []).filter(ts => ts > t - windowMs);
    if (list.length === 0) hits.delete(key);
    else hits.set(key, list);
    return list;
  }

  return {
    take(key) {
      const t = now();
      const list = recent(key, t);
      if (list.length >= max) return false;
      hits.set(key, [...list, t]);
      // Past a few thousand keys, sweep out the ones whose events have all expired, so the map cannot grow without bound.
      if (hits.size > 5000) for (const k of [...hits.keys()]) recent(k, t);
      return true;
    }
  };
}

/** Login links per e-mail address and hour, whatever the IP (MAGIC_LINK_EMAIL_LIMIT_MAX). */
const emailRequestLimiter = createWindowLimiter({
  max: parseInt(process.env.MAGIC_LINK_EMAIL_LIMIT_MAX) || 3,
  windowMs: 60 * 60 * 1000
});

/** Booking submissions per IP (POST /book/:classId). */
const apiLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 30,
  message: { error: 'Za dużo żądań API. Poczekaj chwilę.' }
});

/** Admin login-link requests per IP. */
const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Zbyt wiele prób logowania. Spróbuj za 15 minut.' }
});

/**
 * Helmet's security headers. The CSP admits Google Fonts and the Google Maps embed on the home page; scripts keep
 * 'unsafe-inline' because the views still contain inline <script> blocks.
 */
const helmetConfig = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      scriptSrc: ["'self'", "'unsafe-inline'", 'https://maps.googleapis.com'],
      frameSrc: ['https://www.google.com'],
      imgSrc: ["'self'", 'data:', 'https://maps.gstatic.com', 'https://maps.googleapis.com', '*.ggpht.com'],
      connectSrc: ["'self'", 'https://maps.googleapis.com']
    }
  },
  // Off: the Google Maps iframe does not opt in to cross-origin embedding, so COEP would block it.
  crossOriginEmbedderPolicy: false,
  // Not helmet's default `no-referrer`: under it browsers send `Origin: null` on every form POST, and the same-origin
  // check (sameOrigin.js) would refuse all of them. `same-origin` still sends no Referer to other sites.
  referrerPolicy: { policy: 'same-origin' }
});

/**
 * Removes anything shaped like an HTML tag (`<...>`) and trims the result.
 * Does not cut the length: each route enforces its own limit (a class description may be 1000 characters),
 * and express.json/urlencoded already cap the body at 10 kB.
 */
function sanitizeText(str) {
  if (!str || typeof str !== 'string') return '';
  return str.replace(/<[^>]*>/g, '').trim();
}

/** Applies sanitizeText to every top-level string field of the request body (nested values are left alone). */
function sanitizeBody(req, res, next) {
  if (req.body && typeof req.body === 'object') {
    for (const key of Object.keys(req.body)) {
      if (typeof req.body[key] === 'string') {
        req.body[key] = sanitizeText(req.body[key]);
      }
    }
  }
  next();
}

module.exports = {
  createWindowLimiter,
  emailRequestLimiter,
  generalLimiter,
  magicLinkLimiter,
  apiLimiter,
  adminLoginLimiter,
  helmetConfig,
  sanitizeBody
};
