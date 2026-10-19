import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initDatabase } from '../db/database.js';
import type { Db } from '../db/connection.js';
import { buildTeacherApp } from './teacher-app.js';

const TOKEN = 't'.repeat(40);
const HEADERS = { 'x-teacher-token': TOKEN };

let app: FastifyInstance;
let db: Db;
let dir: string;
let clock = 1000;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'eg-q-'));
  db = initDatabase(dir);
  clock = 1000;
  app = buildTeacherApp({ token: TOKEN, db, now: () => clock++ }).app;
  await app.inject({
    method: 'POST',
    url: '/api/v1/auth/setup',
    headers: HEADERS,
    payload: { password: 'correct horse battery' },
  });
});
afterEach(async () => {
  await app.close();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const send = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object) =>
  app.inject({ method, url: `/api/v1${url}`, headers: HEADERS, payload });

const codeQ = (over: object = {}) => ({
  type: 'code',
  body: 'Reverse a string',
  allowedLanguages: ['c', 'js'],
  studentNote: 'Use stdin',
  sampleAnswer: 'int main(){}',
  sampleLanguage: 'c',
  aiNotes: 'Accept any loop',
  criteria: [
    { name: 'Correct output', maxMarks: 2 },
    { name: 'Style', maxMarks: 0.5 },
  ],
  ...over,
});
const writtenQ = () =>
  codeQ({ type: 'written', allowedLanguages: [], sampleLanguage: 'text', body: 'Explain a stack' });

const importList = async () =>
  (await send('POST', '/class-lists/import', { name: 'CSE', csvText: '1,Ada\n' })).json().list;
const newExam = async (withList = true) => {
  const list = withList ? await importList() : null;
  return (
    await send('POST', '/exams', { title: 'Mid', durationMin: 60, classListId: list?.id ?? null })
  ).json();
};
const addQ = async (examId: string, body: object = codeQ()) =>
  (await send('POST', `/exams/${examId}/questions`, body)).json();

describe('question routes', () => {
  it('creates questions in order with marks = sum of criteria', async () => {
    const exam = await newExam();
    const res = await send('POST', `/exams/${exam.id}/questions`, codeQ());
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ position: 1, marks: 2.5, type: 'code' });
    await addQ(exam.id, writtenQ());
    const list = (await send('GET', `/exams/${exam.id}/questions`)).json();
    expect(list.map((q: { position: number; type: string }) => [q.position, q.type])).toEqual([
      [1, 'code'],
      [2, 'written'],
    ]);
    expect(list[1].allowedLanguages).toEqual([]);
  });

  it('rejects bad bodies (quarter marks, languages on written) and unknown exams', async () => {
    const exam = await newExam();
    const quarter = codeQ({ criteria: [{ name: 'a', maxMarks: 1.25 }] });
    expect((await send('POST', `/exams/${exam.id}/questions`, quarter)).statusCode).toBe(400);
    const bad = codeQ({ type: 'written' });
    expect((await send('POST', `/exams/${exam.id}/questions`, bad)).statusCode).toBe(400);
    expect((await send('POST', '/exams/nope/questions', codeQ())).statusCode).toBe(404);
    expect((await send('GET', '/exams/nope/questions')).statusCode).toBe(404);
  });

  it('replaces fields and criteria on PATCH and recomputes marks', async () => {
    const exam = await newExam();
    const q = await addQ(exam.id);
    const res = await send(
      'PATCH',
      `/questions/${q.id}`,
      codeQ({ body: 'New text', criteria: [{ name: 'Only', maxMarks: 4 }] }),
    );
    expect(res.json()).toMatchObject({
      body: 'New text',
      marks: 4,
      criteria: [{ name: 'Only', maxMarks: 4 }],
    });
    expect((await send('PATCH', '/questions/nope', codeQ())).statusCode).toBe(404);
  });

  it('deletes a question, closes the gap, and reorders', async () => {
    const exam = await newExam();
    const a = await addQ(exam.id, codeQ({ body: 'A' }));
    const b = await addQ(exam.id, codeQ({ body: 'B' }));
    const c = await addQ(exam.id, codeQ({ body: 'C' }));

    const reordered = await send('POST', `/exams/${exam.id}/questions/reorder`, {
      ids: [c.id, a.id, b.id],
    });
    expect(reordered.json().map((q: { body: string }) => q.body)).toEqual(['C', 'A', 'B']);

    await send('DELETE', `/questions/${a.id}`);
    const after = (await send('GET', `/exams/${exam.id}/questions`)).json();
    expect(after.map((q: { body: string; position: number }) => [q.body, q.position])).toEqual([
      ['C', 1],
      ['B', 2],
    ]);
    expect((await send('DELETE', `/questions/${a.id}`)).statusCode).toBe(404);
  });

  it('refuses a reorder that is not exactly the exam questions', async () => {
    const exam = await newExam();
    const a = await addQ(exam.id);
    await addQ(exam.id);
    const url = `/exams/${exam.id}/questions/reorder`;
    expect((await send('POST', url, { ids: [a.id] })).statusCode).toBe(400);
    expect((await send('POST', url, { ids: [a.id, a.id] })).statusCode).toBe(400);
    expect((await send('POST', url, { ids: [a.id, 'x'] })).statusCode).toBe(400);
  });

  it('removes questions and criteria with the exam', async () => {
    const exam = await newExam();
    await addQ(exam.id);
    await send('DELETE', `/exams/${exam.id}`);
    expect(db.prepare('SELECT COUNT(*) AS n FROM questions').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM marking_criteria').get()).toEqual({ n: 0 });
  });

  it('locks questions once the exam is past ready', async () => {
    const exam = await newExam();
    const q = await addQ(exam.id);
    db.prepare("UPDATE exams SET state = 'hosting' WHERE id = ?").run(exam.id);
    for (const res of [
      await send('POST', `/exams/${exam.id}/questions`, codeQ()),
      await send('PATCH', `/questions/${q.id}`, codeQ()),
      await send('DELETE', `/questions/${q.id}`),
      await send('POST', `/exams/${exam.id}/questions/reorder`, { ids: [q.id] }),
    ]) {
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe('invalid_state');
    }
  });

  it('duplicate copies questions and criteria with new ids', async () => {
    const exam = await newExam();
    const q = await addQ(exam.id);
    await addQ(exam.id, writtenQ());
    const copy = (await send('POST', `/exams/${exam.id}/duplicate`)).json();
    const copied = (await send('GET', `/exams/${copy.id}/questions`)).json();
    expect(copied).toHaveLength(2);
    expect(copied[0]).toMatchObject({ marks: 2.5, sampleAnswer: 'int main(){}', position: 1 });
    expect(copied[0].criteria).toEqual(q.criteria);
    expect(copied[0].id).not.toBe(q.id);
    expect((await send('GET', `/exams/${exam.id}/questions`)).json()).toHaveLength(2);
  });
});

describe('ready / unready', () => {
  const problems = async (examId: string) => {
    const res = await send('POST', `/exams/${examId}/ready`);
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('not_ready');
    return res.json().error.details.problems.map((p: { code: string }) => p.code);
  };

  it('is refused with reasons, then accepted when complete', async () => {
    const exam = await newExam(false);
    expect(await problems(exam.id)).toEqual(['no_class_list', 'no_questions']);

    const list = await importList();
    await send('PATCH', `/exams/${exam.id}`, { classListId: list.id });
    expect(await problems(exam.id)).toEqual(['no_questions']);

    await addQ(exam.id);
    await addQ(exam.id, writtenQ());
    const ok = await send('POST', `/exams/${exam.id}/ready`);
    expect(ok.statusCode).toBe(200);
    expect(ok.json().state).toBe('ready');
  });

  it('refuses again when a criterion is removed from a draft', async () => {
    const exam = await newExam();
    const q = await addQ(exam.id);
    await send('PATCH', `/questions/${q.id}`, codeQ({ criteria: [] }));
    expect(await problems(exam.id)).toEqual(['no_criteria']);
  });

  it('names the failing question', async () => {
    const exam = await newExam();
    await addQ(exam.id);
    const bad = await addQ(exam.id, codeQ({ sampleAnswer: '' }));
    const res = await send('POST', `/exams/${exam.id}/ready`);
    expect(res.json().error.details.problems).toEqual([
      expect.objectContaining({ code: 'missing_sample_answer', questionId: bad.id }),
    ]);
  });

  it('unready goes back to draft; wrong states give 409; unknown gives 404', async () => {
    const exam = await newExam();
    await addQ(exam.id);
    await send('POST', `/exams/${exam.id}/ready`);
    expect((await send('POST', `/exams/${exam.id}/unready`)).json().state).toBe('draft');

    db.prepare("UPDATE exams SET state = 'running' WHERE id = ?").run(exam.id);
    expect((await send('POST', `/exams/${exam.id}/ready`)).statusCode).toBe(409);
    expect((await send('POST', `/exams/${exam.id}/unready`)).statusCode).toBe(409);
    expect((await send('POST', '/exams/nope/ready')).statusCode).toBe(404);
  });
});
