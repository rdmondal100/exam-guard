import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ExportResultSchema, FinalizeResultSchema } from '@examguard/shared';
import { FakeProvider, loadFixtures } from '../services/grading/providers/fake.js';
import { fixedSource } from '../services/grading/provider-source.js';
import { gradingExam, type GradingExam } from '../testing/gradingExam.js';

let e: GradingExam;

beforeEach(async () => {
  const fake = FakeProvider.fromFixtures(loadFixtures().values());
  e = await gradingExam(['anon-valid', 'anon-garbage'], {
    source: fixedSource(fake),
    backoffMs: 0,
  });
  await e.call('POST', `/exams/${e.examId}/grading`);
  await e.app.grading.idle(e.examId);
});
afterEach(() => e.close());

const sid = (anon: string) => e.students.get(anon) ?? '';
const finalize = () => e.call('POST', `/exams/${e.examId}/finalize`);
const gradeByHand = (anon: string) =>
  e.call('POST', `/answers/${sid(anon)}/${e.questionId}/edit`, {
    criteria: [
      { name: 'Correct logic', awarded: 1 },
      { name: 'Uses a loop', awarded: 0 },
      { name: 'Code style', awarded: 0.5 },
    ],
    feedback: 'Returns a constant.',
  });

describe('finalize + CSV export (M42)', () => {
  it('refuses to finalize while an answer still needs a grade', async () => {
    const res = await finalize();
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatchObject({
      code: 'not_ready',
      details: { pending: 0, needsManual: 1 },
    });
    expect((await e.call('POST', `/exams/${e.examId}/export`)).json().error.code).toBe(
      'not_finalized',
    );
  });

  it('graded → reviewed → finalized → exported, and marks are locked afterwards', async () => {
    expect((await gradeByHand('anon-garbage')).statusCode).toBe(200);
    // One high and two low events and some outside time for the first student.
    const event = e.db.prepare(
      `INSERT INTO events (exam_id, exam_student_id, type, severity, server_ts, source)
         VALUES (?, ?, 'focus_lost', ?, 1, 'agent')`,
    );
    event.run(e.examId, sid('anon-valid'), 'high');
    event.run(e.examId, sid('anon-valid'), 'low');
    event.run(e.examId, sid('anon-valid'), 'low');
    e.db
      .prepare('UPDATE exam_students SET outside_ms_total = 90000 WHERE id = ?')
      .run(sid('anon-valid'));
    // A student on the class list who never joined.
    e.db
      .prepare(
        "INSERT INTO class_students (id, class_list_id, student_code, name) VALUES ('c9', 'l1', '9', '=Absent')",
      )
      .run();
    e.db
      .prepare(
        `INSERT INTO exam_students (id, exam_id, class_student_id, anon_id, state)
           VALUES ('s9', ?, 'c9', 'anon-absent', 'not_joined')`,
      )
      .run(e.examId);

    const res = await finalize();
    expect(res.statusCode).toBe(200);
    const done = FinalizeResultSchema.parse(res.json());
    expect(done.examState).toBe('finalized');
    expect(existsSync(join(e.dir, 'backups', done.backup, 'examguard.sqlite'))).toBe(true);
    const logged = e.db
      .prepare("SELECT payload_json FROM teacher_actions WHERE exam_id = ? AND action = 'finalize'")
      .all(e.examId) as { payload_json: string }[];
    expect(logged.map((a) => JSON.parse(a.payload_json))).toEqual([{ backup: done.backup }]);

    // Locked: no accept, edit, grading run or re-evaluation, and no second finalize.
    expect((await gradeByHand('anon-valid')).json().error.code).toBe('invalid_state');
    expect(
      (await e.call('POST', `/answers/${sid('anon-valid')}/${e.questionId}/accept`)).statusCode,
    ).toBe(409);
    expect((await e.call('POST', `/exams/${e.examId}/grading`)).statusCode).toBe(409);
    expect(
      (
        await e.call('POST', `/exams/${e.examId}/grading/reevaluate`, {
          questionId: e.questionId,
          examStudentIds: 'all',
          instruction: 'x',
        })
      ).statusCode,
    ).toBe(409);
    expect((await finalize()).json().error.code).toBe('invalid_state');

    const csv = await e.call('GET', `/exams/${e.examId}/export.csv`);
    expect(csv.statusCode).toBe(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.headers['content-disposition']).toMatch(
      /^attachment; filename="?Mid_\d{8}-\d{4}\.csv/,
    );
    expect(csv.body.charCodeAt(0)).toBe(0xfeff);

    const saved = ExportResultSchema.parse(
      (await e.call('POST', `/exams/${e.examId}/export`)).json(),
    );
    expect(saved.rows).toBe(3);
    expect(saved.path).toBe(join(e.dir, 'exports', saved.fileName));
    const text = readFileSync(saved.path, 'utf8');
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text.slice(1).split('\r\n')).toEqual([
      'Student ID,Name,Status,Q1 (8),Total (8),Low events,Medium events,High events,Critical events,Outside ExamGuard (min)',
      '1,Student 1,Submitted,7,7,2,0,1,0,1.5',
      '2,Student 2,Submitted,1.5,1.5,0,0,0,0,0',
      "9,'=Absent,Absent,,,0,0,0,0,0",
      '',
    ]);
  });
});
