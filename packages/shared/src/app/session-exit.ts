import type { SessionState, SessionStatus } from '../protocol/ws.js';

export type SessionExit = 'exam_over' | 'session_failed';

/** The server's default grace (`DEFAULT_MONITORING.graceSec`) for a state without `graceSec`. */
const DEFAULT_GRACE_SEC = 60;
/** Slack for the server's watcher, which finalizes a student a moment after deadline + grace. */
const WATCHER_SLACK_MS = 5000;

/**
 * Why a student who is still "working" can no longer continue, so the locked window must let go:
 * the session failed for good (replaced by another PC, unauthorized, a pin mismatch), or the link
 * is down and the student's deadline plus grace has passed, which means the server has already
 * finalized their answers and cannot tell them (its listener is closed once the exam ended).
 * `nowMs` is the local clock; the estimated server offset is applied here.
 */
export function sessionExit(
  exam: Pick<SessionState, 'deadline' | 'graceSec'>,
  status: Pick<SessionStatus, 'link' | 'offsetMs'>,
  nowMs: number,
): SessionExit | null {
  if (status.link === 'connected') return null;
  if (status.link === 'failed') return 'session_failed';
  if (exam.deadline === null) return null;
  const serverNow = nowMs + (status.offsetMs ?? 0);
  const graceMs = (exam.graceSec ?? DEFAULT_GRACE_SEC) * 1000;
  return serverNow > exam.deadline + graceMs + WATCHER_SLACK_MS ? 'exam_over' : null;
}
