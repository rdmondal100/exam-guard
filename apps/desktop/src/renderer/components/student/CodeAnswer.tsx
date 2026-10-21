import { lazy, Suspense } from 'react';
import type { Diagnostic, QuestionLanguage } from '@examguard/shared';
import { LANGUAGE_LABEL } from '@/lib/languages';
import { runKey, useRunStore } from '@/lib/runStore';
import { RunPanel } from './RunPanel';

const CodeEditor = lazy(() => import('./CodeEditor'));
const NO_DIAGNOSTICS: readonly Diagnostic[] = [];

interface Props {
  questionId: string;
  allowed: readonly QuestionLanguage[];
  language: QuestionLanguage;
  /** Buffer text for the selected language. */
  value: string;
  onLanguage: (language: QuestionLanguage) => void;
  onChange: (value: string) => void;
}

/** Language dropdown (allowed languages only), the "will submit" badge, the editor and Run. */
export function CodeAnswer({ questionId, allowed, language, value, onLanguage, onChange }: Props) {
  const diagnostics = useRunStore(
    (s) => s.results[runKey(questionId, language)]?.diagnostics ?? NO_DIAGNOSTICS,
  );
  return (
    <div className="flex min-h-96 flex-1 flex-col gap-2">
      <div className="flex items-center gap-3 text-sm">
        {allowed.length > 1 && (
          <label className="flex items-center gap-2 font-medium">
            Language
            <select
              value={language}
              onChange={(e) => onLanguage(e.target.value as QuestionLanguage)}
              className="rounded-md border px-2 py-1 font-normal"
            >
              {allowed.map((l) => (
                <option key={l} value={l}>
                  {LANGUAGE_LABEL[l]}
                </option>
              ))}
            </select>
          </label>
        )}
        <span className="rounded-md bg-blue-100 px-3 py-1 text-blue-900">
          Will submit: {LANGUAGE_LABEL[language]}
        </span>
      </div>
      <div className="min-h-40 flex-1 overflow-hidden rounded-md border">
        <Suspense fallback={<p className="p-3 text-sm text-muted">Loading editor…</p>}>
          <CodeEditor
            path={runKey(questionId, language)}
            language={language}
            value={value}
            onChange={onChange}
            diagnostics={diagnostics}
          />
        </Suspense>
      </div>
      <RunPanel questionId={questionId} language={language} code={value} />
    </div>
  );
}
