-- Migration 011: users.terms_accepted records that the account holder accepted the terms and the privacy policy.
--
-- A complete profile is the first and last name, the birth date and this flag (middleware/auth.js, hasCompleteProfile).
-- Until now the acceptance was required by the profile form but not stored. The birth date is written only by that
-- form, which refuses to save without the acceptance, so every account that has one has accepted the terms.

ALTER TABLE users ADD COLUMN terms_accepted INTEGER NOT NULL DEFAULT 0;

UPDATE users SET terms_accepted = 1 WHERE birth_date IS NOT NULL;
