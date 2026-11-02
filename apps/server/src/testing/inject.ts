import type { Express } from 'express';
import request from 'supertest';

export interface InjectOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE' | 'OPTIONS';
  url: string;
  headers?: Record<string, string>;
  /** An object is sent as JSON, a string or a Buffer as it is. */
  payload?: object | Buffer | string;
}

export interface InjectResponse {
  statusCode: number;
  headers: Record<string, string | undefined>;
  body: string;
  rawPayload: Buffer;
  /** The body parsed as JSON (tests read fields off it freely). */
  json: () => ReturnType<typeof JSON.parse>;
}

/** Test-only: a request against an Express app without opening a port, via supertest. */
export async function inject(app: Express, options: InjectOptions): Promise<InjectResponse> {
  const method = (options.method ?? 'GET').toLowerCase() as Lowercase<
    NonNullable<InjectOptions['method']>
  >;
  let test = request(app)[method](options.url);
  for (const [name, value] of Object.entries(options.headers ?? {})) test = test.set(name, value);
  if (options.payload !== undefined) test = test.send(options.payload);
  const res = await test.buffer(true).parse((stream, done) => {
    const chunks: Buffer[] = [];
    const body = stream as unknown as NodeJS.ReadableStream;
    body.on('data', (chunk: Buffer) => chunks.push(chunk));
    body.on('end', () => done(null, Buffer.concat(chunks)));
  });
  const rawPayload: Buffer = Buffer.isBuffer(res.body) ? res.body : Buffer.alloc(0);
  const text = rawPayload.toString('utf8');
  return {
    statusCode: res.status,
    headers: res.headers as Record<string, string | undefined>,
    body: text,
    rawPayload,
    json: () => JSON.parse(text),
  };
}

/** A built app with `inject()` added. */
export type Injectable<T> = T & { inject: (options: InjectOptions) => Promise<InjectResponse> };

/** Adds `inject()` to a built app, so a test reads like `app.inject({ url })`. */
export function withInject<T extends { app: Express }>(built: T): Injectable<T> {
  return { ...built, inject: (options) => inject(built.app, options) };
}
