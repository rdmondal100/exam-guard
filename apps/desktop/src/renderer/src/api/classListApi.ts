import {
  AuthOkSchema,
  ClassListImportResultSchema,
  ClassListsSchema,
  ClassStudentsSchema,
  type ClassListImportResult,
  type ClassListSummary,
  type ClassStudentRow,
  type ServerConnection,
} from '@examguard/shared';
import { call, type FetchFn } from './teacherApi';

export interface ClassListApi {
  list(): Promise<ClassListSummary[]>;
  /** Parses on the server and writes nothing. */
  preview(name: string, csvText: string): Promise<ClassListImportResult>;
  import(name: string, csvText: string): Promise<ClassListImportResult>;
  students(id: string): Promise<ClassStudentRow[]>;
  remove(id: string): Promise<void>;
}

export function createClassListApi(
  connection: ServerConnection,
  fetchFn: FetchFn = fetch,
): ClassListApi {
  const importList = (name: string, csvText: string, dryRun: boolean) =>
    call(connection, fetchFn, '/class-lists/import', ClassListImportResultSchema, {
      name,
      csvText,
      dryRun,
    });
  return {
    list: () => call(connection, fetchFn, '/class-lists', ClassListsSchema),
    preview: (name, csvText) => importList(name, csvText, true),
    import: (name, csvText) => importList(name, csvText, false),
    students: (id) =>
      call(
        connection,
        fetchFn,
        `/class-lists/${encodeURIComponent(id)}/students`,
        ClassStudentsSchema,
      ),
    remove: async (id) => {
      await call(
        connection,
        fetchFn,
        `/class-lists/${encodeURIComponent(id)}`,
        AuthOkSchema,
        undefined,
        'DELETE',
      );
    },
  };
}
