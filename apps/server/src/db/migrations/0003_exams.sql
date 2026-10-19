CREATE TABLE exams (
  id                   TEXT PRIMARY KEY,
  title                TEXT NOT NULL,
  state                TEXT NOT NULL DEFAULT 'draft'
    CHECK (state IN ('draft', 'ready', 'hosting', 'running', 'ended', 'grading', 'in_review', 'finalized')),
  duration_sec         INTEGER NOT NULL,
  class_list_id        TEXT REFERENCES class_lists (id) ON DELETE RESTRICT,
  monitoring_json      TEXT NOT NULL,
  pin                  TEXT,
  global_extension_sec INTEGER NOT NULL DEFAULT 0,
  hosting_started_at   INTEGER,
  started_at           INTEGER,
  ended_at             INTEGER,
  finalized_at         INTEGER,
  created_at           INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL
);

CREATE INDEX idx_exams_state ON exams (state);
