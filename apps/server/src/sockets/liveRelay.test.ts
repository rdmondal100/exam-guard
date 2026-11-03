import { describe, expect, it } from 'vitest';
import type { ServerToStudent } from '@examguard/shared';
import { LiveRelay, type LiveViewer } from './liveRelay.js';

function setup() {
  const toStudents: { id: string; message: ServerToStudent }[] = [];
  let n = 0;
  const relay = new LiveRelay({
    students: {
      isConnected: (id) => id !== 'gone',
      sendTo: (id, message) => toStudents.push({ id, message }),
    },
    newSessionId: () => `l${(n += 1)}`,
  });
  const got: unknown[] = [];
  const viewer: LiveViewer = { send: (m) => got.push(m) };
  return { relay, viewer, got, toStudents };
}

describe('LiveRelay', () => {
  it('ends every session without asking students when hosting stops', () => {
    const { relay, viewer, got, toStudents } = setup();
    relay.open(viewer, 's1');
    relay.open(viewer, 's2');
    expect(relay.count()).toBe(2);
    relay.reset();
    expect(relay.count()).toBe(0);
    expect(toStudents.filter((s) => s.message.t === 'live.stop')).toHaveLength(0);
    expect(got.slice(2)).toEqual([
      {
        t: 'live.session',
        sessionId: 'l1',
        examStudentId: 's1',
        status: 'ended',
        reason: 'hosting_stopped',
      },
      {
        t: 'live.session',
        sessionId: 'l2',
        examStudentId: 's2',
        status: 'ended',
        reason: 'hosting_stopped',
      },
    ]);
  });

  it('ignores close and signals from another teacher socket', () => {
    const { relay, viewer, toStudents } = setup();
    const other: LiveViewer = { send: () => undefined };
    relay.open(viewer, 's1');
    relay.close(other, 'l1');
    relay.fromTeacher(other, 'l1', { type: 'answer', sdp: 'v=0' });
    expect(relay.count()).toBe(1);
    expect(toStudents.map((s) => s.message.t)).toEqual(['live.request']);
  });

  it('keeps no session for a refused open', () => {
    const { relay, viewer, got } = setup();
    relay.open(viewer, 'gone');
    expect(relay.count()).toBe(0);
    expect(got).toEqual([
      {
        t: 'live.session',
        sessionId: 'l1',
        examStudentId: 'gone',
        status: 'failed',
        reason: 'not_connected',
      },
    ]);
  });
});
