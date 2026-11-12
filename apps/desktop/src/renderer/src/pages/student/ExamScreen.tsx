import { lazy, Suspense, useEffect, useState } from 'react';
import { ClipboardXIcon, InfoIcon, TimerOffIcon } from 'lucide-react';
import type { SessionStatus, StudentQuestion } from '@examguard/shared';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ANSWER_TEXT_KEY, answeredIds, getAnswer, useAnswerStore } from '@/store/answerStore';
import { pickLanguage } from '@/lib/languages';
import { isTimeUp, submitAnswers, submitRefusalText } from '@/lib/submit';
import { saveNow, useAnswerStatus, useAutosave } from '@/hooks/useAutosave';
import { useExamFilesStatus } from '@/hooks/useExamFilesStatus';
import { usePasteGuard } from '@/hooks/usePasteGuard';
import { InsertionWatchContext, useInsertionWatch } from '@/hooks/useInsertionWatch';
import { LoadingLine } from '../../components/common/Spinner';
import { CodeAnswer } from '../../components/student/CodeAnswer';
import { ExamFilesNotice } from '../../components/student/ExamFilesNotice';
import { ExamHeader } from '../../components/student/ExamHeader';
import { QuestionNav } from '../../components/student/QuestionNav';
import { SubmitDialog } from '../../components/student/SubmitDialog';
import { WrittenAnswer } from '../../components/student/WrittenAnswer';

/** How long the "outside paste blocked" notice stays. */
const PASTE_NOTICE_MS = 4000;
/** Full-width strips under the toolbar. */
const BANNER = 'rounded-none border-x-0 border-t-0 px-6';

const TerminalDock = lazy(() => import('../../components/student/TerminalDock'));
const FilesPanel = lazy(() => import('../../components/student/FilesPanel'));

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
  // Only text copied inside the exam may be pasted (M25); typing far faster than a person is
  // reported (M27), except the pastes the guard let through.
  const insertionWatch = useInsertionWatch();
  const pasteBlockedAt = usePasteGuard(insertionWatch.allow);
  const pasteNotice = pasteBlockedAt !== null && now - pasteBlockedAt < PASTE_NOTICE_MS;
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
    <InsertionWatchContext.Provider value={insertionWatch}>
      <div className="flex h-screen flex-col bg-background">
        <ExamHeader
          examTitle={examTitle}
          name={name}
          filesOn={filesOn}
          filesShown={filesShown}
          onToggleFiles={() => {
            setFilesMounted(true);
            setFilesShown((v) => !v);
          }}
          terminalButton={terminalOn || terminalShown}
          terminalShown={terminalShown}
          onToggleTerminal={() => {
            setTerminalMounted(true);
            setTerminalShown((v) => !v);
          }}
          saveStatus={saveStatus}
          link={status.link}
          offsetMs={status.offsetMs}
          deadline={deadline}
          timeUp={timeUp}
          onSubmit={() => setConfirming(true)}
        />
        <ExamFilesNotice status={examFiles} className={BANNER} />
        {timeUp && (
          <Alert variant="warning" className={BANNER}>
            <TimerOffIcon />
            <AlertDescription>
              Time is up. Your work is being sent. Your receipt appears in a moment; keep this
              window open.
            </AlertDescription>
          </Alert>
        )}
        {pasteNotice && (
          <Alert role="status" variant="warning" className={BANNER}>
            <ClipboardXIcon />
            <AlertDescription>
              Pasting text from outside the exam is not allowed. Only text copied inside the exam
              can be pasted. Your teacher has been notified.
            </AlertDescription>
          </Alert>
        )}
        <div className="flex min-h-0 flex-1" {...(timeUp ? { inert: '' } : {})}>
          <aside className="flex w-52 shrink-0 flex-col border-r bg-muted/30">
            <p className="px-4 pt-3 pb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Questions · {answered.size}/{questions.length}
            </p>
            <ScrollArea className="min-h-0 flex-1 px-2 pb-3">
              <QuestionNav
                questions={questions}
                selectedId={question?.id ?? ''}
                answered={answered}
                onSelect={setSelectedId}
              />
            </ScrollArea>
          </aside>
          {question ? (
            <main className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-6">
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-semibold">Question {question.position}</h2>
                <Badge variant="secondary">{question.marks} marks</Badge>
              </div>
              <p className="leading-relaxed whitespace-pre-wrap">{question.body}</p>
              {question.studentNote && (
                <Alert role="note" variant="info">
                  <InfoIcon />
                  <AlertDescription className="whitespace-pre-wrap">
                    {question.studentNote}
                  </AlertDescription>
                </Alert>
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
                    <p className="text-sm text-muted-foreground">
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
            <main className="p-6 text-muted-foreground">This exam has no questions.</main>
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
          <section className={`h-72 shrink-0 border-t bg-card p-3 ${filesShown ? '' : 'hidden'}`}>
            <Suspense fallback={<LoadingLine>Loading files…</LoadingLine>}>
              <FilesPanel visible={filesShown} />
            </Suspense>
          </section>
        )}
        {terminalMounted && (
          <section
            className={`h-72 shrink-0 border-t bg-card p-3 ${terminalShown ? '' : 'hidden'}`}
          >
            <Suspense fallback={<LoadingLine>Loading terminal…</LoadingLine>}>
              <TerminalDock />
            </Suspense>
          </section>
        )}
      </div>
    </InsertionWatchContext.Provider>
  );
}
