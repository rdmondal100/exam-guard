/**
 * The student's own programs that the app started: the program of a run and the exam terminal's
 * shell. A window of one of these counts as inside the exam, so a graphics program the student is
 * testing is not reported as leaving it.
 */
export class OwnProcesses {
  private readonly slots = new Map<string, number>();

  /** The process in `slot` started (its pid) or ended (`null`). */
  set(slot: 'run' | 'compile' | 'terminal', pid: number | null): void {
    if (pid === null) this.slots.delete(slot);
    else this.slots.set(slot, pid);
  }

  has(pid: number): boolean {
    for (const own of this.slots.values()) if (own === pid) return true;
    return false;
  }
}
