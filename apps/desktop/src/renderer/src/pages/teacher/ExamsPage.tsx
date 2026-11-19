import { useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { CopyIcon, MoreHorizontalIcon, PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import type { ExamSummary } from '@examguard/shared';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { TeacherApiError } from '@/api/teacherApi';
import { useClassLists } from '@/hooks/useClassLists';
import { useConfirm } from '@/hooks/useConfirm';
import { useExams } from '@/hooks/useExams';
import { useSettings } from '@/hooks/useSettings';
import { ErrorAlert } from '../../components/common/ErrorAlert';
import { PageHeader } from '../../components/common/PageHeader';
import { DataTable } from '../../components/teacher/DataTable';
import { ExamStateBadge, PracticeBadge } from '../../components/teacher/ExamStateBadge';
import { ExamDetailPage } from './ExamDetailPage';
import { ExamSettingsForm, type ExamFormValues } from '../../components/teacher/ExamSettingsForm';

function actionMessage(e: unknown): string {
  if (e instanceof TeacherApiError && e.code === 'invalid_state') {
    return 'Only draft or ready exams can be changed or deleted.';
  }
  return e instanceof Error ? e.message : String(e);
}

/** Exam list with create, edit settings, duplicate and delete. */
export function ExamsPage() {
  const { api, exams, error, reload } = useExams();
  // The teacher's defaults for a new exam (Settings, M43).
  const { settings } = useSettings();
  const { lists } = useClassLists();
  const confirm = useConfirm();
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

  /** Asks first, then runs the action. */
  const confirmRun = async (
    title: string,
    confirmLabel: string,
    action: () => Promise<unknown>,
  ) => {
    if (await confirm({ title, confirmLabel, destructive: true })) await run(action);
  };

  const save = async (values: ExamFormValues) => {
    if (!api) return;
    if (form?.exam) await api.update(form.exam.id, values);
    else await api.create(values);
    setForm(null);
    await reload();
  };

  const columns: ColumnDef<ExamSummary>[] = [
    {
      header: 'Title',
      accessorKey: 'title',
      cell: ({ row }) => (
        <button
          type="button"
          className="font-medium hover:underline"
          onClick={() => setDetail(row.original)}
        >
          {row.original.title}
        </button>
      ),
    },
    {
      id: 'kind',
      header: '',
      cell: ({ row }) => (row.original.practice ? <PracticeBadge /> : null),
    },
    {
      header: 'State',
      accessorKey: 'state',
      cell: ({ getValue }) => <ExamStateBadge state={getValue<ExamSummary['state']>()} />,
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
        if (!api) return null;
        return (
          <div className="flex items-center justify-end gap-2">
            {exam.state === 'hosting' && (
              <Button
                size="sm"
                variant="outline-destructive"
                onClick={() =>
                  void confirmRun(`Stop hosting "${exam.title}"?`, 'Stop hosting', () =>
                    api.stopHosting(exam.id),
                  )
                }
              >
                Stop hosting
              </Button>
            )}
            {exam.state === 'running' && (
              <Button
                size="sm"
                variant="destructive"
                onClick={() =>
                  void confirmRun(`End "${exam.title}" now for all students?`, 'End exam', () =>
                    api.end(exam.id),
                  )
                }
              >
                End exam
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => setDetail(exam)}>
              Open
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`More actions for ${exam.title}`}
                >
                  <MoreHorizontalIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem disabled={!editable} onSelect={() => setForm({ exam })}>
                  <PencilIcon />
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void run(() => api.duplicate(exam.id))}>
                  <CopyIcon />
                  Duplicate
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  disabled={!editable}
                  onSelect={() =>
                    void confirmRun(`Delete "${exam.title}"?`, 'Delete', () => api.remove(exam.id))
                  }
                >
                  <Trash2Icon />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
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
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <PageHeader
        title={form ? (form.exam ? 'Edit exam' : 'New exam') : 'Exams'}
        description={
          form ? undefined : 'Create exams, host them for a class and grade the answers.'
        }
        actions={
          !form &&
          api && (
            <Button onClick={() => setForm({})}>
              <PlusIcon />
              New exam
            </Button>
          )
        }
      />
      {(error ?? notice) && <ErrorAlert>{error ?? notice}</ErrorAlert>}
      {form ? (
        <ExamSettingsForm
          key={form.exam?.id ?? 'new'}
          exam={form.exam}
          classLists={lists}
          defaults={settings?.defaults}
          onSubmit={save}
          onCancel={() => setForm(null)}
        />
      ) : (
        <DataTable columns={columns} data={exams} empty="No exams yet. Create one to start." />
      )}
    </div>
  );
}
