const { parseEmailList, parseInstructors } = require('../utils/accounts');

describe('parseEmailList', () => {
  test('trims, lower-cases and drops invalid entries', () => {
    expect(parseEmailList(' A@x.pl , nope, b@y.pl ,, ')).toEqual(['a@x.pl', 'b@y.pl']);
  });
  test('empty or missing input gives an empty list', () => {
    expect(parseEmailList('')).toEqual([]);
    expect(parseEmailList(undefined)).toEqual([]);
  });
});

describe('parseInstructors', () => {
  test('parses "email:Name" pairs', () => {
    expect(parseInstructors('anna@x.pl:Anna, Jan@y.pl:Jan')).toEqual([
      { email: 'anna@x.pl', firstName: 'Anna' },
      { email: 'jan@y.pl', firstName: 'Jan' },
    ]);
  });
  test('skips entries without a name or with a bad address', () => {
    expect(parseInstructors('anna@x.pl, :Bob, bad:Eve, ok@x.pl:Zed')).toEqual([{ email: 'ok@x.pl', firstName: 'Zed' }]);
  });
  test('missing input gives an empty list', () => {
    expect(parseInstructors(undefined)).toEqual([]);
  });
});
