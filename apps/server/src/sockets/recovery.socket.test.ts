import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeScreenshotFrames } from '@examguard/shared';
import { RESTART_PIN, RestartableExam, type StudentClient } from '../testing/restartableExam.js';

/**
 * Crash recovery (M48): the server stops in the middle of an exam and starts again on the same
 * data folder. Nothing acked may be lost, replays must not be stored twice, and the timers keep
 * the deadline they had.
 */

const HOUR = 3_600_000;
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6]);

let exam: RestartableExam;

beforeEach(() => {
  exam = new RestartableExam();
});
afterEach(async () => {
  await exam.dispose();
});

const save = (clientSeq: number, content = `answer ${clientSeq}`, clientTs = Date.now()) => ({
  t: 'answer.save',
  id: `s${clientSeq}`,
  clientSeq,
  clientTs,
  questionId: exam.writtenId,
  language: 'text',
  content,
  selected: true,
  reason: 'interval',
});
const acked = (c: StudentClient, seq: number) =>
  c.messages.some((m) => m.t === 'answer.ack' && m.clientSeq === seq);
const welcome = (c: StudentClient) => c.messages.find((m) => m.t === 'welcome');
const count = (sql: string, ...args: string[]) =>
  (exam.db.prepare(sql).get(...args) as { n: number }).n;
const studentOf = (code: string) =>
  exam.db
    .prepare(
      `SELECT s.id, s.state, s.outside_ms_total AS outside, s.submission_hash AS hash
         FROM exam_students s JOIN class_students c ON c.id = s.class_student_id
         WHERE c.student_code = ?`,
    )
    .get(code) as { id: string; state: string; outside: number; hash: string | null };
const versions = (code: string) =>
  count('SELECT COUNT(*) AS n FROM answer_versions WHERE exam_student_id = ?', studentOf(code).id);
const finalContent = (code: string) =>
  (
    exam.db
      .prepare('SELECT content FROM final_answers WHERE exam_student_id = ?')
      .get(studentOf(code).id) as { content: string } | undefined
  )?.content;
const examState = () =>
  (exam.db.prepare('SELECT state FROM exams WHERE id = ?').get(exam.examId) as { state: string })
    .state;

async function startedWithOneStudent(graceSec = 60): Promise<{ token: string; c: StudentClient }> {
  await exam.setup(graceSec);
  const token = await exam.join('1');
  await exam.call('POST', `/exams/${exam.examId}/start`);
  const c = await exam.connect(token);
  return { token, c };
}

describe('server restart mid-exam', () => {
  it('keeps the session, the PIN, the certificate, the deadline and every acked save', async () => {
    const { token, c } = await startedWithOneStudent();
    const before = (await exam.call('GET', `/exams/${exam.examId}/hosting`)).json();
    const deadline = welcome(c)?.state?.deadline;
    expect(deadline).toEqual(expect.any(Number));
    c.send(save(1));
    c.send(save(2));
    await c.waitFor(() => acked(c, 2));

    await exam.stop();
    await exam.restart();

    const after = (await exam.call('GET', `/exams/${exam.examId}/hosting`)).json();
    expect(after).toMatchObject({ pin: RESTART_PIN, fpCode: before.fpCode, deadline });
    const back = await exam.connect(token);
    expect(welcome(back)?.state).toMatchObject({ examState: 'running', deadline });
    expect(welcome(back)?.state?.saved?.map((s) => s.clientSeq)).toContain(2);
    expect(versions('1')).toBe(2);
  });

  it('acks a replayed save without storing it twice and takes new saves and the submit', async () => {
    const { token, c } = await startedWithOneStudent();
    c.send(save(1));
    c.send(save(2));
    await c.waitFor(() => acked(c, 2));
    await exam.stop();
    await exam.restart();

    // The acks of 1 and 2 were lost with the server: the client sends both again.
    const back = await exam.connect(token);
    back.send(save(1));
    back.send(save(2));
    back.send(save(3, 'final words'));
    await back.waitFor(() => acked(back, 1) && acked(back, 2) && acked(back, 3));
    expect(versions('1')).toBe(3);

    back.send({ t: 'submit', id: 'sub-1', clientTs: Date.now() });
    await back.waitFor(() => back.messages.some((m) => m.t === 'submit.result'));
    expect(finalContent('1')).toBe('final words');
    expect(studentOf('1').state).toBe('submitted');
  });

  it('stores a replayed event and its screenshot once, and counts the time outside once', async () => {
    const { token, c } = await startedWithOneStudent();
    const shot = () => encodeScreenshotFrames('ref:1', JPEG);
    const lost = {
      t: 'event',
      id: 'e1',
      dedupeKey: '1:100',
      clientTs: Date.now(),
      type: 'focus_lost',
      details: { exe: 'notepad.exe' },
      screenshotRef: 'ref:1',
    };
    const back = {
      t: 'event',
      id: 'e2',
      dedupeKey: '1:101',
      clientTs: Date.now(),
      type: 'focus_returned',
      details: { durationMs: 4000 },
    };
    for (const frame of shot()) c.sendBinary(frame);
    c.send(lost);
    c.send(back);
    await c.waitFor(() => c.messages.filter((m) => m.t === 'event.ack').length === 2);

    await exam.stop();
    await exam.restart();
    // The agent replays its unacked evidence after every hello (acks lost with the server).
    const again = await exam.connect(token);
    for (const frame of shot()) again.sendBinary(frame);
    again.send(lost);
    again.send(back);
    await again.waitFor(() => again.messages.filter((m) => m.t === 'event.ack').length === 2);

    const agent = (sql: string) => count(sql, exam.examId);
    expect(agent("SELECT COUNT(*) AS n FROM events WHERE exam_id = ? AND source = 'agent'")).toBe(
      2,
    );
    expect(
      agent('SELECT COUNT(*) AS n FROM events WHERE exam_id = ? AND screenshot_path IS NOT NULL'),
    ).toBe(1);
    expect(studentOf('1').outside).toBe(4000);
  });

  it('lets a student whose app restarted join again from the same PC and get the saves back', async () => {
    const { c } = await startedWithOneStudent();
    c.send(save(1, 'kept'));
    await c.waitFor(() => acked(c, 1));
    await exam.stop();
    await exam.restart();

    // The student app was closed too: it joins again (same device) and resumes.
    const token = await exam.join('1');
    expect(token).not.toBe('');
    const back = await exam.connect(token);
    expect(welcome(back)?.state?.examState).toBe('running');
    expect(welcome(back)?.state?.saved?.map((s) => s.clientSeq)).toEqual([1]);
  });
});

describe('deadline during downtime', () => {
  it('ends the exam at the restart with the saves made in time', async () => {
    const { c } = await startedWithOneStudent(0);
    c.send(save(1, 'in time'));
    await c.waitFor(() => acked(c, 1));
    await exam.stop();
    // The deadline (and the grace) pass while the server is down.
    exam.whileDown((db) =>
      db
        .prepare('UPDATE exams SET started_at = ? WHERE id = ?')
        .run(Date.now() - HOUR - 5000, exam.examId),
    );
    await exam.restart();

    await vi.waitFor(() => expect(examState()).toBe('ended'), { timeout: 3000 });
    expect(finalContent('1')).toBe('in time');
    expect(studentOf('1')).toMatchObject({ state: 'submitted', hash: expect.any(String) });
  });
});
