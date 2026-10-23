-- M16: every autosave of a student's answer buffer, one row per version.
CREATE TABLE answer_versions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  exam_student_id TEXT NOT NULL REFERENCES exam_students (id) ON DELETE CASCADE,
  question_id     TEXT NOT NULL REFERENCES questions (id) ON DELETE CASCADE,
  language        TEXT NOT NULL,             -- 'text' for written answers
  content         TEXT NOT NULL,
  selected        INTEGER NOT NULL CHECK (selected IN (0, 1)),
  reason          TEXT NOT NULL
    CHECK (reason IN ('interval', 'run', 'switch_question', 'switch_language', 'submit', 'final')),
  flags           TEXT,                      -- the student's own compiler / Node flags
  client_seq      INTEGER NOT NULL,
  client_ts       INTEGER,
  server_ts       INTEGER NOT NULL,
  UNIQUE (exam_student_id, client_seq)
);

CREATE INDEX idx_answer_versions_key
  ON answer_versions (exam_student_id, question_id, language, id DESC);
