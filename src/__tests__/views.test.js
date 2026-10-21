/**
 * views.test.js — the attendance pages embed server data in <script> elements.
 * Hostile names must stay data and never become markup.
 */

'use strict';

process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-test-secret-test-secret-1234';
process.env.NODE_ENV = 'test';

const app = require('../app');
const { safeJson } = require('../utils/safeJson');

const HOSTILE = '</script><script>window.pwned=1</script>';

function render(view, extra = {}) {
  const locals = {
    title: 'Test',
    appName: 'Test',
    currentYear: 2026,
    safeJson,
    user: { is_admin: 1, is_instructor: 0 },
    success: null,
    error: null,
    classData: { id: 1, name: HOSTILE, start_time: '2026-10-20T10:00:00Z', max_spots: 10, max_child_spots: 5 },
    allParticipants: [{ first_name: HOSTILE, last_name: 'Kowalski', age_category: 'adult', is_main: 1, bookerEmail: 'a@example.com', birth_date: null }],
    bookings: [],
    ...extra
  };
  return new Promise((resolve, reject) => app.render(view, locals, (err, html) => (err ? reject(err) : resolve(html))));
}

/** Everything between the first and the last <script> of the page that mentions the hostile payload. */
function scriptBlocks(html) {
  return [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
}

describe.each(['admin/attendance', 'instructor/attendance'])('%s', view => {
  test('a hostile name cannot close the script element', async () => {
    const html = await render(view);
    expect(html).not.toContain('<script>window.pwned=1</script>');
    expect(scriptBlocks(html).join('\n')).not.toContain('</script');
  });

  test('the embedded data still parses to the original value', async () => {
    const html = await render(view);
    const data = scriptBlocks(html).join('\n');
    expect(data).toContain('\\u003c/script\\u003e');
  });
});
