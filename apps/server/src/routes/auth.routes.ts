import { Router } from 'express';
import { createAuthController, type AuthControllerDeps } from '../controllers/auth.controller.js';

/** `/auth/*`: open to anyone with the teacher token, logged in or not. */
export function authRoutes(deps: AuthControllerDeps): Router {
  const auth = createAuthController(deps);
  const router = Router();
  router.get('/auth/status', auth.status);
  router.post('/auth/setup', auth.setup);
  router.post('/auth/login', auth.login);
  router.post('/auth/logout', auth.logout);
  return router;
}
