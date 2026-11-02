import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startLiveExam, type LiveExam } from '../testing/liveExam.js';

let live: LiveExam;
beforeEach(async () => {
  live = await startLiveExam();
});
afterEach(async () => {
  await live.close();
});

const act = (sid: string, payload: object) =>
  live.call('POST', `/exams/${live.examId}/students/${sid}/actions`, payload);
const logged = () =>
  live.db
    .prepare(
      `SELECT action, payload_json AS payload FROM teacher_actions WHERE action NOT IN ('host', 'start', 'stop_hosting', 'end_all') ORDER BY id`,
    )
    .all();
type State = {
  studentState?: string;
  locked?: boolean;
  lockReason?: string | null;
  deadline?: number;
};
const stateOf = (m: { [k: string]: unknown } | undefined) => (m?.state ?? {}) as State;

describe('per-student actions (M35)', () => {
  it('sends a warning that is re-sent after a reconnect until the app acks it', async () => {
    const ada = await live.student('1');
    const res = await act(ada.id, {
      type: 'message',
      kind: 'warning',
      text: ' Eyes on your screen ',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, studentState: 'lobby', delivered: true });
    await ada.peer.waitFor(() => ada.peer.last('message') !== undefined);
    const message = ada.peer.last('message');
    expect(message).toMatchObject({ kind: 'warning', text: 'Eyes on your screen' });

    // Not acked yet: a new socket gets it again; after the ack it does not.
    ada.peer.ws.close();
    const again = await live.reconnect(ada.token);
    await again.waitFor(() => again.last('message')?.id === message?.id);
    again.ws.send(JSON.stringify({ t: 'ack', id: message?.id }));
    await new Promise((r) => setTimeout(r, 50));
    again.ws.close();
    const third = await live.reconnect(ada.token);
    await new Promise((r) => setTimeout(r, 50));
    expect(third.last('message')).toBeUndefined();
    expect(logged()).toEqual([{ action: 'warn', payload: '{"text":"Eyes on your screen"}' }]);
  });

  it('locks and unlocks a working student, with the teacher as the reason', async () => {
    const ada = await live.student('1');
    expect((await act(ada.id, { type: 'lock' })).statusCode).toBe(409);
    await live.start();
    await ada.peer.waitFor(() => stateOf(ada.peer.last('state')).studentState === 'active');

    const locked = await act(ada.id, { type: 'lock' });
    expect(locked.json()).toMatchObject({ studentState: 'locked' });
    await ada.peer.waitFor(() => stateOf(ada.peer.last('state')).lockReason === 'teacher');
    expect((await act(ada.id, { type: 'lock' })).statusCode).toBe(409);
    // A reconnect still shows why.
    const again = await live.reconnect(ada.token);
    expect(stateOf(again.last('welcome'))).toMatchObject({ locked: true, lockReason: 'teacher' });

    expect((await act(ada.id, { type: 'unlock' })).json()).toMatchObject({
      studentState: 'active',
    });
    await again.waitFor(() => stateOf(again.last('state')).locked === false);
    expect(logged().map((r) => (r as { action: string }).action)).toEqual(['lock', 'unlock']);
  });

  it('extends one student and pushes the new deadline', async () => {
    const ada = await live.student('1');
    await live.start();
    await ada.peer.waitFor(() => stateOf(ada.peer.last('state')).deadline !== undefined);
    const before = stateOf(ada.peer.last('state')).deadline ?? 0;
    const res = await act(ada.id, { type: 'extend', minutes: 10 });
    expect(res.json().deadline).toBe(before + 600_000);
    await ada.peer.waitFor(() => stateOf(ada.peer.last('state')).deadline === before + 600_000);
    expect((await act(ada.id, { type: 'extend', minutes: 0 })).statusCode).toBe(400);
  });

  it('ends the exam for one student with a receipt', async () => {
    const ada = await live.student('1');
    const bob = await live.student('2');
    expect((await act(ada.id, { type: 'end' })).statusCode).toBe(409);
    await live.start();
    const res = await act(ada.id, { type: 'end' });
    expect(res.json()).toMatchObject({ studentState: 'ended_by_teacher' });
    await ada.peer.waitFor(
      () => stateOf(ada.peer.last('state')).studentState === 'ended_by_teacher',
    );
    expect((await act(ada.id, { type: 'end' })).statusCode).toBe(409);
    expect((await act(ada.id, { type: 'extend', minutes: 5 })).statusCode).toBe(409);
    const bobRow = live.db.prepare('SELECT state FROM exam_students WHERE id = ?').get(bob.id);
    expect(bobRow).toEqual({ state: 'active' });
  });

  it('resets a session so the student can join from another PC', async () => {
    const ada = await live.student('1');
    expect((await live.join('1', 'other-pc-bbbb')).body.error?.code).toBe(
      'already_active_elsewhere',
    );
    const res = await act(ada.id, { type: 'reset_session' });
    expect(res.json()).toMatchObject({ ok: true, delivered: true });
    expect(await ada.peer.closed).toBe(4401);
    const rejoined = await live.join('1', 'other-pc-bbbb');
    expect(rejoined.status).toBe(200);
    expect(typeof rejoined.body.token).toBe('string');
    expect(logged().map((r) => (r as { action: string }).action)).toEqual(['reset_session']);
  });

  it('refuses unknown students, other exams and bad bodies', async () => {
    const ada = await live.student('1');
    expect((await act('nobody', { type: 'lock' })).statusCode).toBe(404);
    expect((await act(ada.id, { type: 'message', kind: 'info', text: '   ' })).statusCode).toBe(
      400,
    );
    expect((await act(ada.id, { type: 'fly' })).statusCode).toBe(400);
    const other = await live.call('POST', `/exams/nope/students/${ada.id}/actions`, {
      type: 'lock',
    });
    expect(other.statusCode).toBe(404);
  });
});
