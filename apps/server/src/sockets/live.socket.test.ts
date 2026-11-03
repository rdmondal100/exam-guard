import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startLiveExam, type LiveExam, type Peer } from '../testing/liveExam.js';

let live: LiveExam;
beforeEach(async () => {
  live = await startLiveExam();
});
afterEach(async () => {
  await live.close();
});

const sessions = (p: Peer) => p.json.filter((m) => m.t === 'live.session');
const offer = { type: 'offer', sdp: 'v=0\r\n' };
const answer = { type: 'answer', sdp: 'v=0\r\n' };

describe('WebRTC live view signaling over the sockets (M30, M34)', () => {
  it('asks the student, then relays offer, answer and candidates between the two ends', async () => {
    const ada = await live.student('1');
    const t = await live.teacher();
    t.ws.send(JSON.stringify({ t: 'live.open', examStudentId: ada.id }));
    await ada.peer.waitFor(() => ada.peer.last('live.request') !== undefined);
    const request = ada.peer.last('live.request');
    expect(request).toMatchObject({ maxWidth: 1280, fps: 8 });
    const sessionId = request?.['sessionId'];
    await t.waitFor(() => sessions(t).length === 1);
    expect(sessions(t)[0]).toMatchObject({
      sessionId,
      examStudentId: ada.id,
      status: 'connecting',
    });

    ada.peer.ws.send(JSON.stringify({ t: 'rtc.signal', sessionId, data: offer }));
    await t.waitFor(() => t.last('rtc.signal') !== undefined);
    expect(t.last('rtc.signal')).toMatchObject({ sessionId, data: offer });

    t.ws.send(JSON.stringify({ t: 'rtc.signal', sessionId, data: answer }));
    await ada.peer.waitFor(() => ada.peer.last('rtc.signal') !== undefined);
    expect(ada.peer.last('rtc.signal')).toMatchObject({ sessionId, data: answer });

    t.ws.send(JSON.stringify({ t: 'live.close', sessionId }));
    await ada.peer.waitFor(() => ada.peer.last('live.stop') !== undefined);
    await t.waitFor(() => sessions(t).length === 2);
    expect(sessions(t)[1]).toMatchObject({ status: 'ended', reason: 'closed' });
  });

  it('does not relay a signal for a session the student was not asked for', async () => {
    const ada = await live.student('1');
    const bob = await live.student('2');
    const t = await live.teacher();
    t.ws.send(JSON.stringify({ t: 'live.open', examStudentId: ada.id }));
    await ada.peer.waitFor(() => ada.peer.last('live.request') !== undefined);
    const sessionId = ada.peer.last('live.request')?.['sessionId'];
    bob.peer.ws.send(JSON.stringify({ t: 'rtc.signal', sessionId, data: offer }));
    ada.peer.ws.send(JSON.stringify({ t: 'rtc.signal', sessionId, data: answer }));
    await t.waitFor(() => t.last('rtc.signal') !== undefined);
    expect(t.json.filter((m) => m.t === 'rtc.signal')).toHaveLength(1);
    expect(t.last('rtc.signal')).toMatchObject({ data: answer });
  });

  it('refuses a third view and ends them all when the teacher socket closes', async () => {
    const ada = await live.student('1');
    const t = await live.teacher();
    for (let i = 0; i < 3; i += 1) {
      t.ws.send(JSON.stringify({ t: 'live.open', examStudentId: ada.id }));
    }
    await t.waitFor(() => sessions(t).length === 3);
    expect(sessions(t).map((m) => m.status)).toEqual(['connecting', 'connecting', 'failed']);
    expect(sessions(t)[2]).toMatchObject({ reason: 'too_many' });
    t.ws.close();
    await ada.peer.waitFor(() => ada.peer.json.filter((m) => m.t === 'live.stop').length === 2);
  });

  it('tells the teacher when the student fails or leaves', async () => {
    const ada = await live.student('1');
    const t = await live.teacher();
    t.ws.send(JSON.stringify({ t: 'live.open', examStudentId: ada.id }));
    await ada.peer.waitFor(() => ada.peer.last('live.request') !== undefined);
    const first = ada.peer.last('live.request')?.['sessionId'];
    ada.peer.ws.send(JSON.stringify({ t: 'live.state', sessionId: first, status: 'failed' }));
    await t.waitFor(() => sessions(t).some((m) => m.status === 'failed'));
    expect(sessions(t).at(-1)).toMatchObject({ sessionId: first, reason: 'student_failed' });

    t.ws.send(JSON.stringify({ t: 'live.open', examStudentId: ada.id }));
    await t.waitFor(() => sessions(t).length === 3);
    ada.peer.ws.close();
    await t.waitFor(() => sessions(t).length === 4);
    expect(sessions(t)[3]).toMatchObject({ status: 'ended', reason: 'student_left' });
  });

  it('refuses a student who is not connected', async () => {
    const t = await live.teacher();
    t.ws.send(JSON.stringify({ t: 'live.open', examStudentId: 'nobody' }));
    await t.waitFor(() => sessions(t).length === 1);
    expect(sessions(t)[0]).toMatchObject({ status: 'failed', reason: 'not_connected' });
  });
});
