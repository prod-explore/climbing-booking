-- Migration 002: age category and birth date, account verification with a parental-consent request,
-- and the marketing consent.

ALTER TABLE users ADD COLUMN age_category      TEXT    DEFAULT NULL;
ALTER TABLE users ADD COLUMN is_verified       INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN consent_requested INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN birth_date        TEXT;
ALTER TABLE users ADD COLUMN marketing_consent INTEGER DEFAULT 0;
