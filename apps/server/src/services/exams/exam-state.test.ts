import { describe, expect, it } from 'vitest';
import { ExamStateSchema, type ExamState } from '@examguard/shared';
import {
  assertTransition,
  canTransition,
  InvalidTransitionError,
  isEditable,
} from './exam-state.js';

const ALLOWED: [ExamState, ExamState][] = [
  ['draft', 'ready'],
  ['ready', 'draft'],
  ['ready', 'hosting'],
  ['hosting', 'ready'],
  ['hosting', 'running'],
  ['running', 'ended'],
  ['ended', 'grading'],
  ['grading', 'in_review'],
  ['in_review', 'grading'],
  ['in_review', 'finalized'],
];

describe('exam state machine', () => {
  it('allows exactly the listed transitions', () => {
    for (const from of ExamStateSchema.options) {
      for (const to of ExamStateSchema.options) {
        const expected = ALLOWED.some(([a, b]) => a === from && b === to);
        expect(canTransition(from, to), `${from} -> ${to}`).toBe(expected);
      }
    }
  });

  it('throws InvalidTransitionError for a refused move', () => {
    expect(() => assertTransition('draft', 'running')).toThrow(InvalidTransitionError);
    expect(() => assertTransition('finalized', 'draft')).toThrow('cannot go from finalized');
    expect(() => assertTransition('draft', 'ready')).not.toThrow();
  });

  it('is editable only in draft and ready', () => {
    const editable = ExamStateSchema.options.filter(isEditable);
    expect(editable).toEqual(['draft', 'ready']);
  });
});
