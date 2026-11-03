import type { Question, StudentState } from '@examguard/shared';
import type { ResultRow } from '../../db/repositories/results.repo.js';

/** Excel opens a UTF-8 CSV correctly (Bangla names, accents) only with a BOM. */
export const BOM = '﻿';

const STATE_LABEL: Record<StudentState, string> = {
  not_joined: 'Absent',
  lobby: 'Joined',
  active: 'Working',
  locked: 'Locked',
  submitted: 'Submitted',
  ended_by_teacher: 'Ended by teacher',
};

/**
 * One CSV cell: quoted when it holds a comma, quote or line break. Text that Excel would run as a
 * formula (`=`, `+`, `-`, `@`, tab, CR at the start) gets a leading `'`, so a student name cannot
 * become a formula on the teacher's PC.
 */
export function csvCell(value: string | number | null): string {
  if (value === null) return '';
  let text = String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const marks = (half: number) => half / 2;
const minutes = (ms: number) => Math.round(ms / 6000) / 10;

/**
 * The results file (requirements §8.10): student ID, name, status, marks per question, total,
 * events by severity and the time outside ExamGuard, one line per student of the exam (absent
 * students too, with no marks). CRLF line ends and a BOM, as Excel expects.
 */
export function buildResultsCsv(
  questions: readonly Question[],
  rows: readonly ResultRow[],
): string {
  const ordered = [...questions].sort((a, b) => a.position - b.position);
  const max = ordered.reduce((sum, q) => sum + q.marks, 0);
  const header = [
    'Student ID',
    'Name',
    'Status',
    ...ordered.map((q) => `Q${q.position} (${q.marks})`),
    `Total (${max})`,
    'Low events',
    'Medium events',
    'High events',
    'Critical events',
    'Outside ExamGuard (min)',
  ];
  const lines = rows.map((r) => {
    const per = ordered.map((q) => r.marks.get(q.id) ?? null);
    const graded = per.filter((m): m is number => m !== null);
    const total = graded.length > 0 ? marks(graded.reduce((a, b) => a + b, 0)) : null;
    return [
      csvCell(r.studentCode),
      csvCell(r.name),
      csvCell(STATE_LABEL[r.state]),
      ...per.map((m) => csvCell(m === null ? null : marks(m))),
      csvCell(total),
      csvCell(r.events.low),
      csvCell(r.events.medium),
      csvCell(r.events.high),
      csvCell(r.events.critical),
      csvCell(minutes(r.outsideMs)),
    ].join(',');
  });
  return `${BOM}${[header.map(csvCell).join(','), ...lines].join('\r\n')}\r\n`;
}

/** `exports/<examTitle>_<yyyyMMdd-HHmm>.csv` (data-model), with characters Windows refuses replaced. */
export function exportFileName(title: string, at: Date): string {
  const safe =
    title
      // eslint-disable-next-line no-control-regex
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
      .replace(/[. ]+$/, '')
      .trim()
      .slice(0, 80) || 'exam';
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${at.getFullYear()}${p(at.getMonth() + 1)}${p(at.getDate())}-${p(at.getHours())}${p(at.getMinutes())}`;
  return `${safe}_${stamp}.csv`;
}
