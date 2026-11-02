import type { QuestionLanguage, QuestionType } from '@examguard/shared';

/**
 * What the AI sees for one answer (requirements §8.9). Never the student's name or code: only
 * the exam student's anonymous id. Marks here are the teacher's numbers (steps of 0.5).
 */
export interface GradingInput {
  anonId: string;
  question: {
    type: QuestionType;
    body: string;
    allowedLanguages: QuestionLanguage[];
    /** The teacher's note to students, e.g. "use recursion"; the answer is checked against it. */
    studentNote: string;
    marks: number;
    sampleAnswer: string;
    sampleLanguage: string;
    /** Notes only the AI sees. */
    aiNotes: string;
    criteria: { name: string; maxMarks: number }[];
  };
  answer: {
    /** The language the student used; `null` for a written answer. */
    language: QuestionLanguage | null;
    content: string;
  };
}

/** Extra text for one attempt: a re-evaluation instruction (M41) or a repair hint after invalid output. */
export interface GradingOptions {
  instruction?: string;
  repairHint?: string;
  signal?: AbortSignal;
}

/** One provider reply: the raw text (validated by `validate.ts`) and token use when known. */
export interface ProviderResult {
  text: string;
  usage?: { inputTokens?: number; outputTokens?: number };
}

/** A grading backend (docs/architecture.md §7). Gemini first; tests use the fake. */
export interface GradingProvider {
  /** Stored with each evaluation, e.g. `gemini`. */
  readonly id: string;
  readonly model: string;
  gradeAnswer(input: GradingInput, options?: GradingOptions): Promise<ProviderResult>;
}

/** Why a call failed, which decides whether the pipeline (M38) retries it. */
export type ProviderErrorKind = 'rate_limit' | 'server' | 'auth' | 'bad_request' | 'network';

export class ProviderError extends Error {
  constructor(
    readonly kind: ProviderErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ProviderError';
  }

  /** 429, 5xx and network failures are worth a retry with backoff; a bad key or request is not. */
  get retryable(): boolean {
    return this.kind === 'rate_limit' || this.kind === 'server' || this.kind === 'network';
  }
}

/** Maps an HTTP status to the error kind. */
export function errorKindForStatus(status: number | undefined): ProviderErrorKind {
  if (status === undefined) return 'network';
  if (status === 429) return 'rate_limit';
  if (status === 401 || status === 403) return 'auth';
  if (status >= 500) return 'server';
  return 'bad_request';
}
