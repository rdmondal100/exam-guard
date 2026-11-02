import type {
  BroadcastAction,
  BroadcastResult,
  ExamState,
  ExtendAllAction,
  ExtendAllResult,
} from '@examguard/shared';
import type { ExamRepo } from '../../db/repositories/exam.repo.js';
import type { ExamStudentRepo } from '../../db/repositories/examStudent.repo.js';
import type { TeacherActionRepo } from '../../db/repositories/teacherAction.repo.js';
import type { SessionHub } from '../../sockets/sessionHub.js';
import type { StudentDeadlines } from '../exams/student-deadlines.js';
import { HostingError } from './hosting-error.js';
import type { TeacherMessages } from './teacher-messages.js';

export interface GlobalActionsDeps {
  exams: Pick<ExamRepo, 'get' | 'addGlobalExtension' | 'timing'>;
  students: Pick<ExamStudentRepo, 'working' | 'joinedIds'>;
  actions: Pick<TeacherActionRepo, 'insert'>;
  hub: Pick<SessionHub, 'sendTo'>;
  messages: Pick<TeacherMessages, 'send'>;
  deadlines: Pick<StudentDeadlines, 'forStudent'>;
  now: () => number;
}

/**
 * The teacher's actions for the whole exam (M36): extra time for everyone and a broadcast popup.
 * Ending the exam for everyone is `HostingManager.endExam`. Each is written to `teacher_actions`.
 */
export class GlobalActions {
  constructor(private readonly deps: GlobalActionsDeps) {}

  /** Running exams only: before Start the teacher changes the duration instead. */
  extendAll(examId: string, action: ExtendAllAction): ExtendAllResult {
    this.requireState(examId, ['running'], 'Extra time for everyone needs a running exam');
    const now = this.deps.now();
    this.deps.exams.addGlobalExtension(examId, action.minutes * 60, now);
    // Everyone still working gets their own new end (a personal extension stays on top).
    for (const s of this.deps.students.working(examId)) {
      const deadline = this.deps.deadlines.forStudent(examId, s.id);
      if (deadline !== null) this.deps.hub.sendTo(s.id, { t: 'state', state: { deadline } });
    }
    this.log(examId, 'extend_all', { minutes: action.minutes }, now);
    return { ok: true, ...this.timing(examId) };
  }

  /** A popup for every joined student, also those who already finished. */
  broadcast(examId: string, action: BroadcastAction): BroadcastResult {
    this.requireState(examId, ['hosting', 'running'], 'Messages need a hosted or running exam');
    const ids = this.deps.students.joinedIds(examId);
    let delivered = 0;
    for (const id of ids) {
      if (this.deps.messages.send(id, action.kind, action.text)) delivered += 1;
    }
    this.log(
      examId,
      'broadcast',
      { kind: action.kind, text: action.text, sent: ids.length },
      this.deps.now(),
    );
    return { ok: true, sent: ids.length, delivered };
  }

  /** The exam's shared end (no personal extension) and the extra time for all, in minutes. */
  timing(examId: string): { deadline: number | null; extensionMin: number } {
    return {
      deadline: this.deps.deadlines.forStudent(examId, null),
      extensionMin: Math.round((this.deps.exams.timing(examId)?.globalExtensionSec ?? 0) / 60),
    };
  }

  private requireState(examId: string, allowed: ExamState[], message: string): void {
    const state = this.deps.exams.get(examId)?.state;
    if (!state) throw new HostingError(404, 'not_found', 'Exam not found');
    if (!allowed.includes(state)) throw new HostingError(409, 'invalid_state', message);
  }

  private log(examId: string, action: string, payload: Record<string, unknown>, ts: number): void {
    this.deps.actions.insert({ examId, examStudentId: null, action, payload, ts });
  }
}
