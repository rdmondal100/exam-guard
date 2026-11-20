import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AuditResponseSchema } from '@examguard/shared';
import { startLiveExam, type LiveExam } from '../testing/liveExam.js';

let live: LiveExam;
beforeEach(async () => {
  live = await startLiveExam();
});
afterEach(async () => {
  await live.close();
});

const act = (payload: object) => live.call('POST', `/exams/${live.examId}/actions`, payload);
type StateMsg = { state?: { deadline?: number; pausedAt?: number | null; questions?: unknown[] } };
const stateOf = (m: object | undefined) => (m as StateMsg | undefined)?.state ?? {};

describe('pause and resume (M58)', () => {
  it('freezes every working student, then moves the deadline by the pause', async () => {
    const ada = await live.student('1');
    expect((await act({ type: 'pause' })).statusCode).toBe(409);
    await live.start();
    await ada.peer.waitFor(() => stateOf(ada.peer.last('state')).deadline !== undefined);
    const before = stateOf(ada.peer.last('state')).deadline ?? 0;

    const paused = await act({ type: 'pause' });
    expect(paused.statusCode).toBe(200);
    const { pausedAt } = paused.json() as { pausedAt: number };
    expect(paused.json()).toMatchObject({ ok: true, deadline: before });
    await ada.peer.waitFor(() => stateOf(ada.peer.last('state')).pausedAt === pausedAt);
    // Pausing twice changes nothing; the hosting info shows the pause.
    expect((await act({ type: 'pause' })).json()).toMatchObject({ pausedAt });
    const info = (await live.call('GET', `/exams/${live.examId}/hosting`)).json() as object;
    expect(info).toMatchObject({ pausedAt, deadline: before });
    // A student who reconnects while paused gets the pause in the welcome.
    ada.peer.ws.close();
    const again = await live.reconnect(ada.token);
    await again.waitFor(() => again.last('welcome') !== undefined);
    expect(stateOf(again.last('welcome'))).toMatchObject({ pausedAt, deadline: before });

    await new Promise((r) => setTimeout(r, 120));
    const resumed = await act({ type: 'resume' });
    const body = resumed.json() as { pausedAt: null; deadline: number };
    expect(body.pausedAt).toBeNull();
    expect(body.deadline - before).toBeGreaterThanOrEqual(120);
    await again.waitFor(() => stateOf(again.last('state')).pausedAt === null);
    expect(stateOf(again.last('state')).deadline).toBe(body.deadline);

    const { actions } = AuditResponseSchema.parse(
      (await live.call('GET', `/exams/${live.examId}/actions`)).json(),
    );
    expect(actions.slice(0, 2).map((a) => a.action)).toEqual(['resume', 'pause']);
  });

  it('refuses Submit while paused and takes it after the resume (M60)', async () => {
    const ada = await live.student('1');
    await live.start();
    await ada.peer.waitFor(() => stateOf(ada.peer.last('state')).deadline !== undefined);
    await act({ type: 'pause' });
    ada.peer.ws.send(JSON.stringify({ t: 'submit', id: 'sub-1', clientTs: Date.now() }));
    await ada.peer.waitFor(() => ada.peer.last('submit.refused') !== undefined);
    expect(ada.peer.last('submit.refused')).toMatchObject({ id: 'sub-1', reason: 'paused' });
    await act({ type: 'resume' });
    ada.peer.ws.send(JSON.stringify({ t: 'submit', id: 'sub-2', clientTs: Date.now() }));
    await ada.peer.waitFor(() => ada.peer.last('submit.result') !== undefined);
  });

  it('keeps the save that arrives just after the pause began (the app sends it on freeze)', async () => {
    const ada = await live.student('1');
    await live.start();
    await ada.peer.waitFor(() => (stateOf(ada.peer.last('state')).questions?.length ?? 0) > 0);
    const q = (stateOf(ada.peer.last('state')).questions?.[0] ?? {}) as { id?: string };
    await act({ type: 'pause' });
    ada.peer.ws.send(
      JSON.stringify({
        t: 'answer.save',
        id: 'save-1',
        clientSeq: 1,
        clientTs: Date.now(),
        questionId: q.id,
        language: 'text',
        content: 'typed before the pause',
        selected: true,
        reason: 'interval',
      }),
    );
    await ada.peer.waitFor(() => ada.peer.last('answer.ack') !== undefined);
    await act({ type: 'resume' });
    ada.peer.ws.send(JSON.stringify({ t: 'submit', id: 'sub-1', clientTs: Date.now() }));
    await ada.peer.waitFor(() => ada.peer.last('submit.result') !== undefined);
    const receipt = ada.peer.last('submit.result')?.receipt as { answers: { sha256: string }[] };
    const EMPTY = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
    expect(receipt.answers[0]?.sha256).not.toBe(EMPTY);
  });

  it('moves a timed terminal window by the pause (M60)', async () => {
    const ada = await live.student('1');
    await live.start();
    await act({ type: 'terminal', enabled: true, minutes: 10 });
    type TermMsg = { state?: { terminal?: { until: number | null } } };
    const untilOf = () =>
      [...ada.peer.json]
        .reverse()
        .map((m) => (m as TermMsg).state?.terminal?.until)
        .find((u) => u !== undefined);
    await ada.peer.waitFor(() => typeof untilOf() === 'number');
    const before = untilOf() ?? 0;
    await act({ type: 'pause' });
    await new Promise((r) => setTimeout(r, 120));
    await act({ type: 'resume' });
    await ada.peer.waitFor(() => (untilOf() ?? 0) > before);
    expect((untilOf() ?? 0) - before).toBeGreaterThanOrEqual(120);
  });

  it('sends a question added mid-exam to working students at once', async () => {
    const ada = await live.student('1');
    await live.start();
    await ada.peer.waitFor(() => stateOf(ada.peer.last('state')).questions?.length === 1);
    const res = await live.call('POST', `/exams/${live.examId}/questions`, {
      type: 'written',
      body: 'Explain a queue',
      allowedLanguages: [],
      studentNote: '',
      sampleAnswer: 'FIFO',
      sampleLanguage: 'text',
      aiNotes: '',
      criteria: [{ name: 'Accuracy', maxMarks: 2 }],
    });
    expect(res.statusCode).toBe(201);
    await ada.peer.waitFor(() => stateOf(ada.peer.last('state')).questions?.length === 2);
    expect(stateOf(ada.peer.last('state')).questions?.[1]).toMatchObject({
      body: 'Explain a queue',
      position: 2,
    });
  });
});
