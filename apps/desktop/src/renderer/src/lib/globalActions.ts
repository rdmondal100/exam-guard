import type { BroadcastResult, ExtendAllResult, HostingCounts } from '@examguard/shared';
import { clockTime } from './terminalLog';

/** Quick extra-time choices for everyone, minutes. */
export const EXTEND_ALL_CHOICES = [5, 10, 15] as const;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The confirmation before adding time for everyone (M36). */
export function extendAllQuestion(minutes: number, counts: HostingCounts | null): string {
  const working = counts?.active ?? 0;
  return (
    `Add ${minutes} minutes for everyone? ${plural(working, 'student')} ` +
    `${working === 1 ? 'is' : 'are'} still working. Personal extra time stays on top.`
  );
}

/** The confirmation before a message to every joined student (M36). */
export function broadcastQuestion(kind: 'info' | 'warning', counts: HostingCounts | null): string {
  const what = kind === 'warning' ? 'warning' : 'message';
  return `Send this ${what} to all ${plural(counts?.joined ?? 0, 'joined student')}?`;
}

export function extendAllDoneText(minutes: number, result: ExtendAllResult): string {
  const end =
    result.deadline === null ? '' : ` The exam now ends at ${clockTime(result.deadline)}.`;
  return `${minutes} minutes added for everyone.${end}`;
}

export function broadcastDoneText(result: BroadcastResult): string {
  const later = result.sent - result.delivered;
  const offline = later > 0 ? ` ${later} offline will see it when they reconnect.` : '';
  return `Sent to ${plural(result.sent, 'student')}.${offline}`;
}
