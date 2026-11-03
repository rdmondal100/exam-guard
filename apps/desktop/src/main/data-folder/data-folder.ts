import type { DataFolderInfo } from '@examguard/shared';
import { loadDataDir, samePath, saveDataDir } from './data-location.js';

/**
 * The teacher's data folder (M44): the database, key, certificate, screenshots, files, exports,
 * backups and logs. Everyone reads it through `current()`, so a move takes effect without a
 * restart of the app.
 */
export class DataFolder {
  private dir: string;

  constructor(private readonly userData: string) {
    this.dir = loadDataDir(userData);
  }

  current(): string {
    return this.dir;
  }

  /** The profile folder, where a new install keeps its data. */
  defaultDir(): string {
    return this.userData;
  }

  info(): DataFolderInfo {
    return { path: this.dir, isDefault: samePath(this.dir, this.userData) };
  }

  /** Switches to `dir` and remembers it for the next start. */
  switchTo(dir: string): void {
    saveDataDir(this.userData, dir);
    this.dir = dir;
  }
}
