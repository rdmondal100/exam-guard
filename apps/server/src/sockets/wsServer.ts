import type { IncomingMessage, Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';

export interface WsOptions {
  /** Largest frame a client may send. */
  maxPayload?: number;
}

/**
 * Serves `/ws` on an HTTP(S) server: the upgrade never reaches Express. Any other upgrade path
 * gets a 404. `close()` closes every socket, like the HTTP listener's own shutdown.
 */
export function attachWebSocket(
  server: Server,
  options: WsOptions,
  onConnection: (socket: WebSocket, request: IncomingMessage) => void,
): { close(): void } {
  const wss = new WebSocketServer({ noServer: true, ...options });
  server.on('upgrade', (request, socket, head) => {
    if ((request.url ?? '').split('?', 1)[0] !== '/ws') {
      socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => onConnection(ws, request));
  });
  return {
    close() {
      for (const client of wss.clients) client.close();
      wss.close();
    },
  };
}
