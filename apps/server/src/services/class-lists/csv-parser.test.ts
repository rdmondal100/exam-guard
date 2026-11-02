import { describe, expect, it } from 'vitest';
import { parseClassCsv } from './csv-parser.js';

describe('parseClassCsv', () => {
  it('skips a header row and trims cells', () => {
    const { rows, errors } = parseClassCsv(
      'Student ID,Name\n 101 , Ada Lovelace \n102,Alan Turing\n',
    );
    expect(rows).toEqual([
      { studentCode: '101', name: 'Ada Lovelace' },
      { studentCode: '102', name: 'Alan Turing' },
    ]);
    expect(errors).toEqual([]);
  });

  it('treats the first row as data when it is not a header', () => {
    expect(parseClassCsv('101,Ada\n102,Alan').rows).toHaveLength(2);
  });

  it('strips a BOM so the header is still recognised', () => {
    const { rows } = parseClassCsv('﻿id,name\r\n1,Ada\r\n');
    expect(rows).toEqual([{ studentCode: '1', name: 'Ada' }]);
  });

  it('handles quoted commas, quotes and newlines', () => {
    const { rows } = parseClassCsv('1,"Lovelace, Ada"\n2,"Say ""hi"""\n3,"Two\nLines"\n');
    expect(rows.map((r) => r.name)).toEqual(['Lovelace, Ada', 'Say "hi"', 'Two\nLines']);
  });

  it('reads Excel semicolon CSVs and ignores extra columns', () => {
    const { rows } = parseClassCsv('ID;Name;Email\r\n1;Ada;a@x.io\r\n2;Alan;b@x.io');
    expect(rows).toEqual([
      { studentCode: '1', name: 'Ada' },
      { studentCode: '2', name: 'Alan' },
    ]);
  });

  it('reports blank ID, blank name, duplicates and short rows with line numbers', () => {
    const csv = 'id,name\n1,Ada\n,Bob\n2,\n1,Dup\n3\n4,Eve\n';
    const { rows, errors } = parseClassCsv(csv);
    expect(rows.map((r) => r.studentCode)).toEqual(['1', '4']);
    expect(errors.map((e) => [e.line, e.code])).toEqual([
      [3, 'blank_id'],
      [4, 'blank_name'],
      [5, 'duplicate_id'],
      [6, 'too_few_columns'],
    ]);
  });

  it('keeps line numbers right after a quoted multi-line cell and blank lines', () => {
    const { errors } = parseClassCsv('1,"A\nB"\n\n,Bad\n');
    expect(errors).toMatchObject([{ line: 4, code: 'blank_id' }]);
  });

  it('returns nothing for an empty file', () => {
    expect(parseClassCsv('')).toEqual({ rows: [], errors: [] });
    expect(parseClassCsv('﻿\r\n\r\n')).toEqual({ rows: [], errors: [] });
  });

  it('imports 197 of 200 rows when 3 are bad', () => {
    const lines = ['id,name'];
    for (let i = 1; i <= 200; i += 1) lines.push(`S${i},Student ${i}`);
    lines[11] = ',No Id'; // line 12
    lines[51] = 'S51,'; // line 52
    lines[101] = 'S1,Duplicate'; // line 102
    const { rows, errors } = parseClassCsv(lines.join('\n'));
    expect(rows).toHaveLength(197);
    expect(errors.map((e) => e.line)).toEqual([12, 52, 102]);
  });
});
