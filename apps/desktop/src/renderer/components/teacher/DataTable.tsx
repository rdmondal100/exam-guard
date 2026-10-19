import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from '@tanstack/react-table';

interface Props<T> {
  columns: ColumnDef<T>[];
  data: T[];
  /** Shown instead of the table when `data` is empty. */
  empty?: string;
  /** Scrolls inside this height (a Tailwind max-h class) so long lists do not push the page. */
  maxHeight?: string;
}

/** Plain read-only TanStack table with the app's styling. */
export function DataTable<T>({ columns, data, empty = 'Nothing here.', maxHeight }: Props<T>) {
  const table = useReactTable({ columns, data, getCoreRowModel: getCoreRowModel() });
  if (data.length === 0) return <p className="text-muted">{empty}</p>;
  return (
    <div className={`overflow-auto rounded-md border border-border ${maxHeight ?? ''}`}>
      <table className="w-full text-left text-sm">
        <thead className="sticky top-0 bg-card">
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id}>
              {group.headers.map((header) => (
                <th key={header.id} className="px-3 py-2 font-medium">
                  {flexRender(header.column.columnDef.header, header.getContext())}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id} className="border-t border-border">
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id} className="px-3 py-2">
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
