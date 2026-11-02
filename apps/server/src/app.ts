import { createServer } from 'node:http';
import express, { type Express, type RequestHandler } from 'express';
import { createContainer, type ContainerOptions } from './container.js';
import { cors } from './middlewares/cors.middleware.js';
import { errorHandler, notFound } from './middlewares/error.middleware.js';
import { requireLogin as requireLoginFor } from './middlewares/requireLogin.middleware.js';
import { tokenMatches, verifyTeacherToken } from './middlewares/teacherToken.middleware.js';
import { teacherRoutes } from './routes/index.js';
import type { GradingService } from './services/grading/grading-service.js';
import type { HostingManager } from './services/hosting/hosting-manager.js';
import { onTeacherSocket } from './sockets/teacher.socket.js';
import { attachWebSocket } from './sockets/wsServer.js';
import { httpListener, type HttpListener } from './utils/httpListener.js';

export interface TeacherAppOptions extends ContainerOptions {
  /** Per-launch token every call must carry. */
  token: string;
}

export interface TeacherApp extends HttpListener {
  app: Express;
  /** Middleware for every route that needs a logged-in teacher. */
  requireLogin: RequestHandler;
  /** Present when `hosting` options were given. */
  hosting?: HostingManager;
  /** AI grading (M38): `resume()` after a restart. */
  grading: GradingService;
}

/**
 * Loopback API for the teacher UI. Every route needs the per-launch token; routes other than
 * `/health` and `/auth/*` also need a logged-in teacher.
 */
export function buildTeacherApp({ token, ...options }: TeacherAppOptions): TeacherApp {
  const c = createContainer(options);
  const requireLogin = requireLoginFor(c.state);

  const app = express();
  app.disable('x-powered-by');
  app.set('etag', false);
  app.use(cors);
  app.use(verifyTeacherToken(token));
  app.use('/api/v1', teacherRoutes(c, requireLogin));
  app.use(notFound);
  app.use(errorHandler);

  const server = createServer(app);
  const live = c.live;
  const ws =
    live &&
    attachWebSocket(server, {}, (socket, request) =>
      onTeacherSocket(socket, request, {
        hub: live.hub,
        thumbs: live.thumbs,
        allowed: (req) =>
          c.state.isLoggedIn() &&
          tokenMatches(token, new URL(req.url ?? '', 'http://x').searchParams.get('token')),
      }),
    );

  const listener = httpListener(server, async () => {
    c.grading.dispose();
    if (!live) return;
    await live.hosting.close();
    live.connections.reset();
    live.hub.dispose();
  });
  return {
    ...listener,
    close: async () => {
      ws?.close();
      await listener.close();
    },
    app,
    requireLogin,
    grading: c.grading,
    ...(live ? { hosting: live.hosting } : {}),
  };
}
