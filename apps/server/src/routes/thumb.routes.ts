import { Router, type RequestHandler } from 'express';
import {
  createThumbController,
  type ThumbControllerDeps,
} from '../controllers/thumb.controller.js';

/** `GET /thumbs/stats`: the thumbnail relay's counters. */
export function thumbRoutes(deps: ThumbControllerDeps, requireLogin: RequestHandler): Router {
  const thumb = createThumbController(deps);
  const router = Router();
  router.get('/thumbs/stats', requireLogin, thumb.stats);
  return router;
}
