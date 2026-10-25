-- Migration 004: family classes (adult_and_child) with separate adult and child pools of places, a second
-- instructor for the children, and each participant's age category and age.

ALTER TABLE classes ADD COLUMN class_type       TEXT    DEFAULT 'adult_only';
ALTER TABLE classes ADD COLUMN max_child_spots  INTEGER DEFAULT 0;
ALTER TABLE classes ADD COLUMN child_instructor TEXT;

ALTER TABLE participants ADD COLUMN age_category TEXT    DEFAULT 'adult';
ALTER TABLE participants ADD COLUMN age          INTEGER;
ALTER TABLE participants ADD COLUMN child_age    INTEGER;
