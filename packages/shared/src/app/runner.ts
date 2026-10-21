import { z } from 'zod';
import { QuestionLanguageSchema } from '../protocol/questions.js';

/** Code-run limits, the same for everyone (requirements §8.3, architecture §4). */
export const RUN_LIMITS = {
  timeMs: 5_000,
  memoryMb: 256,
  outputBytes: 64 * 1024,
  processes: 8,
  cooldownMs: 2_000,
  /** The compiler gets more room than the student's program. */
  compileTimeMs: 15_000,
  compileMemoryMb: 1_024,
} as const;

export const MAX_RUN_CODE_CHARS = 200_000;
export const MAX_RUN_STDIN_CHARS = 64 * 1024;

/** Renderer → main `runner:run`. */
export const RunRequestSchema = z.object({
  questionId: z.string().min(1).max(100),
  language: QuestionLanguageSchema,
  code: z.string().max(MAX_RUN_CODE_CHARS),
  stdin: z.string().max(MAX_RUN_STDIN_CHARS),
});
export type RunRequest = z.infer<typeof RunRequestSchema>;

/** One compiler message, turned into a Monaco marker. Line and column are 1-based. */
export const DiagnosticSchema = z.object({
  line: z.number().int().min(1),
  col: z.number().int().min(1),
  severity: z.enum(['error', 'warning', 'note']),
  message: z.string(),
});
export type Diagnostic = z.infer<typeof DiagnosticSchema>;

export const RUN_STATUSES = [
  'ok',
  'compile_error',
  'time_limit',
  'memory_limit',
  'output_limit',
  'process_limit',
  'stopped',
  'failed',
  /** Refused: another run is still going. */
  'busy',
  /** Refused: too soon after the last run (`retryInMs`). */
  'cooldown',
] as const;
export const RunStatusSchema = z.enum(RUN_STATUSES);
export type RunStatus = z.infer<typeof RunStatusSchema>;

export const RunResultSchema = z.object({
  status: RunStatusSchema,
  /** The program's exit code; `null` if it never ran. */
  exitCode: z.number().int().nullable(),
  /** Run time of the program (not the compile). */
  timeMs: z.number().int().nonnegative().nullable(),
  stdout: z.string(),
  stderr: z.string(),
  compileOutput: z.string(),
  diagnostics: z.array(DiagnosticSchema),
  /** A plain-language reason for anything other than `ok`. */
  message: z.string(),
  retryInMs: z.number().int().nonnegative().optional(),
});
export type RunResult = z.infer<typeof RunResultSchema>;
