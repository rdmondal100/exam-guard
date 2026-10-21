import Editor from '@monaco-editor/react';
import { MONACO_LANGUAGE } from '@/lib/languages';
import '@/lib/monaco';

const MONACO_BY_ID: Record<string, string> = MONACO_LANGUAGE;

interface Props {
  value: string;
  language: string;
  onChange: (value: string) => void;
}

/** Monaco for the sample answer. Default export so `React.lazy` can load it. */
export default function MonacoField({ value, language, onChange }: Props) {
  return (
    <div className="overflow-hidden rounded-md border border-border">
      <Editor
        height="260px"
        language={MONACO_BY_ID[language] ?? 'plaintext'}
        value={value}
        onChange={(next) => onChange(next ?? '')}
        options={{ minimap: { enabled: false }, fontSize: 14, scrollBeyondLastLine: false }}
      />
    </div>
  );
}
