import type { TeacherMessageToStudent } from '@examguard/shared';

/** Most popups waiting at once; the oldest unseen ones are dropped past this. */
export const MAX_QUEUED_MESSAGES = 20;

/** Adds a message to the popup queue, once per id, keeping the queue bounded. */
export function queueMessage(
  queue: readonly TeacherMessageToStudent[],
  message: TeacherMessageToStudent,
): TeacherMessageToStudent[] {
  if (queue.some((m) => m.id === message.id)) return [...queue];
  return [...queue, message].slice(-MAX_QUEUED_MESSAGES);
}
