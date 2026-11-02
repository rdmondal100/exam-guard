import {
  AnswerDetailSchema,
  GradingStatusSchema,
  ReviewTableSchema,
  type AnswerDetail,
  type AnswerEditBody,
  type GradingStatus,
  type ReviewTable,
  type ServerConnection,
} from '@examguard/shared';
import { call, type FetchFn } from './teacherApi';

/** AI grading (M38), review (M39) and accept / edit (M40). */
export interface GradingApi {
  status(examId: string): Promise<GradingStatus>;
  /** "Evaluate with AI": every question, or the chosen ones. Rejects `no_api_key`, `invalid_state`, `nothing_to_grade`. */
  start(examId: string, questionIds?: string[]): Promise<GradingStatus>;
  cancel(examId: string): Promise<GradingStatus>;
  reviewTable(examId: string, questionId: string): Promise<ReviewTable>;
  answer(examStudentId: string, questionId: string): Promise<AnswerDetail>;
  /** Rejects `nothing_to_accept` unless the grade is still the AI's. */
  accept(examStudentId: string, questionId: string): Promise<AnswerDetail>;
  /** Rejects `invalid_marks` (details.problems) when the marks do not fit the guide. */
  edit(examStudentId: string, questionId: string, body: AnswerEditBody): Promise<AnswerDetail>;
}

export function createGradingApi(
  connection: ServerConnection,
  fetchFn: FetchFn = fetch,
): GradingApi {
  const exam = (id: string) => `/exams/${encodeURIComponent(id)}`;
  const answer = (sid: string, qid: string) =>
    `/answers/${encodeURIComponent(sid)}/${encodeURIComponent(qid)}`;
  return {
    status: (id) => call(connection, fetchFn, `${exam(id)}/grading`, GradingStatusSchema),
    start: (id, questionIds) =>
      call(
        connection,
        fetchFn,
        `${exam(id)}/grading`,
        GradingStatusSchema,
        questionIds ? { questionIds } : {},
      ),
    cancel: (id) =>
      call(connection, fetchFn, `${exam(id)}/grading/cancel`, GradingStatusSchema, {}),
    reviewTable: (id, qid) =>
      call(connection, fetchFn, `${exam(id)}/review/${encodeURIComponent(qid)}`, ReviewTableSchema),
    answer: (sid, qid) => call(connection, fetchFn, answer(sid, qid), AnswerDetailSchema),
    accept: (sid, qid) =>
      call(connection, fetchFn, `${answer(sid, qid)}/accept`, AnswerDetailSchema, {}),
    edit: (sid, qid, body) =>
      call(connection, fetchFn, `${answer(sid, qid)}/edit`, AnswerDetailSchema, body),
  };
}
