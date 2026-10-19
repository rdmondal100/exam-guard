import { useMemo, useState, type ChangeEvent } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import type { ClassListImportResult, ClassStudentRow, CsvRowError } from '@examguard/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { ClassListApi } from '@/lib/classListApi';
import { DataTable } from './DataTable';

interface Props {
  api: ClassListApi;
  onDone: () => void;
  onCancel: () => void;
}

const studentColumns: ColumnDef<ClassStudentRow>[] = [
  { header: 'Student ID', accessorKey: 'studentCode' },
  { header: 'Name', accessorKey: 'name' },
];

const errorColumns: ColumnDef<CsvRowError>[] = [
  { header: 'Line', accessorKey: 'line' },
  { header: 'Problem', accessorKey: 'message' },
  { header: 'Row', accessorKey: 'raw' },
];

function defaultName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '');
}

/** Pick a CSV, see the valid rows and the rejected ones, then save. Nothing is stored until Import. */
export function ImportPreview({ api, onDone, onCancel }: Props) {
  const [name, setName] = useState('');
  const [csvText, setCsvText] = useState<string | null>(null);
  const [preview, setPreview] = useState<ClassListImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canImport = useMemo(
    () => preview !== null && preview.rows.length > 0 && name.trim() !== '' && !busy,
    [preview, name, busy],
  );

  const pickFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const listName = name.trim() === '' ? defaultName(file.name) : name;
    setName(listName);
    setCsvText(text);
    setPreview(null);
    setError(null);
    try {
      setPreview(await api.preview(listName, text));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const save = async () => {
    if (csvText === null) return;
    setBusy(true);
    setError(null);
    try {
      await api.import(name, csvText);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <section className="flex flex-col gap-4" aria-label="Import class list">
      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1">
          CSV file (student ID, name)
          <input type="file" accept=".csv,text/csv,text/plain" onChange={(e) => void pickFile(e)} />
        </label>
        <label className="flex min-w-64 flex-col gap-1">
          List name
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
        </label>
      </div>

      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}

      {preview && (
        <>
          <p>
            <strong>{preview.rows.length}</strong> students will be imported
            {preview.errors.length > 0 && (
              <>
                , <strong className="text-red-700">{preview.errors.length}</strong> rows have
                problems and will be skipped
              </>
            )}
            .
          </p>
          {preview.errors.length > 0 && (
            <DataTable columns={errorColumns} data={preview.errors} maxHeight="max-h-56" />
          )}
          <DataTable columns={studentColumns} data={preview.rows} maxHeight="max-h-72" />
        </>
      )}

      <div className="flex gap-2">
        <Button disabled={!canImport} onClick={() => void save()}>
          Import {preview ? preview.rows.length : ''} students
        </Button>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </section>
  );
}
