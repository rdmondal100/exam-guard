import { z } from 'zod';
import { AnswerGradeStatusSchema } from './grading.js';
import { QuestionTypeSchema } from './questions.js';

/**
 * One question of a student's answer sheet (M65). `content` is the final answer once the student
 * is finalized, else the newest autosave (the selected language wins). Marks are whole marks here
 * (the database keeps half-units).
 */
export const StudentAnswerSchema = z.object({
  questionId: z.string(),
  position: z.number().int().positive(),
  type: QuestionTypeSchema,
  body: z.string(),
  maxMarks: z.number().nonnegative(),
  /** The language that counts (`text` for written answers); `null` with no answer yet. */
  language: z.string().nullable(),
  content: z.string(),
  answered: z.boolean(),
  /** When this version reached the server (server time), or `null` with no answer. */
  savedAt: z.number().nullable(),
  grade: z.object({ total: z.number().nullable(), status: AnswerGradeStatusSchema }).nullable(),
});
export type StudentAnswer = z.infer<typeof StudentAnswerSchema>;

/** `GET /exams/:id/students/:sid/answers`: every answer of one student, in question order. */
export const StudentAnswersResponseSchema = z.object({
  /** `final`: what was submitted (or finalized at the end); `latest`: the newest autosaves. */
  source: z.enum(['final', 'latest']),
  submittedAt: z.number().nullable(),
  receiptHash: z.string().nullable(),
  answers: z.array(StudentAnswerSchema),
});
export type StudentAnswersResponse = z.infer<typeof StudentAnswersResponseSchema>;
