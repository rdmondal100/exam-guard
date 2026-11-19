import { useRef, useState } from 'react';
import { FileIcon, PaperclipIcon, Trash2Icon, TriangleAlertIcon, UploadIcon } from 'lucide-react';
import { EXAM_FILE_LIMITS, type ExamFile } from '@examguard/shared';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { formatSize } from '@/lib/filePaths';
import { useConfirm } from '@/hooks/useConfirm';
import { useExamFiles } from '@/hooks/useExamFiles';
import { EmptyState } from '../common/EmptyState';
import { ErrorAlert } from '../common/ErrorAlert';
import { Spinner } from '../common/Spinner';

interface Props {
  examId: string;
  /** Files can only change while the exam is a draft or ready. */
  editable: boolean;
  /** Hosted or running (M58): new files can still be added; students get them at once. */
  live: boolean;
  /** The exam's Files panel switch; with it off, students do not get these files. */
  filesEnabled: boolean;
}

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Files and pictures the teacher attaches to the exam (a data file, an image a program loads).
 * Every student gets a copy in their project folder when the exam starts.
 */
export function ExamFilesSection({ examId, editable, live, filesEnabled }: Props) {
  const canAdd = editable || live;
  const { api, files, error, reload } = useExamFiles(examId);
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const [failures, setFailures] = useState<string[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const used = files.reduce((sum, f) => sum + f.size, 0);

  const add = async (picked: FileList | null) => {
    if (!api || !picked || picked.length === 0) return;
    const chosen = Array.from(picked); // copied first: clearing the input empties the list
    if (input.current) input.current.value = '';
    setBusy(true);
    const failed: string[] = [];
    for (const file of chosen) {
      try {
        await api.upload(examId, file);
      } catch (e) {
        failed.push(`${file.name}: ${messageOf(e)}`);
      }
    }
    setFailures(failed);
    await reload();
    setBusy(false);
  };

  const remove = async (file: ExamFile) => {
    if (!api) return;
    if (
      !(await confirm({ title: `Remove ${file.name}?`, confirmLabel: 'Remove', destructive: true }))
    ) {
      return;
    }
    setBusy(true);
    try {
      await api.remove(examId, file.id);
      setFailures([]);
    } catch (e) {
      setFailures([messageOf(e)]);
    }
    await reload();
    setBusy(false);
  };

  return (
    <Card aria-label="Exam files">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <PaperclipIcon className="size-4 text-muted-foreground" aria-hidden />
          Exam files
        </CardTitle>
        <CardDescription>
          Data files and pictures students need. Each student gets a copy in their project folder
          when the exam starts.
        </CardDescription>
        <CardAction>
          <input
            ref={input}
            type="file"
            multiple
            hidden
            aria-label="Choose files"
            onChange={(e) => void add(e.target.files)}
          />
          <Button
            variant="outline"
            disabled={!canAdd || !api || busy}
            onClick={() => input.current?.click()}
          >
            {busy ? <Spinner /> : <UploadIcon />}
            Add files
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {!filesEnabled && (
          <Alert role="status" variant="warning">
            <TriangleAlertIcon />
            <AlertDescription>
              The Files panel is turned off in this exam&apos;s settings, so students will not get
              these files.
            </AlertDescription>
          </Alert>
        )}
        {live ? (
          <p className="text-sm text-muted-foreground">
            New files go to every student at once: into the project folder if the exam is running.
            Files already sent cannot be removed or replaced; give a new file another name.
          </p>
        ) : (
          !editable && (
            <p className="text-sm text-muted-foreground">
              Files can only be changed before the exam is hosted.
            </p>
          )
        )}
        {(error || failures.length > 0) && (
          <ErrorAlert>
            <ul>
              {error && <li>{error}</li>}
              {failures.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </ErrorAlert>
        )}
        {files.length === 0 ? (
          <EmptyState icon={FileIcon} title="No files attached." className="py-6" />
        ) : (
          <ul className="divide-y rounded-lg border">
            {files.map((f) => (
              <li key={f.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <FileIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{f.name}</span>
                <span className="shrink-0 text-muted-foreground">{formatSize(f.size)}</span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove ${f.name}`}
                  disabled={!editable || busy}
                  onClick={() => void remove(f)}
                >
                  <Trash2Icon />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <CardFooter className="text-xs text-muted-foreground">
        {formatSize(used)} of {formatSize(EXAM_FILE_LIMITS.totalBytes)} · up to{' '}
        {formatSize(EXAM_FILE_LIMITS.fileBytes)} per file · {files.length} of{' '}
        {EXAM_FILE_LIMITS.count} files
      </CardFooter>
    </Card>
  );
}
