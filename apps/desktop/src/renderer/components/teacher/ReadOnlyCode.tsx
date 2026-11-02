import { useEffect, useRef } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';
import { MONACO_LANGUAGE } from '@/lib/languages';
import '@/lib/monaco';

const MONACO_BY_ID: Record<string, string> = MONACO_LANGUAGE;

interface Props {
  value: string;
  language: string;
  /** 1-based lines to mark (the AI's or teacher's line notes), with the note as hover text. */
  notes?: readonly { line: number; issue: string }[];
  height?: string;
}

type CodeEditor = Parameters<OnMount>[0];

/** A read-only Monaco view for the review (M39). Default export so `React.lazy` can load it. */
export default function ReadOnlyCode({ value, language, notes = [], height = '360px' }: Props) {
  const editorRef = useRef<CodeEditor | null>(null);
  const decorations = useRef<string[]>([]);

  const decorate = () => {
    const editor = editorRef.current;
    if (!editor) return;
    const lines = editor.getModel()?.getLineCount() ?? 0;
    decorations.current = editor.deltaDecorations(
      decorations.current,
      notes
        .filter((n) => n.line <= lines)
        .map((n) => ({
          range: { startLineNumber: n.line, startColumn: 1, endLineNumber: n.line, endColumn: 1 },
          options: {
            isWholeLine: true,
            className: 'eg-note-line',
            glyphMarginClassName: 'eg-note-glyph',
            hoverMessage: { value: n.issue },
          },
        })),
    );
  };

  useEffect(decorate);

  return (
    <div className="overflow-hidden rounded-md border border-border">
      <Editor
        height={height}
        language={MONACO_BY_ID[language] ?? 'plaintext'}
        value={value}
        onMount={(editor) => {
          editorRef.current = editor;
          decorate();
        }}
        options={{
          readOnly: true,
          domReadOnly: true,
          minimap: { enabled: false },
          fontSize: 13,
          scrollBeyondLastLine: false,
          glyphMargin: notes.length > 0,
          wordWrap: language === 'text' ? 'on' : 'off',
        }}
      />
    </div>
  );
}
