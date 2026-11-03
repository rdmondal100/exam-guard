import { safeStorage } from 'electron';
import { createSecretBox } from './resume/secret-box.js';
import { AiKeyStore } from './settings/ai-key-store.js';

/**
 * Dev fallback for the AI key: `EG_GEMINI_API_KEY` in the shell that started the app, never a
 * file in the repo. The key saved in Settings (M43, `secrets.bin`) wins over it.
 */
export function envGradingKey(): string | null {
  const key = process.env.EG_GEMINI_API_KEY?.trim();
  return key ? key : null;
}

/** The profile's AI key store, encrypted with `safeStorage`. */
export function createAiKeyStore(dataDir: () => string): AiKeyStore {
  return new AiKeyStore({
    dataDir,
    box: createSecretBox(safeStorage),
    encryptionAvailable: () => safeStorage.isEncryptionAvailable(),
    envKey: envGradingKey,
  });
}

/** Dev switch: grade with the server's built-in fake instead of Gemini (`EG_FAKE_GRADER=1`). */
export function fakeGraderEnabled(): boolean {
  return process.env.EG_FAKE_GRADER === '1';
}
