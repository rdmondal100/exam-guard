import { mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import {
  FILE_LIMITS,
  IMAGE_TYPES,
  type FileEntry,
  type FileReadResult,
  type FilesList,
} from '@examguard/shared';
import { FilesError } from './files-error.js';
import { pathParts, resolveInside } from './safe-path.js';

/**
 * Folders npm and pip install into, at the top of the workspace: hidden, and not counted as the
 * student's. `include` and `lib` stay visible: a student may keep their own headers there.
 */
const PACKAGE_FOLDERS = new Set(['node_modules', 'site-packages']);

const isHidden = (name: string, atRoot: boolean) =>
  name.startsWith('.') || (atRoot && PACKAGE_FOLDERS.has(name));

const toRel = (parts: string[]) => parts.join('/');

/** How many entries the size count looks at before it stops and takes what it has. */
const MAX_COUNTED_ENTRIES = 50_000;

/**
 * The student's project folder: the exam workspace that Run and the terminal use. Every path comes
 * in as a relative string and is checked by `resolveInside`; nothing here reaches outside `root`.
 */
export class WorkspaceFiles {
  constructor(
    private readonly root: () => string,
    private readonly limitBytes: number = FILE_LIMITS.workspaceBytes,
  ) {}

  private async base(): Promise<string> {
    const root = this.root();
    await mkdir(root, { recursive: true });
    return root;
  }

  async list(rel: string, showHidden: boolean): Promise<FilesList> {
    const root = await this.base();
    const dir = await resolveInside(root, rel);
    const atRoot = pathParts(rel).length === 0;
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      throw new FilesError('That folder does not exist.');
    }
    const parts = pathParts(rel);
    const entries: FileEntry[] = [];
    for (const name of names) {
      if (!showHidden && isHidden(name, atRoot)) continue;
      const info = await stat(join(dir, name)).catch(() => null);
      if (!info) continue;
      const dirKind = info.isDirectory();
      entries.push({
        name,
        path: toRel([...parts, name]),
        kind: dirKind ? 'dir' : 'file',
        size: dirKind ? 0 : info.size,
        modifiedMs: info.mtimeMs,
        image: !dirKind && extname(name).slice(1).toLowerCase() in IMAGE_TYPES,
      });
    }
    // Folders first, then by name, as every file explorer does.
    entries.sort((a, b) =>
      a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1,
    );
    return {
      entries: entries.slice(0, FILE_LIMITS.entries),
      truncated: entries.length > FILE_LIMITS.entries,
      usedBytes: await this.usedBytes(root),
      limitBytes: this.limitBytes,
    };
  }

  async read(rel: string): Promise<FileReadResult> {
    const file = await this.existingFile(rel);
    const ext = extname(file.path).slice(1).toLowerCase();
    const mime = IMAGE_TYPES[ext];
    if (mime) {
      if (file.size > FILE_LIMITS.imageBytes)
        return unsupported('This image is too large to show.');
      const bytes = await readFile(file.path);
      return { kind: 'image', dataUrl: `data:${mime};base64,${bytes.toString('base64')}` };
    }
    if (file.size > FILE_LIMITS.textBytes) return unsupported('This file is too large to open.');
    const bytes = await readFile(file.path);
    if (bytes.subarray(0, 8000).includes(0)) return unsupported('This is not a text file.');
    return { kind: 'text', content: bytes.toString('utf8') };
  }

  async write(rel: string, content: string): Promise<void> {
    const root = await this.base();
    const path = await resolveInside(root, rel);
    if (Buffer.byteLength(content) > FILE_LIMITS.textBytes) {
      throw new FilesError('This file is too large to save.');
    }
    const old = await stat(path).catch(() => null);
    if (old?.isDirectory()) throw new FilesError('That is a folder.');
    await this.checkRoom(root, Buffer.byteLength(content) - (old?.size ?? 0));
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, 'utf8');
  }

  async create(rel: string, kind: 'file' | 'dir'): Promise<void> {
    const root = await this.base();
    const path = await resolveInside(root, rel);
    if (await stat(path).catch(() => null)) throw new FilesError('That name is already used.');
    await mkdir(dirname(path), { recursive: true });
    if (kind === 'dir') await mkdir(path);
    else await (await open(path, 'wx')).close();
  }

  async rename(from: string, to: string): Promise<void> {
    const root = await this.base();
    if (pathParts(from).length === 0) throw new FilesError('Choose a file or folder.');
    const source = await resolveInside(root, from);
    const target = await resolveInside(root, to);
    if (!(await stat(source).catch(() => null))) throw new FilesError('That file does not exist.');
    if (await stat(target).catch(() => null)) throw new FilesError('That name is already used.');
    await mkdir(dirname(target), { recursive: true });
    await rename(source, target);
  }

  async remove(rel: string): Promise<void> {
    const root = await this.base();
    if (pathParts(rel).length === 0) throw new FilesError('Choose a file or folder.');
    await rm(await resolveInside(root, rel), { recursive: true, force: true });
  }

  private async existingFile(rel: string): Promise<{ path: string; size: number }> {
    const root = await this.base();
    if (pathParts(rel).length === 0) throw new FilesError('Choose a file.');
    const path = await resolveInside(root, rel);
    const info = await stat(path).catch(() => null);
    if (!info) throw new FilesError('That file does not exist.');
    if (info.isDirectory()) throw new FilesError('That is a folder.');
    return { path, size: info.size };
  }

  private async checkRoom(root: string, extra: number): Promise<void> {
    if (extra <= 0) return;
    if ((await this.usedBytes(root)) + extra > this.limitBytes) {
      throw new FilesError('The project folder is full. Delete some files first.');
    }
  }

  /** Size of the student's own files; the package folders and dotfolders are not counted. */
  private async usedBytes(root: string): Promise<number> {
    let total = 0;
    let seen = 0;
    const walk = async (dir: string, atRoot: boolean): Promise<void> => {
      for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
        if (++seen > MAX_COUNTED_ENTRIES) return;
        if (isHidden(entry.name, atRoot)) continue;
        const path = join(dir, entry.name);
        if (entry.isDirectory()) await walk(path, false);
        else if (entry.isFile()) total += (await stat(path).catch(() => null))?.size ?? 0;
      }
    };
    await walk(root, true);
    return total;
  }
}

const unsupported = (message: string): FileReadResult => ({ kind: 'unsupported', message });
