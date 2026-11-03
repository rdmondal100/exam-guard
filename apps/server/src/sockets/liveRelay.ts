import {
  LIVE_FPS,
  LIVE_MAX_WIDTH,
  MAX_LIVE_PER_TEACHER,
  type LiveEndReason,
  type LiveSession,
  type RtcSignalData,
  type ServerToStudent,
} from '@examguard/shared';
import { newId } from '../utils/ids.js';

/** A teacher socket that may open live views. */
export interface LiveViewer {
  send(message: LiveSession | { t: 'rtc.signal'; sessionId: string; data: RtcSignalData }): void;
}

/** What the relay needs from the session hub. */
export interface LiveStudents {
  isConnected(id: string): boolean;
  sendTo(id: string, message: ServerToStudent): void;
}

export interface LiveRelayDeps {
  students: LiveStudents;
  newSessionId?: () => string;
  maxWidth?: number;
  fps?: number;
}

interface Session {
  id: string;
  studentId: string;
  viewer: LiveViewer;
}

/**
 * WebRTC signaling for the live view (M30, M34; docs/architecture.md §5). A teacher socket opens a
 * session for a connected student (at most 2 per socket); the student app gets `live.request` and
 * sends the offer. The relay forwards `rtc.signal` only between the two ends of a session it
 * knows, and ends a session when either side closes, the teacher socket closes, the student's
 * socket goes away or hosting stops. The media never passes through the server.
 */
export class LiveRelay {
  private readonly sessions = new Map<string, Session>();
  private readonly newSessionId: () => string;

  constructor(private readonly deps: LiveRelayDeps) {
    this.newSessionId = deps.newSessionId ?? (() => newId());
  }

  /** `live.open` from a teacher socket. */
  open(viewer: LiveViewer, studentId: string): void {
    const sessionId = this.newSessionId();
    const refuse = (reason: LiveEndReason) =>
      viewer.send({
        t: 'live.session',
        sessionId,
        examStudentId: studentId,
        status: 'failed',
        reason,
      });
    if (!this.deps.students.isConnected(studentId)) return refuse('not_connected');
    const mine = [...this.sessions.values()].filter((s) => s.viewer === viewer);
    if (mine.length >= MAX_LIVE_PER_TEACHER) return refuse('too_many');
    this.sessions.set(sessionId, { id: sessionId, studentId, viewer });
    viewer.send({ t: 'live.session', sessionId, examStudentId: studentId, status: 'connecting' });
    this.deps.students.sendTo(studentId, {
      t: 'live.request',
      sessionId,
      maxWidth: this.deps.maxWidth ?? LIVE_MAX_WIDTH,
      fps: this.deps.fps ?? LIVE_FPS,
    });
  }

  /** `live.close` from the teacher socket that opened it. */
  close(viewer: LiveViewer, sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session?.viewer !== viewer) return;
    this.end(session, 'ended', 'closed');
  }

  /** `rtc.signal` from a teacher socket: only for its own session. */
  fromTeacher(viewer: LiveViewer, sessionId: string, data: RtcSignalData): void {
    const session = this.sessions.get(sessionId);
    if (session?.viewer !== viewer) return;
    this.deps.students.sendTo(session.studentId, { t: 'rtc.signal', sessionId, data });
  }

  /** `rtc.signal` from a signed-in student: only for a session asked of that student. */
  fromStudent(studentId: string, sessionId: string, data: RtcSignalData): void {
    const session = this.sessions.get(sessionId);
    if (session?.studentId !== studentId) return;
    session.viewer.send({ t: 'rtc.signal', sessionId, data });
  }

  /** `live.state` from the student: it could not start, or it stopped on its side. */
  studentState(studentId: string, sessionId: string, status: 'failed' | 'ended'): void {
    const session = this.sessions.get(sessionId);
    if (session?.studentId !== studentId) return;
    this.end(session, status, status === 'failed' ? 'student_failed' : 'student_left', false);
  }

  /** The teacher socket closed: its sessions end on the student's side. */
  closeViewer(viewer: LiveViewer): void {
    for (const session of [...this.sessions.values()]) {
      if (session.viewer === viewer) this.end(session, 'ended', 'closed', true, false);
    }
  }

  /**
   * The student's socket went away or was replaced (a new `welcome`): a new socket has no peer
   * connection, so its sessions are over; the teacher may open a new one.
   */
  onStudentGone(studentId: string): void {
    for (const session of [...this.sessions.values()]) {
      if (session.studentId === studentId) this.end(session, 'ended', 'student_left', false);
    }
  }

  /** Hosting stopped: every student socket is gone. */
  reset(): void {
    for (const session of [...this.sessions.values()]) {
      this.end(session, 'ended', 'hosting_stopped', false);
    }
  }

  /** Open sessions, for tests and stats. */
  count(): number {
    return this.sessions.size;
  }

  private end(
    session: Session,
    status: 'ended' | 'failed',
    reason: LiveEndReason,
    tellStudent = true,
    tellTeacher = true,
  ): void {
    this.sessions.delete(session.id);
    if (tellStudent)
      this.deps.students.sendTo(session.studentId, { t: 'live.stop', sessionId: session.id });
    if (tellTeacher) {
      session.viewer.send({
        t: 'live.session',
        sessionId: session.id,
        examStudentId: session.studentId,
        status,
        reason,
      });
    }
  }
}
