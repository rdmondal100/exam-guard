import { lazy, Suspense } from 'react';
import { CodeIcon } from 'lucide-react';
import type { Diagnostic, QuestionLanguage } from '@examguard/shared';
import { Badge } from '@/components/ui/badge';
import { LANGUAGE_LABEL } from '@/lib/languages';
import { runKey, useRunStore } from '@/store/runStore';
import { LoadingLine } from '../common/Spinner';
import { OptionSelect } from '../common/OptionSelect';
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
    <div className="flex min-h-96 flex-1 flex-col gap-3">
      <div className="flex items-center gap-3 text-sm">
        {allowed.length > 1 && (
          <label className="flex items-center gap-2 font-medium">
            Language
            <OptionSelect
              size="sm"
              className="w-36 font-normal"
              value={language}
              onChange={(v) => onLanguage(v as QuestionLanguage)}
              options={allowed.map((l) => ({ value: l, label: LANGUAGE_LABEL[l] }))}
            />
          </label>
        )}
        <Badge variant="info" className="h-7 px-2.5">
          <CodeIcon aria-hidden />
          Will submit: {LANGUAGE_LABEL[language]}
        </Badge>
      </div>
      <div className="min-h-40 flex-1 overflow-hidden rounded-md border">
        <Suspense fallback={<LoadingLine className="p-3">Loading editor…</LoadingLine>}>
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
