-- Migration 005: a calendar colour per class, and archiving, which hides a class without deleting its bookings.

ALTER TABLE classes ADD COLUMN color      TEXT    DEFAULT '#6366f1';
ALTER TABLE classes ADD COLUMN is_archived INTEGER DEFAULT 0;
