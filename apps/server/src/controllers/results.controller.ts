import type { Request, Response } from 'express';
import type { ResultsService } from '../services/results/results-service.js';

export interface ResultsControllerDeps {
  results: ResultsService;
}

type IdRequest = Request<{ id: string }>;

/** Finalize and the results export (M42). Errors are `ApiError`s from the service. */
export function createResultsController({ results }: ResultsControllerDeps) {
  return {
    async finalize(req: IdRequest, res: Response): Promise<void> {
      res.json(await results.finalize(req.params.id));
    },

    /** The CSV itself, as a download. */
    csv(req: IdRequest, res: Response): void {
      const { fileName, text } = results.csv(req.params.id);
      res.type('text/csv; charset=utf-8').attachment(fileName).send(text);
    },

    /** Saves the CSV in the teacher's `exports/` folder and says where. */
    async exportCsv(req: IdRequest, res: Response): Promise<void> {
      res.json(await results.exportCsv(req.params.id));
    },
  };
}
