CREATE TABLE exam_students (
  id                TEXT PRIMARY KEY,
  exam_id           TEXT NOT NULL REFERENCES exams (id) ON DELETE CASCADE,
  class_student_id  TEXT NOT NULL REFERENCES class_students (id),
  anon_id           TEXT NOT NULL,
  state             TEXT NOT NULL DEFAULT 'not_joined'
    CHECK (state IN ('not_joined', 'lobby', 'active', 'locked', 'submitted', 'ended_by_teacher')),
  connected         INTEGER NOT NULL DEFAULT 0 CHECK (connected IN (0, 1)),
  token_hash        TEXT,
  device_id         TEXT,
  pinned_fp         TEXT,
  extension_sec     INTEGER NOT NULL DEFAULT 0,
  joined_at         INTEGER,
  started_at        INTEGER,
  submitted_at      INTEGER,
  last_seen_at      INTEGER,
  submission_hash   TEXT,
  risk_score        INTEGER NOT NULL DEFAULT 0,
  outside_ms_total  INTEGER NOT NULL DEFAULT 0,
  UNIQUE (exam_id, class_student_id),
  UNIQUE (token_hash)
);

CREATE INDEX idx_exam_students_state ON exam_students (exam_id, state);
CREATE INDEX idx_exam_students_risk ON exam_students (exam_id, risk_score DESC);

CREATE TABLE events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  exam_id         TEXT NOT NULL REFERENCES exams (id) ON DELETE CASCADE,
  exam_student_id TEXT REFERENCES exam_students (id) ON DELETE CASCADE,
  type            TEXT NOT NULL,
  severity        TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  server_ts       INTEGER NOT NULL,
  client_ts       INTEGER,
  details_json    TEXT NOT NULL DEFAULT '{}',
  screenshot_path TEXT,
  source          TEXT NOT NULL CHECK (source IN ('agent', 'app', 'server')),
  dedupe_key      TEXT,
  UNIQUE (dedupe_key)
);

CREATE INDEX idx_events_exam_ts ON events (exam_id, server_ts);
CREATE INDEX idx_events_student_ts ON events (exam_student_id, server_ts);
CREATE INDEX idx_events_severity ON events (exam_id, severity, server_ts);

CREATE TABLE teacher_actions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  exam_id         TEXT NOT NULL REFERENCES exams (id) ON DELETE CASCADE,
  exam_student_id TEXT REFERENCES exam_students (id) ON DELETE CASCADE,
  action          TEXT NOT NULL,
  payload_json    TEXT NOT NULL DEFAULT '{}',
  ts              INTEGER NOT NULL
);

CREATE INDEX idx_teacher_actions_exam_ts ON teacher_actions (exam_id, ts);
