-- Migration 011: users.terms_accepted_at records when the account holder accepted the terms and the privacy policy
-- (UTC, ISO 8601 text as JavaScript's toISOString() writes it; NULL until accepted).
--
-- A complete profile is the first and last name, the birth date and this timestamp (middleware/auth.js,
-- hasCompleteProfile). Until now the acceptance was required by the profile form but not stored. The birth date is
-- written only by that form, which refuses to save without the acceptance, so every account that has one has accepted
-- the terms. For those accounts the time of acceptance is unknown: the backfill uses the account's creation time, an
-- approximation (the profile is usually completed right after the first sign-in, but may have been later).

ALTER TABLE users ADD COLUMN terms_accepted_at TEXT;

UPDATE users SET terms_accepted_at = strftime('%Y-%m-%dT%H:%M:%fZ', COALESCE(created_at, CURRENT_TIMESTAMP))
WHERE birth_date IS NOT NULL;
