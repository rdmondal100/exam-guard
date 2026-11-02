import { useMemo, useState } from 'react';
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import type { RosterEntry } from '@examguard/shared';
import { formatDuration } from '@/lib/eventsView';
import { compareCodes, compareNames, riskLevel, statusRank, statusText } from '@/lib/rosterTable';

interface Props {
  students: RosterEntry[];
  /** The student whose detail is open. */
  selectedId: string | null;
  onSelect: (student: RosterEntry) => void;
}

const RISK_STYLE: Record<ReturnType<typeof riskLevel>, string> = {
  none: 'text-muted',
  low: 'bg-black/5',
  medium: 'bg-amber-100 text-amber-900',
  high: 'bg-red-100 font-semibold text-red-800',
};

function Flags({ s }: { s: RosterEntry }) {
  return (
    <span className="flex flex-wrap gap-1">
      {!s.agentOk && (
        <span className="rounded-full bg-red-100 px-2 text-xs text-red-800">No agent</span>
      )}
      {s.monitors > 1 && (
        <span
          className="rounded-full bg-amber-100 px-2 text-xs text-amber-800"
          title="This PC shows its desktop on more than one screen"
        >
          {s.monitors} screens
        </span>
      )}
      {s.internetBlocked && (
        <span className="rounded-full bg-black/5 px-2 text-xs text-muted">Internet off</span>
      )}
    </span>
  );
}

const COLUMNS: ColumnDef<RosterEntry>[] = [
  {
    id: 'code',
    header: 'ID',
    accessorFn: (s) => s.studentCode,
    sortingFn: (a, b) => compareCodes(a.original.studentCode, b.original.studentCode),
    cell: ({ row }) => (
      <span className="flex items-center gap-2 font-mono">
        <span
          aria-label={row.original.connected ? 'Connected' : 'Disconnected'}
          className={`h-2.5 w-2.5 shrink-0 rounded-full ${row.original.connected ? 'bg-green-600' : 'bg-red-500'}`}
        />
        {row.original.studentCode}
      </span>
    ),
  },
  {
    id: 'name',
    header: 'Name',
    accessorFn: (s) => s.name,
    sortingFn: (a, b) => compareNames(a.original, b.original),
  },
  {
    id: 'status',
    header: 'Status',
    accessorFn: statusRank,
    cell: ({ row }) => (
      <span className={row.original.state === 'locked' ? 'font-medium text-red-700' : ''}>
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
      <span
        className={`rounded-md px-2 py-0.5 font-mono ${RISK_STYLE[riskLevel(row.original.riskScore)]}`}
      >
        {row.original.riskScore}
      </span>
    ),
  },
  {
    id: 'outside',
    header: 'Outside',
    accessorFn: (s) => s.outsideMs,
    sortDescFirst: true,
    cell: ({ row }) =>
      row.original.outsideMs > 0 ? (
        <span className="text-amber-700">{formatDuration(row.original.outsideMs)}</span>
      ) : (
        <span className="text-muted">—</span>
      ),
  },
  {
    id: 'flags',
    header: '',
    enableSorting: false,
    cell: ({ row }) => <Flags s={row.original} />,
  },
];

const SORT_MARK = { asc: ' ▲', desc: ' ▼' } as const;

/**
 * The joined students as a sortable table (M32): by risk (the default, highest first), ID, name,
 * status or time outside. A click on a row opens the student's detail.
 */
export function RosterTable({ students, selectedId, onSelect }: Props) {
  const [sorting, setSorting] = useState<SortingState>([{ id: 'risk', desc: true }]);
  const columns = useMemo(() => COLUMNS, []);
  const table = useReactTable({
    columns,
    data: students,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId: (s) => s.id,
  });

  if (students.length === 0) return <p className="text-sm text-muted">Nobody has joined yet.</p>;
  return (
    <div className="max-h-[28rem] overflow-auto rounded-md border border-border">
      <table aria-label="Joined students" className="w-full text-left text-sm">
        <thead className="sticky top-0 bg-card">
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id}>
              {group.headers.map((header) => {
                const sorted = header.column.getIsSorted();
                return (
                  <th
                    key={header.id}
                    className="px-3 py-2 font-medium"
                    aria-sort={
                      sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : undefined
                    }
                  >
                    {header.column.getCanSort() ? (
                      <button type="button" onClick={header.column.getToggleSortingHandler()}>
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {sorted ? SORT_MARK[sorted] : ''}
                      </button>
                    ) : (
                      flexRender(header.column.columnDef.header, header.getContext())
                    )}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr
              key={row.id}
              aria-selected={row.id === selectedId}
              onClick={() => onSelect(row.original)}
              className={`cursor-pointer border-t border-border hover:bg-black/5 ${row.id === selectedId ? 'bg-blue-50' : ''}`}
            >
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id} className="px-3 py-1.5">
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
