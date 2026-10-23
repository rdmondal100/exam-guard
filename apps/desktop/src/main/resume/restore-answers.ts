import {
  AnswerSnapshotSchema,
  type AnswerSave,
  type AnswerSnapshot,
  type RestoreResult,
} from '@examguard/shared';
import { PinError, pinnedRequest, type PinnedTarget } from '../tls-pin.js';
import { mergeRestore } from './restore-merge.js';

export interface RestoreAnswersDeps {
  /** Saves the server has not acked: they may be newer than anything it holds. */
  unacked: () => AnswerSave[];
  /** True when the server already stores a version for this student (from the last welcome). */
  serverHasAnswers: () => boolean;
  fetchSnapshot: () => Promise<AnswerSnapshot>;
}

/**
 * Builds what the editors should show after a restart. The server is asked only when its welcome
 * said it holds versions, so a student with nothing saved starts at once even with a slow link.
 * When the server cannot be reached the result is a failure, not an empty answer: the screen must
 * not let the student type over work that is still safe on the server.
 */
export async function restoreAnswers(deps: RestoreAnswersDeps): Promise<RestoreResult> {
  let snapshot: AnswerSnapshot | null = null;
  if (deps.serverHasAnswers()) {
    try {
      snapshot = await deps.fetchSnapshot();
    } catch (e) {
      return {
        ok: false,
        message:
          e instanceof Error && e.message
            ? `Could not load your saved work: ${e.message}`
            : 'Could not load your saved work.',
      };
    }
  }
  return { ok: true, answers: mergeRestore(snapshot, deps.unacked()) };
}

/** `GET /answers/latest` over the pinned connection with the session token. */
export async function fetchAnswerSnapshot(
  target: PinnedTarget,
  token: string,
): Promise<AnswerSnapshot> {
  let response;
  try {
    response = await pinnedRequest(target, {
      path: '/api/v1/answers/latest',
      headers: { authorization: `Bearer ${token}` },
    });
  } catch (e) {
    throw new Error(e instanceof PinError ? 'the teacher computer cannot be reached' : String(e), {
      cause: e,
    });
  }
  if (response.status !== 200) throw new Error(`the teacher computer answered ${response.status}`);
  const parsed = AnswerSnapshotSchema.safeParse(JSON.parse(response.body) as unknown);
  if (!parsed.success) throw new Error('the teacher computer sent an unexpected answer');
  return parsed.data;
}
