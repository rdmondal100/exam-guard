import { useCallback, useEffect, useRef, useState } from 'react';
import Editor from '@monaco-editor/react';
import '@/lib/monaco';

interface Props {
  /** From the workspace root; the editor is keyed by it, so a new file means a new editor. */
  path: string;
  initial: string;
}

type Saved = { kind: 'saved' } | { kind: 'saving' } | { kind: 'error'; message: string };

/** How long after the last keystroke the file is written. */
const SAVE_DELAY_MS = 600;

/**
 * Monaco for one file of the project folder, saved by itself shortly after typing stops and when
 * the editor goes away. It is a separate model from the answer, so the answer is never touched.
 * Default export so `React.lazy` can load it.
 */
export default function FileTextEditor({ path, initial }: Props) {
  const [saved, setSaved] = useState<Saved>({ kind: 'saved' });
  const latest = useRef(initial);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    if (!dirty.current) return;
    dirty.current = false;
    setSaved({ kind: 'saving' });
    const result = await window.examguard.filesWrite({ path, content: latest.current });
    if (result.ok) {
      setSaved((s) => (dirty.current ? s : { kind: 'saved' }));
    } else {
      dirty.current = true; // the next keystroke tries again
      setSaved({ kind: 'error', message: result.message });
    }
  }, [path]);

  // Leaving the file (or the exam screen) writes what is still pending.
  useEffect(() => () => void flush(), [flush]);

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1">
        <Editor
          height="100%"
          // Its own URI space, so it can never share a model with the answer buffers.
          path={`file:///project/${encodeURI(path)}`}
          defaultValue={initial}
          onChange={(next) => {
            latest.current = next ?? '';
            dirty.current = true;
            clearTimeout(timer.current);
            timer.current = setTimeout(() => void flush(), SAVE_DELAY_MS);
          }}
          options={{
            minimap: { enabled: false },
            fontSize: 13,
            scrollBeyondLastLine: false,
            automaticLayout: true,
          }}
        />
      </div>
      <p
        role="status"
        className={`px-2 py-0.5 text-xs ${saved.kind === 'error' ? 'text-red-700' : 'text-muted'}`}
      >
        {saved.kind === 'saved' && 'Saved'}
        {saved.kind === 'saving' && 'Saving…'}
        {saved.kind === 'error' && `Not saved: ${saved.message}`}
      </p>
    </div>
  );
}
