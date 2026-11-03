import { Router, type RequestHandler } from 'express';
import {
  createSettingsController,
  type SettingsControllerDeps,
} from '../controllers/settings.controller.js';

/** Settings (M43) and screenshot retention (M44). */
export function settingsRoutes(deps: SettingsControllerDeps, requireLogin: RequestHandler): Router {
  const settings = createSettingsController(deps);
  const router = Router();
  router.get('/settings', requireLogin, settings.get);
  router.patch('/settings', requireLogin, settings.update);
  router.post('/settings/backup', requireLogin, settings.backup);
  router.post('/settings/retention/purge', requireLogin, settings.purgeScreenshots);
  router.get('/settings/cert', requireLogin, settings.cert);
  router.post('/settings/regenerate-cert', requireLogin, settings.regenerateCert);
  return router;
}
