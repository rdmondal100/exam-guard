-- M21b: the teacher's internet switch. 1 = student PCs may not reach the internet.
ALTER TABLE exams ADD COLUMN internet_blocked INTEGER NOT NULL DEFAULT 0
  CHECK (internet_blocked IN (0, 1));
