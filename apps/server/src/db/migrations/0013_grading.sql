-- M38: AI grading. One job per question per run; every attempt and every teacher edit is an
-- evaluations row (append-only); answer_grades holds the current grade of each final answer.
CREATE TABLE grading_jobs (
  id              TEXT PRIMARY KEY,
  exam_id         TEXT NOT NULL REFERENCES exams (id) ON DELETE CASCADE,
  question_id     TEXT NOT NULL REFERENCES questions (id) ON DELETE CASCADE,
  kind            TEXT NOT NULL CHECK (kind IN ('initial', 'reevaluate')),
  instruction     TEXT,
  scope_json      TEXT NOT NULL DEFAULT '[]',   -- the exam_student ids this job grades
  state           TEXT NOT NULL DEFAULT 'queued'
    CHECK (state IN ('queued', 'running', 'done', 'failed', 'cancelled')),
  total           INTEGER NOT NULL DEFAULT 0,
  done_count      INTEGER NOT NULL DEFAULT 0,
  failed_count    INTEGER NOT NULL DEFAULT 0,
  error           TEXT,                         -- why a failed job stopped (e.g. a refused key)
  position        INTEGER NOT NULL,             -- order in the run (question order)
  provider        TEXT NOT NULL,
  model           TEXT NOT NULL,
  prompt_version  TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  finished_at     INTEGER
);

CREATE INDEX idx_grading_jobs_exam ON grading_jobs (exam_id, state);

CREATE TABLE evaluations (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  exam_student_id     TEXT NOT NULL REFERENCES exam_students (id) ON DELETE CASCADE,
  question_id         TEXT NOT NULL REFERENCES questions (id) ON DELETE CASCADE,
  job_id              TEXT REFERENCES grading_jobs (id) ON DELETE SET NULL,
  author              TEXT NOT NULL CHECK (author IN ('ai', 'teacher')),
  status              TEXT NOT NULL CHECK (status IN ('ok', 'invalid', 'error')),
  criteria_json       TEXT NOT NULL DEFAULT '[]',   -- [{name,max,awarded,reason}], half-units
  total               INTEGER,                      -- half-units; NULL unless status = 'ok'
  feedback            TEXT NOT NULL DEFAULT '',
  teacher_notes_json  TEXT NOT NULL DEFAULT '[]',   -- [{line,issue}]
  confidence          TEXT CHECK (confidence IS NULL OR confidence IN ('high', 'medium', 'low')),
  provider            TEXT,
  model               TEXT,
  prompt_version      TEXT,
  instruction         TEXT,
  raw_response        TEXT,                         -- the model's text, or the error message
  problems_json       TEXT,                         -- why an 'invalid' reply was refused
  attempt             INTEGER NOT NULL DEFAULT 1,
  created_at          INTEGER NOT NULL
);

CREATE INDEX idx_evaluations_answer ON evaluations (exam_student_id, question_id, id DESC);
CREATE INDEX idx_evaluations_job ON evaluations (job_id);

CREATE TABLE answer_grades (
  exam_student_id       TEXT NOT NULL,
  question_id           TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'ai_graded', 'verified', 'modified', 'needs_manual')),
  current_evaluation_id INTEGER REFERENCES evaluations (id) ON DELETE SET NULL,
  total                 INTEGER,                    -- half-units, from the current evaluation
  confidence            TEXT,                       -- from the current evaluation
  updated_at            INTEGER NOT NULL,
  PRIMARY KEY (exam_student_id, question_id),
  FOREIGN KEY (exam_student_id, question_id)
    REFERENCES final_answers (exam_student_id, question_id) ON DELETE CASCADE
);

CREATE INDEX idx_answer_grades_question ON answer_grades (question_id, status);
