import { useEffect, useState } from 'react';
import {
  ArrowLeftIcon,
  ClipboardCheckIcon,
  FileTextIcon,
  FlagIcon,
  MonitorIcon,
} from 'lucide-react';
import type {
  ExamSummary,
  Question,
  QuestionBody,
  QuestionType,
  ReadyProblem,
} from '@examguard/shared';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { readyProblemsOf } from '@/api/questionApi';
import { useConfirm } from '@/hooks/useConfirm';
import { useExams } from '@/hooks/useExams';
import { useQuestions } from '@/hooks/useQuestions';
import { useRoster } from '@/hooks/useRoster';
import { useGrading } from '@/hooks/useGrading';
import { ErrorAlert } from '../../components/common/ErrorAlert';
import { PageHeader } from '../../components/common/PageHeader';
import { ExamStateBadge } from '../../components/teacher/ExamStateBadge';
import { QuestionEditor } from '../../components/teacher/QuestionEditor';
import { QuestionsTab } from '../../components/teacher/QuestionsTab';
import { MonitoringBoard } from '../../components/teacher/MonitoringBoard';
import { GradingPanel } from '../../components/teacher/GradingPanel';
import { ReviewPanel } from '../../components/teacher/ReviewPanel';
import { ResultsPanel } from '../../components/teacher/ResultsPanel';
import { HostingPanel } from '../../components/teacher/HostingPanel';
import { ReadyPanel } from '../../components/teacher/ReadyPanel';

type Editing = { question?: Question; type?: QuestionType } | null;
type Tab = 'questions' | 'monitoring' | 'grading';

/** States after the exam ran: the board (timelines, terminal logs) stays readable there. */
const AFTER_EXAM: ReadonlySet<ExamSummary['state']> = new Set([
  'ended',
  'grading',
  'in_review',
  'finalized',
]);

/** The tab that matters most in each state (M51). */
function defaultTab(state: ExamSummary['state']): Tab {
  if (state === 'hosting' || state === 'running') return 'monitoring';
  return AFTER_EXAM.has(state) ? 'grading' : 'questions';
}

interface Props {
  exam: ExamSummary;
  onBack: () => void;
}

/**
 * One exam (M51 layout): the header, the Ready / Hosting status that is always in view, then tabs
 * for questions, monitoring and grading. Every tab panel stays mounted (`forceMount`), so the
 * monitoring streams and grading state behave as they did when the page was one long column.
 */
export function ExamDetailPage({ exam: initial, onBack }: Props) {
  const { api: examApi, exams, reload: reloadExams } = useExams();
  const { api, questions, error, reload } = useQuestions(initial.id);
  const confirm = useConfirm();
  const exam = exams.find((e) => e.id === initial.id) ?? initial;
  const [editing, setEditing] = useState<Editing>(null);
  const [problems, setProblems] = useState<ReadyProblem[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>(() => defaultTab(initial.state));
  const editable = exam.state === 'draft' || exam.state === 'ready';
  const live = exam.state === 'hosting' || exam.state === 'running';
  // One teacher socket for the page: roster, counts and live alerts (M31).
  const roster = useRoster(exam.id, live || AFTER_EXAM.has(exam.state));
  // Grading and review (M38, M39): progress arrives on the same socket.
  const afterExam = AFTER_EXAM.has(exam.state);
  const grading = useGrading(exam.id, roster.grading, roster.connects, afterExam);
  const gradedState = grading.status?.examState;
  useEffect(() => {
    if (gradedState && gradedState !== exam.state) void reloadExams();
  }, [gradedState, exam.state, reloadExams]);
  // A new state brings its own main tab forward (hosting → Monitoring, ended → Grading).
  useEffect(() => setTab(defaultTab(exam.state)), [exam.state]);

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

  const removeQuestion = async (q: Question) => {
    const ok = await confirm({
      title: `Delete question ${q.position}?`,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    void run(async () => {
      await api?.remove(q.id);
      setProblems([]);
      await reload();
    });
  };

  const examAction =
    (action: (id: string) => Promise<unknown>, clearProblems = true) =>
    () =>
      void run(async () => {
        if (clearProblems) setProblems([]);
        await action(exam.id);
        await reloadExams();
      });

  /** Hosting actions report their own errors (HostingPanel). */
  const hostingAction = (action: (id: string) => Promise<unknown>) => async () => {
    await action(exam.id);
    await reloadExams();
  };

  // The server also ends an exam by itself at the deadline, so keep the state fresh.
  useEffect(() => {
    if (exam.state !== 'hosting' && exam.state !== 'running') return;
    const id = setInterval(() => void reloadExams(), 3000);
    return () => clearInterval(id);
  }, [exam.state, reloadExams]);

  const showMonitoring = (live || afterExam) && !!examApi;
  const reviewing =
    exam.state === 'grading' || exam.state === 'in_review' || exam.state === 'finalized';

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {exam.title}
            <ExamStateBadge state={exam.state} />
          </span>
        }
        description={`${exam.durationMin} min · ${exam.classListName ?? 'No class list yet'}`}
        actions={
          <Button variant="outline" onClick={onBack}>
            <ArrowLeftIcon />
            Back to exams
          </Button>
        }
      />
      {(error ?? notice) && <ErrorAlert>{error ?? notice}</ErrorAlert>}
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
            onMarkReady={examAction((id) => examApi?.markReady(id) ?? Promise.resolve())}
            onBackToDraft={examAction((id) => examApi?.backToDraft(id) ?? Promise.resolve(), false)}
            onHost={examAction((id) => examApi?.host(id) ?? Promise.resolve())}
          />
          {live && examApi && (
            <HostingPanel
              examId={exam.id}
              api={examApi}
              roster={roster}
              running={exam.state === 'running'}
              onStart={hostingAction((id) => examApi.start(id))}
              onStop={hostingAction((id) => examApi.stopHosting(id))}
              onEnd={hostingAction((id) => examApi.end(id))}
            />
          )}
          {exam.state === 'ended' && (
            <Alert role="status" variant="info">
              <FlagIcon />
              <AlertDescription>
                This exam has ended. Students can no longer join or submit.
              </AlertDescription>
            </Alert>
          )}
          <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="gap-4">
            <TabsList>
              <TabsTrigger value="questions">
                <FileTextIcon />
                Questions
              </TabsTrigger>
              {showMonitoring && (
                <TabsTrigger value="monitoring">
                  <MonitorIcon />
                  Monitoring
                </TabsTrigger>
              )}
              {afterExam && (
                <TabsTrigger value="grading">
                  <ClipboardCheckIcon />
                  Grading
                </TabsTrigger>
              )}
            </TabsList>
            <TabsContent value="questions" forceMount>
              <QuestionsTab
                examId={exam.id}
                filesEnabled={exam.filesEnabled}
                editable={editable}
                canAdd={!!api}
                busy={busy}
                questions={questions}
                problems={problems}
                onAdd={(type) => setEditing({ type })}
                onEdit={(question) => setEditing({ question })}
                onDelete={(q) => void removeQuestion(q)}
                onMove={move}
              />
            </TabsContent>
            {showMonitoring && (
              <TabsContent value="monitoring" forceMount>
                <MonitoringBoard
                  examId={exam.id}
                  api={examApi}
                  roster={roster}
                  examState={exam.state}
                />
              </TabsContent>
            )}
            {afterExam && (
              <TabsContent value="grading" forceMount className="flex flex-col gap-6">
                <GradingPanel
                  examId={exam.id}
                  grading={grading}
                  questions={questions}
                  onStateChange={() => void reloadExams()}
                />
                {reviewing && grading.api && grading.status && examApi && questions.length > 0 && (
                  <ReviewPanel
                    examId={exam.id}
                    examApi={examApi}
                    api={grading.api}
                    status={grading.status}
                    questions={questions}
                    onGrading={(status) => {
                      grading.set(status);
                      void reloadExams();
                    }}
                  />
                )}
                {(exam.state === 'in_review' || exam.state === 'finalized') && (
                  <ResultsPanel
                    examId={exam.id}
                    grading={grading}
                    onStateChange={() => void reloadExams()}
                  />
                )}
              </TabsContent>
            )}
          </Tabs>
        </>
      )}
    </div>
  );
}
