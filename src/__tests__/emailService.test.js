/**
 * emailService.test.js — without RESEND_API_KEY the app can still be tried locally: outside production the
 * messages are printed to the console. In production a missing key stays an error.
 */

'use strict';

function loadEmailService(env) {
  const saved = { ...process.env };
  delete process.env.RESEND_API_KEY;
  Object.assign(process.env, env);
  let service;
  jest.isolateModules(() => { service = require('../services/emailService'); });
  return { service, restore: () => { process.env = saved; } };
}

afterEach(() => jest.restoreAllMocks());

test('outside production, a login link is printed to the console instead of sent', async () => {
  const { service, restore } = loadEmailService({ NODE_ENV: 'development' });
  const log = jest.spyOn(console, 'log').mockImplementation(() => {});
  try {
    await expect(service.sendMagicLink('someone@example.com', 'http://localhost:3000/auth/verify?token=abc'))
      .resolves.toEqual({ id: 'console' });
    const printed = log.mock.calls.map(args => args.join(' ')).join('\n');
    expect(printed).toContain('someone@example.com');
    expect(printed).toContain('http://localhost:3000/auth/verify?token=abc');
  } finally {
    restore();
  }
});

test('in production, a missing RESEND_API_KEY is an error, and nothing is printed', async () => {
  const { service, restore } = loadEmailService({ NODE_ENV: 'production', APP_URL: 'https://club.example' });
  const log = jest.spyOn(console, 'log').mockImplementation(() => {});
  try {
    await expect(service.sendMagicLink('someone@example.com', 'https://club.example/auth/verify?token=abc'))
      .rejects.toThrow('RESEND_API_KEY');
    expect(log).not.toHaveBeenCalled();
  } finally {
    restore();
  }
});
