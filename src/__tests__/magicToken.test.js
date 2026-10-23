/**
 * magicToken.test.js — one-time login tokens, on the real model.
 */

'use strict';

process.env.DB_PATH = ':memory:';
process.env.NODE_ENV = 'test';

const { initDatabase, getDb, UserModel, MagicTokenModel } = require('../models/database');

let seq = 0;
function makeUser() {
  return UserModel.create(`token${++seq}@example.com`, 'Jan', 'Kowalski').lastInsertRowid;
}

const inMinutes = (m) => new Date(Date.now() + m * 60 * 1000).toISOString();

beforeAll(() => initDatabase());

describe('expiry', () => {
  test('a token is valid before it expires', () => {
    const userId = makeUser();
    MagicTokenModel.create(userId, 'fresh-token', inMinutes(15));

    expect(MagicTokenModel.findValid('fresh-token')).toBeDefined();
  });

  test('a token that expired a minute ago is refused, even on the same calendar day', () => {
    const userId = makeUser();
    MagicTokenModel.create(userId, 'expired-token', inMinutes(-1));

    expect(MagicTokenModel.findValid('expired-token')).toBeUndefined();
  });

  test('expired tokens are removed by cleanExpired, also those from today', () => {
    const userId = makeUser();
    MagicTokenModel.create(userId, 'old-token', inMinutes(-30));
    MagicTokenModel.create(userId, 'live-token', inMinutes(30));

    MagicTokenModel.cleanExpired();

    const left = getDb().prepare('SELECT token FROM magic_tokens WHERE user_id = ?').all(userId).map(r => r.token);
    expect(left).toEqual(['live-token']);
  });
});

describe('consume', () => {
  test('works once', () => {
    const userId = makeUser();
    MagicTokenModel.create(userId, 'once-token', inMinutes(15));

    expect(MagicTokenModel.consume('once-token')).toEqual(expect.objectContaining({ user_id: userId }));
    expect(MagicTokenModel.consume('once-token')).toBeUndefined();
  });

  test('refuses an expired token', () => {
    const userId = makeUser();
    MagicTokenModel.create(userId, 'late-token', inMinutes(-1));

    expect(MagicTokenModel.consume('late-token')).toBeUndefined();
  });

  test('refuses an unknown token', () => {
    expect(MagicTokenModel.consume('no-such-token')).toBeUndefined();
  });
});
