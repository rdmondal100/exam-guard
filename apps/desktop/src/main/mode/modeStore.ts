import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { AppModeSchema, allowedModesFor, type AppMode, type InstallType } from '@examguard/shared';

const StoredModeSchema = z.object({ mode: AppModeSchema });

export function modeFilePath(userData: string): string {
  return join(userData, 'mode.json');
}

/** Missing, unreadable or invalid files all mean "no mode chosen yet". */
export async function loadStoredMode(userData: string): Promise<AppMode | null> {
  try {
    const raw: unknown = JSON.parse(await readFile(modeFilePath(userData), 'utf8'));
    const parsed = StoredModeSchema.safeParse(raw);
    return parsed.success ? parsed.data.mode : null;
  } catch {
    return null;
  }
}

export async function saveStoredMode(userData: string, mode: AppMode): Promise<void> {
  const file = modeFilePath(userData);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify({ mode }), 'utf8');
}

/** A student install is always Student mode; a stored mode that is not allowed is ignored. */
export function resolveMode(installType: InstallType, stored: AppMode | null): AppMode | null {
  const allowed = allowedModesFor(installType);
  if (allowed.length === 1) return allowed[0] ?? null;
  return stored && allowed.includes(stored) ? stored : null;
}
