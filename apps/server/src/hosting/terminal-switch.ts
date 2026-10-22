import type { ExamState, TerminalActionResult, TerminalState } from '@examguard/shared';
import type { TeacherActionRepo } from '../db/teacher-action-repo.js';
import type { TerminalRepo, TerminalSetting } from '../db/terminal-repo.js';
import type { SessionHub } from '../ws/session-hub.js';
import { HostingError } from './hosting-error.js';

export interface TerminalSwitchDeps {
  terminals: TerminalRepo;
  actions: TeacherActionRepo;
  hub: SessionHub;
  /** The exam's current state, or `undefined` if it does not exist. */
  examState: (examId: string) => ExamState | undefined;
  now: () => number;
}

const OFF: TerminalSetting = { enabled: false, until: null, pendingMinutes: null };

/**
 * The teacher's exam terminal switch. The setting lives on `exams` (server time), is pushed to
 * every connected student as `state.terminal`, and turns itself off when an "N minutes" window
 * runs out: a timer at `until`, with the 1 s deadline watcher calling `check` as a backstop.
 */
export class TerminalSwitch {
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly deps: TerminalSwitchDeps) {}

  /** What students get. An unknown exam has the terminal off. */
  state(examId: string): TerminalState {
    const setting = this.deps.terminals.get(examId) ?? OFF;
    return { enabled: setting.enabled, until: setting.until };
  }

  pendingMinutes(examId: string): number | null {
    return this.deps.terminals.get(examId)?.pendingMinutes ?? null;
  }

  /**
   * The teacher's on/off. Allowed while hosting or running. "On for N minutes" counts from now
   * when the exam is running, else from Start.
   */
  set(examId: string, enabled: boolean, minutes?: number): TerminalActionResult {
    const examState = this.deps.examState(examId);
    if (!examState) throw new HostingError(404, 'not_found', 'Exam not found');
    if (examState !== 'hosting' && examState !== 'running') {
      throw new HostingError(
        409,
        'invalid_state',
        `The terminal cannot be changed in a ${examState} exam`,
      );
    }
    const now = this.deps.now();
    let setting = OFF;
    if (enabled && minutes === undefined) setting = { enabled, until: null, pendingMinutes: null };
    else if (enabled && minutes !== undefined) {
      setting =
        examState === 'running'
          ? { enabled, until: now + minutes * 60_000, pendingMinutes: null }
          : { enabled, until: null, pendingMinutes: minutes };
    }
    this.deps.terminals.set(examId, setting, now);
    this.deps.actions.insert({
      examId,
      examStudentId: null,
      action: 'terminal',
      payload: minutes === undefined || !enabled ? { enabled } : { enabled, minutes },
      ts: now,
    });
    this.push(examId);
    this.arm(examId);
    return { ok: true, terminal: this.state(examId), pendingMinutes: setting.pendingMinutes };
  }

  /** At Start: a pending "N minutes" window begins counting. Call before the state broadcast. */
  examStarted(examId: string, startedAt: number): void {
    const setting = this.deps.terminals.get(examId);
    if (setting?.enabled && setting.pendingMinutes !== null) {
      this.deps.terminals.set(
        examId,
        { enabled: true, until: startedAt + setting.pendingMinutes * 60_000, pendingMinutes: null },
        startedAt,
      );
    }
    this.arm(examId);
  }

  /** Sets the timer for the current window (after a change, at Start and on resume). */
  arm(examId: string): void {
    this.disarm();
    const setting = this.deps.terminals.get(examId);
    if (!setting?.enabled || setting.until === null) return;
    if (this.deps.examState(examId) !== 'running') return;
    const fire = () => {
      this.timer = null;
      this.check(examId);
    };
    this.timer = setTimeout(fire, Math.max(0, setting.until - this.deps.now()));
    this.timer.unref();
  }

  /** Turns the terminal off once its window has passed. Safe to call at any time. */
  check(examId: string): void {
    const setting = this.deps.terminals.get(examId);
    if (!setting?.enabled || setting.until === null) return;
    const now = this.deps.now();
    if (now < setting.until) {
      // A timer can fire a little early; try again at the real end.
      if (!this.timer) this.arm(examId);
      return;
    }
    this.disarm();
    this.deps.terminals.set(examId, OFF, now);
    this.deps.actions.insert({
      examId,
      examStudentId: null,
      action: 'terminal',
      payload: { enabled: false, reason: 'time_up' },
      ts: now,
    });
    this.push(examId);
  }

  disarm(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private push(examId: string): void {
    const terminal = this.state(examId);
    this.deps.hub.broadcast(() => ({ t: 'state', state: { terminal } }));
  }
}
