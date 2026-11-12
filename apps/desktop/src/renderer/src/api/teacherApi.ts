import {
  ApiErrorSchema,
  AuthOkSchema,
  AuthStatusSchema,
  TEACHER_TOKEN_HEADER,
  type AuthStatus,
  type ServerConnection,
} from '@examguard/shared';
import { z } from 'zod';

/** An error answer from the teacher API (`{ error: { code, message, details } }`). */
export class TeacherApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryAfterSec?: number,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export type FetchFn = typeof fetch;

const RetryDetailsSchema = z.object({ retryAfterSec: z.number() });

/** One teacher API call: GET by default, POST when there is a body, or an explicit method. */
export async function call<T>(
  connection: ServerConnection,
  fetchFn: FetchFn,
  path: string,
  schema: z.ZodType<T>,
  body?: unknown,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE' = body === undefined ? 'GET' : 'POST',
): Promise<T> {
  const res = await fetchFn(`${connection.baseUrl}/api/v1${path}`, {
    method,
    headers: {
      [TEACHER_TOKEN_HEADER]: connection.token,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) throw apiError(res.status, json);
  return schema.parse(json);
}

/** The `TeacherApiError` for a failed answer, from its `{ error: {...} }` body (if it has one). */
export function apiError(status: number, json: unknown): TeacherApiError {
  const parsed = ApiErrorSchema.safeParse(json);
  if (!parsed.success) return new TeacherApiError(status, 'unknown', `HTTP ${status}`);
  const { code, message, details } = parsed.data.error;
  const retry = RetryDetailsSchema.safeParse(details);
  return new TeacherApiError(
    status,
    code,
    message,
    retry.success ? retry.data.retryAfterSec : undefined,
    details,
  );
}

export interface AuthApi {
  status(): Promise<AuthStatus>;
  setup(password: string): Promise<void>;
  login(password: string): Promise<void>;
  logout(): Promise<void>;
}

export function createAuthApi(connection: ServerConnection, fetchFn: FetchFn = fetch): AuthApi {
  return {
    status: () => call(connection, fetchFn, '/auth/status', AuthStatusSchema),
    setup: async (password) => {
      await call(connection, fetchFn, '/auth/setup', AuthOkSchema, { password });
    },
    login: async (password) => {
      await call(connection, fetchFn, '/auth/login', AuthOkSchema, { password });
    },
    logout: async () => {
      await call(connection, fetchFn, '/auth/logout', AuthOkSchema, {});
    },
  };
}
