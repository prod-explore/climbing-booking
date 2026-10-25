/**
 * migrations/runner.js — applies the numbered SQL migrations in this directory.
 *
 * Files named NNN_description.sql run in order of their three-digit prefix. Each one that is not yet recorded in
 * `schema_migrations` runs in its own transaction and is recorded in it; an unexpected error stops the start-up.
 * A schema change is a new file with the next number; the SQL of an applied file is never changed, as it will not
 * run again.
 */

const fs   = require('fs');
const path = require('path');

const MIGRATIONS_DIR = __dirname;

/**
 * Applies every migration not yet recorded in `schema_migrations`.
 * @param {import('better-sqlite3').Database} db  an open connection
 */
function runMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      filename   TEXT    UNIQUE NOT NULL,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // The prefix is zero-padded, so sorting the names sorts the numbers.
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter(f => /^\d{3}_.*\.sql$/.test(f))
    .sort();

  const applied = new Set(
    db.prepare('SELECT filename FROM schema_migrations').all().map(r => r.filename)
  );

  let count = 0;

  for (const filename of files) {
    if (applied.has(filename)) continue;

    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, filename), 'utf8');

    const migrate = db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (filename) VALUES (?)').run(filename);
    });

    try {
      migrate();
      console.log(`  ↳ Migracja [OK]: ${filename}`);
      count++;
    } catch (err) {
      console.error(`  ✖ Migracja [BŁĄD]: ${filename}`);
      console.error(`    ${err.message}`);
      // Databases whose schema was changed by hand before this runner existed already have some of these tables and
      // columns. Such a migration is recorded as applied instead of stopping the start-up.
      if (
        err.message.includes('already exists') ||
        err.message.includes('duplicate column')
      ) {
        db.prepare('INSERT OR IGNORE INTO schema_migrations (filename) VALUES (?)').run(filename);
        console.log(`    → Zignorowano (kolumna/tabela już istnieje), oznaczono jako wykonaną.`);
      } else {
        throw err;
      }
    }
  }

  if (count > 0) {
    console.log(`✅ Migracje: zastosowano ${count} nowych.`);
  } else {
    console.log('✅ Migracje: baza aktualna, brak nowych migracji.');
  }
}

module.exports = { runMigrations };
