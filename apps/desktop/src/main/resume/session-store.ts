import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import type { SecretBox } from './secret-box.js';

/** What a restarted student app needs to rejoin without asking for the PIN again. */
export const StoredSessionSchema = z.object({
  target: z.object({
    address: z.string().min(1),
    port: z.number().int().min(1).max(65535),
    expectedFingerprint: z.string().min(1),
  }),
  token: z.string().min(1),
  examStudentId: z.string().min(1),
  name: z.string(),
  examTitle: z.string(),
});
export type StoredSession = z.infer<typeof StoredSessionSchema>;

/**
 * The student's session in one encrypted file in userData. It holds the token, so it is written
 * only through the secret box and is removed when the sign-in stops being valid.
 */
export class SessionStore {
  constructor(
    private readonly file: string,
    private readonly box: SecretBox,
  ) {}

  save(session: StoredSession): void {
    const text = this.box.encrypt(JSON.stringify(session));
    if (text === null) return;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(this.file, text);
    } catch (e) {
      console.warn(`Could not store the session: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** The stored session, or `null` when there is none or it cannot be read. */
  load(): StoredSession | null {
    let text: string;
    try {
      text = readFileSync(this.file, 'utf8');
    } catch {
      return null;
    }
    const json = this.box.decrypt(text.trim());
    if (json === null) return null;
    try {
      const parsed = StoredSessionSchema.safeParse(JSON.parse(json));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  clear(): void {
    try {
      rmSync(this.file, { force: true });
    } catch {
      // Nothing to remove, or it is locked: the next load fails the sign-in check anyway.
    }
  }
}
