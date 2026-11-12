import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from '@tanstack/react-table';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

interface Props<T> {
  columns: ColumnDef<T>[];
  data: T[];
  /** Shown instead of the table when `data` is empty. */
  empty?: string;
  /** Scrolls inside this height (a Tailwind max-h class) so long lists do not push the page. */
  maxHeight?: string;
  /** Extra classes for one row, e.g. to highlight it. */
  rowClassName?: (row: T) => string;
}

/** Plain read-only TanStack table on shadcn's table parts (M51). */
export function DataTable<T>({
  columns,
  data,
  empty = 'Nothing here.',
  maxHeight,
  rowClassName,
}: Props<T>) {
  const table = useReactTable({ columns, data, getCoreRowModel: getCoreRowModel() });
  if (data.length === 0) {
    return (
      <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
        {empty}
      </p>
    );
  }
  return (
    <div className={cn('overflow-auto rounded-lg border bg-card', maxHeight)}>
      <Table>
        <TableHeader className="sticky top-0 z-[1] bg-muted/60 backdrop-blur">
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id} className="hover:bg-transparent">
              {group.headers.map((header) => (
                <TableHead key={header.id} className="px-3">
                  {flexRender(header.column.columnDef.header, header.getContext())}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.map((row) => (
            <TableRow key={row.id} className={rowClassName?.(row.original)}>
              {row.getVisibleCells().map((cell) => (
                <TableCell key={cell.id} className="px-3">
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
