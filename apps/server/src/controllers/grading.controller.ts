import type { Request, Response } from 'express';
import { AnswerEditBodySchema, GradingStartBodySchema } from '@examguard/shared';
import type { GradingService } from '../services/grading/grading-service.js';
import type { ReviewService } from '../services/grading/review-service.js';
import { ApiError } from '../utils/ApiError.js';

export interface GradingControllerDeps {
  grading: GradingService;
  review: ReviewService;
}

type IdRequest = Request<{ id: string }>;
type AnswerRequest = Request<{ sid: string; qid: string }>;

/**
 * AI grading (M38), the review screens (M39) and the teacher's accept / edit (M40). A
 * `GradingError` goes to the error middleware.
 */
export function createGradingController({ grading, review }: GradingControllerDeps) {
  return {
    status(req: IdRequest, res: Response): void {
      const status = grading.status(req.params.id);
      if (!status) throw new ApiError(404, 'not_found', 'Exam not found');
      res.json(status);
    },

    async start(req: IdRequest, res: Response): Promise<void> {
      const body = GradingStartBodySchema.safeParse(req.body ?? {});
      if (!body.success) throw new ApiError(400, 'invalid_body', 'Invalid grading request');
      res.json(await grading.start(req.params.id, body.data.questionIds));
    },

    cancel(req: IdRequest, res: Response): void {
      res.json(grading.cancel(req.params.id));
    },

    table(req: Request<{ id: string; qid: string }>, res: Response): void {
      res.json(review.table(req.params.id, req.params.qid));
    },

    answer(req: AnswerRequest, res: Response): void {
      res.json(review.answer(req.params.sid, req.params.qid));
    },

    accept(req: AnswerRequest, res: Response): void {
      res.json(review.accept(req.params.sid, req.params.qid));
    },

    edit(req: AnswerRequest, res: Response): void {
      const body = AnswerEditBodySchema.safeParse(req.body);
      if (!body.success) {
        throw new ApiError(400, 'invalid_body', 'Invalid marks', {
          problems: body.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
        });
      }
      res.json(review.edit(req.params.sid, req.params.qid, body.data));
    },
  };
}
