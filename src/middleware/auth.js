/**
 * auth.js — magic-link tokens, the signed session cookie, and the middleware that loads the user and guards routes.
 */

const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { UserModel, MagicTokenModel } = require('../models/database');
const { assertStrongSecret } = require('../utils/secrets');
const { appUrl } = require('../utils/appUrl');
const { withRoles } = require('../utils/accounts');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('FATAL: JWT_SECRET is not set in .env');
assertStrongSecret('JWT_SECRET', JWT_SECRET);

// Sessions are signed and checked with exactly one algorithm: a token signed any other way is not accepted.
const JWT_ALGORITHM = 'HS256';

/** 32 random bytes as hex: the one-time token of a login link. */
function generateMagicToken() {
  return crypto.randomBytes(32).toString('hex');
}

/** Stores a new token for the user, valid for 15 minutes, and returns it with the login link that carries it. */
function createMagicLink(userId) {
  const token = generateMagicToken();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  MagicTokenModel.create(userId, token, expiresAt);

  return { token, magicLink: `${appUrl()}/auth/verify?token=${token}` };
}

/**
 * The session JWT, valid for 90 days. It carries only the account id and e-mail, no role: loadUser reads the account
 * on every request and the admin role from ADMIN_EMAILS, so role and profile changes apply at once.
 */
function createSessionToken(user) {
  return jwt.sign(
    {
      userId: user.id,
      email: user.email
    },
    JWT_SECRET,
    { algorithm: JWT_ALGORITHM, expiresIn: '90d' }
  );
}

/**
 * Sets req.user from the session cookie, or null. Never refuses a request: the require* guards below do that.
 * `is_admin` comes from ADMIN_EMAILS at this request (utils/accounts.js), `is_instructor` from the account.
 * An invalid or expired token, or one whose account no longer exists, clears the cookie.
 */
function loadUser(req, res, next) {
  const token = req.cookies?.authToken;

  if (!token) {
    req.user = null;
    return next();
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET, { algorithms: [JWT_ALGORITHM] });
    const user = UserModel.findById(payload.userId);

    if (!user) {
      res.clearCookie('authToken');
      req.user = null;
    } else {
      req.user = withRoles(user);
    }
  } catch (err) {
    res.clearCookie('authToken');
    req.user = null;
  }

  next();
}

/** Requires a signed-in user: JSON clients get 401, browsers are sent to /login and back afterwards. */
function requireAuth(req, res, next) {
  if (!req.user) {
    if (req.headers.accept?.includes('application/json')) {
      return res.status(401).json({ error: 'Wymagane logowanie' });
    }
    return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
  }
  next();
}

/**
 * Requires a completed profile; otherwise sends the user to complete it. A participant's names are set only by the
 * profile form (with the birth date and the accepted terms); administrator and instructor accounts get theirs when they
 * are created.
 */
function requireProfile(req, res, next) {
  if (!req.user) return requireAuth(req, res, next);

  if (!req.user.first_name || !req.user.last_name) {
    return res.redirect('/profile/complete?next=' + encodeURIComponent(req.originalUrl));
  }
  next();
}

/** Requires an administrator; anyone else is sent to the admin login. */
function requireAdmin(req, res, next) {
  if (!req.user || !req.user.is_admin) {
    return res.redirect('/admin/login');
  }
  next();
}

/** Requires an instructor or an administrator. */
function requireInstructor(req, res, next) {
  if (!req.user || (!req.user.is_admin && !req.user.is_instructor)) {
    return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
  }
  next();
}

/** Sets the session cookie: HttpOnly, SameSite=Lax, Secure in production, as long-lived as the token. */
function setAuthCookie(res, user) {
  const token = createSessionToken(user);
  res.cookie('authToken', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 90 * 24 * 60 * 60 * 1000
  });
}

module.exports = {
  generateMagicToken,
  createMagicLink,
  createSessionToken,
  loadUser,
  requireAuth,
  requireProfile,
  requireAdmin,
  requireInstructor,
  setAuthCookie
};
