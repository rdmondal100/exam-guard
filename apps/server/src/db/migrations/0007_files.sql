-- M15e: the teacher's switch for the student Files panel (the project folder explorer).
ALTER TABLE exams ADD COLUMN files_enabled INTEGER NOT NULL DEFAULT 1
  CHECK (files_enabled IN (0, 1));
