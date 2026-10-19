CREATE TABLE class_lists (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE class_students (
  id            TEXT PRIMARY KEY,
  class_list_id TEXT NOT NULL REFERENCES class_lists (id) ON DELETE CASCADE,
  student_code  TEXT NOT NULL,
  name          TEXT NOT NULL,
  UNIQUE (class_list_id, student_code)
);
