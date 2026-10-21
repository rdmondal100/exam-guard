import { z } from 'zod';

export const QUESTION_LANGUAGES = ['c', 'cpp', 'js'] as const;
export const QuestionLanguageSchema = z.enum(QUESTION_LANGUAGES);
export type QuestionLanguage = z.infer<typeof QuestionLanguageSchema>;

export const QuestionTypeSchema = z.enum(['code', 'written']);
export type QuestionType = z.infer<typeof QuestionTypeSchema>;

export const MAX_CRITERIA = 30;
export const MAX_CRITERION_MARKS = 1000;

/** Marks as the teacher sees them: a positive multiple of 0.5. Stored as integer half-units. */
export const MarksSchema = z
  .number()
  .positive()
  .max(MAX_CRITERION_MARKS)
  .refine((n) => Number.isInteger(n * 2), 'Marks go in steps of 0.5');

export const CriterionSchema = z.object({
  name: z.string().trim().min(1).max(200),
  maxMarks: MarksSchema,
});
export type Criterion = z.infer<typeof CriterionSchema>;

/** `POST /exams/:id/questions` and `PATCH /questions/:qid` (a full replacement of the editable fields). */
export const QuestionBodySchema = z
  .object({
    type: QuestionTypeSchema,
    body: z.string().trim().min(1).max(20_000),
    allowedLanguages: z.array(QuestionLanguageSchema).max(QUESTION_LANGUAGES.length),
    studentNote: z.string().max(2_000),
    sampleAnswer: z.string().max(50_000),
    sampleLanguage: z.string().trim().min(1).max(20),
    aiNotes: z.string().max(5_000),
    criteria: z.array(CriterionSchema).max(MAX_CRITERIA),
  })
  .superRefine((q, ctx) => {
    if (q.type === 'written' && q.allowedLanguages.length > 0) {
      ctx.addIssue({ code: 'custom', path: ['allowedLanguages'], message: 'Written has none' });
    }
    if (new Set(q.allowedLanguages).size !== q.allowedLanguages.length) {
      ctx.addIssue({ code: 'custom', path: ['allowedLanguages'], message: 'Duplicate language' });
    }
    const names = q.criteria.map((c) => c.name.toLowerCase());
    if (new Set(names).size !== names.length) {
      ctx.addIssue({ code: 'custom', path: ['criteria'], message: 'Criterion names must differ' });
    }
  });
export type QuestionBody = z.infer<typeof QuestionBodySchema>;

export const QuestionSchema = z.object({
  id: z.string(),
  examId: z.string(),
  position: z.number().int().min(1),
  type: QuestionTypeSchema,
  body: z.string(),
  /** Sum of the criteria. */
  marks: z.number(),
  allowedLanguages: z.array(QuestionLanguageSchema),
  studentNote: z.string(),
  sampleAnswer: z.string(),
  sampleLanguage: z.string(),
  aiNotes: z.string(),
  criteria: z.array(CriterionSchema),
});
export type Question = z.infer<typeof QuestionSchema>;
export const QuestionsSchema = z.array(QuestionSchema);

/** What a student may see: never the sample answer, criteria or AI notes. */
export const StudentQuestionSchema = z.object({
  id: z.string(),
  position: z.number().int().min(1),
  type: QuestionTypeSchema,
  body: z.string(),
  marks: z.number(),
  allowedLanguages: z.array(QuestionLanguageSchema),
  studentNote: z.string(),
});
export type StudentQuestion = z.infer<typeof StudentQuestionSchema>;

export function toStudentQuestion(q: Question): StudentQuestion {
  return {
    id: q.id,
    position: q.position,
    type: q.type,
    body: q.body,
    marks: q.marks,
    allowedLanguages: q.allowedLanguages,
    studentNote: q.studentNote,
  };
}

export const ReorderBodySchema = z.object({ ids: z.array(z.string()).min(1) });
export type ReorderBody = z.infer<typeof ReorderBodySchema>;

export const ReadyProblemCodeSchema = z.enum([
  'no_class_list',
  'no_questions',
  'missing_sample_answer',
  'no_criteria',
  'no_languages',
]);
export type ReadyProblemCode = z.infer<typeof ReadyProblemCodeSchema>;

/** One reason an exam cannot be marked Ready. `questionId` is set for per-question problems. */
export const ReadyProblemSchema = z.object({
  code: ReadyProblemCodeSchema,
  message: z.string(),
  questionId: z.string().optional(),
});
export type ReadyProblem = z.infer<typeof ReadyProblemSchema>;

export const ReadyProblemsDetailsSchema = z.object({ problems: z.array(ReadyProblemSchema) });
