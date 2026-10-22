import type { TerminalState } from '@examguard/shared';
import type { Db } from './connection.js';

export interface TerminalSetting extends TerminalState {
  /** "On for N minutes" chosen before Start, counted from `started_at`; `null` once counting. */
  pendingMinutes: number | null;
}

interface Row {
  terminal_enabled: number;
  terminal_minutes: number | null;
  terminal_until: number | null;
}

/** The terminal columns of `exams` (migration 0006). */
export class TerminalRepo {
  constructor(private readonly db: Db) {}

  get(examId: string): TerminalSetting | undefined {
    const row = this.db
      .prepare('SELECT terminal_enabled, terminal_minutes, terminal_until FROM exams WHERE id = ?')
      .get(examId) as Row | undefined;
    return (
      row && {
        enabled: row.terminal_enabled === 1,
        until: row.terminal_until,
        pendingMinutes: row.terminal_minutes,
      }
    );
  }

  set(examId: string, setting: TerminalSetting, now: number): void {
    this.db
      .prepare(
        `UPDATE exams SET terminal_enabled = ?, terminal_minutes = ?, terminal_until = ?,
           updated_at = ? WHERE id = ?`,
      )
      .run(setting.enabled ? 1 : 0, setting.pendingMinutes, setting.until, now, examId);
  }
}
