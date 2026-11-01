import { Router, type RequestHandler } from 'express';
import {
  createClassListController,
  type ClassListControllerDeps,
} from '../controllers/classList.controller.js';

/** `/class-lists*`. The import's 2 MB body parser is mounted in `routes/index.ts`. */
export function classListRoutes(
  deps: ClassListControllerDeps,
  requireLogin: RequestHandler,
): Router {
  const classLists = createClassListController(deps);
  const router = Router();
  router.get('/class-lists', requireLogin, classLists.list);
  router.post('/class-lists/import', requireLogin, classLists.import);
  router.get('/class-lists/:id/students', requireLogin, classLists.students);
  router.delete('/class-lists/:id', requireLogin, classLists.remove);
  return router;
}
