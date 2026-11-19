import type { Question, QuestionBody } from '@examguard/shared';
import type { ExamRepo } from '../../db/repositories/exam.repo.js';
import type { QuestionRepo } from '../../db/repositories/question.repo.js';
import { ApiError } from '../../utils/ApiError.js';
import { acceptsAdditions, isEditable } from './exam-state.js';
import { questionProblems } from './ready-check.js';

export interface QuestionAdderDeps {
  exams: Pick<ExamRepo, 'get'>;
  questions: Pick<QuestionRepo, 'create' | 'list'>;
  /** A question was added to a hosted or running exam: the students get it (M58). */
  onAdded?: (examId: string, questionId: string) => void;
}

/**
 * Adds a question. Before hosting anything goes (Ready checks the exam later). Once the exam is
 * hosted or running (M58) the question goes to the students at once, so it must be complete now
 * (`questionProblems`); it is added last, so the numbers students already see stay.
 */
export function addQuestion(
  deps: QuestionAdderDeps,
  examId: string,
  body: QuestionBody,
  now: number,
): Question {
  const exam = deps.exams.get(examId);
  if (!exam) throw new ApiError(404, 'not_found', 'Exam not found');
  if (isEditable(exam.state)) return deps.questions.create(exam.id, body, now);
  if (!acceptsAdditions(exam.state)) {
    throw new ApiError(409, 'invalid_state', `A ${exam.state} exam cannot be edited`);
  }
  const position = deps.questions.list(exam.id).length + 1;
  const problems = questionProblems(exam, { ...body, id: '', position });
  if (problems.length > 0) {
    throw new ApiError(422, 'question_incomplete', problems.map((p) => p.message).join('; '), {
      problems,
    });
  }
  const question = deps.questions.create(exam.id, body, now);
  deps.onAdded?.(exam.id, question.id);
  return question;
}
