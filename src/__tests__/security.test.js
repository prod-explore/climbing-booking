/**
 * security.test.js — the rate limiters must construct without validation errors. express-rate-limit 8 rejects a custom
 * keyGenerator that uses req.ip without the IPv6 helper, which would stop the application at startup.
 */

'use strict';

process.env.NODE_ENV = 'test';

describe('security middleware', () => {
  test('loads and exposes every limiter', () => {
    const security = require('../middleware/security');
    for (const name of ['generalLimiter', 'magicLinkLimiter', 'apiLimiter', 'adminLoginLimiter']) {
      expect(typeof security[name]).toBe('function');
    }
  });
});

describe('minutesPl', () => {
  test('uses the Polish plural forms after "za"', () => {
    expect([1, 2, 4, 5, 12, 14, 15, 22, 25, 60].map(require('../middleware/security').minutesPl)).toEqual([
      '1 minutę', '2 minuty', '4 minuty', '5 minut', '12 minut', '14 minut', '15 minut', '22 minuty', '25 minut', '60 minut'
    ]);
  });
});
