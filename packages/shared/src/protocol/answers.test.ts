import { describe, expect, it } from 'vitest';
import { AnswerSnapshotSchema, RestoreResultSchema } from './answers.js';

describe('answer snapshot schemas', () => {
  it('accepts a snapshot with null flags', () => {
    const snapshot = {
      buffers: [
        { questionId: 'q1', language: 'c', content: 'int main(){}', flags: null, clientSeq: 4 },
      ],
      selected: [{ questionId: 'q1', language: 'c', clientSeq: 4 }],
    };
    expect(AnswerSnapshotSchema.parse(snapshot)).toEqual(snapshot);
  });

  it('rejects a buffer without content', () => {
    const bad = {
      buffers: [{ questionId: 'q1', language: 'c', flags: null, clientSeq: 1 }],
      selected: [],
    };
    expect(AnswerSnapshotSchema.safeParse(bad).success).toBe(false);
  });

  it('tells a restore result from a failure', () => {
    expect(RestoreResultSchema.safeParse({ ok: false, message: 'offline' }).success).toBe(true);
    expect(RestoreResultSchema.safeParse({ ok: true, message: 'x' }).success).toBe(false);
  });
});
