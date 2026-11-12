import { lazy, Suspense, useEffect, useState } from 'react';
import type { FileReadResult } from '@examguard/shared';
import { FileSearchIcon } from 'lucide-react';
import { baseName } from '@/lib/filePaths';
import { LoadingLine } from '../common/Spinner';

const FileTextEditor = lazy(() => import('./FileTextEditor'));

interface Props {
  path: string | null;
  /** Changes when a run ends, so a file the program just rewrote is read again. */
  version: number;
}

type Loaded = {
  path: string;
  version: number;
  result: FileReadResult | { kind: 'error'; message: string };
};

/** The selected file: a text editor, an image preview, or the reason it cannot be shown. */
export function FileViewer({ path, version }: Props) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    if (path === null) return;
    let current = true;
    void window.examguard.filesRead(path).then((r) => {
      if (!current) return;
      setLoaded({
        path,
        version,
        result: r.ok ? r.value : { kind: 'error', message: r.message },
      });
    });
    return () => {
      current = false;
    };
  }, [path, version]);

  if (path === null) {
    return (
      <p className="flex h-full items-center justify-center gap-2 p-3 text-sm text-muted-foreground">
        <FileSearchIcon className="size-4" aria-hidden />
        Choose a file to open it here.
      </p>
    );
  }
  if (loaded?.path !== path || loaded.version !== version) {
    return <LoadingLine className="p-3">{`Opening ${baseName(path)}…`}</LoadingLine>;
  }
  const { result } = loaded;
  if (result.kind === 'text') {
    return (
      <Suspense fallback={<LoadingLine className="p-3">Loading editor…</LoadingLine>}>
        <FileTextEditor key={`${path}:${version}`} path={path} initial={result.content} />
      </Suspense>
    );
  }
  if (result.kind === 'image') {
    return (
      <div className="flex h-full items-center justify-center overflow-auto bg-muted p-2">
        <img
          src={result.dataUrl}
          alt={baseName(path)}
          className="max-h-full max-w-full object-contain"
        />
      </div>
    );
  }
  return (
    <p role="alert" className="p-3 text-sm text-muted-foreground">
      {result.message}
    </p>
  );
}
