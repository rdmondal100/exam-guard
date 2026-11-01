import { Router, type RequestHandler } from 'express';
import {
  createTerminalLogController,
  type TerminalLogControllerDeps,
} from '../controllers/terminalLog.controller.js';

/** `GET /exams/:id/students/:sid/terminal`: a student's terminal log. */
export function terminalLogRoutes(
  deps: TerminalLogControllerDeps,
  requireLogin: RequestHandler,
): Router {
  const terminalLog = createTerminalLogController(deps);
  const router = Router();
  router.get('/exams/:id/students/:sid/terminal', requireLogin, terminalLog.get);
  return router;
}
