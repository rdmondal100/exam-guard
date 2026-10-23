import { createHash } from 'node:crypto';
import { buildReceiptAnswers, type Receipt, type SubmitRefused } from '@examguard/shared';
import type { AnswerWriter } from '../answers/answer-writer.js';
import type { AnswerRepo } from '../db/answer-repo.js';
import type { ExamRepo } from '../db/exam-repo.js';
import type { ExamStudentRepo } from '../db/exam-student-repo.js';
import type { FinalAnswerRepo } from '../db/final-answer-repo.js';
import type { QuestionRepo } from '../db/question-repo.js';
import type { SessionHub } from '../ws/session-hub.js';
import { chooseFinalAnswers } from './choose-final.js';

/** Why a student's answers became final. */
export type FinalizeReason = 'student' | 'time_up' | 'teacher_end';

export type SubmitOutcome =
  { ok: true; receipt: Receipt } | { ok: false; reason: SubmitRefused['reason'] };

export interface SubmissionDeps {
  exams: ExamRepo;
  students: ExamStudentRepo;
  questions: QuestionRepo;
  answers: AnswerRepo;
  finals: FinalAnswerRepo;
  writer: AnswerWriter;
  hub: SessionHub;
  now: () => number;
}

export const sha256Hex = (text: string): string =>
  createHash('sha256').update(text, 'utf8').digest('hex');

/**
 * Makes a student's answers final: submit, auto-submit at time-up, or the teacher ending the exam.
 * One path, so the rules cannot drift apart. It is idempotent: a student is finalized once, and
 * asking again returns the stored receipt.
 */
export class SubmissionService {
  constructor(private readonly deps: SubmissionDeps) {}

  /** The student pressed Submit (or the client re-sent it after a reconnect). */
  submit(studentId: string): SubmitOutcome {
    const existing = this.deps.finals.receiptFor(studentId);
    if (existing) return { ok: true, receipt: existing };
    const student = this.deps.students.findById(studentId);
    if (!student) return { ok: false, reason: 'not_working' };
    if (this.deps.exams.get(student.examId)?.state !== 'running') {
      return { ok: false, reason: 'not_running' };
    }
    const receipt = this.finalize(studentId, 'student');
    return receipt ? { ok: true, receipt } : { ok: false, reason: 'not_working' };
  }

  /**
   * Writes the final answers from the newest stored versions. Returns the receipt, or `null` if the
   * student was not working (already final, or never active).
   */
  finalize(studentId: string, reason: FinalizeReason): Receipt | null {
    const { students, questions, answers, finals, writer, hub, now } = this.deps;
    const student = students.findById(studentId);
    if (!student || (student.state !== 'active' && student.state !== 'locked')) return null;
    // Saves received a moment ago may still be waiting in the batch; they count.
    writer.flush();
    const chosen = chooseFinalAnswers(questions.list(student.examId), answers.snapshot(studentId));
    const { hash, answers: receiptAnswers } = buildReceiptAnswers(chosen, sha256Hex);
    const submittedAt = now();
    const stored = finals.commit({
      examStudentId: studentId,
      state: reason === 'teacher_end' ? 'ended_by_teacher' : 'submitted',
      answers: chosen.map((a) => ({
        ...a,
        versionId: answers.latest(studentId, a.questionId, a.language)?.id ?? null,
        sha256: receiptAnswers.find((r) => r.questionId === a.questionId)?.sha256 ?? '',
      })),
      hash,
      now: submittedAt,
    });
    if (!stored) return null;
    const receipt: Receipt = { hash, submittedAt, answers: receiptAnswers };
    hub.changed(studentId);
    const state = students.findById(studentId)?.state ?? 'submitted';
    hub.sendTo(studentId, { t: 'state', state: { studentState: state, receipt } });
    return receipt;
  }

  /** Finalizes everyone still working in the exam. */
  finalizeAll(examId: string, reason: FinalizeReason): void {
    for (const { id } of this.deps.students.working(examId)) this.finalize(id, reason);
  }

  receiptOf(studentId: string): Receipt | null {
    return this.deps.finals.receiptFor(studentId);
  }
}
