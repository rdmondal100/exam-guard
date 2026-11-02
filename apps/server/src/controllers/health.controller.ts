import type { Request, Response } from 'express';
import { PROTOCOL_VERSION } from '@examguard/shared';

/** `GET /health`: the teacher UI's liveness check. */
export function health(_req: Request, res: Response): void {
  res.json({ status: 'ok', protocol: PROTOCOL_VERSION, uptimeSec: Math.round(process.uptime()) });
}
