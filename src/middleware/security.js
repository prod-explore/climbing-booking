/**
 * security.js — Middleware bezpieczeństwa: rate limiting, nagłówki, sanityzacja
 */

const rateLimit = require('express-rate-limit');
const helmet = require('helmet');

/**
 * Ogólny rate limit dla całej aplikacji
 */
const generalLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 min
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Zbyt wiele żądań. Spróbuj ponownie za kilka minut.' }
});

/**
 * Ścisły rate limit dla endpointu wysyłki magic linku
 * Zapobiega spamowi e-mailowemu
 */
const magicLinkLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 godzina
  max: parseInt(process.env.MAGIC_LINK_RATE_LIMIT_MAX) || 5,
  message: { error: 'Wysłano już kilka linków. Sprawdź skrzynkę lub spróbuj za godzinę.' },
  standardHeaders: true,
  legacyHeaders: false
});

/**
 * Okno przesuwne w pamięci: najwyżej `max` zdarzeń na klucz w czasie `windowMs`.
 * `take(key)` zwraca true i zapisuje zdarzenie albo false, gdy limit jest wyczerpany.
 * Stan ginie przy restarcie, co przy limicie godzinnym na adres e-mail jest akceptowalne.
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
      // Okazjonalnie sprzątaj klucze, do których nikt już nie wraca, żeby mapa nie rosła bez końca.
      if (hits.size > 5000) for (const k of [...hits.keys()]) recent(k, t);
      return true;
    }
  };
}

/**
 * Limit wysyłek magic linku na jeden adres e-mail (niezależnie od IP).
 */
const emailRequestLimiter = createWindowLimiter({
  max: parseInt(process.env.MAGIC_LINK_EMAIL_LIMIT_MAX) || 3,
  windowMs: 60 * 60 * 1000
});

/**
 * Rate limit dla endpointów API (zapisy, itp.)
 */
const apiLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 min
  max: 30,
  message: { error: 'Za dużo żądań API. Poczekaj chwilę.' }
});

/**
 * Rate limit dla panelu admina
 */
const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Zbyt wiele prób logowania. Spróbuj za 15 minut.' }
});

/**
 * Konfiguracja Helmet — nagłówki bezpieczeństwa HTTP
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
  crossOriginEmbedderPolicy: false, // Wymagane dla Google Maps embed
  // Not helmet's default `no-referrer`: under it browsers send `Origin: null` on every form POST, and the same-origin
  // check (sameOrigin.js) would refuse all of them. `same-origin` still sends no Referer to other sites.
  referrerPolicy: { policy: 'same-origin' }
});

/**
 * Sanityzuje prosty tekst — usuwa tagi HTML.
 * Does not cut the length: each route enforces its own limit (a class description may be 1000 characters),
 * and express.json/urlencoded already cap the body at 10 kB.
 */
function sanitizeText(str) {
  if (!str || typeof str !== 'string') return '';
  return str.replace(/<[^>]*>/g, '').trim();
}

/**
 * Middleware sanityzujący body requesta
 */
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
