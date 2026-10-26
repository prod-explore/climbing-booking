'use strict';

const { startupMessage } = require('../utils/startupMessage');

test('the startup line names the port, the public address and the environment, and nothing about one client', () => {
  const line = startupMessage({ port: 3000, url: 'https://club.example', env: 'production' });
  expect(line).toContain('3000');
  expect(line).toContain('https://club.example');
  expect(line).toContain('production');
  expect(line).not.toMatch(/dofinansowan|UE\b|Unii/i);
});

test('the startup line names the time zone the class times are read in', () => {
  const line = startupMessage({ port: 3000, url: 'https://club.example', env: 'production' });
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  expect(line).toMatch(new RegExp(`time zone ${zone.replace('/', '\\/')}, UTC[+-]\\d{2}:\\d{2}$`));
});

test('docker-compose.yml passes TZ from .env, defaulting to Europe/Warsaw', () => {
  const compose = require('fs').readFileSync(require('path').join(__dirname, '../../docker-compose.yml'), 'utf8');
  expect(compose).toMatch(/^\s+TZ: "?\$\{TZ:-Europe\/Warsaw\}"?\s*$/m);
});
