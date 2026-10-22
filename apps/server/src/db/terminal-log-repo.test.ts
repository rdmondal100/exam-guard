import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from './connection.js';
import { initDatabase } from './database.js';
import { MAX_TRANSCRIPT_CHARS, TRUNCATED_MARKER, TerminalLogRepo } from './terminal-log-repo.js';

let dir: string;
let db: Db;
let repo: TerminalLogRepo;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'eg-tlog-'));
  db = initDatabase(dir);
  db.exec(`
    INSERT INTO class_lists (id, name, created_at) VALUES ('l1', 'CSE', 1);
    INSERT INTO class_students (id, class_list_id, student_code, name) VALUES ('c1', 'l1', '1', 'Ada');
    INSERT INTO class_students (id, class_list_id, student_code, name) VALUES ('c2', 'l1', '2', 'Bob');
    INSERT INTO exams (id, title, duration_sec, monitoring_json, created_at, updated_at)
      VALUES ('e1', 'Mid', 3600, '{}', 1, 1);
    INSERT INTO exam_students (id, exam_id, class_student_id, anon_id) VALUES ('s1', 'e1', 'c1', 'a');
    INSERT INTO exam_students (id, exam_id, class_student_id, anon_id) VALUES ('s2', 'e1', 'c2', 'b');
  `);
  repo = new TerminalLogRepo(db);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const chunk = (examStudentId: string, key: string, text: string) => ({
  examStudentId,
  key,
  text,
  serverTs: 1,
  clientTs: 1,
});

describe('TerminalLogRepo', () => {
  it('keeps chunks in order, once per key, per student', () => {
    expect(repo.append(chunk('s1', 'k1', 'a'))).toBe('stored');
    expect(repo.append(chunk('s1', 'k1', 'a'))).toBe('duplicate');
    expect(repo.append(chunk('s2', 'k1', 'other'))).toBe('stored');
    expect(repo.append(chunk('s1', 'k2', 'b'))).toBe('stored');
    expect(repo.transcript('s1')).toEqual({ text: 'ab', truncated: false });
    expect(repo.transcript('s2').text).toBe('other');
  });

  it('stores one marker once the cap is reached and drops the rest', () => {
    const big = 'x'.repeat(16 * 1024);
    let i = 0;
    while (repo.append(chunk('s1', `k${i}`, big)) === 'stored') i += 1;
    expect(i).toBe(Math.floor(MAX_TRANSCRIPT_CHARS / big.length));
    expect(repo.append(chunk('s1', 'later', 'y'))).toBe('dropped');
    const { text, truncated } = repo.transcript('s1');
    expect(truncated).toBe(true);
    expect(text.endsWith(TRUNCATED_MARKER)).toBe(true);
    expect(text.split(TRUNCATED_MARKER)).toHaveLength(2);
  });
});
