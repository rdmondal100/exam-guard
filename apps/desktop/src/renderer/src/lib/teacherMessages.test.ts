import { describe, expect, it } from 'vitest';
import type { TeacherMessageToStudent } from '@examguard/shared';
import { MAX_QUEUED_MESSAGES, queueMessage } from './teacherMessages';

const m = (id: string): TeacherMessageToStudent => ({
  t: 'message',
  id,
  kind: 'info',
  text: id,
  sentAt: 1,
});

describe('queueMessage', () => {
  it('adds each id once, in arrival order', () => {
    const q = queueMessage(queueMessage(queueMessage([], m('a')), m('b')), m('a'));
    expect(q.map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('keeps the newest when too many wait', () => {
    let q: TeacherMessageToStudent[] = [];
    for (let i = 0; i < MAX_QUEUED_MESSAGES + 3; i += 1) q = queueMessage(q, m(`m${i}`));
    expect(q).toHaveLength(MAX_QUEUED_MESSAGES);
    expect(q[0]?.id).toBe('m3');
  });
});
