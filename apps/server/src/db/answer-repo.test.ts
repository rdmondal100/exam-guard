import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AnswerRepo, type NewAnswerVersion } from './answer-repo.js';
import type { Db } from './connection.js';
import { initDatabase } from './database.js';

let dir: string;
let db: Db;
let repo: AnswerRepo;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'eg-ans-repo-'));
  db = initDatabase(dir);
  db.exec(`
    INSERT INTO class_lists (id, name, created_at) VALUES ('l1', 'CSE', 1);
    INSERT INTO class_students (id, class_list_id, student_code, name) VALUES ('c1', 'l1', '1', 'Ada');
    INSERT INTO class_students (id, class_list_id, student_code, name) VALUES ('c2', 'l1', '2', 'Bob');
    INSERT INTO exams (id, title, duration_sec, monitoring_json, created_at, updated_at)
      VALUES ('e1', 'Mid', 3600, '{}', 1, 1);
    INSERT INTO questions (id, exam_id, position, type, body, marks, sample_language)
      VALUES ('q1', 'e1', 1, 'code', 'Q1', 2, 'c');
    INSERT INTO questions (id, exam_id, position, type, body, marks, sample_language)
      VALUES ('q2', 'e1', 2, 'written', 'Q2', 2, 'text');
    INSERT INTO exam_students (id, exam_id, class_student_id, anon_id) VALUES ('s1', 'e1', 'c1', 'a');
    INSERT INTO exam_students (id, exam_id, class_student_id, anon_id) VALUES ('s2', 'e1', 'c2', 'b');
  `);
  repo = new AnswerRepo(db);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const version = (over: Partial<NewAnswerVersion>): NewAnswerVersion => ({
  examStudentId: 's1',
  questionId: 'q1',
  language: 'c',
  content: 'x',
  selected: true,
  reason: 'interval',
  clientSeq: 1,
  clientTs: 10,
  serverTs: 11,
  ...over,
});

describe('AnswerRepo', () => {
  it('stores a clientSeq once per student', () => {
    expect(repo.insertMany([version({ clientSeq: 1 }), version({ clientSeq: 2 })])).toBe(2);
    expect(repo.insertMany([version({ clientSeq: 2, content: 'other' })])).toBe(0);
    expect(repo.insertMany([version({ examStudentId: 's2', clientSeq: 2 })])).toBe(1);
    expect(repo.list('s1').map((v) => v.content)).toEqual(['x', 'x']);
  });

  it('keeps a version for each language and returns the newest of each', () => {
    repo.insertMany([
      version({ clientSeq: 1, language: 'c', content: 'c1' }),
      version({ clientSeq: 2, language: 'cpp', content: 'cpp1', reason: 'switch_language' }),
      version({ clientSeq: 3, language: 'c', content: 'c2', selected: false }),
    ]);
    expect(repo.latest('s1', 'q1', 'c')?.content).toBe('c2');
    expect(repo.latest('s1', 'q1', 'cpp')?.content).toBe('cpp1');
    expect(repo.latest('s1', 'q1', 'py')).toBeUndefined();
  });

  it('reports which language is selected per question, and the newest sequence of each buffer', () => {
    repo.insertMany([
      version({ clientSeq: 1, language: 'c' }),
      version({ clientSeq: 2, language: 'cpp' }),
      version({ clientSeq: 3, language: 'c', selected: false }),
      version({ clientSeq: 4, questionId: 'q2', language: 'text' }),
    ]);
    const saved = repo.savedFor('s1');
    expect(saved).toHaveLength(3);
    expect(saved).toEqual(
      expect.arrayContaining([
        { questionId: 'q1', language: 'c', clientSeq: 3, selected: false },
        { questionId: 'q1', language: 'cpp', clientSeq: 2, selected: true },
        { questionId: 'q2', language: 'text', clientSeq: 4, selected: true },
      ]),
    );
    expect(repo.savedFor('s2')).toEqual([]);
  });

  it('keeps the flags with the version', () => {
    repo.insertMany([version({ flags: '-lm -O2' }), version({ clientSeq: 2 })]);
    expect(repo.list('s1').map((v) => v.flags)).toEqual(['-lm -O2', null]);
  });

  it('refuses an unknown question', () => {
    expect(() => repo.insertMany([version({ questionId: 'nope' })])).toThrow(/FOREIGN KEY/);
  });
});
