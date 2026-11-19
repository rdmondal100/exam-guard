-- M58: the teacher pauses a running exam. paused_at is set while it is paused; paused_ms adds up
-- the finished pauses, and every deadline moves by it.
ALTER TABLE exams ADD COLUMN paused_at INTEGER;
ALTER TABLE exams ADD COLUMN paused_ms INTEGER NOT NULL DEFAULT 0 CHECK (paused_ms >= 0);
