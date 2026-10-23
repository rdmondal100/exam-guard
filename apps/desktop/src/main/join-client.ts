import {
  JOIN_CLIENT_ERROR_CODES,
  JoinResponseSchema,
  PROTOCOL_VERSION,
  type JoinAttempt,
  type JoinConfirmResult,
  type JoinResult,
} from '@examguard/shared';
import type { StoredSession } from './resume/session-store.js';
import { PinError, pinnedRequest, type PinnedTarget } from './tls-pin.js';

type ErrorCode = (typeof JOIN_CLIENT_ERROR_CODES)[number];

const MESSAGES: Record<ErrorCode, string> = {
  bad_pin: 'That PIN is not correct. Check the PIN on the teacher screen.',
  not_on_list: 'That student ID is not on this exam. Check it or ask your invigilator.',
  already_active_elsewhere:
    'This student is already signed in on another computer. Ask your invigilator.',
  not_hosting: 'That teacher is not hosting an exam right now.',
  agent_required: 'The ExamGuard monitoring agent is not running on this computer.',
  protocol_mismatch: "Update ExamGuard to match the teacher's version.",
  rate_limited: 'Too many wrong tries. Wait a moment and try again.',
  unreachable: 'Could not reach that computer. Check that you are on the lab network.',
  fingerprint_mismatch:
    "This computer's certificate does not match the one you checked. Do not continue; tell your invigilator.",
  bad_response: 'That computer did not answer like an ExamGuard teacher.',
  no_session: 'Your sign-in expired. Go back and join again.',
};

const isErrorCode = (code: unknown): code is ErrorCode =>
  typeof code === 'string' && (JOIN_CLIENT_ERROR_CODES as readonly string[]).includes(code);

interface Session {
  target: PinnedTarget;
  token: string;
  examStudentId: string;
  name: string;
  examTitle: string;
}

type Failure = Extract<JoinResult, { ok: false }>;

function failure(code: ErrorCode, retryAfterSec?: number): Failure {
  return {
    ok: false,
    code,
    message: MESSAGES[code],
    ...(retryAfterSec ? { retryAfterSec } : {}),
  };
}

/** Parses the server's `{ error: { code, details } }` envelope. */
function serverFailure(body: string): Failure {
  try {
    const error = (JSON.parse(body) as { error?: { code?: unknown; details?: unknown } }).error;
    const code = isErrorCode(error?.code) ? error.code : 'bad_response';
    const retry = (error?.details as { retryAfterSec?: unknown } | undefined)?.retryAfterSec;
    return failure(code, typeof retry === 'number' && retry > 0 ? Math.ceil(retry) : undefined);
  } catch {
    return failure('bad_response');
  }
}

function transportFailure(e: unknown): Failure {
  return failure(e instanceof PinError ? e.code : 'bad_response');
}

/**
 * Student join over the pinned connection. The session token stays in this object (main
 * process); the renderer only sees the name and exam title.
 */
export class JoinClient {
  private session: Session | null = null;

  constructor(private readonly deviceId: () => Promise<string>) {}

  /** What the live socket needs. Main only: it is never sent to the renderer. */
  credentials(): { target: PinnedTarget; token: string } | null {
    return this.session && { target: this.session.target, token: this.session.token };
  }

  /** This student's row in the hosted exam (names the code-run folder). */
  examStudentId(): string | null {
    return this.session?.examStudentId ?? null;
  }

  /** The signed-in session in the form the session file stores, or `null` before a join. */
  snapshot(): StoredSession | null {
    const session = this.session;
    if (!session?.target.expectedFingerprint) return null;
    return {
      target: {
        address: session.target.address,
        port: session.target.port,
        expectedFingerprint: session.target.expectedFingerprint,
      },
      token: session.token,
      examStudentId: session.examStudentId,
      name: session.name,
      examTitle: session.examTitle,
    };
  }

  /** Takes a session read from the session file (a restarted app) instead of joining again. */
  restore(stored: StoredSession): void {
    this.session = {
      target: { ...stored.target },
      token: stored.token,
      examStudentId: stored.examStudentId,
      name: stored.name,
      examTitle: stored.examTitle,
    };
  }

  /** Forgets the session (the student left the exam). */
  forget(): void {
    this.session = null;
  }

  async join(attempt: JoinAttempt): Promise<JoinResult> {
    this.session = null;
    const target: PinnedTarget = {
      address: attempt.address,
      port: attempt.port,
      expectedFingerprint: attempt.fingerprint,
    };
    let deviceId: string;
    try {
      deviceId = await this.deviceId();
    } catch {
      return failure('bad_response');
    }
    try {
      const response = await pinnedRequest(target, {
        method: 'POST',
        path: '/api/v1/join',
        json: {
          studentCode: attempt.studentCode,
          pin: attempt.pin,
          deviceId,
          protocol: PROTOCOL_VERSION,
          // Stub until the agent exists (M21 enforces it).
          agent: { ok: true, helper: true, captureOk: true, monitors: 1 },
        },
      });
      if (response.status !== 200) return serverFailure(response.body);
      const parsed = JoinResponseSchema.safeParse(JSON.parse(response.body) as unknown);
      if (!parsed.success) return failure('bad_response');
      const { examStudentId, name, examTitle } = parsed.data;
      this.session = { target, token: parsed.data.token, examStudentId, name, examTitle };
      return { ok: true, examStudentId, name, examTitle };
    } catch (e) {
      return transportFailure(e);
    }
  }

  /** The student accepted the monitoring notice. */
  async confirm(): Promise<JoinConfirmResult> {
    if (!this.session) return failure('no_session');
    try {
      const response = await pinnedRequest(this.session.target, {
        method: 'POST',
        path: '/api/v1/join/confirm',
        headers: { authorization: `Bearer ${this.session.token}` },
        json: { noticeAccepted: true },
      });
      if (response.status === 401) {
        this.session = null;
        return failure('no_session');
      }
      return response.status === 200 ? { ok: true } : serverFailure(response.body);
    } catch (e) {
      return transportFailure(e);
    }
  }
}
