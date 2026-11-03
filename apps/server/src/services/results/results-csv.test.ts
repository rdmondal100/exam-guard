import { describe, expect, it } from 'vitest';
import type { Question } from '@examguard/shared';
import type { ResultRow } from '../../db/repositories/results.repo.js';
import { BOM, buildResultsCsv, csvCell, exportFileName } from './results-csv.js';

const question = (id: string, position: number, marks: number) =>
  ({ id, position, marks }) as unknown as Question;

const row = (over: Partial<ResultRow>): ResultRow => ({
  examStudentId: 's',
  studentCode: '1',
  name: 'A',
  state: 'submitted',
  outsideMs: 0,
  marks: new Map(),
  events: { low: 0, medium: 0, high: 0, critical: 0 },
  ...over,
});

describe('results CSV (M42)', () => {
  it('quotes commas, quotes and line breaks, and defuses formulas', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('Rahman, Ali')).toBe('"Rahman, Ali"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('a\nb')).toBe('"a\nb"');
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('-1')).toBe("'-1");
    expect(csvCell(-1)).toBe('-1');
    expect(csvCell(null)).toBe('');
  });

  it('has the required columns, marks per question in order, total, events and outside time', () => {
    const csv = buildResultsCsv(
      [question('q2', 2, 5), question('q1', 1, 8)],
      [
        row({
          studentCode: '2',
          name: 'Nusrat Jahan',
          marks: new Map([
            ['q1', 15],
            ['q2', 6],
          ]),
          events: { low: 3, medium: 1, high: 2, critical: 0 },
          outsideMs: 95_000,
        }),
        row({ studentCode: '3', name: 'Absent One', state: 'not_joined' }),
      ],
    );
    expect(csv.startsWith(BOM)).toBe(true);
    const lines = csv.slice(1).split('\r\n');
    expect(lines[0]).toBe(
      'Student ID,Name,Status,Q1 (8),Q2 (5),Total (13),Low events,Medium events,High events,Critical events,Outside ExamGuard (min)',
    );
    expect(lines[1]).toBe('2,Nusrat Jahan,Submitted,7.5,3,10.5,3,1,2,0,1.6');
    expect(lines[2]).toBe('3,Absent One,Absent,,,,0,0,0,0,0');
    expect(lines[3]).toBe('');
  });

  it('names the export after the exam and the time, without characters Windows refuses', () => {
    const at = new Date(2026, 10, 3, 9, 5);
    expect(exportFileName('CSE 101: Mid/Term?', at)).toBe('CSE 101_ Mid_Term__20261103-0905.csv');
    expect(exportFileName('...', at)).toBe('exam_20261103-0905.csv');
  });
});
