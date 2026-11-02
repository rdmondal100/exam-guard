import { describe, expect, it } from 'vitest';
import type { RosterEntry } from '@examguard/shared';
import { actionDoneText, availableActions, confirmText } from './studentActions';

const s = (state: RosterEntry['state']): RosterEntry => ({
  id: 's1',
  studentCode: '7',
  name: 'Ada',
  state,
  connected: true,
  riskScore: 0,
  outsideMs: 0,
  lastSeen: null,
  agentOk: true,
  internetBlocked: false,
  monitors: 1,
});

describe('availableActions', () => {
  it('offers lock, end and extend to a working student of a running exam', () => {
    expect(availableActions('running', s('active'))).toEqual({
      message: true,
      lock: true,
      unlock: false,
      extend: true,
      end: true,
      reset: true,
    });
    expect(availableActions('running', s('locked'))).toMatchObject({ lock: false, unlock: true });
  });

  it('offers only message, extend and reset before the start', () => {
    expect(availableActions('hosting', s('lobby'))).toEqual({
      message: true,
      lock: false,
      unlock: false,
      extend: true,
      end: false,
      reset: true,
    });
  });

  it('offers nothing once the exam is over, and no extension to a finished student', () => {
    expect(Object.values(availableActions('ended', s('submitted'))).some(Boolean)).toBe(false);
    expect(availableActions('running', s('submitted'))).toMatchObject({
      extend: false,
      end: false,
    });
  });
});

describe('action texts', () => {
  const ok = {
    ok: true as const,
    studentState: 'active' as const,
    deadline: null,
    delivered: false,
  };

  it('says when a message waits for a reconnect', () => {
    expect(actionDoneText({ type: 'message', kind: 'warning', text: 'x' }, ok)).toBe(
      'Warning sent. It will reach the student when their PC reconnects.',
    );
    expect(actionDoneText({ type: 'extend', minutes: 5 }, { ...ok, delivered: true })).toBe(
      '5 minutes added.',
    );
  });

  it('asks before ending or resetting, and not before a lock', () => {
    expect(confirmText({ type: 'end' }, s('active'))).toContain('Ada (7)');
    expect(confirmText({ type: 'reset_session' }, s('active'))).toContain('join again');
    expect(confirmText({ type: 'lock' }, s('active'))).toBeNull();
  });
});
