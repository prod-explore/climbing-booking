const { parseEmailList, isAdminEmail } = require('../utils/accounts');

describe('parseEmailList', () => {
  test('trims, lower-cases and drops invalid entries', () => {
    expect(parseEmailList(' A@x.pl , nope, b@y.pl ,, ')).toEqual(['a@x.pl', 'b@y.pl']);
  });
  test('empty or missing input gives an empty list', () => {
    expect(parseEmailList('')).toEqual([]);
    expect(parseEmailList(undefined)).toEqual([]);
  });
});

describe('isAdminEmail', () => {
  const env = { ADMIN_EMAILS: 'Owner@Example.com, boss@example.com' };
  test('matches a listed address whatever its case', () => {
    expect(isAdminEmail('owner@example.com', env)).toBe(true);
    expect(isAdminEmail('BOSS@example.com', env)).toBe(true);
  });
  test('refuses anything else, and everyone when the list is empty', () => {
    expect(isAdminEmail('someone@example.com', env)).toBe(false);
    expect(isAdminEmail(undefined, env)).toBe(false);
    expect(isAdminEmail('owner@example.com', {})).toBe(false);
  });
});
