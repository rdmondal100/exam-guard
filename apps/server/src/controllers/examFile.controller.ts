import type { Request, Response } from 'express';
import type { ExamRepo } from '../db/repositories/exam.repo.js';
import type { ExamFileService } from '../services/exam-files/exam-file-service.js';
import { acceptsAdditions, isEditable } from '../services/exams/exam-state.js';
import { ApiError } from '../utils/ApiError.js';

export interface ExamFileControllerDeps {
  exams: ExamRepo;
  files: ExamFileService;
  now?: () => number;
  /** A file was added to a hosted or running exam (M58): the students get it. */
  onFileAdded?: (examId: string, name: string) => void;
}

/**
 * The files the teacher attaches to an exam. Changes need a draft or ready exam; a hosted or
 * running one only takes new files under new names (M58).
 */
export function createExamFileController({
  exams,
  files,
  now = Date.now,
  onFileAdded,
}: ExamFileControllerDeps) {
  const found = (id: string) => {
    const exam = exams.get(id);
    if (!exam) throw new ApiError(404, 'not_found', 'Exam not found');
    return exam;
  };

  return {
    list(req: Request<{ id: string }>, res: Response): void {
      res.json(files.list(found(req.params.id).id));
    },

    /** The raw file as the body (`rawUpload`), the name in `?name=`. */
    async upload(req: Request<{ id: string }>, res: Response): Promise<void> {
      const exam = found(req.params.id);
      const live = acceptsAdditions(exam.state);
      if (!isEditable(exam.state) && !live) {
        throw new ApiError(409, 'invalid_state', `A ${exam.state} exam cannot be edited`);
      }
      const body: unknown = req.body;
      const data = Buffer.isBuffer(body) ? body : Buffer.alloc(0);
      const name = typeof req.query.name === 'string' ? req.query.name : '';
      const file = await files.add(exam.id, name, data, now(), { replace: !live });
      if (live) onFileAdded?.(exam.id, file.name);
      res.status(201).json(file);
    },

    async remove(req: Request<{ id: string; fileId: string }>, res: Response): Promise<void> {
      const exam = found(req.params.id);
      if (!isEditable(exam.state)) {
        const message = acceptsAdditions(exam.state)
          ? 'Students may already have this file: it cannot be removed now'
          : `A ${exam.state} exam cannot be edited`;
        throw new ApiError(409, 'invalid_state', message);
      }
      if (!(await files.remove(exam.id, req.params.fileId))) {
        throw new ApiError(404, 'not_found', 'File not found');
      }
      res.json({ ok: true });
    },
  };
}
