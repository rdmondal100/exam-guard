import { useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { EyeIcon, Trash2Icon, UploadIcon } from 'lucide-react';
import type { ClassListSummary, ClassStudentRow } from '@examguard/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { ClassListApi } from '@/api/classListApi';
import { TeacherApiError } from '@/api/teacherApi';
import { useClassLists } from '@/hooks/useClassLists';
import { useConfirm } from '@/hooks/useConfirm';
import { ErrorAlert } from '../../components/common/ErrorAlert';
import { PageHeader } from '../../components/common/PageHeader';
import { DataTable } from '../../components/teacher/DataTable';
import { ImportPreview } from '../../components/teacher/ImportPreview';

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
  const confirm = useConfirm();
  const [importing, setImporting] = useState(false);
  const [viewing, setViewing] = useState<{ list: ClassListSummary; students: ClassStudentRow[] }>();
  const [notice, setNotice] = useState<string | null>(null);

  const view = async (target: ClassListApi, list: ClassListSummary) => {
    setViewing({ list, students: await target.students(list.id) });
  };

  const remove = async (target: ClassListApi, list: ClassListSummary) => {
    const ok = await confirm({
      title: `Delete "${list.name}" and its ${list.studentCount} students?`,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
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
    {
      header: 'Name',
      accessorKey: 'name',
      cell: ({ getValue }) => <span className="font-medium">{getValue<string>()}</span>,
    },
    {
      header: 'Students',
      accessorKey: 'studentCount',
      cell: ({ getValue }) => <Badge variant="secondary">{getValue<number>()}</Badge>,
    },
    {
      header: 'Imported',
      accessorKey: 'createdAt',
      cell: ({ getValue }) => (
        <span className="text-muted-foreground">
          {new Date(getValue<number>()).toLocaleString()}
        </span>
      ),
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) =>
        api && (
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => void view(api, row.original)}>
              <EyeIcon />
              View
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void remove(api, row.original)}>
              <Trash2Icon />
              Delete
            </Button>
          </div>
        ),
    },
  ];

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <PageHeader
        title="Class lists"
        description="Import the students who may join an exam, from a CSV of student IDs and names."
        actions={
          !importing &&
          api && (
            <Button onClick={() => setImporting(true)}>
              <UploadIcon />
              Import CSV
            </Button>
          )
        }
      />
      {error && <ErrorAlert>{error}</ErrorAlert>}
      {notice && <ErrorAlert>{notice}</ErrorAlert>}
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
        <Card aria-label="Students">
          <CardHeader>
            <CardTitle>
              {viewing.list.name} ({viewing.students.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <DataTable columns={studentColumns} data={viewing.students} maxHeight="max-h-96" />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
