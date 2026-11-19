import { CodeIcon, InfoIcon, PencilLineIcon } from 'lucide-react';
import type { Question, QuestionType, ReadyProblem } from '@examguard/shared';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ExamFilesSection } from './ExamFilesSection';
import { QuestionList } from './QuestionList';

interface Props {
  examId: string;
  filesEnabled: boolean;
  /** Draft or ready: questions and files can change. */
  editable: boolean;
  /** Hosted or running (M58): questions and files can only be added; students get them at once. */
  live: boolean;
  /** The question API is ready. */
  canAdd: boolean;
  busy: boolean;
  questions: Question[];
  problems: ReadyProblem[];
  onAdd: (type: QuestionType) => void;
  onEdit: (question: Question) => void;
  onDelete: (question: Question) => void;
  onMove: (question: Question, delta: -1 | 1) => void;
}

/** The exam detail's Questions tab (M51): the question list with add buttons, and exam files. */
export function QuestionsTab(props: Props) {
  const { editable, live, canAdd, questions, problems } = props;
  const adding = (editable || live) && canAdd;
  return (
    <div className="flex flex-col gap-6">
      <section aria-label="Questions" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Questions</h2>
          <div className="flex gap-2">
            <Button disabled={!adding} onClick={() => props.onAdd('code')}>
              <CodeIcon />
              Add code question
            </Button>
            <Button variant="outline" disabled={!adding} onClick={() => props.onAdd('written')}>
              <PencilLineIcon />
              Add written question
            </Button>
          </div>
        </div>
        {live && (
          <Alert role="note" variant="info">
            <InfoIcon />
            <AlertDescription>
              A question you add now goes to every student at once, after the others. It needs a
              sample answer and marking criteria. Questions students already have cannot be changed.
            </AlertDescription>
          </Alert>
        )}
        <QuestionList
          questions={questions}
          flagged={new Set(problems.flatMap((p) => (p.questionId ? [p.questionId] : [])))}
          disabled={!editable || props.busy}
          onEdit={props.onEdit}
          onDelete={props.onDelete}
          onMove={props.onMove}
        />
      </section>
      <ExamFilesSection
        examId={props.examId}
        editable={editable}
        live={live}
        filesEnabled={props.filesEnabled}
      />
    </div>
  );
}
