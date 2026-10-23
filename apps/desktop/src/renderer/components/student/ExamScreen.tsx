import { lazy, Suspense, useEffect, useState } from 'react';
import type { SessionStatus, StudentQuestion } from '@examguard/shared';
import { ANSWER_TEXT_KEY, answeredIds, getAnswer, useAnswerStore } from '@/lib/answerStore';
import { pickLanguage } from '@/lib/languages';
import { isTimeUp, submitAnswers, submitRefusalText } from '@/lib/submit';
import { saveNow, useAnswerStatus, useAutosave } from '@/lib/useAutosave';
import { useExamFilesStatus } from '@/lib/useExamFilesStatus';
import { CodeAnswer } from './CodeAnswer';
import { ExamFilesNotice } from './ExamFilesNotice';
import { ExamTimer } from './ExamTimer';
import { LINK_TEXT } from './LobbyScreen';
import { QuestionNav } from './QuestionNav';
import { SaveChip } from './SaveChip';
import { SubmitDialog } from './SubmitDialog';
import { WrittenAnswer } from './WrittenAnswer';

const TerminalDock = lazy(() => import('./TerminalDock'));
const FilesPanel = lazy(() => import('./FilesPanel'));

interface Props {
  name: string;
  examTitle: string;
  questions: StudentQuestion[];
  deadline: number;
  /** The teacher's terminal switch; main closes the shell itself when it goes off. */
  terminalOn: boolean;
  /** The teacher's Files panel switch (the project folder explorer). */
  filesOn: boolean;
  status: SessionStatus;
}

/**
 * The exam window: question list, the answer area (Monaco with one buffer per language for code
 * questions, a text box for written ones), the server timer, the connection state and a
 * monitoring badge. Answers are autosaved to the teacher's PC (`useAutosave`).
 */
export function ExamScreen({
  name,
  examTitle,
  questions,
  deadline,
  terminalOn,
  filesOn,
  status,
}: Props) {
  const [selectedId, setSelectedId] = useState(questions[0]?.id ?? '');
  const answers = useAnswerStore((s) => s.answers);
  const languages = useAnswerStore((s) => s.languages);
  const setAnswer = useAnswerStore((s) => s.setAnswer);
  const setLanguage = useAnswerStore((s) => s.setLanguage);
  const question = questions.find((q) => q.id === selectedId) ?? questions[0];
  const languageOf = (q: StudentQuestion) =>
    q.type === 'code' ? pickLanguage(q.allowedLanguages, languages[q.id]) : undefined;
  const keyOf = (id: string) => {
    const q = questions.find((x) => x.id === id);
    return (q && languageOf(q)) ?? ANSWER_TEXT_KEY;
  };
  const answered = answeredIds(answers, keyOf);
  const examFiles = useExamFilesStatus();
  const linkOk = status.link === 'connected';
  useAutosave(questions, question?.id ?? '');
  const saveStatus = useAnswerStatus();
  const language = question ? languageOf(question) : undefined;
  // Same for the Files panel: its open file and folder survive toggling.
  const [filesMounted, setFilesMounted] = useState(false);
  const [filesShown, setFilesShown] = useState(false);
  // Mounted on first open and then only hidden, so the shell output survives toggling.
  const [terminalMounted, setTerminalMounted] = useState(false);
  const [terminalShown, setTerminalShown] = useState(false);
  // Submit: ask first, then wait for the server (possibly through a dropped connection).
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const submit = () => {
    setSubmitError(null);
    setSubmitting(true);
    submitAnswers()
      .then((outcome) => {
        // On success the receipt arrives as exam state and this screen is replaced.
        if (!outcome.ok) setSubmitError(submitRefusalText(outcome.reason));
      })
      .catch(() => setSubmitError(submitRefusalText('')))
      .finally(() => setSubmitting(false));
  };
  // At the deadline the editors lock; the server auto-submits after the grace period.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);
  const timeUp = isTimeUp(deadline, now, status.offsetMs);
  useEffect(() => {
    if (!timeUp) return;
    setConfirming(false);
    void saveNow('interval');
  }, [timeUp]);
  useEffect(() => {
    void window.examguard.terminalStatus().then((s) => {
      if (s.open) {
        setTerminalMounted(true);
        setTerminalShown(true);
      }
    });
  }, []);

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center justify-between gap-4 border-b px-6 py-3">
        <div>
          <h1 className="text-lg font-semibold">{examTitle}</h1>
          <p className="text-sm text-muted">{name}</p>
        </div>
        <div className="flex items-center gap-4">
          {filesOn && (
            <button
              type="button"
              onClick={() => {
                setFilesMounted(true);
                setFilesShown((v) => !v);
              }}
              className={`rounded-md border px-3 py-1 text-sm ${filesShown ? 'bg-black/10' : ''}`}
            >
              {filesShown ? 'Hide files' : 'Files'}
            </button>
          )}
          {(terminalOn || terminalShown) && (
            <button
              type="button"
              onClick={() => {
                setTerminalMounted(true);
                setTerminalShown((v) => !v);
              }}
              className={`rounded-md border px-3 py-1 text-sm ${terminalShown ? 'bg-black/10' : ''}`}
            >
              {terminalShown ? 'Hide terminal' : 'Terminal'}
            </button>
          )}
          <span className="rounded-md bg-blue-100 px-3 py-1 text-sm text-blue-900">
            Monitoring active
          </span>
          <SaveChip status={saveStatus} online={linkOk} />
          <button
            type="button"
            disabled={timeUp}
            onClick={() => setConfirming(true)}
            className="rounded-md bg-black px-3 py-1 text-sm text-white disabled:opacity-50"
          >
            Submit
          </button>
          <span
            role="status"
            className={`rounded-md px-3 py-1 text-sm ${
              linkOk ? 'bg-green-100 text-green-900' : 'bg-amber-100 text-amber-900'
            }`}
          >
            {LINK_TEXT[status.link]}
          </span>
          <ExamTimer deadline={deadline} offsetMs={status.offsetMs} />
        </div>
      </header>
      <ExamFilesNotice status={examFiles} />
      {timeUp && (
        <p role="alert" className="bg-amber-100 px-6 py-2 text-sm text-amber-900">
          Time is up. Your work is being sent. Your receipt appears in a moment; keep this window
          open.
        </p>
      )}
      <div className="flex min-h-0 flex-1" {...(timeUp ? { inert: '' } : {})}>
        <aside className="w-48 shrink-0 overflow-y-auto border-r p-3">
          <QuestionNav
            questions={questions}
            selectedId={question?.id ?? ''}
            answered={answered}
            onSelect={setSelectedId}
          />
        </aside>
        {question ? (
          <main className="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-6">
            <h2 className="text-base font-semibold">
              Question {question.position} · {question.marks} marks
            </h2>
            <p className="whitespace-pre-wrap">{question.body}</p>
            {question.studentNote && (
              <p className="whitespace-pre-wrap rounded-md bg-black/5 p-3 text-sm">
                {question.studentNote}
              </p>
            )}
            {language ? (
              <CodeAnswer
                questionId={question.id}
                allowed={question.allowedLanguages}
                language={language}
                value={getAnswer(answers, question.id, language)}
                onLanguage={(l) => setLanguage(question.id, l)}
                onChange={(v) => setAnswer(question.id, language, v)}
              />
            ) : (
              <>
                {question.type === 'code' && (
                  <p className="text-sm text-muted">
                    No language is set for this question. Write your answer below.
                  </p>
                )}
                <WrittenAnswer
                  value={getAnswer(answers, question.id, ANSWER_TEXT_KEY)}
                  onChange={(v) => setAnswer(question.id, ANSWER_TEXT_KEY, v)}
                />
              </>
            )}
          </main>
        ) : (
          <main className="p-6">This exam has no questions.</main>
        )}
      </div>
      {confirming && !timeUp && (
        <SubmitDialog
          answered={answered.size}
          total={questions.length}
          unsent={saveStatus.pending}
          linkOk={linkOk}
          busy={submitting}
          error={submitError}
          onConfirm={submit}
          onCancel={() => setConfirming(false)}
        />
      )}
      {filesOn && filesMounted && (
        <section className={`h-72 shrink-0 border-t p-3 ${filesShown ? '' : 'hidden'}`}>
          <Suspense fallback={<p className="text-sm text-muted">Loading files…</p>}>
            <FilesPanel visible={filesShown} />
          </Suspense>
        </section>
      )}
      {terminalMounted && (
        <section className={`h-72 shrink-0 border-t p-3 ${terminalShown ? '' : 'hidden'}`}>
          <Suspense fallback={<p className="text-sm text-muted">Loading terminal…</p>}>
            <TerminalDock />
          </Suspense>
        </section>
      )}
    </div>
  );
}
