import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  agentProblem,
  isProtocolCompatible,
  type JoinRequest,
  type JoinResponse,
  type StudentState,
} from '@examguard/shared';
import type { EventRepo } from '../db/event-repo.js';
import type { ExamRepo } from '../db/exam-repo.js';
import type { ExamStudentRepo } from '../db/exam-student-repo.js';
import { JoinLimiter } from './join-limiter.js';

/** A refusal the routes turn into an HTTP error. */
export class JoinError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'JoinError';
  }
}

/** The exam students can currently join. `null` when nothing is hosted. */
export interface JoinTarget {
  examId: string;
  pin: string;
  fingerprint: string;
}

export interface JoinServiceDeps {
  exams: ExamRepo;
  students: ExamStudentRepo;
  events: EventRepo;
  target: () => JoinTarget | null;
  now?: () => number;
  limiter?: JoinLimiter;
  makeToken?: () => string;
  /** Called after a student's visible state changed (lobby entry), for the live roster. */
  onChange?: (examStudentId: string) => void;
}

export const hashToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

function pinMatches(expected: string, received: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Student join: PIN and class-list check, one session per student, token issue. */
export class JoinService {
  private readonly now: () => number;
  private readonly limiter: JoinLimiter;

  constructor(private readonly deps: JoinServiceDeps) {
    this.now = deps.now ?? Date.now;
    this.limiter = deps.limiter ?? new JoinLimiter(this.now);
  }

  join(request: JoinRequest, ip: string): JoinResponse {
    const { exams, students, events } = this.deps;
    if (!isProtocolCompatible(request.protocol)) {
      throw new JoinError(
        426,
        'protocol_mismatch',
        "Update ExamGuard to match the teacher's version",
      );
    }
    const target = this.deps.target();
    const exam = target && exams.get(target.examId);
    if (!target || !exam) throw new JoinError(503, 'not_hosting', 'No exam is being hosted');

    const wait = this.limiter.retryAfterSec(ip);
    if (wait > 0) {
      throw new JoinError(429, 'rate_limited', 'Too many tries. Wait a moment.', {
        retryAfterSec: wait,
      });
    }
    if (!pinMatches(target.pin, request.pin)) {
      this.limiter.recordFailure(ip);
      throw new JoinError(401, 'bad_pin', 'The PIN is not correct');
    }
    const onList = exam.classListId
      ? students.findOnList(exam.classListId, request.studentCode)
      : undefined;
    if (!onList) {
      this.limiter.recordFailure(ip);
      throw new JoinError(403, 'not_on_list', 'That student ID is not on the class list');
    }
    // The app reports its agent's system check; a student whose monitoring is not healthy cannot join.
    const agentIssue = agentProblem(request.agent);
    if (agentIssue) throw new JoinError(403, 'agent_required', agentIssue);

    const now = this.now();
    const existing = students.find(exam.id, onList.id);
    if (existing?.tokenHash && existing.deviceId && existing.deviceId !== request.deviceId) {
      events.insert({
        examId: exam.id,
        examStudentId: existing.id,
        type: 'duplicate_login',
        severity: 'critical',
        source: 'server',
        details: {
          ip,
          newDevice: request.deviceId.slice(0, 12),
          boundDevice: existing.deviceId.slice(0, 12),
        },
        serverTs: now,
      });
      throw new JoinError(
        409,
        'already_active_elsewhere',
        'This student is already signed in on another computer. Ask your invigilator.',
      );
    }

    const session = existing ?? students.create(exam.id, onList.id, now);
    const token = (this.deps.makeToken ?? (() => randomBytes(32).toString('base64url')))();
    students.bindSession(session.id, hashToken(token), request.deviceId, target.fingerprint, now);
    this.limiter.recordSuccess(ip);
    return {
      token,
      examStudentId: session.id,
      name: onList.name,
      examTitle: exam.title,
      state: session.state,
    };
  }

  /** The student accepted the notice: `not_joined` → `lobby`. Idempotent. */
  confirm(token: string): StudentState {
    const session = this.deps.students.findByTokenHash(hashToken(token));
    if (!session) throw new JoinError(401, 'unauthorized', 'Sign in again');
    const state = this.deps.students.confirm(session.id, this.now()) ?? session.state;
    this.deps.onChange?.(session.id);
    return state;
  }
}
