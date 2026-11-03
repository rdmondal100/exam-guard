import { describe, expect, it } from 'vitest';
import type { LiveSession } from '@examguard/shared';
import { LiveChannel, type LiveEvent } from './liveChannel.js';

const session = (
  sessionId: string,
  status: LiveSession['status'],
  examStudentId = 's1',
): LiveSession => ({
  t: 'live.session',
  sessionId,
  examStudentId,
  status,
});

function setup() {
  const channel = new LiveChannel();
  const sent: unknown[] = [];
  channel.setSender((m) => sent.push(m));
  return { channel, sent };
}

describe('LiveChannel', () => {
  it('names a session from the server answer and routes signals by it', () => {
    const { channel, sent } = setup();
    const events: LiveEvent[] = [];
    const handle = channel.open('s1', (e) => events.push(e));
    expect(sent).toEqual([{ t: 'live.open', examStudentId: 's1' }]);
    channel.handle(session('l1', 'connecting'));
    channel.handle({ t: 'rtc.signal', sessionId: 'l1', data: { type: 'offer', sdp: 'v=0' } });
    channel.handle({ t: 'rtc.signal', sessionId: 'l2', data: { candidate: 'x' } });
    handle.signal({ type: 'answer', sdp: 'v=0' });
    expect(events.map((e) => e.kind)).toEqual(['status', 'signal']);
    expect(sent.at(-1)).toEqual({
      t: 'rtc.signal',
      sessionId: 'l1',
      data: { type: 'answer', sdp: 'v=0' },
    });
    handle.close();
    expect(sent.at(-1)).toEqual({ t: 'live.close', sessionId: 'l1' });
    expect(channel.count()).toBe(0);
  });

  it('closes a session that was closed before the server named it', () => {
    const { channel, sent } = setup();
    const events: LiveEvent[] = [];
    channel.open('s1', (e) => events.push(e)).close();
    channel.handle(session('l1', 'connecting'));
    expect(sent.at(-1)).toEqual({ t: 'live.close', sessionId: 'l1' });
    expect(events).toEqual([]);
    expect(channel.count()).toBe(0);
  });

  it('tells open views when their session fails or the socket drops', () => {
    const { channel } = setup();
    const a: LiveEvent[] = [];
    const b: LiveEvent[] = [];
    channel.open('s1', (e) => a.push(e));
    channel.open('s2', (e) => b.push(e));
    channel.handle(session('l1', 'failed'));
    expect(a.at(-1)).toMatchObject({ kind: 'status', session: { status: 'failed' } });
    channel.setSender(null);
    expect(b.at(-1)).toMatchObject({
      kind: 'status',
      session: { status: 'ended', reason: 'closed' },
    });
    expect(channel.count()).toBe(0);
    const c: LiveEvent[] = [];
    channel.open('s3', (e) => c.push(e));
    expect(c.at(-1)).toMatchObject({ kind: 'status', session: { status: 'failed' } });
  });
});
