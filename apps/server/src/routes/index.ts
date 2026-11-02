import { Router, type RequestHandler } from 'express';
import type { Container } from '../container.js';
import { health } from '../controllers/health.controller.js';
import { jsonBody, largeJsonBody } from '../middlewares/body.middleware.js';
import { auditRoutes } from './audit.routes.js';
import { authRoutes } from './auth.routes.js';
import { classListRoutes } from './classList.routes.js';
import { eventRoutes } from './event.routes.js';
import { examRoutes } from './exam.routes.js';
import { examFileRoutes } from './examFile.routes.js';
import { hostingRoutes } from './hosting.routes.js';
import { questionRoutes } from './question.routes.js';
import { terminalLogRoutes } from './terminalLog.routes.js';
import { thumbRoutes } from './thumb.routes.js';

/**
 * The teacher API under `/api/v1`. `/health` and `/auth/*` need only the token; everything else
 * also needs a logged-in teacher. Hosting, roster and actions exist only with live hosting.
 */
export function teacherRoutes(c: Container, requireLogin: RequestHandler): Router {
  const { now, exams, questions, students, events, terminalLogs, examFiles, screenshots } = c;
  const router = Router();
  // The import carries a whole CSV. Parsed first, so `jsonBody` skips it.
  router.use('/class-lists/import', largeJsonBody);
  router.use(jsonBody);

  router.get('/health', health);
  router.use(authRoutes({ teacher: c.teacher, state: c.state, limiter: c.limiter, now }));
  router.use(classListRoutes({ classLists: c.classLists, now }, requireLogin));
  router.use(
    examRoutes(
      {
        exams,
        questions,
        now,
        ...(examFiles ? { examFiles } : {}),
        ...(screenshots ? { screenshots } : {}),
      },
      requireLogin,
    ),
  );
  if (examFiles) router.use(examFileRoutes({ exams, files: examFiles, now }, requireLogin));
  router.use(questionRoutes({ exams, questions, now }, requireLogin));
  router.use(eventRoutes({ exams, events, ...(screenshots ? { screenshots } : {}) }, requireLogin));
  router.use(terminalLogRoutes({ students, events, terminalLogs }, requireLogin));
  router.use(auditRoutes({ exams, actions: c.actions }, requireLogin));
  if (c.live) {
    router.use(hostingRoutes({ hosting: c.live.hosting, exams, students }, requireLogin));
    router.use(thumbRoutes({ thumbs: c.live.thumbs }, requireLogin));
  }
  return router;
}
