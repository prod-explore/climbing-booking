/**
 * connection.js — the SQLite connection: opens the file (WAL mode, foreign keys), runs the migrations and the
 * start-up clean-up, and hands the connection to the models through getDb().
 *
 * Migracje obsługiwane przez wersjonowany runner: src/migrations/runner.js
 * Aby dodać zmianę schematu: utwórz kolejny plik 00N_opis.sql w src/migrations/
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { runMigrations } = require('../migrations/runner');
const { hashIp, ipHashKey, isHashedIp } = require('../utils/ipHash');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/climbing-booking.db');

// Upewnij się, że katalog danych istnieje
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

let db;

/**
 * Zwraca string 'YYYY-MM-DD HH:MM:SS' odpowiadający poniedziałkowi bieżącego tygodnia o 00:00:00
 * w lokalnej strefie czasowej — używany jako granica archiwizacji zajęć.
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

/**
 * Inicjalizuje połączenie z bazą i tworzy tabele jeśli nie istnieją
 */
function initDatabase() {
  db = new Database(DB_PATH);

  // WAL mode — lepsza wydajność przy równoczesnych odczytach
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Uruchom wersjonowany system migracji
  // Każda zmiana schematu = nowy plik src/migrations/00N_opis.sql
  runMigrations(db);
  hashStoredQrIps(db);

  console.log('✅ Baza danych SQLite zainicjalizowana:', DB_PATH);

  // Automatycznie zarchiwizuj zajęcia z poprzednich tygodni przy starcie
  const archived = db.prepare(
    "UPDATE classes SET is_archived = 1 WHERE start_time < ? AND is_archived = 0"
  ).run(getMondayStr());

  if (archived.changes > 0) {
    console.log(`  ↳ Czyszczenie: zarchiwizowano automatycznie ${archived.changes} zajęć z poprzednich tygodni.`);
  }

  return db;
}

function getDb() {
  if (!db) throw new Error('Baza danych nie została zainicjalizowana');
  return db;
}


module.exports = { initDatabase, getDb, getMondayStr };
