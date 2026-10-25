-- Migration 003: the instructor role.

ALTER TABLE users ADD COLUMN is_instructor INTEGER DEFAULT 0;
