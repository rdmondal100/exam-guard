import {
  AuthOkSchema,
  ExamsSchema,
  ExamSummarySchema,
  HostingInfoSchema,
  StartResultSchema,
  TerminalActionResultSchema,
  TerminalLogResponseSchema,
  type ExamCreateBody,
  type ExamSummary,
  type ExamUpdateBody,
  type HostingInfo,
  type ServerConnection,
  type StartResult,
  type TerminalActionResult,
  type TerminalLogResponse,
} from '@examguard/shared';
import { call, TeacherApiError, type FetchFn } from './teacherApi';

export interface ExamApi {
  list(): Promise<ExamSummary[]>;
  create(body: ExamCreateBody): Promise<ExamSummary>;
  update(id: string, patch: ExamUpdateBody): Promise<ExamSummary>;
  duplicate(id: string): Promise<ExamSummary>;
  remove(id: string): Promise<void>;
  /** Rejects with a TeacherApiError `not_ready` whose details hold the problems. */
  markReady(id: string): Promise<ExamSummary>;
  backToDraft(id: string): Promise<ExamSummary>;
  /** Opens the student listener. Rejects `not_ready`, `already_hosting` or `port_in_use`. */
  host(id: string): Promise<HostingInfo>;
  stopHosting(id: string): Promise<void>;
  /** hosting → running. Rejects `invalid_state` or `not_found`. */
  start(id: string): Promise<StartResult>;
  /** running → ended, at any time. Rejects `invalid_state` or `not_found`. */
  end(id: string): Promise<void>;
  /** `null` when the exam is not being hosted. */
  hosting(id: string): Promise<HostingInfo | null>;
  /** The exam terminal switch, hosting or running only. `minutes` only when turning it on. */
  setTerminal(id: string, enabled: boolean, minutes?: number): Promise<TerminalActionResult>;
  /** One student's terminal events and transcript, in any exam state. */
  terminalLog(id: string, studentId: string): Promise<TerminalLogResponse>;
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
    host: (id) => call(connection, fetchFn, `${path(id)}/host`, HostingInfoSchema, {}),
    start: (id) => call(connection, fetchFn, `${path(id)}/start`, StartResultSchema, {}),
    end: async (id) => {
      await call(connection, fetchFn, `${path(id)}/end`, AuthOkSchema, {});
    },
    stopHosting: async (id) => {
      await call(connection, fetchFn, `${path(id)}/stop-hosting`, AuthOkSchema, {});
    },
    hosting: async (id) => {
      try {
        return await call(connection, fetchFn, `${path(id)}/hosting`, HostingInfoSchema);
      } catch (e) {
        if (e instanceof TeacherApiError && e.code === 'not_hosting') return null;
        throw e;
      }
    },
    setTerminal: (id, enabled, minutes) =>
      call(connection, fetchFn, `${path(id)}/actions`, TerminalActionResultSchema, {
        type: 'terminal',
        enabled,
        ...(minutes === undefined ? {} : { minutes }),
      }),
    terminalLog: (id, studentId) =>
      call(
        connection,
        fetchFn,
        `${path(id)}/students/${encodeURIComponent(studentId)}/terminal`,
        TerminalLogResponseSchema,
      ),
    remove: async (id) => {
      await call(connection, fetchFn, path(id), AuthOkSchema, undefined, 'DELETE');
    },
  };
}
