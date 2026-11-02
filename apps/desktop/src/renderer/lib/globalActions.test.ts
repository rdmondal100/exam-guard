import { describe, expect, it } from 'vitest';
import {
  broadcastDoneText,
  broadcastQuestion,
  extendAllDoneText,
  extendAllQuestion,
} from './globalActions';
import { clockTime } from './terminalLog';

const counts = { joined: 30, inLobby: 0, active: 28, submitted: 2, connected: 29 };

describe('global action texts (M36)', () => {
  it('asks before acting on everyone', () => {
    expect(extendAllQuestion(10, counts)).toContain('Add 10 minutes for everyone? 28 students are');
    expect(extendAllQuestion(5, { ...counts, active: 1 })).toContain('1 student is');
    expect(broadcastQuestion('warning', counts)).toBe(
      'Send this warning to all 30 joined students?',
    );
    expect(broadcastQuestion('info', null)).toBe('Send this message to all 0 joined students?');
  });

  it('reports the new end and who is offline', () => {
    const deadline = Date.UTC(2026, 10, 3, 10, 30);
    expect(extendAllDoneText(10, { ok: true, deadline, extensionMin: 10 })).toBe(
      `10 minutes added for everyone. The exam now ends at ${clockTime(deadline)}.`,
    );
    expect(broadcastDoneText({ ok: true, sent: 30, delivered: 28 })).toBe(
      'Sent to 30 students. 2 offline will see it when they reconnect.',
    );
    expect(broadcastDoneText({ ok: true, sent: 1, delivered: 1 })).toBe('Sent to 1 student.');
  });
});
