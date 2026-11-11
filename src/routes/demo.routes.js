/**
 * demo.routes.js — one-click sign-in of the demo instance. Mounted by app.js only when DEMO_MODE=true; otherwise
 * these paths do not exist.
 *
 * It signs in as one of the fixed demo accounts (utils/demoMode.js) with the same session cookie a login link sets,
 * so everything after it (role checks, guards, the panels) is the ordinary code. The same-origin check of app.js
 * covers the POST like every other state-changing route.
 */

const express = require('express');
const router = express.Router();

const { UserModel } = require('../models/database');
const { setAuthCookie } = require('../middleware/auth');
const { DEMO_ACCOUNTS, DEMO_LANDING } = require('../utils/demoMode');

router.post('/demo/login', (req, res) => {
  const { role } = req.body;

  if (typeof role !== 'string' || !Object.hasOwn(DEMO_ACCOUNTS, role)) {
    return res.status(400).render('user/error', {
      title: 'Błąd',
      code: 400,
      message: 'Nieznana rola demonstracyjna.',
      user: req.user
    });
  }

  // The nightly reset recreates the accounts in the same transaction that empties them, so they always exist.
  const user = UserModel.findByEmail(DEMO_ACCOUNTS[role]);
  UserModel.updateLastLogin(user.id);
  setAuthCookie(res, user);

  return res.redirect(DEMO_LANDING[role]);
});

module.exports = router;
