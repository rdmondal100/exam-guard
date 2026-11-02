import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  TeacherThumbHeaderSchema,
  decodeThumbFrame,
  encodeThumbFrame,
  type ThumbStats,
} from '@examguard/shared';
import { startLiveExam, type LiveExam, type Peer } from '../testing/liveExam.js';

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

let live: LiveExam;
beforeEach(async () => {
  live = await startLiveExam();
});
afterEach(async () => {
  await live.close();
});

const kinds = (p: Peer) => p.json.map((m) => m.t).filter((t) => t.startsWith('thumb'));
const stats = async () => (await live.call('GET', '/thumbs/stats')).json() as ThumbStats;

describe('thumbnail grid over the sockets (M29, M33)', () => {
  it('streams only the visible students and forwards their frames to the teacher', async () => {
    const ada = await live.student('1');
    const bob = await live.student('2');
    const t = await live.teacher();
    t.ws.send(JSON.stringify({ t: 'thumbs.subscribe', examStudentIds: [ada.id] }));
    await ada.peer.waitFor(() => kinds(ada.peer).includes('thumb.start'));
    expect(ada.peer.last('thumb.start')).toMatchObject({ intervalMs: 4000, width: 320 });

    ada.peer.ws.send(encodeThumbFrame({ ts: 5 }, JPEG), { binary: true });
    await t.waitFor(() => t.binary.length === 1);
    const got = decodeThumbFrame(t.binary[0] ?? new Uint8Array(), TeacherThumbHeaderSchema);
    expect(got?.header.examStudentId).toBe(ada.id);
    expect(Array.from(got?.jpeg ?? [])).toEqual(Array.from(JPEG));

    // Bob is not on the page: his frame is dropped and he was never asked.
    bob.peer.ws.send(encodeThumbFrame({ ts: 5 }, JPEG), { binary: true });
    t.ws.send(JSON.stringify({ t: 'thumbs.subscribe', examStudentIds: [bob.id] }));
    await ada.peer.waitFor(() => kinds(ada.peer).includes('thumb.stop'));
    await bob.peer.waitFor(() => kinds(bob.peer).includes('thumb.start'));
    expect(await stats()).toMatchObject({
      streaming: 1,
      viewers: 1,
      framesIn: 1,
      framesOut: 1,
      dropped: 1,
    });
  });

  it('stops everyone when the teacher socket closes', async () => {
    const ada = await live.student('1');
    const t = await live.teacher();
    t.ws.send(JSON.stringify({ t: 'thumbs.subscribe', examStudentIds: [ada.id] }));
    await ada.peer.waitFor(() => kinds(ada.peer).includes('thumb.start'));
    t.ws.close();
    await ada.peer.waitFor(() => kinds(ada.peer).includes('thumb.stop'));
    expect(await stats()).toMatchObject({ streaming: 0, viewers: 0 });
  });

  it('refuses a thumbnail before hello', async () => {
    const peer = await live.rawStudent();
    peer.ws.send(encodeThumbFrame({ ts: 1 }, JPEG), { binary: true });
    expect(await peer.closed).toBe(4400);
  });
});
