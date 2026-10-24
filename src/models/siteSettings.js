/**
 * siteSettings.js — the operator and venue details (see utils/siteSettings.js).
 */

const { getDb } = require('./connection');

const SiteSettingsModel = {
  /** Wszystkie zapisane ustawienia jako obiekt { klucz: wartość }. */
  all() {
    const rows = getDb().prepare('SELECT key, value FROM site_settings').all();
    return Object.fromEntries(rows.map(r => [r.key, r.value]));
  },

  /** Zapisuje komplet wartości w jednej transakcji; pusta wartość usuwa ustawienie. */
  saveAll(values) {
    const db = getDb();
    const upsert = db.prepare(
      `INSERT INTO site_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`
    );
    const remove = db.prepare('DELETE FROM site_settings WHERE key = ?');
    db.transaction(() => {
      for (const [key, value] of Object.entries(values)) {
        if (value) upsert.run(key, value);
        else remove.run(key);
      }
    })();
  }
};


module.exports = { SiteSettingsModel };
