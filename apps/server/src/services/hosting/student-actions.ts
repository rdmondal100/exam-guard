import {
  WS_CLOSE,
  type ExamState,
  type StudentAction,
  type StudentActionResult,
} from '@examguard/shared';
import type { ExamStudentRepo } from '../../db/repositories/examStudent.repo.js';
import type { TeacherActionRepo } from '../../db/repositories/teacherAction.repo.js';
import type { SessionHub } from '../../sockets/sessionHub.js';
import type { StudentDeadlines } from '../exams/student-deadlines.js';
import type { SubmissionService } from '../submissions/submission-service.js';
import { HostingError } from './hosting-error.js';
import type { StudentLock } from './student-lock.js';
import type { TeacherMessages } from './teacher-messages.js';

export interface StudentActionsDeps {
  students: Pick<ExamStudentRepo, 'findById' | 'addExtension' | 'resetSession'>;
  actions: Pick<TeacherActionRepo, 'insert'>;
  hub: Pick<SessionHub, 'sendTo' | 'changed' | 'isConnected' | 'kick'>;
  locks: Pick<StudentLock, 'lock' | 'unlock'>;
  messages: Pick<TeacherMessages, 'send'>;
  submissions: Pick<SubmissionService, 'finalize'>;
  deadlines: Pick<StudentDeadlines, 'forStudent'>;
  examState: (examId: string) => ExamState | undefined;
  now: () => number;
}

const LIVE: ExamState[] = ['hosting', 'running'];

const refuse = (message: string) => new HostingError(409, 'invalid_state', message);

/**
 * The teacher's per-student actions (M35): message or warning, lock, unlock, extra time, end the
 * exam for one student, and reset their session. Each one is written to `teacher_actions`, and its
 * effect reaches the student as a `message` or `state` push and the teacher as a roster push.
 */
export class StudentActions {
  constructor(private readonly deps: StudentActionsDeps) {}

  run(examId: string, studentId: string, action: StudentAction): StudentActionResult {
    const { students, hub, examState: stateOf } = this.deps;
    const examState = stateOf(examId);
    if (!examState) throw new HostingError(404, 'not_found', 'Exam not found');
    const student = students.findById(studentId);
    if (!student || student.examId !== examId || student.state === 'not_joined') {
      throw new HostingError(404, 'not_found', 'Student not found in this exam');
    }
    const running = examState === 'running';
    if (!LIVE.includes(examState)) throw refuse(`The exam is ${examState}`);
    const final = student.state === 'submitted' || student.state === 'ended_by_teacher';
    let delivered = hub.isConnected(studentId);
    let logged: { action: string; payload: Record<string, unknown> };

    switch (action.type) {
      case 'message': {
        delivered = this.deps.messages.send(studentId, action.kind, action.text);
        logged = {
          action: action.kind === 'warning' ? 'warn' : 'message',
          payload: { text: action.text },
        };
        break;
      }
      case 'lock':
        if (!running || !this.deps.locks.lock(studentId, 'teacher')) {
          throw refuse('Only a student who is working in a running exam can be locked');
        }
        logged = { action: 'lock', payload: {} };
        break;
      case 'unlock':
        if (!running || !this.deps.locks.unlock(studentId)) {
          throw refuse('This student is not locked');
        }
        logged = { action: 'unlock', payload: {} };
        break;
      case 'extend': {
        if (final) throw refuse('This student has already finished');
        students.addExtension(studentId, action.minutes * 60);
        const deadline = this.deps.deadlines.forStudent(examId, studentId);
        if (running && deadline !== null)
          hub.sendTo(studentId, { t: 'state', state: { deadline } });
        hub.changed(studentId);
        logged = { action: 'extend', payload: { minutes: action.minutes } };
        break;
      }
      case 'end':
        if (!running || !this.deps.submissions.finalize(studentId, 'teacher_end')) {
          throw refuse('Only a student who is working in a running exam can be ended');
        }
        logged = { action: 'end', payload: {} };
        break;
      case 'reset_session':
        students.resetSession(studentId);
        // The old PC's app is told its sign-in is gone and stops retrying.
        hub.kick(studentId, WS_CLOSE.unauthorized, 'session_reset');
        hub.changed(studentId);
        logged = { action: 'reset_session', payload: {} };
        break;
    }

    this.deps.actions.insert({
      examId,
      examStudentId: studentId,
      action: logged.action,
      payload: logged.payload,
      ts: this.deps.now(),
    });
    return {
      ok: true,
      studentState: students.findById(studentId)?.state ?? student.state,
      deadline: running ? this.deps.deadlines.forStudent(examId, studentId) : null,
      delivered,
    };
  }
}
