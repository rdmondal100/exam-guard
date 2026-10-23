-- M15f: files the teacher attaches to an exam. The bytes live on disk under
-- <dataDir>/exam-files/<exam_id>/<id>; this table is the manifest students get.
-- Names are unique per exam without regard to case: a student's PC would treat Data.csv
-- and data.csv as one file.
CREATE TABLE exam_files (
  id         TEXT PRIMARY KEY,
  exam_id    TEXT NOT NULL REFERENCES exams (id) ON DELETE CASCADE,
  name       TEXT NOT NULL COLLATE NOCASE,
  size       INTEGER NOT NULL,
  sha256     TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (exam_id, name)
);

CREATE INDEX idx_exam_files_exam ON exam_files (exam_id, created_at);
