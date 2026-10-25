-- Migration 006: the waiting list, enabled and sized per class.

-- Adults only: one entry per user and class.
CREATE TABLE IF NOT EXISTS waiting_list (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  class_id   INTEGER NOT NULL,
  user_id    INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(class_id, user_id),
  FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id)  REFERENCES users(id)   ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_waiting_list_class_id ON waiting_list(class_id);
CREATE INDEX IF NOT EXISTS idx_waiting_list_user_id  ON waiting_list(user_id);

ALTER TABLE classes ADD COLUMN waiting_list_enabled INTEGER DEFAULT 0;

ALTER TABLE classes ADD COLUMN max_waiting_spots INTEGER DEFAULT 10;
