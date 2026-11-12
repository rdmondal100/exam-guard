import type { ColumnDef } from '@tanstack/react-table';
import type { RosterEntry } from '@examguard/shared';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { formatDuration } from '@/lib/eventsView';
import { compareCodes, compareNames, riskLevel, statusRank, statusText } from '@/lib/rosterTable';
import { Hint } from '../common/Hint';
import { RISK_TONE } from './riskTone';

/** The "Not monitored" and "N screens" chips of one student. */
export function RosterFlags({ s }: { s: RosterEntry }) {
  return (
    <span className="flex flex-wrap gap-1">
      {!s.monitorOk && (
        <Hint label="The app on this PC cannot capture the screen or read the window in front">
          <Badge variant="danger">Not monitored</Badge>
        </Hint>
      )}
      {s.monitors > 1 && (
        <Hint label="This PC shows its desktop on more than one screen">
          <Badge variant="warning">{s.monitors} screens</Badge>
        </Hint>
      )}
    </span>
  );
}

/** Green when the student's app is connected, red when not. */
export function ConnectionDot({
  connected,
  className,
}: {
  connected: boolean;
  className?: string;
}) {
  return (
    <span
      aria-label={connected ? 'Connected' : 'Disconnected'}
      className={cn(
        'size-2.5 shrink-0 rounded-full',
        connected ? 'bg-success' : 'bg-destructive',
        className,
      )}
    />
  );
}

/** The roster table's columns (M32): sortable by ID, name, status, risk and time outside. */
export const ROSTER_COLUMNS: ColumnDef<RosterEntry>[] = [
  {
    id: 'code',
    header: 'ID',
    accessorFn: (s) => s.studentCode,
    sortingFn: (a, b) => compareCodes(a.original.studentCode, b.original.studentCode),
    cell: ({ row }) => (
      <span className="flex items-center gap-2 font-mono">
        <ConnectionDot connected={row.original.connected} />
        {row.original.studentCode}
      </span>
    ),
  },
  {
    id: 'name',
    header: 'Name',
    accessorFn: (s) => s.name,
    sortingFn: (a, b) => compareNames(a.original, b.original),
    cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
  },
  {
    id: 'status',
    header: 'Status',
    accessorFn: statusRank,
    cell: ({ row }) => (
      <span className={row.original.state === 'locked' ? 'font-medium text-destructive' : ''}>
        {statusText(row.original)}
      </span>
    ),
  },
  {
    id: 'risk',
    header: 'Risk',
    accessorFn: (s) => s.riskScore,
    sortDescFirst: true,
    cell: ({ row }) => (
      <Badge variant={RISK_TONE[riskLevel(row.original.riskScore)]} className="font-mono">
        {row.original.riskScore}
      </Badge>
    ),
  },
  {
    id: 'outside',
    header: 'Outside',
    accessorFn: (s) => s.outsideMs,
    sortDescFirst: true,
    cell: ({ row }) =>
      row.original.outsideMs > 0 ? (
        <span className="text-warning">{formatDuration(row.original.outsideMs)}</span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    id: 'flags',
    header: '',
    enableSorting: false,
    cell: ({ row }) => <RosterFlags s={row.original} />,
  },
];
