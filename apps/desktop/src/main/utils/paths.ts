import { join } from 'node:path';
import { app } from 'electron';

/**
 * The small program that reads a browser's address bar (`tracking/site.ts`): `resources/` in the
 * repo while developing (built by `scripts/build-site-reader.mjs`), next to the app once installed.
 */
export function siteReaderPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'SiteReader.exe')
    : join(app.getAppPath(), 'resources', 'SiteReader.exe');
}

/** `%LOCALAPPDATA%` (or temp): the run folders and the terminal workspace live under it. */
export function localAppData(): string {
  return process.env.LOCALAPPDATA ?? app.getPath('temp');
}
