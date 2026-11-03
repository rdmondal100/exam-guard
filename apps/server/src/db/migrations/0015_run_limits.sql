-- M43: the run limits of an exam, copied from Settings when hosting starts (NULL = the defaults),
-- so a change in Settings reaches students at the next exam, never in the middle of one.
ALTER TABLE exams ADD COLUMN run_limits_json TEXT;
