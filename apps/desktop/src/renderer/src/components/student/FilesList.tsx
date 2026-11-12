import {
  ChevronRightIcon,
  FileIcon,
  FolderIcon,
  ImageIcon,
  MoreHorizontalIcon,
  PencilIcon,
  Trash2Icon,
} from 'lucide-react';
import type { FileEntry } from '@examguard/shared';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { crumbs, formatSize } from '@/lib/filePaths';
import { Hint } from '../common/Hint';

/** What the row in the list is asking the name form for. */
export type NameRequest = { mode: 'file' | 'dir' } | { mode: 'rename'; entry: FileEntry };

interface Props {
  dir: string;
  entries: readonly FileEntry[];
  selected: string | null;
  onOpenDir: (path: string) => void;
  onSelect: (entry: FileEntry) => void;
  onRename: (entry: FileEntry) => void;
  onDelete: (entry: FileEntry) => void;
}

const CRUMB = 'rounded px-1 text-sm hover:bg-accent hover:text-accent-foreground';

/** The folder's breadcrumb and its rows: open, plus rename and delete in each row's menu. */
export function FilesList({
  dir,
  entries,
  selected,
  onOpenDir,
  onSelect,
  onRename,
  onDelete,
}: Props) {
  return (
    <div className="flex min-h-0 flex-1 flex-col rounded-md border">
      <nav aria-label="Folder" className="flex flex-wrap items-center gap-0.5 border-b px-2 py-1.5">
        <button type="button" onClick={() => onOpenDir('')} className={cn(CRUMB, 'font-medium')}>
          Project
        </button>
        {crumbs(dir).map((c) => (
          <span key={c.path} className="flex items-center gap-0.5">
            <ChevronRightIcon className="size-3.5 text-muted-foreground" aria-hidden />
            <button type="button" onClick={() => onOpenDir(c.path)} className={CRUMB}>
              {c.name}
            </button>
          </span>
        ))}
      </nav>
      <ul className="min-h-0 flex-1 overflow-y-auto p-1">
        {entries.length === 0 && (
          <li className="p-2 text-sm text-muted-foreground">This folder is empty.</li>
        )}
        {entries.map((e) => {
          const Icon = e.kind === 'dir' ? FolderIcon : e.image ? ImageIcon : FileIcon;
          return (
            <li
              key={e.path}
              className={cn(
                'group flex items-center gap-1 rounded-md pr-1 text-sm',
                selected === e.path ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60',
              )}
            >
              <Hint label={e.path} side="right">
                <button
                  type="button"
                  onClick={() => (e.kind === 'dir' ? onOpenDir(e.path) : onSelect(e))}
                  className="flex h-8 min-w-0 flex-1 items-center gap-2 px-2 text-left"
                >
                  <Icon
                    aria-label={e.kind === 'dir' ? 'folder' : e.image ? 'image' : 'file'}
                    className={cn(
                      'size-4 shrink-0',
                      e.kind === 'dir' ? 'text-primary' : 'text-muted-foreground',
                    )}
                  />
                  <span className="truncate">{e.name}</span>
                  {e.kind === 'file' && (
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                      {formatSize(e.size)}
                    </span>
                  )}
                </button>
              </Hint>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="size-7 opacity-60 group-hover:opacity-100"
                    aria-label={`Actions for ${e.name}`}
                  >
                    <MoreHorizontalIcon />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem onSelect={() => onRename(e)}>
                    <PencilIcon />
                    Rename
                  </DropdownMenuItem>
                  <DropdownMenuItem variant="destructive" onSelect={() => onDelete(e)}>
                    <Trash2Icon />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
