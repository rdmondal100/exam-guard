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
  ) {
    super(message);
  }
}

type FetchFn = typeof fetch;

const RetryDetailsSchema = z.object({ retryAfterSec: z.number() });

async function call<T>(
  connection: ServerConnection,
  fetchFn: FetchFn,
  path: string,
  schema: z.ZodType<T>,
  body?: unknown,
): Promise<T> {
  const res = await fetchFn(`${connection.baseUrl}/api/v1${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      [TEACHER_TOKEN_HEADER]: connection.token,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const parsed = ApiErrorSchema.safeParse(json);
    if (!parsed.success) throw new TeacherApiError(res.status, 'unknown', `HTTP ${res.status}`);
    const { code, message, details } = parsed.data.error;
    const retry = RetryDetailsSchema.safeParse(details);
    throw new TeacherApiError(
      res.status,
      code,
      message,
      retry.success ? retry.data.retryAfterSec : undefined,
    );
  }
  return schema.parse(json);
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
