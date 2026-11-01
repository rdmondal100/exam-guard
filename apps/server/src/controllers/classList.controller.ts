import type { Request, Response } from 'express';
import {
  ClassListImportBodySchema,
  MAX_CLASS_LIST_ROWS,
  type ClassListImportResult,
} from '@examguard/shared';
import type { ClassListRepo } from '../db/repositories/classList.repo.js';
import { parseClassCsv } from '../services/class-lists/csv-parser.js';
import { ApiError } from '../utils/ApiError.js';

export interface ClassListControllerDeps {
  classLists: ClassListRepo;
  now?: () => number;
}

/** CSV import with a dry-run preview, listing and delete. */
export function createClassListController({ classLists, now = Date.now }: ClassListControllerDeps) {
  return {
    list(_req: Request, res: Response): void {
      res.json(classLists.list());
    },

    import(req: Request, res: Response): void {
      const body = ClassListImportBodySchema.safeParse(req.body);
      if (!body.success) {
        throw new ApiError(400, 'invalid_body', 'A list name and the CSV text are required');
      }
      const { rows, errors } = parseClassCsv(body.data.csvText);
      if (rows.length === 0) {
        throw new ApiError(400, 'no_valid_rows', 'The file has no valid student rows', { errors });
      }
      if (rows.length > MAX_CLASS_LIST_ROWS) {
        throw new ApiError(400, 'too_many_rows', `At most ${MAX_CLASS_LIST_ROWS} students`);
      }
      if (body.data.dryRun === true) {
        const preview: ClassListImportResult = { rows, errors };
        res.json(preview);
        return;
      }
      const list = classLists.create(body.data.name, rows, now());
      const saved: ClassListImportResult = { list, rows, errors };
      res.json(saved);
    },

    students(req: Request<{ id: string }>, res: Response): void {
      const students = classLists.students(req.params.id);
      if (students === undefined) throw new ApiError(404, 'not_found', 'Class list not found');
      res.json(students);
    },

    remove(req: Request<{ id: string }>, res: Response): void {
      const result = classLists.delete(req.params.id);
      if (result === 'not_found') throw new ApiError(404, 'not_found', 'Class list not found');
      if (result === 'in_use')
        throw new ApiError(409, 'list_in_use', 'An exam uses this class list');
      res.json({ ok: true });
    },
  };
}
