import type { Request, Response } from 'express';
import type { ExamRepo } from '../db/repositories/exam.repo.js';
import type { ExamFileService } from '../services/exam-files/exam-file-service.js';
import { isEditable } from '../services/exams/exam-state.js';
import { ApiError } from '../utils/ApiError.js';

export interface ExamFileControllerDeps {
  exams: ExamRepo;
  files: ExamFileService;
  now?: () => number;
}

/** The files the teacher attaches to an exam. Writes need a draft or ready exam. */
export function createExamFileController({ exams, files, now = Date.now }: ExamFileControllerDeps) {
  const editable = (id: string) => {
    const exam = exams.get(id);
    if (!exam) throw new ApiError(404, 'not_found', 'Exam not found');
    if (!isEditable(exam.state)) {
      throw new ApiError(409, 'invalid_state', `A ${exam.state} exam cannot be edited`);
    }
    return exam;
  };

  return {
    list(req: Request<{ id: string }>, res: Response): void {
      if (!exams.get(req.params.id)) throw new ApiError(404, 'not_found', 'Exam not found');
      res.json(files.list(req.params.id));
    },

    /** The raw file as the body (`rawUpload`), the name in `?name=`. */
    async upload(req: Request<{ id: string }>, res: Response): Promise<void> {
      const exam = editable(req.params.id);
      const body: unknown = req.body;
      const data = Buffer.isBuffer(body) ? body : Buffer.alloc(0);
      const name = typeof req.query.name === 'string' ? req.query.name : '';
      res.status(201).json(await files.add(exam.id, name, data, now()));
    },

    async remove(req: Request<{ id: string; fileId: string }>, res: Response): Promise<void> {
      const exam = editable(req.params.id);
      if (!(await files.remove(exam.id, req.params.fileId))) {
        throw new ApiError(404, 'not_found', 'File not found');
      }
      res.json({ ok: true });
    },
  };
}
