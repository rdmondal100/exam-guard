import { z } from 'zod';

/** Wire protocol version. See docs/protocol.md §1. */
export const ProtocolVersionSchema = z.object({
  major: z.number().int().nonnegative(),
  minor: z.number().int().nonnegative(),
});

export type ProtocolVersion = z.infer<typeof ProtocolVersionSchema>;

export const PROTOCOL_VERSION: ProtocolVersion = { major: 1, minor: 0 };

/** Same major = compatible. A different minor is accepted. */
export function isProtocolCompatible(
  peer: ProtocolVersion,
  own: ProtocolVersion = PROTOCOL_VERSION,
): boolean {
  return peer.major === own.major;
}
