import { z } from 'zod';
import { ExamStateSchema } from './exams.js';

/** Where an answer's grade stands (docs/data-model.md `answer_grades`). */
export const AnswerGradeStatusSchema = z.enum([
  'pending',
  'ai_graded',
  'verified',
  'modified',
  'needs_manual',
]);
export type AnswerGradeStatus = z.infer<typeof AnswerGradeStatusSchema>;

export const GradingJobStateSchema = z.enum(['queued', 'running', 'done', 'failed', 'cancelled']);
export type GradingJobState = z.infer<typeof GradingJobStateSchema>;

export const ConfidenceSchema = z.enum(['high', 'medium', 'low']);
export type Confidence = z.infer<typeof ConfidenceSchema>;

/** Which grader the server uses: Gemini, or the dev-only fake (`EG_FAKE_GRADER=1`). */
export const GradingProviderIdSchema = z.enum(['gemini', 'fake']);
export type GradingProviderId = z.infer<typeof GradingProviderIdSchema>;

/** One question's job in a grading run. */
export const GradingJobSchema = z.object({
  id: z.string(),
  questionId: z.string(),
  questionPosition: z.number().int(),
  kind: z.enum(['initial', 'reevaluate']),
  state: GradingJobStateSchema,
  total: z.number().int().nonnegative(),
  done: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  /** Why a failed job stopped, e.g. the key was refused. */
  error: z.string().nullable(),
  provider: z.string(),
  model: z.string(),
  createdAt: z.number(),
  finishedAt: z.number().nullable(),
});
export type GradingJob = z.infer<typeof GradingJobSchema>;

/** How the answers to one question stand. */
export const QuestionGradeCountsSchema = z.object({
  questionId: z.string(),
  position: z.number().int(),
  answers: z.number().int().nonnegative(),
  pending: z.number().int().nonnegative(),
  aiGraded: z.number().int().nonnegative(),
  verified: z.number().int().nonnegative(),
  modified: z.number().int().nonnegative(),
  needsManual: z.number().int().nonnegative(),
  /** AI-graded answers the model was not sure about. */
  lowConfidence: z.number().int().nonnegative(),
});
export type QuestionGradeCounts = z.infer<typeof QuestionGradeCountsSchema>;

/** `GET /exams/:id/grading`, the answer of the start and cancel calls, and `grading.progress`. */
export const GradingStatusSchema = z.object({
  examId: z.string(),
  examState: ExamStateSchema,
  provider: GradingProviderIdSchema,
  /** The latest job of each question, in question order. */
  jobs: z.array(GradingJobSchema),
  questions: z.array(QuestionGradeCountsSchema),
});
export type GradingStatus = z.infer<typeof GradingStatusSchema>;

/** `POST /exams/:id/grading`: every question when `questionIds` is left out. */
export const GradingStartBodySchema = z.object({
  questionIds: z.array(z.string().min(1)).min(1).max(200).optional(),
});
export type GradingStartBody = z.infer<typeof GradingStartBodySchema>;

/** Marks the teacher sees: 0 or more, in steps of 0.5. */
export const AwardedMarksSchema = z
  .number()
  .min(0)
  .max(1000)
  .refine((n) => Number.isInteger(n * 2), 'Marks go in steps of 0.5');

export const GradedCriterionSchema = z.object({
  name: z.string(),
  max: z.number(),
  awarded: z.number(),
  reason: z.string(),
});
export type GradedCriterion = z.infer<typeof GradedCriterionSchema>;

export const TeacherNoteSchema = z.object({
  line: z.number().int().min(1),
  issue: z.string().trim().min(1).max(1000),
});
export type TeacherNote = z.infer<typeof TeacherNoteSchema>;

/** One history entry: an AI attempt or a teacher's accept/edit. Marks are plain numbers. */
export const EvaluationSchema = z.object({
  id: z.number().int(),
  jobId: z.string().nullable(),
  author: z.enum(['ai', 'teacher']),
  status: z.enum(['ok', 'invalid', 'error']),
  criteria: z.array(GradedCriterionSchema),
  total: z.number().nullable(),
  feedback: z.string(),
  teacherNotes: z.array(z.object({ line: z.number().int(), issue: z.string() })),
  confidence: ConfidenceSchema.nullable(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  promptVersion: z.string().nullable(),
  instruction: z.string().nullable(),
  /** The model's reply, or the error of a failed call. */
  rawResponse: z.string().nullable(),
  /** Why an `invalid` reply was refused. */
  problems: z.array(z.string()),
  attempt: z.number().int(),
  createdAt: z.number(),
});
export type Evaluation = z.infer<typeof EvaluationSchema>;

/** One row of the per-question review table (M39). */
export const ReviewRowSchema = z.object({
  examStudentId: z.string(),
  studentCode: z.string(),
  name: z.string(),
  language: z.string(),
  status: AnswerGradeStatusSchema,
  total: z.number().nullable(),
  confidence: ConfidenceSchema.nullable(),
  /** The student left the answer empty. */
  empty: z.boolean(),
  updatedAt: z.number(),
});
export type ReviewRow = z.infer<typeof ReviewRowSchema>;

/** `GET /exams/:id/review/:qid`, by student code. */
export const ReviewTableSchema = z.object({
  questionId: z.string(),
  position: z.number().int(),
  marks: z.number(),
  rows: z.array(ReviewRowSchema),
});
export type ReviewTable = z.infer<typeof ReviewTableSchema>;

export const AnswerGradeSchema = z.object({
  status: AnswerGradeStatusSchema,
  total: z.number().nullable(),
  confidence: ConfidenceSchema.nullable(),
  currentEvaluationId: z.number().int().nullable(),
  updatedAt: z.number(),
});
export type AnswerGrade = z.infer<typeof AnswerGradeSchema>;

/**
 * `GET /answers/:sid/:qid` (M39): the answer beside the question and its sample, the current grade
 * and the whole history, oldest first. The question is fetched with `GET /exams/:id/questions`.
 */
export const AnswerDetailSchema = z.object({
  examId: z.string(),
  examState: ExamStateSchema,
  questionId: z.string(),
  student: z.object({
    id: z.string(),
    studentCode: z.string(),
    name: z.string(),
    riskScore: z.number().int(),
    outsideMs: z.number().int(),
  }),
  answer: z.object({ language: z.string(), content: z.string(), submittedAt: z.number() }),
  grade: AnswerGradeSchema,
  /** The evaluation the grade points at; `null` while pending or when the AI gave up. */
  current: EvaluationSchema.nullable(),
  history: z.array(EvaluationSchema),
});
export type AnswerDetail = z.infer<typeof AnswerDetailSchema>;

/** `POST /answers/:sid/:qid/edit` (M40): every criterion of the guide, by name. */
export const AnswerEditBodySchema = z.object({
  criteria: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(200),
        awarded: AwardedMarksSchema,
        reason: z.string().trim().max(2000).default(''),
      }),
    )
    .min(1)
    .max(30),
  feedback: z.string().trim().max(5000),
  teacherNotes: z.array(TeacherNoteSchema).max(100).optional(),
});
export type AnswerEditBody = z.input<typeof AnswerEditBodySchema>;
