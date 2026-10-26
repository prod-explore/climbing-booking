-- Migration 009: participants.child_age goes; participants.age is the one age column.
--
-- Both columns were written with the same value since migration 004. Rows where only child_age is set (none are
-- expected) copy it into age first, so no age is lost.

UPDATE participants SET age = child_age WHERE age IS NULL AND child_age IS NOT NULL;

ALTER TABLE participants DROP COLUMN child_age;
