-- M41: re-evaluate with an instruction. A re-evaluated answer keeps its current grade until the
-- new one arrives; `queued_job_id` names the reevaluate job that still has to grade it, so a
-- restart resumes it and a cancel leaves the old grade in place.
ALTER TABLE answer_grades ADD COLUMN queued_job_id TEXT REFERENCES grading_jobs (id) ON DELETE SET NULL;

CREATE INDEX idx_answer_grades_queued ON answer_grades (queued_job_id);
