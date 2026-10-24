'use strict';

const { startupMessage } = require('../utils/startupMessage');

test('the startup line names the port, the public address and the environment, and nothing about one client', () => {
  const line = startupMessage({ port: 3000, url: 'https://club.example', env: 'production' });
  expect(line).toContain('3000');
  expect(line).toContain('https://club.example');
  expect(line).toContain('production');
  expect(line).not.toMatch(/dofinansowan|UE\b|Unii/i);
});
