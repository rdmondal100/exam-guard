import { useEffect, useRef, useState } from 'react';
import Editor, { type Monaco } from '@monaco-editor/react';
import type { Diagnostic, QuestionLanguage } from '@examguard/shared';
import { MONACO_LANGUAGE } from '@/lib/languages';
import { useInsertionWatchHandle } from '@/hooks/useInsertionWatch';
import '@/lib/monaco';

interface Props {
  /** Unique per question and language, so Monaco keeps one model (and undo history) for each. */
  path: string;
  language: QuestionLanguage;
  value: string;
  onChange: (value: string) => void;
  /** Compiler messages from the last run, shown as underlines. */
  diagnostics: readonly Diagnostic[];
}

const MARKER_OWNER = 'gcc';

/** Full-height Monaco for the student's code. Default export so `React.lazy` can load it. */
export default function CodeEditor({ path, language, value, onChange, diagnostics }: Props) {
  const [monaco, setMonaco] = useState<Monaco | null>(null);
  // Large insertions are watched in the exam window (M27).
  const insertionWatch = useInsertionWatchHandle();
  const stopWatch = useRef<(() => void) | null>(null);
  useEffect(() => () => stopWatch.current?.(), []);

  useEffect(() => {
    const model = monaco?.editor.getModel(monaco.Uri.parse(path));
    if (!monaco || !model) return;
    const severity = {
      error: monaco.MarkerSeverity.Error,
      warning: monaco.MarkerSeverity.Warning,
      note: monaco.MarkerSeverity.Info,
    };
    const markers = diagnostics
      .filter((d) => d.line <= model.getLineCount())
      .map((d) => {
        const word = model.getWordAtPosition({ lineNumber: d.line, column: d.col });
        return {
          severity: severity[d.severity],
          message: d.message,
          startLineNumber: d.line,
          startColumn: d.col,
          endLineNumber: d.line,
          endColumn: word ? word.endColumn : d.col + 1,
        };
      });
    monaco.editor.setModelMarkers(model, MARKER_OWNER, markers);
  }, [monaco, path, diagnostics]);

  return (
    <Editor
      height="100%"
      path={path}
      language={MONACO_LANGUAGE[language]}
      value={value}
      onChange={(next) => onChange(next ?? '')}
      onMount={(editor, m) => {
        setMonaco(m);
        stopWatch.current = insertionWatch?.attach(editor) ?? null;
      }}
      options={{
        minimap: { enabled: false },
        fontSize: 14,
        scrollBeyondLastLine: false,
        automaticLayout: true,
      }}
    />
  );
}
