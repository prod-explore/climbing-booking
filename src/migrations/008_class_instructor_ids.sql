-- Migration 008: classes point at instructor accounts.
--
-- Before this migration a class named its instructors in free text (instructor, child_instructor), and the
-- instructor panel matched that text against the instructor's first name with LIKE '%name%': "Jan" also saw
-- "Janina"'s classes. These columns hold the account; the text columns stay as the display name.
--
-- Existing rows are linked only where the match is unambiguous: the text equals (ignoring case and surrounding
-- spaces) the first name, or the first and last name, of exactly one instructor account. Anything else keeps its
-- text and no account until an administrator picks one in the class form.

ALTER TABLE classes ADD COLUMN instructor_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE classes ADD COLUMN child_instructor_id INTEGER REFERENCES users(id) ON DELETE SET NULL;

UPDATE classes
SET instructor_id = (
  SELECT u.id FROM users u
  WHERE u.is_instructor = 1
    AND (lower(trim(u.first_name)) = lower(trim(classes.instructor))
      OR lower(trim(u.first_name || ' ' || COALESCE(u.last_name, ''))) = lower(trim(classes.instructor)))
)
WHERE trim(COALESCE(instructor, '')) <> ''
  AND (
    SELECT COUNT(*) FROM users u
    WHERE u.is_instructor = 1
      AND (lower(trim(u.first_name)) = lower(trim(classes.instructor))
        OR lower(trim(u.first_name || ' ' || COALESCE(u.last_name, ''))) = lower(trim(classes.instructor)))
  ) = 1;

UPDATE classes
SET child_instructor_id = (
  SELECT u.id FROM users u
  WHERE u.is_instructor = 1
    AND (lower(trim(u.first_name)) = lower(trim(classes.child_instructor))
      OR lower(trim(u.first_name || ' ' || COALESCE(u.last_name, ''))) = lower(trim(classes.child_instructor)))
)
WHERE trim(COALESCE(child_instructor, '')) <> ''
  AND (
    SELECT COUNT(*) FROM users u
    WHERE u.is_instructor = 1
      AND (lower(trim(u.first_name)) = lower(trim(classes.child_instructor))
        OR lower(trim(u.first_name || ' ' || COALESCE(u.last_name, ''))) = lower(trim(classes.child_instructor)))
  ) = 1;

CREATE INDEX IF NOT EXISTS idx_classes_instructor_id ON classes(instructor_id);
CREATE INDEX IF NOT EXISTS idx_classes_child_instructor_id ON classes(child_instructor_id);
