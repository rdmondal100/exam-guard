import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildTeacherApp, type TeacherApp } from '../app.js';
import { initDatabase, type Db } from '../db/connectDb.js';
import type { ContainerOptions } from '../container.js';
import { withInject, type Injectable, type InjectResponse } from './inject.js';

const TOKEN = 'g'.repeat(40);
const HEADERS = { 'x-teacher-token': TOKEN };

/** The question of the grading fixtures (`fixtures/grading/*.json`). */
export const FIXTURE_QUESTION = {
  type: 'code',
  body: 'Write a function int sum(int *a, int n) that returns the sum of the n numbers in a.',
  allowedLanguages: ['c', 'cpp', 'py'],
  studentNote: 'Use a loop, not recursion.',
  sampleAnswer:
    'int sum(int *a, int n) {\n  int s = 0;\n  for (int i = 0; i < n; i++) s += a[i];\n  return s;\n}',
  sampleLanguage: 'c',
  aiNotes: 'Accept any loop form.',
  criteria: [
    { name: 'Correct logic', maxMarks: 5 },
    { name: 'Uses a loop', maxMarks: 2 },
    { name: 'Code style', maxMarks: 1 },
  ],
} as const;

export interface GradingExam {
  app: Injectable<TeacherApp>;
  db: Db;
  dir: string;
  examId: string;
  questionId: string;
  /** exam_student id by anonymous id. */
  students: Map<string, string>;
  call(method: 'GET' | 'POST', url: string, payload?: object): Promise<InjectResponse>;
  close(): Promise<void>;
}

/** Opens a teacher app on `dir` (a second call on the same folder is a "restarted server"). */
export function openApp(dir: string, db: Db, grading: ContainerOptions['grading']) {
  return withInject(
    buildTeacherApp({ token: TOKEN, db, dataDir: dir, ...(grading ? { grading } : {}) }),
  );
}

/**
 * An ended exam with the fixtures' question and one submitted student per anonymous id, each with
 * a final answer, ready for "Evaluate with AI".
 */
export async function gradingExam(
  anonIds: readonly string[],
  grading?: ContainerOptions['grading'],
): Promise<GradingExam> {
  const dir = mkdtempSync(join(tmpdir(), 'eg-grading-'));
  const db = initDatabase(dir);
  const app = openApp(dir, db, grading);
  const call: GradingExam['call'] = (method, url, payload) =>
    app.inject({ method, url: `/api/v1${url}`, headers: HEADERS, ...(payload ? { payload } : {}) });
  await call('POST', '/auth/setup', { password: 'correct horse battery' });
  const examId = (await call('POST', '/exams', { title: 'Mid', durationMin: 60 })).json()
    .id as string;
  const questionId = (await call('POST', `/exams/${examId}/questions`, FIXTURE_QUESTION)).json()
    .id as string;

  const students = new Map<string, string>();
  db.prepare("INSERT INTO class_lists (id, name, created_at) VALUES ('l1', 'CSE', 1)").run();
  anonIds.forEach((anonId, i) => {
    const sid = `s${i + 1}`;
    students.set(anonId, sid);
    db.prepare(
      'INSERT INTO class_students (id, class_list_id, student_code, name) VALUES (?, ?, ?, ?)',
    ).run(`c${i + 1}`, 'l1', String(i + 1), `Student ${i + 1}`);
    db.prepare(
      `INSERT INTO exam_students (id, exam_id, class_student_id, anon_id, state, submitted_at)
         VALUES (?, ?, ?, ?, 'submitted', 50)`,
    ).run(sid, examId, `c${i + 1}`, anonId);
    db.prepare(
      `INSERT INTO final_answers (exam_student_id, question_id, language, content, sha256,
         submitted_at) VALUES (?, ?, 'c', ?, 'x', 50)`,
    ).run(sid, questionId, `int sum(int *a, int n) {\n  return ${i};\n}`);
  });
  db.prepare("UPDATE exams SET state = 'ended', class_list_id = 'l1' WHERE id = ?").run(examId);

  return {
    app,
    db,
    dir,
    examId,
    questionId,
    students,
    call,
    close: async () => {
      await app.close();
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
