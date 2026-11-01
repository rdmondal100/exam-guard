import type { Request, Response } from 'express';
import {
  JoinConfirmRequestSchema,
  JoinRequestSchema,
  PROTOCOL_VERSION,
  type StudentInfo,
} from '@examguard/shared';
import type { AnswerRepo } from '../db/repositories/answer.repo.js';
import type { ExamRepo } from '../db/repositories/exam.repo.js';
import type { ExamStudent } from '../db/repositories/examStudent.repo.js';
import { bearer } from '../middlewares/studentAuth.middleware.js';
import type { ExamFileService } from '../services/exam-files/exam-file-service.js';
import type { JoinService } from '../services/join/join-service.js';
import { ApiError } from '../utils/ApiError.js';

export interface StudentControllerDeps {
  /** The hosted exam, or `null` when nothing is hosted. */
  current: () => { examTitle: string; state: StudentInfo['state'] } | null;
  fpCode: string;
  join: JoinService;
  exams?: ExamRepo;
  files?: ExamFileService;
  answers?: AnswerRepo;
}

/** `verifyStudent` ran before every handler that reads this. */
function sessionOf(req: Request): ExamStudent {
  if (!req.student) throw new ApiError(401, 'unauthorized', 'Sign in again');
  return req.student;
}

/** The student API on the HTTPS listener. A `JoinError` goes to the error middleware. */
export function createStudentController({
  current,
  fpCode,
  join,
  exams,
  files,
  answers,
}: StudentControllerDeps) {
  return {
    info(_req: Request, res: Response): void {
      const exam = current();
      if (!exam) throw new ApiError(503, 'not_hosting', 'No exam is being hosted');
      const info: StudentInfo = { ...exam, protocol: PROTOCOL_VERSION, fpCode };
      res.json(info);
    },

    join(req: Request, res: Response): void {
      const body = JoinRequestSchema.safeParse(req.body);
      if (!body.success) throw new ApiError(400, 'invalid_body', 'Check the student ID and PIN');
      res.json(join.join(body.data, req.ip ?? ''));
    },

    confirm(req: Request, res: Response): void {
      const token = bearer(req.headers.authorization);
      if (!token) throw new ApiError(401, 'unauthorized', 'Sign in again');
      const body = JoinConfirmRequestSchema.safeParse(req.body);
      if (!body.success) {
        throw new ApiError(400, 'invalid_body', 'The monitoring notice must be accepted');
      }
      res.json({ ok: true, state: join.confirm(token) });
    },

    /**
     * The newest stored version of each of the student's buffers, so a restarted app can fill its
     * editors again. It is HTTP and not part of `welcome` because the client caps a WS frame at
     * 512 KB and one buffer can be 128 K characters.
     */
    latestAnswers(req: Request, res: Response): void {
      if (!answers) throw new ApiError(404, 'not_found', 'Not found');
      res.json(answers.snapshot(sessionOf(req).id));
    },

    /**
     * A file of the student's own exam, only while it is hosted or running, and only if the
     * teacher left the Files switch on. The bytes are streamed; the manifest with the hash came
     * in `welcome`.
     */
    async examFile(req: Request<{ fileId: string }>, res: Response): Promise<void> {
      if (!exams || !files) throw new ApiError(404, 'not_found', 'Not found');
      const exam = exams.get(sessionOf(req).examId);
      if (!exam) throw new ApiError(404, 'not_found', 'Exam not found');
      if (exam.state !== 'hosting' && exam.state !== 'running') {
        throw new ApiError(409, 'invalid_state', 'The exam is not open');
      }
      if (!exam.filesEnabled) throw new ApiError(403, 'files_off', 'Files are turned off');
      const file = files.get(exam.id, req.params.fileId);
      if (!file) throw new ApiError(404, 'not_found', 'File not found');
      const stream = await files.open(exam.id, file);
      if (!stream) throw new ApiError(404, 'file_missing', 'The file is missing on the server');
      stream.on('error', () => res.destroy());
      res.set({
        'content-type': 'application/octet-stream',
        'content-length': String(file.size),
        'x-sha256': file.sha256,
      });
      stream.pipe(res);
    },
  };
}
