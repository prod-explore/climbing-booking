/**
 * config.test.js — startup checks for the secrets and the public URL.
 */

'use strict';

const { weakSecretReason, assertStrongSecret } = require('../utils/secrets');
const { appUrl } = require('../utils/appUrl');

describe('weakSecretReason', () => {
  test('refuses the placeholder shipped in .env.example', () => {
    const fromExample = require('fs')
      .readFileSync(require('path').join(__dirname, '../../.env.example'), 'utf8')
      .match(/^JWT_SECRET=(.*)$/m)[1];

    expect(weakSecretReason(fromExample)).not.toBeNull();
  });

  test('refuses short values and values with few distinct characters', () => {
    expect(weakSecretReason('abc123')).toMatch(/shorter/);
    expect(weakSecretReason('a'.repeat(64))).toMatch(/distinct/);
  });

  test('accepts a generated secret', () => {
    expect(weakSecretReason(require('crypto').randomBytes(32).toString('hex'))).toBeNull();
  });
});

describe('assertStrongSecret', () => {
  test('throws for a weak secret', () => {
    expect(() => assertStrongSecret('JWT_SECRET', 'short', {})).toThrow(/JWT_SECRET is too weak/);
  });

  test('only warns when ALLOW_WEAK_SECRETS is set', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => assertStrongSecret('JWT_SECRET', 'short', { ALLOW_WEAK_SECRETS: 'true' })).not.toThrow();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  test('leaves an unset value to the caller', () => {
    expect(() => assertStrongSecret('JWT_SECRET', undefined, {})).not.toThrow();
  });
});

describe('appUrl', () => {
  test('is required in production', () => {
    expect(() => appUrl({ NODE_ENV: 'production' })).toThrow(/APP_URL is not set/);
  });

  test('falls back to localhost outside production', () => {
    expect(appUrl({ NODE_ENV: 'development', PORT: '4000' })).toBe('http://localhost:4000');
  });

  test('drops a trailing slash so links do not get a double slash', () => {
    expect(appUrl({ APP_URL: 'https://booking.example.com/' })).toBe('https://booking.example.com');
  });

  test('refuses a value that is not an http(s) URL', () => {
    expect(() => appUrl({ APP_URL: 'booking.example.com' })).toThrow(/not a valid URL/);
    expect(() => appUrl({ APP_URL: 'ftp://booking.example.com' })).toThrow(/must start with/);
  });
});
