const { safeJson } = require('../utils/safeJson');

describe('safeJson', () => {
  test('round-trips every value through JSON.parse', () => {
    const value = { name: 'A & B <i>', list: [1, null, 'x'], n: 3, nested: { ok: true } };
    expect(JSON.parse(safeJson(value))).toEqual(value);
  });

  test('a closing script tag in a string cannot end the element', () => {
    const out = safeJson({ name: '</script><script>alert(1)</script>' });
    expect(out).not.toMatch(/<\/?script/i);
    expect(JSON.parse(out).name).toBe('</script><script>alert(1)</script>');
  });

  test('escapes the JS line separators', () => {
    const out = safeJson('a\u2028b\u2029c');
    expect(out).not.toMatch(/[\u2028\u2029]/);
    expect(JSON.parse(out)).toBe('a\u2028b\u2029c');
  });

  test('undefined becomes null instead of throwing', () => {
    expect(safeJson(undefined)).toBe('null');
  });
});
