import { describe, expect, it } from 'vitest';
import type { AnswerDetail, GradingStatus, ReviewRow } from '@examguard/shared';
import {
  attentionFirst,
  draftBody,
  draftFrom,
  draftProblems,
  draftTotal,
  gradingAction,
  isLowConfidence,
  jobProgress,
  marksText,
} from './grading';

const counts = (over: Partial<GradingStatus['questions'][number]> = {}) => ({
  questionId: 'q1',
  position: 1,
  answers: 2,
  pending: 0,
  aiGraded: 2,
  verified: 0,
  modified: 0,
  needsManual: 0,
  lowConfidence: 0,
  ...over,
});
const status = (examState: GradingStatus['examState'], q = counts()): GradingStatus => ({
  examId: 'e1',
  examState,
  provider: 'fake',
  jobs: [],
  questions: [q],
});
const row = (code: string, over: Partial<ReviewRow> = {}): ReviewRow => ({
  examStudentId: `s${code}`,
  studentCode: code,
  name: code,
  language: 'c',
  status: 'ai_graded',
  total: 1,
  confidence: 'high',
  empty: false,
  updatedAt: 1,
  ...over,
});

describe('grading panel logic', () => {
  it('offers start after the exam, stop while grading, the rest only when some are left', () => {
    expect(gradingAction(status('ended'))?.label).toBe('Evaluate with AI');
    expect(gradingAction(status('grading'))?.kind).toBe('stop');
    expect(gradingAction(status('in_review'))).toBeNull();
    expect(gradingAction(status('in_review', counts({ needsManual: 1 })))?.kind).toBe('start');
    expect(gradingAction(status('finalized', counts({ pending: 1 })))).toBeNull();
  });

  it('measures job progress', () => {
    const job = { total: 4, done: 1, failed: 1 } as Parameters<typeof jobProgress>[0];
    expect(jobProgress(job)).toBe(0.5);
    expect(jobProgress({ ...job, total: 0 })).toBe(1);
  });

  it('puts what needs attention first and highlights low confidence', () => {
    const rows = [
      row('3'),
      row('1', { status: 'verified' }),
      row('2', { confidence: 'low' }),
      row('4', { status: 'needs_manual', total: null }),
    ];
    expect(attentionFirst(rows).map((r) => r.studentCode)).toEqual(['4', '2', '3', '1']);
    expect(isLowConfidence(row('5', { confidence: 'low', status: 'verified' }))).toBe(false);
  });
});

describe('grade draft (M40)', () => {
  const guide = [
    { name: 'Logic', maxMarks: 5 },
    { name: 'Style', maxMarks: 1 },
  ];
  const detail = {
    current: {
      criteria: [{ name: 'Logic', max: 5, awarded: 4.5, reason: 'ok' }],
      feedback: 'Fine',
    },
  } as unknown as AnswerDetail;

  it('starts from the current grade and checks each mark', () => {
    const draft = draftFrom(detail, guide);
    const [logic, style] = draft.criteria;
    if (!logic || !style) throw new Error('two criteria expected');
    expect(draft.criteria.map((c) => c.awarded)).toEqual(['4.5', '0']);
    expect(draftTotal(draft)).toBe(4.5);
    expect(draftProblems(draft)).toEqual([]);
    const bad = {
      ...draft,
      criteria: [
        { ...logic, awarded: '6' },
        { ...style, awarded: '0.3' },
      ],
    };
    expect(draftProblems(bad)).toEqual(['Logic: between 0 and 5.', 'Style: steps of 0.5.']);
    expect(draftProblems({ ...draft, criteria: [{ ...logic, awarded: '' }] })).toEqual([
      'Logic: enter a number.',
    ]);
    expect(draftBody(draft)).toEqual({
      criteria: [
        { name: 'Logic', awarded: 4.5, reason: 'ok' },
        { name: 'Style', awarded: 0, reason: '' },
      ],
      feedback: 'Fine',
    });
    expect(marksText(null, 8)).toBe('— / 8');
  });
});
