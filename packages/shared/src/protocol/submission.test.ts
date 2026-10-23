import { describe, expect, it } from 'vitest';
import {
  ReceiptSchema,
  ServerToStudentSchema,
  StudentMessageSchema,
  buildReceiptAnswers,
  canonicalAnswers,
} from '../index.js';

/** A stand-in for SHA-256 (this package has no Node crypto): 64 hex characters, deterministic. */
const sha = (text: string): string => {
  let h = 0x811c9dc5;
  let out = '';
  for (let round = 0; round < 8; round += 1) {
    for (const char of `${text}${round}`) h = Math.imul(h ^ char.charCodeAt(0), 16777619) >>> 0;
    out += h.toString(16).padStart(8, '0');
  }
  return out;
};

describe('buildReceiptAnswers', () => {
  const inputs = [
    { questionId: 'q2', language: 'cpp', content: 'int main(){}' },
    { questionId: 'q1', language: 'text', content: 'héllo' },
  ];

  it('hashes each answer and sorts by question id', () => {
    const { answers } = buildReceiptAnswers(inputs, sha);
    expect(answers.map((a) => a.questionId)).toEqual(['q1', 'q2']);
    expect(answers[0]?.sha256).toBe(sha('héllo'));
  });

  it('does not depend on the order of the input', () => {
    const a = buildReceiptAnswers(inputs, sha);
    const b = buildReceiptAnswers([...inputs].reverse(), sha);
    expect(a).toEqual(b);
  });

  it('hashes the canonical JSON of the answers', () => {
    const { hash, answers } = buildReceiptAnswers(inputs, sha);
    expect(hash).toBe(sha(canonicalAnswers(answers)));
    expect(canonicalAnswers(answers)).toBe(
      JSON.stringify(
        answers.map((a) => ({ questionId: a.questionId, language: a.language, sha256: a.sha256 })),
      ),
    );
  });

  it('changes when the content, the language or the question set changes', () => {
    const first = { questionId: 'q2', language: 'cpp', content: 'int main(){}' };
    const second = { questionId: 'q1', language: 'text', content: 'héllo' };
    const hashOf = (list: (typeof first)[]) => buildReceiptAnswers(list, sha).hash;
    const hashes = [
      hashOf([first, second]),
      hashOf([{ ...first, content: 'x' }, second]),
      hashOf([{ ...first, language: 'c' }, second]),
      hashOf([first]),
    ];
    expect(new Set(hashes).size).toBe(4);
  });

  it('gives an empty submission a hash too', () => {
    expect(buildReceiptAnswers([], sha).hash).toBe(sha('[]'));
  });
});

describe('submit messages', () => {
  const receipt = { hash: sha('a'), submittedAt: 5, answers: [] };

  it('accepts submit from a student and the two replies', () => {
    expect(StudentMessageSchema.safeParse({ t: 'submit', id: 'u1', clientTs: 1 }).success).toBe(
      true,
    );
    expect(ServerToStudentSchema.safeParse({ t: 'submit.result', id: 'u1', receipt }).success).toBe(
      true,
    );
    expect(
      ServerToStudentSchema.safeParse({ t: 'submit.refused', id: 'u1', reason: 'not_running' })
        .success,
    ).toBe(true);
  });

  it('rejects a bad receipt hash and an unknown refusal', () => {
    expect(ReceiptSchema.safeParse({ ...receipt, hash: 'nope' }).success).toBe(false);
    expect(
      ServerToStudentSchema.safeParse({ t: 'submit.refused', id: 'u1', reason: 'because' }).success,
    ).toBe(false);
  });
});
