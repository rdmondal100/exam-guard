import type { RequestHandler } from 'express';
import type { ExamStudentRepo } from '../db/repositories/examStudent.repo.js';
import { hashToken } from '../services/join/join-service.js';
import { sendError } from '../utils/ApiError.js';

/** The token of an `Authorization: Bearer <token>` header, or `undefined`. */
export function bearer(header: string | undefined): string | undefined {
  const match = /^Bearer (\S+)$/.exec(header ?? '');
  return match?.[1];
}

/** Student routes that need a session: looks the bearer token up and sets `req.student`. */
export function verifyStudent(students: ExamStudentRepo): RequestHandler {
  return (req, res, next) => {
    const token = bearer(req.headers.authorization);
    const student = token ? students.findByTokenHash(hashToken(token)) : undefined;
    if (!student) return sendError(res, 401, 'unauthorized', 'Sign in again');
    req.student = student;
    next();
  };
}
