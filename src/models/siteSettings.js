/**
 * siteSettings.js — the operator and venue details (see utils/siteSettings.js).
 */

const { getDb } = require('./connection');

const SiteSettingsModel = {
  /** Every stored setting as { key: value }. */
  all() {
    const rows = getDb().prepare('SELECT key, value FROM site_settings').all();
    return Object.fromEntries(rows.map(r => [r.key, r.value]));
  },

  /** Saves all the given values in one transaction; an empty value deletes the setting. */
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
