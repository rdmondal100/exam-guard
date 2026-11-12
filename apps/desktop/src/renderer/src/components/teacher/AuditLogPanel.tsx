import { useEffect, useState } from 'react';
import { ChevronDownIcon, HistoryIcon } from 'lucide-react';
import type { AuditEntry } from '@examguard/shared';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import type { ExamApi } from '@/api/examApi';
import { auditTarget, describeAudit, isServerAction } from '@/lib/auditLog';
import { clockTime } from '@/lib/terminalLog';
import { ErrorAlert } from '../common/ErrorAlert';

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
    <Collapsible open={open} onOpenChange={setOpen} asChild>
      <Card aria-label="Action log" className="gap-4">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            <HistoryIcon className="size-4 text-muted-foreground" aria-hidden />
            Action log
          </CardTitle>
          <CardDescription>everything done in this exam, newest first</CardDescription>
          <CardAction>
            <CollapsibleTrigger asChild>
              <Button size="sm" variant="outline">
                {open ? 'Hide' : 'Show'}
                <ChevronDownIcon className={cn('transition-transform', open && 'rotate-180')} />
              </Button>
            </CollapsibleTrigger>
          </CardAction>
        </CardHeader>
        <CollapsibleContent>
          <CardContent className="flex flex-col gap-2">
            {error && <ErrorAlert>{error}</ErrorAlert>}
            {rows?.length === 0 && (
              <p className="text-sm text-muted-foreground">Nothing logged yet.</p>
            )}
            {rows && rows.length > 0 && (
              <div className="max-h-80 overflow-auto rounded-lg border">
                <Table>
                  <TableHeader className="sticky top-0 bg-muted/80 backdrop-blur">
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="px-3">Time</TableHead>
                      <TableHead className="px-3">For</TableHead>
                      <TableHead className="px-3">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => (
                      <TableRow
                        key={r.id}
                        className={isServerAction(r) ? 'text-muted-foreground' : ''}
                      >
                        <TableCell className="px-3 font-mono whitespace-nowrap">
                          {clockTime(r.ts)}
                        </TableCell>
                        <TableCell className="px-3 whitespace-nowrap">{auditTarget(r)}</TableCell>
                        <TableCell className="px-3 break-words whitespace-normal">
                          {describeAudit(r)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
