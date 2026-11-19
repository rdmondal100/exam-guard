import type { Request, Response } from 'express';
import { QuestionBodySchema, ReorderBodySchema, type ExamState } from '@examguard/shared';
import type { ExamRepo } from '../db/repositories/exam.repo.js';
import type { QuestionRepo } from '../db/repositories/question.repo.js';
import { acceptsAdditions, isEditable } from '../services/exams/exam-state.js';
import { addQuestion } from '../services/exams/question-adder.js';
import { ApiError } from '../utils/ApiError.js';

export interface QuestionControllerDeps {
  exams: ExamRepo;
  questions: QuestionRepo;
  now?: () => number;
  /** A question was added to a hosted or running exam (M58). */
  onQuestionAdded?: (examId: string, questionId: string) => void;
}

const INVALID_BODY = 'Invalid question: check the text, languages and criteria (0.5 steps)';

/**
 * The questions of an exam. Changes need a draft or ready exam; a hosted or running one only takes
 * new questions (M58).
 */
export function createQuestionController({
  exams,
  questions,
  now = Date.now,
  onQuestionAdded,
}: QuestionControllerDeps) {
  const refusal = (state: ExamState) =>
    new ApiError(
      409,
      'invalid_state',
      acceptsAdditions(state)
        ? 'Students already have these questions: they cannot be changed, but you can add new ones'
        : `A ${state} exam cannot be edited`,
    );
  const editableExam = (id: string) => {
    const exam = exams.get(id);
    if (!exam) throw new ApiError(404, 'not_found', 'Exam not found');
    if (!isEditable(exam.state)) throw refusal(exam.state);
    return exam;
  };
  const editableQuestion = (qid: string) => {
    const current = questions.get(qid);
    const exam = current && exams.get(current.examId);
    if (!current || !exam) throw new ApiError(404, 'not_found', 'Question not found');
    if (!isEditable(exam.state)) throw refusal(exam.state);
    return current;
  };

  return {
    list(req: Request<{ id: string }>, res: Response): void {
      if (!exams.get(req.params.id)) throw new ApiError(404, 'not_found', 'Exam not found');
      res.json(questions.list(req.params.id));
    },

    create(req: Request<{ id: string }>, res: Response): void {
      const body = QuestionBodySchema.safeParse(req.body);
      if (!body.success) throw new ApiError(400, 'invalid_body', INVALID_BODY);
      const deps = { exams, questions, ...(onQuestionAdded ? { onAdded: onQuestionAdded } : {}) };
      res.status(201).json(addQuestion(deps, req.params.id, body.data, now()));
    },

    reorder(req: Request<{ id: string }>, res: Response): void {
      const exam = editableExam(req.params.id);
      const body = ReorderBodySchema.safeParse(req.body);
      if (!body.success || !questions.reorder(exam.id, body.data.ids)) {
        throw new ApiError(400, 'invalid_body', 'ids must list every question exactly once');
      }
      res.json(questions.list(exam.id));
    },

    update(req: Request<{ qid: string }>, res: Response): void {
      const current = editableQuestion(req.params.qid);
      const body = QuestionBodySchema.safeParse(req.body);
      if (!body.success) throw new ApiError(400, 'invalid_body', INVALID_BODY);
      res.json(questions.update(current.id, body.data, now()));
    },

    remove(req: Request<{ qid: string }>, res: Response): void {
      const current = editableQuestion(req.params.qid);
      questions.delete(current.id);
      res.json({ ok: true });
    },
  };
}
