import Papa from 'papaparse';
import type { ClassStudentRow, CsvRowError, CsvRowErrorCode } from '@examguard/shared';

export interface ParsedClassCsv {
  rows: ClassStudentRow[];
  errors: CsvRowError[];
}

const ID_HEADERS = new Set([
  'id',
  'studentid',
  'student_id',
  'studentcode',
  'student_code',
  'code',
]);
const NAME_HEADERS = new Set(['name', 'studentname', 'student_name', 'fullname', 'full_name']);

const MESSAGES: Record<CsvRowErrorCode, string> = {
  blank_id: 'Student ID is blank',
  blank_name: 'Name is blank',
  duplicate_id: 'Student ID appears earlier in the file',
  too_few_columns: 'Row needs a student ID and a name',
};

function normalizeHeader(cell: string | undefined): string {
  return (cell ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '');
}

function isHeaderRow(cells: string[]): boolean {
  return ID_HEADERS.has(normalizeHeader(cells[0])) && NAME_HEADERS.has(normalizeHeader(cells[1]));
}

function lineAt(text: string, offset: number): number {
  let start = offset;
  while (start < text.length && (text[start] === '\n' || text[start] === '\r')) start += 1;
  let line = 1;
  for (let i = 0; i < start; i += 1) if (text[i] === '\n') line += 1;
  return line;
}

/**
 * Reads a class list CSV: column 1 is the student ID, column 2 the name. A header row is
 * skipped when it looks like one. Bad rows are reported with their 1-based line and not imported;
 * for a repeated ID the first row wins. Handles a BOM, quotes, CRLF and `;`-separated Excel files.
 */
export function parseClassCsv(csvText: string): ParsedClassCsv {
  const text = csvText.charCodeAt(0) === 0xfeff ? csvText.slice(1) : csvText;
  const rows: ClassStudentRow[] = [];
  const errors: CsvRowError[] = [];
  const seen = new Set<string>();
  let rowStart = 0;
  let first = true;

  Papa.parse<string[]>(text, {
    skipEmptyLines: 'greedy',
    step: (result) => {
      const cells = result.data;
      const line = lineAt(text, rowStart);
      rowStart = result.meta.cursor;
      const isFirst = first;
      first = false;
      if (isFirst && isHeaderRow(cells)) return;

      const fail = (code: CsvRowErrorCode) =>
        errors.push({ line, code, message: MESSAGES[code], raw: cells.join(',') });
      if (cells.length < 2) return fail('too_few_columns');
      const studentCode = (cells[0] ?? '').trim();
      const name = (cells[1] ?? '').trim();
      if (studentCode === '') return fail('blank_id');
      if (name === '') return fail('blank_name');
      if (seen.has(studentCode)) return fail('duplicate_id');
      seen.add(studentCode);
      rows.push({ studentCode, name });
    },
  });
  return { rows, errors };
}
