-- M53: a practice exam is hosted like a real one, but nothing is monitored, recorded or graded.
ALTER TABLE exams ADD COLUMN practice INTEGER NOT NULL DEFAULT 0
  CHECK (practice IN (0, 1));
