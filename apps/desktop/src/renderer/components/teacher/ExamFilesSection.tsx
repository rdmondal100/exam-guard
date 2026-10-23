import { useRef, useState } from 'react';
import { EXAM_FILE_LIMITS, type ExamFile } from '@examguard/shared';
import { Button } from '@/components/ui/button';
import { formatSize } from '@/lib/filePaths';
import { useExamFiles } from '@/lib/useExamFiles';

interface Props {
  examId: string;
  /** Files can only change while the exam is a draft or ready. */
  editable: boolean;
  /** The exam's Files panel switch; with it off, students do not get these files. */
  filesEnabled: boolean;
}

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Files and pictures the teacher attaches to the exam (a data file, an image a program loads).
 * Every student gets a copy in their project folder when the exam starts.
 */
export function ExamFilesSection({ examId, editable, filesEnabled }: Props) {
  const { api, files, error, reload } = useExamFiles(examId);
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
    if (!api || !window.confirm(`Remove ${file.name}?`)) return;
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
    <section
      aria-label="Exam files"
      className="flex flex-col gap-3 rounded-md border border-border p-4"
    >
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">Exam files</h2>
          <p className="text-sm text-muted">
            Data files and pictures students need. Each student gets a copy in their project folder
            when the exam starts.
          </p>
        </div>
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
          disabled={!editable || !api || busy}
          onClick={() => input.current?.click()}
        >
          Add files
        </Button>
      </div>

      {!filesEnabled && (
        <p role="status" className="text-sm text-amber-800">
          The Files panel is turned off in this exam's settings, so students will not get these
          files.
        </p>
      )}
      {!editable && (
        <p className="text-sm text-muted">Files can only be changed before the exam is hosted.</p>
      )}
      {(error || failures.length > 0) && (
        <ul role="alert" className="text-sm text-red-700">
          {error && <li>{error}</li>}
          {failures.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      )}

      {files.length === 0 ? (
        <p className="text-sm text-muted">No files attached.</p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {files.map((f) => (
            <li key={f.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1 truncate" title={f.name}>
                {f.name}
              </span>
              <span className="shrink-0 text-muted">{formatSize(f.size)}</span>
              <Button
                variant="outline"
                className="h-8 px-3"
                disabled={!editable || busy}
                onClick={() => void remove(f)}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted">
        {formatSize(used)} of {formatSize(EXAM_FILE_LIMITS.totalBytes)} · up to{' '}
        {formatSize(EXAM_FILE_LIMITS.fileBytes)} per file · {files.length} of{' '}
        {EXAM_FILE_LIMITS.count} files
      </p>
    </section>
  );
}
