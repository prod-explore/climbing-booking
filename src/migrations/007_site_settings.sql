-- Migration 007: site settings. The details that identify the operator and the venue (data controller, NIP,
-- venue address) are settings edited in the admin panel, not text in the templates.

CREATE TABLE IF NOT EXISTS site_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
