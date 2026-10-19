CREATE TABLE questions (
  id                     TEXT PRIMARY KEY,
  exam_id                TEXT NOT NULL REFERENCES exams (id) ON DELETE CASCADE,
  position               INTEGER NOT NULL,
  type                   TEXT NOT NULL CHECK (type IN ('code', 'written')),
  body                   TEXT NOT NULL,
  marks                  INTEGER NOT NULL,
  allowed_languages_json TEXT,
  student_note           TEXT NOT NULL DEFAULT '',
  sample_answer          TEXT NOT NULL DEFAULT '',
  sample_language        TEXT NOT NULL,
  ai_notes               TEXT NOT NULL DEFAULT '',
  UNIQUE (exam_id, position)
);

CREATE TABLE marking_criteria (
  id          TEXT PRIMARY KEY,
  question_id TEXT NOT NULL REFERENCES questions (id) ON DELETE CASCADE,
  position    INTEGER NOT NULL,
  name        TEXT NOT NULL,
  max_marks   INTEGER NOT NULL,
  UNIQUE (question_id, name)
);

CREATE INDEX idx_marking_criteria_question ON marking_criteria (question_id, position);
