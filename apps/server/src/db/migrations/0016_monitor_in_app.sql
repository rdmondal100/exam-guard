-- The Rust agent is gone: the student app monitors by itself (no service, no internet switch).
-- Its evidence is stored as source 'monitor'. SQLite can't change a CHECK, so events is rebuilt.
CREATE TABLE events_new (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  exam_id         TEXT NOT NULL REFERENCES exams (id) ON DELETE CASCADE,
  exam_student_id TEXT REFERENCES exam_students (id) ON DELETE CASCADE,
  type            TEXT NOT NULL,
  severity        TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  server_ts       INTEGER NOT NULL,
  client_ts       INTEGER,
  details_json    TEXT NOT NULL DEFAULT '{}',
  screenshot_path TEXT,
  source          TEXT NOT NULL CHECK (source IN ('monitor', 'app', 'server')),
  dedupe_key      TEXT,
  UNIQUE (dedupe_key)
);

INSERT INTO events_new (id, exam_id, exam_student_id, type, severity, server_ts, client_ts,
                        details_json, screenshot_path, source, dedupe_key)
  SELECT id, exam_id, exam_student_id, type, severity, server_ts, client_ts, details_json,
         screenshot_path, CASE source WHEN 'agent' THEN 'monitor' ELSE source END, dedupe_key
  FROM events;

DROP TABLE events;
ALTER TABLE events_new RENAME TO events;

CREATE INDEX idx_events_exam_ts ON events (exam_id, server_ts);
CREATE INDEX idx_events_student_ts ON events (exam_student_id, server_ts);
CREATE INDEX idx_events_severity ON events (exam_id, severity, server_ts);

-- The teacher's internet switch (0011) is gone.
ALTER TABLE exams DROP COLUMN internet_blocked;

-- Only the teacher locks a student now; a student the old agent lock caught stays locked by them.
UPDATE exam_students SET lock_reason = 'teacher' WHERE lock_reason = 'agent';
