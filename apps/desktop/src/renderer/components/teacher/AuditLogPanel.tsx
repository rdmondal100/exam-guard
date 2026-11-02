import { useEffect, useState } from 'react';
import type { AuditEntry } from '@examguard/shared';
import { Button } from '@/components/ui/button';
import type { ExamApi } from '@/api/examApi';
import { auditTarget, describeAudit, isServerAction } from '@/lib/auditLog';
import { clockTime } from '@/lib/terminalLog';

interface Props {
  examId: string;
  api: ExamApi;
  /** While hosting or running the open log refreshes itself. */
  live: boolean;
}

const REFRESH_MS = 5000;

/**
 * The teacher action log (M36): everything the teacher did in this exam, newest first, from
 * `teacher_actions`. Closed by default; while open in a live exam it refreshes every 5 s.
 */
export function AuditLogPanel({ examId, api, live }: Props) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const load = () =>
      api
        .auditLog(examId)
        .then((next) => {
          if (cancelled) return;
          setRows(next);
          setError(null);
        })
        .catch((e: unknown) => {
          if (!cancelled) setError(e instanceof Error ? e.message : String(e));
        });
    void load();
    const timer = live ? setInterval(() => void load(), REFRESH_MS) : null;
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [open, live, api, examId]);

  return (
    <section
      aria-label="Action log"
      className="flex flex-col gap-2 rounded-md border border-border p-4"
    >
      <div className="flex items-center gap-3">
        <h2 className="text-xl font-semibold">Action log</h2>
        <span className="text-sm text-muted">everything done in this exam, newest first</span>
        <Button size="sm" variant="outline" className="ml-auto" onClick={() => setOpen(!open)}>
          {open ? 'Hide' : 'Show'}
        </Button>
      </div>
      {open && error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      {open && rows?.length === 0 && <p className="text-sm text-muted">Nothing logged yet.</p>}
      {open && rows && rows.length > 0 && (
        <div className="max-h-80 overflow-auto">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-card text-muted">
              <tr>
                <th className="py-1 pr-3 font-normal">Time</th>
                <th className="py-1 pr-3 font-normal">For</th>
                <th className="py-1 font-normal">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <tr key={r.id} className={isServerAction(r) ? 'text-muted' : ''}>
                  <td className="whitespace-nowrap py-1 pr-3 font-mono">{clockTime(r.ts)}</td>
                  <td className="whitespace-nowrap py-1 pr-3">{auditTarget(r)}</td>
                  <td className="py-1 break-words">{describeAudit(r)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
