import type { StudentAnswer, StudentAnswersResponse } from '@examguard/shared';
import type { AnswerRepo } from '../../db/repositories/answer.repo.js';
import type { AnswerGradeRepo } from '../../db/repositories/answerGrade.repo.js';
import type { ExamStudentRepo } from '../../db/repositories/examStudent.repo.js';
import type { FinalAnswerRepo } from '../../db/repositories/finalAnswer.repo.js';
import type { QuestionRepo } from '../../db/repositories/question.repo.js';
import { ApiError } from '../../utils/ApiError.js';

export interface StudentAnswersDeps {
  students: Pick<ExamStudentRepo, 'findById'>;
  questions: Pick<QuestionRepo, 'list'>;
  answers: Pick<AnswerRepo, 'latestByQuestion'>;
  finals: Pick<FinalAnswerRepo, 'forStudent' | 'receiptFor'>;
  grades: Pick<AnswerGradeRepo, 'get'>;
}

/**
 * One student's answer sheet for the teacher (M65), in any exam state: once the student is
 * finalized (Submit, time up or the teacher's End) the final answers with the receipt and any
 * grade, before that the newest autosave of each question, so the teacher can follow the work.
 * Read-only.
 */
export class StudentAnswersService {
  constructor(private readonly deps: StudentAnswersDeps) {}

  sheet(examId: string, examStudentId: string): StudentAnswersResponse {
    const { students, questions, answers, finals, grades } = this.deps;
    const student = students.findById(examStudentId);
    if (!student || student.examId !== examId) {
      throw new ApiError(404, 'not_found', 'Student not found in this exam');
    }
    const list = questions.list(examId);
    const final = finals.forStudent(examStudentId);
    if (final.length > 0) {
      const byQuestion = new Map(final.map((f) => [f.questionId, f]));
      const receipt = finals.receiptFor(examStudentId);
      return {
        source: 'final',
        submittedAt: receipt?.submittedAt ?? final[0]?.submittedAt ?? null,
        receiptHash: receipt?.hash ?? null,
        answers: list.map((q): StudentAnswer => {
          const f = byQuestion.get(q.id);
          const grade = grades.get(examStudentId, q.id);
          return {
            ...questionPart(q),
            language: f?.language ?? null,
            content: f?.content ?? '',
            answered: (f?.content ?? '').trim() !== '',
            savedAt: f?.submittedAt ?? null,
            grade: grade ? { total: grade.total, status: grade.status } : null,
          };
        }),
      };
    }
    const latest = new Map(answers.latestByQuestion(examStudentId).map((v) => [v.questionId, v]));
    return {
      source: 'latest',
      submittedAt: null,
      receiptHash: null,
      answers: list.map((q): StudentAnswer => {
        const v = latest.get(q.id);
        return {
          ...questionPart(q),
          language: v?.language ?? null,
          content: v?.content ?? '',
          answered: (v?.content ?? '').trim() !== '',
          savedAt: v?.serverTs ?? null,
          grade: null,
        };
      }),
    };
  }
}

function questionPart(q: ReturnType<QuestionRepo['list']>[number]) {
  return {
    questionId: q.id,
    position: q.position,
    type: q.type,
    body: q.body,
    maxMarks: q.marks,
  };
}
