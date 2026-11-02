import type { GradingJob, GradingJobState } from '@examguard/shared';
import type { Db } from '../connectDb.js';

interface JobRow {
  id: string;
  exam_id: string;
  question_id: string;
  question_position: number;
  kind: 'initial' | 'reevaluate';
  instruction: string | null;
  scope_json: string;
  state: GradingJobState;
  total: number;
  done_count: number;
  failed_count: number;
  error: string | null;
  provider: string;
  model: string;
  prompt_version: string;
  created_at: number;
  finished_at: number | null;
}

/** A job as the pipeline needs it: the API view plus what to grade and how. */
export interface JobRecord extends GradingJob {
  examId: string;
  instruction: string | null;
  /** The exam_student ids this job grades. */
  scope: string[];
  promptVersion: string;
}

export interface NewJob {
  id: string;
  examId: string;
  questionId: string;
  kind: 'initial' | 'reevaluate';
  instruction: string | null;
  scope: readonly string[];
  position: number;
  provider: string;
  model: string;
  promptVersion: string;
  now: number;
}

const SELECT = `SELECT j.*, q.position AS question_position FROM grading_jobs j
  JOIN questions q ON q.id = j.question_id`;

function toRecord(row: JobRow): JobRecord {
  return {
    id: row.id,
    examId: row.exam_id,
    questionId: row.question_id,
    questionPosition: row.question_position,
    kind: row.kind,
    state: row.state,
    total: row.total,
    done: row.done_count,
    failed: row.failed_count,
    error: row.error,
    provider: row.provider,
    model: row.model,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
    instruction: row.instruction,
    scope: JSON.parse(row.scope_json) as string[],
    promptVersion: row.prompt_version,
  };
}

/** `grading_jobs`: one row per question per grading run (M38). */
export class GradingJobRepo {
  constructor(private readonly db: Db) {}

  insert(job: NewJob): void {
    this.db
      .prepare(
        `INSERT INTO grading_jobs (id, exam_id, question_id, kind, instruction, scope_json, total,
           position, provider, model, prompt_version, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        job.id,
        job.examId,
        job.questionId,
        job.kind,
        job.instruction,
        JSON.stringify(job.scope),
        job.scope.length,
        job.position,
        job.provider,
        job.model,
        job.promptVersion,
        job.now,
      );
  }

  get(id: string): JobRecord | undefined {
    const row = this.db.prepare(`${SELECT} WHERE j.id = ?`).get(id) as JobRow | undefined;
    return row && toRecord(row);
  }

  /** Jobs still to run or running, oldest first: the queue, also after a restart. */
  unfinished(examId?: string): JobRecord[] {
    const rows = this.db
      .prepare(
        `${SELECT} WHERE j.state IN ('queued', 'running') ${examId ? 'AND j.exam_id = ?' : ''}
           ORDER BY j.created_at, j.position`,
      )
      .all(...(examId ? [examId] : [])) as JobRow[];
    return rows.map(toRecord);
  }

  /** The latest job of each question of the exam, in question order. */
  latestPerQuestion(examId: string): JobRecord[] {
    const rows = this.db
      .prepare(
        `${SELECT} WHERE j.exam_id = ? AND j.rowid = (
           SELECT j2.rowid FROM grading_jobs j2 WHERE j2.question_id = j.question_id
             ORDER BY j2.created_at DESC, j2.rowid DESC LIMIT 1)
           ORDER BY q.position`,
      )
      .all(examId) as JobRow[];
    return rows.map(toRecord);
  }

  setState(id: string, state: GradingJobState, now: number, error: string | null = null): void {
    const finished = state === 'done' || state === 'failed' || state === 'cancelled';
    this.db
      .prepare(
        `UPDATE grading_jobs SET state = ?, error = COALESCE(?, error), finished_at = ?
           WHERE id = ?`,
      )
      .run(state, error, finished ? now : null, id);
  }

  /** Counts one finished answer: graded (`ok`) or given up on. */
  countAnswer(id: string, ok: boolean): void {
    this.db
      .prepare(
        `UPDATE grading_jobs SET ${ok ? 'done_count = done_count + 1' : 'failed_count = failed_count + 1'}
           WHERE id = ?`,
      )
      .run(id);
  }

  /** Every unfinished job of the exam becomes `cancelled`. Returns how many. */
  cancelExam(examId: string, now: number): number {
    return this.db
      .prepare(
        `UPDATE grading_jobs SET state = 'cancelled', finished_at = ?
           WHERE exam_id = ? AND state IN ('queued', 'running')`,
      )
      .run(now, examId).changes;
  }
}
