import { join } from 'node:path';
import { ipcMain } from 'electron';
import type { JoinResult, SessionState, SessionStatus } from '@examguard/shared';
import { IPC } from '../../shared/ipc-channels.js';
import type { JoinClient } from '../join-client.js';
import type { SessionClient } from '../session-client.js';
import { OfflineQueue } from './offline-queue.js';
import { fetchAnswerSnapshot, restoreAnswers } from './restore-answers.js';
import type { SecretBox } from './secret-box.js';
import { SessionStore } from './session-store.js';

export interface ResumeIpcDeps {
  userData: string;
  box: SecretBox;
  session: SessionClient;
  join: JoinClient;
  requireStudent: () => void;
}

const ENDED = new Set(['ended', 'grading', 'in_review', 'finalized']);

export interface ResumeHooks {
  /** The student accepted the notice: keep the session so a restart can rejoin. */
  afterConfirm: () => void;
  /** The disk queue for this student, opened by `session:start`. */
  queue: () => OfflineQueue | undefined;
  onStatus: (status: SessionStatus) => void;
  onExam: (exam: SessionState) => void;
}

/**
 * Same-PC resume. The session file and the offline queue live in userData, encrypted. The queue
 * is named after the student's row, so leaving and joining again finds the same file.
 */
export function registerResumeIpc(deps: ResumeIpcDeps): ResumeHooks {
  const { userData, box, session, join: joinClient, requireStudent } = deps;
  const store = new SessionStore(join(userData, 'session', 'session.enc'), box);
  let queue: OfflineQueue | undefined;

  ipcMain.handle(IPC.resumeSession, (): JoinResult | null => {
    requireStudent();
    const stored = store.load();
    if (!stored) return null;
    joinClient.restore(stored);
    return {
      ok: true,
      examStudentId: stored.examStudentId,
      name: stored.name,
      examTitle: stored.examTitle,
    };
  });

  ipcMain.handle(IPC.leaveSession, () => {
    requireStudent();
    session.stop();
    store.clear();
    joinClient.forget();
  });

  ipcMain.handle(IPC.restoreAnswers, () => {
    requireStudent();
    const credentials = joinClient.credentials();
    return restoreAnswers({
      unacked: () => session.unackedSaves(),
      serverHasAnswers: () => (session.examState?.saved.length ?? 0) > 0,
      fetchSnapshot: async () => {
        if (!credentials) throw new Error('you are not signed in');
        return fetchAnswerSnapshot(credentials.target, credentials.token);
      },
    });
  });

  return {
    afterConfirm: () => {
      const snapshot = joinClient.snapshot();
      if (snapshot) store.save(snapshot);
    },
    queue: () => {
      const id = joinClient.examStudentId();
      if (!id) return undefined;
      queue = new OfflineQueue(
        join(userData, 'queue', `${id.replace(/[^A-Za-z0-9_-]/g, '_')}.jsonl`),
        box,
      );
      return queue;
    },
    onStatus: (status) => {
      // The server no longer knows this token: resuming with it can never work.
      if (status.link === 'failed' && status.reason === 'unauthorized') store.clear();
    },
    onExam: (exam) => {
      // Once the answers are final nothing more can be stored, so unsent saves are moot. The
      // session file stays until the exam ends, so a restart still shows the receipt.
      if (exam.receipt) queue?.clear();
      if (!ENDED.has(exam.examState)) return;
      store.clear();
      queue?.clear();
    },
  };
}
