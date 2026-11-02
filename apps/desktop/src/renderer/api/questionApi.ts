import {
  AuthOkSchema,
  QuestionSchema,
  QuestionsSchema,
  ReadyProblemsDetailsSchema,
  type Question,
  type QuestionBody,
  type ReadyProblem,
  type ServerConnection,
} from '@examguard/shared';
import { call, TeacherApiError, type FetchFn } from './teacherApi';

export interface QuestionApi {
  list(examId: string): Promise<Question[]>;
  create(examId: string, body: QuestionBody): Promise<Question>;
  update(id: string, body: QuestionBody): Promise<Question>;
  remove(id: string): Promise<void>;
  reorder(examId: string, ids: string[]): Promise<Question[]>;
}

export function createQuestionApi(
  connection: ServerConnection,
  fetchFn: FetchFn = fetch,
): QuestionApi {
  const exam = (id: string) => `/exams/${encodeURIComponent(id)}/questions`;
  const one = (id: string) => `/questions/${encodeURIComponent(id)}`;
  return {
    list: (examId) => call(connection, fetchFn, exam(examId), QuestionsSchema),
    create: (examId, body) => call(connection, fetchFn, exam(examId), QuestionSchema, body),
    update: (id, body) => call(connection, fetchFn, one(id), QuestionSchema, body, 'PATCH'),
    remove: async (id) => {
      await call(connection, fetchFn, one(id), AuthOkSchema, undefined, 'DELETE');
    },
    reorder: (examId, ids) =>
      call(connection, fetchFn, `${exam(examId)}/reorder`, QuestionsSchema, { ids }),
  };
}

/** The reasons carried by a `not_ready` error, or `null` for any other error. */
export function readyProblemsOf(error: unknown): ReadyProblem[] | null {
  if (!(error instanceof TeacherApiError) || error.code !== 'not_ready') return null;
  const parsed = ReadyProblemsDetailsSchema.safeParse(error.details);
  return parsed.success ? parsed.data.problems : null;
}
