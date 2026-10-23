/** Helpers for the Files panel. Paths are relative to the workspace and use `/`; `''` is the root. */

export const joinPath = (dir: string, name: string) => (dir === '' ? name : `${dir}/${name}`);

/** The folder a path is in; the root for a top-level name. */
export function parentOf(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut < 0 ? '' : path.slice(0, cut);
}

export const baseName = (path: string) => path.slice(path.lastIndexOf('/') + 1);

/** Folders from the root down to `path`, for the breadcrumb: `a/b` → a, a/b. */
export function crumbs(path: string): { name: string; path: string }[] {
  if (path === '') return [];
  const parts = path.split('/');
  return parts.map((name, i) => ({ name, path: parts.slice(0, i + 1).join('/') }));
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Whether `path` is `folder` or inside it (a rename or delete of the folder affects it). */
export const isWithin = (path: string, folder: string) =>
  path === folder || path.startsWith(`${folder}/`);

/** The new path of `path` after `from` was renamed to `to` (unchanged if it was not inside). */
export function movedPath(path: string, from: string, to: string): string {
  return isWithin(path, from) ? to + path.slice(from.length) : path;
}
