import { Router, type RequestHandler } from 'express';
import {
  createExamFileController,
  type ExamFileControllerDeps,
} from '../controllers/examFile.controller.js';
import { rawUpload } from '../middlewares/body.middleware.js';

/**
 * `/exams/:id/files*`: the files the teacher attaches to an exam. The upload is the raw file as
 * `application/octet-stream` with the name in `?name=`, so no base64 and no multipart.
 */
export function examFileRoutes(deps: ExamFileControllerDeps, requireLogin: RequestHandler): Router {
  const files = createExamFileController(deps);
  const router = Router();
  router.get('/exams/:id/files', requireLogin, files.list);
  router.post('/exams/:id/files', requireLogin, rawUpload, files.upload);
  router.delete('/exams/:id/files/:fileId', requireLogin, files.remove);
  return router;
}
