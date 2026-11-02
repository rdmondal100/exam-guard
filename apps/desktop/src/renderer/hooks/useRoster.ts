import { useCallback, useEffect, useRef, useState } from 'react';
import {
  EMPTY_ROSTER,
  applyTeacherMessage,
  parseTeacherFrame,
  type RosterState,
} from '../lib/rosterState';
import { ThumbStore } from '../lib/thumbStore';
import { watchKey } from '../lib/thumbGrid';

export interface RosterView extends RosterState {
  /** `false` while the socket is down; the last known roster stays on screen. */
  live: boolean;
  /** Counts socket (re)connects, so lists can fetch what they missed while it was down. */
  connects: number;
  /** Grid thumbnails that arrived on this socket (M33). */
  thumbs: ThumbStore;
  /** The students on the visible grid page; `[]` stops every stream. Re-sent after a reconnect. */
  watchThumbs(ids: readonly string[]): void;
  /** The students whose fast thumbnail is open (M34 fallback, at most 2); `[]` ends it. */
  focusThumbs(ids: readonly string[]): void;
}

const RETRY_MS = 1000;

function sendIds(
  ws: WebSocket | null,
  t: 'thumbs.subscribe' | 'thumbs.focus',
  ids: readonly string[],
): void {
  if (ws?.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ t, examStudentIds: ids }));
}

/**
 * Live roster, alerts, grid thumbnails and fast thumbnails for one exam over the loopback teacher WebSocket,
 * reconnecting when it drops. With `enabled` false no socket is opened.
 */
export function useRoster(examId: string, enabled = true): RosterView {
  const [roster, setRoster] = useState<RosterState>(EMPTY_ROSTER);
  const [live, setLive] = useState(false);
  const [connects, setConnects] = useState(0);
  const [thumbs] = useState(() => new ThumbStore());
  const socketRef = useRef<WebSocket | null>(null);
  /** The page the grid wants, kept so a new socket asks for it again. */
  const watching = useRef<readonly string[]>([]);
  /** The fast thumbnails that are open, also re-sent on a new socket. */
  const focusing = useRef<readonly string[]>([]);

  const watchThumbs = useCallback((ids: readonly string[]) => {
    if (watchKey(ids) === watchKey(watching.current)) return;
    watching.current = [...ids];
    sendIds(socketRef.current, 'thumbs.subscribe', watching.current);
  }, []);

  const focusThumbs = useCallback((ids: readonly string[]) => {
    if (watchKey(ids) === watchKey(focusing.current)) return;
    focusing.current = [...ids];
    sendIds(socketRef.current, 'thumbs.focus', focusing.current);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | null = null;
    setRoster(EMPTY_ROSTER);

    const open = async () => {
      const connection = await window.examguard.getServerConnection().catch(() => null);
      if (cancelled) return;
      if (!connection) return void (retry = setTimeout(() => void open(), RETRY_MS));
      const url = new URL('/ws', connection.baseUrl);
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      url.searchParams.set('token', connection.token);
      const ws = new WebSocket(url);
      ws.binaryType = 'arraybuffer';
      socketRef.current = ws;
      ws.onopen = () => {
        setLive(true);
        setConnects((n) => n + 1);
        ws.send(JSON.stringify({ t: 'subscribe', examId }));
        if (watching.current.length > 0) sendIds(ws, 'thumbs.subscribe', watching.current);
        if (focusing.current.length > 0) sendIds(ws, 'thumbs.focus', focusing.current);
      };
      ws.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) return void thumbs.addFrame(event.data);
        const message = typeof event.data === 'string' ? parseTeacherFrame(event.data) : null;
        if (message) setRoster((current) => applyTeacherMessage(current, message));
      };
      ws.onclose = () => {
        setLive(false);
        if (!cancelled) retry = setTimeout(() => void open(), RETRY_MS);
      };
    };
    void open();

    return () => {
      cancelled = true;
      if (retry) clearTimeout(retry);
      const socket = socketRef.current;
      socketRef.current = null;
      if (socket) {
        socket.onclose = null;
        socket.close();
      }
      thumbs.clear();
    };
  }, [examId, enabled, thumbs]);

  return { ...roster, live, connects, thumbs, watchThumbs, focusThumbs };
}
