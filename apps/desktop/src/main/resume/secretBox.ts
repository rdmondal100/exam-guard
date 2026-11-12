/** Encrypts small strings for files in userData. `null` means "could not": callers write nothing. */
export interface SecretBox {
  encrypt(text: string): string | null;
  decrypt(text: string): string | null;
}

/** The part of Electron's `safeStorage` the box uses. */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(text: string): Buffer;
  decryptString(data: Buffer): string;
}

/**
 * `safeStorage` (DPAPI, tied to the Windows user) with base64 text so a value fits on one line.
 * When encryption is not available nothing is encrypted and nothing is written: the work stays in
 * memory only, never in a readable file.
 */
export function createSecretBox(storage: SafeStorageLike): SecretBox {
  return {
    encrypt(text) {
      try {
        return storage.isEncryptionAvailable()
          ? storage.encryptString(text).toString('base64')
          : null;
      } catch {
        return null;
      }
    },
    decrypt(text) {
      try {
        return storage.decryptString(Buffer.from(text, 'base64'));
      } catch {
        return null;
      }
    },
  };
}
