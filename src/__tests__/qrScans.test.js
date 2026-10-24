/**
 * qrScans.test.js — visits from the leaflet QR code are counted with a keyed hash of the IP address, never the
 * address itself, and addresses stored in clear by older versions are hashed on start.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const DB_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'qr-')), 'qr.db');
process.env.DB_PATH = DB_FILE;
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-test-secret-test-secret-1234';
process.env.NODE_ENV = 'test';
delete process.env.IP_HASH_SECRET;

const request = require('supertest');
const app = require('../app');
const { getDb, initDatabase } = require('../models/database');
const { hashIp } = require('../utils/ipHash');

const stored = () => getDb().prepare('SELECT ip, user_agent FROM qr_scans ORDER BY id').all();

beforeEach(() => getDb().prepare('DELETE FROM qr_scans').run());

test('GET /qr stores a 64-character keyed hash, not the IP address', async () => {
  await request(app).get('/qr').set('X-Forwarded-For', '203.0.113.7').set('User-Agent', 'TestBrowser/1.0');
  const [row] = stored();
  expect(row.ip).toMatch(/^[0-9a-f]{64}$/);
  expect(row.ip).not.toContain('203.0.113.7');
  expect(row.ip).toBe(hashIp('203.0.113.7'));
  expect(row.user_agent).toBe('TestBrowser/1.0');
});

test('the same address gives the same hash, another address or another key a different one', () => {
  expect(hashIp('203.0.113.7')).toBe(hashIp('203.0.113.7'));
  expect(hashIp('203.0.113.8')).not.toBe(hashIp('203.0.113.7'));
  expect(hashIp('203.0.113.7', { IP_HASH_SECRET: 'another-key-another-key-another-key-1' })).not.toBe(hashIp('203.0.113.7'));
});

test('without any key it refuses to store, instead of falling back to the address', () => {
  expect(() => hashIp('203.0.113.7', {})).toThrow('IP_HASH_SECRET');
  expect(hashIp('', {})).toBe('');
});

test('addresses stored in clear by older versions are replaced by their hash on start', () => {
  const insert = getDb().prepare('INSERT INTO qr_scans (ip, user_agent) VALUES (?, ?)');
  insert.run('198.51.100.23', 'Old');
  insert.run(hashIp('198.51.100.24'), 'Already hashed');
  insert.run('', 'No address');

  initDatabase(); // a restart: opens the same file again

  expect(stored()).toEqual([
    { ip: hashIp('198.51.100.23'), user_agent: 'Old' },
    { ip: hashIp('198.51.100.24'), user_agent: 'Already hashed' },
    { ip: '', user_agent: 'No address' }
  ]);
});

test('the privacy policy says how QR visits are recorded', async () => {
  const res = await request(app).get('/privacy');
  expect(res.text).toContain('HMAC-SHA-256');
});
