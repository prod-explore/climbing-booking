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
