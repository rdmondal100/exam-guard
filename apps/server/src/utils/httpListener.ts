import type { Server } from 'node:http';

export interface HttpListener {
  server: Server;
  /** Resolves once listening; rejects with the socket error (e.g. `EADDRINUSE`). */
  listen(options: { host: string; port: number }): Promise<void>;
  /** Stops listening, drops open connections, then runs the owner's cleanup. */
  close(): Promise<void>;
}

/** Promise-based listen/close around a Node HTTP(S) server. */
export function httpListener(server: Server, cleanup: () => void | Promise<void>): HttpListener {
  return {
    server,
    listen: ({ host, port }) =>
      new Promise((resolve, reject) => {
        const onError = (err: Error) => reject(err);
        server.once('error', onError);
        server.listen(port, host, () => {
          server.off('error', onError);
          resolve();
        });
      }),
    close: async () => {
      if (server.listening) {
        // Live connections must not hold shutdown open.
        await new Promise<void>((resolve) => {
          server.close(() => resolve());
          server.closeAllConnections();
        });
      }
      await cleanup();
    },
  };
}
