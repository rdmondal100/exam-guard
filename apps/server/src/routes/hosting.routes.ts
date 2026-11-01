import { Router, type RequestHandler } from 'express';
import {
  createHostingController,
  type HostingControllerDeps,
} from '../controllers/hosting.controller.js';

/** Hosting and running an exam: host, stop, start, end, info, roster and actions. */
export function hostingRoutes(deps: HostingControllerDeps, requireLogin: RequestHandler): Router {
  const hosting = createHostingController(deps);
  const router = Router();
  router.post('/exams/:id/host', requireLogin, hosting.host);
  router.post('/exams/:id/stop-hosting', requireLogin, hosting.stopHosting);
  router.post('/exams/:id/start', requireLogin, hosting.start);
  router.post('/exams/:id/end', requireLogin, hosting.end);
  router.get('/exams/:id/hosting', requireLogin, hosting.info);
  router.get('/exams/:id/roster', requireLogin, hosting.roster);
  router.post('/exams/:id/actions', requireLogin, hosting.action);
  return router;
}
