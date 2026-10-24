-- ============================================================
-- Migration 007 — Site settings
-- Dane, które identyfikują prowadzącego i obiekt (administrator danych, NIP, adres obiektu),
-- są ustawieniami edytowanymi w panelu admina, a nie tekstem w szablonach.
-- ============================================================

CREATE TABLE IF NOT EXISTS site_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
