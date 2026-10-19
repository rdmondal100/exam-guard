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
  /** Rejects with a TeacherApiError `not_ready` whose details hold the problems. */
  markReady(id: string): Promise<ExamSummary>;
  backToDraft(id: string): Promise<ExamSummary>;
}

export function createExamApi(connection: ServerConnection, fetchFn: FetchFn = fetch): ExamApi {
  const path = (id: string) => `/exams/${encodeURIComponent(id)}`;
  return {
    list: () => call(connection, fetchFn, '/exams', ExamsSchema),
    create: (body) => call(connection, fetchFn, '/exams', ExamSummarySchema, body),
    update: (id, patch) => call(connection, fetchFn, path(id), ExamSummarySchema, patch, 'PATCH'),
    duplicate: (id) => call(connection, fetchFn, `${path(id)}/duplicate`, ExamSummarySchema, {}),
    markReady: (id) => call(connection, fetchFn, `${path(id)}/ready`, ExamSummarySchema, {}),
    backToDraft: (id) => call(connection, fetchFn, `${path(id)}/unready`, ExamSummarySchema, {}),
    remove: async (id) => {
      await call(connection, fetchFn, path(id), AuthOkSchema, undefined, 'DELETE');
    },
  };
}
