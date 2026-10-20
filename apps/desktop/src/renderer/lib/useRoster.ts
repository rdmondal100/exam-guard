import { useEffect, useState } from 'react';
import {
  EMPTY_ROSTER,
  applyTeacherMessage,
  parseTeacherFrame,
  type RosterState,
} from './rosterState';

export interface RosterView extends RosterState {
  /** `false` while the socket is down; the last known roster stays on screen. */
  live: boolean;
}

const RETRY_MS = 1000;

/** Live roster for one exam over the loopback teacher WebSocket, reconnecting when it drops. */
export function useRoster(examId: string): RosterView {
  const [roster, setRoster] = useState<RosterState>(EMPTY_ROSTER);
  const [live, setLive] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let socket: WebSocket | null = null;
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
      socket = ws;
      ws.onopen = () => {
        setLive(true);
        ws.send(JSON.stringify({ t: 'subscribe', examId }));
      };
      ws.onmessage = (event) => {
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
      if (socket) {
        socket.onclose = null;
        socket.close();
      }
    };
  }, [examId]);

  return { ...roster, live };
}
