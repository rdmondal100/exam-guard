import { useCallback, useEffect, useRef, useState } from 'react';
import type { FileEntry, FilesList as FilesListData, FilesResult } from '@examguard/shared';
import { formatSize, joinPath, movedPath, isWithin, parentOf } from '@/lib/filePaths';
import { useRunStore } from '@/lib/runStore';
import { useExamFilesStatus } from '@/lib/useExamFilesStatus';
import { FileNameForm } from './FileNameForm';
import { FileViewer } from './FileViewer';
import { FilesList, type NameRequest } from './FilesList';

interface Props {
  /** Whether the panel is on screen; it reads the folder again each time it is shown. */
  visible: boolean;
}

const BUTTON = 'rounded-md border px-2 py-1 text-sm';

/**
 * The project folder: the same workspace the terminal and Run use. A list on the left (open,
 * create, rename, delete), the selected file on the right (text editor or image preview). It
 * reads the folder again when a run ends, since programs write files. Default export for `lazy`.
 */
export default function FilesPanel({ visible }: Props) {
  const [dir, setDir] = useState('');
  const [showHidden, setShowHidden] = useState(false);
  const [list, setList] = useState<FilesListData | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [asking, setAsking] = useState<NameRequest | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const running = useRunStore((s) => s.running);
  // The teacher's files are copied in when the exam starts (or later, if they were slow).
  const examFilesState = useExamFilesStatus().state;

  const load = useCallback(async () => {
    const result = await window.examguard.filesList({ path: dir, showHidden });
    if (result.ok) {
      setList(result.value);
      setMessage(null);
    } else {
      setMessage(result.message);
    }
  }, [dir, showHidden]);

  useEffect(() => {
    if (visible) void load();
  }, [visible, load, examFilesState]);

  // A program that just ended may have written files (and rewritten the open one).
  const wasRunning = useRef(false);
  useEffect(() => {
    if (running !== null) {
      wasRunning.current = true;
    } else if (wasRunning.current) {
      wasRunning.current = false;
      void load();
      setVersion((v) => v + 1);
    }
  }, [running, load]);

  /** Runs one change and then shows the folder again; a refusal is shown as it is. */
  const change = async (work: Promise<FilesResult<null>>): Promise<boolean> => {
    const result = await work;
    setMessage(result.ok ? null : result.message);
    if (result.ok) await load();
    return result.ok;
  };

  const create = async (name: string, kind: 'file' | 'dir') => {
    const path = joinPath(dir, name);
    if (await change(window.examguard.filesCreate({ path, kind }))) {
      setAsking(null);
      if (kind === 'file') setSelected(path);
    }
  };

  const rename = async (entry: FileEntry, name: string) => {
    const to = joinPath(parentOf(entry.path), name);
    if (await change(window.examguard.filesRename({ from: entry.path, to }))) {
      setAsking(null);
      setSelected((s) => (s === null ? s : movedPath(s, entry.path, to)));
    }
  };

  const remove = async (entry: FileEntry) => {
    if (confirming !== entry.path) {
      setConfirming(entry.path);
      return;
    }
    setConfirming(null);
    if (await change(window.examguard.filesRemove(entry.path))) {
      setSelected((s) => (s !== null && isWithin(s, entry.path) ? null : s));
    }
  };

  const submitName = (name: string) => {
    if (!asking) return;
    if (asking.mode === 'rename') void rename(asking.entry, name);
    else void create(name, asking.mode);
  };

  return (
    <div className="flex h-full min-h-0 gap-3">
      <div className="flex w-80 shrink-0 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-1">
          <button type="button" className={BUTTON} onClick={() => setAsking({ mode: 'file' })}>
            New file
          </button>
          <button type="button" className={BUTTON} onClick={() => setAsking({ mode: 'dir' })}>
            New folder
          </button>
          <button type="button" className={BUTTON} onClick={() => void load()}>
            Refresh
          </button>
          <label className="ml-auto flex items-center gap-1 text-xs">
            <input
              type="checkbox"
              checked={showHidden}
              onChange={(e) => setShowHidden(e.target.checked)}
            />
            Hidden
          </label>
        </div>
        {asking && (
          <FileNameForm
            key={asking.mode === 'rename' ? asking.entry.path : asking.mode}
            label={
              asking.mode === 'file'
                ? 'File name'
                : asking.mode === 'dir'
                  ? 'Folder name'
                  : 'New name'
            }
            initial={asking.mode === 'rename' ? asking.entry.name : ''}
            onSubmit={submitName}
            onCancel={() => setAsking(null)}
          />
        )}
        {message && (
          <p role="alert" className="text-sm text-red-700">
            {message}
          </p>
        )}
        <FilesList
          dir={dir}
          entries={list?.entries ?? []}
          selected={selected}
          confirming={confirming}
          onOpenDir={(path) => {
            setDir(path);
            setConfirming(null);
          }}
          onSelect={(entry) => setSelected(entry.path)}
          onRename={(entry) => setAsking({ mode: 'rename', entry })}
          onDelete={(entry) => void remove(entry)}
        />
        {list && (
          <p className="text-xs text-muted">
            {formatSize(list.usedBytes)} of {formatSize(list.limitBytes)} used
            {list.truncated && ' · not all files are listed'}
          </p>
        )}
      </div>
      <div className="min-w-0 flex-1 overflow-hidden rounded-md border">
        <FileViewer path={selected} version={version} />
      </div>
    </div>
  );
}
