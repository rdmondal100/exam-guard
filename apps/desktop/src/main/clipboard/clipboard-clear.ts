import type { SessionState } from '@examguard/shared';
import { examWorking } from '../exam-working.js';

/**
 * Clears the system clipboard when the student starts working on the exam (M25, requirements
 * §8.5), so nothing copied before the start can be pasted. It clears again only after the student
 * stopped working and started again (a new exam, or the app was started again mid-exam).
 */
export class ClipboardClear {
  private working = false;

  constructor(private readonly clear: () => void) {}

  onExam(exam: SessionState | null): void {
    const working = examWorking(exam);
    if (working && !this.working) this.clear();
    this.working = working;
  }

  /** The session ended (Leave); the next start clears again. */
  reset(): void {
    this.working = false;
  }
}
