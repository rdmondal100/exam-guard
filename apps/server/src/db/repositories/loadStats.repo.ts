import type { LoadHostCounts } from '@examguard/shared';
import type { Db } from '../connectDb.js';

/** Row counts of one exam, for the load test's loss check (M47, `scripts/load-host.ts`). */
export class LoadStatsRepo {
  constructor(private readonly db: Db) {}

  counts(examId: string): LoadHostCounts {
    const events = this.db
      .prepare(
        `SELECT COUNT(*) AS events,
           COALESCE(SUM(source = 'agent'), 0) AS agentEvents,
           COALESCE(SUM(screenshot_path IS NOT NULL), 0) AS withScreenshot
         FROM events WHERE exam_id = ?`,
      )
      .get(examId) as { events: number; agentEvents: number; withScreenshot: number };
    const versions = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM answer_versions v
           JOIN exam_students s ON s.id = v.exam_student_id WHERE s.exam_id = ?`,
      )
      .get(examId) as { n: number };
    const finals = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM final_answers f
           JOIN exam_students s ON s.id = f.exam_student_id WHERE s.exam_id = ?`,
      )
      .get(examId) as { n: number };
    return { ...events, answerVersions: versions.n, finalAnswers: finals.n };
  }
}
