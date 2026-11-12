import { useState } from 'react';
import { SparklesIcon } from 'lucide-react';
import type { GradingStatus } from '@examguard/shared';
import type { GradingApi } from '@/api/gradingApi';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Spinner } from '../common/Spinner';

interface Props {
  api: GradingApi;
  examId: string;
  questionId: string;
  /** One answer, or every answer of the question. */
  examStudentId?: string;
  /** Start with "include edited" on (the one answer was already verified or edited). */
  edited?: boolean;
  onStarted: (status: GradingStatus) => void;
  onClose: () => void;
}

/**
 * "Re-evaluate with an instruction" (M41): the AI grades the question again with the teacher's
 * extra instruction, for one answer or all of them. Answers the teacher verified or edited are
 * left alone unless included; the new grades are added to each answer's history.
 */
export function ReevaluateForm(props: Props) {
  const { api, examId, questionId, examStudentId } = props;
  const [instruction, setInstruction] = useState('');
  const [includeEdited, setIncludeEdited] = useState(props.edited ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const one = examStudentId !== undefined;

  const submit = async () => {
    setBusy(true);
    try {
      const status = await api.reevaluate(examId, {
        questionId,
        examStudentIds: one ? [examStudentId] : 'all',
        includeEdited,
        instruction,
      });
      props.onStarted(status);
      props.onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      aria-label="Re-evaluate"
      className="flex flex-col gap-3 rounded-lg border border-info/30 bg-info/5 p-4 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <label className="flex flex-col gap-2">
        <span className="flex items-center gap-2 font-medium">
          <SparklesIcon className="size-4 text-info" aria-hidden />
          Re-evaluate {one ? 'this answer' : 'every answer to this question'} with an instruction
        </span>
        <Textarea
          placeholder="For example: also accept recursive solutions"
          maxLength={2000}
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
        />
      </label>
      <label className="flex items-center gap-2">
        <Checkbox checked={includeEdited} onCheckedChange={(v) => setIncludeEdited(v === true)} />
        {one
          ? 'Replace my accepted or edited grade too'
          : 'Also re-grade answers I verified or edited'}
      </label>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy || instruction.trim() === ''}>
          {busy && <Spinner />}
          Re-evaluate
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={props.onClose}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
