import type { ExamState, InternetActionResult, InternetState } from '@examguard/shared';
import type { ExamRepo } from '../db/exam-repo.js';
import type { TeacherActionRepo } from '../db/teacher-action-repo.js';
import type { SessionHub } from '../ws/session-hub.js';
import { HostingError } from './hosting-error.js';

export interface InternetSwitchDeps {
  exams: ExamRepo;
  actions: TeacherActionRepo;
  hub: SessionHub;
  now: () => number;
}

/**
 * The teacher's internet switch. The setting lives on `exams`, is pushed to every connected
 * student as `state.internet`, and is part of the welcome. The student apps apply it through their
 * agent and report back (`internet.status`), which the roster shows.
 */
export class InternetSwitch {
  constructor(private readonly deps: InternetSwitchDeps) {}

  /** What students get. An unknown exam has the internet allowed. */
  state(examId: string): InternetState {
    return this.deps.exams.internetBlocked(examId) ? 'blocked' : 'allowed';
  }

  /** The teacher's on/off. Allowed while hosting or running. */
  set(examId: string, allowed: boolean): InternetActionResult {
    const examState: ExamState | undefined = this.deps.exams.get(examId)?.state;
    if (!examState) throw new HostingError(404, 'not_found', 'Exam not found');
    if (examState !== 'hosting' && examState !== 'running') {
      throw new HostingError(
        409,
        'invalid_state',
        `The internet cannot be changed in a ${examState} exam`,
      );
    }
    const now = this.deps.now();
    this.deps.exams.setInternetBlocked(examId, !allowed, now);
    this.deps.actions.insert({
      examId,
      examStudentId: null,
      action: 'internet',
      payload: { enabled: allowed },
      ts: now,
    });
    this.push(examId);
    return { ok: true, internet: this.state(examId) };
  }

  /** A new hosting starts with the internet allowed, whatever an earlier one left. */
  reset(examId: string): void {
    if (this.deps.exams.internetBlocked(examId)) {
      this.deps.exams.setInternetBlocked(examId, false, this.deps.now());
    }
  }

  private push(examId: string): void {
    const internet = this.state(examId);
    this.deps.hub.broadcast(() => ({ t: 'state', state: { internet } }));
  }
}
