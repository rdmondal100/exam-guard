import { z } from 'zod';
import { ProtocolVersionSchema } from './protocol-version.js';

/** Student listener port (docs/architecture.md §2). */
export const STUDENT_API_PORT = 47820;

/** `POST /exams/:id/host` and `GET /exams/:id/hosting`. */
export const HostingInfoSchema = z.object({
  pin: z.string().regex(/^\d{6}$/),
  addresses: z.array(z.string()),
  port: z.number().int().min(1).max(65535),
  fpCode: z.string().length(4),
});
export type HostingInfo = z.infer<typeof HostingInfoSchema>;

/** `POST /exams/:id/start`: server times in ms since the epoch. */
export const StartResultSchema = z.object({
  ok: z.literal(true),
  startedAt: z.number(),
  deadline: z.number(),
});
export type StartResult = z.infer<typeof StartResultSchema>;

/** Student API `GET /info`: lets a student app show the 4-char code after a manual IP. */
export const StudentInfoSchema = z.object({
  examTitle: z.string(),
  protocol: ProtocolVersionSchema,
  state: z.enum(['hosting', 'running']),
  fpCode: z.string().length(4),
});
export type StudentInfo = z.infer<typeof StudentInfoSchema>;
