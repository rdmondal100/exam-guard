import { z } from 'zod';

/** Wire protocol version. See docs/protocol.md §1. */
export const ProtocolVersionSchema = z.object({
  major: z.number().int().nonnegative(),
  minor: z.number().int().nonnegative(),
});

export type ProtocolVersion = z.infer<typeof ProtocolVersionSchema>;

/**
 * 5 (M59-M64): the server refuses saves and Submit while paused (`paused`), a readiness report
 * must hold every check, and the `monitor_stalled`/`monitor_recovered` events.
 * 4 (M58): pause/resume (a 3.x app would keep its editor open while paused) and questions or files
 * added mid-exam. 3 (M52-M57): separate Teacher and Student apps, practice exams, the readiness
 * report. 2: the monitor moved into the student app.
 */
export const PROTOCOL_VERSION: ProtocolVersion = { major: 5, minor: 0 };

/** Same major = compatible. A different minor is accepted. */
export function isProtocolCompatible(
  peer: ProtocolVersion,
  own: ProtocolVersion = PROTOCOL_VERSION,
): boolean {
  return peer.major === own.major;
}
