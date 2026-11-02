import { describe, expect, it } from 'vitest';
import type { ServerToStudent } from '@examguard/shared';
import { TeacherMessages } from './teacher-messages.js';

function setup(connected = true) {
  const sent: { id: string; message: ServerToStudent }[] = [];
  const messages = new TeacherMessages({
    hub: { sendTo: (id, message) => sent.push({ id, message }), isConnected: () => connected },
    now: () => 9,
  });
  const texts = () => sent.map((s) => (s.message.t === 'message' ? s.message.text : s.message.t));
  return { messages, sent, texts };
}

describe('TeacherMessages', () => {
  it('sends at once, re-sends the unacked ones after a welcome, and forgets acked ones', () => {
    const t = setup();
    expect(t.messages.send('s1', 'info', 'one')).toBe(true);
    t.messages.send('s1', 'warning', 'two');
    const first = t.sent[0]?.message;
    if (first?.t !== 'message') throw new Error('expected a message');
    expect(first).toMatchObject({ kind: 'info', sentAt: 9 });
    t.messages.ack('s1', first.id);
    t.messages.onWelcome('s1');
    expect(t.texts()).toEqual(['one', 'two', 'two']);
    t.messages.onWelcome('s2');
    expect(t.sent).toHaveLength(3);
  });

  it('reports an offline student and keeps at most 20 per student', () => {
    const t = setup(false);
    expect(t.messages.send('s1', 'info', 'x')).toBe(false);
    for (let i = 0; i < 25; i += 1) t.messages.send('s1', 'info', `m${i}`);
    expect(t.messages.pendingFor('s1')).toBe(20);
    t.messages.reset();
    expect(t.messages.pendingFor('s1')).toBe(0);
  });
});
