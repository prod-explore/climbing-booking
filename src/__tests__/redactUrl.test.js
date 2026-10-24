'use strict';

process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-test-secret-test-secret-1234';
process.env.NODE_ENV = 'test';

const morgan = require('morgan');
const { redactUrl } = require('../utils/redactUrl');

describe('redactUrl', () => {
  test('hides the login token wherever it is in the query string', () => {
    expect(redactUrl('/auth/verify?token=abc123')).toBe('/auth/verify?token=[redacted]');
    expect(redactUrl('/auth/verify?next=%2Fbook%2F3&token=abc123')).toBe('/auth/verify?next=%2Fbook%2F3&token=[redacted]');
    expect(redactUrl('/auth/verify?token=abc&next=/x')).toBe('/auth/verify?token=[redacted]&next=/x');
  });

  test('leaves other addresses alone', () => {
    expect(redactUrl('/calendar?week=1')).toBe('/calendar?week=1');
    expect(redactUrl('/book/3')).toBe('/book/3');
  });
});

test('the app registers it as the access log url token', () => {
  require('../app');
  const line = morgan.compile(':method :url')(morgan, { method: 'GET', url: '/auth/verify?token=secret', originalUrl: '/auth/verify?token=secret' }, {});
  expect(line).toBe('GET /auth/verify?token=[redacted]');
});
