import type { Confidence, Evaluation } from '@examguard/shared';
import type { Db } from '../connectDb.js';

/** A criterion as stored: marks in half-units. */
export interface StoredCriterion {
  name: string;
  max: number;
  awarded: number;
  reason: string;
}

export interface NewEvaluation {
  examStudentId: string;
  questionId: string;
  jobId: string | null;
  author: 'ai' | 'teacher';
  status: 'ok' | 'invalid' | 'error';
  /** Half-units. Empty unless `ok`. */
  criteria: readonly StoredCriterion[];
  /** Half-units; `null` unless `ok`. */
  total: number | null;
  feedback: string;
  teacherNotes: readonly { line: number; issue: string }[];
  confidence: Confidence | null;
  provider: string | null;
  model: string | null;
  promptVersion: string | null;
  instruction: string | null;
  rawResponse: string | null;
  problems: readonly string[];
  attempt: number;
  now: number;
}

interface EvaluationRow {
  id: number;
  job_id: string | null;
  author: 'ai' | 'teacher';
  status: 'ok' | 'invalid' | 'error';
  criteria_json: string;
  total: number | null;
  feedback: string;
  teacher_notes_json: string;
  confidence: Confidence | null;
  provider: string | null;
  model: string | null;
  prompt_version: string | null;
  instruction: string | null;
  raw_response: string | null;
  problems_json: string | null;
  attempt: number;
  created_at: number;
}

const half = (n: number) => n / 2;

/** The API view: marks as plain numbers (half-units / 2). */
function toEvaluation(row: EvaluationRow): Evaluation {
  const criteria = JSON.parse(row.criteria_json) as StoredCriterion[];
  return {
    id: row.id,
    jobId: row.job_id,
    author: row.author,
    status: row.status,
    criteria: criteria.map((c) => ({ ...c, max: half(c.max), awarded: half(c.awarded) })),
    total: row.total === null ? null : half(row.total),
    feedback: row.feedback,
    teacherNotes: JSON.parse(row.teacher_notes_json) as Evaluation['teacherNotes'],
    confidence: row.confidence,
    provider: row.provider,
    model: row.model,
    promptVersion: row.prompt_version,
    instruction: row.instruction,
    rawResponse: row.raw_response,
    problems: row.problems_json ? (JSON.parse(row.problems_json) as string[]) : [],
    attempt: row.attempt,
    createdAt: row.created_at,
  };
}

/** `evaluations`: append-only history of every AI attempt and every teacher edit (M38, M40). */
export class EvaluationRepo {
  constructor(private readonly db: Db) {}

  insert(e: NewEvaluation): number {
    const result = this.db
      .prepare(
        `INSERT INTO evaluations (exam_student_id, question_id, job_id, author, status,
           criteria_json, total, feedback, teacher_notes_json, confidence, provider, model,
           prompt_version, instruction, raw_response, problems_json, attempt, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        e.examStudentId,
        e.questionId,
        e.jobId,
        e.author,
        e.status,
        JSON.stringify(e.criteria),
        e.total,
        e.feedback,
        JSON.stringify(e.teacherNotes),
        e.confidence,
        e.provider,
        e.model,
        e.promptVersion,
        e.instruction,
        e.rawResponse,
        e.problems.length > 0 ? JSON.stringify(e.problems) : null,
        e.attempt,
        e.now,
      );
    return Number(result.lastInsertRowid);
  }

  get(id: number): Evaluation | undefined {
    const row = this.db.prepare('SELECT * FROM evaluations WHERE id = ?').get(id) as
      EvaluationRow | undefined;
    return row && toEvaluation(row);
  }

  /** The stored criteria of one evaluation, in half-units (for an accept that copies them). */
  storedCriteria(id: number): StoredCriterion[] | undefined {
    const row = this.db.prepare('SELECT criteria_json FROM evaluations WHERE id = ?').get(id) as
      { criteria_json: string } | undefined;
    return row && (JSON.parse(row.criteria_json) as StoredCriterion[]);
  }

  /** Every entry for one answer, oldest first. */
  history(examStudentId: string, questionId: string): Evaluation[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM evaluations WHERE exam_student_id = ? AND question_id = ? ORDER BY id`,
      )
      .all(examStudentId, questionId) as EvaluationRow[];
    return rows.map(toEvaluation);
  }

  /** How many attempts a job already made on one answer (a resumed job keeps counting). */
  attempts(jobId: string, examStudentId: string): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS n FROM evaluations WHERE job_id = ? AND exam_student_id = ?')
      .get(jobId, examStudentId) as { n: number };
    return row.n;
  }
}
