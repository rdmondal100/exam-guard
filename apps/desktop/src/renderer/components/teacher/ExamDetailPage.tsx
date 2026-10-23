import { useEffect, useState } from 'react';
import type {
  ExamSummary,
  Question,
  QuestionBody,
  QuestionType,
  ReadyProblem,
} from '@examguard/shared';
import { Button } from '@/components/ui/button';
import { readyProblemsOf } from '@/lib/questionApi';
import { useExams } from '@/lib/useExams';
import { useQuestions } from '@/lib/useQuestions';
import { QuestionEditor } from './QuestionEditor';
import { QuestionList } from './QuestionList';
import { EndedTerminalLogs } from './EndedTerminalLogs';
import { ExamFilesSection } from './ExamFilesSection';
import { HostingPanel } from './HostingPanel';
import { ReadyPanel } from './ReadyPanel';

type Editing = { question?: Question; type?: QuestionType } | null;

/** States after the exam ran: terminal logs stay readable there. */
const AFTER_EXAM: ReadonlySet<ExamSummary['state']> = new Set([
  'ended',
  'grading',
  'in_review',
  'finalized',
]);

interface Props {
  exam: ExamSummary;
  onBack: () => void;
}

/** One exam: its questions (add, edit, delete, reorder) and the Ready check. */
export function ExamDetailPage({ exam: initial, onBack }: Props) {
  const { api: examApi, exams, reload: reloadExams } = useExams();
  const { api, questions, error, reload } = useQuestions(initial.id);
  const exam = exams.find((e) => e.id === initial.id) ?? initial;
  const [editing, setEditing] = useState<Editing>(null);
  const [problems, setProblems] = useState<ReadyProblem[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const editable = exam.state === 'draft' || exam.state === 'ready';

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
      setNotice(null);
    } catch (e) {
      const list = readyProblemsOf(e);
      if (list) setProblems(list);
      else setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const save = async (body: QuestionBody) => {
    if (!api) return;
    if (editing?.question) await api.update(editing.question.id, body);
    else await api.create(exam.id, body);
    setEditing(null);
    setProblems([]);
    await reload();
  };

  const move = (q: Question, delta: -1 | 1) => {
    const ids = questions.map((x) => x.id);
    const from = ids.indexOf(q.id);
    ids.splice(from, 1);
    ids.splice(from + delta, 0, q.id);
    void run(async () => {
      await api?.reorder(exam.id, ids);
      await reload();
    });
  };

  const markReady = () =>
    void run(async () => {
      setProblems([]);
      await examApi?.markReady(exam.id);
      await reloadExams();
    });

  const host = () =>
    void run(async () => {
      setProblems([]);
      await examApi?.host(exam.id);
      await reloadExams();
    });

  const startExam = async () => {
    await examApi?.start(exam.id);
    await reloadExams();
  };

  const endExam = async () => {
    await examApi?.end(exam.id);
    await reloadExams();
  };

  // The server also ends an exam by itself at the deadline, so keep the state fresh.
  useEffect(() => {
    if (exam.state !== 'hosting' && exam.state !== 'running') return;
    const id = setInterval(() => void reloadExams(), 3000);
    return () => clearInterval(id);
  }, [exam.state, reloadExams]);

  const stopHosting = async () => {
    await examApi?.stopHosting(exam.id);
    await reloadExams();
  };

  const backToDraft = () =>
    void run(async () => {
      await examApi?.backToDraft(exam.id);
      await reloadExams();
    });

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold">{exam.title}</h1>
          <p className="text-sm text-muted">
            {exam.durationMin} min · {exam.classListName ?? 'No class list yet'}
          </p>
        </div>
        <Button variant="outline" onClick={onBack}>
          Back to exams
        </Button>
      </header>
      {(error ?? notice) && (
        <p role="alert" className="text-red-700">
          {error ?? notice}
        </p>
      )}
      {editing ? (
        <QuestionEditor
          key={editing.question?.id ?? 'new'}
          question={editing.question}
          newType={editing.type}
          onSubmit={save}
          onCancel={() => setEditing(null)}
        />
      ) : (
        <>
          <ReadyPanel
            state={exam.state}
            problems={problems}
            busy={busy || !examApi}
            onMarkReady={markReady}
            onBackToDraft={backToDraft}
            onHost={host}
          />
          {(exam.state === 'hosting' || exam.state === 'running') && examApi && (
            <HostingPanel
              examId={exam.id}
              api={examApi}
              running={exam.state === 'running'}
              onStart={startExam}
              onStop={stopHosting}
              onEnd={endExam}
            />
          )}
          {exam.state === 'ended' && (
            <p role="status" className="rounded-md border border-border p-4">
              This exam has ended. Students can no longer join or submit.
            </p>
          )}
          {AFTER_EXAM.has(exam.state) && examApi && (
            <EndedTerminalLogs examId={exam.id} api={examApi} />
          )}
          <ExamFilesSection examId={exam.id} editable={editable} filesEnabled={exam.filesEnabled} />
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">Questions</h2>
            <div className="flex gap-2">
              <Button disabled={!editable || !api} onClick={() => setEditing({ type: 'code' })}>
                Add code question
              </Button>
              <Button
                variant="outline"
                disabled={!editable || !api}
                onClick={() => setEditing({ type: 'written' })}
              >
                Add written question
              </Button>
            </div>
          </div>
          <QuestionList
            questions={questions}
            flagged={new Set(problems.flatMap((p) => (p.questionId ? [p.questionId] : [])))}
            disabled={!editable || busy}
            onEdit={(question) => setEditing({ question })}
            onDelete={(q) => {
              if (!window.confirm(`Delete question ${q.position}?`)) return;
              void run(async () => {
                await api?.remove(q.id);
                setProblems([]);
                await reload();
              });
            }}
            onMove={move}
          />
        </>
      )}
    </div>
  );
}
