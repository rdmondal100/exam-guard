import { randomInt } from 'node:crypto';

/** A 6-digit PIN, leading zeros kept. */
export function generatePin(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}
