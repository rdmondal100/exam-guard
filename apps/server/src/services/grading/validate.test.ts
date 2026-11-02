import { describe, expect, it } from 'vitest';
import { repairHint, validateGrade } from './validate.js';

const GUIDE = [
  { name: 'Correct logic', maxMarks: 5 },
  { name: 'Uses a loop', maxMarks: 2 },
  { name: 'Code style', maxMarks: 1.5 },
];

const reply = (patch: Record<string, unknown> = {}) =>
  JSON.stringify({
    criteria: [
      { name: 'Correct logic', max: 5, awarded: 4.5, reason: 'ok' },
      { name: 'Uses a loop', max: 2, awarded: 2, reason: 'for loop' },
      { name: 'Code style', max: 1.5, awarded: 0.5, reason: 'names' },
    ],
    total: 7,
    feedback: 'Good work.',
    teacher_notes: [{ line: 3, issue: 'unclear name' }],
    confidence: 'high',
    ...patch,
  });

const problemsOf = (text: string) => {
  const check = validateGrade(text, GUIDE);
  return check.ok ? [] : check.problems;
};

describe('validateGrade', () => {
  it('accepts a valid reply and converts marks to half-units in guide order', () => {
    const check = validateGrade(reply(), GUIDE);
    expect(check).toEqual({
      ok: true,
      grade: {
        criteria: [
          { name: 'Correct logic', max: 10, awarded: 9, reason: 'ok' },
          { name: 'Uses a loop', max: 4, awarded: 4, reason: 'for loop' },
          { name: 'Code style', max: 3, awarded: 1, reason: 'names' },
        ],
        total: 14,
        feedback: 'Good work.',
        teacherNotes: [{ line: 3, issue: 'unclear name' }],
        confidence: 'high',
      },
    });
  });

  it('accepts a fenced reply, other case and order, and keeps the guide names', () => {
    const text = `\`\`\`json\n${reply({
      criteria: [
        { name: 'code STYLE ', max: 1.5, awarded: 1.5, reason: '' },
        { name: 'uses a loop', max: 2, awarded: 0, reason: '' },
        { name: 'Correct logic', max: 5, awarded: 5, reason: '' },
      ],
      total: 6.5,
    })}\n\`\`\``;
    const check = validateGrade(text, GUIDE);
    expect(check.ok && check.grade.criteria.map((c) => c.name)).toEqual(GUIDE.map((g) => g.name));
    expect(check.ok && check.grade.total).toBe(13);
  });

  it('rejects text that is not JSON or has the wrong shape', () => {
    expect(problemsOf('Here is the grade: 7')).toEqual(['The reply is not valid JSON.']);
    expect(problemsOf(reply({ confidence: 'sure' }))[0]).toMatch(/^confidence:/);
    expect(problemsOf(JSON.stringify({ total: 1 })).length).toBeGreaterThan(1);
  });

  it('rejects awarded above max, below zero and off the half steps', () => {
    const with0 = (awarded: number) =>
      reply({
        criteria: [
          { name: 'Correct logic', max: 5, awarded, reason: '' },
          { name: 'Uses a loop', max: 2, awarded: 2, reason: '' },
          { name: 'Code style', max: 1.5, awarded: 0.5, reason: '' },
        ],
      });
    expect(problemsOf(with0(5.5))).toEqual(['"Correct logic": 5.5 is outside 0 to 5.']);
    expect(problemsOf(with0(-1))).toEqual(['"Correct logic": -1 is outside 0 to 5.']);
    expect(problemsOf(with0(4.3))).toEqual(['"Correct logic": 4.3 is not a step of 0.5.']);
  });

  it('rejects missing, unknown and duplicate criteria and a changed max', () => {
    const problems = problemsOf(
      reply({
        criteria: [
          { name: 'Correct logic', max: 6, awarded: 4, reason: '' },
          { name: 'Correct logic', max: 5, awarded: 4, reason: '' },
          { name: 'Efficiency', max: 2, awarded: 2, reason: '' },
        ],
      }),
    );
    expect(problems).toEqual([
      'Criterion "Correct logic" appears twice.',
      '"Efficiency" is not one of the marking criteria.',
      'Criterion "Uses a loop" is missing.',
      'Criterion "Code style" is missing.',
    ]);
    const changedMax = problemsOf(
      reply({
        criteria: [
          { name: 'Correct logic', max: 6, awarded: 4.5, reason: '' },
          { name: 'Uses a loop', max: 2, awarded: 2, reason: '' },
          { name: 'Code style', max: 1.5, awarded: 0.5, reason: '' },
        ],
      }),
    );
    expect(changedMax).toEqual(['"Correct logic" has max 5, not 6.']);
  });

  it('rejects a total that is not the sum, empty feedback and a bad line number', () => {
    expect(problemsOf(reply({ total: 8 }))).toEqual(['"total" is 8 but the criteria add up to 7.']);
    expect(problemsOf(reply({ feedback: '  ' }))).toEqual(['"feedback" is empty.']);
    expect(problemsOf(reply({ teacher_notes: [{ line: 0, issue: 'x' }] }))).toEqual([
      'teacher_notes line 0 must be 1 or more.',
    ]);
  });
});

describe('repairHint', () => {
  it('lists the problems, at most eight', () => {
    const many = Array.from({ length: 10 }, (_, i) => `p${i}`);
    expect(repairHint(many).split('\n')).toEqual([...many.slice(0, 8), '(and 2 more)']);
    expect(repairHint(['one'])).toBe('one');
  });
});
