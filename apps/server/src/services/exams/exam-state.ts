import type { ExamState } from '@examguard/shared';

/** Allowed moves between exam states. Anything not listed is refused. */
const TRANSITIONS: Readonly<Record<ExamState, readonly ExamState[]>> = {
  draft: ['ready'],
  ready: ['draft', 'hosting'],
  hosting: ['ready', 'running'],
  running: ['ended'],
  ended: ['grading'],
  grading: ['in_review'],
  in_review: ['grading', 'finalized'],
  finalized: [],
};

export class InvalidTransitionError extends Error {
  constructor(
    readonly from: ExamState,
    readonly to: ExamState,
  ) {
    super(`An exam cannot go from ${from} to ${to}`);
    this.name = 'InvalidTransitionError';
  }
}

export function canTransition(from: ExamState, to: ExamState): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: ExamState, to: ExamState): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
}

/** Settings can only change, and the exam can only be deleted, before hosting starts. */
export function isEditable(state: ExamState): boolean {
  return state === 'draft' || state === 'ready';
}
