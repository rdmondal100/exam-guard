import { describe, expect, it } from 'vitest';
import {
  TeacherThumbHeaderSchema,
  decodeThumbFrame,
  encodeThumbFrame,
  type ServerToStudent,
} from '@examguard/shared';
import { ThumbRelay, type ThumbViewer } from './thumbRelay.js';

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 9, 9]);
const frame = (ts = 1) => encodeThumbFrame({ ts }, JPEG);

function setup(connected: string[] = ['a', 'b', 'c']) {
  const sent: { id: string; message: ServerToStudent }[] = [];
  const online = new Set(connected);
  const relay = new ThumbRelay({
    students: {
      isConnected: (id) => online.has(id),
      sendTo: (id, message) => sent.push({ id, message }),
    },
    now: () => 1000,
  });
  const viewer = () => {
    const got: string[] = [];
    const v: ThumbViewer = {
      sendBinary: (f) =>
        got.push(decodeThumbFrame(f, TeacherThumbHeaderSchema)?.header.examStudentId ?? '?'),
    };
    return { v, got };
  };
  const commands = () => sent.map((s) => `${s.id}:${s.message.t}`);
  return { relay, sent, online, viewer, commands };
}

describe('ThumbRelay', () => {
  it('starts only the watched, connected students and stops those that leave the page', () => {
    const { relay, viewer, commands } = setup(['a', 'b']);
    const { v } = viewer();
    relay.watch(v, ['a', 'x']);
    expect(commands()).toEqual(['a:thumb.start']);
    relay.watch(v, ['b']);
    expect(commands()).toEqual(['a:thumb.start', 'a:thumb.stop', 'b:thumb.start']);
    relay.unwatch(v);
    expect(commands().at(-1)).toBe('b:thumb.stop');
    expect(relay.stats().streaming).toBe(0);
  });

  it('keeps a student streaming while any viewer still watches them', () => {
    const { relay, viewer, commands } = setup();
    const one = viewer();
    const two = viewer();
    relay.watch(one.v, ['a']);
    relay.watch(two.v, ['a', 'b']);
    relay.watch(one.v, []);
    expect(commands()).toEqual(['a:thumb.start', 'b:thumb.start']);
  });

  it('forwards a frame only to the viewers of that student and keeps the latest for a page switch', () => {
    const { relay, viewer } = setup();
    const one = viewer();
    const two = viewer();
    relay.watch(one.v, ['a']);
    relay.watch(two.v, ['b']);
    relay.frame('a', frame());
    expect(one.got).toEqual(['a']);
    expect(two.got).toEqual([]);
    relay.watch(two.v, ['a', 'b']);
    expect(two.got).toEqual(['a']);
    const stats = relay.stats();
    expect(stats).toMatchObject({ framesIn: 1, framesOut: 2, cached: 1, viewers: 2, dropped: 0 });
  });

  it('drops frames from unwatched students, malformed frames and non-JPEG pictures', () => {
    const { relay, viewer } = setup();
    const { v, got } = viewer();
    relay.frame('a', frame());
    relay.watch(v, ['a']);
    relay.frame('a', new Uint8Array([1, 2, 3]));
    relay.frame('a', encodeThumbFrame({ ts: 1 }, new Uint8Array([1, 2, 3, 4, 5, 6])));
    expect(got).toEqual([]);
    expect(relay.stats()).toMatchObject({ framesIn: 0, dropped: 3, cached: 0 });
  });

  it('asks a watched student again after a reconnect, and nothing after a disconnect', () => {
    const { relay, online, viewer, commands } = setup(['a']);
    const { v } = viewer();
    relay.watch(v, ['a', 'b']);
    relay.onDisconnect('a');
    relay.frame('a', frame());
    expect(relay.stats().dropped).toBe(1);
    online.add('b');
    relay.onWelcome('b');
    relay.onWelcome('a');
    relay.onWelcome('c');
    expect(commands()).toEqual(['a:thumb.start', 'b:thumb.start', 'a:thumb.start']);
  });

  it('forgets every picture and counter on reset', () => {
    const { relay, viewer } = setup();
    const { v } = viewer();
    relay.watch(v, ['a']);
    relay.frame('a', frame());
    relay.reset();
    expect(relay.stats()).toMatchObject({ cached: 0, framesIn: 0, streaming: 0, viewers: 1 });
  });
});
