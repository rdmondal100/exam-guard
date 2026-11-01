import type { ExamStudent } from '../db/repositories/examStudent.repo.js';

declare global {
  namespace Express {
    interface Request {
      /** Set by `verifyStudent` on the student routes that need a session. */
      student?: ExamStudent;
    }
  }
}

export {};
