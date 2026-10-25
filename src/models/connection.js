/**
 * connection.js — the SQLite connection: opens the file (WAL mode, foreign keys), runs the migrations and the
 * start-up clean-up, and hands the connection to the models through getDb().
 *
 * Schema changes are numbered SQL files in src/migrations/, applied by src/migrations/runner.js.
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { runMigrations } = require('../migrations/runner');
const { hashIp, ipHashKey, isHashedIp } = require('../utils/ipHash');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/climbing-booking.db');

const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

let db;

/**
 * Monday 00:00:00 of the current week in local time, as 'YYYY-MM-DD HH:MM:SS': classes that start before it are
 * archived.
 */
function getMondayStr() {
  const now = new Date();
  const dayOfWeek = now.getDay() === 0 ? 7 : now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - (dayOfWeek - 1));
  monday.setHours(0, 0, 0, 0);
  const tzOff = monday.getTimezoneOffset() * 60000;
  return new Date(monday.getTime() - tzOff).toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * qr_scans used to keep the visitor's IP address in clear. Replaces what is left of those with their keyed hash
 * (utils/ipHash.js); rows already hashed are left alone, so this is a no-op after the first start.
 */
function hashStoredQrIps(db) {
  if (!ipHashKey()) return;
  const rows = db.prepare("SELECT id, ip FROM qr_scans WHERE ip IS NOT NULL AND ip <> ''").all()
    .filter(row => !isHashedIp(row.ip));
  if (!rows.length) return;
  const update = db.prepare('UPDATE qr_scans SET ip = ? WHERE id = ?');
  db.transaction(() => rows.forEach(row => update.run(hashIp(row.ip), row.id)))();
  console.log(`  ↳ qr_scans: replaced ${rows.length} stored IP address(es) with their hash.`);
}

/** Opens the database, brings the schema up to date and archives the classes of past weeks. Call once at start. */
function initDatabase() {
  db = new Database(DB_PATH);

  // WAL lets readers proceed while a write is in progress. SQLite leaves foreign keys off unless asked, per connection;
  // the schema relies on them for its ON DELETE CASCADE / SET NULL rules.
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  runMigrations(db);
  hashStoredQrIps(db);

  console.log('✅ Baza danych SQLite zainicjalizowana:', DB_PATH);

  // app.js repeats this every 24 hours, the first time a day after launch; running it here covers every start.
  const archived = db.prepare(
    "UPDATE classes SET is_archived = 1 WHERE start_time < ? AND is_archived = 0"
  ).run(getMondayStr());

  if (archived.changes > 0) {
    console.log(`  ↳ Czyszczenie: zarchiwizowano automatycznie ${archived.changes} zajęć z poprzednich tygodni.`);
  }

  return db;
}

/** The open connection; throws when initDatabase() has not run. */
function getDb() {
  if (!db) throw new Error('Baza danych nie została zainicjalizowana');
  return db;
}


module.exports = { initDatabase, getDb, getMondayStr };
