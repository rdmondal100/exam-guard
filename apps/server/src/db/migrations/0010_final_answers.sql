-- M18: a student's final answers, written once at submit, auto-submit or teacher end. Never updated.
CREATE TABLE final_answers (
  exam_student_id TEXT NOT NULL REFERENCES exam_students (id) ON DELETE CASCADE,
  question_id     TEXT NOT NULL REFERENCES questions (id) ON DELETE CASCADE,
  language        TEXT NOT NULL,             -- the selected language at submit; 'text' for written
  content         TEXT NOT NULL,             -- '' if never answered
  version_id      INTEGER REFERENCES answer_versions (id) ON DELETE SET NULL,
  sha256          TEXT NOT NULL,             -- hex SHA-256 of content
  submitted_at    INTEGER NOT NULL,
  PRIMARY KEY (exam_student_id, question_id)
);
