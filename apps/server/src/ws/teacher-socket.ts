import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { RawData, WebSocket } from 'ws';
import { TeacherMessageSchema, type ServerToTeacher } from '@examguard/shared';
import type { SessionHub } from './session-hub.js';

export interface TeacherSocketDeps {
  hub: SessionHub;
  /** Per-launch token (query string) and a logged-in teacher, the same bar as the HTTP routes. */
  allowed: (request: FastifyRequest) => boolean;
}

const text = (data: RawData): string =>
  Array.isArray(data)
    ? Buffer.concat(data).toString('utf8')
    : Buffer.from(data as Buffer).toString('utf8');

/**
 * `GET /ws?token=…` on the loopback teacher API. A browser WebSocket cannot set the token
 * header, so the token is in the query string. A refused socket is closed with 4401 after the
 * upgrade (an HTTP-level refusal would leave the upgrade half open).
 */
export function registerTeacherSocket(
  app: FastifyInstance,
  { hub, allowed }: TeacherSocketDeps,
): void {
  app.get('/ws', { websocket: true }, (socket: WebSocket, request) => {
    if (!allowed(request)) {
      socket.close(4401, 'unauthorized');
      return;
    }
    let unsubscribe: (() => void) | null = null;
    const send = (message: ServerToTeacher) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
    };

    socket.on('message', (data: RawData) => {
      let parsed;
      try {
        parsed = TeacherMessageSchema.safeParse(JSON.parse(text(data)));
      } catch {
        return socket.close(4400, 'bad_frame');
      }
      if (!parsed.success) return socket.close(4400, 'bad_frame');
      // A new subscribe replaces the previous one.
      unsubscribe?.();
      unsubscribe = hub.subscribe({ examId: parsed.data.examId, send });
    });
    socket.on('close', () => unsubscribe?.());
    socket.on('error', () => socket.terminate());
  });
}
