import type { AnswerDetail, AnswerEditBody, ReviewTable } from '@examguard/shared';
import type { AnswerGradeRepo } from '../../db/repositories/answerGrade.repo.js';
import type { EvaluationRepo } from '../../db/repositories/evaluation.repo.js';
import type { ExamRepo } from '../../db/repositories/exam.repo.js';
import type { ExamStudentRepo } from '../../db/repositories/examStudent.repo.js';
import type { FinalAnswerRepo } from '../../db/repositories/finalAnswer.repo.js';
import type { QuestionRepo } from '../../db/repositories/question.repo.js';
import { GradingError } from './provider-source.js';
import { checkTeacherGrade } from './teacher-grade.js';

export interface ReviewServiceDeps {
  exams: ExamRepo;
  questions: QuestionRepo;
  students: ExamStudentRepo;
  finals: FinalAnswerRepo;
  grades: AnswerGradeRepo;
  evaluations: EvaluationRepo;
  now?: () => number;
}

/**
 * The review screens (M39) and the teacher's accept / edit (M40). Every accept or edit is a new
 * teacher row in `evaluations`, so the history keeps every AI and teacher entry in order.
 */
export class ReviewService {
  private readonly now: () => number;

  constructor(private readonly deps: ReviewServiceDeps) {
    this.now = deps.now ?? Date.now;
  }

  table(examId: string, questionId: string): ReviewTable {
    if (!this.deps.exams.get(examId)) throw new GradingError(404, 'not_found', 'Exam not found');
    const question = this.deps.questions.get(questionId);
    if (!question || question.examId !== examId) {
      throw new GradingError(404, 'not_found', 'Question not found');
    }
    return {
      questionId,
      position: question.position,
      marks: question.marks,
      rows: this.deps.grades.reviewRows(questionId),
    };
  }

  answer(examStudentId: string, questionId: string): AnswerDetail {
    const { exams, students, finals, grades, evaluations } = this.deps;
    const roster = students.rosterEntry(examStudentId);
    const final = finals.get(examStudentId, questionId);
    const exam = roster && exams.get(roster.examId);
    if (!roster || !final || !exam) throw new GradingError(404, 'not_found', 'Answer not found');
    const grade = grades.get(examStudentId, questionId) ?? {
      status: 'pending' as const,
      total: null,
      confidence: null,
      currentEvaluationId: null,
      updatedAt: final.submittedAt,
    };
    const { entry } = roster;
    return {
      examId: exam.id,
      examState: exam.state,
      questionId,
      student: {
        id: entry.id,
        studentCode: entry.studentCode,
        name: entry.name,
        riskScore: entry.riskScore,
        outsideMs: entry.outsideMs,
      },
      answer: { language: final.language, content: final.content, submittedAt: final.submittedAt },
      grade,
      current:
        grade.currentEvaluationId === null
          ? null
          : (evaluations.get(grade.currentEvaluationId) ?? null),
      history: evaluations.history(examStudentId, questionId),
    };
  }

  /** The teacher agrees with the AI grade: `ai_graded` → `verified`. */
  accept(examStudentId: string, questionId: string): AnswerDetail {
    const detail = this.reviewable(examStudentId, questionId);
    if (detail.grade.status === 'verified') return detail;
    const current = detail.current;
    if (detail.grade.status !== 'ai_graded' || !current) {
      const message =
        detail.grade.status === 'modified'
          ? 'This grade was already edited by the teacher'
          : 'There is no AI grade to accept';
      throw new GradingError(409, 'nothing_to_accept', message);
    }
    const stored = this.deps.evaluations.storedCriteria(current.id) ?? [];
    this.writeTeacherGrade(examStudentId, questionId, 'verified', {
      criteria: stored,
      total: stored.reduce((sum, c) => sum + c.awarded, 0),
      feedback: current.feedback,
      teacherNotes: current.teacherNotes,
    });
    return this.answer(examStudentId, questionId);
  }

  /** The teacher's own marks and feedback: the grade becomes `modified`. */
  edit(examStudentId: string, questionId: string, body: AnswerEditBody): AnswerDetail {
    const detail = this.reviewable(examStudentId, questionId);
    const question = this.deps.questions.get(questionId);
    if (!question) throw new GradingError(404, 'not_found', 'Question not found');
    const check = checkTeacherGrade(question.criteria, body.criteria);
    if (!check.ok) {
      throw new GradingError(400, 'invalid_marks', 'The marks do not fit the marking guide', {
        problems: check.problems,
      });
    }
    this.writeTeacherGrade(examStudentId, questionId, 'modified', {
      criteria: check.criteria,
      total: check.total,
      feedback: body.feedback.trim(),
      teacherNotes: body.teacherNotes ?? detail.current?.teacherNotes ?? [],
    });
    return this.answer(examStudentId, questionId);
  }

  /** The answer, when its exam is in review (not while grading runs, never once finalized). */
  private reviewable(examStudentId: string, questionId: string): AnswerDetail {
    const detail = this.answer(examStudentId, questionId);
    if (detail.examState !== 'in_review') {
      throw new GradingError(
        409,
        'invalid_state',
        detail.examState === 'finalized'
          ? 'Marks are locked once the exam is finalized'
          : 'Marks can be changed only while the exam is in review',
      );
    }
    return detail;
  }

  private writeTeacherGrade(
    examStudentId: string,
    questionId: string,
    status: 'verified' | 'modified',
    grade: {
      criteria: { name: string; max: number; awarded: number; reason: string }[];
      total: number;
      feedback: string;
      teacherNotes: readonly { line: number; issue: string }[];
    },
  ): void {
    const now = this.now();
    this.deps.exams.transaction(() => {
      const id = this.deps.evaluations.insert({
        examStudentId,
        questionId,
        jobId: null,
        author: 'teacher',
        status: 'ok',
        criteria: grade.criteria,
        total: grade.total,
        feedback: grade.feedback,
        teacherNotes: grade.teacherNotes,
        confidence: null,
        provider: null,
        model: null,
        promptVersion: null,
        instruction: null,
        rawResponse: null,
        problems: [],
        attempt: 1,
        now,
      });
      this.deps.grades.ensureRows(questionId, now);
      this.deps.grades.set(
        examStudentId,
        questionId,
        { status, evaluationId: id, total: grade.total, confidence: null },
        now,
      );
    });
  }
}
