import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AiKeyStatus } from '@examguard/shared';
import type { SecretBox } from '../resume/secret-box.js';

export interface AiKeyStoreDeps {
  /** The data folder; the key lives in `<dataDir>/secrets.bin` (data-model). It can move (M44). */
  dataDir: () => string;
  box: SecretBox;
  /** `safeStorage.isEncryptionAvailable()`. */
  encryptionAvailable: () => boolean;
  /** Dev fallback: `EG_GEMINI_API_KEY` from the shell that started the app. */
  envKey?: () => string | null;
}

/**
 * The teacher's AI key (M43): encrypted with `safeStorage` (DPAPI, tied to the Windows user) in
 * `secrets.bin`, never in the database, never logged, never sent back to the renderer. Main hands
 * it to the server over the process port at each grading run. Without encryption nothing is
 * saved: the teacher sees why and the key stays unset.
 */
export class AiKeyStore {
  constructor(private readonly deps: AiKeyStoreDeps) {}

  private get file(): string {
    return join(this.deps.dataDir(), 'secrets.bin');
  }

  /** The key for a grading run: the saved one, else the dev variable. */
  key(): string | null {
    return this.stored() ?? this.deps.envKey?.() ?? null;
  }

  status(): AiKeyStatus {
    const stored = this.stored() !== null;
    const env = !stored && (this.deps.envKey?.() ?? null) !== null;
    return {
      set: stored || env,
      source: stored ? 'stored' : env ? 'env' : null,
      encryptionAvailable: this.deps.encryptionAvailable(),
    };
  }

  /** Returns false when the key could not be encrypted (nothing is written then). */
  save(apiKey: string): boolean {
    const sealed = this.deps.box.encrypt(JSON.stringify({ geminiApiKey: apiKey }));
    if (sealed === null) return false;
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, sealed, { mode: 0o600 });
    renameSync(tmp, this.file);
    return true;
  }

  clear(): void {
    rmSync(this.file, { force: true });
  }

  private stored(): string | null {
    if (!existsSync(this.file)) return null;
    const text = this.deps.box.decrypt(readFileSync(this.file, 'utf8').trim());
    if (text === null) return null;
    try {
      const value = (JSON.parse(text) as { geminiApiKey?: unknown }).geminiApiKey;
      return typeof value === 'string' && value.length > 0 ? value : null;
    } catch {
      return null;
    }
  }
}
