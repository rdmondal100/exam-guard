import { Router, type RequestHandler } from 'express';
import {
  createEventController,
  type EventControllerDeps,
} from '../controllers/event.controller.js';

/** `/exams/:id/events` and, when screenshots are stored, `/screenshots/:eventId`. */
export function eventRoutes(deps: EventControllerDeps, requireLogin: RequestHandler): Router {
  const events = createEventController(deps);
  const router = Router();
  router.get('/exams/:id/events', requireLogin, events.list);
  if (deps.screenshots) router.get('/screenshots/:eventId', requireLogin, events.screenshot);
  return router;
}
