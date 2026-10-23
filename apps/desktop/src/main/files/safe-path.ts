import { realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { checkFileName } from '@examguard/shared';
import { FilesError } from './files-error.js';

const OUTSIDE = 'Use a path inside the project folder.';

/** The parts of a `/` or `\` separated relative path; `''` is the root (no parts). */
export function pathParts(rel: string): string[] {
  if (rel === '') return [];
  if (rel.startsWith('/') || rel.startsWith('\\') || isAbsolute(rel)) {
    throw new FilesError(OUTSIDE);
  }
  const parts = rel.split(/[\\/]/);
  for (const part of parts) {
    if (part === '' || part === '.' || part === '..') throw new FilesError(OUTSIDE);
    checkName(part);
  }
  return parts;
}

/** One file or folder name, as the student typed it (the rule is shared with the teacher upload). */
function checkName(name: string): void {
  const problem = checkFileName(name);
  if (problem) throw new FilesError(problem);
}

/**
 * The absolute path of `rel` under `root`, or a `FilesError` if it would leave it. Beyond the
 * name checks, the nearest existing folder is resolved through links and junctions, so a link
 * the student (or a program) made inside the workspace cannot lead the panel out of it.
 */
export async function resolveInside(root: string, rel: string): Promise<string> {
  const target = resolve(root, ...pathParts(rel));
  const realRoot = await realpath(root);
  let probe = target;
  for (;;) {
    try {
      const back = relative(realRoot, await realpath(probe));
      if (back === '..' || back.startsWith('..\\') || isAbsolute(back)) {
        throw new FilesError(OUTSIDE);
      }
      return target;
    } catch (error) {
      if (error instanceof FilesError) throw error;
      const parent = dirname(probe);
      if (parent === probe) throw new FilesError(OUTSIDE);
      probe = parent;
    }
  }
}
