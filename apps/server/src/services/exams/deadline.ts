export interface DeadlineInput {
  /** Exam start, ms since the epoch. Late joiners use this too, so everyone shares one end. */
  startedAt: number;
  durationSec: number;
  globalExtensionSec: number;
  studentExtensionSec: number;
  /** Time the exam stood paused (M58), ms; the end moves by it. */
  pausedMs?: number;
}

/** When a student's exam ends, in ms since the epoch (docs/architecture.md §6). */
export function computeDeadline(input: DeadlineInput): number {
  const totalSec = input.durationSec + input.globalExtensionSec + input.studentExtensionSec;
  return input.startedAt + totalSec * 1000 + (input.pausedMs ?? 0);
}
