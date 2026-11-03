import type { Request, Response } from 'express';
import { SettingsPatchSchema, type RetentionPurgeResult } from '@examguard/shared';
import type { ScreenshotRetention } from '../services/screenshots/screenshot-retention.js';
import type { MaintenanceService } from '../services/settings/maintenance-service.js';
import type { SettingsService } from '../services/settings/settings-service.js';
import { ApiError } from '../utils/ApiError.js';

export interface SettingsControllerDeps {
  settings: SettingsService;
  maintenance: MaintenanceService;
  /** Screenshot retention (M44); absent without a data folder. */
  retention?: ScreenshotRetention;
}

/** The Settings screen (M43): settings, manual backup, the certificate and retention (M44). */
export function createSettingsController({
  settings,
  maintenance,
  retention,
}: SettingsControllerDeps) {
  return {
    get(_req: Request, res: Response): void {
      res.json(settings.get());
    },

    update(req: Request, res: Response): void {
      const body = SettingsPatchSchema.safeParse(req.body);
      if (!body.success) {
        throw new ApiError(400, 'invalid_body', 'Invalid settings', {
          problems: body.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
        });
      }
      res.json(settings.update(body.data));
    },

    /** Applies the retention setting now instead of at the next start. */
    purgeScreenshots(_req: Request, res: Response): void {
      const result: RetentionPurgeResult = { removed: retention?.purge() ?? 0 };
      res.json(result);
    },

    async backup(_req: Request, res: Response): Promise<void> {
      res.json(await maintenance.backup());
    },

    async cert(_req: Request, res: Response): Promise<void> {
      res.json(await maintenance.cert());
    },

    async regenerateCert(_req: Request, res: Response): Promise<void> {
      res.json(await maintenance.regenerateCert());
    },
  };
}
