import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StudentAnswersResponseSchema } from '@examguard/shared';
import { startLiveExam, type LiveExam } from '../testing/liveExam.js';

let live: LiveExam;
beforeEach(async () => {
  live = await startLiveExam();
});
afterEach(async () => {
  await live.close();
});

const sheet = async (studentId: string, examId = live.examId) => {
  const res = await live.call('GET', `/exams/${examId}/students/${studentId}/answers`);
  return { status: res.statusCode, body: res.json() as unknown };
};
const questionsOf = (m: { [k: string]: unknown } | undefined) =>
  ((m?.['state'] as { questions?: { id: string }[] } | undefined)?.questions ?? []).map(
    (q) => q.id,
  );

describe('GET /exams/:id/students/:sid/answers (M65)', () => {
  it('shows the newest autosave while the student works, then the submitted answers', async () => {
    const ada = await live.student('1');
    const bob = await live.student('2');
    await live.start();
    await ada.peer.waitFor(() => questionsOf(ada.peer.last('state')).length > 0);
    const [questionId] = questionsOf(ada.peer.last('state'));
    const save = (clientSeq: number, content: string) =>
      ada.peer.ws.send(
        JSON.stringify({
          t: 'answer.save',
          id: `s${clientSeq}`,
          clientSeq,
          clientTs: Date.now(),
          questionId,
          language: 'text',
          content,
          selected: true,
          reason: 'interval',
        }),
      );
    save(1, 'first draft');
    save(2, 'a stack is LIFO');
    await ada.peer.waitFor(() => ada.peer.json.filter((m) => m.t === 'answer.ack').length === 2);

    const working = StudentAnswersResponseSchema.parse((await sheet(ada.id)).body);
    expect(working).toMatchObject({ source: 'latest', submittedAt: null, receiptHash: null });
    expect(working.answers).toHaveLength(1);
    expect(working.answers[0]).toMatchObject({
      position: 1,
      type: 'written',
      maxMarks: 2,
      language: 'text',
      content: 'a stack is LIFO',
      answered: true,
      grade: null,
    });
    const empty = StudentAnswersResponseSchema.parse((await sheet(bob.id)).body);
    expect(empty.answers[0]).toMatchObject({ answered: false, content: '', language: null });

    ada.peer.ws.send(JSON.stringify({ t: 'submit', id: 'sub', clientTs: Date.now() }));
    await ada.peer.waitFor(() => ada.peer.last('submit.result') !== undefined);
    const receipt = ada.peer.last('submit.result')?.receipt as { hash: string };
    const final = StudentAnswersResponseSchema.parse((await sheet(ada.id)).body);
    expect(final).toMatchObject({ source: 'final', receiptHash: receipt.hash });
    expect(final.submittedAt).toEqual(expect.any(Number));
    expect(final.answers[0]?.content).toBe('a stack is LIFO');
  });

  it('refuses a student of another exam and needs the teacher login', async () => {
    const ada = await live.student('1');
    expect((await sheet(ada.id, 'other-exam')).status).toBe(404);
    expect((await sheet('nobody')).status).toBe(404);
    const anon = await live.app.inject({
      method: 'GET',
      url: `/api/v1/exams/${live.examId}/students/${ada.id}/answers`,
    });
    expect(anon.statusCode).toBeGreaterThanOrEqual(401);
  });
});
