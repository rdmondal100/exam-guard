-- M15b: the teacher's exam terminal switch and the students' terminal transcripts.
ALTER TABLE exams ADD COLUMN terminal_enabled INTEGER NOT NULL DEFAULT 0
  CHECK (terminal_enabled IN (0, 1));
-- "On for N minutes" chosen before Start: counted from started_at, then cleared.
ALTER TABLE exams ADD COLUMN terminal_minutes INTEGER;
-- Server time the terminal turns off by itself; NULL = no end.
ALTER TABLE exams ADD COLUMN terminal_until INTEGER;

CREATE TABLE terminal_chunks (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  exam_student_id TEXT NOT NULL REFERENCES exam_students (id) ON DELETE CASCADE,
  chunk_key       TEXT NOT NULL,
  server_ts       INTEGER NOT NULL,
  client_ts       INTEGER,
  text            TEXT NOT NULL,
  UNIQUE (chunk_key)
);

CREATE INDEX idx_terminal_chunks_student ON terminal_chunks (exam_student_id, id);
