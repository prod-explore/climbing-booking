-- Migration 010: users.age_category goes.
--
-- Accounts are held from 16 up and every account holder takes an adult place, so the column no longer decided anything.
-- A completed profile is now known from the first and last name (middleware/auth.js, requireProfile). Participants keep
-- their own age_category (adult or child place), which this migration does not touch.

ALTER TABLE users DROP COLUMN age_category;
