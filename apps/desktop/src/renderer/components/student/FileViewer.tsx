import { lazy, Suspense, useEffect, useState } from 'react';
import type { FileReadResult } from '@examguard/shared';
import { baseName } from '@/lib/filePaths';

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
    return <p className="p-3 text-sm text-muted">Choose a file to open it here.</p>;
  }
  if (loaded?.path !== path || loaded.version !== version) {
    return <p className="p-3 text-sm text-muted">Opening {baseName(path)}…</p>;
  }
  const { result } = loaded;
  if (result.kind === 'text') {
    return (
      <Suspense fallback={<p className="p-3 text-sm text-muted">Loading editor…</p>}>
        <FileTextEditor key={`${path}:${version}`} path={path} initial={result.content} />
      </Suspense>
    );
  }
  if (result.kind === 'image') {
    return (
      <div className="flex h-full items-center justify-center overflow-auto bg-black/5 p-2">
        <img
          src={result.dataUrl}
          alt={baseName(path)}
          className="max-h-full max-w-full object-contain"
        />
      </div>
    );
  }
  return (
    <p role="alert" className="p-3 text-sm text-muted">
      {result.message}
    </p>
  );
}
