import { useState } from 'react';
import type { ExportResult } from '@examguard/shared';
import { Button } from '@/components/ui/button';
import type { GradingView } from '@/hooks/useGrading';
import { finalizeBlockers } from '@/lib/grading';

interface Props {
  examId: string;
  grading: GradingView;
  /** The exam state changed (Finalized): reload the exam list. */
  onStateChange: () => void;
}

/**
 * Finalize and export (M42). Finalizing needs a grade on every answer, takes a backup and then
 * locks the marks. The export saves the results CSV (marks per question, total, events by
 * severity, time outside ExamGuard) in the `exports` folder and can show it in Explorer.
 */
export function ResultsPanel({ examId, grading, onStateChange }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<ExportResult | null>(null);
  const { api, status } = grading;
  if (!api || !status) return null;
  if (status.examState !== 'in_review' && status.examState !== 'finalized') return null;
  const { pending, needsManual } = finalizeBlockers(status);
  const ready = pending + needsManual === 0;

  const act = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const finalize = () =>
    act(async () => {
      const ok = window.confirm(
        'Finalize the exam? Marks can no longer be accepted, edited or re-evaluated. A backup is taken first.',
      );
      if (!ok) return;
      await api.finalize(examId);
      await grading.reload();
      onStateChange();
    });

  const exportCsv = () =>
    act(async () => {
      setSaved(await api.exportCsv(examId));
    });

  const reveal = () =>
    act(async () => {
      if (saved && !(await window.examguard.revealExport(saved.fileName))) {
        throw new Error('The file is no longer in the exports folder.');
      }
    });

  return (
    <section
      aria-label="Results"
      className="flex flex-col gap-3 rounded-md border border-border p-4"
    >
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-semibold">Results</h2>
        {status.examState === 'finalized' ? (
          <span className="rounded bg-green-100 px-2 py-0.5 text-xs text-green-800">
            Finalized: marks are locked
          </span>
        ) : (
          <Button className="ml-auto" disabled={busy || !ready} onClick={() => void finalize()}>
            Finalize marks
          </Button>
        )}
        {status.examState === 'finalized' && (
          <Button className="ml-auto" disabled={busy} onClick={() => void exportCsv()}>
            Export CSV
          </Button>
        )}
      </div>
      {status.examState === 'in_review' && !ready && (
        <p className="text-sm text-muted">
          Before finalizing, every answer needs a grade:
          {pending > 0 && ` ${pending} not graded yet`}
          {pending > 0 && needsManual > 0 && ','}
          {needsManual > 0 && ` ${needsManual} need manual grading`}.
        </p>
      )}
      {status.examState === 'in_review' && ready && (
        <p className="text-sm text-muted">
          Every answer has a grade. Check the AI grades before finalizing: they were made by reading
          the code, not running it.
        </p>
      )}
      {saved && (
        <p role="status" className="flex flex-wrap items-center gap-2 text-sm">
          Saved <span className="font-mono">{saved.fileName}</span> ({saved.rows} students) in the
          exports folder.
          <Button variant="outline" className="h-7 px-2" onClick={() => void reveal()}>
            Show in folder
          </Button>
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
    </section>
  );
}
