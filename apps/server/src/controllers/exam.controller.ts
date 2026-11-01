import type { Request, Response } from 'express';
import { ExamCreateBodySchema, ExamUpdateBodySchema } from '@examguard/shared';
import type { ExamRepo } from '../db/repositories/exam.repo.js';
import type { QuestionRepo } from '../db/repositories/question.repo.js';
import type { ExamFileService } from '../services/exam-files/exam-file-service.js';
import { canTransition, isEditable } from '../services/exams/exam-state.js';
import { readyProblems } from '../services/exams/ready-check.js';
import type { ScreenshotStore } from '../services/screenshots/screenshot-store.js';
import { ApiError } from '../utils/ApiError.js';

export interface ExamControllerDeps {
  exams: ExamRepo;
  questions: QuestionRepo;
  /** The teacher's attached files; a copy and a delete carry them along. */
  examFiles?: ExamFileService;
  /** Deleting an exam also deletes its screenshots. */
  screenshots?: Pick<ScreenshotStore, 'removeExam'>;
  now?: () => number;
}

type IdRequest = Request<{ id: string }>;

/** List, create, edit settings, duplicate, delete and ready/unready. */
export function createExamController({
  exams,
  questions,
  examFiles,
  screenshots,
  now = Date.now,
}: ExamControllerDeps) {
  const found = (id: string) => {
    const exam = exams.get(id);
    if (!exam) throw new ApiError(404, 'not_found', 'Exam not found');
    return exam;
  };

  return {
    list(_req: Request, res: Response): void {
      res.json(exams.list());
    },

    get(req: IdRequest, res: Response): void {
      res.json(found(req.params.id));
    },

    create(req: Request, res: Response): void {
      const body = ExamCreateBodySchema.safeParse(req.body);
      if (!body.success) {
        throw new ApiError(400, 'invalid_body', 'A title and a duration of 1–600 minutes');
      }
      if (body.data.classListId != null && !exams.classListExists(body.data.classListId)) {
        throw new ApiError(400, 'class_list_not_found', 'That class list does not exist');
      }
      res.status(201).json(exams.create(body.data, now()));
    },

    update(req: IdRequest, res: Response): void {
      const body = ExamUpdateBodySchema.safeParse(req.body);
      if (!body.success) throw new ApiError(400, 'invalid_body', 'Invalid exam settings');
      const current = found(req.params.id);
      if (!isEditable(current.state)) {
        throw new ApiError(409, 'invalid_state', `A ${current.state} exam cannot be edited`);
      }
      if (body.data.classListId != null && !exams.classListExists(body.data.classListId)) {
        throw new ApiError(400, 'class_list_not_found', 'That class list does not exist');
      }
      res.json(exams.update(current.id, body.data, now()));
    },

    async duplicate(req: IdRequest, res: Response): Promise<void> {
      const copy = exams.duplicate(req.params.id, now());
      if (!copy) throw new ApiError(404, 'not_found', 'Exam not found');
      await examFiles?.copyExam(req.params.id, copy.id, now());
      res.status(201).json(copy);
    },

    ready(req: IdRequest, res: Response): void {
      const current = found(req.params.id);
      if (current.state === 'ready') {
        res.json(current);
        return;
      }
      if (!canTransition(current.state, 'ready')) {
        throw new ApiError(409, 'invalid_state', `A ${current.state} exam cannot be marked ready`);
      }
      const problems = readyProblems(current, questions.list(current.id));
      if (problems.length > 0) {
        throw new ApiError(422, 'not_ready', 'The exam is not ready yet', { problems });
      }
      res.json(exams.setState(current.id, 'ready', now()));
    },

    unready(req: IdRequest, res: Response): void {
      const current = found(req.params.id);
      if (current.state === 'draft') {
        res.json(current);
        return;
      }
      if (!canTransition(current.state, 'draft')) {
        throw new ApiError(409, 'invalid_state', `A ${current.state} exam cannot go back to draft`);
      }
      res.json(exams.setState(current.id, 'draft', now()));
    },

    async remove(req: IdRequest, res: Response): Promise<void> {
      const current = found(req.params.id);
      if (!isEditable(current.state)) {
        throw new ApiError(409, 'invalid_state', `A ${current.state} exam cannot be deleted`);
      }
      exams.delete(current.id);
      await examFiles?.removeExam(current.id);
      screenshots?.removeExam(current.id);
      res.json({ ok: true });
    },
  };
}
