import {
  AuthOkSchema,
  EventsResponseSchema,
  TEACHER_TOKEN_HEADER,
  ExamsSchema,
  ExamSummarySchema,
  HostingInfoSchema,
  InternetActionResultSchema,
  StartResultSchema,
  TerminalActionResultSchema,
  TerminalLogResponseSchema,
  type EventRow,
  type ExamCreateBody,
  type ExamSummary,
  type ExamUpdateBody,
  type HostingInfo,
  type InternetActionResult,
  type ServerConnection,
  type StartResult,
  type TerminalActionResult,
  type TerminalLogResponse,
} from '@examguard/shared';
import { jpegDataUrl } from './eventsView';
import { apiError, call, TeacherApiError, type FetchFn } from './teacherApi';

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
  /** The student internet switch, hosting or running only. `allowed: false` blocks it. */
  setInternet(id: string, allowed: boolean): Promise<InternetActionResult>;
  /** One student's terminal events and transcript, in any exam state. */
  terminalLog(id: string, studentId: string): Promise<TerminalLogResponse>;
  /** What the agents saw, newest first. `after` is the id of the newest event already shown. */
  events(id: string, options?: EventsOptions): Promise<EventRow[]>;
  /** The picture of an event as a `data:` URL; rejects `not_found` when it has none. */
  screenshot(eventId: number): Promise<string>;
}

export interface EventsOptions {
  studentId?: string;
  after?: number;
  limit?: number;
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
    setInternet: (id, allowed) =>
      call(connection, fetchFn, `${path(id)}/actions`, InternetActionResultSchema, {
        type: 'internet',
        enabled: allowed,
      }),
    terminalLog: (id, studentId) =>
      call(
        connection,
        fetchFn,
        `${path(id)}/students/${encodeURIComponent(studentId)}/terminal`,
        TerminalLogResponseSchema,
      ),
    events: async (id, options = {}) => {
      const query = new URLSearchParams({ source: 'agent' });
      if (options.studentId) query.set('studentId', options.studentId);
      if (options.after !== undefined) query.set('after', String(options.after));
      if (options.limit !== undefined) query.set('limit', String(options.limit));
      const response = await call(
        connection,
        fetchFn,
        `${path(id)}/events?${query.toString()}`,
        EventsResponseSchema,
      );
      return response.events;
    },
    screenshot: async (eventId) => {
      const res = await fetchFn(`${connection.baseUrl}/api/v1/screenshots/${eventId}`, {
        headers: { [TEACHER_TOKEN_HEADER]: connection.token },
      });
      if (!res.ok) throw apiError(res.status, await res.json().catch(() => null));
      return jpegDataUrl(await res.arrayBuffer());
    },
    remove: async (id) => {
      await call(connection, fetchFn, path(id), AuthOkSchema, undefined, 'DELETE');
    },
  };
}
