-- M35: why a student is locked. 'agent' = the app lost its agent link (M24), 'teacher' = locked by the teacher.
ALTER TABLE exam_students ADD COLUMN lock_reason TEXT
  CHECK (lock_reason IS NULL OR lock_reason IN ('agent', 'teacher'));
