import type { FileEntry } from '@examguard/shared';
import { crumbs, formatSize } from '@/lib/filePaths';

/** What the row in the list is asking the name form for. */
export type NameRequest = { mode: 'file' | 'dir' } | { mode: 'rename'; entry: FileEntry };

interface Props {
  dir: string;
  entries: readonly FileEntry[];
  selected: string | null;
  /** The path whose delete is waiting for a second click. */
  confirming: string | null;
  onOpenDir: (path: string) => void;
  onSelect: (entry: FileEntry) => void;
  onRename: (entry: FileEntry) => void;
  onDelete: (entry: FileEntry) => void;
}

const LINK = 'rounded px-1 text-xs underline-offset-2 hover:underline';

/** The folder's breadcrumb and its rows: open, rename and delete (delete asks twice). */
export function FilesList({
  dir,
  entries,
  selected,
  confirming,
  onOpenDir,
  onSelect,
  onRename,
  onDelete,
}: Props) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <nav aria-label="Folder" className="flex flex-wrap items-center gap-1 px-1 pb-1 text-sm">
        <button type="button" onClick={() => onOpenDir('')} className={LINK}>
          Project
        </button>
        {crumbs(dir).map((c) => (
          <span key={c.path} className="flex items-center gap-1">
            <span aria-hidden>/</span>
            <button type="button" onClick={() => onOpenDir(c.path)} className={LINK}>
              {c.name}
            </button>
          </span>
        ))}
      </nav>
      <ul className="min-h-0 flex-1 overflow-y-auto">
        {entries.length === 0 && <li className="p-2 text-sm text-muted">This folder is empty.</li>}
        {entries.map((e) => (
          <li
            key={e.path}
            className={`group flex items-center gap-2 rounded px-1 py-0.5 text-sm ${
              selected === e.path ? 'bg-black/10' : 'hover:bg-black/5'
            }`}
          >
            <button
              type="button"
              onClick={() => (e.kind === 'dir' ? onOpenDir(e.path) : onSelect(e))}
              className="flex min-w-0 flex-1 items-center gap-2 text-left"
              title={e.path}
            >
              <span aria-hidden className="w-9 shrink-0 text-xs text-muted">
                {e.kind === 'dir' ? 'folder' : e.image ? 'image' : 'file'}
              </span>
              <span className="truncate">{e.name}</span>
              {e.kind === 'file' && (
                <span className="ml-auto shrink-0 text-xs text-muted">{formatSize(e.size)}</span>
              )}
            </button>
            <button type="button" onClick={() => onRename(e)} className={LINK}>
              Rename
            </button>
            <button
              type="button"
              onClick={() => onDelete(e)}
              className={`${LINK} ${confirming === e.path ? 'font-semibold text-red-700' : ''}`}
            >
              {confirming === e.path ? 'Sure?' : 'Delete'}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
