import { useState } from 'react';
import { DownloadIcon, FolderOpenIcon, LockIcon, TrophyIcon } from 'lucide-react';
import type { ExportResult } from '@examguard/shared';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { GradingView } from '@/hooks/useGrading';
import { useConfirm } from '@/hooks/useConfirm';
import { finalizeBlockers } from '@/lib/grading';
import { ErrorAlert } from '../common/ErrorAlert';

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
  const confirm = useConfirm();
  const { api, status } = grading;
  if (!api || !status) return null;
  if (status.examState !== 'in_review' && status.examState !== 'finalized') return null;
  const { pending, needsManual } = finalizeBlockers(status);
  const ready = pending + needsManual === 0;
  const finalized = status.examState === 'finalized';

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

  const finalize = async () => {
    const ok = await confirm({
      title: 'Finalize the exam?',
      description:
        'Marks can no longer be accepted, edited or re-evaluated. A backup is taken first.',
      confirmLabel: 'Finalize marks',
    });
    if (!ok) return;
    await act(async () => {
      await api.finalize(examId);
      await grading.reload();
      onStateChange();
    });
  };

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
    <Card aria-label="Results">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-xl">
          <TrophyIcon className="size-4 text-muted-foreground" aria-hidden />
          Results
          {finalized && (
            <Badge variant="success">
              <LockIcon />
              Finalized: marks are locked
            </Badge>
          )}
        </CardTitle>
        <CardAction>
          {finalized ? (
            <Button disabled={busy} onClick={() => void exportCsv()}>
              <DownloadIcon />
              Export CSV
            </Button>
          ) : (
            <Button disabled={busy || !ready} onClick={() => void finalize()}>
              <LockIcon />
              Finalize marks
            </Button>
          )}
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {status.examState === 'in_review' && !ready && (
          <p className="text-sm text-muted-foreground">
            Before finalizing, every answer needs a grade:
            {pending > 0 && ` ${pending} not graded yet`}
            {pending > 0 && needsManual > 0 && ','}
            {needsManual > 0 && ` ${needsManual} need manual grading`}.
          </p>
        )}
        {status.examState === 'in_review' && ready && (
          <p className="text-sm text-muted-foreground">
            Every answer has a grade. Check the AI grades before finalizing: they were made by
            reading the code, not running it.
          </p>
        )}
        {saved && (
          <Alert role="status" variant="success">
            <DownloadIcon />
            <AlertDescription className="flex flex-wrap items-center gap-2">
              <span>
                Saved <span className="font-mono">{saved.fileName}</span> ({saved.rows} students) in
                the exports folder.
              </span>
              <Button size="sm" variant="outline" onClick={() => void reveal()}>
                <FolderOpenIcon />
                Show in folder
              </Button>
            </AlertDescription>
          </Alert>
        )}
        {error && <ErrorAlert>{error}</ErrorAlert>}
      </CardContent>
    </Card>
  );
}
