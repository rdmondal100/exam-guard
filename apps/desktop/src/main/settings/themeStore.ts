import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { ThemeSourceSchema, type ThemeSource } from '@examguard/shared';

const StoredThemeSchema = z.object({ theme: ThemeSourceSchema });

export function themeFilePath(userData: string): string {
  return join(userData, 'theme.json');
}

/** Missing, unreadable or invalid files all mean "follow Windows". */
export async function loadStoredTheme(userData: string): Promise<ThemeSource> {
  try {
    const raw: unknown = JSON.parse(await readFile(themeFilePath(userData), 'utf8'));
    const parsed = StoredThemeSchema.safeParse(raw);
    return parsed.success ? parsed.data.theme : 'system';
  } catch {
    return 'system';
  }
}

export async function saveStoredTheme(userData: string, theme: ThemeSource): Promise<void> {
  const file = themeFilePath(userData);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify({ theme }), 'utf8');
}
