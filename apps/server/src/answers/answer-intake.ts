import { ANSWER_TEXT_KEY, type AnswerSave } from '@examguard/shared';
import type { ExamRepo } from '../db/exam-repo.js';
import type { ExamStudentRepo } from '../db/exam-student-repo.js';
import type { QuestionRepo } from '../db/question-repo.js';
import type { StudentDeadlines } from '../exams/student-deadlines.js';
import type { AnswerWriter } from './answer-writer.js';

export interface AnswerIntakeDeps {
  exams: ExamRepo;
  students: ExamStudentRepo;
  questions: QuestionRepo;
  deadlines: StudentDeadlines;
  writer: AnswerWriter;
  now: () => number;
  /** Called for a save that is acked but not stored, with the reason. */
  onDropped?: (reason: string, save: AnswerSave) => void;
}

/**
 * Why a save is not stored, or `null` when it should be. A save counts while the exam runs and the
 * student is still working, if it was made by the student's deadline and arrives within the grace
 * after it (docs/architecture.md §6). Once a student is submitted nothing is stored any more.
 */
export function dropReason(
  deps: Pick<AnswerIntakeDeps, 'exams' | 'students' | 'questions' | 'deadlines' | 'now'>,
  examId: string,
  examStudentId: string,
  save: AnswerSave,
): string | null {
  if (deps.exams.get(examId)?.state !== 'running') return 'exam_not_running';
  const state = deps.students.findById(examStudentId)?.state;
  if (state !== 'active' && state !== 'locked') return 'student_not_working';
  const deadline = deps.deadlines.forStudent(examId, examStudentId);
  if (deadline !== null) {
    if (save.clientTs > deadline) return 'after_deadline';
    if (deps.now() > deadline + deps.deadlines.graceMs(examId)) return 'past_grace';
  }
  const question = deps.questions.get(save.questionId);
  if (!question || question.examId !== examId) return 'unknown_question';
  // A code question with no language set is answered in the plain text box.
  const keys: string[] =
    question.type === 'code' && question.allowedLanguages.length > 0
      ? question.allowedLanguages
      : [ANSWER_TEXT_KEY];
  if (!keys.includes(save.language)) return 'language_not_allowed';
  return null;
}

/**
 * Checks an `answer.save` and hands it to the batch writer. `ack` runs once the save is safe, or
 * straight away when it is dropped as invalid, so the client stops re-sending it.
 */
export function takeAnswerSave(
  deps: AnswerIntakeDeps,
  examId: string,
  examStudentId: string,
  save: AnswerSave,
  ack: () => void,
): void {
  const reason = dropReason(deps, examId, examStudentId, save);
  if (reason) {
    deps.onDropped?.(reason, save);
    return ack();
  }
  deps.writer.enqueue(
    {
      examStudentId,
      questionId: save.questionId,
      language: save.language,
      content: save.content,
      selected: save.selected,
      reason: save.reason,
      flags: save.flags,
      clientSeq: save.clientSeq,
      clientTs: save.clientTs,
      serverTs: deps.now(),
    },
    ack,
  );
}
