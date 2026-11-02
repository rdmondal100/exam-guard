import { Router, type RequestHandler } from 'express';
import {
  createAuditController,
  type AuditControllerDeps,
} from '../controllers/audit.controller.js';

/** `GET /exams/:id/actions`: the teacher action log (M36). */
export function auditRoutes(deps: AuditControllerDeps, requireLogin: RequestHandler): Router {
  const audit = createAuditController(deps);
  const router = Router();
  router.get('/exams/:id/actions', requireLogin, audit.list);
  return router;
}
