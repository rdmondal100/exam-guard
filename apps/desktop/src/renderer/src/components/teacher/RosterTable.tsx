import { useMemo, useState } from 'react';
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
} from '@tanstack/react-table';
import { ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon, UsersIcon } from 'lucide-react';
import type { RosterEntry } from '@examguard/shared';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { EmptyState } from '../common/EmptyState';
import { ROSTER_COLUMNS } from './rosterColumns';

interface Props {
  students: RosterEntry[];
  /** The student whose detail is open. */
  selectedId: string | null;
  onSelect: (student: RosterEntry) => void;
}

const SORT_ICON = { asc: ArrowUpIcon, desc: ArrowDownIcon } as const;

/**
 * The joined students as a sortable table (M32): by risk (the default, highest first), ID, name,
 * status or time outside. A click on a row opens the student's detail.
 */
export function RosterTable({ students, selectedId, onSelect }: Props) {
  const [sorting, setSorting] = useState<SortingState>([{ id: 'risk', desc: true }]);
  const columns = useMemo(() => ROSTER_COLUMNS, []);
  const table = useReactTable({
    columns,
    data: students,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId: (s) => s.id,
  });

  if (students.length === 0) {
    return <EmptyState icon={UsersIcon} title="Nobody has joined yet." />;
  }
  return (
    <div className="max-h-[28rem] overflow-auto rounded-lg border">
      <Table aria-label="Joined students">
        <TableHeader className="sticky top-0 z-[1] bg-muted/80 backdrop-blur">
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id} className="hover:bg-transparent">
              {group.headers.map((header) => {
                const sorted = header.column.getIsSorted();
                const Icon = sorted ? SORT_ICON[sorted] : ArrowUpDownIcon;
                return (
                  <TableHead
                    key={header.id}
                    className="px-3"
                    aria-sort={
                      sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : undefined
                    }
                  >
                    {header.column.getCanSort() ? (
                      <button
                        type="button"
                        className="-mx-1 inline-flex items-center gap-1 rounded px-1 hover:text-foreground"
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        <Icon
                          aria-hidden
                          className={sorted ? 'size-3.5 text-foreground' : 'size-3.5 opacity-40'}
                        />
                      </button>
                    ) : (
                      flexRender(header.column.columnDef.header, header.getContext())
                    )}
                  </TableHead>
                );
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.map((row) => (
            <TableRow
              key={row.id}
              aria-selected={row.id === selectedId}
              onClick={() => onSelect(row.original)}
              className="cursor-pointer aria-selected:bg-primary/8"
            >
              {row.getVisibleCells().map((cell) => (
                <TableCell key={cell.id} className="px-3 py-1.5">
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
