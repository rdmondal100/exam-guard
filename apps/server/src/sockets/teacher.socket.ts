import type { IncomingMessage } from 'node:http';
import type { RawData, WebSocket } from 'ws';
import { TeacherMessageSchema, type ServerToTeacher } from '@examguard/shared';
import type { SessionHub } from './sessionHub.js';
import type { ThumbRelay, ThumbViewer } from './thumbRelay.js';
import type { LiveRelay, LiveViewer } from './liveRelay.js';

export interface TeacherSocketDeps {
  hub: SessionHub;
  /** Grid thumbnails for the visible page (M29, M33) and the fast thumbnail (M34). */
  thumbs?: Pick<ThumbRelay, 'watch' | 'focus' | 'unwatch'>;
  /** WebRTC live view signaling (M30, M34). */
  liveViews?: Pick<LiveRelay, 'open' | 'close' | 'fromTeacher' | 'closeViewer'>;
  /** Per-launch token (query string) and a logged-in teacher, the same bar as the HTTP routes. */
  allowed: (request: IncomingMessage) => boolean;
  /** Registers a callback for the teacher's logout; the socket closes then (M59). */
  onLogout?: (listener: () => void) => () => void;
}

/** A teacher socket this far behind skips thumbnails until it catches up. */
const MAX_BUFFERED_BYTES = 2 * 1024 * 1024;

const text = (data: RawData): string =>
  Array.isArray(data)
    ? Buffer.concat(data).toString('utf8')
    : Buffer.from(data as Buffer).toString('utf8');

/**
 * `GET /ws?token=…` on the loopback teacher API. A browser WebSocket cannot set the token
 * header, so the token is in the query string. A refused socket is closed with 4401 after the
 * upgrade (an HTTP-level refusal would leave the upgrade half open).
 */
export function onTeacherSocket(
  socket: WebSocket,
  request: IncomingMessage,
  { hub, thumbs, liveViews, allowed, onLogout }: TeacherSocketDeps,
): void {
  if (!allowed(request)) {
    socket.close(4401, 'unauthorized');
    return;
  }
  let unsubscribe: (() => void) | null = null;
  const send = (message: ServerToTeacher) => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
  };
  const viewer: ThumbViewer = {
    sendBinary: (frame) => {
      if (socket.readyState !== socket.OPEN || socket.bufferedAmount > MAX_BUFFERED_BYTES) return;
      socket.send(frame, { binary: true });
    },
  };
  const liveViewer: LiveViewer = { send };
  const offLogout = onLogout?.(() => socket.close(4401, 'logged_out'));

  const handle = (data: RawData) => {
    let parsed;
    try {
      parsed = TeacherMessageSchema.safeParse(JSON.parse(text(data)));
    } catch {
      return socket.close(4400, 'bad_frame');
    }
    if (!parsed.success) return socket.close(4400, 'bad_frame');
    const message = parsed.data;
    if (message.t === 'thumbs.subscribe') return thumbs?.watch(viewer, message.examStudentIds);
    if (message.t === 'thumbs.focus') return thumbs?.focus(viewer, message.examStudentIds);
    if (message.t === 'live.open') return liveViews?.open(liveViewer, message.examStudentId);
    if (message.t === 'live.close') return liveViews?.close(liveViewer, message.sessionId);
    if (message.t === 'rtc.signal') {
      return liveViews?.fromTeacher(liveViewer, message.sessionId, message.data);
    }
    // A new subscribe replaces the previous one.
    unsubscribe?.();
    unsubscribe = hub.subscribe({ examId: message.examId, send });
  };

  socket.on('message', (data: RawData) => {
    try {
      handle(data);
    } catch (error) {
      // One failing frame must not take the server down (M62).
      console.error('[teacher socket] frame failed', error);
    }
  });
  socket.on('close', () => {
    offLogout?.();
    unsubscribe?.();
    thumbs?.unwatch(viewer);
    liveViews?.closeViewer(liveViewer);
  });
  socket.on('error', () => socket.terminate());
}
