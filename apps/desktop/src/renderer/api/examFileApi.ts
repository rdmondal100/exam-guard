import {
  AuthOkSchema,
  EXAM_FILE_LIMITS,
  ExamFileSchema,
  ExamFilesSchema,
  TEACHER_TOKEN_HEADER,
  checkFileName,
  type ExamFile,
  type ServerConnection,
} from '@examguard/shared';
import { apiError, call, TeacherApiError, type FetchFn } from './teacherApi';

export interface ExamFileApi {
  list(examId: string): Promise<ExamFile[]>;
  /** Sends the file's bytes as they are (no base64). A file with the same name is replaced. */
  upload(examId: string, file: File): Promise<ExamFile>;
  remove(examId: string, fileId: string): Promise<void>;
}

const MB = 1024 * 1024;

export function createExamFileApi(
  connection: ServerConnection,
  fetchFn: FetchFn = fetch,
): ExamFileApi {
  const base = (examId: string) => `/exams/${encodeURIComponent(examId)}/files`;
  return {
    list: (examId) => call(connection, fetchFn, base(examId), ExamFilesSchema),
    upload: async (examId, file) => {
      // The same checks the server makes, so a wrong file fails before it is sent.
      const problem = checkFileName(file.name);
      if (problem) throw new TeacherApiError(400, 'invalid_name', problem);
      if (file.size > EXAM_FILE_LIMITS.fileBytes) {
        throw new TeacherApiError(
          413,
          'file_too_large',
          `A file can be at most ${EXAM_FILE_LIMITS.fileBytes / MB} MB`,
        );
      }
      const res = await fetchFn(
        `${connection.baseUrl}/api/v1${base(examId)}?name=${encodeURIComponent(file.name)}`,
        {
          method: 'POST',
          headers: {
            [TEACHER_TOKEN_HEADER]: connection.token,
            'content-type': 'application/octet-stream',
          },
          body: file,
        },
      );
      const json: unknown = await res.json().catch(() => null);
      if (!res.ok) throw apiError(res.status, json);
      return ExamFileSchema.parse(json);
    },
    remove: async (examId, fileId) => {
      await call(
        connection,
        fetchFn,
        `${base(examId)}/${encodeURIComponent(fileId)}`,
        AuthOkSchema,
        undefined,
        'DELETE',
      );
    },
  };
}
