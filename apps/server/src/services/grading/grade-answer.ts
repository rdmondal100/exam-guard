import { QuestionLanguageSchema, type Question } from '@examguard/shared';
import type { AnswerGradeRepo, AnswerToGrade } from '../../db/repositories/answerGrade.repo.js';
import type { EvaluationRepo, NewEvaluation } from '../../db/repositories/evaluation.repo.js';
import { gradingInput } from './input.js';
import { PROMPT_VERSION } from './prompt.js';
import { ProviderError, type GradingProvider } from './provider.js';
import { repairHint, validateGrade } from './validate.js';

/** Retries after a 429, 5xx or network failure, with exponential backoff (architecture §7). */
export const MAX_TRANSIENT_RETRIES = 3;
/** Retries with a repair hint after an invalid reply; then the answer needs manual grading. */
export const MAX_REPAIR_RETRIES = 2;
export const BASE_BACKOFF_MS = 2000;

/** The key was refused: every other answer would fail the same way, so the job stops. */
export class GradingAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GradingAuthError';
  }
}

export interface GradeAnswerDeps {
  provider: GradingProvider;
  evaluations: EvaluationRepo;
  grades: AnswerGradeRepo;
  now: () => number;
  /** Waits between retries; rejects when `signal` aborts. */
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  backoffMs?: number;
}

export interface AnswerJob {
  id: string;
  instruction: string | null;
}

export type AnswerOutcome = 'graded' | 'needs_manual';

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Grades one final answer (docs/architecture.md §7). Every attempt is stored as an evaluation; a
 * valid reply makes the answer `ai_graded`, running out of retries makes it `needs_manual`.
 * Throws `GradingAuthError` on a refused key and rethrows when `signal` aborts (the answer stays
 * `pending` so a resumed job grades it again).
 */
export async function gradeAnswer(
  deps: GradeAnswerDeps,
  job: AnswerJob,
  question: Question,
  answer: AnswerToGrade,
  signal: AbortSignal,
): Promise<AnswerOutcome> {
  const { provider, evaluations, grades, now } = deps;
  const language = QuestionLanguageSchema.safeParse(answer.language);
  const input = gradingInput(question, answer.anonId, {
    language: question.type === 'code' && language.success ? language.data : null,
    content: answer.content,
  });
  const base = {
    examStudentId: answer.examStudentId,
    questionId: question.id,
    jobId: job.id,
    author: 'ai' as const,
    provider: provider.id,
    model: provider.model,
    promptVersion: PROMPT_VERSION,
    instruction: job.instruction,
  };
  const store = (e: Partial<NewEvaluation> & Pick<NewEvaluation, 'status' | 'attempt'>) =>
    evaluations.insert({
      ...base,
      criteria: [],
      total: null,
      feedback: '',
      teacherNotes: [],
      confidence: null,
      rawResponse: null,
      problems: [],
      now: now(),
      ...e,
    });
  const giveUp = (): AnswerOutcome => {
    grades.set(
      answer.examStudentId,
      question.id,
      { status: 'needs_manual', evaluationId: null, total: null, confidence: null },
      now(),
    );
    return 'needs_manual';
  };

  let attempt = evaluations.attempts(job.id, answer.examStudentId);
  let transient = 0;
  let repairs = 0;
  let hint: string | undefined;
  for (;;) {
    signal.throwIfAborted();
    attempt += 1;
    let text: string;
    try {
      const reply = await provider.gradeAnswer(input, {
        signal,
        ...(job.instruction ? { instruction: job.instruction } : {}),
        ...(hint ? { repairHint: hint } : {}),
      });
      text = reply.text;
    } catch (err) {
      signal.throwIfAborted();
      const kind = err instanceof ProviderError ? err.kind : 'error';
      store({ status: 'error', attempt, rawResponse: `${kind}: ${errorText(err)}` });
      if (err instanceof ProviderError && err.kind === 'auth') {
        throw new GradingAuthError(errorText(err));
      }
      if (err instanceof ProviderError && err.retryable && transient < MAX_TRANSIENT_RETRIES) {
        await deps.sleep((deps.backoffMs ?? BASE_BACKOFF_MS) * 2 ** transient, signal);
        transient += 1;
        continue;
      }
      return giveUp();
    }

    const check = validateGrade(text, question.criteria);
    if (check.ok) {
      const { grade } = check;
      const id = store({
        status: 'ok',
        attempt,
        rawResponse: text,
        criteria: grade.criteria,
        total: grade.total,
        feedback: grade.feedback,
        teacherNotes: grade.teacherNotes,
        confidence: grade.confidence,
      });
      grades.set(
        answer.examStudentId,
        question.id,
        { status: 'ai_graded', evaluationId: id, total: grade.total, confidence: grade.confidence },
        now(),
      );
      return 'graded';
    }
    store({ status: 'invalid', attempt, rawResponse: text, problems: check.problems });
    if (repairs >= MAX_REPAIR_RETRIES) return giveUp();
    repairs += 1;
    hint = repairHint(check.problems);
  }
}
