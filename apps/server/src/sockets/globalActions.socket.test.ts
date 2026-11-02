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
const deadlineOf = (m: { [k: string]: unknown } | undefined) =>
  ((m?.state ?? {}) as { deadline?: number }).deadline;

describe('global actions (M36)', () => {
  it('extends everyone, keeps a personal extension on top, and refuses before Start', async () => {
    const ada = await live.student('1');
    const bob = await live.student('2');
    expect((await act({ type: 'extend_all', minutes: 10 })).statusCode).toBe(409);
    await live.start();
    await ada.peer.waitFor(() => deadlineOf(ada.peer.last('state')) !== undefined);
    const before = deadlineOf(ada.peer.last('state')) ?? 0;
    await live.call('POST', `/exams/${live.examId}/students/${bob.id}/actions`, {
      type: 'extend',
      minutes: 5,
    });

    const res = await act({ type: 'extend_all', minutes: 10 });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, deadline: before + 600_000, extensionMin: 10 });
    await ada.peer.waitFor(() => deadlineOf(ada.peer.last('state')) === before + 600_000);
    await bob.peer.waitFor(() => deadlineOf(bob.peer.last('state')) === before + 900_000);
    const info = (await live.call('GET', `/exams/${live.examId}/hosting`)).json() as object;
    expect(info).toMatchObject({ deadline: before + 600_000, extensionMin: 10 });
  });

  it('broadcasts a popup to every joined student, counting the offline ones', async () => {
    const ada = await live.student('1');
    const bob = await live.student('2');
    bob.peer.ws.close();
    await new Promise((r) => setTimeout(r, 50));
    const res = await act({ type: 'broadcast', kind: 'info', text: ' 10 minutes left ' });
    expect(res.json()).toEqual({ ok: true, sent: 2, delivered: 1 });
    await ada.peer.waitFor(() => ada.peer.last('message') !== undefined);
    expect(ada.peer.last('message')).toMatchObject({ kind: 'info', text: '10 minutes left' });
    const again = await live.reconnect(bob.token);
    await again.waitFor(() => again.last('message') !== undefined);
    expect(again.last('message')).toMatchObject({ text: '10 minutes left' });
    expect((await act({ type: 'broadcast', kind: 'info', text: '' })).statusCode).toBe(400);
  });

  it('lists every action newest first with student names, the end for all included', async () => {
    const ada = await live.student('1');
    await live.start();
    await live.call('POST', `/exams/${live.examId}/students/${ada.id}/actions`, {
      type: 'message',
      kind: 'warning',
      text: 'Eyes on your screen',
    });
    await act({ type: 'extend_all', minutes: 5 });
    await live.call('POST', `/exams/${live.examId}/end`, {});

    const res = await live.call('GET', `/exams/${live.examId}/actions`);
    expect(res.statusCode).toBe(200);
    const { actions } = AuditResponseSchema.parse(res.json());
    expect(actions.map((a) => a.action)).toEqual([
      'end_all',
      'extend_all',
      'warn',
      'start',
      'host',
    ]);
    expect(actions[0]?.payload).toEqual({ reason: 'manual' });
    expect(actions[2]).toMatchObject({
      studentCode: '1',
      studentName: 'Ada',
      examStudentId: ada.id,
    });
    expect(actions[1]).toMatchObject({ studentCode: null, payload: { minutes: 5 } });

    const limited = await live.call('GET', `/exams/${live.examId}/actions?limit=2`);
    expect(AuditResponseSchema.parse(limited.json()).actions).toHaveLength(2);
    expect((await live.call('GET', `/exams/${live.examId}/actions?limit=0`)).statusCode).toBe(400);
    expect((await live.call('GET', '/exams/nope/actions')).statusCode).toBe(404);
  });
});
