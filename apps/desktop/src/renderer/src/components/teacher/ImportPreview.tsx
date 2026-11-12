import { useMemo, useState, type ChangeEvent } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { TriangleAlertIcon } from 'lucide-react';
import type { ClassListImportResult, ClassStudentRow, CsvRowError } from '@examguard/shared';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import type { ClassListApi } from '@/api/classListApi';
import { ErrorAlert } from '../common/ErrorAlert';
import { FormField } from '../common/FormField';
import { Spinner } from '../common/Spinner';
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
    <Card aria-label="Import class list">
      <CardHeader>
        <CardTitle>Import a class list</CardTitle>
        <CardDescription>Nothing is saved until you press Import.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-4 md:grid-cols-2">
          <FormField label="CSV file (student ID, name)">
            <Input
              type="file"
              accept=".csv,text/csv,text/plain"
              onChange={(e) => void pickFile(e)}
            />
          </FormField>
          <FormField label="List name">
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
          </FormField>
        </div>

        {error && <ErrorAlert>{error}</ErrorAlert>}

        {preview && (
          <>
            <p className="text-sm">
              <strong>{preview.rows.length}</strong> students will be imported
              {preview.errors.length > 0 && (
                <>
                  , <strong className="text-destructive">{preview.errors.length}</strong> rows have
                  problems and will be skipped
                </>
              )}
              .
            </p>
            {preview.errors.length > 0 && (
              <>
                <Alert variant="warning" role="status">
                  <TriangleAlertIcon />
                  <AlertDescription>These rows are skipped:</AlertDescription>
                </Alert>
                <DataTable columns={errorColumns} data={preview.errors} maxHeight="max-h-56" />
              </>
            )}
            <DataTable columns={studentColumns} data={preview.rows} maxHeight="max-h-72" />
          </>
        )}
      </CardContent>
      <CardFooter>
        <Button disabled={!canImport} onClick={() => void save()}>
          {busy && <Spinner />}
          Import {preview ? preview.rows.length : ''} students
        </Button>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </CardFooter>
    </Card>
  );
}
