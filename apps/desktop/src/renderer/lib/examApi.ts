import {
  AuthOkSchema,
  ExamsSchema,
  ExamSummarySchema,
  type ExamCreateBody,
  type ExamSummary,
  type ExamUpdateBody,
  type ServerConnection,
} from '@examguard/shared';
import { call, type FetchFn } from './teacherApi';

export interface ExamApi {
  list(): Promise<ExamSummary[]>;
  create(body: ExamCreateBody): Promise<ExamSummary>;
  update(id: string, patch: ExamUpdateBody): Promise<ExamSummary>;
  duplicate(id: string): Promise<ExamSummary>;
  remove(id: string): Promise<void>;
}

export function createExamApi(connection: ServerConnection, fetchFn: FetchFn = fetch): ExamApi {
  const path = (id: string) => `/exams/${encodeURIComponent(id)}`;
  return {
    list: () => call(connection, fetchFn, '/exams', ExamsSchema),
    create: (body) => call(connection, fetchFn, '/exams', ExamSummarySchema, body),
    update: (id, patch) => call(connection, fetchFn, path(id), ExamSummarySchema, patch, 'PATCH'),
    duplicate: (id) => call(connection, fetchFn, `${path(id)}/duplicate`, ExamSummarySchema, {}),
    remove: async (id) => {
      await call(connection, fetchFn, path(id), AuthOkSchema, undefined, 'DELETE');
    },
  };
}
