import { useState, type FormEvent } from 'react';
import {
  QUESTION_LANGUAGES,
  type Question,
  type QuestionBody,
  type QuestionType,
} from '@examguard/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import {
  draftFromQuestion,
  draftToBody,
  emptyDraft,
  type QuestionDraft,
} from '@/lib/questionDraft';
import { ErrorAlert } from '../common/ErrorAlert';
import { FormField } from '../common/FormField';
import { OptionSelect } from '../common/OptionSelect';
import { Spinner } from '../common/Spinner';
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

const LANGUAGE_LABEL: Record<string, string> = {
  c: 'C',
  cpp: 'C++',
  js: 'JavaScript',
  py: 'Python',
};

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
    <form onSubmit={(e) => void submit(e)} className="flex max-w-4xl flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">
            {question ? `Edit question ${question.position}` : 'New'} ({isCode ? 'code' : 'written'}
            )
          </CardTitle>
          <CardDescription>
            What the student reads, and which languages they may answer in.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <FormField label="Question (Markdown)">
            <Textarea
              className="min-h-32"
              value={draft.body}
              onChange={(e) => patch({ body: e.target.value })}
            />
          </FormField>
          {isCode && (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-sm font-medium">Allowed languages</legend>
              <div className="flex flex-wrap gap-2">
                {QUESTION_LANGUAGES.map((lang) => (
                  <label
                    key={lang}
                    className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5"
                  >
                    <Checkbox
                      checked={draft.allowedLanguages.includes(lang)}
                      onCheckedChange={() => toggleLanguage(lang)}
                    />
                    {LANGUAGE_LABEL[lang]}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
        </CardContent>
      </Card>

      <CriteriaEditor draft={draft} onChange={(criteria) => patch({ criteria })} />

      <Card>
        <CardHeader>
          <CardTitle>Sample answer</CardTitle>
          <CardDescription>The AI grader compares answers with this.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {isCode && draft.allowedLanguages.length > 1 && (
            <OptionSelect
              aria-label="Sample answer language"
              size="sm"
              className="w-40"
              value={draft.sampleLanguage}
              onChange={(sampleLanguage) => patch({ sampleLanguage })}
              options={draft.allowedLanguages.map((l) => ({
                value: l,
                label: LANGUAGE_LABEL[l] ?? l,
              }))}
            />
          )}
          {isCode ? (
            <SampleAnswerEditor
              value={draft.sampleAnswer}
              language={draft.sampleLanguage}
              onChange={(sampleAnswer) => patch({ sampleAnswer })}
            />
          ) : (
            <Textarea
              className="min-h-32"
              aria-label="Sample answer"
              value={draft.sampleAnswer}
              onChange={(e) => patch({ sampleAnswer: e.target.value })}
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Notes</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <FormField label="Note to students (shown with the question)">
            <Textarea
              className="min-h-24"
              value={draft.studentNote}
              onChange={(e) => patch({ studentNote: e.target.value })}
            />
          </FormField>
          <FormField label="Notes for the AI grader (never shown to students)">
            <Textarea
              className="min-h-24"
              value={draft.aiNotes}
              onChange={(e) => patch({ aiNotes: e.target.value })}
            />
          </FormField>
        </CardContent>
      </Card>

      {error && <ErrorAlert>{error}</ErrorAlert>}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          {busy && <Spinner />}
          {question ? 'Save question' : 'Add question'}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
