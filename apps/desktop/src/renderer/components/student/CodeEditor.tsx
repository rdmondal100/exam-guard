import Editor from '@monaco-editor/react';
import type { QuestionLanguage } from '@examguard/shared';
import { MONACO_LANGUAGE } from '@/lib/languages';
import '@/lib/monaco';

interface Props {
  /** Unique per question and language, so Monaco keeps one model (and undo history) for each. */
  path: string;
  language: QuestionLanguage;
  value: string;
  onChange: (value: string) => void;
}

/** Full-height Monaco for the student's code. Default export so `React.lazy` can load it. */
export default function CodeEditor({ path, language, value, onChange }: Props) {
  return (
    <Editor
      height="100%"
      path={path}
      language={MONACO_LANGUAGE[language]}
      value={value}
      onChange={(next) => onChange(next ?? '')}
      options={{
        minimap: { enabled: false },
        fontSize: 14,
        scrollBeyondLastLine: false,
        automaticLayout: true,
      }}
    />
  );
}
