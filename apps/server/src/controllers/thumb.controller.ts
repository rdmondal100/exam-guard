import type { Request, Response } from 'express';
import type { ThumbStats } from '@examguard/shared';
import type { ThumbRelay } from '../sockets/thumbRelay.js';

export interface ThumbControllerDeps {
  thumbs: Pick<ThumbRelay, 'stats'>;
}

/** The thumbnail relay's counters: who streams, frames and bytes in and out (M29, M33). */
export function createThumbController({ thumbs }: ThumbControllerDeps) {
  return {
    stats(_req: Request, res: Response): void {
      const body: ThumbStats = thumbs.stats();
      res.json(body);
    },
  };
}
