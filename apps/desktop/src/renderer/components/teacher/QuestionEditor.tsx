import { useState, type FormEvent } from 'react';
import {
  QUESTION_LANGUAGES,
  type Question,
  type QuestionBody,
  type QuestionType,
} from '@examguard/shared';
import { Button } from '@/components/ui/button';
import {
  draftFromQuestion,
  draftToBody,
  emptyDraft,
  type QuestionDraft,
} from '@/lib/questionDraft';
import { CriteriaEditor } from './CriteriaEditor';
import { SampleAnswerEditor } from './SampleAnswerEditor';

interface Props {
  /** The question being edited; absent when adding. */
  question?: Question;
  /** Type of a new question. */
  newType?: QuestionType;
  onSubmit: (body: QuestionBody) => Promise<void>;
  onCancel: () => void;
}

const FIELD = 'flex flex-col gap-1 text-sm font-medium';
const AREA =
  'min-h-24 rounded-md border border-border bg-card p-3 text-sm focus-visible:outline-2 focus-visible:outline-primary';
const LANGUAGE_LABEL: Record<string, string> = { c: 'C', cpp: 'C++', js: 'JavaScript' };

/** One question: statement, languages, marking guide, sample answer, student note, AI notes. */
export function QuestionEditor({ question, newType = 'code', onSubmit, onCancel }: Props) {
  const [draft, setDraft] = useState<QuestionDraft>(
    question ? draftFromQuestion(question) : emptyDraft(newType),
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const patch = (next: Partial<QuestionDraft>) => setDraft({ ...draft, ...next });

  const toggleLanguage = (lang: (typeof QUESTION_LANGUAGES)[number]) => {
    const has = draft.allowedLanguages.includes(lang);
    const allowedLanguages = has
      ? draft.allowedLanguages.filter((l) => l !== lang)
      : [...draft.allowedLanguages, lang];
    const sampleLanguage = allowedLanguages.includes(draft.sampleLanguage as typeof lang)
      ? draft.sampleLanguage
      : (allowedLanguages[0] ?? draft.sampleLanguage);
    patch({ allowedLanguages, sampleLanguage });
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const result = draftToBody(draft);
    if ('error' in result) {
      setError(result.error);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit(result.body);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  const isCode = draft.type === 'code';
  return (
    <form onSubmit={(e) => void submit(e)} className="flex max-w-3xl flex-col gap-4">
      <h2 className="text-xl font-semibold">
        {question ? `Edit question ${question.position}` : 'New'} ({isCode ? 'code' : 'written'})
      </h2>
      <label className={FIELD}>
        Question (Markdown)
        <textarea
          className={AREA}
          value={draft.body}
          onChange={(e) => patch({ body: e.target.value })}
        />
      </label>

      {isCode && (
        <fieldset className="flex gap-4 text-sm">
          <legend className="mb-1 font-medium">Allowed languages</legend>
          {QUESTION_LANGUAGES.map((lang) => (
            <label key={lang} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={draft.allowedLanguages.includes(lang)}
                onChange={() => toggleLanguage(lang)}
              />
              {LANGUAGE_LABEL[lang]}
            </label>
          ))}
        </fieldset>
      )}

      <CriteriaEditor draft={draft} onChange={(criteria) => patch({ criteria })} />

      <div className={FIELD}>
        <div className="flex items-center gap-3">
          Sample answer
          {isCode && draft.allowedLanguages.length > 1 && (
            <select
              aria-label="Sample answer language"
              className="h-8 rounded-md border border-border bg-card px-2 text-sm font-normal"
              value={draft.sampleLanguage}
              onChange={(e) => patch({ sampleLanguage: e.target.value })}
            >
              {draft.allowedLanguages.map((l) => (
                <option key={l} value={l}>
                  {LANGUAGE_LABEL[l]}
                </option>
              ))}
            </select>
          )}
        </div>
        {isCode ? (
          <SampleAnswerEditor
            value={draft.sampleAnswer}
            language={draft.sampleLanguage}
            onChange={(sampleAnswer) => patch({ sampleAnswer })}
          />
        ) : (
          <textarea
            className={AREA}
            aria-label="Sample answer"
            value={draft.sampleAnswer}
            onChange={(e) => patch({ sampleAnswer: e.target.value })}
          />
        )}
      </div>

      <label className={FIELD}>
        Note to students (shown with the question)
        <textarea
          className={AREA}
          value={draft.studentNote}
          onChange={(e) => patch({ studentNote: e.target.value })}
        />
      </label>
      <label className={FIELD}>
        Notes for the AI grader (never shown to students)
        <textarea
          className={AREA}
          value={draft.aiNotes}
          onChange={(e) => patch({ aiNotes: e.target.value })}
        />
      </label>

      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          {question ? 'Save question' : 'Add question'}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
