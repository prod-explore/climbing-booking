/**
 * sameOrigin.js — CSRF defence for cookie-authenticated, state-changing requests.
 *
 * The session cookie is SameSite=Lax, which already keeps browsers from sending it on
 * cross-site POSTs. This adds a second, independent check at the server: a POST, PUT,
 * PATCH or DELETE that names an Origin (or, failing that, a Referer) must name this host.
 *
 * Requests that carry neither header are let through: browsers always send Origin on
 * cross-origin writes, so only non-browser clients (curl, health checks, tests) omit both,
 * and they have no ambient cookie to abuse.
 */

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function hostOf(value) {
  try {
    return new URL(value).host;
  } catch {
    return null;
  }
}

function requireSameOrigin(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();

  const source = req.get('origin') || req.get('referer');
  if (!source) return next();

  if (hostOf(source) === req.get('host')) return next();

  console.warn(`Rejected cross-origin ${req.method} ${req.path} from ${source}`);
  res.status(403).type('text/plain').send('Forbidden: cross-origin request');
}

module.exports = { requireSameOrigin };
