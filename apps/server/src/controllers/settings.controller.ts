import type { Request, Response } from 'express';
import { SettingsPatchSchema } from '@examguard/shared';
import type { MaintenanceService } from '../services/settings/maintenance-service.js';
import type { SettingsService } from '../services/settings/settings-service.js';
import { ApiError } from '../utils/ApiError.js';

export interface SettingsControllerDeps {
  settings: SettingsService;
  maintenance: MaintenanceService;
}

/** The Settings screen (M43): settings, manual backup and the certificate. */
export function createSettingsController({ settings, maintenance }: SettingsControllerDeps) {
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
