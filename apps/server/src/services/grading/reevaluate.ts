import type { AnswerGradeStatus, ReevaluateBody } from '@examguard/shared';
import { ReevaluateBodySchema } from '@examguard/shared';
import type { AnswerGradeRepo } from '../../db/repositories/answerGrade.repo.js';
import type { ExamRepo } from '../../db/repositories/exam.repo.js';
import type { GradingJobRepo } from '../../db/repositories/gradingJob.repo.js';
import type { QuestionRepo } from '../../db/repositories/question.repo.js';
import type { ReevaluateQueueRepo } from '../../db/repositories/reevaluateQueue.repo.js';
import { newId } from '../../utils/ids.js';
import { PROMPT_VERSION } from './prompt.js';
import type { GradingProvider } from './provider.js';
import { GradingError } from './provider-source.js';

export interface ReevaluateDeps {
  exams: ExamRepo;
  questions: QuestionRepo;
  jobs: GradingJobRepo;
  grades: AnswerGradeRepo;
  queue: ReevaluateQueueRepo;
}

/** What a re-evaluation grades again by default; the teacher's own grades only when included. */
const UNEDITED: readonly AnswerGradeStatus[] = ['pending', 'ai_graded', 'needs_manual'];
const EDITED: readonly AnswerGradeStatus[] = ['verified', 'modified'];

/**
 * Queues a `reevaluate` job (M41, architecture §7): one question, the chosen students or all,
 * with the teacher's instruction in the prompt. Only from In review. The answers keep their grade
 * until the new one arrives; the new evaluations are appended to the history. Throws a
 * `GradingError` when the request does not fit. The exam goes to `grading`.
 */
export function queueReevaluation(
  deps: ReevaluateDeps,
  examId: string,
  input: ReevaluateBody,
  provider: GradingProvider,
  now: number,
): void {
  const { exams, questions, jobs, grades, queue } = deps;
  const body = ReevaluateBodySchema.parse(input);
  const exam = exams.get(examId);
  if (!exam) throw new GradingError(404, 'not_found', 'Exam not found');
  if (exam.state !== 'in_review') {
    throw new GradingError(409, 'invalid_state', 'Answers can be re-evaluated only in review');
  }
  const question = questions.get(body.questionId);
  if (!question || question.examId !== examId) {
    throw new GradingError(400, 'unknown_question', 'Unknown question');
  }
  const ids = body.examStudentIds === 'all' ? null : [...new Set(body.examStudentIds)];
  if (ids) {
    const answered = new Set(grades.reviewRows(question.id).map((r) => r.examStudentId));
    if (ids.some((id) => !answered.has(id))) {
      throw new GradingError(400, 'unknown_student', 'A chosen student has no answer here');
    }
  }
  const statuses = body.includeEdited ? [...UNEDITED, ...EDITED] : UNEDITED;
  const jobId = newId(now);
  exams.transaction(() => {
    grades.ensureRows(question.id, now);
    const scope = queue.candidates(question.id, statuses, ids);
    if (scope.length === 0) {
      throw new GradingError(
        409,
        'nothing_to_grade',
        'Every chosen answer was checked by the teacher. Include edited answers to grade them again.',
      );
    }
    jobs.insert({
      id: jobId,
      examId,
      questionId: question.id,
      kind: 'reevaluate',
      instruction: body.instruction,
      scope,
      position: question.position,
      provider: provider.id,
      model: provider.model,
      promptVersion: PROMPT_VERSION,
      now,
    });
    queue.queue(jobId, question.id, scope);
    exams.setState(examId, 'grading', now);
  });
}
