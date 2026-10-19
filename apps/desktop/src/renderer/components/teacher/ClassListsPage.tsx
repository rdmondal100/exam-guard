import { useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import type { ClassListSummary, ClassStudentRow } from '@examguard/shared';
import { Button } from '@/components/ui/button';
import type { ClassListApi } from '@/lib/classListApi';
import { TeacherApiError } from '@/lib/teacherApi';
import { useClassLists } from '@/lib/useClassLists';
import { DataTable } from './DataTable';
import { ImportPreview } from './ImportPreview';

const studentColumns: ColumnDef<ClassStudentRow>[] = [
  { header: 'Student ID', accessorKey: 'studentCode' },
  { header: 'Name', accessorKey: 'name' },
];

function deleteMessage(e: unknown): string {
  if (e instanceof TeacherApiError && e.code === 'list_in_use') {
    return 'This class list is used by an exam, so it cannot be deleted.';
  }
  return e instanceof Error ? e.message : String(e);
}

/** Saved class lists, the CSV import flow and a student viewer. */
export function ClassListsPage() {
  const { api, lists, error, reload } = useClassLists();
  const [importing, setImporting] = useState(false);
  const [viewing, setViewing] = useState<{ list: ClassListSummary; students: ClassStudentRow[] }>();
  const [notice, setNotice] = useState<string | null>(null);

  const view = async (target: ClassListApi, list: ClassListSummary) => {
    setViewing({ list, students: await target.students(list.id) });
  };

  const remove = async (target: ClassListApi, list: ClassListSummary) => {
    if (!window.confirm(`Delete "${list.name}" and its ${list.studentCount} students?`)) return;
    try {
      await target.remove(list.id);
      setNotice(null);
      if (viewing?.list.id === list.id) setViewing(undefined);
      await reload();
    } catch (e) {
      setNotice(deleteMessage(e));
    }
  };

  const columns: ColumnDef<ClassListSummary>[] = [
    { header: 'Name', accessorKey: 'name' },
    { header: 'Students', accessorKey: 'studentCount' },
    {
      header: 'Imported',
      accessorKey: 'createdAt',
      cell: ({ getValue }) => new Date(getValue<number>()).toLocaleString(),
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) =>
        api && (
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => void view(api, row.original)}>
              View
            </Button>
            <Button variant="outline" onClick={() => void remove(api, row.original)}>
              Delete
            </Button>
          </div>
        ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <h1 className="text-3xl font-semibold">Class lists</h1>
        {!importing && api && <Button onClick={() => setImporting(true)}>Import CSV</Button>}
      </header>
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      {notice && (
        <p role="alert" className="text-red-700">
          {notice}
        </p>
      )}
      {importing && api ? (
        <ImportPreview
          api={api}
          onCancel={() => setImporting(false)}
          onDone={() => {
            setImporting(false);
            void reload();
          }}
        />
      ) : (
        <DataTable
          columns={columns}
          data={lists}
          empty="No class lists yet. Import a CSV to start."
        />
      )}
      {viewing && !importing && (
        <section className="flex flex-col gap-2" aria-label="Students">
          <h2 className="text-xl font-semibold">
            {viewing.list.name} ({viewing.students.length})
          </h2>
          <DataTable columns={studentColumns} data={viewing.students} maxHeight="max-h-96" />
        </section>
      )}
    </div>
  );
}
