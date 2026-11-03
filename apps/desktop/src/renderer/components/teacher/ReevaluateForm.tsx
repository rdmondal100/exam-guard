import { useState } from 'react';
import type { GradingStatus } from '@examguard/shared';
import type { GradingApi } from '@/api/gradingApi';
import { Button } from '@/components/ui/button';

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
      className="flex flex-col gap-2 rounded-md border border-sky-300 bg-sky-50 p-3 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <label className="flex flex-col gap-1">
        <span className="font-medium">
          Re-evaluate {one ? 'this answer' : 'every answer to this question'} with an instruction
        </span>
        <textarea
          className="min-h-16 rounded border border-border bg-white p-2"
          placeholder="For example: also accept recursive solutions"
          maxLength={2000}
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
        />
      </label>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={includeEdited}
          onChange={(e) => setIncludeEdited(e.target.checked)}
        />
        {one
          ? 'Replace my accepted or edited grade too'
          : 'Also re-grade answers I verified or edited'}
      </label>
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" className="h-8 px-3" disabled={busy || instruction.trim() === ''}>
          Re-evaluate
        </Button>
        <Button type="button" variant="outline" className="h-8 px-3" onClick={props.onClose}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
