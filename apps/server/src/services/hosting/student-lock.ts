import type { ExamState, UnlockActionResult } from '@examguard/shared';
import type { ExamStudentRepo } from '../../db/repositories/examStudent.repo.js';
import type { TeacherActionRepo } from '../../db/repositories/teacherAction.repo.js';
import type { SessionHub } from '../../sockets/sessionHub.js';
import { HostingError } from './hosting-error.js';

export interface StudentLockDeps {
  students: Pick<ExamStudentRepo, 'findById' | 'lock' | 'unlock'>;
  actions: Pick<TeacherActionRepo, 'insert'>;
  hub: Pick<SessionHub, 'sendTo' | 'changed'>;
  examState: (examId: string) => ExamState | undefined;
  now: () => number;
}

/**
 * The tamper lock (M24): a student whose app reports `agent_lost` while the exam runs becomes
 * `locked` until the teacher unlocks them. A locked student's answers still count (they are still
 * working); the app covers the exam with the lock screen. The full lock/unlock is M35.
 */
export class StudentLock {
  constructor(private readonly deps: StudentLockDeps) {}

  /** The student's app lost its agent link. Only a working student of a running exam is locked. */
  agentLost(studentId: string): void {
    const student = this.deps.students.findById(studentId);
    if (!student || this.deps.examState(student.examId) !== 'running') return;
    if (!this.deps.students.lock(studentId)) return;
    this.push(studentId, true);
  }

  unlock(examId: string, studentId: string): UnlockActionResult {
    const examState = this.deps.examState(examId);
    if (!examState) throw new HostingError(404, 'not_found', 'Exam not found');
    const student = this.deps.students.findById(studentId);
    if (!student || student.examId !== examId) {
      throw new HostingError(404, 'not_found', 'Student not found');
    }
    if (examState !== 'running' || !this.deps.students.unlock(studentId)) {
      throw new HostingError(409, 'invalid_state', 'This student is not locked');
    }
    this.deps.actions.insert({
      examId,
      examStudentId: studentId,
      action: 'unlock',
      payload: {},
      ts: this.deps.now(),
    });
    this.push(studentId, false);
    return { ok: true, studentState: 'active' };
  }

  private push(studentId: string, locked: boolean): void {
    const studentState = locked ? 'locked' : 'active';
    this.deps.hub.sendTo(studentId, { t: 'state', state: { studentState, locked } });
    this.deps.hub.changed(studentId);
  }
}
