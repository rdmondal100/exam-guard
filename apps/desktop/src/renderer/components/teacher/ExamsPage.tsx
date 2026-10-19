import { useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import type { ExamSummary } from '@examguard/shared';
import { Button } from '@/components/ui/button';
import { TeacherApiError } from '@/lib/teacherApi';
import { useClassLists } from '@/lib/useClassLists';
import { useExams } from '@/lib/useExams';
import { DataTable } from './DataTable';
import { ExamDetailPage } from './ExamDetailPage';
import { ExamSettingsForm, type ExamFormValues } from './ExamSettingsForm';

const STATE_LABEL: Record<ExamSummary['state'], string> = {
  draft: 'Draft',
  ready: 'Ready',
  hosting: 'Hosting',
  running: 'Running',
  ended: 'Ended',
  grading: 'Grading',
  in_review: 'In review',
  finalized: 'Finalized',
};

function actionMessage(e: unknown): string {
  if (e instanceof TeacherApiError && e.code === 'invalid_state') {
    return 'Only draft or ready exams can be changed or deleted.';
  }
  return e instanceof Error ? e.message : String(e);
}

/** Exam list with create, edit settings, duplicate and delete. */
export function ExamsPage() {
  const { api, exams, error, reload } = useExams();
  const { lists } = useClassLists();
  const [form, setForm] = useState<{ exam?: ExamSummary } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [detail, setDetail] = useState<ExamSummary | null>(null);

  const run = async (action: () => Promise<unknown>) => {
    try {
      await action();
      setNotice(null);
      await reload();
    } catch (e) {
      setNotice(actionMessage(e));
    }
  };

  const save = async (values: ExamFormValues) => {
    if (!api) return;
    if (form?.exam) await api.update(form.exam.id, values);
    else await api.create(values);
    setForm(null);
    await reload();
  };

  const columns: ColumnDef<ExamSummary>[] = [
    { header: 'Title', accessorKey: 'title' },
    {
      header: 'State',
      accessorKey: 'state',
      cell: ({ getValue }) => STATE_LABEL[getValue<ExamSummary['state']>()],
    },
    {
      header: 'Duration',
      accessorKey: 'durationMin',
      cell: ({ getValue }) => `${getValue<number>()} min`,
    },
    {
      header: 'Class list',
      accessorKey: 'classListName',
      cell: ({ getValue }) => getValue<string | null>() ?? '—',
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => {
        const exam = row.original;
        const editable = exam.state === 'draft' || exam.state === 'ready';
        return (
          api && (
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDetail(exam)}>
                Questions
              </Button>
              <Button variant="outline" disabled={!editable} onClick={() => setForm({ exam })}>
                Edit
              </Button>
              <Button variant="outline" onClick={() => void run(() => api.duplicate(exam.id))}>
                Duplicate
              </Button>
              <Button
                variant="outline"
                disabled={!editable}
                onClick={() => {
                  if (window.confirm(`Delete "${exam.title}"?`))
                    void run(() => api.remove(exam.id));
                }}
              >
                Delete
              </Button>
            </div>
          )
        );
      },
    },
  ];

  if (detail) {
    return (
      <ExamDetailPage
        exam={detail}
        onBack={() => {
          setDetail(null);
          void reload();
        }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <h1 className="text-3xl font-semibold">Exams</h1>
        {!form && api && <Button onClick={() => setForm({})}>New exam</Button>}
      </header>
      {(error ?? notice) && (
        <p role="alert" className="text-red-700">
          {error ?? notice}
        </p>
      )}
      {form ? (
        <ExamSettingsForm
          key={form.exam?.id ?? 'new'}
          exam={form.exam}
          classLists={lists}
          onSubmit={save}
          onCancel={() => setForm(null)}
        />
      ) : (
        <DataTable columns={columns} data={exams} empty="No exams yet. Create one to start." />
      )}
    </div>
  );
}
