import type { ExamState, LockReason } from '@examguard/shared';
import type { ExamStudentRepo } from '../../db/repositories/examStudent.repo.js';
import type { SessionHub } from '../../sockets/sessionHub.js';

export interface StudentLockDeps {
  students: Pick<ExamStudentRepo, 'findById' | 'lock' | 'unlock'>;
  hub: Pick<SessionHub, 'sendTo' | 'changed'>;
  examState: (examId: string) => ExamState | undefined;
}

/**
 * Locking a working student of a running exam: by the tamper lock (M24, a student whose app
 * reports `agent_lost`) or by the teacher (M35). A locked student's answers still count and the
 * timer runs; the app covers the exam with the lock screen until the teacher unlocks them.
 */
export class StudentLock {
  constructor(private readonly deps: StudentLockDeps) {}

  /** The student's app lost its agent link. Only a working student of a running exam is locked. */
  agentLost(studentId: string): void {
    this.lock(studentId, 'agent');
  }

  /** `active` → `locked`. Returns whether the student was locked by this call. */
  lock(studentId: string, reason: LockReason): boolean {
    const student = this.deps.students.findById(studentId);
    if (!student || this.deps.examState(student.examId) !== 'running') return false;
    if (!this.deps.students.lock(studentId, reason)) return false;
    this.push(studentId, reason);
    return true;
  }

  /** `locked` → `active`. Returns whether the student was unlocked by this call. */
  unlock(studentId: string): boolean {
    const student = this.deps.students.findById(studentId);
    if (!student || this.deps.examState(student.examId) !== 'running') return false;
    if (!this.deps.students.unlock(studentId)) return false;
    this.push(studentId, null);
    return true;
  }

  private push(studentId: string, reason: LockReason | null): void {
    const locked = reason !== null;
    this.deps.hub.sendTo(studentId, {
      t: 'state',
      state: { studentState: locked ? 'locked' : 'active', locked, lockReason: reason },
    });
    this.deps.hub.changed(studentId);
  }
}
